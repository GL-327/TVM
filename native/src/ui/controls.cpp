#include "ui/controls.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <numbers>

#include "motion/easing.h"
#include "ui/glass_styles.h"
#include "ui/layout.h"

namespace tvm::ui::controls {

namespace {
Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}
}  // namespace

Box BackButtonBox(double width, double height) {
    const double rem = ViewportRem(width, height);
    const double side = std::max(44.0, 2.75 * rem);
    return {rem, 0.5 * rem, side, side};
}

void PaintBackButton(Painter& painter, const Box& box, bool focused) {
    auto material = focused ? glass::NavSelected() : glass::NavCapsule();
    material.adaptiveInk = true;
    painter.Glass(box, box.height / 2.0, material);
    const double inset = box.width * 0.24;
    painter.Path({box.x + inset, box.y + inset, box.width - 2.0 * inset, box.height - 2.0 * inset}, 24.0,
                 "M15 5l-7 7 7 7", {Rgb(0, 0.0), painter.GlassInk(tokens::kText), 2.3, false});
}

void PaintFrameMeter(Painter& painter, double width, double height, double frameMs) {
    char line[64] = "Measuring FPS";
    if (frameMs > 0.0) std::snprintf(line, sizeof(line), "%.0f FPS   %.1f ms", 1000.0 / frameMs, frameMs);
    const double rem = ViewportRem(width, height);
    const TextStyle style{0.78 * rem, false, 600, 0.0, true};
    const double w = painter.MeasureText(line, style) + 1.25 * rem;
    const Box box{width - w - 0.8 * rem, 0.55 * rem, w, 1.65 * rem};
    painter.FillRoundRect(box, 0.38 * rem, Rgb(0x12141A, 0.92));
    painter.StrokeRoundRect(box, 0.38 * rem, 1.0, Rgb(0xFFFFFF, 0.20));
    painter.Text({box.x + 0.625 * rem, box.y, box.width - 0.85 * rem, box.height}, line, style, Rgb(0xF5F7FA));
}

Box SwitchBox(double right, double centerY, double rem) {
    const double width = 2.875 * rem;
    const double height = 1.75 * rem;
    return Box{right - width, centerY - height / 2.0, width, height};
}

void PaintSwitch(Painter& painter, const Box& box, bool on, bool focused) {
    painter.FillRoundRect(box, box.height / 2.0, on ? tokens::kAccentStrong : WithAlpha(tokens::kText, 0.20));
    const double pad = box.height * 0.1;
    const double knob = box.height - 2.0 * pad;
    const double x = on ? box.Right() - pad - knob : box.x + pad;
    painter.FillRoundRect(Box{x, box.y + pad + 1.0, knob, knob}, knob / 2.0, Rgb(0x000000, 0.22));
    painter.FillRoundRect(Box{x, box.y + pad, knob, knob}, knob / 2.0, Rgb(0xFFFFFF));
    if (focused) {
        painter.StrokeRoundRect(Box{box.x - 2.0, box.y - 2.0, box.width + 4.0, box.height + 4.0}, box.height / 2.0 + 2.0, 2.0,
                                tokens::kFocusRing);
    }
}

Box DropletBox(const Box& from, const Box& to, double elapsedMs) {
    if (elapsedMs >= kDropletMs) return to;
    const double t = std::clamp(motion::SpringProgress(std::max(elapsedMs, 0.0)), 0.0, 1.0);
    const double width = std::lerp(from.width, to.width, t);
    const double travel = std::abs(to.CenterX() - from.CenterX());
    const double stretch = std::min(width * 0.25, travel * 0.30) * std::sin(std::numbers::pi * t);
    const double height = std::lerp(from.height, to.height, t);
    const double squash = height * 0.07 * std::sin(std::numbers::pi * t);
    return {std::lerp(from.x, to.x, t) - stretch / 2.0, std::lerp(from.y, to.y, t) + squash / 2.0,
            width + stretch, height - squash};
}

double SegmentedWidth(const std::vector<std::string>& labels, double rem) {
    // Estimated from the longest label, so painting and hit-testing agree without a text measurer.
    std::size_t longest = 0;
    for (const std::string& label : labels) longest = std::max(longest, label.size());
    return (static_cast<double>(longest) * 0.58 * 0.875 * rem + 1.8 * rem) * static_cast<double>(labels.size()) + 0.5 * rem;
}

Box SegmentedBox(const std::vector<std::string>& labels, double right, double centerY, double rem) {
    const double width = SegmentedWidth(labels, rem);
    const double height = 2.5 * rem;
    return Box{right - width, centerY - height / 2.0, width, height};
}

Box SegmentBox(const Box& track, std::size_t count, std::size_t index) {
    const double pad = track.height * 0.1;
    const double each = (track.width - 2.0 * pad) / static_cast<double>(std::max<std::size_t>(count, 1));
    return Box{track.x + pad + each * static_cast<double>(index), track.y + pad, each, track.height - 2.0 * pad};
}

std::optional<std::size_t> SegmentAt(const Box& track, std::size_t count, double x, double y) {
    if (x < track.x || x >= track.Right() || y < track.y || y >= track.Bottom() || count == 0) return std::nullopt;
    for (std::size_t i = 0; i < count; ++i) {
        const Box box = SegmentBox(track, count, i);
        if (x < box.Right() || i + 1 == count) return i;
    }
    return std::nullopt;
}

