#include "ui/pages.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <utility>

#include "motion/preferences.h"
#include "ui/glass_styles.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;
constexpr double kButtonHeightRem = 2.85;
constexpr double kButtonGapRem = 0.75;
constexpr double kLedeWidthRem = 48.0;
constexpr double kScrollMs = 280.0;
constexpr char kPound[] = "\xC2\xA3";

bool Contains(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

Color WithAlphaOf(Color color, double alpha) {
    color.a *= alpha;
    return color;
}

Box Shifted(const Box& box, double scroll) {
    return Box{box.x, box.y - scroll, box.width, box.height};
}

std::string Upper(std::string text) {
    for (char& c : text) {
        if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    }
    return text;
}

std::string InitialGlyph(const std::string& name, const std::string& email) {
    const std::string& source = !name.empty() ? name : email;
    for (char ch : source) {
        if (std::isalnum(static_cast<unsigned char>(ch))) {
            return std::string(1, static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
        }
    }
    return "T";
}

std::string FormatPounds(int pence) {
    const int pounds = pence / 100;
    const int rem = pence % 100;
    if (rem == 0) return std::string(kPound) + std::to_string(pounds);
    return std::string(kPound) + std::to_string(pounds) + "." + (rem < 10 ? "0" : "") + std::to_string(rem);
}

std::string MaskDots(const std::string& secret) {
    std::string masked;
    for (std::size_t i = 0; i < secret.size(); ++i) {
        if ((static_cast<unsigned char>(secret[i]) & 0xC0) != 0x80) masked += "\xE2\x80\xA2";
    }
    return masked;
}

double WrappedHeight(double boxWidth, double fontSizePx, double lineHeightPx, const std::string& text) {
    if (text.empty()) return 0.0;
    const double charWidth = std::max(4.0, 0.52 * fontSizePx);
    const std::size_t perLine = std::max<std::size_t>(12, static_cast<std::size_t>(boxWidth / charWidth));
    std::size_t lines = 0;
    std::size_t pos = 0;
    while (pos < text.size()) {
        std::size_t newline = text.find('\n', pos);
        const std::size_t end = newline == std::string::npos ? text.size() : newline;
        const std::size_t len = end - pos;
        lines += std::max<std::size_t>(1, (len + perLine - 1) / perLine);
        if (newline == std::string::npos) break;
        pos = newline + 1;
    }
    return static_cast<double>(std::max<std::size_t>(1, lines)) * lineHeightPx;
}

void DrawAlertIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
    painter.Path(box, 24.0, "M12 7 V13", PathStyle{{0, 0, 0, 0}, color, 2.1, false});
    const double dot = std::max(2.0, box.width * 0.11);
    painter.FillRoundRect(Box{box.CenterX() - dot / 2.0, box.y + box.height * 0.68 - dot / 2.0, dot, dot}, dot / 2.0, color);
}

void DrawCheckIcon(Painter& painter, const Box& box, const Color& color, double strokeWidth = 2.2) {
    painter.Path(box, 24.0, "M5 12.5 L10 17.5 L19 7", PathStyle{{0, 0, 0, 0}, color, strokeWidth, false});
}

void DrawEyeIcon(Painter& painter, const Box& box, bool open, const Color& color) {
    painter.Path(box, 24.0, "M2 12 A11 9 0 0 1 22 12", PathStyle{{0, 0, 0, 0}, color, 1.85, false});
    painter.Path(box, 24.0, "M2 12 A11 9 0 0 0 22 12", PathStyle{{0, 0, 0, 0}, color, 1.85, false});
    painter.Path(box, 24.0, "M12 9 A3 3 0 1 0 12 15 A3 3 0 1 0 12 9", PathStyle{{0, 0, 0, 0}, color, 1.85, false});
    if (!open) {
        painter.Path(box, 24.0, "M4 4 L20 20", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
    }
}

void DrawClockIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2", PathStyle{{0, 0, 0, 0}, color, 1.9, false});
    painter.Path(box, 24.0, "M12 6.5 V12 L15.5 14", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
}

void DrawPauseIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2", PathStyle{{0, 0, 0, 0}, color, 1.9, false});
    painter.Path(box, 24.0, "M9.5 8.5 V15.5", PathStyle{{0, 0, 0, 0}, color, 2.2, false});
    painter.Path(box, 24.0, "M14.5 8.5 V15.5", PathStyle{{0, 0, 0, 0}, color, 2.2, false});
}

void DrawShieldCheckIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M12 3 L5 6.5 V11.5 A9.5 9.5 0 0 0 12 20.5 A9.5 9.5 0 0 0 19 11.5 V6.5 Z",
                 PathStyle{{0, 0, 0, 0}, color, 1.85, false});
    DrawCheckIcon(painter, Box{box.x + box.width * 0.22, box.y + box.height * 0.22, box.width * 0.56, box.height * 0.56},
                  color, 2.1);
}

void DrawCloseIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M6 6 L18 18", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
    painter.Path(box, 24.0, "M18 6 L6 18", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
}

void DrawChevronRightIcon(Painter& painter, const Box& box, const Color& color) {
    painter.Path(box, 24.0, "M9 6 L15 12 L9 18", PathStyle{{0, 0, 0, 0}, color, 2.0, false});
}

void DrawActionPill(Painter& painter, double scale, const Box& box, const std::string& label,
                    bool primary, bool disabled, bool focused, double focusAmount) {
    const double focus = disabled ? 0.0 : std::clamp(focusAmount, 0.0, 1.0);
    const double motionFocus = tokens::reduceMotion ? 0.0 : focus;
    const double scaleFactor = 1.0 + 0.025 * motionFocus;
    const double w = box.width * scaleFactor;
    const double h = box.height * scaleFactor;
    const Box shape{box.CenterX() - w / 2.0, box.CenterY() - h / 2.0, w, h};
    const double radius = shape.height / 2.0;

    if (disabled) {
        painter.FillRoundRect(shape, radius, Rgb(0xFFFFFF, 0.06));
        painter.StrokeRoundRect(shape, radius, 1.0, Rgb(0xFFFFFF, 0.14));
    } else if (primary) {
        const Color topTint = focused ? Rgb(0x4780FF, 0.96) : Rgb(0x3B76FF, 0.92);
        const Color botTint = focused ? Rgb(0x2F66EE, 0.96) : Rgb(0x2556D8, 0.92);
        painter.FillRoundRectLinear(shape, radius, shape.x, shape.y, shape.x, shape.Bottom(),
                                    {GradientStop{0.0, topTint}, GradientStop{1.0, botTint}});
        painter.StrokeRoundRect(shape, radius, 1.0, Rgb(0xFFFFFF, 0.26));
    } else {
        GlassStyle style = glass::NavCapsule();
        style.reduceTransparency = tokens::reduceTransparency;
        style.tint = focused ? tokens::kSurfaceHover : tokens::kSurface;
        painter.Glass(shape, radius, style);
        painter.FillRoundRect(shape, radius, Rgb(0xFFFFFF, focused ? 0.14 : 0.07));
        painter.StrokeRoundRect(shape, radius, 1.0, Rgb(0xFFFFFF, focused ? 0.34 : 0.18));
    }

    if (focused && !disabled) {
        const double outset = 3.0;
        painter.StrokeRoundRect(Box{shape.x - outset, shape.y - outset, shape.width + 2.0 * outset, shape.height + 2.0 * outset},
                                radius + outset, 2.0, tokens::kFocusRing);
    }

    const TextStyle textStyle{scale * 0.94, true, 650};
    const double tw = std::min(shape.width - scale * 1.6, painter.MeasureText(label, textStyle));
    const Color ink = disabled ? tokens::kTextFaint : (primary ? Rgb(0xFFFFFF, 0.98) : tokens::kText);
    painter.Text(Box{shape.CenterX() - tw / 2.0, shape.y, tw + 2.0, shape.height}, label, textStyle, ink);
}

void PopUtf8(std::string& value, bool wholeWord) {
    auto eraseChar = [&]() {
        while (!value.empty() && (static_cast<unsigned char>(value.back()) & 0xC0) == 0x80) value.pop_back();
        if (!value.empty()) value.pop_back();
    };
    if (value.empty()) return;
    if (!wholeWord) {
        eraseChar();
        return;
    }
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) eraseChar();
    while (!value.empty() && !std::isspace(static_cast<unsigned char>(value.back()))) eraseChar();
}

// The width of a pill button for a label, in rems.
double ButtonWidthRem(const std::string& label) {
    return static_cast<double>(label.size()) * 0.56 * kButtonLabelRem + 2.0 * kButtonPadRem + 0.4;
}

// Lays a row of pill buttons out left to right from `x`.
void Row(std::vector<PageButton>& buttons, double x, double y, double height, double rem, int row,
         std::vector<std::pair<std::string, std::string>> items, double availableWidth = 100000.0) {
    FlowLayout flow(x, y, availableWidth, kButtonGapRem * rem);
    for (auto& [key, label] : items) {
        const double width = ButtonWidthRem(label) * rem;
        PageButton button;
        button.key = key;
        button.label = label;
        button.box = flow.Place(width, std::max(44.0, height));
        button.row = row + flow.Row();
        buttons.push_back(std::move(button));
    }
}

}  // namespace

// ------------------------------------------------------------------ the page

void PageScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    scroll_ = std::clamp(scroll_, 0.0, MaxScroll());
}

bool PageScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    buttonFocus_.Track(focused_, focusHidden_, nowMs, motion_);
    if (scrollTween_.has_value()) {
        scroll_ = scrollTween_->Value(nowMs);
        if (scrollTween_->Done(nowMs)) scrollTween_.reset();
    }
    return Animating();
}

bool PageScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_) || scrollTween_.has_value();
}

double PageScreen::MaxScroll() const {
    return std::max(0.0, ContentHeight() - height_);
}

void PageScreen::Paint(Painter& painter) const {
    const Metrics metrics{ViewportRem(width_, height_)};
    if (!ShowsStage()) {
        painter.Clear(tokens::kBackground);
        // A plain page: no picture behind it. The glass is told there is no backdrop, so nothing faint shows through.
        painter.SetBackdrop(Box{0.0, 0.0, 0.0, 0.0}, "", 0.5, 0.2);
    }
    PaintContent(painter, scroll_);
    for (const PageButton& button : Buttons()) {
        const Box box = Shifted(button.box, scroll_);
        if (box.Bottom() < 0.0 || box.y > height_) continue;
        const bool focused = ShowsFocus(focused_, button.key);
        if (button.custom) {
            PaintCustom(painter, button, box, focused);
        } else if (button.disabled) {
            // A disabled button is drawn quiet, and the focus passes it by.
            GlassStyle disabledGlass;
            disabledGlass.kind = GlassKind::Pill;
            disabledGlass.disabled = true;
            disabledGlass.reduceTransparency = tokens::reduceTransparency;
            disabledGlass.tint = tokens::kSurface;
            painter.Glass(box, box.height / 2.0, disabledGlass);
            const TextStyle style{Rem(kButtonLabelRem), true};
            const double width = painter.MeasureText(button.label, style);
            painter.Text(Box{box.CenterX() - width / 2.0, box.y, width + 2.0, box.height}, button.label, style,
                         tokens::kTextFaint);
        } else {
            DrawButton(painter, metrics, box, button.label,
                       ButtonLook{button.primary, focused, buttonFocus_.Amount(button.key, clockMs_)});
        }
    }
}

double PageScreen::PaintHeader(Painter& painter, double top, const std::string& kicker, const std::string& heading,
                               const std::string& lede) const {
    const double x = Rem(kSafeXRem + 3.0);
    const double width = width_ - x - Rem(kSafeXRem);
    painter.Text(Box{x, top, width, Rem(1.2)}, Upper(kicker), TextStyle{Rem(0.8125), true, 700}, tokens::kTextFaint);
    painter.Text(Box{x, top + Rem(1.1), width, Rem(3.25)}, heading, TextStyle{Rem(2.75), true, 750}, tokens::kText);
    if (lede.empty()) return top + Rem(4.8);
    painter.Paragraph(Box{x, top + Rem(4.8), std::min(width, Rem(kLedeWidthRem)), Rem(3.4)}, lede,
                      TextStyle{Rem(1.0625), false}, tokens::kTextMuted);
    return top + Rem(8.6);
}

void PageScreen::KeepFocus(const std::string& fallback) {
    const std::vector<PageButton> buttons = Buttons();
    const auto usable = [&](const std::string& key) {
        return std::any_of(buttons.begin(), buttons.end(),
                           [&](const PageButton& b) { return b.key == key && !b.disabled; });
    };
    if (usable(focused_)) return;
    if (usable(fallback)) {
        focused_ = fallback;
        return;
    }
    const auto first = std::find_if(buttons.begin(), buttons.end(), [](const PageButton& b) { return !b.disabled; });
    focused_ = first == buttons.end() ? std::string() : first->key;
}

std::optional<Box> PageScreen::BoxOf(const std::string& key) const {
    for (const PageButton& button : Buttons()) {
        if (button.key == key) return Shifted(button.box, scroll_);
    }
    return std::nullopt;
}

bool PageScreen::Navigate(nav::Direction direction, double nowMs) {
    std::vector<PageButton> buttons = Buttons();
    std::erase_if(buttons, [](const PageButton& b) { return b.disabled; });
    const auto current = std::find_if(buttons.begin(), buttons.end(), [&](const PageButton& b) { return b.key == focused_; });
    if (current == buttons.end()) {
        if (buttons.empty()) return false;
        focused_ = buttons.front().key;
        FollowFocus(nowMs);
        return true;
    }
    const PageButton from = *current;
    std::optional<PageButton> best;
    double bestScore = 1e18;
    for (const PageButton& candidate : buttons) {
        if (candidate.key == from.key) continue;
        double score = 1e18;
        const double dx = candidate.box.CenterX() - from.box.CenterX();
        if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
            // Along the row: the nearest button on that side.
            if (candidate.row != from.row) continue;
            if ((direction == nav::Direction::Right) != (dx > 0.0)) continue;
            score = std::abs(dx);
        } else {
            // Across rows: the nearest row that way, then the button closest under or over this one.
            const int step = candidate.row - from.row;
            if ((direction == nav::Direction::Down) != (step > 0) || step == 0) continue;
            score = std::abs(static_cast<double>(step)) * 1e6 + std::abs(dx);
        }
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    if (!best.has_value()) return false;
    focused_ = best->key;
    FollowFocus(nowMs);
    return true;
}

void PageScreen::FollowFocus(double nowMs) {
    for (const PageButton& button : Buttons()) {
        if (button.key != focused_) continue;
        // The page moves only as far as it must to show the button with some room around it.
        double target = scroll_;
        const double margin = Rem(3.0);
        if (button.box.Bottom() + margin > scroll_ + height_) target = button.box.Bottom() + margin - height_;
        if (button.box.y - margin < scroll_) target = button.box.y - margin;
        target = std::clamp(target, 0.0, MaxScroll());
        if (std::abs(target - scroll_) < 0.5) return;
        scrollTween_ = motion::Tween(scroll_, target, nowMs, motion::PrefersReducedMotion(motion_) ? 0.0 : kScrollMs);
        return;
    }
}

std::optional<Command> PageScreen::Select(double /*nowMs*/) {
    for (const PageButton& button : Buttons()) {
        if (button.key == focused_ && !button.disabled) return Activate(button.key);
    }
    return std::nullopt;
}

bool PageScreen::FocusItem(const std::string& key, double /*nowMs*/, bool /*withCamera*/) {
    if (key == focused_) return false;
    for (const PageButton& button : Buttons()) {
        if (button.key == key && !button.disabled) {
            focused_ = key;
            return true;
        }
    }
    return false;
}

std::optional<std::string> PageScreen::ItemAt(double x, double y) const {
    for (const PageButton& button : Buttons()) {
        if (!button.disabled && Contains(Shifted(button.box, scroll_), x, y)) return button.key;
    }
    return std::nullopt;
}

std::optional<Command> PageScreen::ActivateItem(const std::string& key, double nowMs) {
    if (!FocusItem(key, nowMs, false) && focused_ != key) return std::nullopt;
    return Select(nowMs);
}

std::optional<ScrollSurface> PageScreen::SurfaceAt(double x, double y, nav::Axis axis) const {
    if (axis != nav::Axis::Y || x < 0.0 || y < 0.0 || x >= width_ || y >= height_) return std::nullopt;
    ScrollSurface surface;
    surface.kind = ScrollSurface::Kind::Page;
    surface.scroll = scroll_;
    surface.target = scrollTween_.has_value() ? scrollTween_->target() : scroll_;
    surface.maxScroll = MaxScroll();
    surface.viewport = height_;
    surface.canPan = MaxScroll() > 0.0;
    return surface;
}

void PageScreen::SetScroll(const ScrollSurface& /*surface*/, double value, double /*nowMs*/) {
    scrollTween_.reset();
    scroll_ = std::clamp(value, 0.0, MaxScroll());
}

void PageScreen::AnimateScroll(const ScrollSurface& /*surface*/, double target, double nowMs) {
    scrollTween_ = motion::Tween(scroll_, std::clamp(target, 0.0, MaxScroll()), nowMs,
                                 motion::PrefersReducedMotion(motion_) ? 0.0 : kScrollMs);
}

// ------------------------------------------------------------------ Profiles

namespace {

constexpr double kProfilesTopRem = 1.5;
constexpr double kTilesTopRem = 13.6;
constexpr double kTileWidthRem = 9.0;
constexpr double kTileHeightRem = 10.0;
constexpr double kTileGapRem = 1.6;
constexpr double kOrbRem = 6.5;
constexpr double kRemoveTopRem = 24.2;
constexpr double kFieldTopRem = 28.0;

// `hsl(hue 62% 48%)`, the orb's fill.
Color HueColor(int hue) {
    const double h = std::fmod(std::fmod(static_cast<double>(hue), 360.0) + 360.0, 360.0) / 60.0;
    const double s = 0.62;
    const double l = 0.48;
    const double chroma = (1.0 - std::abs(2.0 * l - 1.0)) * s;
    const double x = chroma * (1.0 - std::abs(std::fmod(h, 2.0) - 1.0));
    const double m = l - chroma / 2.0;
    double r = 0.0, g = 0.0, b = 0.0;
    if (h < 1.0) { r = chroma; g = x; }
    else if (h < 2.0) { r = x; g = chroma; }
    else if (h < 3.0) { g = chroma; b = x; }
    else if (h < 4.0) { g = x; b = chroma; }
    else if (h < 5.0) { r = x; b = chroma; }
    else { r = chroma; b = x; }
    return Color{r + m, g + m, b + m, 1.0};
}

}  // namespace

