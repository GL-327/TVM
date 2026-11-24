#include "ui/details_screen.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <set>
#include <utility>

#include "motion/preferences.h"
#include "ui/glass_styles.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

// details.css, in rems.
constexpr double kSafeXRem = 2.5;
constexpr double kDetailsPosterWidthRem = 11.2;
constexpr double kDetailsPosterHeightRem = 16.8;
constexpr double kPosterRadiusRem = 0.7;
constexpr double kCopyGapRem = 1.6;
constexpr double kCopyMaxRem = 46.0;
constexpr double kHeroPadBottomRem = 1.35;
constexpr double kButtonHeightRem = 2.85;
constexpr double kButtonGapRem = 0.75;
constexpr double kSeasonTabHeightRem = 2.75;
constexpr double kEpisodeHeightRem = 4.95;
constexpr double kEpisodeGapRem = 0.55;
constexpr double kStillWidthRem = 7.0;
constexpr double kStillHeightRem = 3.95;
constexpr double kListMaxRem = 64.0;
constexpr double kScrollMs = 280.0;
constexpr std::size_t kGenresShown = 3;

constexpr char kPlayKey[] = "play";
constexpr char kListKey[] = "list";
constexpr char kDownloadKey[] = "download";
constexpr char kBackKey[] = "back";
// The season picker: one control showing the season, which opens a list of every season.
constexpr char kSeasonMenuKey[] = "season-menu";
constexpr char kSeasonPickPrefix[] = "season-pick:";
constexpr char kEpisodePrefix[] = "ep:";

bool StartsWith(const std::string& text, const char* prefix) {
    return text.rfind(prefix, 0) == 0;
}

bool Contains(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

std::string Two(int value) {
    char text[8];
    std::snprintf(text, sizeof(text), "%02d", value);
    return text;
}

Color WithAlpha(Color color, double alpha) {
    color.a *= alpha;
    return color;
}

}  // namespace

DetailsScreen::DetailsScreen(std::string id, std::string title) : id_(std::move(id)), title_(std::move(title)) {
    info_.id = id_;
    info_.title = title_;
}

void DetailsScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    scroll_ = std::clamp(scroll_, 0.0, MaxScroll());
}

bool DetailsScreen::IsSeries() const {
    return info_.kind == "series" || !info_.children.empty();
}

std::vector<int> DetailsScreen::Seasons() const {
    std::set<int> seasons;
    for (const catalog::MediaItem& child : info_.children) {
        if (child.season.has_value()) seasons.insert(*child.season);
    }
    // Specials, season 0, go last, as the web lists the numbered seasons first.
    std::vector<int> ordered;
    for (int season : seasons) {
        if (season > 0) ordered.push_back(season);
    }
    if (seasons.contains(0)) ordered.push_back(0);
    return ordered;
}

std::vector<const catalog::MediaItem*> DetailsScreen::Episodes() const {
    std::vector<const catalog::MediaItem*> episodes;
    for (const catalog::MediaItem& child : info_.children) {
        if (child.season.value_or(-1) == season_) episodes.push_back(&child);
    }
    return episodes;
}

void DetailsScreen::SetInfo(TitleInfo info) {
    const bool first = info_.state != TitleInfo::State::Ready && info.state == TitleInfo::State::Ready;
    info_ = std::move(info);
    if (info_.title.empty()) info_.title = title_;
    const std::vector<int> seasons = Seasons();
    // The first answer opens on the first numbered season (Specials, season 0, come last). Later answers keep the
    // season shown, while it is still there.
    if (first || std::find(seasons.begin(), seasons.end(), season_) == seasons.end()) {
        season_ = seasons.empty() ? 0 : seasons[0];
    }
    // A series opens on its first season, as Details.tsx focuses it. A film opens on Play.
    if (first && IsSeries() && !seasons.empty()) focused_ = kSeasonMenuKey;
    if (!BoxOf(focused_).has_value()) focused_ = ActionKeys().front();
}

bool DetailsScreen::HasListButton() const {
    // The button saves the catalogue's record of the title, so it waits until that has loaded.
    return info_.state == TitleInfo::State::Ready && !info_.media.id.empty();
}

