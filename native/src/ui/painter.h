#pragma once

// The drawing surface the widget tree paints onto. The widget code only sees
// this interface, so it can be tested with a recording painter and drawn with
// Direct2D on screen or into a PNG.

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace tvm::ui {

struct Color {
    double r = 0.0;
    double g = 0.0;
    double b = 0.0;
    double a = 1.0;
};

// 0xRRGGBB, the notation the design tokens use.
constexpr Color Rgb(std::uint32_t hex, double alpha = 1.0) {
    return Color{((hex >> 16) & 0xFF) / 255.0, ((hex >> 8) & 0xFF) / 255.0, (hex & 0xFF) / 255.0, alpha};
}

// Linear blend between two colours, `t` in [0, 1].
constexpr Color Mix(const Color& from, const Color& to, double t) {
    return Color{from.r + (to.r - from.r) * t, from.g + (to.g - from.g) * t, from.b + (to.b - from.b) * t,
                 from.a + (to.a - from.a) * t};
}

// One colour of a gradient. `position` runs from 0 at the start of the gradient to 1 at its end.
struct GradientStop {
    double position = 0.0;
    Color color;
};

// A point in window pixels.
struct Point {
    double x = 0.0;
    double y = 0.0;
};

// Pixels, with the origin at the top left of the window.
struct Box {
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;

    double Right() const { return x + width; }
    double Bottom() const { return y + height; }
    double CenterX() const { return x + width / 2.0; }
    double CenterY() const { return y + height / 2.0; }
};

struct TextStyle {
    double sizePx = 16.0;
    bool bold = false;
    // A font weight such as the sting's 750 or 800. Zero means the weight `bold` picks.
    int weight = 0;
};

// How a vector glyph is drawn. A colour with no alpha draws nothing, so a glyph can be filled, stroked or both.
struct PathStyle {
    Color fill{0.0, 0.0, 0.0, 0.0};
    Color stroke{0.0, 0.0, 0.0, 0.0};
    // In the path's own units, as an SVG's stroke-width is. Ends and joins are round.
    double strokeWidth = 0.0;
    // Flipped left to right, as `scale(-1 1)` flips the web's forward glyph.
    bool mirror = false;
};

class Painter {
public:
    virtual ~Painter() = default;

    // SVG path data (M, L, H, V, A and Z, absolute or relative) in a square of `viewBox` units, drawn
    // scaled into `box`. The old app's icons are drawn from their own path data this way.
    virtual void Path(const Box& /*box*/, double /*viewBox*/, std::string_view /*data*/, const PathStyle& /*style*/) {}

    // The width of one line of text, in pixels. A painter that cannot measure estimates from the length.
    virtual double MeasureText(std::string_view text, const TextStyle& style) {
        return static_cast<double>(text.size()) * 0.56 * style.sizePx;
    }

    virtual void Clear(Color color) = 0;
    virtual void FillRoundRect(const Box& box, double radius, Color color) = 0;
    virtual void StrokeRoundRect(const Box& box, double radius, double width, Color color) = 0;

    // Draws the image at `url`, cover-fitted to `box` with rounded corners.
    // Returns false when the image is not available yet, so the caller can draw
    // its placeholder instead.
    virtual bool Image(const Box& box, const std::string& url, double radius) = 0;

    // The same picture at an opacity from 0 to 1. The focal point (focusX, focusY), from 0 to 1 across
    // the spare room, sets which part of the picture stays in view when it is cropped to `box`.
    // A painter that cannot fade a picture draws it at full strength.
    virtual bool ImageFaded(const Box& box, const std::string& url, double radius, double /*opacity*/,
                            double /*focusX*/, double /*focusY*/) {
        return Image(box, url, radius);
    }

    // Fills the box with a gradient along the line from (x0, y0) to (x1, y1), in window pixels.
    virtual void FillLinearGradient(const Box& /*box*/, double /*x0*/, double /*y0*/, double /*x1*/, double /*y1*/,
                                    const std::vector<GradientStop>& /*stops*/) {}

    // Fills the box with an ellipse gradient: the first stop at (cx, cy), and the last at the radii rx and ry.
    virtual void FillRadialGradient(const Box& /*box*/, double /*cx*/, double /*cy*/, double /*rx*/, double /*ry*/,
                                    const std::vector<GradientStop>& /*stops*/) {}

    // Fills the polygon through `points`, in order, with a colour.
    virtual void FillPolygon(const std::vector<Point>& /*points*/, Color /*color*/) {}

    // Fills the polygon through `points` with a gradient along the line from (x0, y0) to (x1, y1).
    virtual void FillPolygonLinear(const std::vector<Point>& /*points*/, double /*x0*/, double /*y0*/, double /*x1*/,
                                   double /*y1*/, const std::vector<GradientStop>& /*stops*/) {}

    // Several lines of text, wrapped to the width of `box` and clipped to its height.
    virtual void Paragraph(const Box& box, std::string_view text, const TextStyle& style, Color color) = 0;

    // One line of UTF-8 text, left aligned and vertically centred in `box`,
    // ellipsised when it does not fit.
    virtual void Text(const Box& box, std::string_view text, const TextStyle& style, Color color) = 0;

    virtual void PushClip(const Box& box) = 0;
    virtual void PopClip() = 0;
};

}  // namespace tvm::ui
