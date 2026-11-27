#include "ui/widget.h"

#include "ui/glass_styles.h"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace tvm::ui {

namespace {

// Line height of headings, as a multiple of the font size.
constexpr double kHeadingLineHeight = 1.4;
constexpr double kCardTitleRem = 1.0625;
constexpr double kPosterRadiusRem = 0.75;
constexpr double kLandscapeRadiusRem = 0.875;
constexpr double kRailClipPaddingRem = 2.5;
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

void Rail::Add(std::unique_ptr<Card> child) {
    children_.push_back(std::move(child));
}

double Rail::MaxScroll() const {
    return loop_ && !children_.empty() ? kRingOrigin * 2.0 : std::max(0.0, contentWidth_ - box_.width);
}

double Rail::Period() const {
    if (desired_.empty()) return 0.0;
    return contentWidth_ - 2.0 * (contentLeft_.empty() ? 0.0 : contentLeft_.front()) +
           (desired_.size() > 1 ? contentLeft_[1] - contentLeft_[0] - desired_[0].width : box_.height * 0.06);
}
double Rail::ContentLeftOf(Slot slot) const {
    const double base = contentLeft_.at(slot.index);
    return loop_ && Period() > 0.0 ? base + kRingOrigin + static_cast<double>(slot.turn) * Period() : base;
}

Rail::Slot Rail::NearestSlot(std::size_t index, std::optional<double> anchor) const {
    if (!loop_ || Period() <= 0.0) return {index, 0};
    const double centre = anchor.value_or(scrollX_ + box_.width / 2.0);
    const double baseCentre = contentLeft_.at(index) + kRingOrigin + desired_.at(index).width / 2.0;
    return {index, std::llround((centre - baseCentre) / Period())};
}

double Rail::ContentLeftOf(std::size_t index) const {
    return ContentLeftOf(NearestSlot(index));
}

std::optional<Rail::Slot> Rail::SlotAt(double x) const {
    const double position = x - box_.x + scrollX_;
    const double period = Period();
    const bool loops = loop_ && period > 0.0;
    for (std::size_t i = 0; i < children_.size(); ++i) {
        const double relative = position - contentLeft_[i] - (loops ? kRingOrigin : 0.0);
        const auto turn = loops ? static_cast<std::int64_t>(std::floor(relative / period)) : 0;
        const double local = relative - static_cast<double>(turn) * period;
        if (local >= 0.0 && local < desired_[i].width) return Slot{i, turn};
    }
    return std::nullopt;
}

std::optional<std::size_t> Rail::IndexAt(double x) const {
    const auto slot = SlotAt(x);
    return slot ? std::optional(slot->index) : std::nullopt;
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
        children_[i]->Arrange(Box{box.x + ContentLeftOf(i) - scrollX_, box.y, size.width, size.height}, metrics);
    }
}

