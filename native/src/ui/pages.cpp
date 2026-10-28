#include "ui/pages.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "motion/preferences.h"
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

// The width of a pill button for a label, in rems.
double ButtonWidthRem(const std::string& label) {
    return static_cast<double>(label.size()) * 0.56 * kButtonLabelRem + 2.0 * kButtonPadRem + 0.4;
}

// "£9.99", from pence, as formatBillingMoney writes sterling.
std::string Money(int pence) {
    return kPound + std::to_string(pence / 100) + "." + (pence % 100 < 10 ? "0" : "") + std::to_string(pence % 100);
}

// Lays a row of pill buttons out left to right from `x`.
void Row(std::vector<PageButton>& buttons, double x, double y, double height, double rem, int row,
         std::vector<std::pair<std::string, std::string>> items) {
    for (auto& [key, label] : items) {
        const double width = ButtonWidthRem(label) * rem;
        PageButton button;
        button.key = key;
        button.label = label;
        button.box = Box{x, y, width, height};
        button.row = row;
        buttons.push_back(std::move(button));
        x += width + kButtonGapRem * rem;
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
    buttonFocus_.Track(focused_, nowMs, motion_);
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
    const Metrics metrics{height_ / 67.5};
    painter.Clear(tokens::kBackground);
    PaintContent(painter, scroll_);
    for (const PageButton& button : Buttons()) {
        const Box box = Shifted(button.box, scroll_);
        if (box.Bottom() < 0.0 || box.y > height_) continue;
        const bool focused = focused_ == button.key;
        if (button.custom) {
            PaintCustom(painter, button, box, focused);
        } else if (button.disabled) {
            // A disabled button is drawn quiet, and the focus passes it by.
            painter.FillRoundRect(box, box.height / 2.0, WithAlphaOf(tokens::kSurface, 0.6));
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
    const double x = Rem(kSafeXRem);
    const double width = width_ - 2.0 * x;
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
    const double rem = height_ / 67.5;
    double x = Rem(kSafeXRem);
    for (const ProfileEntry& profile : view_.profiles) {
        PageButton tile;
        tile.key = "pick:" + profile.id;
        tile.label = profile.name;
        tile.box = Box{x, Rem(kTilesTopRem), Rem(kTileWidthRem), Rem(kTileHeightRem)};
        tile.custom = true;
        buttons.push_back(tile);
        // Remove sits under each tile while there is more than one.
        if (view_.profiles.size() > 1) {
            PageButton remove;
            remove.key = "remove:" + profile.id;
            remove.label = "Remove";
            remove.box = Box{x + Rem(1.0), Rem(kRemoveTopRem), Rem(kTileWidthRem - 2.0), Rem(2.5)};
            remove.row = 1;
            buttons.push_back(remove);
        }
        x += Rem(kTileWidthRem + kTileGapRem);
    }
    if (view_.profiles.size() < view_.max && !creating_) {
        PageButton add;
        add.key = "profile-add";
        add.label = "Add profile";
        add.box = Box{x, Rem(kTilesTopRem), Rem(kTileWidthRem), Rem(kTileHeightRem)};
        add.custom = true;
        buttons.push_back(add);
    }
    double y = Rem(kFieldTopRem);
    if (creating_) {
        Row(buttons, Rem(kSafeXRem), y + Rem(5.2), Rem(kButtonHeightRem), rem, 2,
            {{"profile-save", "Save profile"}, {"profile-cancel", "Cancel"}});
        buttons[buttons.size() - 2].primary = true;
        y += Rem(9.5);
    }
    Row(buttons, Rem(kSafeXRem), y, Rem(kButtonHeightRem), rem, 3, {{"profiles-back", "Back"}});
    return buttons;
}

double ProfilesScreen::ContentHeight() const {
    return Rem(kFieldTopRem + (creating_ ? 9.5 : 0.0) + kButtonHeightRem + 3.0);
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
        const double top = Rem(kFieldTopRem) - scroll;
        painter.Text(Box{x, top, Rem(30.0), Rem(1.4)}, "Profile name", TextStyle{Rem(0.9), true, 600}, tokens::kTextMuted);
        const Box field{x, top + Rem(1.6), Rem(30.0), Rem(3.0)};
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

struct Term {
    const char* name;
    int pence;
    const char* blurb;
};

// LIVE_TV_CATALOG in apps/core/src/providers/liveTv.ts.
constexpr Term kLiveTerms[] = {
    {"3-month", 3999, "Billed every 3 months"},
    {"1-year", 8999, "Billed once per year"},
    {"Lifetime", 59900, "One payment; access lasts only while the service stays online"},
};

struct Tier {
    const char* name;
    const char* summary;
    std::vector<const char*> includes;
    bool live;
};

// ACCESS_TIERS in apps/core/src/providers/accessTiers.ts. Both are 9.99 a month for the software.
constexpr int kMonthlyPence = 999;
const std::vector<Tier>& Tiers() {
    static const std::vector<Tier> tiers = {
        {"Movies and TV shows", "Films and series from your own sources, with the best available picture.",
         {"Films and series through your own sources", "4K where the source has it, HDR and Atmos passthrough",
          "Light and Dark appearance", "Up to 10 viewing profiles", "No advertising, no queue, no watch-hour limit"},
         false},
        {"Movies and TV shows + Live TV", "Everything above, plus live channels through your own IPTV subscription.",
         {"Everything in Movies and TV shows", "Live TV, using an IPTV subscription you supply",
          "Channel check, so you can see which channels actually stream", "Back to live after pausing"},
         true},
    };
    return tiers;
}

constexpr double kCardsTopRem = 12.6;
constexpr double kCardHeightRem = 26.0;
constexpr double kRouteHeightRem = 5.2;

}  // namespace

PlansScreen::PlansScreen() {
    focused_ = "donate";
}

double PlansScreen::DonateTop() const {
    return Rem(kCardsTopRem + kCardHeightRem + 1.5 + kRouteHeightRem + 2.0);
}

std::vector<PageButton> PlansScreen::Buttons() const {
    std::vector<PageButton> buttons;
    Row(buttons, Rem(kSafeXRem), DonateTop() + Rem(8.4), Rem(kButtonHeightRem), height_ / 67.5, 0,
        {{"donate", "Donate"}, {"plans-legal", "Terms & privacy"}, {"plans-back", "Back"}});
    return buttons;
}

double PlansScreen::ContentHeight() const {
    return DonateTop() + Rem(8.4 + kButtonHeightRem + 2.5);
}

void PlansScreen::PaintContent(Painter& painter, double scroll) const {
    PaintHeader(painter, Rem(kSafeYRem) - scroll, "Access", "What TVM costs",
                "Two kinds of access, arranged directly with the app owner. There is nothing to buy in the app and no "
                "card is taken here.");
    const double x = Rem(kSafeXRem);
    const double contentWidth = width_ - 2.0 * x;
    const double cardWidth = (contentWidth - Rem(1.0)) / 2.0;
    const double top = Rem(kCardsTopRem) - scroll;

    // `.tier-card`: the name and summary, the price at the right, what it includes, and Live TV's terms.
    for (std::size_t i = 0; i < Tiers().size(); ++i) {
        const Tier& tier = Tiers()[i];
        const Box card{x + static_cast<double>(i) * (cardWidth + Rem(1.0)), top, cardWidth, Rem(kCardHeightRem)};
        painter.FillRoundRect(card, Rem(0.875), tokens::kSurface);
        painter.StrokeRoundRect(card, Rem(0.875), 1.0, tokens::kBorderSoft);
        const double inner = card.x + Rem(1.2);
        const double innerWidth = card.width - Rem(2.4);
        const std::string price = Money(kMonthlyPence);
        const TextStyle priceStyle{Rem(1.35), true, 700};
        const double priceWidth = painter.MeasureText(price + "/month", priceStyle);
        painter.Text(Box{inner, card.y + Rem(1.1), innerWidth - priceWidth - Rem(1.0), Rem(1.6)}, tier.name,
                     TextStyle{Rem(1.1), true, 700}, tokens::kText);
        painter.Paragraph(Box{inner, card.y + Rem(2.8), innerWidth - priceWidth - Rem(1.0), Rem(2.6)}, tier.summary,
                          TextStyle{Rem(0.87), false}, tokens::kTextMuted);
        painter.Text(Box{card.Right() - Rem(1.2) - priceWidth, card.y + Rem(1.0), priceWidth + 2.0, Rem(1.8)},
                     price + "/month", priceStyle, tokens::kText);
        if (tier.live) {
            const std::string note = "plus Live TV from " + Money(kLiveTerms[0].pence);
            const TextStyle noteStyle{Rem(0.8), false};
            const double noteWidth = painter.MeasureText(note, noteStyle);
            painter.Text(Box{card.Right() - Rem(1.2) - noteWidth, card.y + Rem(2.9), noteWidth + 2.0, Rem(1.3)}, note,
                         noteStyle, tokens::kTextMuted);
        }
        double y = card.y + Rem(6.0);
        for (const char* line : tier.includes) {
            painter.FillRoundRect(Box{inner + Rem(0.2), y + Rem(0.62), Rem(0.32), Rem(0.32)}, Rem(0.16), tokens::kTextFaint);
            painter.Text(Box{inner + Rem(1.0), y, innerWidth - Rem(1.0), Rem(1.5)}, line, TextStyle{Rem(0.89), false},
                         tokens::kTextMuted);
            y += Rem(1.65);
        }
        if (!tier.live) continue;
        y += Rem(0.6);
        painter.FillRoundRect(Box{inner, y, innerWidth, 1.0}, 0.0, tokens::kBorderSoft);
        y += Rem(0.9);
        painter.Text(Box{inner, y, innerWidth, Rem(1.2)}, "LIVE TV IS PRICED SEPARATELY", TextStyle{Rem(0.78), true, 700},
                     tokens::kTextFaint);
        y += Rem(1.6);
        for (const Term& term : kLiveTerms) {
            painter.Text(Box{inner, y, innerWidth * 0.6, Rem(1.4)}, term.name, TextStyle{Rem(0.9), true, 600}, tokens::kText);
            const std::string money = Money(term.pence);
            const TextStyle moneyStyle{Rem(0.9), true, 600};
            const double moneyWidth = painter.MeasureText(money, moneyStyle);
            painter.Text(Box{inner + innerWidth - moneyWidth, y, moneyWidth + 2.0, Rem(1.4)}, money, moneyStyle, tokens::kText);
            painter.Text(Box{inner, y + Rem(1.3), innerWidth, Rem(1.2)}, term.blurb, TextStyle{Rem(0.78), false},
                         tokens::kTextFaint);
            y += Rem(2.9);
        }
        painter.Paragraph(Box{inner, y, innerWidth, Rem(2.6)},
                          "Live TV connects an IPTV subscription you supply and hold yourself. TVM does not include "
                          "one, and supplies no channels.",
                          TextStyle{Rem(0.8), false}, tokens::kTextFaint);
    }

    // `.tier-route`: how access is arranged, in the accent's tint.
    const Box route{x, top + Rem(kCardHeightRem + 1.5), contentWidth, Rem(kRouteHeightRem)};
    painter.FillRoundRect(route, Rem(0.75), Rgb(0x6EC8FF, 0.12));
    painter.StrokeRoundRect(route, Rem(0.75), 1.0, Rgb(0x6EC8FF, 0.35));
    painter.Text(Box{route.x + Rem(1.2), route.y + Rem(0.8), route.width, Rem(1.6)}, "Access is arranged with the app owner",
                 TextStyle{Rem(1.1), true, 700}, tokens::kText);
    painter.Paragraph(Box{route.x + Rem(1.2), route.y + Rem(2.5), route.width - Rem(2.4), Rem(2.6)},
                      "There is no checkout here and nothing to buy in the app. Create an account, then contact the "
                      "owner to have it switched on. The prices above are what access costs.",
                      TextStyle{Rem(0.9), false}, tokens::kTextMuted);

    // `.tier-donate`: far below the prices and fenced off from them, so it never reads as the way to pay.
    const double donate = DonateTop() - scroll;
    painter.FillRoundRect(Box{x, donate, contentWidth, 1.0}, 0.0, tokens::kBorderSoft);
    painter.Text(Box{x, donate + Rem(1.4), contentWidth, Rem(1.8)}, "Donate to the app owner", TextStyle{Rem(1.25), true, 700},
                 tokens::kText);
    painter.Text(Box{x, donate + Rem(3.2), contentWidth, Rem(1.4)}, "Optional, and it gives you nothing.",
                 TextStyle{Rem(0.95), true, 600}, tokens::kTextMuted);
    painter.Paragraph(Box{x, donate + Rem(4.8), std::min(contentWidth, Rem(kLedeWidthRem + 8.0)), Rem(3.2)},
                      "A donation is a gift. It does not create an account, activate one, upgrade one or extend one, "
                      "and nothing in the app changes because you sent it. If you want access, contact the owner \xE2\x80\x94 "
                      "do not donate and expect it.",
                      TextStyle{Rem(0.9), false}, tokens::kTextFaint);
}

std::optional<Command> PlansScreen::Activate(const std::string& key) {
    Command command;
    if (key == "donate") {
        command.name = "donate";
        return command;
    }
    if (key == "plans-legal") {
        command.name = "legal";
        return command;
    }
    if (key == "plans-back") {
        command.name = "back";
        command.action = true;
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
    Row(buttons, Rem(kSafeXRem), Rem(kUpdateButtonsTopRem), Rem(kButtonHeightRem), height_ / 67.5, 0,
        {{"check", view_.busy ? "Checking\xE2\x80\xA6" : "Check now"},
         {"apply", "Apply (disabled here)"},
         {"auto-update", view_.autoUpdate ? "Automatic updates on" : "Automatic updates off"},
         {"back", "Back"}});
    // Check now keeps the focus while it works, and ignores presses until the answer is in.
    buttons[0].primary = true;
    // The native app is replaced by installing a newer build, so it has nothing to apply to itself.
    buttons[1].disabled = true;
    return buttons;
}

double UpdatesScreen::ContentHeight() const {
    return Rem(kChangesTopRem + 2.0 + static_cast<double>(view_.changes.size()) * kChangeRowRem + 2.0);
}

void UpdatesScreen::PaintContent(Painter& painter, double scroll) const {
    PaintHeader(painter, Rem(kSafeYRem) - scroll, "GLogic Studios", "Updates",
                "Builds come from GitHub (GL-327/TVM). This native build does not replace itself: a newer one is "
                "installed in its place. Check now shows what has changed on GitHub.");
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
        painter.FillRoundRect(row, Rem(0.5), tokens::kSurface);
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
    double y = Rem(kChangesTopRem) - scroll;
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
    if (height_ <= 0.0) return;
    const double rem = height_ / 67.5;
    const double x = Rem(kSafeXRem);
    const double widthRem = std::min(width_ / rem - 2.0 * kSafeXRem, kInfoWidthRem);
    double y = Rem(kSafeYRem + 4.8);
    int row = 0;

    ledeTop_ = y;
    ledeHeight_ = view_.lede.empty() ? 0.0 : Rem(Lines(view_.lede, 1.0625, std::min(widthRem, 48.0)) * 1.6);
    y += ledeHeight_ + (view_.lede.empty() ? 0.0 : Rem(1.0));

    const auto addRow = [&](const std::vector<InfoAction>& actions) {
        if (actions.empty()) return;
        double left = x;
        for (const InfoAction& action : actions) {
            PageButton button;
            button.key = action.key;
            button.label = action.label;
            button.primary = action.primary;
            button.disabled = action.disabled;
            const double width = ButtonWidthRem(action.label) * rem;
            button.box = Box{left, y, width, Rem(kButtonHeightRem)};
            button.row = row;
            buttons_.push_back(std::move(button));
            left += width + Rem(kButtonGapRem);
        }
        y += Rem(kButtonHeightRem + 1.0);
        ++row;
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
    }
    if (!view_.blocks.empty()) y += Rem(0.8);

    for (const std::vector<InfoAction>& line : view_.actions) addRow(line);
    contentHeight_ = y + Rem(2.0);
}

void InfoScreen::PaintContent(Painter& painter, double scroll) const {
    const double x = Rem(kSafeXRem);
    PaintHeader(painter, Rem(kSafeYRem) - scroll, view_.kicker, view_.heading, "");
    if (!view_.lede.empty()) {
        painter.Paragraph(Box{x, ledeTop_ - scroll, std::min(width_ - 2.0 * x, Rem(48.0)), ledeHeight_ + Rem(0.4)},
                          view_.lede, TextStyle{Rem(1.0625), false}, tokens::kTextMuted);
    }
    const double widthPx = std::min(width_ - 2.0 * x, Rem(kInfoWidthRem));
    if (!view_.message.empty()) {
        painter.Paragraph(Box{x, messageTop_ - scroll, widthPx, Rem(Lines(view_.message, 1.0, widthPx / (height_ / 67.5)) * 1.6)},
                          view_.message, TextStyle{Rem(1.0), true, 600},
                          view_.messageBad ? Rgb(0xFF8A80) : tokens::kAccentStrong);
    }
    if (view_.field) {
        const double top = fieldTop_ - scroll;
        painter.Text(Box{x, top, widthPx, Rem(1.4)}, view_.fieldLabel, TextStyle{Rem(0.9), true, 600}, tokens::kTextMuted);
        const Box box{x, top + Rem(1.6), std::min(widthPx, Rem(36.0)), Rem(3.0)};
        painter.FillRoundRect(box, Rem(0.6), tokens::kSurface);
        painter.StrokeRoundRect(box, Rem(0.6), Rem(kFocusRingWidthRem), tokens::kFocusRing);
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
        case InfoBlock::Kind::Row:
            painter.FillRoundRect(box, Rem(0.5), tokens::kSurface);
            painter.Text(Box{box.x + Rem(1.0), box.y, Rem(16.0), box.height}, block.text, TextStyle{Rem(1.0), false},
                         tokens::kTextMuted);
            painter.Text(Box{box.x + Rem(17.0), box.y, box.width - Rem(18.0), box.height}, block.value,
                         TextStyle{Rem(1.0), false}, block.bad || block.good ? tone : tokens::kText);
            break;
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

}  // namespace tvm::ui
