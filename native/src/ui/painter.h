#pragma once

// The drawing surface the widget tree paints onto. The widget code only sees
// this interface, so it can be tested with a recording painter and drawn with
// Direct2D on screen or into a PNG.

#include <cstdint>
#include <optional>
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
    double trackingEm = 0.0;
    bool tabular = false;
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

enum class GlassKind {
    Panel,
    Pill,
    Tab,
    Card,
    Orb,
};

// Material and interaction state for an optical glass surface.
struct GlassStyle {
    GlassKind kind = GlassKind::Pill;
    bool focused = false;
    bool activeTab = false;
    bool selected = false;
    bool pressed = false;
    bool disabled = false;
    bool reduceTransparency = false;
    bool warm = false;
    bool rimOnly = false;
    bool solid = false;
    // The caller reads GlassInk immediately after drawing this surface.
    bool adaptiveInk = false;
    // Legacy sheet callers request the larger sheet's diffusion radius.
    bool frosted = false;
    // Hover or focus emphasis and press depth, each eased from 0 to 1 by callers that animate them. A bool
    // `focused` or `pressed` with a zero amount counts as fully on.
    double focusAmount = 0.0;
    double pressAmount = 0.0;
    double opacity = 1.0;
    // Apple TV's focus: as `focusAmount` rises the surface becomes a near-white plate, so its label should turn
    // dark by the same amount. Off for glass whose labels stay light, such as menu rows.
    bool focusPlate = false;
    // A soft highlight sweeping once across a newly focused surface, from 0 (entering at the left) to 1 (gone
    // at the right). Negative for none.
    double sweep = -1.0;
    int hue = -1;
    std::optional<Color> tint;
    std::optional<Color> border;
    std::optional<Color> ringColor;
    double ringWidth = 0.0;
    double ringOutset = 0.0;
};

class Painter {
public:
    virtual ~Painter() = default;

    // Sets the current full-bleed hero/backdrop image and its screen box so Glass() surfaces
    // can sample and Gaussian-blur the region beneath them.
    virtual void SetBackdrop(const Box& /*box*/, const std::string& /*url*/, double /*focusX*/ = 0.7,
                             double /*focusY*/ = 0.2) {}

    // Draws a layered optical glass surface in `box` with corner `radius`.
    // Test painters that do not override Glass receive the equivalent fill and focus/border strokes.
    virtual void Glass(const Box& box, double radius, const GlassStyle& style = {}) {
        const Color fill = style.tint.value_or(Color{0.10, 0.16, 0.24, style.focused ? 0.45 : 0.28});
        if (!style.rimOnly) FillRoundRect(box, radius, fill);
        if (style.kind == GlassKind::Card && !style.focused) {
            StrokeRoundRect(box, radius, 1.0, style.border.value_or(Color{1.0, 1.0, 1.0, 0.16}));
        }
        if (style.focused) {
            const double width = style.ringWidth > 0.0 ? style.ringWidth : 2.56;
            const double outset = style.ringOutset;
            const Box ring{box.x - outset, box.y - outset, box.width + 2.0 * outset, box.height + 2.0 * outset};
            StrokeRoundRect(ring, radius + outset, width, style.ringColor.value_or(Color{0.96, 0.97, 0.99, 0.95}));
        }
    }

    // SVG path data (M, L, H, V, A and Z, absolute or relative) in a square of `viewBox` units, drawn
    // scaled into `box`. The old app's icons are drawn from their own path data this way.
    virtual void Path(const Box& /*box*/, double /*viewBox*/, std::string_view /*data*/, const PathStyle& /*style*/) {}

    // The width of one line of text, in pixels. A painter that cannot measure estimates from the length.
    virtual double MeasureText(std::string_view text, const TextStyle& style) {
        return static_cast<double>(text.size()) * 0.56 * style.sizePx;
    }

    virtual Color GlassInk(Color fallback) const { return fallback; }
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

