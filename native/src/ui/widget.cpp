#include "ui/widget.h"

#include <algorithm>

namespace tvm::ui {

namespace {

// Line height of headings, as a multiple of the font size.
constexpr double kHeadingLineHeight = 1.4;
constexpr double kCardTitleRem = 1.0625;
constexpr double kPosterRadiusRem = 0.875;
constexpr double kRailClipPaddingRem = 0.875;
// The bar showing how much of a title is watched, along the foot of the poster.
constexpr double kProgressBarRem = 0.25;
constexpr Color kProgressTrack = Rgb(0x000000, 0.6);

}  // namespace

// ------------------------------------------------------------------ Stack

void Stack::Add(std::unique_ptr<Widget> child) {
    children_.push_back(std::move(child));
}

Size Stack::Measure(double availableWidth, const Metrics& metrics) {
    desired_.clear();
    double height = 0.0;
    for (const auto& child : children_) {
        const Size size = child->Measure(availableWidth, metrics);
        desired_.push_back(size);
        height += size.height;
    }
    if (!children_.empty()) height += metrics.Rem(spacingRem_) * static_cast<double>(children_.size() - 1);
    return Size{availableWidth, height};
}

void Stack::Arrange(const Box& box, const Metrics& metrics) {
    box_ = box;
    double y = box.y;
    for (std::size_t i = 0; i < children_.size(); ++i) {
        const Size& size = desired_.at(i);
        children_[i]->Arrange(Box{box.x, y, box.width, size.height}, metrics);
        y += size.height + metrics.Rem(spacingRem_);
    }
}

void Stack::Paint(Painter& painter, const Metrics& metrics) const {
    for (const auto& child : children_) child->Paint(painter, metrics);
}

// ------------------------------------------------------------------- Rail

void Rail::Add(std::unique_ptr<Widget> child) {
    children_.push_back(std::move(child));
}

double Rail::MaxScroll() const {
    return std::max(0.0, contentWidth_ - box_.width);
}

Size Rail::Measure(double availableWidth, const Metrics& metrics) {
    desired_.clear();
    double tallest = 0.0;
    for (const auto& child : children_) {
        const Size size = child->Measure(availableWidth, metrics);
        desired_.push_back(size);
        tallest = std::max(tallest, size.height);
    }
    return Size{availableWidth, tallest};
}

void Rail::Arrange(const Box& box, const Metrics& metrics) {
    box_ = box;

    contentLeft_.clear();
    double cursor = metrics.Rem(insetRem_);
    for (const Size& size : desired_) {
        contentLeft_.push_back(cursor);
        cursor += size.width + metrics.Rem(spacingRem_);
    }
    contentWidth_ = children_.empty() ? 0.0 : cursor - metrics.Rem(spacingRem_) + metrics.Rem(insetRem_);

    scrollX_ = std::clamp(scrollX_, 0.0, MaxScroll());
    for (std::size_t i = 0; i < children_.size(); ++i) {
        const Size& size = desired_.at(i);
        children_[i]->Arrange(Box{box.x + contentLeft_[i] - scrollX_, box.y, size.width, size.height}, metrics);
    }
}

void Rail::Paint(Painter& painter, const Metrics& metrics) const {
    // The clip is the rail's width, but taller: the focused poster grows and
    // its ring sits just outside it, and neither may be cut off.
    const double pad = metrics.Rem(kRailClipPaddingRem);
    painter.PushClip(Box{box_.x, box_.y - pad, box_.width, box_.height + 2.0 * pad});
    for (const auto& child : children_) child->Paint(painter, metrics);
    painter.PopClip();
}

// ---------------------------------------------------------------- Heading

Size Heading::Measure(double availableWidth, const Metrics& metrics) {
    return Size{availableWidth, metrics.Rem(sizeRem_) * kHeadingLineHeight};
}

void Heading::Arrange(const Box& box, const Metrics& /*metrics*/) {
    box_ = box;
}

void Heading::Paint(Painter& painter, const Metrics& metrics) const {
    painter.Text(box_, text_, TextStyle{metrics.Rem(sizeRem_), true}, tokens::kText);
}

// ------------------------------------------------------------------- Card

Size Card::Measure(double /*availableWidth*/, const Metrics& metrics) {
    return Size{metrics.Rem(kPosterWidthRem),
                metrics.Rem(kPosterHeightRem) + metrics.Rem(kCardLabelGapRem) + metrics.Rem(kCardLabelHeightRem)};
}

void Card::Arrange(const Box& box, const Metrics& /*metrics*/) {
    box_ = box;
}

void Card::Paint(Painter& painter, const Metrics& metrics) const {
    const double focus = std::clamp(focusAmount_, 0.0, 1.0);
    const double posterHeight = metrics.Rem(kPosterHeightRem);
    const double radius = metrics.Rem(kPosterRadiusRem);

    // Focus grows the poster from its bottom edge and lifts it, as the web poster's transform does.
    const double scale = 1.0 + (kPosterFocusScale - 1.0) * focus;
    const double width = box_.width * scale;
    const double height = posterHeight * scale;
    const double bottom = box_.y + posterHeight - metrics.Rem(kPosterLiftRem) * focus;
    const Box poster{box_.CenterX() - width / 2.0, bottom - height, width, height};

    // The artwork covers the poster when it is loaded. Until then the poster is a placeholder.
    if (posterUrl_.empty() || !painter.Image(poster, posterUrl_, radius)) {
        painter.FillRoundRect(poster, radius, Mix(tokens::kSurface, tokens::kSurfaceHover, focus));
    }
    painter.StrokeRoundRect(poster, radius, 1.0, tokens::kBorderSoft);

    if (progress_.has_value()) {
        const double barHeight = metrics.Rem(kProgressBarRem);
        const Box track{poster.x, poster.Bottom() - barHeight, poster.width, barHeight};
        painter.FillRoundRect(track, 0.0, kProgressTrack);
        const double watched = std::clamp(*progress_, 0.0, 1.0);
        painter.FillRoundRect(Box{track.x, track.y, track.width * watched, track.height}, 0.0, tokens::kText);
    }

    // The outline is not eased: it is there as soon as the card has focus.
    if (focused_) {
        const double ringWidth = metrics.Rem(kPosterRingWidthRem);
        const double outset = metrics.Rem(kPosterRingOffsetRem) + ringWidth / 2.0;
        const Box ring{poster.x - outset, poster.y - outset, poster.width + 2.0 * outset, poster.height + 2.0 * outset};
        painter.StrokeRoundRect(ring, radius + outset, ringWidth, kPosterRing);
    }

    const Box label{box_.x, box_.y + posterHeight + metrics.Rem(kCardLabelGapRem), box_.width,
                    metrics.Rem(kCardLabelHeightRem)};
    painter.Text(label, title_, TextStyle{metrics.Rem(kCardTitleRem), false}, Mix(tokens::kTextMuted, tokens::kText, focus));
}

void DrawButton(Painter& painter, const Metrics& metrics, const Box& box, const std::string& label, const ButtonLook& look) {
    // The button scales about its centre, and its ring goes round the scaled shape, as the
    // web outline does, since the outline is part of the element the transform moves.
    const double focus = std::clamp(look.focusAmount, 0.0, 1.0);
    const double scale = 1.0 + (kFocusScale - 1.0) * focus;
    const double width = box.width * scale;
    const double height = box.height * scale;
    const Box shape{box.CenterX() - width / 2.0, box.CenterY() - height / 2.0, width, height};
    const double radius = shape.height / 2.0;

    Color fill = tokens::kSurface;
    if (look.primary) {
        fill = tokens::kPrimary;
    } else if (look.focused) {
        fill = tokens::kSurfaceHover;
    }
    painter.FillRoundRect(shape, radius, fill);

    if (look.focused) {
        const double ringWidth = metrics.Rem(kFocusRingWidthRem);
        const double outset = metrics.Rem(kFocusRingOffsetRem) + ringWidth / 2.0;
        const Box ring{shape.x - outset, shape.y - outset, shape.width + 2.0 * outset, shape.height + 2.0 * outset};
        painter.StrokeRoundRect(ring, radius + outset, ringWidth, tokens::kFocusRing);
    }

    const double pad = metrics.Rem(kButtonPadRem);
    painter.Text(Box{shape.x + pad, shape.y, shape.width - 2.0 * pad, shape.height}, label,
                 TextStyle{metrics.Rem(kButtonLabelRem), true}, look.primary ? tokens::kOnPrimary : tokens::kText);
}

}  // namespace tvm::ui
