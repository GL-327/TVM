#pragma once

// Clear refracting glass, after PyGlass (github.com/neomosh8/pyglass, MIT): each surface is a slab of glass
// with a flat interior and a rounded rim. What is already drawn under the surface is copied from the render
// target, shown 1:1 through the flat interior, and bent inward at the rim by Snell's law through the
// roundover, a little differently for red, green and blue. A Fresnel reflection of a soft key and fill light,
// and a thin pastel spectral line, brighten the grazing rim.
//
// The geometry is solved once per surface size on the CPU into a displacement map and a reflection overlay.
// Each frame then costs one GPU copy of the pixels under the surface and three displacement-map effects, all
// on the GPU through Direct2D 1.1 effects. Where the render target is not a Direct2D 1.1 device context, or
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

    // Draws the refracted pixels already under `box`, clipped to the rounded shape. False when it could not, so
    // the caller can draw its fallback.
    bool DrawRefraction(const ui::Box& box, double radius, double opacity);
    // Draws the rim's Fresnel reflection and spectral line over the surface. Call after any veil.
    void DrawRim(const ui::Box& box, double radius, double opacity);

private:
    struct Kernel {
        ComPtr<ID2D1Bitmap1> displacement;
        ComPtr<ID2D1Bitmap1> rim;
        ComPtr<ID2D1Bitmap1> capture;
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
    void PushShape(const ui::Box& box, double radius, double opacity);

    ID2D1RenderTarget* target_;
    ComPtr<ID2D1DeviceContext> dc_;
    ComPtr<ID2D1Effect> shift_[3];
    ComPtr<ID2D1Effect> channel_[3];
    ComPtr<ID2D1Effect> sum_;
    std::map<Key, Kernel> kernels_;
    std::uint64_t clock_ = 0;
};

}  // namespace tvm::platform