void PaintSegmented(Painter& painter, const Box& track, const std::vector<std::string>& labels, std::size_t selected,
                    bool focused, double rem, std::optional<SegmentChange> change) {
    auto material = glass::NavCapsule();
    material.tint = tokens::kSurfaceHover;
    material.adaptiveInk = true;
    painter.Glass(track, 0.75 * rem, material);
    const Color trackInk = painter.GlassInk(tokens::kText);
    const auto paintDroplet = [&](const Box& box, double opacity) {
        GlassStyle style;
        style.kind = GlassKind::Tab;
        style.activeTab = true;
        style.opacity = opacity;
        painter.Glass(box, 0.6 * rem, style);
    };
    Box thumb{};
    double fade = 1.0;
    if (selected < labels.size()) {
        thumb = SegmentBox(track, labels.size(), selected);
        if (change && change->from < labels.size()) {
            const Box from = SegmentBox(track, labels.size(), change->from);
            if (tokens::reduceMotion) {
                fade = std::clamp(change->elapsedMs / kDropletFadeMs, 0.0, 1.0);
                paintDroplet(from, 1.0 - fade);
            } else {
                thumb = DropletBox(from, thumb, change->elapsedMs);
            }
        }
        paintDroplet(thumb, fade);
    }
    for (std::size_t i = 0; i < labels.size(); ++i) {
        const Box seg = SegmentBox(track, labels.size(), i);
        const TextStyle style{0.875 * rem, true, 600};
        const double textWidth = painter.MeasureText(labels[i], style);
        const bool onThumb = change && tokens::reduceMotion
                                 ? (fade >= 0.5 ? i == selected : i == change->from)
                                 : seg.CenterX() >= thumb.x && seg.CenterX() < thumb.Right();
        painter.Text(Box{seg.CenterX() - textWidth / 2.0 - 1.0, seg.y, textWidth + 4.0, seg.height}, labels[i], style,
                     onThumb ? Rgb(0x111318) : trackInk);
    }
    if (focused) painter.StrokeRoundRect(track, 0.75 * rem, 2.0, tokens::kFocusRing);
}

Box SliderBox(double right, double centerY, double rem) {
    return {right - 12.0 * rem, centerY - rem, 12.0 * rem, 2.0 * rem};
}

double SliderRatio(const Box& box, double x, double rem) {
    return std::clamp((x - box.x) / std::max(1.0, box.width - 3.8 * rem), 0.0, 1.0);
}

void PaintSlider(Painter& painter, const Box& box, double ratio, const std::string& value, double rem) {
    const double width = box.width - 3.8 * rem;
    const double thickness = 0.25 * rem;
    const double y = box.CenterY() - thickness / 2.0;
    painter.FillRoundRect({box.x, y, width, thickness}, thickness / 2.0, WithAlpha(tokens::kText, 0.18));
    painter.FillRoundRect({box.x, y, width * ratio, thickness}, thickness / 2.0, tokens::kAccentStrong);
    const double radius = 0.5625 * rem;
    painter.FillRoundRect({box.x + width * ratio - radius, box.CenterY() - radius, 2.0 * radius, 2.0 * radius},
                          radius, tokens::kAccentStrong);
    painter.Text({box.Right() - 2.85 * rem, box.y, 2.85 * rem, box.height}, value, type::Label(rem), tokens::kText);
}

void PaintTextField(Painter& painter, const Box& box, const std::string& text, bool focused, bool selected, double rem) {
    painter.FillRoundRect(box, 0.75 * rem, tokens::kSurfaceHover);
    if (focused) painter.StrokeRoundRect(box, 0.75 * rem, 2.0, tokens::kFocusRing);
    const Box label{box.x + 0.75 * rem, box.y, box.width - 1.5 * rem, box.height};
    if (selected) {
        const double w = std::min(label.width, painter.MeasureText(text, type::Body(rem)) + 2.0);
        painter.FillRoundRect({label.x, label.y + 0.45 * rem, w, label.height - 0.9 * rem}, 2.0,
                              WithAlpha(tokens::kAccentStrong, 0.25));
    }
    painter.Text(label, text, type::Body(rem), focused ? tokens::kText : tokens::kTextMuted);
}

double PaintValueChevron(Painter& painter, double right, const Box& row, const std::string& value, bool focused, double rem, bool forward) {
    const double chev = 0.8 * rem;
    painter.Path(Box{right - chev, row.CenterY() - chev / 2.0, chev, chev}, 24.0, forward ? "M9 6l6 6-6 6" : "M6 9l6 6 6-6",
                 PathStyle{Color{0, 0, 0, 0}, focused ? tokens::kText : tokens::kTextMuted, 2.4, false});
    double x = right - chev - 0.5 * rem;
    if (!value.empty()) {
        const TextStyle style{0.9375 * rem, true, 600};
        const double width = painter.MeasureText(value, style);
        painter.Text(Box{x - width, row.y, width + 2.0, row.height}, value, style,
                     focused ? tokens::kText : tokens::kTextMuted);
        x -= width;
    }
    return x;
}

}  // namespace tvm::ui::controls
