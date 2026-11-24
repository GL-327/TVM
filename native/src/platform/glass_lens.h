#pragma once

// Liquid Glass, after PyGlass (github.com/neomosh8/pyglass, MIT) and the open fits of iOS 26/27 glass (Kyant0's
// Backdrop, the Flutter liquid_glass_renderer): each surface is a flat slab of glass whose edge rolls over in a
// convex bezel. What is already drawn under the surface is copied from the render target, diffused a little (much
// more for frosted glass), seen undistorted through the flat middle, and pulled inward at the bezel, a touch
// differently for red, green and blue. A neutral specular glint, lit from the upper left with half as much on the
// far edge, iOS 27's dark contour where the edge runs across the light, and a soft shadow complete it.
//
// The geometry is solved once per surface size on the CPU into a displacement map, a glint overlay, a contour and a
// shadow. Each frame then costs one GPU copy of the pixels under the surface, a blur and three displacement-map
// effects, all on the GPU through Direct2D 1.1 effects. Where the render target is not a Direct2D 1.1 device context, or
// nothing has been drawn under the glass (the player's overlay over mpv), callers fall back to frosted glass.

#include <cstdint>
#include <map>
#include <tuple>

#include <d2d1_1.h>

#include "platform/graphics.h"
#include "ui/painter.h"

namespace tvm::platform {

class GlassLens {
public:
    // `target` must outlive the lens. The lens is unusable (ok() is false) when the target has no
    // ID2D1DeviceContext, as before Windows 8.
    explicit GlassLens(ID2D1RenderTarget* target);
    GlassLens(const GlassLens&) = delete;
    GlassLens& operator=(const GlassLens&) = delete;

    bool ok() const { return dc_ != nullptr; }

    // Starts a frame: only a few surfaces measure their brightness each frame.
    void BeginFrame();
    // Draws the refracted pixels already under `box`, clipped to the rounded shape. False when it could not, so
    // the caller can draw its fallback. `frosted` scatters the light through a rough surface first (a blur). When
    // `brightness` is given it receives how bright the pixels under the surface are, from 0 to 1, smoothed over
    // frames, or -1 before the first measurement.
    bool DrawRefraction(const ui::Box& box, double radius, double opacity, bool frosted = false,
                        double* brightness = nullptr);
    // Draws the rim over the surface: iOS 27's dark contour at `contour` strength, then the neutral specular glint
    // and grazing veil at `opacity`. Call after any veil.
    void DrawRim(const ui::Box& box, double radius, double opacity, double contour = 0.0);
    // Draws the surface's soft drop shadow, outside its shape, `drop` pixels further down than at rest (a focused
    // surface lifts). Call before DrawRefraction. False when it could not.
    bool DrawShadow(const ui::Box& box, double radius, double opacity, double drop = 0.0);

private:
    struct Kernel {
        ComPtr<ID2D1Bitmap1> displacement;
        ComPtr<ID2D1Bitmap1> rim;
        ComPtr<ID2D1Bitmap1> contour;
        // Half the surface's shorter side, which sets how far it diffuses the picture.
        double half = 0.0;
        // The drop shadow, `shadowMargin` pixels larger than the surface on every side.
        ComPtr<ID2D1Bitmap1> shadow;
        std::uint32_t shadowMargin = 0;
        ComPtr<ID2D1Bitmap1> capture;
        // A CPU-readable copy of the capture, for measuring brightness.
        ComPtr<ID2D1Bitmap1> readback;
        double maxShift = 0.0;
        std::uint64_t used = 0;
    };
    using Key = std::tuple<std::uint32_t, std::uint32_t, std::uint32_t>;

    struct Placement {
        std::int32_t x;
        std::int32_t y;
        std::uint32_t width;
        std::uint32_t height;
    };
    // The whole-pixel rectangle covering `box`. False when it is empty, too large, or wholly off the target.
    bool Place(const ui::Box& box, Placement& placement) const;
    Kernel* KernelFor(const Placement& placement, double radius);
    // The mean luminance of the capture's interior, read back from the GPU. -1 when it cannot be read.
    double Measure(Kernel& kernel);
    // Brightness by where a surface sits, so it adapts smoothly as the picture under it changes.
    struct Reading {
        double value = -1.0;
        std::uint64_t frame = 0;
    };
    using Spot = std::tuple<std::int32_t, std::int32_t, std::uint32_t, std::uint32_t>;
    std::map<Spot, Reading> readings_;
    std::uint64_t frame_ = 0;
    int measuresLeft_ = 0;
    void PushShape(const ui::Box& box, double radius, double opacity);

    ID2D1RenderTarget* target_;
    ComPtr<ID2D1DeviceContext> dc_;
    ComPtr<ID2D1Effect> shift_[3];
    ComPtr<ID2D1Effect> channel_[3];
    ComPtr<ID2D1Effect> sum_;
    ComPtr<ID2D1Effect> vibrancy_;
    ComPtr<ID2D1Effect> frost_;
    ComPtr<ID2D1Effect> soften_;
    std::map<Key, Kernel> kernels_;
    std::uint64_t clock_ = 0;
};

}  // namespace tvm::platform