std::vector<std::string> DetailsScreen::ActionKeys() const {
    std::vector<std::string> keys;
    // A series plays from its episodes, so it has no Play button, as on the web.
    if (!IsSeries()) keys.push_back(kPlayKey);
    if (HasListButton()) keys.push_back(kListKey);
    // Downloads takes the catalogue's id, so it also waits for the record, as the list button does.
    if (HasListButton()) keys.push_back(kDownloadKey);
    return keys;
}

std::vector<std::string> DetailsScreen::SeasonKeys() const {
    // One control for all the seasons, as the Android app has, in place of a row of season pills.
    if (Seasons().empty()) return {};
    return {kSeasonMenuKey};
}

std::string DetailsScreen::SeasonLabel(int season) {
    return season == 0 ? "Specials" : "Season " + std::to_string(season);
}

double DetailsScreen::ContentHeight() const {
    if (!IsSeries()) return HeroHeight();
    const double episodes = static_cast<double>(Episodes().size());
    return HeroHeight() + Rem(1.0) + SeasonsHeight() + Rem(1.2) +
           episodes * (Rem(kEpisodeHeightRem) + Rem(kEpisodeGapRem)) + Rem(2.4);
}

double DetailsScreen::MaxScroll() const {
    return std::max(0.0, ContentHeight() - height_);
}

std::optional<Box> DetailsScreen::BoxOf(const std::string& key) const {
    // Back is a bare arrow fixed at the top left, over the backdrop, with a hit area of at least 44 px.
    if (key == kBackKey) {
        const double side = std::max(44.0, Rem(3.0));
        return Box{Rem(1.4), Rem(1.4), side, side};
    }
    const double x = Rem(kSafeXRem);
    const double heroBottom = HeroHeight() - scroll_ - Rem(kHeroPadBottomRem);
    const bool compact = CompactViewport(width_, height_);
    const double posterY = compact ? Rem(3.0) - scroll_ : heroBottom - Rem(kDetailsPosterHeightRem);
    const double copyX = compact ? x : x + Rem(kDetailsPosterWidthRem) + Rem(kCopyGapRem);
    const double buttonsY = posterY + Rem(8.2);

    FlowLayout actions(copyX, buttonsY, width_ - copyX - x, Rem(kButtonGapRem));
    for (const std::string& action : ActionKeys()) {
        const double width = action == kListKey ? Rem(14.5) : action == kPlayKey ? Rem(8.4) : action == kDownloadKey ? Rem(10.0) : Rem(7.0);
        const Box box = actions.Place(width, compact ? std::max(44.0, Rem(kButtonHeightRem)) : Rem(kButtonHeightRem));
        if (action == key) return box;
    }

    const double tabsY = HeroHeight() - scroll_ + Rem(1.0);
    if (key == kSeasonMenuKey && !Seasons().empty()) {
        // Wide enough for the longest season name and the chevron, so it does not change size between seasons.
        std::size_t longest = 0;
        for (int season : Seasons()) longest = std::max(longest, SeasonLabel(season).size());
        const double width = Rem(1.2) + static_cast<double>(longest) * 0.56 * Rem(1.0) + Rem(2.4);
        return Box{x, tabsY, width, Rem(kSeasonTabHeightRem)};
    }

    if (StartsWith(key, kEpisodePrefix)) {
        const std::size_t index = std::stoul(key.substr(sizeof(kEpisodePrefix) - 1));
        if (index >= Episodes().size()) return std::nullopt;
        const double top = tabsY + SeasonsHeight() + Rem(1.2) +
                           static_cast<double>(index) * (Rem(kEpisodeHeightRem) + Rem(kEpisodeGapRem));
        return Box{x, top, std::min(width_ - 2.0 * x, Rem(kListMaxRem)), Rem(kEpisodeHeightRem)};
    }
    return std::nullopt;
}

double DetailsScreen::SeasonsHeight() const {
    return Seasons().empty() ? 0.0 : Rem(kSeasonTabHeightRem);
}

std::string DetailsScreen::MetaLine() const {
    // The parts that are known, joined with a middle dot.
    std::vector<std::string> parts;
    if (!info_.rating.empty()) parts.push_back("IMDb " + info_.rating);
    if (info_.year.has_value()) parts.push_back(std::to_string(*info_.year));
    if (info_.runtime.has_value() && !info_.runtime->empty()) parts.push_back(*info_.runtime);
    const std::size_t seasons = Seasons().size();
    if (IsSeries() && seasons > 0) parts.push_back(seasons == 1 ? "1 season" : std::to_string(seasons) + " seasons");
    for (std::size_t i = 0; i < info_.genres.size() && i < kGenresShown; ++i) parts.push_back(info_.genres[i]);

    std::string line;
    for (const std::string& part : parts) {
        if (!line.empty()) line += " \xC2\xB7 ";
        line += part;
    }
    return line;
}

