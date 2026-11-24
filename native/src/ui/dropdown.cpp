#include "ui/dropdown.h"

#include <algorithm>
#include <cmath>

#include "ui/glass_styles.h"
#include "ui/theme.h"

namespace tvm::ui {

namespace {

constexpr double kRowRem = 2.35;
constexpr double kPadRem = 0.4;
constexpr double kRadiusRem = 1.0;
constexpr double kMinWidthRem = 11.0;
constexpr double kMaxWidthRem = 24.0;
constexpr double kGapRem = 0.45;
constexpr double kSlideMs = 160.0;
constexpr Color kSurface = Rgb(0x141720, 0.97);
constexpr Color kCheck = Rgb(0x3B9CFF);
// `--tvma-ease`, the Android popup's curve, which the player's menus and the profile menu share.
constexpr motion::CubicBezier kPopEase{0.22, 1.0, 0.36, 1.0};
constexpr char kCheckPath[] = "M6 16.5l6.5 6.5L26 9.5";

bool Reduced(const motion::MotionSettings& motion) {
    return motion::PrefersReducedMotion(motion) || tokens::reduceMotion;
}

}  // namespace

void Dropdown::Open(const Box& anchor, std::vector<DropdownOption> options, std::size_t selected, double viewportWidth,
                    double viewportHeight, double rem, double nowMs, const motion::MotionSettings& motion) {
    options_ = std::move(options);
    motion_ = motion;
    rem_ = rem;
    selected_ = options_.empty() ? 0 : std::min(selected, options_.size() - 1);
    highlighted_ = selected_;
    open_ = !options_.empty();
    everOpened_ = true;

    // As wide as the longest row (estimated from its length, so no painter is needed) and at least the control.
    double longest = 0.0;
    for (const DropdownOption& option : options_) {
        double width = static_cast<double>(option.label.size()) * 0.56 * rem * 0.92;
        if (!option.detail.empty()) width += rem + static_cast<double>(option.detail.size()) * 0.5 * rem * 0.76;
        longest = std::max(longest, width);
    }
    const double width = std::min(std::clamp(std::max(anchor.width, longest + rem * 4.2), rem * kMinWidthRem,
                                             rem * kMaxWidthRem),
                                  std::max(1.0, viewportWidth - 2.0 * rem));
    const double rows = static_cast<double>(RowsShown());
    const double height = 2.0 * rem * kPadRem + rows * rem * kRowRem;
    // Under the control when it fits, else over it.
    const double below = anchor.Bottom() + rem * kGapRem;
    upward_ = below + height > viewportHeight - rem && anchor.y - rem * kGapRem - height >= rem;
    const double y = upward_ ? anchor.y - rem * kGapRem - height : std::min(below, viewportHeight - rem - height);
    const double x = std::clamp(anchor.x, rem, std::max(rem, viewportWidth - rem - width));
    panel_ = Box{x, std::max(rem, y), width, height};

    first_ = 0;
    KeepInView();
    // Centre the chosen row when the list is long.
    const std::size_t shown = RowsShown();
    if (options_.size() > shown) {
        first_ = std::min(highlighted_ > shown / 2 ? highlighted_ - shown / 2 : std::size_t{0}, options_.size() - shown);
    }
    row_ = motion::Tween(static_cast<double>(highlighted_), static_cast<double>(highlighted_), nowMs, 0.0);
    fade_ = motion::Tween(0.0, 1.0, nowMs, Reduced(motion_) ? 0.0 : kOpenMs, kPopEase);
}

void Dropdown::Close(double nowMs) {
    if (!open_) return;
    open_ = false;
    fade_ = motion::Tween(Fade(nowMs), 0.0, nowMs, Reduced(motion_) ? 0.0 : kCloseMs, kPopEase);
}

double Dropdown::Fade(double nowMs) const {
    if (!everOpened_) return 0.0;
    return std::clamp(fade_.Value(nowMs), 0.0, 1.0);
}

bool Dropdown::Visible(double nowMs) const {
    return open_ || Fade(nowMs) > 0.0;
}

bool Dropdown::Animating(double nowMs) const {
    if (!everOpened_) return false;
    return !fade_.Done(nowMs) || (open_ && !row_.Done(nowMs));
}

std::size_t Dropdown::RowsShown() const {
    return std::min(options_.size(), kRowsMost);
}

void Dropdown::KeepInView() {
    const std::size_t shown = std::max<std::size_t>(1, RowsShown());
    if (highlighted_ < first_) first_ = highlighted_;
    if (highlighted_ >= first_ + shown) first_ = highlighted_ + 1 - shown;
}

void Dropdown::MoveHighlight(std::size_t row, double nowMs) {
    if (row >= options_.size() || row == highlighted_) return;
    row_ = motion::Tween(row_.Value(nowMs), static_cast<double>(row), nowMs, Reduced(motion_) ? 0.0 : kSlideMs,
                         kPopEase);
    highlighted_ = row;
    KeepInView();
}

bool Dropdown::Navigate(nav::Direction direction, double nowMs) {
    if (!open_) return false;
    if (direction == nav::Direction::Up && highlighted_ > 0) MoveHighlight(highlighted_ - 1, nowMs);
    if (direction == nav::Direction::Down && highlighted_ + 1 < options_.size()) MoveHighlight(highlighted_ + 1, nowMs);
    // Left and Right do nothing while the list is open; it keeps the keys.
    return true;
}

std::optional<Box> Dropdown::RowBox(std::size_t row) const {
    if (row < first_ || row >= first_ + RowsShown()) return std::nullopt;
    const double rowHeight = rem_ * kRowRem;
    return Box{panel_.x + rem_ * kPadRem, panel_.y + rem_ * kPadRem + static_cast<double>(row - first_) * rowHeight,
               panel_.width - 2.0 * rem_ * kPadRem, rowHeight};
}

std::optional<std::size_t> Dropdown::RowAt(double x, double y) const {
    if (!open_) return std::nullopt;
    for (std::size_t row = first_; row < first_ + RowsShown(); ++row) {
        const Box box = *RowBox(row);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) return row;
    }
    return std::nullopt;
}