// The focus is set by the first view, onto the first tile.
ProfilesScreen::ProfilesScreen() = default;

void ProfilesScreen::SetView(ProfilesView view) {
    view_ = std::move(view);
    // The first tile has the focus when the page opens, as Profiles.tsx's profile-pick does.
    KeepFocus(view_.profiles.empty() ? "profiles-back" : "pick:" + view_.profiles.front().id);
}

void ProfilesScreen::Type(const std::string& text) {
    if (!creating_) return;
    name_ += text;
}

void ProfilesScreen::Erase() {
    if (!creating_ || name_.empty()) return;
    std::size_t cut = name_.size() - 1;
    while (cut > 0 && (static_cast<unsigned char>(name_[cut]) & 0xC0) == 0x80) --cut;
    name_.erase(cut);
}

std::vector<PageButton> ProfilesScreen::Buttons() const {
    std::vector<PageButton> buttons;
    const double rem = ViewportRem(width_, height_);
    double x = Rem(kSafeXRem);
    double top = Rem(kTilesTopRem);
    int tileRow = 0;
    const double tileWidth = std::min(Rem(kTileWidthRem), width_ - 2.0 * x);
    const auto advance = [&] {
        x += tileWidth + Rem(kTileGapRem);
        if (x + tileWidth > width_ - Rem(kSafeXRem) + 0.01) {
            x = Rem(kSafeXRem);
            top += Rem(kFieldTopRem - kTilesTopRem);
            tileRow += 2;
        }
    };
    for (const ProfileEntry& profile : view_.profiles) {
        PageButton tile;
        tile.key = "pick:" + profile.id;
        tile.label = profile.name;
        tile.box = Box{x, top, tileWidth, Rem(kTileHeightRem)};
        tile.row = tileRow;
        tile.custom = true;
        buttons.push_back(tile);
        // Remove sits under each tile while there is more than one.
        if (view_.profiles.size() > 1) {
            PageButton remove;
            remove.key = "remove:" + profile.id;
            remove.label = "Remove";
            remove.box = Box{x + Rem(1.0), top + Rem(kRemoveTopRem - kTilesTopRem), tileWidth - Rem(2.0), Rem(2.5)};
            remove.row = tileRow + 1;
            buttons.push_back(remove);
        }
        advance();
    }
    if (view_.profiles.size() < view_.max && !creating_) {
        PageButton add;
        add.key = "profile-add";
        add.label = "Add profile";
        add.box = Box{x, top, tileWidth, Rem(kTileHeightRem)};
        add.row = tileRow;
        add.custom = true;
        buttons.push_back(add);
    }
    double y = FieldTop();
    if (creating_) {
        Row(buttons, Rem(kSafeXRem), y + Rem(5.2), Rem(kButtonHeightRem), rem, tileRow + 2,
            {{"profile-save", "Save profile"}, {"profile-cancel", "Cancel"}});
        buttons[buttons.size() - 2].primary = true;
        y += Rem(9.5);
    }
    Row(buttons, Rem(kSafeXRem), y, Rem(kButtonHeightRem), rem, tileRow + 3, {{"profiles-back", "Back"}});
    return buttons;
}

double ProfilesScreen::FieldTop() const {
    const double width = std::max(1.0, width_ - Rem(2.0 * kSafeXRem));
    const int columns = std::max(1, static_cast<int>((width + Rem(kTileGapRem)) / Rem(kTileWidthRem + kTileGapRem)));
    const std::size_t count = view_.profiles.size() + (view_.profiles.size() < view_.max && !creating_ ? 1 : 0);
    const int rows = std::max(1, (static_cast<int>(count) + columns - 1) / columns);
    return Rem(kFieldTopRem + static_cast<double>(rows - 1) * (kFieldTopRem - kTilesTopRem));
}

double ProfilesScreen::ContentHeight() const {
    return FieldTop() + Rem((creating_ ? 9.5 : 0.0) + kButtonHeightRem + 3.0);
}

void ProfilesScreen::PaintContent(Painter& painter, double scroll) const {
    const double next = PaintHeader(painter, Rem(kProfilesTopRem) - scroll, "TVM Stream", "Who's watching?",
                                    "Profiles are only for TVM Stream. Continue watching stays on the person you pick.");
    if (!view_.message.empty()) {
        painter.Text(Box{Rem(kSafeXRem), next + Rem(0.2), width_ - Rem(2.0 * kSafeXRem), Rem(1.5)}, view_.message,
                     TextStyle{Rem(1.0), true, 600}, tokens::kAccentStrong);
    }
    if (creating_) {
        // `.token-field`: the label, then the field, typed into from the keyboard.
        const double x = Rem(kSafeXRem);
        const double top = FieldTop() - scroll;
        painter.Text(Box{x, top, Rem(30.0), Rem(1.4)}, "Profile name", TextStyle{Rem(0.9), true, 600}, tokens::kTextMuted);
        const Box field{x, top + Rem(1.6), std::min(Rem(30.0), width_ - 2.0 * x), Rem(3.0)};
        painter.FillRoundRect(field, Rem(0.6), tokens::kSurface);
        painter.StrokeRoundRect(field, Rem(0.6), Rem(kFocusRingWidthRem), tokens::kFocusRing);
        const TextStyle style{Rem(1.15), false, 500};
        if (name_.empty()) {
            painter.Text(Box{field.x + Rem(1.0), field.y, field.width, field.height}, "Name, then press OK", style,
                         tokens::kTextFaint);
        } else {
            const double width = painter.MeasureText(name_, style);
            painter.Text(Box{field.x + Rem(1.0), field.y, field.width - Rem(2.0), field.height}, name_, style, tokens::kText);
            painter.FillRoundRect(Box{std::min(field.x + Rem(1.0) + width + 2.0, field.Right() - Rem(1.0)),
                                      field.y + field.height * 0.25, 2.0, field.height * 0.5},
                                  0.0, tokens::kText);
        }
    }
}

void ProfilesScreen::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    // `.profile-tile__pick`: the orb with the profile's initial, its name under it, and a soft accent fill on focus.
    if (focused) painter.FillRoundRect(box, Rem(0.9), Rgb(0x6EC8FF, 0.24));
    const double orb = Rem(kOrbRem);
    const Box circle{box.CenterX() - orb / 2.0, box.y + Rem(0.6), orb, orb};
    const bool add = button.key == "profile-add";
    if (add) {
        painter.StrokeRoundRect(circle, orb / 2.0, 2.0, tokens::kTextFaint);
    } else {
        const auto profile = std::find_if(view_.profiles.begin(), view_.profiles.end(),
                                          [&](const ProfileEntry& p) { return "pick:" + p.id == button.key; });
        const Color fill = profile == view_.profiles.end() ? tokens::kSurface : HueColor(profile->hue);
        painter.FillRoundRect(circle, orb / 2.0, fill);
        if (profile != view_.profiles.end() && profile->id == view_.activeId) {
            painter.StrokeRoundRect(Box{circle.x - 3.0, circle.y - 3.0, circle.width + 6.0, circle.height + 6.0},
                                    orb / 2.0 + 3.0, 2.0, tokens::kText);
        }
    }
    std::string initial = add ? "+" : button.label.substr(0, 1);
    if (!initial.empty() && initial[0] >= 'a' && initial[0] <= 'z') initial[0] = static_cast<char>(initial[0] - 32);
    const TextStyle initialStyle{Rem(add ? 3.0 : 2.6), true, 750};
    const double initialWidth = painter.MeasureText(initial, initialStyle);
    painter.Text(Box{circle.CenterX() - initialWidth / 2.0, circle.y, initialWidth + 2.0, circle.height}, initial,
                 initialStyle, add ? tokens::kTextMuted : Rgb(0xFFFFFF));
    const TextStyle nameStyle{Rem(1.0), true, 600};
    const double nameWidth = std::min(painter.MeasureText(button.label, nameStyle), box.width - Rem(0.4));
    painter.Text(Box{box.CenterX() - nameWidth / 2.0, circle.Bottom() + Rem(0.6), nameWidth + 2.0, Rem(1.6)},
                 button.label, nameStyle, focused ? tokens::kText : tokens::kTextMuted);
}

std::optional<Command> ProfilesScreen::Activate(const std::string& key) {
    Command command;
    command.action = true;
    if (key.rfind("pick:", 0) == 0) {
        command.name = "profile-open";
        command.params["id"] = key.substr(5);
        return command;
    }
    if (key.rfind("remove:", 0) == 0) {
        command.name = "profile-remove";
        command.params["id"] = key.substr(7);
        return command;
    }
    if (key == "profile-add") {
        creating_ = true;
        name_.clear();
        focused_ = "profile-save";
        return std::nullopt;
    }
    if (key == "profile-cancel") {
        creating_ = false;
        focused_ = "profile-add";
        return std::nullopt;
    }
    if (key == "profile-save") {
        command.name = "profile-create";
        command.params["name"] = name_;
        creating_ = false;
        name_.clear();
        return command;
    }
    if (key == "profiles-back") {
        command.name = "back";
        return command;
    }
    return std::nullopt;
}

// ------------------------------------------------------------------ Plans

namespace {

constexpr double kPlanCadenceAnimMs = 400.0;

struct CompareRow {
    std::string feature;
    std::string stream;
    std::string streamLive;
};

}  // namespace

PlansScreen::PlansScreen() {
    width_ = 1280.0;
    height_ = 720.0;
    view_.tiers = coreapi::DefaultTiersDocument();
    Arrange();
    const std::string rec = RecommendedTierId();
    KeepFocus(rec.empty() ? std::string("donate") : ("plan:" + rec));
}

void PlansScreen::SetView(PlansView view) {
    const std::string prevCadence = view_.cadence;
    view_ = std::move(view);
    if (view_.tiers.tiers.empty()) view_.tiers = coreapi::DefaultTiersDocument();
    if (view_.cadence != "year") view_.cadence = "month";
    const double targetPos = (view_.cadence == "year" && HasYearlyPricing()) ? 1.0 : 0.0;
    if (view_.cadence != prevCadence && width_ > 0.0) {
        const double ms = motion::PrefersReducedMotion(motion_) ? 0.0 : kPlanCadenceAnimMs;
        cadenceTween_ = motion::Tween(cadencePos_, targetPos, clockMs_, ms);
    } else if (!cadenceTween_.has_value()) {
        cadencePos_ = targetPos;
    }
    if (focused_ == "cadence:month" || focused_ == "cadence:year") {
        focused_ = "cadence:" + view_.cadence;
    }
    Arrange();
    const std::string rec = RecommendedTierId();
    KeepFocus(rec.empty() ? std::string("donate") : ("plan:" + rec));
}

void PlansScreen::Layout(double width, double height) {
    PageScreen::Layout(width, height);
    Arrange();
}

bool PlansScreen::Tick(double nowMs) {
    const bool base = PageScreen::Tick(nowMs);
    if (cadenceTween_.has_value()) {
        cadencePos_ = cadenceTween_->Value(nowMs);
        if (cadenceTween_->Done(nowMs)) {
            cadencePos_ = cadenceTween_->target();
            cadenceTween_.reset();
        }
    }
    return base || cadenceTween_.has_value();
}

bool PlansScreen::Animating() const {
    return PageScreen::Animating() || cadenceTween_.has_value();
}

double PlansScreen::ScaleRem() const {
    if (width_ <= 0.0 || height_ <= 0.0) return 16.0;
    return std::clamp(height_ / 67.5, 13.0, 18.0);
}

std::string PlansScreen::RecommendedTierId() const {
    for (const coreapi::AccessTier& tier : view_.tiers.tiers) {
        if (tier.id == "stream-live" && tier.orderable) return tier.id;
    }
    for (const coreapi::AccessTier& tier : view_.tiers.tiers) {
        if (tier.orderable) return tier.id;
    }
    return {};
}

bool PlansScreen::HasYearlyPricing() const {
    for (const coreapi::AccessTier& tier : view_.tiers.tiers) {
        if (tier.yearlyPence > 0) return true;
    }
    return false;
}

int PlansScreen::SavingsPercent() const {
    for (const coreapi::AccessTier& tier : view_.tiers.tiers) {
        if (tier.monthlyPence > 0 && tier.yearlyPence > 0) {
            const int annualAtMonthly = tier.monthlyPence * 12;
            const int saved = 100 - static_cast<int>(std::llround(100.0 * tier.yearlyPence / annualAtMonthly));
            if (saved > 0) return saved;
        }
    }
    return 0;
}

void PlansScreen::Arrange() {
    buttons_.clear();
    cardBoxes_.clear();
    segmentedBox_ = Box{};
    compareTableBox_ = Box{};
    if (width_ <= 0.0 || height_ <= 0.0) return;

    const double scale = ScaleRem();
    const double buttonH = height_ < 800.0 ? 44.0 : 48.0;
    const double minX = std::max(Rem(kSafeXRem + 3.0), scale * 4.2);
    const double maxWidth = std::clamp(scale * 56.0, 680.0, width_ - minX - std::max(Rem(kSafeXRem), scale * 2.0));
    const double x = std::max(minX, (width_ - maxWidth) / 2.0);
    const double cardPad = height_ < 800.0 ? scale * 1.25 : scale * 1.55;

    double y = std::max(Rem(kSafeYRem), scale * 1.15);
    y += scale * 2.55;
    y += WrappedHeight(maxWidth, scale * 0.96, scale * 1.38,
                       "Nothing to buy inside the app \xE2\x80\x94 access is arranged with the app owner, and no card is taken here.");
    y += scale * 0.45;

    if (view_.account.signedIn) {
        y += scale * 1.45;
    }
    if (!view_.choiceNote.empty() || !view_.choiceError.empty()) {
        const std::string& note = !view_.choiceError.empty() ? view_.choiceError : view_.choiceNote;
        y += WrappedHeight(maxWidth - scale * 2.0, scale * 0.92, scale * 1.35, note) + scale * 1.6;
    }

    int row = 0;
    const bool showYearly = HasYearlyPricing();
    if (showYearly) {
        const double segW = std::min(maxWidth, scale * 24.0);
        const double segH = height_ < 800.0 ? 42.0 : 44.0;
        segmentedBox_ = Box{x, y, segW, segH};
        PageButton monthBtn;
        monthBtn.key = "cadence:month";
        monthBtn.label = "Monthly";
        monthBtn.box = Box{x + 3.0, y + 3.0, segW / 2.0 - 3.0, segH - 6.0};
        monthBtn.row = row;
        monthBtn.custom = true;
        buttons_.push_back(std::move(monthBtn));

        PageButton yearBtn;
        yearBtn.key = "cadence:year";
        const int save = SavingsPercent();
        yearBtn.label = save > 0 ? ("Yearly \xC2\xB7 Save " + std::to_string(save) + "%") : "Yearly";
        yearBtn.box = Box{x + segW / 2.0, y + 3.0, segW / 2.0 - 3.0, segH - 6.0};
        yearBtn.row = row;
        yearBtn.custom = true;
        buttons_.push_back(std::move(yearBtn));

        y += segH + scale * 1.05;
        ++row;
    }

    const bool stacked = CompactViewport(width_, height_) || maxWidth < scale * 38.0;
    const double cardGap = scale * 1.25;
    const double cardW = stacked ? maxWidth : (maxWidth - cardGap) / 2.0;
    const std::string recommended = RecommendedTierId();

    double maxCardH = 0.0;
    for (const coreapi::AccessTier& tier : view_.tiers.tiers) {
        double h = cardPad;
        h += scale * 1.5;
        h += scale * 1.75;
        h += scale * 1.35;
        h += scale * 2.75;
        if (tier.liveIncluded && ((view_.cadence == "year" ? tier.liveAddOnYearlyPence : tier.liveAddOnMonthlyPence) > 0)) {
            h += scale * 1.3;
        }
        h += scale * 1.0;
        for (const std::string& bullet : tier.bullets) {
            h += WrappedHeight(cardW - scale * 4.2, scale * 0.9, scale * 1.3, bullet) + scale * 0.35;
        }
        h += scale * 0.55;
        h += WrappedHeight(cardW - cardPad * 2.0, scale * 0.82, scale * 1.18, tier.finePrint) + scale * 0.9;
        h += buttonH + cardPad;
        maxCardH = std::max(maxCardH, h);
    }

    for (std::size_t i = 0; i < view_.tiers.tiers.size(); ++i) {
        const coreapi::AccessTier& tier = view_.tiers.tiers[i];
        const double cx = stacked ? x : x + static_cast<double>(i) * (cardW + cardGap);
        const double cy = stacked ? y + static_cast<double>(i) * (maxCardH + cardGap) : y;
        const Box card{cx, cy, cardW, maxCardH};
        cardBoxes_.push_back(card);

        const bool isCurrent = view_.account.signedIn && view_.account.tier == tier.id;
        PageButton cta;
        cta.key = "plan:" + tier.id;
        cta.custom = true;
        if (!tier.orderable) {
            cta.label = "Coming soon";
            cta.disabled = true;
        } else if (isCurrent) {
            cta.label = "Current plan";
            cta.disabled = true;
        } else {
            cta.label = view_.busy ? "Saving\xE2\x80\xA6" : ("Choose " + tier.name);
            cta.primary = (tier.id == recommended);
            cta.disabled = view_.busy;
        }
        cta.box = Box{card.x + cardPad, card.Bottom() - cardPad - buttonH, card.width - 2.0 * cardPad, buttonH};
        cta.row = stacked ? (row + static_cast<int>(i)) : row;
        buttons_.push_back(std::move(cta));
    }

    if (!view_.tiers.tiers.empty()) {
        y += stacked ? (static_cast<double>(view_.tiers.tiers.size()) * maxCardH +
                        static_cast<double>(view_.tiers.tiers.size() - 1) * cardGap)
                     : maxCardH;
        row += stacked ? static_cast<int>(view_.tiers.tiers.size()) : 1;
    }

    y += scale * 0.9;
    PageButton compareBtn;
    compareBtn.key = "plans:compare";
    compareBtn.label = view_.compareOpen ? "Hide comparison" : "Compare everything";
    const double cmpW = std::min(maxWidth * 0.5, scale * 11.5);
    compareBtn.box = Box{x + maxWidth - cmpW, y - scale * 0.15, cmpW, std::max(34.0, scale * 2.0)};
    compareBtn.row = row++;
    compareBtn.custom = true;
    buttons_.push_back(std::move(compareBtn));
    y += scale * 2.05;

    if (view_.compareOpen) {
        const double tableH = scale * (2.6 + 6.0 * 2.45);
        compareTableBox_ = Box{x, y, maxWidth, tableH};
        y += tableH + scale * 1.4;
    } else {
        y += scale * 0.45;
    }

    donateTop_ = y;
    const double donateParaH = WrappedHeight(std::min(maxWidth, scale * 46.0), scale * 0.88, scale * 1.3,
                                             "A donation is a gift. It does not create an account, activate one, upgrade one or extend one, "
                                             "and nothing in the app changes because you sent it. If you want access, contact the owner \xE2\x80\x94 "
                                             "do not donate and expect it.");
    const double donateBtnY = donateTop_ + scale * 4.75 + donateParaH + scale * 1.0;
    PageButton donateBtn;
    donateBtn.key = "donate";
    donateBtn.label = "Donate";
    donateBtn.box = Box{x, donateBtnY, std::max(scale * 9.0, 128.0), buttonH};
    donateBtn.row = row;
    donateBtn.primary = false;
    donateBtn.custom = true;
    buttons_.push_back(donateBtn);

    PageButton legalLink;
    legalLink.key = "plans-legal";
    legalLink.label = "Privacy & terms";
    legalLink.box = Box{donateBtn.box.Right() + scale * 1.5, donateBtnY, scale * 10.5, buttonH};
    legalLink.row = row;
    legalLink.custom = true;
    buttons_.push_back(std::move(legalLink));

    contentHeight_ = donateBtnY + buttonH + scale * 1.5;
}