bool DetailsScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    buttonFocus_.Track(focused_, focusHidden_, nowMs, motion_);
    if (scrollTween_.has_value()) {
        scroll_ = scrollTween_->Value(nowMs);
        if (scrollTween_->Done(nowMs)) scrollTween_.reset();
    }
    return Animating();
}

bool DetailsScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_) || scrollTween_.has_value() || seasonList_.Animating(clockMs_);
}

void DetailsScreen::Paint(Painter& painter) const {
    PaintPage(painter);
    PaintBack(painter);
    seasonList_.Paint(painter, clockMs_);
}

void DetailsScreen::PaintBack(Painter& painter) const {
    // A minimal arrow: no pill and no word, a thick rounded stroke on a soft shadow so it reads over any backdrop.
    // The pointer or the remote brightens it and grows it a touch; there is no outline around it.
    const Box box = *BoxOf(kBackKey);
    const double amount = buttonFocus_.Amount(kBackKey, clockMs_);
    const double glyph = Rem(1.75) * (1.0 + 0.12 * amount);
    const Box arrow{box.CenterX() - glyph / 2.0, box.CenterY() - glyph / 2.0, glyph, glyph};
    painter.Path(Box{arrow.x, arrow.y + 1.5, arrow.width, arrow.height}, 24.0, "M15 5l-7 7 7 7",
                 PathStyle{Color{0, 0, 0, 0}, Rgb(0x000000, 0.45), 2.4, false});
    Color ink = tokens::kText;
    ink.a = 0.78 + 0.22 * amount;
    painter.Path(arrow, 24.0, "M15 5l-7 7 7 7", PathStyle{Color{0, 0, 0, 0}, ink, 2.4, false});
}