bool Dropdown::Contains(double x, double y) const {
    return open_ && x >= panel_.x && x < panel_.Right() && y >= panel_.y && y < panel_.Bottom();
}

void Dropdown::Hover(std::size_t row, double nowMs) {
    MoveHighlight(row, nowMs);
}

bool Dropdown::Scroll(int rows) {
    if (!open_ || options_.size() <= RowsShown()) return false;
    const auto most = static_cast<long long>(options_.size() - RowsShown());
    const long long wanted = std::clamp(static_cast<long long>(first_) + rows, 0LL, most);
    if (static_cast<std::size_t>(wanted) == first_) return false;
    first_ = static_cast<std::size_t>(wanted);
    return true;
}

void Dropdown::Paint(Painter& painter, double nowMs) const {
    const double fade = Fade(nowMs);
    if (fade <= 0.0 || options_.empty()) return;
    // A short fade with a slight scale from the control's side, never a bounce.
    const double scale = 0.96 + 0.04 * fade;
    const double width = panel_.width * scale;
    const double height = panel_.height * scale;
    const double rise = rem_ * 0.4 * (1.0 - fade) * (upward_ ? 1.0 : -1.0);
    const Box panel{panel_.x + (panel_.width - width) / 2.0,
                    (upward_ ? panel_.Bottom() - height : panel_.y) + rise, width, height};
    const double radius = rem_ * kRadiusRem;
    for (int layer = 3; layer >= 1; --layer) {
        const double spread = rem_ * 0.22 * layer;
        painter.FillRoundRect(Box{panel.x - spread, panel.y - spread + rem_ * 0.35, panel.width + 2.0 * spread,
                                  panel.height + 2.0 * spread},
                              radius + spread, Rgb(0x000000, 0.10 * fade));
    }
    painter.FillRoundRect(panel, radius, Rgb(0x141720, kSurface.a * fade));
    painter.StrokeRoundRect(panel, radius, 1.0, Rgb(0xFFFFFF, 0.08 * fade));

    const double rowHeight = rem_ * kRowRem;
    const Box rows{panel.x + rem_ * kPadRem, panel.y + rem_ * kPadRem, panel.width - 2.0 * rem_ * kPadRem,
                   static_cast<double>(RowsShown()) * rowHeight};
    painter.PushClip(rows);
    // The highlight: the nav pill's hover plate, sliding between rows. The row under it reads in dark ink.
    const double at = std::clamp(row_.Value(nowMs), 0.0, static_cast<double>(options_.size() - 1)) -
                      static_cast<double>(first_);
    const Box plate{rows.x, rows.y + at * rowHeight + rem_ * 0.1, rows.width, rowHeight - rem_ * 0.2};
    if (open_) painter.Glass(plate, rem_ * 0.65, glass::NavHover(1.0, fade));
    const double tick = rem_ * 1.05;
    for (std::size_t i = first_; i < options_.size() && i < first_ + RowsShown(); ++i) {
        const DropdownOption& option = options_[i];
        const Box row{rows.x, rows.y + static_cast<double>(i - first_) * rowHeight, rows.width, rowHeight};
        // How much of the plate is under this row, so its ink turns dark as the plate arrives.
        const double under = open_ ? std::clamp(1.0 - std::abs(at - static_cast<double>(i - first_)), 0.0, 1.0) : 0.0;
        const Color ink = glass::InkOnPlate(under, fade);
        const TextStyle labelStyle{rem_ * 0.92, true, i == selected_ ? 680 : 520};
        const double labelLeft = row.x + rem_ * 0.9;
        const double textRight = row.Right() - rem_ * 0.75 - tick - rem_ * 0.5;
        const double labelWidth = std::min(painter.MeasureText(option.label, labelStyle), textRight - labelLeft);
        painter.Text(Box{labelLeft, row.y, labelWidth + 2.0, row.height}, option.label, labelStyle, ink);
        if (!option.detail.empty()) {
            const double detailLeft = labelLeft + labelWidth + rem_ * 0.7;
            if (textRight - detailLeft > rem_ * 1.5) {
                Color faint = ink;
                faint.a *= 0.6;
                painter.Text(Box{detailLeft, row.y, textRight - detailLeft, row.height}, option.detail,
                             TextStyle{rem_ * 0.76, false, 450}, faint);
            }
        }
        if (i == selected_) {
            const Color check = under > 0.5 ? Rgb(0x1F6FE0, fade) : Rgb(0x3B9CFF, kCheck.a * fade);
            painter.Path(Box{row.Right() - rem_ * 0.75 - tick, row.CenterY() - tick / 2.0, tick, tick}, 32.0, kCheckPath,
                         PathStyle{Color{0, 0, 0, 0}, check, 3.2, false});
        }
    }
    painter.PopClip();
    // A long list shows a slim scroll bar.
    if (options_.size() > RowsShown()) {
        const double track = rows.height - rem_ * 0.4;
        const double thumb = std::max(rem_ * 1.2, track * static_cast<double>(RowsShown()) /
                                                      static_cast<double>(options_.size()));
        const double share = static_cast<double>(first_) / static_cast<double>(options_.size() - RowsShown());
        painter.FillRoundRect(Box{panel.Right() - rem_ * 0.3, rows.y + rem_ * 0.2 + (track - thumb) * share,
                                  rem_ * 0.16, thumb},
                              rem_ * 0.08, Rgb(0xFFFFFF, 0.28 * fade));
    }
}

}  // namespace tvm::ui
