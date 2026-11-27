#pragma once

// Direct2D implementation of the widget tree's Painter. It draws onto any
// ID2D1RenderTarget: the window, or a bitmap for snapshots.

#include <map>
#include <vector>

#include "platform/graphics.h"
#include "platform/artwork_store.h"
#include "platform/glass_lens.h"
#include "platform/image_cache.h"
#include "ui/painter.h"

namespace tvm::platform {

class D2dPainter final : public ui::Painter {
public:
    // `artwork` and `images` may be null, in which case images are never drawn.
    // `lens` makes glass clear and refracting over whatever is drawn beneath it; without one, glass is frosted.
    D2dPainter(ID2D1RenderTarget* target, Graphics& graphics, ArtworkStore* artwork = nullptr,
               ImageCache* images = nullptr, GlassLens* lens = nullptr);

    void Clear(ui::Color color) override;
    void SetBackdrop(const ui::Box& box, const std::string& url, double focusX = 0.7, double focusY = 0.2) override;
    void Glass(const ui::Box& box, double radius, const ui::GlassStyle& style = {}) override;
    ui::Color GlassInk(ui::Color fallback) const override { return glassInk_.value_or(fallback); }
    void FillRoundRect(const ui::Box& box, double radius, ui::Color color) override;
    void StrokeRoundRect(const ui::Box& box, double radius, double width, ui::Color color) override;
    bool Image(const ui::Box& box, const std::string& url, double radius) override;
    bool ImageFaded(const ui::Box& box, const std::string& url, double radius, double opacity, double focusX,
                    double focusY) override;
    bool ImageContain(const ui::Box& box, const std::string& url) override;
    bool HeroVideo(const ui::Box& box, double opacity, double focusX, double focusY) override;
    bool SpotlightLogo(const ui::Box& box, const std::string& url, double opacity, double blur, double sweep) override;
    void BeginLightParticles() override;
    void EndLightParticles() override;
    void FillPolygon(const std::vector<ui::Point>& points, ui::Color color) override;
    void FillPolygonLinear(const std::vector<ui::Point>& points, double x0, double y0, double x1, double y1,
                           const std::vector<ui::GradientStop>& stops) override;
    void FillLinearGradient(const ui::Box& box, double x0, double y0, double x1, double y1,
                            const std::vector<ui::GradientStop>& stops) override;
    void FillRoundRectLinear(const ui::Box& box, double radius, double x0, double y0, double x1, double y1,
                             const std::vector<ui::GradientStop>& stops) override;
    void FillRadialGradient(const ui::Box& box, double cx, double cy, double rx, double ry,
                            const std::vector<ui::GradientStop>& stops) override;
    void Paragraph(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) override;
    void Text(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) override;
    void Path(const ui::Box& box, double viewBox, std::string_view data, const ui::PathStyle& style) override;
    double MeasureText(std::string_view text, const ui::TextStyle& style) override;
    void PushClip(const ui::Box& box) override;
    void PopClip() override;
    void PushClipStroke(const std::vector<ui::Point>& points, double width) override;
    void PushClipPolygons(const std::vector<std::vector<ui::Point>>& polygons) override;
    void StrokePolyline(const std::vector<ui::Point>& points, double width, ui::Color color, bool closed = false) override;
    void PushOpacity(double opacity) override;
    void PopOpacity() override;
    void PushLinearOpacity(double y0, double y1, double topAlpha, double bottomAlpha) override;

private:
    void DrawLabel(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color, bool wrap);
    ID2D1SolidColorBrush* Brush(ui::Color color);
    ComPtr<ID2D1GradientStopCollection> Stops(const std::vector<ui::GradientStop>& stops);
    // The closed outline through `points`, or nothing when there are fewer than three points.
    ComPtr<ID2D1PathGeometry> Polygon(const std::vector<ui::Point>& points);
    std::optional<paths::fs::path> ResolveFile(const std::string& url) const;
    // Parses SVG path data into a geometry in its own units; DrawPath scales it into a box.
    bool BuildPath(std::string_view data, bool filled, ComPtr<ID2D1PathGeometry>& geometry);
    void DrawPath(const ui::Box& box, double viewBox, ID2D1PathGeometry* geometry, const ui::PathStyle& style);

    ID2D1RenderTarget* target_;
    Graphics& graphics_;
    ArtworkStore* artwork_;
    ImageCache* images_;
    GlassLens* lens_;
    std::optional<ui::Color> glassInk_;
    ComPtr<ID2D1DeviceContext> particleContext_;
    D2D1_PRIMITIVE_BLEND previousParticleBlend_ = D2D1_PRIMITIVE_BLEND_SOURCE_OVER;
    ComPtr<ID2D1SolidColorBrush> solidBrush_;
    // Gradient stops made this frame, by their positions and colours: the glass surfaces of a frame share most
    // of theirs, so each set is made once.
    std::map<std::vector<float>, ComPtr<ID2D1GradientStopCollection>> stopCache_;
    int clipDepth_ = 0;
    // Each pushed clip, in order: true for a shaped clip (a layer), false for an axis-aligned one.
    std::vector<bool> clipLayers_;
    // Each PushOpacity, in order: whether it pushed a layer.
    std::vector<bool> opacityLayers_;
    // The open line through `points` (or closed), as a geometry.
    ComPtr<ID2D1PathGeometry> Polyline(const std::vector<ui::Point>& points, bool closed);
    void PushGeometryLayer(ID2D1Geometry* mask, double opacity);
    ui::Box backdropBox_{};
    std::string backdropUrl_;
    double backdropFocusX_ = 0.7;
    double backdropFocusY_ = 0.2;
    ID2D1Bitmap* backdropBitmap_ = nullptr;
    ComPtr<ID2D1BitmapBrush> backdropBrush_;
    double backdropScale_ = 1.0;
    double backdropOffsetX_ = 0.0;
    double backdropOffsetY_ = 0.0;
};

}  // namespace tvm::platform