void DetailsScreen::PaintPage(Painter& painter) const {
    const Metrics metrics{ViewportRem(width_, height_)};
    const Color background = tokens::kBackground;
    painter.Clear(background);

    // The backdrop fills the top of the page, under the vignette: dark at the left behind the copy, and
    // fading into the page at the foot, as `.details__vignette` paints it.
    // The hero sits on whole pixels. With a fractional foot, the picture and the gradient closing it over it were
    // both drawn at partial coverage on that last row, so up to a quarter of the picture showed there: a thin line
    // under the backdrop.
    const double heroTop = std::round(-scroll_);
    const Box hero{0.0, heroTop, width_, std::round(-scroll_ + HeroHeight()) - heroTop};
    const std::string& backdropUrl = info_.backdropUrl.empty() ? "asset:lighthouse.jpg" : info_.backdropUrl;
    painter.SetBackdrop(hero, backdropUrl, 0.5, 0.25);
    if (!info_.backdropUrl.empty()) painter.ImageFaded(hero, info_.backdropUrl, 0.0, 1.0, 0.5, 0.25);
    painter.FillLinearGradient(hero, hero.x, hero.y, hero.Right(), hero.y,
                               {GradientStop{0.0, WithAlpha(background, 0.88)},
                                GradientStop{0.34, WithAlpha(background, 0.28)},
                                GradientStop{0.68, WithAlpha(background, 0.0)},
                                GradientStop{1.0, WithAlpha(background, 0.0)}});
    painter.FillLinearGradient(hero, hero.x, hero.y, hero.x, hero.Bottom(),
                               {GradientStop{0.0, WithAlpha(background, 0.0)},
                                GradientStop{0.38, WithAlpha(background, 0.0)},
                                GradientStop{0.68, WithAlpha(background, 0.52)},
                                GradientStop{0.94, background},
                                GradientStop{1.0, background}});
    // And the last rows are the page's own ground, solid, so nothing of the picture can show at the seam.
    painter.FillRoundRect(Box{hero.x, hero.Bottom() - 2.0, hero.width, 3.0}, 0.0, background);

    // The poster: artwork when it is on disk, a glass card placeholder until then.
    const double x = Rem(kSafeXRem);
    const bool compact = CompactViewport(width_, height_);
    const double posterY = compact ? Rem(3.0) - scroll_ : HeroHeight() - scroll_ - Rem(kHeroPadBottomRem) - Rem(kDetailsPosterHeightRem);
    // On whole pixels, as the cards are, so no partly covered row of the picture shows at its foot.
    const Box poster{std::round(x), std::round(posterY), std::round(x + Rem(kDetailsPosterWidthRem)) - std::round(x),
                     std::round(posterY + Rem(kDetailsPosterHeightRem)) - std::round(posterY)};
    if (!compact) {
        const bool hasPoster = !info_.posterUrl.empty() && painter.Image(poster, info_.posterUrl, Rem(kPosterRadiusRem));
        GlassStyle posterGlass;
        posterGlass.kind = GlassKind::Card;
        posterGlass.rimOnly = hasPoster;
        posterGlass.reduceTransparency = tokens::reduceTransparency;
        posterGlass.tint = tokens::kSurface;
        painter.Glass(poster, Rem(kPosterRadiusRem), posterGlass);
    }

    // The copy: the kicker pill, the title, the metadata, the buttons, then the synopsis.
    const double copyX = compact ? x : poster.Right() + Rem(kCopyGapRem);
    const double copyWidth = std::min(width_ - copyX - x, Rem(kCopyMaxRem));
    const std::string kicker = IsSeries() ? "SERIES" : "FILM";
    const TextStyle kickerStyle{Rem(0.72), true, 750};
    const double kickerWidth = painter.MeasureText(kicker, kickerStyle) + Rem(1.16);
    const Box pill{copyX, posterY, kickerWidth, Rem(1.4)};
    GlassStyle pillGlass;
    pillGlass.kind = GlassKind::Tab;
    pillGlass.reduceTransparency = tokens::reduceTransparency;
    pillGlass.tint = WithAlpha(tokens::kAccentStrong, 0.18);
    painter.Glass(pill, pill.height / 2.0, pillGlass);
    painter.Text(Box{pill.x + Rem(0.58), pill.y, pill.width, pill.height}, kicker, kickerStyle, tokens::kAccentStrong);
    painter.Text(Box{copyX, posterY + Rem(1.9), copyWidth, Rem(3.8)}, info_.title, TextStyle{Rem(3.0), true, 700},
                 tokens::kText);
    painter.Text(Box{copyX, posterY + Rem(5.8), copyWidth, Rem(1.5)}, MetaLine(), TextStyle{Rem(1.125), false, 450},
                 tokens::kTextMuted);
    for (const std::string& key : ActionKeys()) {
        const std::string label = key == kPlayKey   ? "Play"
                                  : key == kListKey ? (info_.saved ? "Remove from My List" : "Add to My List")
                                                    : "Download";
        DrawButton(painter, metrics, *BoxOf(key), label,
                   ButtonLook{key == kPlayKey, ShowsFocus(focused_, key), buttonFocus_.Amount(key, clockMs_)});
    }
    const auto lastAction = BoxOf(ActionKeys().back());
    const Box synopsis{copyX, compact && lastAction ? lastAction->Bottom() + Rem(1.0) : posterY + Rem(11.6), copyWidth, Rem(4.4)};
    std::string body = info_.synopsis;
    if (info_.state == TitleInfo::State::Loading) body = "Loading the details...";
    if (info_.state == TitleInfo::State::Unavailable) {
        body = "This title could not be loaded. Check the connection, or choose another title.";
    }
    if (info_.state == TitleInfo::State::Ready && body.empty()) body = "No synopsis is listed for this title.";
    painter.Paragraph(synopsis, body, TextStyle{Rem(1.0), false}, tokens::kTextMuted);

    if (!IsSeries()) return;

    // The season picker, then the season's episodes. The picker is the Home nav pill's glass: its resting capsule,
    // and its hover plate under the pointer or the remote, with the label turning dark on the plate.
    if (const std::optional<Box> menu = BoxOf(kSeasonMenuKey); menu.has_value() && menu->Bottom() >= 0.0 && menu->y <= height_) {
        const double amount = seasonList_.IsOpen() ? 1.0 : buttonFocus_.Amount(kSeasonMenuKey, clockMs_);
        const double radius = Rem(0.75);
        painter.Glass(*menu, radius, glass::NavCapsule());
        if (amount > 0.01) painter.Glass(*menu, radius, glass::NavHover(amount));
        const Color ink = glass::InkOnPlate(amount);
        const TextStyle style{Rem(1.0), true, 650};
        painter.Text(Box{menu->x + Rem(1.0), menu->y, menu->width - Rem(2.6), menu->height}, SeasonLabel(season_), style, ink);
        if (Seasons().size() > 1) {
            const double chev = Rem(0.85);
            painter.Path(Box{menu->Right() - Rem(1.0) - chev, menu->CenterY() - chev / 2.0, chev, chev}, 24.0,
                         seasonList_.IsOpen() ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6",
                         PathStyle{Color{0, 0, 0, 0}, ink, 2.4, false});
        }
    }

    const std::vector<const catalog::MediaItem*> episodes = Episodes();
    if (episodes.empty() && info_.state == TitleInfo::State::Ready) {
        const Box tabs = BoxOf(SeasonKeys().empty() ? "" : SeasonKeys().front()).value_or(Box{x, HeroHeight() - scroll_, 0, 0});
        painter.Text(Box{x, tabs.y, width_ - 2.0 * x, Rem(2.0)}, "No episodes are available yet.",
                     TextStyle{Rem(1.0), false}, tokens::kTextFaint);
    }
    for (std::size_t i = 0; i < episodes.size(); ++i) {
        const std::string key = kEpisodePrefix + std::to_string(i);
        const Box row = *BoxOf(key);
        if (row.Bottom() < 0.0 || row.y > height_) continue;
        const catalog::MediaItem& episode = *episodes[i];
        const bool focused = ShowsFocus(focused_, key);
        GlassStyle rowGlass;
        rowGlass.kind = GlassKind::Card;
        rowGlass.focused = focused;
        rowGlass.focusAmount = focused ? 1.0 : 0.0;
        rowGlass.reduceTransparency = tokens::reduceTransparency;
        rowGlass.tint = focused ? tokens::kSurfaceHover : WithAlpha(tokens::kSurface, 0.7);
        rowGlass.ringWidth = Rem(kFocusRingWidthRem);
        rowGlass.ringColor = tokens::kFocusRing;
        painter.Glass(row, Rem(0.875), rowGlass);

        const Box still{row.x + Rem(0.5), row.y + Rem(0.5), Rem(kStillWidthRem), Rem(kStillHeightRem)};
        if (episode.poster.empty() || !painter.Image(still, episode.poster, Rem(0.4))) {
            painter.FillLinearGradient(still, still.x, still.y, still.Right(), still.Bottom(),
                                       {GradientStop{0.0, Rgb(0x1C1C1F)}, GradientStop{1.0, Rgb(0x101012)}});
        }
        const double textX = still.Right() + Rem(1.0);
        const double textWidth = row.Right() - textX - Rem(1.0);
        const std::string number = "S" + Two(episode.season.value_or(0)) + "E" + Two(episode.episode.value_or(0));
        const TextStyle numberStyle{Rem(0.78), true, 750};
        const double numberWidth = painter.MeasureText(number, numberStyle);
        painter.Text(Box{textX, row.y + Rem(0.55), numberWidth + 2.0, Rem(1.4)}, number, numberStyle,
                     tokens::kAccentStrong);
        const std::string name = episode.episodeName.value_or(episode.title);
        painter.Text(Box{textX + numberWidth + Rem(0.6), row.y + Rem(0.5), textWidth - numberWidth - Rem(0.6), Rem(1.5)},
                     name, TextStyle{Rem(1.0625), true, 650}, tokens::kText);
        std::string line = episode.synopsis;
        if (line.empty() && episode.aired.has_value()) line = "Aired " + episode.aired->substr(0, 10);
        painter.Text(Box{textX, row.y + Rem(2.3), textWidth, Rem(1.4)}, line, TextStyle{Rem(0.9), false},
                     tokens::kTextMuted);
        if (!episode.rating.empty()) {
            painter.Text(Box{textX, row.y + Rem(3.35), textWidth, Rem(1.2)}, "IMDb " + episode.rating,
                         TextStyle{Rem(0.78), false}, tokens::kTextFaint);
        }
    }
}