void PlansScreen::PaintContent(Painter& painter, double scroll) const {
    if (width_ <= 0.0 || height_ <= 0.0) return;
    const double scale = ScaleRem();
    const double minX = std::max(Rem(kSafeXRem + 3.0), scale * 4.2);
    const double maxWidth = std::clamp(scale * 56.0, 680.0, width_ - minX - std::max(Rem(kSafeXRem), scale * 2.0));
    const double x = std::max(minX, (width_ - maxWidth) / 2.0);
    const double cardPad = height_ < 800.0 ? scale * 1.25 : scale * 1.55;
    double y = std::max(Rem(kSafeYRem), scale * 1.15) - scroll;

    painter.Text(Box{x, y, maxWidth, scale * 2.4}, "Choose your plan", TextStyle{scale * 2.15, true, 750}, tokens::kText);
    y += scale * 2.55;
    const std::string lede =
        "Nothing to buy inside the app \xE2\x80\x94 access is arranged with the app owner, and no card is taken here.";
    const double ledeH = WrappedHeight(maxWidth, scale * 0.96, scale * 1.38, lede);
    painter.Paragraph(Box{x, y, maxWidth, ledeH + scale * 0.3}, lede,
                      TextStyle{scale * 0.96, false}, tokens::kTextMuted);
    y += ledeH + scale * 0.45;

    if (view_.account.signedIn) {
        const std::string note = "Signed in as " + view_.account.email + " \xC2\xB7 Current plan: " +
                                 coreapi::FriendlyPlanName(view_.account.tier);
        painter.Text(Box{x, y, maxWidth, scale * 1.3}, note, TextStyle{scale * 0.88, false}, tokens::kTextFaint);
        y += scale * 1.45;
    }

    if (!view_.choiceNote.empty() || !view_.choiceError.empty()) {
        const bool isErr = !view_.choiceError.empty();
        const std::string& msg = isErr ? view_.choiceError : view_.choiceNote;
        const double msgH = WrappedHeight(maxWidth - scale * 2.0, scale * 0.92, scale * 1.35, msg);
        const Box banner{x, y, maxWidth, msgH + scale * 1.1};
        painter.FillRoundRect(banner, scale * 0.75, isErr ? Rgb(0xEF4444, 0.16) : Rgb(0x2F6BFF, 0.16));
        painter.StrokeRoundRect(banner, scale * 0.75, 1.0, isErr ? Rgb(0xF87171, 0.48) : Rgb(0x2F6BFF, 0.48));
        painter.Paragraph(Box{banner.x + scale, banner.y + scale * 0.55, banner.width - scale * 2.0, msgH + 4.0},
                          msg, TextStyle{scale * 0.92, false}, isErr ? Rgb(0xFCA5A5) : tokens::kText);
    }

    if (segmentedBox_.width > 0.0) {
        const Box seg = Shifted(segmentedBox_, scroll);
        GlassStyle trackStyle = glass::NavCapsule();
        trackStyle.tint = Rgb(0xFFFFFF, 0.05);
        painter.Glass(seg, seg.height / 2.0, trackStyle);

        const double thumbW = seg.width / 2.0 - 4.0;
        const double thumbX = seg.x + 3.0 + cadencePos_ * (seg.width / 2.0 - 2.0);
        const Box thumb{thumbX, seg.y + 3.0, thumbW, seg.height - 6.0};
        painter.FillRoundRect(thumb, thumb.height / 2.0, Rgb(0xFFFFFF, 0.18));
        painter.StrokeRoundRect(thumb, thumb.height / 2.0, 1.0, Rgb(0xFFFFFF, 0.30));
    }

    const std::string recommended = RecommendedTierId();
    const bool yearly = view_.cadence == "year";
    for (std::size_t i = 0; i < view_.tiers.tiers.size() && i < cardBoxes_.size(); ++i) {
        const coreapi::AccessTier& tier = view_.tiers.tiers[i];
        const Box card = Shifted(cardBoxes_[i], scroll);
        const bool isCurrent = view_.account.signedIn && view_.account.tier == tier.id;
        const bool isRec = tier.id == recommended;

        GlassStyle cardStyle = glass::SheetPanel();
        cardStyle.kind = GlassKind::Card;
        if (isRec) {
            cardStyle.tint = Rgb(0x2F6BFF, 0.09);
            cardStyle.border = Rgb(0x2F6BFF, 0.85);
        } else {
            cardStyle.tint = tokens::kSurface;
            cardStyle.border = tokens::kGlassBorder;
        }
        painter.Glass(card, scale * 1.5, cardStyle);
        if (isRec) painter.StrokeRoundRect(card, scale * 1.5, 2.0, Rgb(0x2F6BFF, 0.9));

        const double ix = card.x + cardPad;
        const double iw = card.width - 2.0 * cardPad;
        double cy = card.y + cardPad;

        if (isCurrent) {
            const std::string badge = "Your plan";
            const double bw = painter.MeasureText(badge, TextStyle{scale * 0.76, true, 700}) + scale * 1.1;
            const Box bb{ix, cy, bw, scale * 1.35};
            painter.FillRoundRect(bb, bb.height / 2.0, Rgb(0x10B981, 0.22));
            painter.StrokeRoundRect(bb, bb.height / 2.0, 1.0, Rgb(0x34D399, 0.45));
            painter.Text(Box{bb.x + scale * 0.55, bb.y, bw - scale, bb.height}, badge, TextStyle{scale * 0.76, true, 700},
                         Rgb(0x6EE7B7));
        } else if (isRec) {
            const std::string badge = "Most popular";
            const double bw = painter.MeasureText(badge, TextStyle{scale * 0.76, true, 700}) + scale * 1.1;
            const Box bb{ix, cy, bw, scale * 1.35};
            painter.FillRoundRect(bb, bb.height / 2.0, Rgb(0x2F6BFF, 0.25));
            painter.StrokeRoundRect(bb, bb.height / 2.0, 1.0, Rgb(0x60A5FA, 0.5));
            painter.Text(Box{bb.x + scale * 0.55, bb.y, bw - scale, bb.height}, badge, TextStyle{scale * 0.76, true, 700},
                         Rgb(0x93C5FD));
        }
        cy += scale * 1.5;

        painter.Text(Box{ix, cy, iw, scale * 1.7}, tier.name, TextStyle{scale * 1.3, true, 750}, tokens::kText);
        cy += scale * 1.75;
        painter.Text(Box{ix, cy, iw, scale * 1.25}, tier.tag, TextStyle{scale * 0.88, false}, tokens::kTextMuted);
        cy += scale * 1.35;

        const int pence = yearly && tier.yearlyPence > 0 ? tier.yearlyPence : tier.monthlyPence;
        const std::string amount = FormatPounds(pence);
        const TextStyle amountStyle{scale * 2.15, true, 800};
        const double amountW = painter.MeasureText(amount, amountStyle);
        painter.Text(Box{ix, cy, amountW + 4.0, scale * 2.45}, amount, amountStyle, tokens::kText);
        painter.Text(Box{ix + amountW + scale * 0.35, cy + scale * 0.55, iw - amountW, scale * 1.5},
                     yearly ? "/year" : "/month", TextStyle{scale * 0.92, false}, tokens::kTextMuted);
        cy += scale * 2.75;

        const int livePence = yearly ? tier.liveAddOnYearlyPence : tier.liveAddOnMonthlyPence;
        if (tier.liveIncluded && livePence > 0) {
            painter.Text(Box{ix, cy, iw, scale * 1.2}, "inc " + FormatPounds(livePence) + " Live TV add-on",
                         TextStyle{scale * 0.84, false}, tokens::kTextMuted);
            cy += scale * 1.3;
        }

        painter.FillRoundRect(Box{ix, cy + scale * 0.2, iw, 1.0}, 0.0, tokens::kBorderSoft);
        cy += scale * 1.0;

        for (const std::string& bullet : tier.bullets) {
            DrawCheckIcon(painter, Box{ix, cy + scale * 0.14, scale * 1.0, scale * 1.0}, Rgb(0x60A5FA), 2.3);
            const double bh = WrappedHeight(iw - scale * 1.35, scale * 0.9, scale * 1.3, bullet);
            painter.Paragraph(Box{ix + scale * 1.35, cy, iw - scale * 1.35, bh + 4.0}, bullet,
                              TextStyle{scale * 0.9, false}, tokens::kText);
            cy += bh + scale * 0.35;
        }
        cy += scale * 0.55;
        const double fpH = WrappedHeight(iw, scale * 0.82, scale * 1.18, tier.finePrint);
        painter.Paragraph(Box{ix, cy, iw, fpH + 4.0}, tier.finePrint, TextStyle{scale * 0.82, false}, tokens::kTextFaint);
    }

    if (const auto cmp = BoxOf("plans:compare")) {
        painter.Text(Box{x, cmp->y, maxWidth * 0.5, cmp->height}, "Taxes may apply.",
                     TextStyle{scale * 0.85, false}, tokens::kTextFaint);
    }

    if (view_.compareOpen && compareTableBox_.width > 0.0) {
        const Box tbl = Shifted(compareTableBox_, scroll);
        GlassStyle tblStyle = glass::SheetPanel();
        tblStyle.tint = tokens::kSurface;
        painter.Glass(tbl, scale * 1.25, tblStyle);

        const std::string streamName = view_.tiers.tiers.size() > 0 ? view_.tiers.tiers[0].name : "Stream";
        const std::string liveName = view_.tiers.tiers.size() > 1 ? view_.tiers.tiers[1].name : "Stream + Live";
        const int streamPence = view_.tiers.tiers.size() > 0
                                    ? (yearly && view_.tiers.tiers[0].yearlyPence > 0 ? view_.tiers.tiers[0].yearlyPence : view_.tiers.tiers[0].monthlyPence)
                                    : 1000;
        const int livePence = view_.tiers.tiers.size() > 1
                                  ? (yearly && view_.tiers.tiers[1].yearlyPence > 0 ? view_.tiers.tiers[1].yearlyPence : view_.tiers.tiers[1].monthlyPence)
                                  : 1700;
        const std::vector<CompareRow> rows = {
            {"Movies & TV shows", "Yes", "Yes"},
            {"Household profiles", "Up to 10", "Up to 10"},
            {"Offline downloads", "Yes", "Yes"},
            {"Real-Debrid support", "Yes", "Yes"},
            {"Live UK channels", "\xE2\x80\x94", "Yes"},
            {"Price (" + std::string(yearly ? "yearly" : "monthly") + ")", FormatPounds(streamPence), FormatPounds(livePence)},
        };
        const double col0 = tbl.x + scale * 1.5;
        const double col1 = tbl.x + tbl.width * 0.52;
        const double col2 = tbl.x + tbl.width * 0.76;
        const double hdrH = scale * 2.5;
        painter.Text(Box{col0, tbl.y, tbl.width * 0.48, hdrH}, "Feature", TextStyle{scale * 0.88, true, 700}, tokens::kTextMuted);
        painter.Text(Box{col1, tbl.y, tbl.width * 0.22, hdrH}, streamName, TextStyle{scale * 0.88, true, 700}, tokens::kText);
        painter.Text(Box{col2, tbl.y, tbl.width * 0.22, hdrH}, liveName, TextStyle{scale * 0.88, true, 700}, Rgb(0x93C5FD));
        double ry = tbl.y + hdrH;
        const double rowH = scale * 2.45;
        for (const CompareRow& r : rows) {
            painter.FillRoundRect(Box{tbl.x + scale * 1.2, ry, tbl.width - scale * 2.4, 1.0}, 0.0, tokens::kBorderSoft);
            painter.Text(Box{col0, ry, tbl.width * 0.48, rowH}, r.feature, TextStyle{scale * 0.88, false}, tokens::kTextMuted);
            painter.Text(Box{col1, ry, tbl.width * 0.22, rowH}, r.stream, TextStyle{scale * 0.88, true, 600}, tokens::kText);
            painter.Text(Box{col2, ry, tbl.width * 0.22, rowH}, r.streamLive, TextStyle{scale * 0.88, true, 600}, tokens::kText);
            ry += rowH;
        }
    }

    const double donate = donateTop_ - scroll;
    painter.FillRoundRect(Box{x, donate, maxWidth, 1.0}, 0.0, tokens::kBorderSoft);
    painter.Text(Box{x, donate + scale * 1.15, maxWidth, scale * 1.65}, "Donate to the app owner",
                 TextStyle{scale * 1.2, true, 700}, tokens::kText);
    painter.Text(Box{x, donate + scale * 2.95, maxWidth, scale * 1.3}, "Optional, and it gives you nothing.",
                 TextStyle{scale * 0.92, true, 600}, tokens::kTextMuted);
    const std::string donateBody =
        "A donation is a gift. It does not create an account, activate one, upgrade one or extend one, "
        "and nothing in the app changes because you sent it. If you want access, contact the owner \xE2\x80\x94 "
        "do not donate and expect it.";
    const double donateParaH = WrappedHeight(std::min(maxWidth, scale * 46.0), scale * 0.88, scale * 1.3, donateBody);
    painter.Paragraph(Box{x, donate + scale * 4.55, std::min(maxWidth, scale * 46.0), donateParaH + 4.0},
                      donateBody, TextStyle{scale * 0.88, false}, tokens::kTextFaint);
}

void PlansScreen::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    const double scale = ScaleRem();
    if (button.key.rfind("plan:", 0) == 0 || button.key == "donate") {
        DrawActionPill(painter, scale, box, button.label, button.primary, button.disabled, focused, FocusAmount(button.key));
        return;
    }
    if (button.key == "cadence:month" || button.key == "cadence:year") {
        const bool selected = (button.key == "cadence:year") ? (view_.cadence == "year") : (view_.cadence != "year");
        const double focus = std::max(FocusAmount(button.key), focused ? 1.0 : 0.0);
        const TextStyle style{scale * 0.88, true, selected ? 700 : 600};
        const double tw = painter.MeasureText(button.label, style);
        const Color ink = selected ? Rgb(0xFFFFFF, 0.98) : Mix(tokens::kTextMuted, tokens::kText, focus);
        painter.Text(Box{box.CenterX() - tw / 2.0, box.y, tw + 2.0, box.height}, button.label, style, ink);
        if (focused && !selected) {
            painter.StrokeRoundRect(box, box.height / 2.0, 1.5, tokens::kFocusRing);
        }
        return;
    }

    // Quiet text links: "Compare everything" / "Privacy & terms"
    const double focus = std::max(FocusAmount(button.key), focused ? 1.0 : 0.0);
    const bool rightAlign = button.key == "plans:compare";
    const TextStyle style{scale * 0.9, true, 600};
    const double tw = std::min(box.width, painter.MeasureText(button.label, style));
    const double tx = rightAlign ? (box.Right() - tw) : box.x;
    const Color ink = Mix(tokens::kAccentStrong, tokens::kText, focus * 0.45);
    painter.Text(Box{tx, box.y, tw + 2.0, box.height}, button.label, style, ink);
    if (focus > 0.05) {
        painter.FillRoundRect(Box{tx, box.CenterY() + scale * 0.65, tw, 1.5}, 0.0, WithAlphaOf(ink, 0.65 + 0.35 * focus));
    }
    if (focused) {
        painter.StrokeRoundRect(Box{tx - scale * 0.4, box.CenterY() - scale * 0.95, tw + scale * 0.8, scale * 1.9},
                                scale * 0.45, 1.5, WithAlphaOf(tokens::kFocusRing, 0.85));
    }
}