    // The whole picture, scaled to fit inside `box` and centred, as a logo is shown. A painter that cannot fit a
    // picture draws it as Image does.
    virtual bool ImageContain(const Box& box, const std::string& url) { return Image(box, url, 0.0); }

    virtual bool HeroVideo(const Box& /*box*/, double /*opacity*/, double /*focusX*/, double /*focusY*/) { return false; }

    virtual bool SpotlightLogo(const Box& box, const std::string& url, double /*opacity*/, double /*blur*/,
                               double /*sweep*/) { return ImageContain(box, url); }

    virtual void BeginLightParticles() {}
    virtual void EndLightParticles() {}

    // Fills the box with a gradient along the line from (x0, y0) to (x1, y1), in window pixels.
    virtual void FillLinearGradient(const Box& /*box*/, double /*x0*/, double /*y0*/, double /*x1*/, double /*y1*/,
                                    const std::vector<GradientStop>& /*stops*/) {}

    // Fills the box with an ellipse gradient: the first stop at (cx, cy), and the last at the radii rx and ry.
    virtual void FillRadialGradient(const Box& /*box*/, double /*cx*/, double /*cy*/, double /*rx*/, double /*ry*/,
                                    const std::vector<GradientStop>& /*stops*/) {}

    // Fills a rounded rectangle with a gradient along the line from (x0, y0) to (x1, y1). Overlays on rounded
    // artwork use it so no corner of the overlay pokes out past the artwork's curve.
    virtual void FillRoundRectLinear(const Box& box, double /*radius*/, double x0, double y0, double x1, double y1,
                                     const std::vector<GradientStop>& stops) {
        FillLinearGradient(box, x0, y0, x1, y1, stops);
    }

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

    // Clips to a band `width` wide along the open line through `points`, with round ends and joins. Pair it with
    // PopClip. A painter without shaped clips clips to the band's bounds.
    virtual void PushClipStroke(const std::vector<Point>& points, double width) { PushClip(BoundsOf(points, width / 2.0)); }
    // Clips to the union of closed polygons. Pair it with PopClip.
    virtual void PushClipPolygons(const std::vector<std::vector<Point>>& polygons) {
        std::vector<Point> all;
        for (const std::vector<Point>& polygon : polygons) all.insert(all.end(), polygon.begin(), polygon.end());
        PushClip(BoundsOf(all, 0.0));
    }
    // Strokes the line through `points` (closed back to its start when `closed`), with round ends and joins.
    virtual void StrokePolyline(const std::vector<Point>& /*points*/, double /*width*/, Color /*color*/,
                                bool /*closed*/ = false) {}
    // Everything drawn until PopOpacity is composited at `opacity`, as one layer.
    virtual void PushOpacity(double /*opacity*/) {}
    virtual void PopOpacity() {}
    // Like PushOpacity, but the opacity runs from `topAlpha` at y0 to `bottomAlpha` at y1 (held beyond), so what is
    // drawn until PopOpacity fades out down the page and whatever lies under it shows through: a crossfade.
    // Everything drawn until PopTranslate is moved by (dx, dy).
    virtual void PushTranslate(double /*dx*/, double /*dy*/) {}
    virtual void PopTranslate() {}
    virtual void PushLinearOpacity(double /*y0*/, double /*y1*/, double /*topAlpha*/, double /*bottomAlpha*/) {}

protected:
    static Box BoundsOf(const std::vector<Point>& points, double pad) {
        if (points.empty()) return Box{0.0, 0.0, 0.0, 0.0};
        double left = points[0].x, top = points[0].y, right = left, bottom = top;
        for (const Point& point : points) {
            left = point.x < left ? point.x : left;
            top = point.y < top ? point.y : top;
            right = point.x > right ? point.x : right;
            bottom = point.y > bottom ? point.y : bottom;
        }
        return Box{left - pad, top - pad, right - left + 2.0 * pad, bottom - top + 2.0 * pad};
    }
};

}  // namespace tvm::ui
