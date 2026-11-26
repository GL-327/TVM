#include "ui/controls.h"

#include <algorithm>

namespace tvm::ui::controls {

namespace {
Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}
}  // namespace

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
                    bool focused, double rem) {
    painter.FillRoundRect(track, 0.75 * rem, WithAlpha(tokens::kText, 0.08));
    if (selected < labels.size()) {
        const Box seg = SegmentBox(track, labels.size(), selected);
        painter.FillRoundRect(seg, 0.6 * rem, tokens::kAccentStrong);
    }
    for (std::size_t i = 0; i < labels.size(); ++i) {
        const Box seg = SegmentBox(track, labels.size(), i);
        const TextStyle style{0.875 * rem, true, 600};
        const double textWidth = painter.MeasureText(labels[i], style);
        painter.Text(Box{seg.CenterX() - textWidth / 2.0 - 1.0, seg.y, textWidth + 4.0, seg.height}, labels[i], style,
                     i == selected ? tokens::kAccentInk : tokens::kTextMuted);
    }
    if (focused) painter.StrokeRoundRect(track, 0.75 * rem, 2.0, tokens::kFocusRing);
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