std::optional<Command> PlansScreen::Activate(const std::string& key) {
    if (key == "cadence:month" || key == "cadence:year") {
        const std::string next = key == "cadence:year" ? "year" : "month";
        if (next != view_.cadence) {
            view_.cadence = next;
            const double targetPos = (view_.cadence == "year" && HasYearlyPricing()) ? 1.0 : 0.0;
            const double ms = motion::PrefersReducedMotion(motion_) ? 0.0 : kPlanCadenceAnimMs;
            cadenceTween_ = motion::Tween(cadencePos_, targetPos, clockMs_, ms);
            Arrange();
        }
        return std::nullopt;
    }
    if (key == "plans:compare") {
        view_.compareOpen = !view_.compareOpen;
        Arrange();
        return std::nullopt;
    }
    if (key.rfind("plan:", 0) == 0) {
        Command command;
        command.name = "plans-choose";
        command.action = true;
        command.params["tier"] = key.substr(5);
        command.params["cadence"] = view_.cadence;
        return command;
    }
    Command command;
    if (key == "donate") {
        command.name = "donate";
        return command;
    }
    if (key == "plans-legal") {
        command.name = "legal";
        return command;
    }
    return std::nullopt;
}

// ------------------------------------------------------------------ Updates

namespace {

constexpr double kRowsTopRem = 11.4;
constexpr double kRowPitchRem = 3.0;
constexpr double kRowHeightRem = 2.5;
constexpr double kUpdateButtonsTopRem = 26.4;
constexpr double kChangesTopRem = 31.0;
constexpr double kChangeRowRem = 1.75;

}  // namespace

UpdatesScreen::UpdatesScreen() {
    focused_ = "check";
}

void UpdatesScreen::SetView(UpdatesView view) {
    view_ = std::move(view);
    KeepFocus("check");
}

std::vector<PageButton> UpdatesScreen::Buttons() const {
    std::vector<PageButton> buttons;
    Row(buttons, Rem(kSafeXRem), Rem(kUpdateButtonsTopRem), Rem(kButtonHeightRem), ViewportRem(width_, height_), 0,
        {{"check", view_.busy ? "Checking\xE2\x80\xA6" : "Check now"},
         {"download", "Install update"},
         {"auto-update", view_.autoUpdate ? "Automatic checks on" : "Automatic checks off"},
         {"back", "Back"}}, width_ - Rem(2.0 * kSafeXRem));
    // Check now keeps the focus while it works, and ignores presses until the answer is in.
    buttons[0].primary = true;
    return buttons;
}

double UpdatesScreen::ContentHeight() const {
    return ChangesTop() + Rem(2.0 + static_cast<double>(view_.changes.size()) * kChangeRowRem + 2.0);
}

double UpdatesScreen::ChangesTop() const {
    return std::max(Rem(kChangesTopRem), Buttons().back().box.Bottom() + Rem(2.0));
}

void UpdatesScreen::PaintContent(Painter& painter, double scroll) const {
    PaintHeader(painter, Rem(kSafeYRem) - scroll, "GLogic Studios", "Updates",
                "Updates come from GitHub (GL-327/TVM). Install update verifies the download, then restarts the desktop. "
                "Source checkouts use git pull and a native rebuild.");
    const double x = Rem(kSafeXRem);
    const double width = std::min(width_ - 2.0 * x, Rem(64.0));
    const std::vector<std::pair<std::string, std::string>> rows = {
        {"This box", "v" + view_.version + " \xC2\xB7 native"},
        {"Last check", view_.lastCheck.empty() ? "Never" : view_.lastCheck},
        {"Available", view_.available.empty() ? "None" : view_.available},
        {"GitHub login", "Not required"},
    };
    double top = Rem(kRowsTopRem) - scroll;
    for (const auto& [label, value] : rows) {
        const Box row{x, top, width, Rem(kRowHeightRem)};
        GlassStyle rowGlass;
        rowGlass.kind = GlassKind::Panel;
        rowGlass.reduceTransparency = tokens::reduceTransparency;
        rowGlass.tint = tokens::kSurface;
        painter.Glass(row, Rem(0.65), rowGlass);
        painter.Text(Box{row.x + Rem(1.0), row.y, Rem(16.0), row.height}, label, TextStyle{Rem(1.0625), false},
                     tokens::kTextMuted);
        painter.Text(Box{row.x + Rem(16.0), row.y, row.width - Rem(17.0), row.height}, value, TextStyle{Rem(1.0625), false},
                     tokens::kText);
        top += Rem(kRowPitchRem);
    }
    if (!view_.message.empty()) {
        painter.Text(Box{x, top + Rem(0.15), width, Rem(1.5)}, view_.message, TextStyle{Rem(1.0), true, 600},
                     tokens::kTextMuted);
    }
    if (view_.changes.empty()) return;
    // The changelog, "What's new": the latest changes, newest first.
    double y = ChangesTop() - scroll;
    painter.Text(Box{x, y, width, Rem(1.6)}, "What's new", TextStyle{Rem(1.25), true, 700}, tokens::kText);
    y += Rem(2.0);
    for (const std::string& change : view_.changes) {
        painter.FillRoundRect(Box{x + Rem(0.2), y + Rem(0.7), Rem(0.32), Rem(0.32)}, Rem(0.16), tokens::kAccentStrong);
        painter.Text(Box{x + Rem(1.0), y, width - Rem(1.0), Rem(1.6)}, change, TextStyle{Rem(0.95), false},
                     tokens::kTextMuted);
        y += Rem(kChangeRowRem);
    }
}

// ------------------------------------------------------------------ info pages

namespace {

constexpr double kInfoWidthRem = 64.0;
constexpr double kTileWidthRemInfo = 12.0;
constexpr double kTileHeightRemInfo = 6.75;
constexpr double kInfoRowRem = 2.5;
constexpr double kInfoRowPitchRem = 2.9;

// How many lines a paragraph wraps to, estimated from its length, since layout comes before painting.
double Lines(const std::string& text, double sizeRem, double widthRem) {
    const double perLine = std::max(1.0, widthRem / (0.5 * sizeRem));
    return std::max(1.0, std::ceil(static_cast<double>(text.size()) / perLine));
}

// White words on a dark tile, dark words on a light one.
Color InkOn(const Color& tile) {
    const double light = 0.2126 * tile.r + 0.7152 * tile.g + 0.0722 * tile.b;
    return light > 0.6 ? Rgb(0x111111) : Rgb(0xFFFFFF);
}

}  // namespace

void InfoScreen::SetView(InfoView view) {
    const bool fieldGone = view_.field && !view.field;
    view_ = std::move(view);
    if (fieldGone) fieldText_.clear();
    Arrange();
    std::string first;
    // The page opens on its tiles, else its first button from the top, as the web pages' default focus does.
    if (!view_.tiles.empty()) first = view_.tiles.front().key;
    else if (!view_.topActions.empty()) first = view_.topActions.front().key;
    else if (!view_.filters.empty() && !view_.filters.front().empty()) first = view_.filters.front().front().key;
    else if (!view_.actions.empty() && !view_.actions.front().empty()) first = view_.actions.front().front().key;
    KeepFocus(first);
}

void InfoScreen::Layout(double width, double height) {
    PageScreen::Layout(width, height);
    Arrange();
}

void InfoScreen::Type(const std::string& text) {
    if (view_.field) fieldText_ += text;
}

void InfoScreen::Erase() {
    if (fieldText_.empty()) return;
    std::size_t cut = fieldText_.size() - 1;
    while (cut > 0 && (static_cast<unsigned char>(fieldText_[cut]) & 0xC0) == 0x80) --cut;
    fieldText_.erase(cut);
}

void InfoScreen::Arrange() {
    buttons_.clear();
    placed_.clear();
    cardBox_ = Box{};
    if (height_ <= 0.0) return;
    const double rem = ViewportRem(width_, height_);

    if (view_.centeredCard) {
        const double outerMargin = Rem(2.5);
        const double cardWidth = std::min(std::max(Rem(24.0), width_ - 2.0 * outerMargin), Rem(44.0));
        const double cardX = std::max(outerMargin, (width_ - cardWidth) / 2.0);
        const double padX = Rem(2.5);
        const double padY = Rem(2.2);
        const double x = cardX + padX;
        const double innerWidth = std::max(Rem(16.0), cardWidth - 2.0 * padX);
        const double widthRem = innerWidth / rem;
        fieldX_ = x;
        fieldWidth_ = innerWidth;

        // Lay out from y = 0 inside the card, then vertically centre the card in the viewport.
        double y = padY + Rem(4.5);
        int row = 0;

        ledeTop_ = y;
        ledeHeight_ = view_.lede.empty() ? 0.0 : Rem(Lines(view_.lede, 1.0, widthRem) * 1.5);
        y += ledeHeight_ + (view_.lede.empty() ? 0.0 : Rem(1.0));

        const auto addRow = [&](const std::vector<InfoAction>& actions) {
            if (actions.empty()) return;
            FlowLayout flow(x, y, innerWidth, Rem(kButtonGapRem));
            for (const InfoAction& action : actions) {
                PageButton button;
                button.key = action.key;
                button.label = action.label;
                button.primary = action.primary;
                button.disabled = action.disabled;
                const double width = ButtonWidthRem(action.label) * rem;
                button.box = flow.Place(width, std::max(44.0, Rem(kButtonHeightRem)));
                button.row = row + flow.Row();
                buttons_.push_back(std::move(button));
            }
            y = flow.Bottom() + Rem(0.9);
            row += flow.Row() + 1;
        };

        for (const std::vector<InfoAction>& filter : view_.filters) addRow(filter);

        summariesTop_ = y;
        if (!view_.fieldSummaries.empty()) {
            y += static_cast<double>(view_.fieldSummaries.size()) * Rem(2.4) + Rem(0.5);
        }

        messageTop_ = y;
        if (!view_.message.empty()) y += Rem(Lines(view_.message, 1.0, widthRem) * 1.5 + 0.6);

        fieldTop_ = y;
        if (view_.field) y += Rem(1.5 + 3.0 + 1.0);

        for (const InfoBlock& block : view_.blocks) {
            double height = 0.0;
            switch (block.kind) {
            case InfoBlock::Kind::Heading:
                y += Rem(0.5);
                height = Rem(1.9);
                break;
            case InfoBlock::Kind::Paragraph:
                height = Rem(Lines(block.text, 0.98, widthRem) * 1.5);
                break;
            case InfoBlock::Kind::Note:
                height = Rem(Lines(block.text, 0.85, widthRem) * 1.4);
                break;
            case InfoBlock::Kind::Bullet:
                height = Rem(Lines(block.text + "  " + block.value, 0.95, widthRem - 1.2) * 1.5);
                break;
            case InfoBlock::Kind::Row:
                height = Rem(kInfoRowRem);
                break;
            case InfoBlock::Kind::Rule:
                height = Rem(0.6);
                break;
            }
            placed_.push_back(Placed{block, Box{x, y, innerWidth, height}});
            y += height + (block.kind == InfoBlock::Kind::Row ? Rem(kInfoRowPitchRem - kInfoRowRem) : Rem(0.5));
        }
        if (!view_.blocks.empty()) y += Rem(0.6);

        if (!view_.interleaveActions) for (const std::vector<InfoAction>& line : view_.actions) addRow(line);
        addRow(view_.topActions);

        const double totalHeight = y + padY - Rem(0.6);
        const double cardY = std::max(Rem(2.0), (height_ - totalHeight) / 2.0);
        headerTop_ = cardY + padY;
        ledeTop_ += cardY;
        summariesTop_ += cardY;
        messageTop_ += cardY;
        fieldTop_ += cardY;
        for (PageButton& b : buttons_) b.box.y += cardY;
        for (Placed& p : placed_) p.box.y += cardY;
        cardBox_ = Box{cardX, cardY, cardWidth, totalHeight};
        contentHeight_ = cardY + totalHeight + Rem(2.0);
        return;
    }

    const double x = Rem(kSafeXRem);
    const double widthRem = std::min(width_ / rem - 2.0 * kSafeXRem, kInfoWidthRem);
    headerTop_ = Rem(kSafeYRem);
    fieldX_ = x;
    fieldWidth_ = std::min(Rem(widthRem), Rem(36.0));
    double y = Rem(kSafeYRem + 4.8);
    int row = 0;

    ledeTop_ = y;
    ledeHeight_ = view_.lede.empty() ? 0.0 : Rem(Lines(view_.lede, 1.0625, std::min(widthRem, 48.0)) * 1.6);
    y += ledeHeight_ + (view_.lede.empty() ? 0.0 : Rem(1.0));

    const auto addRow = [&](const std::vector<InfoAction>& actions) {
        if (actions.empty()) return;
        FlowLayout flow(x, y, Rem(widthRem), Rem(kButtonGapRem));
        for (const InfoAction& action : actions) {
            PageButton button;
            button.key = action.key;
            button.label = action.label;
            button.primary = action.primary;
            button.disabled = action.disabled;
            const double width = ButtonWidthRem(action.label) * rem;
            button.box = flow.Place(width, std::max(44.0, Rem(kButtonHeightRem)));
            button.row = row + flow.Row();
            buttons_.push_back(std::move(button));
        }
        y = flow.Bottom() + Rem(1.0);
        row += flow.Row() + 1;
    };
    addRow(view_.topActions);
    for (const std::vector<InfoAction>& filter : view_.filters) addRow(filter);

    messageTop_ = y;
    if (!view_.message.empty()) y += Rem(Lines(view_.message, 1.0, widthRem) * 1.55 + 0.6);

    fieldTop_ = y;
    if (view_.field) y += Rem(1.6 + 3.0 + 1.2);

    // The tiles wrap across the page, a row of buttons for the remote per line.
    if (!view_.tiles.empty()) {
        double left = x;
        for (const InfoAction& tile : view_.tiles) {
            if (left + Rem(kTileWidthRemInfo) > x + Rem(widthRem) + 1.0 && left > x) {
                left = x;
                y += Rem(kTileHeightRemInfo + 1.0);
                ++row;
            }
            PageButton button;
            button.key = tile.key;
            button.label = tile.label;
            button.custom = true;
            button.box = Box{left, y, Rem(kTileWidthRemInfo), Rem(kTileHeightRemInfo)};
            button.row = row;
            buttons_.push_back(std::move(button));
            left += Rem(kTileWidthRemInfo + 1.0);
        }
        y += Rem(kTileHeightRemInfo + 1.4);
        ++row;
    }

    std::size_t actionRow = 0;
    for (const InfoBlock& block : view_.blocks) {
        double height = 0.0;
        switch (block.kind) {
        case InfoBlock::Kind::Heading:
            y += Rem(0.6);
            height = Rem(2.0);
            break;
        case InfoBlock::Kind::Paragraph:
            height = Rem(Lines(block.text, 1.0, widthRem) * 1.55);
            break;
        case InfoBlock::Kind::Note:
            height = Rem(Lines(block.text, 0.85, widthRem) * 1.4);
            break;
        case InfoBlock::Kind::Bullet:
            height = Rem(Lines(block.text + "  " + block.value, 0.95, widthRem - 1.2) * 1.5);
            break;
        case InfoBlock::Kind::Row:
            height = Rem(kInfoRowRem);
            break;
        case InfoBlock::Kind::Rule:
            height = Rem(0.6);
            break;
        }
        placed_.push_back(Placed{block, Box{x, y, Rem(widthRem), height}});
        y += height + (block.kind == InfoBlock::Kind::Row ? Rem(kInfoRowPitchRem - kInfoRowRem) : Rem(0.55));
        if (view_.interleaveActions && actionRow < view_.actions.size()) addRow(view_.actions[actionRow++]);
    }
    if (!view_.blocks.empty()) y += Rem(0.8);

    if (!view_.interleaveActions) for (const std::vector<InfoAction>& line : view_.actions) addRow(line);
    contentHeight_ = y + Rem(2.0);
}

