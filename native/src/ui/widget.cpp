#include "ui/widget.h"

#include <algorithm>
#include <cctype>

namespace tvm::ui {

namespace {

// Line height of headings, as a multiple of the font size.
constexpr double kHeadingLineHeight = 1.4;
constexpr double kCardTitleRem = 1.0625;
constexpr double kPosterRadiusRem = 1.125;  // 18px at 1080p (36 Roku canvas units)
constexpr double kRailClipPaddingRem = 1.25;
// The bar showing how much of a title is watched, inset inside the foot of the card.
constexpr double kProgressBarRem = 0.25;
constexpr double kProgressInsetXRem = 1.0;
constexpr double kProgressInsetBottomRem = 0.85;
constexpr Color kProgressTrack = Rgb(0xFFFFFF, 0.26);

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
    // Viewport frustum culling: window height is 67.5rem, so skip sections completely above or below the viewport.
    const double minVisibleY = -metrics.Rem(6.0);
    const double maxVisibleY = metrics.Rem(74.0);
    for (const auto& child : children_) {
        const Box& cb = child->box();
        if (cb.Bottom() < minVisibleY || cb.y > maxVisibleY) continue;
        child->Paint(painter, metrics);
    }
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
    for (const auto& child : children_) {
        const Box& cb = child->box();
        if (cb.Right() < box_.x - pad || cb.x > box_.Right() + pad) continue;
        child->Paint(painter, metrics);
    }
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
    painter.Text(box_, text_, TextStyle{metrics.Rem(sizeRem_), true, 650}, tokens::kText);
}

// ------------------------------------------------------------------- Card

Size Card::Measure(double /*availableWidth*/, const Metrics& metrics) {
    if (logo_) {
        return Size{metrics.Rem(kChannelWidthRem), metrics.Rem(kChannelHeightRem) + metrics.Rem(kCardLabelGapRem) +
                                                       metrics.Rem(kCardLabelHeightRem) * (subtitle_.empty() ? 1.0 : 1.8)};
    }
    if (progress_.has_value()) {
        return Size{metrics.Rem(kLandscapeWidthRem), metrics.Rem(kLandscapeHeightRem)};
    }
    return Size{metrics.Rem(kPosterWidthRem),
                metrics.Rem(kPosterHeightRem) + metrics.Rem(kCardLabelGapRem) + metrics.Rem(kCardLabelHeightRem)};
}

void Card::Arrange(const Box& box, const Metrics& /*metrics*/) {
    box_ = box;
}

void Card::Paint(Painter& painter, const Metrics& metrics) const {
    const double focus = std::clamp(focusAmount_, 0.0, 1.0);
    if (logo_) {
        // The channel tile grows from its foot and lifts as a poster does, over a dark plate that keeps any logo
        // (white, black or coloured) readable, with the existing card glass for its rim and focus.
        const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
        const double artHeight = metrics.Rem(kChannelHeightRem);
        const double scale = 1.0 + (kPosterFocusScale - 1.0) * motionFocus;
        const double width = box_.width * scale;
        const double height = artHeight * scale;
        const double bottom = box_.y + artHeight - metrics.Rem(kPosterLiftRem) * motionFocus;
        const Box tile{box_.CenterX() - width / 2.0, bottom - height, width, height};
        const double radius = metrics.Rem(kPosterRadiusRem);
        painter.FillLinearGradient(tile, tile.x, tile.y, tile.x, tile.Bottom(),
                                   {GradientStop{0.0, Rgb(0x1A2130)}, GradientStop{1.0, Rgb(0x0D121B)}});
        const Box logoBox{tile.x + tile.width * 0.18, tile.y + tile.height * 0.2, tile.width * 0.64, tile.height * 0.6};
        const bool hasLogo = !posterUrl_.empty() && painter.ImageContain(logoBox, posterUrl_);
        if (!hasLogo) {
            // No logo: the channel's initials, large and quiet.
            std::string initials;
            bool start = true;
            for (char c : title_) {
                if (std::isalnum(static_cast<unsigned char>(c)) && start && initials.size() < 3) {
                    initials.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
                }
                start = c == ' ' || c == '-';
            }
            const TextStyle style{metrics.Rem(2.0), true, 800};
            const double textWidth = painter.MeasureText(initials, style);
            painter.Text(Box{tile.CenterX() - textWidth / 2.0, tile.y, textWidth + 4.0, tile.height}, initials, style,
                         Rgb(0xFFFFFF, 0.55));
        }
        GlassStyle glass;
        glass.kind = GlassKind::Card;
        glass.focused = focused_;
        glass.focusAmount = focus;
        glass.reduceTransparency = tokens::reduceTransparency;
        glass.rimOnly = true;
        glass.border = tokens::kBorderSoft;
        glass.ringColor = kPosterRing;
        glass.ringWidth = metrics.Rem(kPosterRingWidthRem);
        glass.ringOutset = metrics.Rem(kPosterRingOffsetRem) + glass.ringWidth / 2.0;
        painter.Glass(tile, radius, glass);
        const Box label{box_.x, box_.y + artHeight + metrics.Rem(kCardLabelGapRem), box_.width,
                        metrics.Rem(kCardLabelHeightRem)};
        painter.Text(label, title_, TextStyle{metrics.Rem(kCardTitleRem), true, 600},
                     Mix(tokens::kTextMuted, tokens::kText, focus));
        if (!subtitle_.empty()) {
            painter.Text(Box{label.x, label.Bottom() - metrics.Rem(0.15), label.width, metrics.Rem(kCardLabelHeightRem) * 0.8},
                         subtitle_, TextStyle{metrics.Rem(kCardTitleRem * 0.82), false, 450}, tokens::kTextFaint);
        }
        return;
    }
    const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
    const bool landscape = progress_.has_value();
    const double artHeight = landscape ? box_.height : metrics.Rem(kPosterHeightRem);
    const double radius = metrics.Rem(kPosterRadiusRem);

    // Focus grows the card by 1.04 from its bottom edge and lifts it 6px (0.375rem at 1080p).
    const double scale = 1.0 + (kPosterFocusScale - 1.0) * motionFocus;
    const double width = box_.width * scale;
    const double height = artHeight * scale;
    const double bottom = box_.y + artHeight - metrics.Rem(kPosterLiftRem) * motionFocus;
    const Box poster{box_.CenterX() - width / 2.0, bottom - height, width, height};

    const bool hasArt = !posterUrl_.empty() && painter.Image(poster, posterUrl_, radius);

    std::uint32_t hash = 2166136261u;
    for (unsigned char c : (title_.empty() ? itemId_ : title_)) {
        hash = (hash ^ c) * 16777619u;
    }
    static constexpr int kCinemaHues[] = {208, 186, 224, 34, 260, 196, 338, 172, 236, 20};

    GlassStyle glass;
    glass.kind = GlassKind::Card;
    glass.focused = focused_;
    glass.focusAmount = focus;
    glass.reduceTransparency = tokens::reduceTransparency;
    glass.rimOnly = hasArt;
    glass.hue = hasArt ? -1 : kCinemaHues[hash % 10];
    glass.tint = Mix(tokens::kSurface, tokens::kSurfaceHover, focus);
    glass.border = tokens::kBorderSoft;
    glass.ringColor = kPosterRing;
    glass.ringWidth = metrics.Rem(kPosterRingWidthRem);
    glass.ringOutset = metrics.Rem(kPosterRingOffsetRem) + glass.ringWidth / 2.0;
    painter.Glass(poster, radius, glass);

    if (progress_.has_value()) {
        // Continue Watching landscape card: title centred on placeholder or over bottom scrim, plus inset progress bar.
        const TextStyle titleStyle{metrics.Rem(1.375), false, 500};
        const double titleWidth = painter.MeasureText(title_, titleStyle);
        if (!hasArt) {
            const double tx = std::max(poster.x + metrics.Rem(1.0), poster.CenterX() - titleWidth / 2.0);
            painter.Text(Box{tx, poster.y, std::max(0.0, poster.Right() - tx - metrics.Rem(1.0)), poster.height * 0.88},
                         title_, titleStyle, Mix(tokens::kTextMuted, tokens::kText, focus));
        } else {
            // Subtle bottom scrim so the progress bar and title remain legible over bright frames.
            const Box scrim{poster.x + 2.0, poster.Bottom() - poster.height * 0.36, poster.width - 4.0,
                            poster.height * 0.36 - 2.0};
            painter.FillLinearGradient(scrim, scrim.x, scrim.y, scrim.x, scrim.Bottom(),
                                       {GradientStop{0.0, Rgb(0x000000, 0.0)},
                                        GradientStop{1.0, Rgb(0x04080E, 0.68)}});
            painter.Text(Box{poster.x + metrics.Rem(kProgressInsetXRem),
                             poster.Bottom() - metrics.Rem(kProgressInsetBottomRem + 2.1),
                             poster.width - 2.0 * metrics.Rem(kProgressInsetXRem), metrics.Rem(1.6)},
                         title_, TextStyle{metrics.Rem(1.125), true, 600}, Rgb(0xF5F7FA, 0.92));
        }
        const double barHeight = metrics.Rem(kProgressBarRem);
        const double insetX = metrics.Rem(kProgressInsetXRem);
        const double insetBottom = metrics.Rem(kProgressInsetBottomRem);
        const Box track{poster.x + insetX, poster.Bottom() - insetBottom - barHeight,
                        std::max(0.0, poster.width - 2.0 * insetX), barHeight};
        painter.FillRoundRect(track, barHeight / 2.0, kProgressTrack);
        const double watched = std::clamp(*progress_, 0.0, 1.0);
        if (watched > 0.0) {
            painter.FillRoundRect(Box{track.x, track.y, track.width * watched, track.height}, barHeight / 2.0,
                                  Rgb(0xF5F7FA, 0.96));
        }
        return;
    }

    const Box label{box_.x, box_.y + artHeight + metrics.Rem(kCardLabelGapRem), box_.width,
                    metrics.Rem(kCardLabelHeightRem)};
    painter.Text(label, title_, TextStyle{metrics.Rem(kCardTitleRem), false},
                 Mix(tokens::kTextMuted, tokens::kText, focus));
}

void DrawButton(Painter& painter, const Metrics& metrics, const Box& box, const std::string& label, const ButtonLook& look) {
    // The button scales about its centre (1.06 on focus), and its glass rim and outer glow wrap the scaled shape.
    const double focus = std::clamp(look.focusAmount, 0.0, 1.0);
    const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
    const double scale = 1.0 + (kFocusScale - 1.0) * motionFocus;
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

    GlassStyle glass;
    glass.kind = GlassKind::Pill;
    glass.focused = look.focused;
    glass.activeTab = look.primary;
    glass.focusAmount = focus;
    glass.reduceTransparency = tokens::reduceTransparency;
    glass.tint = fill;
    glass.ringWidth = metrics.Rem(kFocusRingWidthRem);
    glass.ringOutset = metrics.Rem(kFocusRingOffsetRem) + glass.ringWidth / 2.0;
    glass.ringColor = tokens::kFocusRing;
    painter.Glass(shape, radius, glass);

    const double pad = metrics.Rem(kButtonPadRem);
    painter.Text(Box{shape.x + pad, shape.y, shape.width - 2.0 * pad, shape.height}, label,
                 TextStyle{metrics.Rem(kButtonLabelRem), true}, look.primary ? tokens::kOnPrimary : tokens::kText);
}

}  // namespace tvm::ui