void DetailsScreen::ScrollTo(double target, double nowMs) {
    const double clamped = std::clamp(target, 0.0, MaxScroll());
    if (std::abs(clamped - scroll_) < 0.5) return;
    const bool reduced = motion::PrefersReducedMotion(motion_);
    scrollTween_ = motion::Tween(scroll_, clamped, nowMs, reduced ? 0.0 : kScrollMs);
}

void DetailsScreen::FollowFocus(double nowMs) {
    // The buttons sit in the hero, so the page goes back to the top for them. A tab or an episode is
    // brought to a third of the way down, so the rows after it show.
    if (focused_ != kSeasonMenuKey && !StartsWith(focused_, kEpisodePrefix)) {
        const auto box = BoxOf(focused_);
        ScrollTo(box && box->Bottom() > height_ - Rem(1.0) ? box->Bottom() + scroll_ - height_ + Rem(2.0) : 0.0, nowMs);
        return;
    }
    const std::optional<Box> box = BoxOf(focused_);
    if (!box.has_value()) return;
    const double top = box->y + scroll_;
    ScrollTo(top - height_ * 0.32, nowMs);
}

bool DetailsScreen::Navigate(nav::Direction direction, double nowMs) {
    // An open season list takes the arrows.
    if (seasonList_.IsOpen()) return seasonList_.Navigate(direction, nowMs);
    const std::vector<std::string> actions = ActionKeys();
    const bool picker = !SeasonKeys().empty();
    const std::size_t episodes = Episodes().size();
    const auto move = [&](const std::string& key) {
        focused_ = key;
        FollowFocus(nowMs);
        return true;
    };
    const auto along = [&](const std::vector<std::string>& row) -> bool {
        const auto current = std::find(row.begin(), row.end(), focused_);
        if (current == row.end()) return false;
        if (direction == nav::Direction::Right && current + 1 != row.end()) return move(*(current + 1));
        if (direction == nav::Direction::Left && current != row.begin()) return move(*(current - 1));
        return false;
    };

    if (focused_ == kBackKey) {
        // From the arrow, Down or Right returns to the buttons.
        if (direction == nav::Direction::Down || direction == nav::Direction::Right) return move(actions.front());
        return false;
    }
    if (std::find(actions.begin(), actions.end(), focused_) != actions.end()) {
        if (direction == nav::Direction::Up) return move(kBackKey);
        if (direction == nav::Direction::Down && picker) return move(kSeasonMenuKey);
        if (direction == nav::Direction::Down && episodes > 0) return move(std::string(kEpisodePrefix) + "0");
        return along(actions);
    }
    if (focused_ == kSeasonMenuKey) {
        if (direction == nav::Direction::Up) return move(actions.front());
        if (direction == nav::Direction::Down && episodes > 0) return move(std::string(kEpisodePrefix) + "0");
        return false;
    }
    if (StartsWith(focused_, kEpisodePrefix)) {
        const std::size_t index = std::stoul(focused_.substr(sizeof(kEpisodePrefix) - 1));
        if (direction == nav::Direction::Up) {
            if (index > 0) return move(kEpisodePrefix + std::to_string(index - 1));
            return move(picker ? std::string(kSeasonMenuKey) : actions.front());
        }
        if (direction == nav::Direction::Down && index + 1 < episodes) return move(kEpisodePrefix + std::to_string(index + 1));
    }
    return false;
}