void InfoScreen::PaintContent(Painter& painter, double scroll) const {
    if (view_.centeredCard) {
        const Box viewport{0.0, 0.0, width_, height_};
        if (!view_.backdropUrl.empty()) {
            painter.ImageFaded(viewport, view_.backdropUrl, 0.0, 0.42, 0.7, 0.2);
            painter.FillLinearGradient(viewport, 0.0, 0.0, 0.0, height_,
                                       {GradientStop{0.0, WithAlphaOf(tokens::kBackground, 0.35)},
                                        GradientStop{0.55, WithAlphaOf(tokens::kBackground, 0.62)},
                                        GradientStop{1.0, WithAlphaOf(tokens::kBackground, 0.88)}});
            painter.SetBackdrop(viewport, view_.backdropUrl, 0.7, 0.2);
        }
        const Box card = Shifted(cardBox_, scroll);
        painter.Glass(card, Rem(1.5), glass::SheetPanel());

        const double x = fieldX_;
        const double innerWidth = fieldWidth_;
        const double headerY = headerTop_ - scroll;
        painter.Text(Box{x, headerY, innerWidth, Rem(1.2)}, Upper(view_.kicker),
                     TextStyle{Rem(0.8125), true, 750}, tokens::kAccentStrong);
        painter.Text(Box{x, headerY + Rem(1.15), innerWidth, Rem(3.1)}, view_.heading,
                     TextStyle{Rem(2.35), true, 750}, tokens::kText);
        if (!view_.lede.empty()) {
            painter.Paragraph(Box{x, ledeTop_ - scroll, innerWidth, ledeHeight_ + Rem(0.4)}, view_.lede,
                              TextStyle{Rem(1.0), false}, tokens::kTextMuted);
        }
        if (!view_.fieldSummaries.empty()) {
            double sy = summariesTop_ - scroll;
            for (const InfoView::FieldSummary& summary : view_.fieldSummaries) {
                const Box row{x, sy, innerWidth, Rem(2.15)};
                GlassStyle rowGlass;
                rowGlass.kind = GlassKind::Panel;
                rowGlass.focused = summary.active;
                rowGlass.focusAmount = summary.active ? 1.0 : 0.0;
                rowGlass.reduceTransparency = tokens::reduceTransparency;
                rowGlass.tint = summary.active ? tokens::kSurfaceHover : tokens::kSurface;
                painter.Glass(row, Rem(0.6), rowGlass);
                painter.Text(Box{row.x + Rem(0.85), row.y, Rem(8.5), row.height}, summary.label,
                             TextStyle{Rem(0.88), true, 650},
                             summary.active ? tokens::kAccentStrong : tokens::kTextMuted);
                std::string shown = summary.value;
                if (summary.secret && !shown.empty()) {
                    shown.clear();
                    for (std::size_t i = 0; i < summary.value.size(); ++i) {
                        if ((static_cast<unsigned char>(summary.value[i]) & 0xC0) != 0x80) shown += "\xE2\x80\xA2";
                    }
                }
                painter.Text(Box{row.x + Rem(9.5), row.y, std::max(0.0, row.width - Rem(10.35)), row.height},
                             shown.empty() ? (summary.active ? "Typing below..." : "Not entered") : shown,
                             TextStyle{Rem(0.92), false, 500},
                             shown.empty() ? tokens::kTextFaint : tokens::kText);
                sy += Rem(2.4);
            }
        }
    } else {
        const double x = Rem(kSafeXRem);
        PaintHeader(painter, Rem(kSafeYRem) - scroll, view_.kicker, view_.heading, "");
        if (!view_.lede.empty()) {
            painter.Paragraph(Box{x, ledeTop_ - scroll, std::min(width_ - 2.0 * x, Rem(48.0)), ledeHeight_ + Rem(0.4)},
                              view_.lede, TextStyle{Rem(1.0625), false}, tokens::kTextMuted);
        }
    }
    const double x = fieldX_;
    const double widthPx = view_.centeredCard ? fieldWidth_ : std::min(width_ - 2.0 * x, Rem(kInfoWidthRem));
    if (!view_.message.empty()) {
        painter.Paragraph(Box{x, messageTop_ - scroll, widthPx, Rem(Lines(view_.message, 1.0, widthPx / (ViewportRem(width_, height_))) * 1.6)},
                          view_.message, TextStyle{Rem(1.0), true, 600},
                          view_.messageBad ? Rgb(0xFF8A80) : tokens::kAccentStrong);
    }
    if (view_.field) {
        const double top = fieldTop_ - scroll;
        painter.Text(Box{x, top, widthPx, Rem(1.4)}, view_.fieldLabel, TextStyle{Rem(0.9), true, 600}, tokens::kTextMuted);
        const Box box{x, top + Rem(1.6), view_.centeredCard ? fieldWidth_ : std::min(widthPx, Rem(36.0)), Rem(3.0)};
        painter.FillRoundRect({box.x, box.y + 1, box.width, box.height}, Rem(0.75), Rgb(0, 0.35));
        painter.FillRoundRect(box, Rem(0.75), Rgb(0xFFFFFF, 0.06));
        painter.StrokeRoundRect(box, Rem(0.75), 2, Rgb(0x2F6BFF, 0.85));
        const TextStyle style{Rem(1.15), false, 500};
        // A secret is shown as dots, as a password field is.
        std::string shown = fieldText_;
        if (view_.fieldSecret) {
            shown.clear();
            for (std::size_t i = 0; i < fieldText_.size(); ++i) {
                if ((static_cast<unsigned char>(fieldText_[i]) & 0xC0) != 0x80) shown += "\xE2\x80\xA2";
            }
        }
        if (shown.empty()) {
            painter.Text(Box{box.x + Rem(1.0), box.y, box.width, box.height}, view_.fieldPlaceholder, style, tokens::kTextFaint);
        } else {
            const double width = painter.MeasureText(shown, style);
            painter.Text(Box{box.x + Rem(1.0), box.y, box.width - Rem(2.0), box.height}, shown, style, tokens::kText);
            painter.FillRoundRect(Box{std::min(box.x + Rem(1.0) + width + 2.0, box.Right() - Rem(1.0)),
                                      box.y + box.height * 0.25, 2.0, box.height * 0.5},
                                  0.0, tokens::kText);
        }
    }
    for (const Placed& placed : placed_) {
        const Box box{placed.box.x, placed.box.y - scroll, placed.box.width, placed.box.height};
        if (box.Bottom() < 0.0 || box.y > height_) continue;
        const InfoBlock& block = placed.block;
        const Color tone = block.bad ? Rgb(0xFF8A80) : block.good ? tokens::kAccentStrong : tokens::kText;
        switch (block.kind) {
        case InfoBlock::Kind::Heading:
            painter.Text(box, block.text, TextStyle{Rem(1.3), true, 700}, tokens::kText);
            break;
        case InfoBlock::Kind::Paragraph:
            painter.Paragraph(Box{box.x, box.y, box.width, box.height + Rem(0.4)}, block.text, TextStyle{Rem(1.0), false},
                              tokens::kTextMuted);
            break;
        case InfoBlock::Kind::Note:
            painter.Paragraph(Box{box.x, box.y, box.width, box.height + Rem(0.4)}, block.text, TextStyle{Rem(0.85), false},
                              tokens::kTextFaint);
            break;
        case InfoBlock::Kind::Bullet: {
            painter.FillRoundRect(Box{box.x + Rem(0.2), box.y + Rem(0.6), Rem(0.34), Rem(0.34)}, Rem(0.17),
                                  block.bad ? Rgb(0xFF8A80) : block.good ? tokens::kAccentStrong : tokens::kTextFaint);
            const TextStyle style{Rem(0.95), true, 600};
            const double width = std::min(painter.MeasureText(block.text, style), box.width * 0.55);
            painter.Text(Box{box.x + Rem(1.2), box.y, width + 2.0, Rem(1.5)}, block.text, style, tokens::kText);
            if (!block.value.empty()) {
                painter.Text(Box{box.x + Rem(1.8) + width, box.y, box.width - width - Rem(1.8), Rem(1.5)}, block.value,
                             TextStyle{Rem(0.9), false}, block.bad || block.good ? tone : tokens::kTextMuted);
            }
            break;
        }
        case InfoBlock::Kind::Row: {
            GlassStyle rowGlass;
            rowGlass.kind = GlassKind::Panel;
            rowGlass.reduceTransparency = tokens::reduceTransparency;
            rowGlass.tint = tokens::kSurface;
            painter.Glass(box, Rem(0.65), rowGlass);
            painter.Text(Box{box.x + Rem(1.0), box.y, Rem(16.0), box.height}, block.text, TextStyle{Rem(1.0), false},
                         tokens::kTextMuted);
            painter.Text(Box{box.x + Rem(17.0), box.y, box.width - Rem(18.0), box.height}, block.value,
                         TextStyle{Rem(1.0), false}, block.bad || block.good ? tone : tokens::kText);
            break;
        }
        case InfoBlock::Kind::Rule:
            painter.FillRoundRect(Box{box.x, box.CenterY(), box.width, 1.0}, 0.0, tokens::kBorderSoft);
            break;
        }
    }
}

void InfoScreen::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    // A tile: the service's colour, its wordmark across the middle, and a line under it.
    const auto found = std::find_if(view_.tiles.begin(), view_.tiles.end(), [&](const InfoAction& a) { return a.key == button.key; });
    if (found == view_.tiles.end()) return;
    const Color fill = found->tile.value_or(tokens::kSurface);
    painter.FillRoundRect(box, Rem(0.9), fill);
    painter.StrokeRoundRect(box, Rem(0.9), 1.0, Rgb(0xFFFFFF, 0.12));
    if (focused) {
        const double ring = Rem(kFocusRingOffsetRem) + Rem(kFocusRingWidthRem) / 2.0;
        painter.StrokeRoundRect(Box{box.x - ring, box.y - ring, box.width + 2.0 * ring, box.height + 2.0 * ring},
                                Rem(0.9) + ring, Rem(kFocusRingWidthRem), tokens::kFocusRing);
    }
    const Color ink = InkOn(fill);
    const TextStyle wordStyle{Rem(1.5), true, 800};
    const double width = std::min(painter.MeasureText(found->label, wordStyle), box.width - Rem(1.0));
    painter.Text(Box{box.CenterX() - width / 2.0, box.y + box.height * 0.22, width + 2.0, box.height * 0.4}, found->label,
                 wordStyle, ink);
    if (!found->detail.empty()) {
        const TextStyle detailStyle{Rem(0.75), false, 500};
        const double detailWidth = std::min(painter.MeasureText(found->detail, detailStyle), box.width - Rem(1.0));
        painter.Text(Box{box.CenterX() - detailWidth / 2.0, box.y + box.height * 0.64, detailWidth + 2.0, Rem(1.2)},
                     found->detail, detailStyle, WithAlphaOf(ink, 0.75));
    }
}

std::optional<Command> InfoScreen::Activate(const std::string& key) {
    Command command;
    if (key.rfind("open:", 0) == 0) {
        // "open:name" opens a screen, and "open:name?k=v" passes one parameter with it.
        std::string target = key.substr(5);
        const std::size_t query = target.find('?');
        if (query != std::string::npos) {
            const std::string pair = target.substr(query + 1);
            const std::size_t equals = pair.find('=');
            if (equals != std::string::npos) command.params[pair.substr(0, equals)] = pair.substr(equals + 1);
            target = target.substr(0, query);
        }
        command.name = target;
        return command;
    }
    command.name = key;
    command.action = true;
    if (view_.field) command.params["field"] = fieldText_;
    return command;
}

std::optional<Command> UpdatesScreen::Activate(const std::string& key) {
    Command command;
    command.action = true;
    if (key == "download") {
        command.name = "updates-download";
        return command;
    }
    if (key == "check") {
        if (view_.busy) return std::nullopt;
        command.name = "updates-check";
        return command;
    }
    if (key == "auto-update") {
        command.name = "updates-auto";
        return command;
    }
    if (key == "back") {
        command.name = "back";
        return command;
    }
    return std::nullopt;
}

// ------------------------------------------------------------------ Account & Gate

namespace {

std::string CleanEmail(std::string raw) {
    while (!raw.empty() && std::isspace(static_cast<unsigned char>(raw.front()))) raw.erase(raw.begin());
    while (!raw.empty() && std::isspace(static_cast<unsigned char>(raw.back()))) raw.pop_back();
    return raw;
}

}  // namespace

AccountScreen::AccountScreen() {
    width_ = 1280.0;
    height_ = 720.0;
    Arrange();
    KeepFocus("field:email");
}

double AccountScreen::ScaleRem() const {
    if (width_ <= 0.0 || height_ <= 0.0) return 16.0;
    return std::clamp(height_ / 67.5, 13.0, 18.0);
}

std::string* AccountScreen::FieldStorage(const std::string& field) {
    if (field == "email") return &email_;
    if (field == "password") return &password_;
    if (field == "name") return &name_;
    if (field == "code") return &code_;
    return nullptr;
}

const std::string* AccountScreen::FieldStorage(const std::string& field) const {
    if (field == "email") return &email_;
    if (field == "password") return &password_;
    if (field == "name") return &name_;
    if (field == "code") return &code_;
    return nullptr;
}

void AccountScreen::SetFieldValue(const std::string& field, std::string value) {
    if (std::string* slot = FieldStorage(field)) *slot = std::move(value);
}

void AccountScreen::ClearErrors() {
    localError_.clear();
    localErrorField_.clear();
    view_.error.clear();
    view_.errorField.clear();
}

std::string AccountScreen::ActiveError() const {
    return !localError_.empty() ? localError_ : view_.error;
}

std::string AccountScreen::ActiveErrorField() const {
    return !localError_.empty() ? localErrorField_ : view_.errorField;
}

void AccountScreen::SetView(AccountView view) {
    const bool wasSignedIn = view_.account.signedIn && view_.account.usable;
    const AccountStep prevStep = step_;
    view_ = std::move(view);
    if (view_.openPrivacy) privacyOpen_ = true;

    if (view_.forceStep.has_value()) {
        step_ = *view_.forceStep;
        if (step_ == AccountStep::SignInEmail) activeField_ = "email";
        else if (step_ == AccountStep::SignInPassword) activeField_ = "password";
        else if (step_ == AccountStep::CreateAccount && activeField_ != "name" && activeField_ != "email" && activeField_ != "password") {
            activeField_ = "name";
        } else if (step_ == AccountStep::EmailVerify) activeField_ = "code";
    } else if (view_.account.signedIn) {
        if (view_.account.usable) step_ = AccountStep::SignedIn;
        else if (view_.account.reason == "suspended" || view_.account.suspended) step_ = AccountStep::Suspended;
        else if (view_.account.reason == "terms_required") step_ = AccountStep::TermsRequired;
        else if (view_.account.reason == "email_unverified") {
            step_ = AccountStep::EmailVerify;
            activeField_ = "code";
        } else step_ = AccountStep::WaitingApproval;
    } else if (wasSignedIn || (prevStep != AccountStep::SignInEmail && prevStep != AccountStep::SignInPassword &&
                               prevStep != AccountStep::CreateAccount)) {
        step_ = AccountStep::SignInEmail;
        activeField_ = "email";
        password_.clear();
        code_.clear();
        forgotOpen_ = false;
        editing_ = true;
    }

    if (prevStep != step_) {
        localError_.clear();
        localErrorField_.clear();
    }
    Arrange();

    const std::string errField = ActiveErrorField();
    if (privacyOpen_) {
        KeepFocus("account:privacy-close");
    } else if (!errField.empty()) {
        focused_ = errField == "terms" ? "account:toggle-terms" : ("field:" + errField);
        if (errField != "terms") activeField_ = errField;
        KeepFocus("account:signin");
    } else {
        std::string fallback = "account:continue";
        if (step_ == AccountStep::SignInEmail) fallback = "field:email";
        else if (step_ == AccountStep::SignInPassword) fallback = "field:password";
        else if (step_ == AccountStep::CreateAccount) fallback = "field:name";
        else if (step_ == AccountStep::WaitingApproval) fallback = "account:check-again";
        else if (step_ == AccountStep::Suspended) fallback = "account:signout";
        else if (step_ == AccountStep::TermsRequired) fallback = "account:accept-terms";
        else if (step_ == AccountStep::EmailVerify) fallback = "field:code";
        else if (step_ == AccountStep::SignedIn) fallback = "account:plans";
        KeepFocus(fallback);
    }
}

void AccountScreen::Layout(double width, double height) {
    PageScreen::Layout(width, height);
    Arrange();
}

bool AccountScreen::CloseOverlay(double /*nowMs*/) {
    if (!privacyOpen_) return false;
    privacyOpen_ = false;
    view_.openPrivacy = false;
    Arrange();
    KeepFocus("account:privacy");
    return true;
}

void AccountScreen::PressedElsewhere(const std::optional<std::string>& key, double /*nowMs*/) {
    if (!key.has_value() || key->rfind("field:", 0) != 0) {
        if (!key.has_value() || *key != "account:toggle-password") editing_ = false;
    }
}

bool AccountScreen::IsEditing() const {
    if (privacyOpen_) return false;
    return step_ == AccountStep::SignInEmail || step_ == AccountStep::SignInPassword ||
           step_ == AccountStep::CreateAccount || step_ == AccountStep::EmailVerify;
}

void AccountScreen::Type(const std::string& text) {
    if (!IsEditing() || text.empty()) return;
    if (activeField_.empty()) {
        if (step_ == AccountStep::SignInEmail) activeField_ = "email";
        else if (step_ == AccountStep::SignInPassword) activeField_ = "password";
        else if (step_ == AccountStep::CreateAccount) activeField_ = "name";
        else if (step_ == AccountStep::EmailVerify) activeField_ = "code";
    }
    editing_ = true;
    std::string* target = FieldStorage(activeField_);
    if (target == nullptr) return;
    if (target->size() + text.size() > 240) return;
    target->append(text);
    ClearErrors();
    Arrange();
}

void AccountScreen::Erase(bool wholeWord) {
    if (!IsEditing()) return;
    std::string* target = FieldStorage(activeField_);
    if (target == nullptr || target->empty()) return;
    editing_ = true;
    PopUtf8(*target, wholeWord);
    ClearErrors();
    Arrange();
}

void AccountScreen::Paste(const std::string& text) {
    if (!IsEditing() || text.empty()) return;
    std::string cleaned;
    cleaned.reserve(text.size());
    for (char ch : text) {
        if (ch != '\r' && ch != '\n') cleaned.push_back(ch);
    }
    Type(cleaned);
}

std::optional<Command> AccountScreen::SubmitActiveField(double /*nowMs*/) {
    if (privacyOpen_) return Activate("account:privacy-close");
    if (step_ == AccountStep::SignInEmail) return TryContinueEmail();
    if (step_ == AccountStep::SignInPassword) return TrySignIn();
    if (step_ == AccountStep::EmailVerify) return TryVerifyEmail();
    if (step_ == AccountStep::CreateAccount) {
        if (activeField_ == "name") {
            activeField_ = "email";
            focused_ = "field:email";
            editing_ = true;
            return std::nullopt;
        }
        if (activeField_ == "email") {
            activeField_ = "password";
            focused_ = "field:password";
            editing_ = true;
            return std::nullopt;
        }
        return TryRegister();
    }
    return Select(clockMs_);
}

bool AccountScreen::CycleField(bool backwards, double /*nowMs*/) {
    if (privacyOpen_) return false;
    std::vector<std::string> fields;
    if (step_ == AccountStep::CreateAccount) fields = {"field:name", "field:email", "field:password", "account:toggle-terms", "account:register"};
    else if (step_ == AccountStep::SignInEmail) fields = {"field:email", "account:continue", "account:to-register", "account:privacy"};
    else if (step_ == AccountStep::SignInPassword) fields = {"field:password", "account:toggle-password", "account:signin", "account:forgot", "account:change-email"};
    else return false;
    const auto it = std::find(fields.begin(), fields.end(), focused_);
    std::size_t idx = it == fields.end() ? 0 : static_cast<std::size_t>(it - fields.begin());
    idx = backwards ? (idx + fields.size() - 1) % fields.size() : (idx + 1) % fields.size();
    focused_ = fields[idx];
    if (focused_.rfind("field:", 0) == 0) {
        activeField_ = focused_.substr(6);
        editing_ = true;
    }
    return true;
}