void Rail::Paint(Painter& painter, const Metrics& metrics) const {
    const double pad = metrics.Rem(kRailClipPaddingRem);
    const Box painted{box_.x - pad, box_.y - pad, box_.width + 2.0 * pad, box_.height + 2.0 * pad};
    painter.PushClip(painted);
    const double period = Period();
    const bool loops = loop_ && period > 0.0;
    std::optional<Box> focusBox;
    std::optional<Box> fadingBox;
    for (std::size_t i = 0; i < children_.size(); ++i) {
        Card& child = *children_[i];
        const Box original = child.box();
        const double base = box_.x + ContentLeftOf(Slot{i, 0}) - scrollX_;
        const auto first = loops ? static_cast<std::int64_t>(std::ceil((painted.x - base - original.width) / period)) : 0;
        const auto last = loops ? static_cast<std::int64_t>(std::floor((painted.Right() - base) / period)) : 0;
        for (auto turn = first; turn <= last; ++turn) {
            const Box copy{base + static_cast<double>(turn) * period, original.y, original.width, original.height};
            if (copy.Right() < painted.x || copy.x > painted.Right()) continue;
            if (focusSlot_ == Slot{i, turn} && child.focused()) {
                focusBox = copy;
                continue;
            }
            if (fadingSlot_ == Slot{i, turn} && !child.focused() && child.focusAmount() > 0.0) {
                fadingBox = copy;
                continue;
            }
            child.Arrange(copy, metrics);
            child.PaintCopy(painter, metrics, false);
        }
        child.Arrange(original, metrics);
    }
    if (fadingBox && fadingSlot_ && fadingSlot_->index < children_.size()) {
        Card& child = *children_[fadingSlot_->index];
        const Box original = child.box();
        child.Arrange(*fadingBox, metrics);
        child.PaintCopy(painter, metrics, true);
        child.Arrange(original, metrics);
    }
    // A grown card and its shadow sit over its neighbours, including at the viewport edges.
    if (focusBox && focusSlot_) {
        Card& child = *children_[focusSlot_->index];
        const Box original = child.box();
        child.Arrange(*focusBox, metrics);
        child.PaintCopy(painter, metrics, true);
        child.Arrange(original, metrics);
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
    if (logo_ || tile_.has_value()) {
        return Size{metrics.Rem(kChannelWidthRem), metrics.Rem(kChannelHeightRem) + metrics.Rem(kCardLabelGapRem) +
                                                       metrics.Rem(kCardLabelHeightRem) * (subtitle_.empty() ? 1.0 : 1.8)};
    }
    if (feature_) return Size{metrics.Rem(30.0), metrics.Rem(16.9)};
    if (category_) return Size{metrics.Rem(kCategoryWidthRem), metrics.Rem(kCategoryHeightRem)};
    if (landscape_ || progress_.has_value()) {
        return Size{metrics.Rem(kLandscapeWidthRem), metrics.Rem(kLandscapeHeightRem)};
    }
    return Size{metrics.Rem(kPosterWidthRem),
                metrics.Rem(kPosterHeightRem) + metrics.Rem(kCardLabelGapRem) +
                    metrics.Rem(kCardLabelHeightRem) * (subtitle_.empty() ? 1.0 : 1.8)};
}

void Card::Arrange(const Box& box, const Metrics& /*metrics*/) {
    box_ = box;
}

namespace {

// The artwork's box on whole pixels while the card is at rest (not mid-way through its focus grow). A fractional
// edge is drawn at partial coverage by every layer on it (the picture, its scrim, the glass rim), and the partial
// row of picture that shows through reads as a thin bright line at the foot of the poster. While the focus eases the
// box stays fractional, so the grow is as smooth as before.
Box SnappedArt(const Box& box, double focus) {
    if (focus > 0.0 && focus < 1.0) return box;
    const double left = std::round(box.x);
    const double top = std::round(box.y);
    const double right = std::round(box.Right());
    const double bottom = std::round(box.Bottom());
    return Box{left, top, right - left, bottom - top};
}

}  // namespace

void Card::Paint(Painter& painter, const Metrics& metrics) const {
    PaintCopy(painter, metrics, true);
}

void Card::PaintCopy(Painter& painter, const Metrics& metrics, bool ownsFocus) const {
    const double focus = ownsFocus ? std::clamp(focusAmount_, 0.0, 1.0) : 0.0;
    const bool focused = ownsFocus && focused_;
    if (tile_.has_value()) {
        const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
        const double artHeight = metrics.Rem(kChannelHeightRem);
        const double scale = 1.0 + (kPosterFocusScale - 1.0) * motionFocus;
        const double width = box_.width * scale;
        const double height = artHeight * scale;
        const double bottom = box_.y + artHeight - metrics.Rem(kPosterLiftRem) * motionFocus;
        const Box tile = SnappedArt(Box{box_.CenterX() - width / 2.0, bottom - height, width, height}, focus);
        const double radius = metrics.Rem(kPosterRadiusRem);
        const Color base = *tile_;
        const Color top = Mix(base, Rgb(0xFFFFFF), 0.14);
        painter.FillRoundRectLinear(tile, radius, tile.x, tile.y, tile.x, tile.Bottom(),
                                    {GradientStop{0.0, top}, GradientStop{1.0, base}});
        const double lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
        const Color ink = lum > 0.58 ? Rgb(0x111318) : Rgb(0xFFFFFF);
        const TextStyle wordStyle{metrics.Rem(1.32), true, 800};
        const double textWidth = std::min(tile.width - metrics.Rem(1.4), painter.MeasureText(title_, wordStyle));
        painter.Text(Box{tile.CenterX() - textWidth / 2.0, tile.y, textWidth + 4.0, tile.height},
                     title_, wordStyle, ink);
        GlassStyle glass;
        glass.kind = GlassKind::Card;
        glass.focused = focused;
        glass.focusAmount = focus;
        glass.reduceTransparency = tokens::reduceTransparency;
        glass.rimOnly = true;
        glass.border = Rgb(0xFFFFFF, 0.22);
        glass.ringColor = kPosterRing;
        glass.ringWidth = metrics.Rem(kPosterRingWidthRem);
        glass.ringOutset = metrics.Rem(kPosterRingOffsetRem) + glass.ringWidth / 2.0;
        painter.Glass(tile, radius, glass);
        if (!subtitle_.empty()) {
            const Box label{box_.x, box_.y + artHeight + metrics.Rem(kCardLabelGapRem), box_.width,
                            metrics.Rem(kCardLabelHeightRem)};
            painter.Text(label, subtitle_, TextStyle{metrics.Rem(kCardTitleRem * 0.88), false, 500},
                         Mix(tokens::kTextMuted, tokens::kText, focus));
        }
        return;
    }
    if (logo_) {
        // The channel tile grows from its foot and lifts as a poster does, over a dark plate that keeps any logo
        // (white, black or coloured) readable, with the existing card glass for its rim and focus.
        const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
        const double artHeight = metrics.Rem(kChannelHeightRem);
        const double scale = 1.0 + (kPosterFocusScale - 1.0) * motionFocus;
        const double width = box_.width * scale;
        const double height = artHeight * scale;
        const double bottom = box_.y + artHeight - metrics.Rem(kPosterLiftRem) * motionFocus;
        const Box tile = SnappedArt(Box{box_.CenterX() - width / 2.0, bottom - height, width, height}, focus);
        const double radius = metrics.Rem(kPosterRadiusRem);
        // The plate is rounded with the tile, so its corners never show outside the glass rim.
        painter.FillRoundRectLinear(tile, radius, tile.x, tile.y, tile.x, tile.Bottom(),
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
        glass.focused = focused;
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
    const bool landscape = landscape_ || progress_.has_value() || feature_ || category_;
    const double artHeight = landscape ? box_.height : metrics.Rem(kPosterHeightRem);
    const double radius = metrics.Rem(landscape ? kLandscapeRadiusRem : kPosterRadiusRem);

    // Keep the title anchored when its artwork grows and lifts.
    const double scale = 1.0 + (kPosterFocusScale - 1.0) * motionFocus;
    const double width = box_.width * scale;
    const double height = artHeight * scale;
    const double bottom = box_.y + artHeight - metrics.Rem(kPosterLiftRem) * motionFocus;
    const Box poster = SnappedArt(Box{box_.CenterX() - width / 2.0, bottom - height, width, height}, focus);

    const bool hasArt = !posterUrl_.empty() && painter.Image(poster, posterUrl_, radius);

    std::uint32_t hash = 2166136261u;
    for (unsigned char c : (title_.empty() ? itemId_ : title_)) {
        hash = (hash ^ c) * 16777619u;
    }
    static constexpr int kCinemaHues[] = {208, 186, 224, 34, 260, 196, 338, 172, 236, 20};

    GlassStyle glass;
    glass.kind = GlassKind::Card;
    glass.focused = focused;
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

    if (category_) {
        // A Browse tile: the category's picture, a scrim over its lower part (rounded with it), and its name in bold
        // at the foot.
        const double scrimTop = poster.Bottom() - poster.height * 0.5;
        painter.FillRoundRectLinear(poster, radius, poster.x, scrimTop, poster.x, poster.Bottom(),
                                    {GradientStop{0.0, Rgb(0x000000, 0.0)}, GradientStop{1.0, Rgb(0x04080E, 0.78)}});
        const double inset = metrics.Rem(1.1);
        painter.Paragraph(Box{poster.x + inset, poster.Bottom() - metrics.Rem(4.4), poster.width - 2.0 * inset, metrics.Rem(3.6)},
                          title_, TextStyle{metrics.Rem(1.4), true, 700}, Rgb(0xF5F7FA));
        return;
    }
    if (feature_) {
        // The Top Result: the picture with a scrim over its lower half (rounded with it), the title large over the
        // foot, and what it is under that.
        const double scrimTop = poster.Bottom() - poster.height * 0.6;
        painter.FillRoundRectLinear(poster, radius, poster.x, scrimTop, poster.x, poster.Bottom(),
                                    {GradientStop{0.0, Rgb(0x000000, 0.0)}, GradientStop{1.0, Rgb(0x04080E, 0.82)}});
        const double inset = metrics.Rem(1.3);
        painter.Text(Box{poster.x + inset, poster.Bottom() - metrics.Rem(4.6), poster.width - 2.0 * inset, metrics.Rem(2.4)},
                     title_, TextStyle{metrics.Rem(1.8), true, 750}, Rgb(0xF5F7FA));
        if (!subtitle_.empty()) {
            painter.Text(Box{poster.x + inset, poster.Bottom() - metrics.Rem(2.3), poster.width - 2.0 * inset, metrics.Rem(1.4)},
                         subtitle_, TextStyle{metrics.Rem(0.95), true, 550}, Rgb(0xF5F7FA, 0.78));
        }
        return;
    }
    if (landscape_ || progress_.has_value()) {
        // Landscape card (Featured or Continue Watching): title over warm bottom scrim, plus progress bar when present.
        const TextStyle titleStyle{metrics.Rem(1.125), true, 650};
        if (!hasArt) {
            const double tx = metrics.Rem(1.1);
            painter.Paragraph(Box{poster.x + tx, poster.y + poster.height * 0.28,
                                  std::max(0.0, poster.width - 2.0 * tx), poster.height * 0.48},
                              title_, TextStyle{metrics.Rem(1.3), true, 600},
                              Mix(tokens::kTextMuted, tokens::kText, focus));
        } else {
            const double scrimTop = poster.Bottom() - poster.height * 0.44;
            painter.FillRoundRectLinear(poster, radius, poster.x, scrimTop, poster.x, poster.Bottom(),
                                        {GradientStop{0.0, Rgb(0x000000, 0.0)},
                                         GradientStop{1.0, Rgb(0x0C0805, 0.86)}});
            const double insetX = metrics.Rem(kProgressInsetXRem);
            const double titleBottom = metrics.Rem(progress_.has_value() ? (kProgressInsetBottomRem + 0.55) : 0.75);
            const double titleH = metrics.Rem(2.9);
            const Box titleBox{poster.x + insetX, poster.Bottom() - titleBottom - titleH,
                               std::max(0.0, poster.width - 2.0 * insetX), titleH};
            if (painter.MeasureText(title_, titleStyle) > titleBox.width) {
                painter.Paragraph(titleBox, title_, titleStyle, Rgb(0xF5F7FA, 0.95));
            } else {
                painter.Text(Box{titleBox.x, poster.Bottom() - titleBottom - metrics.Rem(1.65),
                                 titleBox.width, metrics.Rem(1.65)},
                             title_, titleStyle, Rgb(0xF5F7FA, 0.95));
            }
        }
        if (progress_.has_value()) {
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
        }
        return;
    }

    if (hasArt && !tokens::posterTitles && !focused) return;
    const Box label{box_.x, box_.y + artHeight + metrics.Rem(kCardLabelGapRem), box_.width,
                    metrics.Rem(kCardLabelHeightRem)};
    const TextStyle titleStyle{metrics.Rem(kCardTitleRem), false};
    const Color titleInk = Mix(tokens::kTextMuted, tokens::kText, focus);
    if (subtitle_.empty() && painter.MeasureText(title_, titleStyle) > label.width) {
        painter.Paragraph(Box{label.x, label.y, label.width, metrics.Rem(kCardLabelHeightRem * 1.95)},
                          title_, titleStyle, titleInk);
    } else {
        painter.Text(label, title_, titleStyle, titleInk);
    }
    if (!subtitle_.empty()) {
        painter.Text(Box{label.x, label.Bottom() - metrics.Rem(0.15), label.width, metrics.Rem(kCardLabelHeightRem) * 0.8},
                     subtitle_, TextStyle{metrics.Rem(kCardTitleRem * 0.82), false, 450}, tokens::kTextFaint);
    }
}

void DrawButton(Painter& painter, const Metrics& metrics, const Box& box, const std::string& label, const ButtonLook& look) {
    const double focus = std::clamp(look.focusAmount, 0.0, 1.0);
    const double scale = tokens::reduceMotion ? 1.0 : 1.0 - 0.03 * look.pressAmount;
    const double width = box.width * scale;
    const double height = box.height * scale;
    const double lift = tokens::reduceMotion ? 0.0 : metrics.Rem(0.125) * focus * (1.0 - look.pressAmount);
    const Box shape{box.CenterX() - width / 2.0, box.CenterY() - height / 2.0 - lift, width, height};
    const double radius = metrics.Rem(box.height < metrics.Rem(2.5) ? 0.625 : 0.75);
    const double ringWidth = metrics.Rem(kFocusRingWidthRem);
    GlassStyle glass = glass::ButtonGlass(focus, look.focused, look.pressAmount, look.opacity, ringWidth,
                                          metrics.Rem(kFocusRingOffsetRem) + ringWidth / 2.0);
    if (look.primary) {
        glass.adaptiveInk = false;
        glass.solid = true;
        glass.tint = look.fill.value_or(tokens::kPrimary);
    }
    painter.Glass(shape, radius, glass);

    const TextStyle style = type::Label(metrics.rem);
    const double glyph = look.glyph.empty() ? 0.0 : metrics.Rem(1.1);
    const double gap = glyph > 0.0 ? metrics.Rem(0.50) : 0.0;
    const double available = std::max(1.0, shape.width - metrics.Rem(1.1) - glyph - gap);
    const double textWidth = std::min(available, painter.MeasureText(label, style));
    const double x = shape.CenterX() - (glyph + gap + textWidth) / 2.0;
    Color ink = painter.GlassInk(look.primary ? tokens::kOnPrimary : tokens::kText);
    if (look.primary && glass.tint) {
        const Color fill = *glass.tint;
        if (0.2126 * fill.r + 0.7152 * fill.g + 0.0722 * fill.b >= 0.46) ink = Rgb(0x07080B);
    }
    ink.a *= look.opacity;
    if (glyph > 0.0)
        painter.Path(Box{x, shape.CenterY() - glyph / 2.0, glyph, glyph}, 32.0, look.glyph,
                     PathStyle{ink, Rgb(0x000000, 0.0), 0.0});
    painter.Text(Box{x + glyph + gap, shape.y, textWidth + 2.0, shape.height}, label, style, ink);
}

}  // namespace tvm::ui