bool DetailsScreen::CloseOverlay(double nowMs) {
    if (!seasonList_.IsOpen()) return false;
    seasonList_.Close(nowMs);
    return true;
}

void DetailsScreen::PickSeason(std::size_t index, double nowMs) {
    const std::vector<int> seasons = Seasons();
    // The episodes follow at once; the page keeps its place, as the Android picker keeps the scroll.
    if (index < seasons.size()) season_ = seasons[index];
    seasonList_.Close(nowMs);
    focused_ = kSeasonMenuKey;
}

std::optional<Command> DetailsScreen::Select(double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (seasonList_.IsOpen()) {
        PickSeason(seasonList_.Highlighted(), nowMs);
        return std::nullopt;
    }
    return Activate(focused_);
}

std::optional<std::string> DetailsScreen::FocusedKey() const {
    return focused_;
}

bool DetailsScreen::FocusItem(const std::string& key, double nowMs, bool /*withCamera*/) {
    if (StartsWith(key, kSeasonPickPrefix)) {
        seasonList_.Hover(std::stoul(key.substr(sizeof(kSeasonPickPrefix) - 1)), nowMs);
        return true;
    }
    // A hover moves the focus, and leaves the page where it is.
    if (key == focused_ || !BoxOf(key).has_value()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> DetailsScreen::ItemAt(double x, double y) const {
    if (seasonList_.IsOpen()) {
        // While the season list is open it is the only thing to pick; a click anywhere else closes it.
        if (const std::optional<std::size_t> row = seasonList_.RowAt(x, y)) return kSeasonPickPrefix + std::to_string(*row);
        if (seasonList_.Contains(x, y)) return std::nullopt;
        return std::string("season-dismiss");
    }
    // The arrow sits over the page, so it is found first.
    std::vector<std::string> keys = {kBackKey};
    for (const std::string& key : ActionKeys()) keys.push_back(key);
    for (const std::string& key : SeasonKeys()) keys.push_back(key);
    for (std::size_t i = 0; i < Episodes().size(); ++i) keys.push_back(kEpisodePrefix + std::to_string(i));
    for (const std::string& key : keys) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && Contains(*box, x, y)) return key;
    }
    return std::nullopt;
}