std::optional<Command> AccountScreen::TryContinueEmail() {
    ClearErrors();
    email_ = CleanEmail(email_);
    if (const auto err = coreapi::ValidateEmailInput(email_)) {
        localError_ = *err;
        localErrorField_ = "email";
        activeField_ = "email";
        focused_ = "field:email";
        editing_ = true;
        Arrange();
        return std::nullopt;
    }
    step_ = AccountStep::SignInPassword;
    activeField_ = "password";
    focused_ = "field:password";
    editing_ = true;
    forgotOpen_ = false;
    Arrange();
    return std::nullopt;
}

std::optional<Command> AccountScreen::TrySignIn() {
    ClearErrors();
    email_ = CleanEmail(email_);
    if (const auto err = coreapi::ValidatePasswordInput(password_, false)) {
        localError_ = *err;
        localErrorField_ = "password";
        activeField_ = "password";
        focused_ = "field:password";
        editing_ = true;
        Arrange();
        return std::nullopt;
    }
    Command command;
    command.name = "account-signin";
    command.action = true;
    command.params["email"] = email_;
    command.params["password"] = password_;
    return command;
}

std::optional<Command> AccountScreen::TryRegister() {
    ClearErrors();
    email_ = CleanEmail(email_);
    if (const auto err = coreapi::ValidateEmailInput(email_)) {
        localError_ = *err;
        localErrorField_ = "email";
        activeField_ = "email";
        focused_ = "field:email";
        editing_ = true;
        Arrange();
        return std::nullopt;
    }
    if (const auto err = coreapi::ValidatePasswordInput(password_, true)) {
        localError_ = *err;
        localErrorField_ = "password";
        activeField_ = "password";
        focused_ = "field:password";
        editing_ = true;
        Arrange();
        return std::nullopt;
    }
    if (!termsAccepted_) {
        localError_ = "Accept the terms to continue.";
        localErrorField_ = "terms";
        focused_ = "account:toggle-terms";
        Arrange();
        return std::nullopt;
    }
    Command command;
    command.name = "account-register";
    command.action = true;
    command.params["email"] = email_;
    command.params["password"] = password_;
    command.params["name"] = CleanEmail(name_);
    return command;
}

std::optional<Command> AccountScreen::TryVerifyEmail() {
    ClearErrors();
    const std::string code = CleanEmail(code_);
    if (code.empty()) {
        localError_ = "Enter the verification code from your email.";
        localErrorField_ = "code";
        activeField_ = "code";
        focused_ = "field:code";
        editing_ = true;
        Arrange();
        return std::nullopt;
    }
    Command command;
    command.name = "account-verify-email";
    command.action = true;
    command.params["code"] = code;
    return command;
}

