#pragma once

// Direct2D implementation of the widget tree's Painter. It draws onto any
// ID2D1RenderTarget: the window, or a bitmap for snapshots.

#include <vector>

#include "platform/graphics.h"
#include "platform/artwork_store.h"
#include "platform/image_cache.h"
#include "ui/painter.h"

namespace tvm::platform {

class D2dPainter final : public ui::Painter {
public:
    // `artwork` and `images` may be null, in which case images are never drawn.
    D2dPainter(ID2D1RenderTarget* target, Graphics& graphics, ArtworkStore* artwork = nullptr,
               ImageCache* images = nullptr);

    void Clear(ui::Color color) override;
    void FillRoundRect(const ui::Box& box, double radius, ui::Color color) override;
    void StrokeRoundRect(const ui::Box& box, double radius, double width, ui::Color color) override;
    bool Image(const ui::Box& box, const std::string& url, double radius) override;
    bool ImageFaded(const ui::Box& box, const std::string& url, double radius, double opacity, double focusX,
                    double focusY) override;
    void FillPolygon(const std::vector<ui::Point>& points, ui::Color color) override;
    void FillPolygonLinear(const std::vector<ui::Point>& points, double x0, double y0, double x1, double y1,
                           const std::vector<ui::GradientStop>& stops) override;
    void FillLinearGradient(const ui::Box& box, double x0, double y0, double x1, double y1,
                            const std::vector<ui::GradientStop>& stops) override;
    void FillRadialGradient(const ui::Box& box, double cx, double cy, double rx, double ry,
                            const std::vector<ui::GradientStop>& stops) override;
    void Paragraph(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) override;
    void Text(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) override;
    void Path(const ui::Box& box, double viewBox, std::string_view data, const ui::PathStyle& style) override;
    double MeasureText(std::string_view text, const ui::TextStyle& style) override;
    void PushClip(const ui::Box& box) override;
    void PopClip() override;

private:
    ComPtr<ID2D1SolidColorBrush> Brush(ui::Color color);
    ComPtr<ID2D1GradientStopCollection> Stops(const std::vector<ui::GradientStop>& stops);
    // The closed outline through `points`, or nothing when there are fewer than three points.
    ComPtr<ID2D1PathGeometry> Polygon(const std::vector<ui::Point>& points);

    ID2D1RenderTarget* target_;
    Graphics& graphics_;
    ArtworkStore* artwork_;
    ImageCache* images_;
    int clipDepth_ = 0;
};

}  // namespace tvm::platform