std::optional<Command> DetailsScreen::ActivateItem(const std::string& key, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (key == "season-dismiss") {
        seasonList_.Close(nowMs);
        return std::nullopt;
    }
    if (StartsWith(key, kSeasonPickPrefix)) {
        PickSeason(std::stoul(key.substr(sizeof(kSeasonPickPrefix) - 1)), nowMs);
        return std::nullopt;
    }
    if (!BoxOf(key).has_value()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> DetailsScreen::Activate(const std::string& key) {
    if (key == kSeasonMenuKey) {
        // The list of every season, each with its episode count, opens under the control on the current season.
        const std::vector<int> seasons = Seasons();
        if (seasons.size() < 2) return std::nullopt;
        std::vector<DropdownOption> options;
        std::size_t current = 0;
        for (std::size_t i = 0; i < seasons.size(); ++i) {
            std::size_t count = 0;
            for (const catalog::MediaItem& child : info_.children) {
                if (child.season.value_or(-1) == seasons[i]) ++count;
            }
            options.push_back(DropdownOption{SeasonLabel(seasons[i]),
                                             count == 1 ? "1 episode" : std::to_string(count) + " episodes"});
            if (seasons[i] == season_) current = i;
        }
        seasonList_.Open(*BoxOf(kSeasonMenuKey), std::move(options), current, width_, height_,
                         ViewportRem(width_, height_), clockMs_, motion_);
        return std::nullopt;
    }
    Command command;
    if (key == kPlayKey || StartsWith(key, kEpisodePrefix)) {
        command.name = "player";
        command.params["title"] = info_.title;
        command.params["id"] = id_;
        if (StartsWith(key, kEpisodePrefix)) {
            const std::size_t index = std::stoul(key.substr(sizeof(kEpisodePrefix) - 1));
            const std::vector<const catalog::MediaItem*> episodes = Episodes();
            if (index >= episodes.size()) return std::nullopt;
            const catalog::MediaItem& episode = *episodes[index];
            // The play id is the series id with the season and the episode, as playIdFor builds it.
            const std::string base = info_.media.id.empty() ? id_ : info_.media.id;
            command.params["id"] = episode.id.find(':') != std::string::npos
                                       ? episode.id
                                       : base + ":" + std::to_string(episode.season.value_or(1)) + ":" +
                                             std::to_string(episode.episode.value_or(1));
        }
        return command;
    }
    if (key == kListKey) {
        // Saving is the app's job. The shell hands this command over and opens nothing.
        command.name = "watchlist";
        command.action = true;
        command.params["id"] = id_;
        return command;
    }
    if (key == kDownloadKey) {
        // Downloads opens over the details, with the title's own choices: a film, or a series' episodes.
        command.name = "downloads";
        command.modal = true;
        command.params["id"] = info_.media.id.empty() ? id_ : info_.media.id;
        command.params["title"] = info_.title;
        if (IsSeries()) command.params["series"] = "1";
        return command;
    }
    if (key == kBackKey) {
        command.name = "back";
        command.action = true;
        return command;
    }
    return std::nullopt;
}

std::optional<ScrollSurface> DetailsScreen::SurfaceAt(double x, double y, nav::Axis axis) const {
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

void DetailsScreen::SetScroll(const ScrollSurface& /*surface*/, double value, double /*nowMs*/) {
    scrollTween_.reset();
    scroll_ = std::clamp(value, 0.0, MaxScroll());
}

void DetailsScreen::AnimateScroll(const ScrollSurface& /*surface*/, double target, double nowMs) {
    ScrollTo(target, nowMs);
}

}  // namespace tvm::ui