void AccountScreen::Arrange() {
    buttons_.clear();
    signedInRows_.clear();
    cardBox_ = Box{};
    dividerBox_ = Box{};
    badgeBox_ = Box{};
    emailChipBox_ = Box{};
    summaryBox_ = Box{};
    if (width_ <= 0.0 || height_ <= 0.0) return;

    const double scale = ScaleRem();
    const bool compact = height_ < 800.0;
    const double buttonH = compact ? 44.0 : 48.0;
    const double fieldH = compact ? 42.0 : 48.0;
    const double topGuard = std::max(Rem(3.6), scale * 2.9);
    const std::string err = ActiveError();
    const std::string errField = ActiveErrorField();

    if (privacyOpen_) {
        const double cardW = std::clamp(scale * 35.0, 440.0, width_ - scale * 3.0);
        const double pad = std::clamp(scale * 1.75, 22.0, 32.0);
        const double iw = cardW - 2.0 * pad;
        double h = pad;
        h += scale * 2.2;
        h += scale * 1.5;
        h += scale * 1.2;
        const double introH = WrappedHeight(iw, scale * 0.92, scale * 1.38, view_.terms.intro);
        h += introH + scale * 1.0;
        for (const coreapi::TermsSection& sec : view_.terms.sections) {
            h += scale * 1.55;
            h += WrappedHeight(iw, scale * 0.88, scale * 1.32, sec.body) + scale * 0.9;
        }
        h += scale * 0.6 + buttonH + pad;

        const double cardY = std::max(topGuard, (height_ - h) / 2.0);
        const double cardX = (width_ - cardW) / 2.0;
        cardBox_ = Box{cardX, cardY, cardW, h};
        innerX_ = cardX + pad;
        innerW_ = iw;

        PageButton closeX;
        closeX.key = "account:privacy-x";
        closeX.label = "Close";
        closeX.box = Box{innerX_ + iw - scale * 2.3, cardY + pad - scale * 0.1, scale * 2.3, scale * 2.3};
        closeX.row = 0;
        closeX.custom = true;
        buttons_.push_back(std::move(closeX));

        dividerBox_ = Box{innerX_, cardY + pad + scale * 3.9, iw, 1.0};

        PageButton closeBtn;
        closeBtn.key = "account:privacy-close";
        closeBtn.label = "Done";
        closeBtn.box = Box{innerX_, cardBox_.Bottom() - pad - buttonH, iw, buttonH};
        closeBtn.row = 1;
        closeBtn.primary = true;
        closeBtn.custom = true;
        buttons_.push_back(std::move(closeBtn));
        contentHeight_ = cardBox_.Bottom() + scale * 2.0;
        return;
    }

    if (step_ == AccountStep::SignedIn) {
        const double minX = std::max(Rem(kSafeXRem + 3.0), scale * 4.2);
        const double cardW = std::clamp(scale * 42.0, 480.0, width_ - minX - std::max(Rem(kSafeXRem), scale * 2.0));
        const double x = std::max(minX, (width_ - cardW) / 2.0);
        const double pad = std::clamp(scale * 1.75, 22.0, 28.0);
        const double iw = cardW - 2.0 * pad;

        const double titleY = std::max(Rem(kSafeYRem), scale * 1.3);
        const double cardTop = titleY + scale * 3.4;

        const std::string rdValue =
            !view_.realDebrid.error.empty()
                ? "Key rejected \xC2\xB7 Connect"
                : (view_.realDebrid.configured
                       ? (view_.realDebrid.username ? ("Connected \xC2\xB7 " + *view_.realDebrid.username) : "Connected")
                       : "Connect");
        signedInRows_ = {
            {"account:plans", "Plan", coreapi::FriendlyPlanName(view_.account.tier) + " \xC2\xB7 Change", true, true, false, false},
            {"account:realdebrid", "Real-Debrid", rdValue, true, view_.realDebrid.configured && view_.realDebrid.error.empty(),
             !view_.realDebrid.error.empty(), false},
            {"account:live-tv", "Live TV", view_.account.liveTv ? "On" : "Off", true, false, false, view_.account.liveTv},
            {"", "Status", coreapi::AccountStatusLabel(view_.account), false, false, false, view_.account.usable},
        };
        if (!view_.account.createdAt.empty()) {
            signedInRows_.push_back({"", "Member since", coreapi::ShortDateLabel(view_.account.createdAt), false, false, false, false});
        }
        signedInRows_.push_back({"account:profiles", "Stream profiles", "Manage", true, true, false, false});
        if (view_.account.developer) {
            signedInRows_.push_back({"account:accounts", "Accounts", "Manage members", true, true, false, false});
            signedInRows_.push_back({"account:developer", "Developer", "Diagnostics & tools", true, false, false, false});
        }

        const double rowH = compact ? 42.0 : std::max(44.0, scale * 3.0);
        const double rowPitch = rowH + scale * 0.3;
        const double headerH = scale * 4.0;
        double rowsY = cardTop + pad + headerH + scale * 1.05;
        dividerBox_ = Box{x + pad, cardTop + pad + headerH + scale * 0.4, iw, 1.0};
        innerX_ = x + pad;
        innerW_ = iw;

        int rowIdx = 0;
        for (const AccountRow& r : signedInRows_) {
            if (r.clickable) {
                PageButton btn;
                btn.key = r.key;
                btn.label = r.label;
                btn.box = Box{innerX_, rowsY, iw, rowH};
                btn.row = rowIdx++;
                btn.custom = true;
                buttons_.push_back(std::move(btn));
            }
            rowsY += rowPitch;
        }

        double footerY = rowsY + scale * 0.75;
        summaryBox_ = Box{innerX_, footerY, iw, 1.0};
        footerY += scale * 1.05;

        PageButton signoutBtn;
        signoutBtn.key = "account:signout";
        signoutBtn.label = view_.busy ? "Signing out\xE2\x80\xA6" : "Sign out";
        signoutBtn.box = Box{innerX_, footerY, std::max(scale * 9.5, 130.0), buttonH};
        signoutBtn.row = rowIdx;
        signoutBtn.primary = false;
        signoutBtn.custom = true;
        signoutBtn.disabled = view_.busy;
        buttons_.push_back(std::move(signoutBtn));

        PageButton privacyLink;
        privacyLink.key = "account:privacy";
        privacyLink.label = "Privacy & terms";
        privacyLink.box = Box{innerX_ + iw - scale * 8.5, footerY, scale * 8.5, buttonH};
        privacyLink.row = rowIdx;
        privacyLink.custom = true;
        buttons_.push_back(std::move(privacyLink));

        cardBox_ = Box{x, cardTop, cardW, (footerY + buttonH + pad) - cardTop};
        contentHeight_ = cardBox_.Bottom() + scale * 2.0;
        return;
    }

    const double targetCardW = (step_ == AccountStep::TermsRequired) ? scale * 32.0 : scale * 27.5;
    const double cardW = std::clamp(targetCardW, 380.0, width_ - scale * 3.0);
    const double pad = compact ? 20.0 : std::clamp(scale * 1.75, 22.0, 32.0);
    const double iw = cardW - 2.0 * pad;
    const double gap = compact ? scale * 0.85 : scale * 1.15;
    const double fieldGap = compact ? scale * 0.55 : scale * 0.8;

    double ry = pad;
    if (step_ == AccountStep::SignInEmail || step_ == AccountStep::SignInPassword || step_ == AccountStep::CreateAccount) {
        ry += compact ? scale * 2.1 : scale * 2.5;
    } else {
        ry += scale * 4.2;
    }

    if (step_ == AccountStep::SignInEmail) {
        ry += scale * 2.45 + scale * 2.1 + scale * 1.65 + fieldH;
        if (!err.empty()) ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        ry += gap + buttonH + scale * 2.6 + scale * 1.0 + scale * 2.0;
    } else if (step_ == AccountStep::SignInPassword) {
        ry += scale * 2.45 + scale * 2.8 + scale * 1.65 + fieldH;
        if (!err.empty()) ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        ry += gap + buttonH + scale * 2.4 + (forgotOpen_ ? scale * 1.6 : 0.0) + scale * 1.0 + scale * 2.0;
    } else if (step_ == AccountStep::CreateAccount) {
        ry += (compact ? scale * 2.15 : scale * 2.45) + (compact ? scale * 1.75 : scale * 2.0);
        ry += scale * 1.55 + fieldH + fieldGap;
        ry += scale * 1.55 + fieldH;
        if (!err.empty() && errField == "email") ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.55;
        ry += fieldGap + scale * 1.55 + fieldH;
        ry += scale * 1.45;
        if (!err.empty() && errField.empty()) ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.6;
        ry += scale * 2.1;
        if (!err.empty() && errField == "terms") ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.55;
        ry += gap + buttonH + (compact ? scale * 2.0 : scale * 2.4);
    } else if (step_ == AccountStep::WaitingApproval) {
        ry += scale * 2.45;
        ry += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                            "Your account is waiting for the app owner to approve it. This page checks automatically every minute.") +
              scale * 1.1;
        ry += scale * 4.5 + scale * 1.0;
        if (!view_.statusNote.empty() || !err.empty()) ry += scale * 1.6;
        ry += buttonH + scale * 2.4 + scale * 1.9;
    } else if (step_ == AccountStep::Suspended) {
        ry += scale * 2.45;
        ry += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                            "Ask the app owner to restore your access. You can sign out or switch accounts below.") +
              scale * 1.1;
        if (!view_.account.email.empty()) ry += scale * 2.6;
        ry += buttonH + scale * 2.4 + scale * 1.9;
    } else if (step_ == AccountStep::TermsRequired) {
        ry += scale * 2.45;
        ry += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                            "TVM's terms were updated. Read the summary below before continuing.") +
              scale * 1.0;
        const std::size_t previewCount = std::min<std::size_t>(2, view_.terms.sections.size());
        double sumH = scale * 1.0;
        for (std::size_t i = 0; i < previewCount; ++i) {
            sumH += scale * 1.35 + WrappedHeight(iw - scale * 1.8, scale * 0.84, scale * 1.25, view_.terms.sections[i].body) + scale * 0.6;
        }
        ry += sumH + scale * 1.0;
        if (!err.empty()) ry += scale * 1.8;
        ry += scale * 2.0 + buttonH + scale * 2.4;
    } else if (step_ == AccountStep::EmailVerify) {
        ry += scale * 2.45;
        ry += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                            "Enter the verification code sent to " + view_.account.email + ".") +
              scale * 1.0;
        ry += scale * 1.45 + fieldH;
        if (!err.empty()) ry += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        ry += gap + buttonH + scale * 2.5 + scale * 1.9;
    }

    const double cardH = ry + pad;
    const double cardX = (width_ - cardW) / 2.0;
    const double cardY = std::max(topGuard, (height_ - cardH) / 2.0);
    cardBox_ = Box{cardX, cardY, cardW, cardH};
    innerX_ = cardX + pad;
    innerW_ = iw;

    double y = cardY + pad;
    if (step_ == AccountStep::SignInEmail || step_ == AccountStep::SignInPassword || step_ == AccountStep::CreateAccount) {
        y += compact ? scale * 2.1 : scale * 2.5;
    } else {
        badgeBox_ = Box{cardX + (cardW - scale * 3.4) / 2.0, y, scale * 3.4, scale * 3.4};
        y += scale * 4.2;
    }

    int row = 0;
    if (step_ == AccountStep::SignInEmail) {
        y += scale * 2.45 + scale * 2.1 + scale * 1.65;
        buttons_.push_back(PageButton{"field:email", "Email", Box{innerX_, y, iw, fieldH}, row++, false, false, true});
        y += fieldH;
        if (!err.empty()) y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        y += gap;
        buttons_.push_back(PageButton{"account:continue", "Continue", Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.7;
        buttons_.push_back(PageButton{"account:to-register", "New here? Create an account", Box{innerX_, y, iw, scale * 1.9}, row++, false, false, true});
        y += scale * 2.3;
        dividerBox_ = Box{innerX_, y, iw, 1.0};
        y += scale * 0.6;
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    } else if (step_ == AccountStep::SignInPassword) {
        y += scale * 2.45;
        emailChipBox_ = Box{innerX_, y + scale * 0.1, iw, scale * 2.2};
        buttons_.push_back(PageButton{"account:change-email", "Change",
                                      Box{innerX_ + iw - scale * 4.8, y + scale * 0.1, scale * 4.2, scale * 2.2}, row++, false, false, true});
        y += scale * 2.8 + scale * 1.65;
        const double toggleW = std::max(40.0, scale * 2.6);
        buttons_.push_back(PageButton{"field:password", "Password", Box{innerX_, y, iw - toggleW, fieldH}, row, false, false, true});
        buttons_.push_back(PageButton{"account:toggle-password", showPassword_ ? "Hide password" : "Show password",
                                      Box{innerX_ + iw - toggleW, y, toggleW, fieldH}, row++, false, false, true});
        y += fieldH;
        if (!err.empty()) y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        y += gap;
        buttons_.push_back(PageButton{"account:signin", view_.busy ? "Signing in\xE2\x80\xA6" : "Sign in",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.65;
        buttons_.push_back(PageButton{"account:forgot", "Forgot password?", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
        y += scale * 2.1 + (forgotOpen_ ? scale * 1.6 : 0.0);
        dividerBox_ = Box{innerX_, y, iw, 1.0};
        y += scale * 0.6;
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    } else if (step_ == AccountStep::CreateAccount) {
        y += (compact ? scale * 2.15 : scale * 2.45) + (compact ? scale * 1.75 : scale * 2.0) + scale * 1.55;
        buttons_.push_back(PageButton{"field:name", "Name", Box{innerX_, y, iw, fieldH}, row++, false, false, true});
        y += fieldH + fieldGap + scale * 1.55;
        buttons_.push_back(PageButton{"field:email", "Email", Box{innerX_, y, iw, fieldH}, row++, false, false, true});
        y += fieldH;
        if (!err.empty() && errField == "email") {
            y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.55;
        }
        y += fieldGap + scale * 1.55;
        const double toggleW = std::max(40.0, scale * 2.6);
        buttons_.push_back(PageButton{"field:password", "Password", Box{innerX_, y, iw - toggleW, fieldH}, row, false, false, true});
        buttons_.push_back(PageButton{"account:toggle-password", showPassword_ ? "Hide password" : "Show password",
                                      Box{innerX_ + iw - toggleW, y, toggleW, fieldH}, row++, false, false, true});
        y += fieldH + scale * 1.45;
        if (!err.empty() && errField.empty()) {
            y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.6;
        }
        const double termsW = iw * 0.62;
        buttons_.push_back(PageButton{"account:toggle-terms", "I agree to the terms",
                                      Box{innerX_, y, termsW, scale * 2.0}, row, false, false, true});
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms",
                                      Box{innerX_ + termsW, y, iw - termsW, scale * 2.0}, row++, false, false, true});
        y += scale * 2.1;
        if (!err.empty() && errField == "terms") {
            y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.55;
        }
        y += gap;
        buttons_.push_back(PageButton{"account:register", view_.busy ? "Creating account\xE2\x80\xA6" : "Create account",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + (compact ? scale * 0.45 : scale * 0.65);
        buttons_.push_back(PageButton{"account:to-signin", "I already have an account",
                                      Box{innerX_, y, iw, scale * 1.7}, row++, false, false, true});
    } else if (step_ == AccountStep::WaitingApproval) {
        y += scale * 2.45;
        y += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                           "Your account is waiting for the app owner to approve it. This page checks automatically every minute.") +
             scale * 1.1;
        summaryBox_ = Box{innerX_, y, iw, scale * 4.5};
        y += scale * 5.5;
        if (!view_.statusNote.empty() || !err.empty()) y += scale * 1.6;
        buttons_.push_back(PageButton{"account:check-again", view_.busy ? "Checking\xE2\x80\xA6" : "Check again",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.7;
        buttons_.push_back(PageButton{"account:plans", "Plans", Box{innerX_, y, iw * 0.48, scale * 1.9}, row, false, false, true});
        buttons_.push_back(PageButton{"account:signout", "Sign out", Box{innerX_ + iw * 0.52, y, iw * 0.48, scale * 1.9}, row++, false, false, true});
        y += scale * 2.0;
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    } else if (step_ == AccountStep::Suspended) {
        y += scale * 2.45;
        y += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                           "Ask the app owner to restore your access. You can sign out or switch accounts below.") +
             scale * 1.1;
        if (!view_.account.email.empty()) {
            emailChipBox_ = Box{innerX_, y, iw, scale * 2.2};
            y += scale * 2.6;
        }
        buttons_.push_back(PageButton{"account:signout", "Switch account",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.7;
        buttons_.push_back(PageButton{"account:check-again", "Check again", Box{innerX_, y, iw, scale * 1.9}, row++, false, false, true});
        y += scale * 2.0;
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    } else if (step_ == AccountStep::TermsRequired) {
        y += scale * 2.45;
        y += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                           "TVM's terms were updated. Read the summary below before continuing.") +
             scale * 1.0;
        const std::size_t previewCount = std::min<std::size_t>(2, view_.terms.sections.size());
        double sumH = scale * 1.0;
        for (std::size_t i = 0; i < previewCount; ++i) {
            sumH += scale * 1.35 + WrappedHeight(iw - scale * 1.8, scale * 0.84, scale * 1.25, view_.terms.sections[i].body) + scale * 0.6;
        }
        summaryBox_ = Box{innerX_, y, iw, sumH};
        y += sumH + scale * 1.0;
        if (!err.empty()) y += scale * 1.8;
        buttons_.push_back(PageButton{"account:privacy", "Read full Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
        y += scale * 2.0;
        buttons_.push_back(PageButton{"account:accept-terms", view_.busy ? "Saving\xE2\x80\xA6" : "Accept & continue",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.7;
        buttons_.push_back(PageButton{"account:signout", "Sign out", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    } else if (step_ == AccountStep::EmailVerify) {
        y += scale * 2.45;
        y += WrappedHeight(iw, scale * 0.94, scale * 1.38,
                           "Enter the verification code sent to " + view_.account.email + ".") +
             scale * 1.0 + scale * 1.45;
        buttons_.push_back(PageButton{"field:code", "Verification code", Box{innerX_, y, iw, fieldH}, row++, false, false, true});
        y += fieldH;
        if (!err.empty()) y += WrappedHeight(iw - scale * 1.6, scale * 0.85, scale * 1.2, err) + scale * 0.7;
        y += gap;
        buttons_.push_back(PageButton{"account:verify-email", "Verify email",
                                      Box{innerX_, y, iw, buttonH}, row++, true, view_.busy, true});
        y += buttonH + scale * 0.7;
        if (view_.account.canSendEmail) {
            buttons_.push_back(PageButton{"account:send-code", "Send a new code",
                                          Box{innerX_, y, iw * 0.5, scale * 1.9}, row, false, false, true});
            buttons_.push_back(PageButton{"account:signout", "Sign out",
                                          Box{innerX_ + iw * 0.52, y, iw * 0.48, scale * 1.9}, row++, false, false, true});
        } else {
            buttons_.push_back(PageButton{"account:signout", "Sign out", Box{innerX_, y, iw, scale * 1.9}, row++, false, false, true});
        }
        y += scale * 2.0;
        buttons_.push_back(PageButton{"account:privacy", "Privacy & terms", Box{innerX_, y, iw, scale * 1.8}, row++, false, false, true});
    }
    contentHeight_ = cardBox_.Bottom() + scale * 2.0;
}

void AccountScreen::PaintContent(Painter& painter, double scroll) const {
    if (width_ <= 0.0 || height_ <= 0.0) return;
    const double scale = ScaleRem();
    const bool compact = height_ < 800.0;

    if (step_ == AccountStep::SignedIn && !privacyOpen_) {
        const double titleY = std::max(Rem(kSafeYRem), scale * 1.3) - scroll;
        const double x = cardBox_.x;
        painter.Text(Box{x, titleY, cardBox_.width, scale * 2.7}, "Account", TextStyle{scale * 2.15, true, 750}, tokens::kText);

        const Box card = Shifted(cardBox_, scroll);
        GlassStyle sheet = glass::SheetPanel();
        sheet.tint = tokens::kSurface;
        painter.Glass(card, scale * 1.75, sheet);

        const double ix = innerX_;
        const double iw = innerW_;
        const double avatarSize = std::max(46.0, scale * 3.25);
        const double cardPad = std::clamp(scale * 1.75, 22.0, 28.0);
        const Box avatar{ix, card.y + cardPad, avatarSize, avatarSize};
        painter.FillRoundRect(avatar, avatarSize / 2.0, Rgb(0x2F6BFF, 0.25));
        painter.StrokeRoundRect(avatar, avatarSize / 2.0, 1.5, Rgb(0x2F6BFF, 0.78));
        const std::string glyph = InitialGlyph(view_.account.name, view_.account.email);
        const TextStyle glyphStyle{scale * 1.3, true, 750};
        const double gw = painter.MeasureText(glyph, glyphStyle);
        painter.Text(Box{avatar.CenterX() - gw / 2.0, avatar.y, gw + 2.0, avatar.height}, glyph, glyphStyle, tokens::kText);

        const std::string heading = !view_.account.name.empty() ? view_.account.name : view_.account.email;
        painter.Text(Box{avatar.Right() + scale * 1.0, avatar.y + scale * 0.15, iw - avatarSize - scale, scale * 1.7},
                     heading, TextStyle{scale * 1.32, true, 750}, tokens::kText);
        painter.Text(Box{avatar.Right() + scale * 1.0, avatar.y + scale * 1.85, iw - avatarSize - scale, scale * 1.25},
                     view_.account.email, TextStyle{scale * 0.88, false}, tokens::kTextMuted);

        const Box div = Shifted(dividerBox_, scroll);
        painter.FillRoundRect(div, 0.0, tokens::kBorderSoft);

        const double rowH = compact ? 42.0 : std::max(44.0, scale * 3.0);
        const double rowPitch = rowH + scale * 0.3;
        double ry = div.y + scale * 0.65;
        for (const AccountRow& r : signedInRows_) {
            if (!r.clickable) {
                const Box row{ix, ry, iw, rowH};
                painter.Text(Box{row.x + scale * 0.8, row.y, iw * 0.45, row.height}, r.label,
                             TextStyle{scale * 0.94, true, 600}, tokens::kText);
                const TextStyle valStyle{scale * 0.92, true, r.goodValue ? 650 : 500};
                const double vw = painter.MeasureText(r.value, valStyle);
                const Color vc = r.goodValue ? Rgb(0x6EE7B7) : tokens::kTextMuted;
                painter.Text(Box{row.Right() - scale * 0.8 - vw, row.y, vw + 2.0, row.height}, r.value, valStyle, vc);
            }
            ry += rowPitch;
        }
        painter.FillRoundRect(Shifted(summaryBox_, scroll), 0.0, tokens::kBorderSoft);
        return;
    }

    // Gate screens & Privacy sheet: lighthouse dusk atmospheric backdrop + dark frosted glass.
    const Box viewport{0.0, 0.0, width_, height_};
    painter.ImageFaded(viewport, "asset:lighthouse.jpg", 0.0, 0.36, 0.7, 0.25);
    painter.FillLinearGradient(viewport, 0.0, 0.0, 0.0, height_,
                               {GradientStop{0.0, Rgb(0x050911, 0.56)},
                                GradientStop{0.55, Rgb(0x050911, 0.78)},
                                GradientStop{1.0, Rgb(0x050911, 0.94)}});
    painter.SetBackdrop(viewport, "asset:lighthouse.jpg", 0.7, 0.25);

    const Box card = Shifted(cardBox_, scroll);
    GlassStyle sheet = glass::SheetPanel();
    sheet.frosted = true;
    sheet.tint = Rgb(0x0B1524, 0.76);
    sheet.border = Rgb(0xFFFFFF, 0.16);
    painter.Glass(card, scale * 1.75, sheet);

    const Color kInk = Rgb(0xFFFFFF, 0.95);
    const Color kMuted = Rgb(0xFFFFFF, 0.68);
    const Color kFaint = Rgb(0xFFFFFF, 0.46);
    const Color kErr = Rgb(0xFCA5A5);

    const double ix = innerX_;
    const double iw = innerW_;
    double y = card.y + (cardBox_.height > 0 ? std::clamp(scale * 1.75, 22.0, 32.0) : 24.0);

    if (privacyOpen_) {
        painter.Text(Box{ix, y, iw - scale * 2.6, scale * 2.1}, "Privacy & terms", TextStyle{scale * 1.6, true, 750}, kInk);
        const std::string sub = "Version " + view_.terms.version +
                                (view_.terms.updated.empty() ? "" : (" \xC2\xB7 Updated " + coreapi::ShortDateLabel(view_.terms.updated)));
        painter.Text(Box{ix, y + scale * 2.1, iw, scale * 1.4}, sub, TextStyle{scale * 0.85, false}, kMuted);
        painter.FillRoundRect(Shifted(dividerBox_, scroll), 0.0, Rgb(0xFFFFFF, 0.14));

        double py = dividerBox_.y - scroll + scale * 0.85;
        const double introH = WrappedHeight(iw, scale * 0.92, scale * 1.38, view_.terms.intro);
        painter.Paragraph(Box{ix, py, iw, introH + 4.0}, view_.terms.intro, TextStyle{scale * 0.92, false}, kMuted);
        py += introH + scale * 1.0;
        for (const coreapi::TermsSection& sec : view_.terms.sections) {
            painter.Text(Box{ix, py, iw, scale * 1.4}, sec.title, TextStyle{scale * 0.94, true, 700}, kInk);
            py += scale * 1.55;
            const double bh = WrappedHeight(iw, scale * 0.88, scale * 1.32, sec.body);
            painter.Paragraph(Box{ix, py, iw, bh + 4.0}, sec.body, TextStyle{scale * 0.88, false}, kMuted);
            py += bh + scale * 0.9;
        }
        return;
    }

    if (step_ == AccountStep::SignInEmail || step_ == AccountStep::SignInPassword || step_ == AccountStep::CreateAccount) {
        const double markSize = scale * 1.65;
        painter.Image(Box{ix, y, markSize, markSize}, "asset:tvm-icon.png", scale * 0.35);
        painter.Text(Box{ix + markSize + scale * 0.55, y, iw - markSize, markSize}, "TVM",
                     TextStyle{scale * 1.0, true, 750}, kInk);
        y += scale * 2.5;
    } else {
        const Box badge = Shifted(badgeBox_, scroll);
        const bool isPause = (step_ == AccountStep::Suspended);
        const Color tint = isPause ? Rgb(0xF59E0B, 0.22) : Rgb(0x2F6BFF, 0.24);
        const Color stroke = isPause ? Rgb(0xFBBF24, 0.72) : Rgb(0x60A5FA, 0.75);
        const Color iconInk = isPause ? Rgb(0xFCD34D) : Rgb(0x93C5FD);
        painter.FillRoundRect(badge, badge.height / 2.0, tint);
        painter.StrokeRoundRect(badge, badge.height / 2.0, 1.5, stroke);
        const double padIcon = badge.width * 0.26;
        const Box iconBox{badge.x + padIcon, badge.y + padIcon, badge.width - 2.0 * padIcon, badge.height - 2.0 * padIcon};
        if (step_ == AccountStep::Suspended) DrawPauseIcon(painter, iconBox, iconInk);
        else if (step_ == AccountStep::TermsRequired) DrawShieldCheckIcon(painter, iconBox, iconInk);
        else DrawClockIcon(painter, iconBox, iconInk);
        y += scale * 4.2;
    }

    const std::string err = ActiveError();
    const std::string errField = ActiveErrorField();
    auto drawError = [&](double ey, const std::string& msg) -> double {
        if (msg.empty()) return 0.0;
        const double iconSz = scale * 0.95;
        DrawAlertIcon(painter, Box{ix, ey + scale * 0.16, iconSz, iconSz}, kErr);
        const double mh = WrappedHeight(iw - scale * 1.5, scale * 0.85, scale * 1.2, msg);
        painter.Paragraph(Box{ix + iconSz + scale * 0.4, ey, iw - iconSz - scale * 0.4, mh + 4.0},
                          msg, TextStyle{scale * 0.85, false}, kErr);
        return mh + scale * 0.55;
    };

    if (step_ == AccountStep::SignInEmail) {
        painter.Text(Box{ix, y, iw, scale * 2.2}, "Sign in to TVM", TextStyle{scale * 1.62, true, 750}, kInk);
        y += scale * 2.45;
        painter.Text(Box{ix, y, iw, scale * 1.45}, "Enter your email to continue.", TextStyle{scale * 0.94, false}, kMuted);
        if (const auto box = BoxOf("field:email")) {
            painter.Text(Box{ix, box->y - scale * 1.6, iw, scale * 1.25}, "Email", TextStyle{scale * 0.84, true, 650}, kInk);
            if (!err.empty()) drawError(box->Bottom() + scale * 0.35, err);
        }
        painter.FillRoundRect(Shifted(dividerBox_, scroll), 0.0, Rgb(0xFFFFFF, 0.12));
    } else if (step_ == AccountStep::SignInPassword) {
        painter.Text(Box{ix, y, iw, scale * 2.2}, "Enter your password", TextStyle{scale * 1.62, true, 750}, kInk);
        const Box chip = Shifted(emailChipBox_, scroll);
        painter.FillRoundRect(chip, chip.height / 2.0, Rgb(0xFFFFFF, 0.08));
        painter.StrokeRoundRect(chip, chip.height / 2.0, 1.0, Rgb(0xFFFFFF, 0.16));
        painter.Text(Box{chip.x + scale * 0.85, chip.y, chip.width - scale * 5.2, chip.height},
                     email_, TextStyle{scale * 0.86, false}, kInk);
        if (const auto field = BoxOf("field:password")) {
            painter.Text(Box{ix, field->y - scale * 1.6, iw, scale * 1.25}, "Password",
                         TextStyle{scale * 0.84, true, 650}, kInk);
            if (!err.empty()) drawError(field->Bottom() + scale * 0.35, err);
        }
        if (forgotOpen_) {
            if (const auto fbtn = BoxOf("account:forgot")) {
                painter.Text(Box{ix, fbtn->Bottom() + scale * 0.2, iw, scale * 1.35},
                             "Ask the owner to reset it.", TextStyle{scale * 0.85, false}, kMuted);
            }
        }
        painter.FillRoundRect(Shifted(dividerBox_, scroll), 0.0, Rgb(0xFFFFFF, 0.12));
    } else if (step_ == AccountStep::CreateAccount) {
        painter.Text(Box{ix, y, iw, scale * 2.1}, "Create your account", TextStyle{scale * 1.58, true, 750}, kInk);
        y += compact ? scale * 2.15 : scale * 2.45;
        painter.Text(Box{ix, y, iw, scale * 1.4}, "Access opens once the app owner approves you.",
                     TextStyle{scale * 0.9, false}, kMuted);
        if (const auto nf = BoxOf("field:name")) {
            painter.Text(Box{ix, nf->y - scale * 1.55, iw, scale * 1.22}, "Name", TextStyle{scale * 0.84, true, 650}, kInk);
        }
        if (const auto ef = BoxOf("field:email")) {
            painter.Text(Box{ix, ef->y - scale * 1.55, iw, scale * 1.22}, "Email", TextStyle{scale * 0.84, true, 650}, kInk);
            if (!err.empty() && errField == "email") drawError(ef->Bottom() + scale * 0.25, err);
        }
        if (const auto pf = BoxOf("field:password")) {
            painter.Text(Box{ix, pf->y - scale * 1.55, iw, scale * 1.22}, "Password", TextStyle{scale * 0.84, true, 650}, kInk);
            if (!err.empty() && errField == "password") {
                drawError(pf->Bottom() + scale * 0.25, err);
            } else {
                painter.Text(Box{ix, pf->Bottom() + scale * 0.22, iw, scale * 1.2},
                             "Use at least 10 characters.", TextStyle{scale * 0.82, false}, kFaint);
            }
            if (!err.empty() && errField.empty()) drawError(pf->Bottom() + scale * 1.65, err);
        }
        if (const auto tf = BoxOf("account:toggle-terms")) {
            if (!err.empty() && errField == "terms") drawError(tf->Bottom() + scale * 0.25, err);
        }
    } else if (step_ == AccountStep::WaitingApproval) {
        const TextStyle titleStyle{scale * 1.55, true, 750};
        const double tw = painter.MeasureText("You're on the list", titleStyle);
        painter.Text(Box{card.CenterX() - tw / 2.0, y, tw + 4.0, scale * 2.1}, "You're on the list", titleStyle, kInk);
        y += scale * 2.45;
        const std::string body =
            "Your account is waiting for the app owner to approve it. This page checks automatically every minute.";
        const double bh = WrappedHeight(iw, scale * 0.94, scale * 1.38, body);
        painter.Paragraph(Box{ix, y, iw, bh + 4.0}, body, TextStyle{scale * 0.94, false}, kMuted);

        const Box sum = Shifted(summaryBox_, scroll);
        painter.FillRoundRect(sum, scale * 0.8, Rgb(0xFFFFFF, 0.07));
        painter.StrokeRoundRect(sum, scale * 0.8, 1.0, Rgb(0xFFFFFF, 0.14));
        painter.Text(Box{sum.x + scale, sum.y + scale * 0.65, sum.width - scale * 2.0, scale * 1.3},
                     "Signed in as", TextStyle{scale * 0.82, false}, kFaint);
        painter.Text(Box{sum.x + scale, sum.y + scale * 1.9, sum.width - scale * 2.0, scale * 1.4},
                     view_.account.email, TextStyle{scale * 0.94, true, 600}, kInk);
        painter.Text(Box{sum.x + scale, sum.y + scale * 3.15, sum.width - scale * 2.0, scale * 1.2},
                     "Status: Waiting for approval \xC2\xB7 " + coreapi::FriendlyPlanName(view_.account.tier),
                     TextStyle{scale * 0.82, false}, Rgb(0x93C5FD));

        if (!err.empty()) drawError(sum.Bottom() + scale * 0.35, err);
        else if (!view_.statusNote.empty()) {
            painter.Text(Box{ix, sum.Bottom() + scale * 0.35, iw, scale * 1.35}, view_.statusNote,
                         TextStyle{scale * 0.85, false}, kMuted);
        }
    } else if (step_ == AccountStep::Suspended) {
        const TextStyle titleStyle{scale * 1.55, true, 750};
        const double tw = painter.MeasureText("Your account is paused", titleStyle);
        painter.Text(Box{card.CenterX() - tw / 2.0, y, tw + 4.0, scale * 2.1}, "Your account is paused", titleStyle, kInk);
        y += scale * 2.45;
        const std::string body = "Ask the app owner to restore your access. You can sign out or switch accounts below.";
        const double bh = WrappedHeight(iw, scale * 0.94, scale * 1.38, body);
        painter.Paragraph(Box{ix, y, iw, bh + 4.0}, body, TextStyle{scale * 0.94, false}, kMuted);
        if (emailChipBox_.width > 0.0) {
            const Box chip = Shifted(emailChipBox_, scroll);
            painter.FillRoundRect(chip, chip.height / 2.0, Rgb(0xFFFFFF, 0.08));
            painter.StrokeRoundRect(chip, chip.height / 2.0, 1.0, Rgb(0xFFFFFF, 0.16));
            const TextStyle chipStyle{scale * 0.88, false};
            const double cw = std::min(chip.width - scale * 2.0, painter.MeasureText(view_.account.email, chipStyle));
            painter.Text(Box{chip.CenterX() - cw / 2.0, chip.y, cw + 2.0, chip.height},
                         view_.account.email, chipStyle, kInk);
        }
    } else if (step_ == AccountStep::TermsRequired) {
        painter.Text(Box{ix, y, iw, scale * 2.1}, "Accept the terms to continue", TextStyle{scale * 1.5, true, 750}, kInk);
        y += scale * 2.45;
        const std::string body = "TVM's terms were updated. Read the summary below before continuing.";
        const double bh = WrappedHeight(iw, scale * 0.94, scale * 1.38, body);
        painter.Paragraph(Box{ix, y, iw, bh + 4.0}, body, TextStyle{scale * 0.94, false}, kMuted);

        const Box sum = Shifted(summaryBox_, scroll);
        painter.FillRoundRect(sum, scale * 0.85, Rgb(0xFFFFFF, 0.06));
        painter.StrokeRoundRect(sum, scale * 0.85, 1.0, Rgb(0xFFFFFF, 0.14));
        double sy = sum.y + scale * 0.6;
        const std::size_t previewCount = std::min<std::size_t>(2, view_.terms.sections.size());
        for (std::size_t i = 0; i < previewCount; ++i) {
            const coreapi::TermsSection& sec = view_.terms.sections[i];
            painter.Text(Box{sum.x + scale * 0.9, sy, sum.width - scale * 1.8, scale * 1.3}, sec.title,
                         TextStyle{scale * 0.86, true, 700}, kInk);
            sy += scale * 1.35;
            const double sh = WrappedHeight(sum.width - scale * 1.8, scale * 0.84, scale * 1.25, sec.body);
            painter.Paragraph(Box{sum.x + scale * 0.9, sy, sum.width - scale * 1.8, sh + 4.0}, sec.body,
                              TextStyle{scale * 0.84, false}, kMuted);
            sy += sh + scale * 0.6;
        }
        if (!err.empty()) drawError(sum.Bottom() + scale * 0.35, err);
    } else if (step_ == AccountStep::EmailVerify) {
        painter.Text(Box{ix, y, iw, scale * 2.1}, "Confirm your email", TextStyle{scale * 1.55, true, 750}, kInk);
        y += scale * 2.45;
        const std::string body = "Enter the verification code sent to " + view_.account.email + ".";
        const double bh = WrappedHeight(iw, scale * 0.94, scale * 1.38, body);
        painter.Paragraph(Box{ix, y, iw, bh + 4.0}, body, TextStyle{scale * 0.94, false}, kMuted);
        if (const auto cf = BoxOf("field:code")) {
            painter.Text(Box{ix, cf->y - scale * 1.45, iw, scale * 1.3}, "Verification code",
                         TextStyle{scale * 0.84, true, 650}, kInk);
            if (!err.empty()) drawError(cf->Bottom() + scale * 0.35, err);
        }
    }
}

void AccountScreen::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    const double scale = ScaleRem();
    const double focus = std::max(FocusAmount(button.key), focused ? 1.0 : 0.0);

    const bool isActionPill =
        button.key == "account:privacy-close" || button.key == "account:continue" || button.key == "account:signin" ||
        button.key == "account:register" || button.key == "account:accept-terms" || button.key == "account:verify-email" ||
        (button.key == "account:check-again" && step_ == AccountStep::WaitingApproval) ||
        (button.key == "account:signout" && (step_ == AccountStep::SignedIn || step_ == AccountStep::Suspended));
    if (isActionPill) {
        DrawActionPill(painter, scale, box, button.label, button.primary, button.disabled, focused, FocusAmount(button.key));
        return;
    }

    // Signed-in Account screen rows
    if (step_ == AccountStep::SignedIn && !privacyOpen_) {
        if (button.key == "account:privacy") {
            const TextStyle style{scale * 0.9, true, 600};
            const double tw = painter.MeasureText(button.label, style);
            const double tx = box.Right() - tw;
            const Color ink = Mix(tokens::kAccentStrong, tokens::kText, focus * 0.45);
            painter.Text(Box{tx, box.y, tw + 2.0, box.height}, button.label, style, ink);
            if (focus > 0.05) {
                painter.FillRoundRect(Box{tx, box.CenterY() + scale * 0.65, tw, 1.5}, 0.0, WithAlphaOf(ink, 0.75));
            }
            if (focused) {
                painter.StrokeRoundRect(Box{tx - scale * 0.4, box.CenterY() - scale * 0.95, tw + scale * 0.8, scale * 1.9},
                                        scale * 0.45, 1.5, tokens::kFocusRing);
            }
            return;
        }
        for (const AccountRow& r : signedInRows_) {
            if (r.key != button.key) continue;
            painter.FillRoundRect(box, scale * 0.75, WithAlphaOf(tokens::kSurfaceHover, 0.25 + 0.55 * focus));
            if (focused) painter.StrokeRoundRect(box, scale * 0.75, 2.0, tokens::kFocusRing);
            else painter.StrokeRoundRect(box, scale * 0.75, 1.0, WithAlphaOf(tokens::kBorderSoft, 0.4 + 0.4 * focus));

            painter.Text(Box{box.x + scale * 0.8, box.y, box.width * 0.45, box.height}, r.label,
                         TextStyle{scale * 0.94, true, 600}, tokens::kText);
            const double chevSz = scale * 1.0;
            const Color vc = r.warnValue ? Rgb(0xFCA5A5) : (r.goodValue ? Rgb(0x6EE7B7) : (r.accentValue ? tokens::kAccentStrong : tokens::kTextMuted));
            const TextStyle valStyle{scale * 0.92, true, 600};
            const double vw = painter.MeasureText(r.value, valStyle);
            painter.Text(Box{box.Right() - scale * 2.1 - vw, box.y, vw + 2.0, box.height}, r.value, valStyle, vc);
            DrawChevronRightIcon(painter, Box{box.Right() - scale * 1.75, box.CenterY() - chevSz / 2.0, chevSz, chevSz},
                                 Mix(tokens::kTextFaint, tokens::kText, focus));
            return;
        }
    }

    const Color kInk = Rgb(0xFFFFFF, 0.95);
    const Color kMuted = Rgb(0xFFFFFF, 0.7);
    const Color kFaint = Rgb(0xFFFFFF, 0.44);

    if (button.key.rfind("field:", 0) == 0) {
        const std::string field = button.key.substr(6);
        const bool secret = (field == "password") && !showPassword_;
        const bool isPasswordField = (field == "password");
        const double toggleW = isPasswordField ? std::max(40.0, scale * 2.6) : 0.0;
        const Box well{box.x, box.y, box.width + toggleW, box.height};
        const bool active = focused || (editing_ && activeField_ == field);
        const bool hasErr = ActiveErrorField() == field;

        painter.FillRoundRect(well, scale * 0.75, Rgb(0x060C16, 0.56));
        if (hasErr) {
            painter.StrokeRoundRect(well, scale * 0.75, 1.75, Rgb(0xF87171, 0.9));
        } else if (active) {
            painter.StrokeRoundRect(well, scale * 0.75, 2.0, Rgb(0x60A5FA, 0.95));
        } else {
            painter.StrokeRoundRect(well, scale * 0.75, 1.0, Rgb(0xFFFFFF, 0.22));
        }

        const std::string raw = FieldStorage(field) != nullptr ? *FieldStorage(field) : std::string();
        std::string shown = secret ? MaskDots(raw) : raw;
        const std::string placeholder =
            field == "name" ? "Your name (optional)"
                            : (field == "email" ? "you@example.com"
                                                : (field == "password" ? (step_ == AccountStep::CreateAccount ? "At least 10 characters" : "Your password")
                                                                       : "Verification code"));
        const TextStyle valStyle{scale * 0.96, false};
        const double maxTextW = std::max(40.0, box.width - scale * 1.7);
        while (!shown.empty() && painter.MeasureText(shown, valStyle) > maxTextW) {
            shown.erase(0, 1);
            while (!shown.empty() && (static_cast<unsigned char>(shown.front()) & 0xC0) == 0x80) shown.erase(0, 1);
        }
        const double tx = box.x + scale * 0.85;
        if (shown.empty()) {
            painter.Text(Box{tx, box.y, maxTextW, box.height}, placeholder, valStyle, kFaint);
        } else {
            painter.Text(Box{tx, box.y, maxTextW, box.height}, shown, valStyle, kInk);
        }
        if (active && editing_ && std::fmod(clockMs_, 1000.0) < 580.0) {
            const double cx = tx + (shown.empty() ? 0.0 : std::min(maxTextW, painter.MeasureText(shown, valStyle)));
            painter.FillRoundRect(Box{cx + 1.0, box.y + scale * 0.72, 1.8, box.height - scale * 1.44}, 1.0, Rgb(0x93C5FD));
        }
        return;
    }

    if (button.key == "account:toggle-password") {
        const double iconSz = scale * 1.2;
        const Box iconBox{box.CenterX() - iconSz / 2.0, box.CenterY() - iconSz / 2.0, iconSz, iconSz};
        DrawEyeIcon(painter, iconBox, showPassword_, focused ? kInk : kMuted);
        if (focused) painter.StrokeRoundRect(Box{box.x + 3.0, box.y + 4.0, box.width - 7.0, box.height - 8.0},
                                             scale * 0.5, 1.5, tokens::kFocusRing);
        return;
    }

    if (button.key == "account:privacy-x") {
        painter.FillRoundRect(box, box.height / 2.0, Rgb(0xFFFFFF, 0.08 + 0.1 * focus));
        if (focused) painter.StrokeRoundRect(box, box.height / 2.0, 1.8, tokens::kFocusRing);
        const double pad = box.width * 0.28;
        DrawCloseIcon(painter, Box{box.x + pad, box.y + pad, box.width - 2.0 * pad, box.height - 2.0 * pad}, kInk);
        return;
    }

    if (button.key == "account:toggle-terms") {
        const double cbSz = std::max(18.0, scale * 1.25);
        const Box cb{box.x, box.CenterY() - cbSz / 2.0, cbSz, cbSz};
        const bool hasErr = ActiveErrorField() == "terms";
        if (termsAccepted_) {
            painter.FillRoundRect(cb, scale * 0.35, Rgb(0x2F6BFF, 0.95));
            painter.StrokeRoundRect(cb, scale * 0.35, 1.5, Rgb(0x93C5FD));
            DrawCheckIcon(painter, Box{cb.x + 3.0, cb.y + 3.0, cb.width - 6.0, cb.height - 6.0}, Rgb(0xFFFFFF), 2.3);
        } else {
            painter.FillRoundRect(cb, scale * 0.35, Rgb(0x060C16, 0.56));
            painter.StrokeRoundRect(cb, scale * 0.35, 1.5, hasErr ? Rgb(0xF87171, 0.9) : Rgb(0xFFFFFF, 0.36));
        }
        if (focused) painter.StrokeRoundRect(Box{cb.x - 3.0, cb.y - 3.0, cb.width + 6.0, cb.height + 6.0},
                                             scale * 0.45, 1.5, tokens::kFocusRing);
        painter.Text(Box{cb.Right() + scale * 0.55, box.y, box.width - cbSz - scale * 0.6, box.height},
                     button.label, TextStyle{scale * 0.88, false}, kInk);
        return;
    }

    // Quiet text links across gate screens
    const bool rightAlign = (step_ == AccountStep::CreateAccount && button.key == "account:privacy") ||
                            button.key == "account:change-email";
    const bool centerAlign =
        !rightAlign && !(button.key == "account:forgot" || button.key == "account:plans" ||
                         (button.key == "account:signout" && step_ != AccountStep::TermsRequired));
    const TextStyle style{scale * 0.88, true, 600};
    const double tw = std::min(box.width, painter.MeasureText(button.label, style));
    double tx = box.x;
    if (rightAlign) tx = box.Right() - tw;
    else if (centerAlign) tx = box.CenterX() - tw / 2.0;
    else if (button.key == "account:signout" && (step_ == AccountStep::WaitingApproval || step_ == AccountStep::EmailVerify)) {
        tx = box.Right() - tw;
    }
    const bool primaryTint = button.key == "account:to-register" || button.key == "account:to-signin" ||
                             button.key == "account:change-email" ||
                             (button.key == "account:privacy" && step_ == AccountStep::CreateAccount);
    const Color baseInk = primaryTint ? Rgb(0x7DA8FF) : kMuted;
    const Color ink = Mix(baseInk, kInk, focus * 0.55);
    painter.Text(Box{tx, box.y, tw + 2.0, box.height}, button.label, style, ink);
    if (focus > 0.05) {
        painter.FillRoundRect(Box{tx, box.CenterY() + scale * 0.62, tw, 1.4}, 0.0, WithAlphaOf(ink, 0.85));
    }
    if (focused) {
        painter.StrokeRoundRect(Box{tx - scale * 0.35, box.CenterY() - scale * 0.88, tw + scale * 0.7, scale * 1.76},
                                scale * 0.4, 1.5, WithAlphaOf(tokens::kFocusRing, 0.9));
    }
}

std::optional<Command> AccountScreen::Activate(const std::string& key) {
    if (key.rfind("field:", 0) == 0) {
        activeField_ = key.substr(6);
        editing_ = true;
        focused_ = key;
        return std::nullopt;
    }
    if (key == "account:toggle-password") {
        showPassword_ = !showPassword_;
        return std::nullopt;
    }
    if (key == "account:toggle-terms") {
        termsAccepted_ = !termsAccepted_;
        ClearErrors();
        Arrange();
        return std::nullopt;
    }
    if (key == "account:forgot") {
        forgotOpen_ = !forgotOpen_;
        Arrange();
        KeepFocus("account:forgot");
        return std::nullopt;
    }
    if (key == "account:privacy") {
        privacyOpen_ = true;
        view_.openPrivacy = true;
        Arrange();
        KeepFocus("account:privacy-close");
        return std::nullopt;
    }
    if (key == "account:privacy-close" || key == "account:privacy-x") {
        privacyOpen_ = false;
        view_.openPrivacy = false;
        Arrange();
        KeepFocus("account:privacy");
        return std::nullopt;
    }
    if (key == "account:continue") return TryContinueEmail();
    if (key == "account:change-email") {
        step_ = AccountStep::SignInEmail;
        activeField_ = "email";
        editing_ = true;
        ClearErrors();
        Arrange();
        KeepFocus("field:email");
        return std::nullopt;
    }
    if (key == "account:to-register") {
        step_ = AccountStep::CreateAccount;
        activeField_ = "name";
        editing_ = true;
        ClearErrors();
        Arrange();
        KeepFocus("field:name");
        return std::nullopt;
    }
    if (key == "account:to-signin") {
        step_ = AccountStep::SignInEmail;
        activeField_ = "email";
        editing_ = true;
        ClearErrors();
        Arrange();
        KeepFocus("field:email");
        return std::nullopt;
    }
    if (key == "account:signin") return TrySignIn();
    if (key == "account:register") return TryRegister();
    if (key == "account:verify-email") return TryVerifyEmail();

    Command command;
    if (key == "account:plans") { command.name = "plans"; return command; }
    if (key == "account:realdebrid") { command.name = "realdebrid"; return command; }
    if (key == "account:live-tv") { command.name = "live"; return command; }
    if (key == "account:profiles") { command.name = "profiles"; return command; }
    if (key == "account:accounts") { command.name = "accounts"; return command; }
    if (key == "account:developer") { command.name = "developer"; return command; }

    command.action = true;
    if (key == "account:signout") { command.name = "account-signout"; return command; }
    if (key == "account:accept-terms") { command.name = "account-accept-terms"; return command; }
    if (key == "account:check-again") { command.name = "account-check-again"; return command; }
    if (key == "account:send-code") { command.name = "account-send-code"; return command; }
    return std::nullopt;
}

}  // namespace tvm::ui
