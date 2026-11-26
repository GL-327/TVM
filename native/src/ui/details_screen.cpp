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
    if (!info_.trailerUrl.empty()) keys.push_back("trailer");
    if (!info_.versions.empty()) keys.push_back("versions");
    // Downloads takes the catalogue's id, so it also waits for the record, as the list button does.
    if (HasListButton() && !info_.hideDownloads) keys.push_back(kDownloadKey);
    if (info_.state == TitleInfo::State::Ready && info_.showRatings && !info_.rating.empty()) keys.push_back("imdb");
    if (info_.state == TitleInfo::State::Ready) for (const auto& service : info_.services) keys.push_back("watch:" + service.first);
    if (keys.empty()) keys.push_back(kBackKey);
    return keys;
}

std::vector<std::string> DetailsScreen::CollectionKeys() const {
    std::vector<std::string> keys;
    if (info_.collectionName.empty()) return keys;
    for (std::size_t i = 0; i < info_.collection.size(); ++i) keys.push_back("collection:" + std::to_string(i));
    return keys;
}
std::size_t DetailsScreen::CollectionColumns() const {
    return static_cast<std::size_t>(std::max(1.0, std::floor((width_ - Rem(2 * kSafeXRem)) / Rem(10.5))));
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
    const auto last = BoxOf(ActionKeys().back());
    const double base = std::max(HeroHeight(), last ? last->Bottom() + scroll_ + Rem(7.4) : HeroHeight());
    if (!CollectionKeys().empty()) { const auto box = BoxOf(CollectionKeys().back()); return std::max(base, box->Bottom() + scroll_ + Rem(2.0)); }
    if (!IsSeries()) return base;
    const double episodes = static_cast<double>(Episodes().size());
    return base + Rem(1.0) + SeasonsHeight() + Rem(1.2) +
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
    const double posterY = compact ? Rem(5.6) - scroll_ : heroBottom - Rem(kDetailsPosterHeightRem);
    const double copyX = compact ? x : x + Rem(kDetailsPosterWidthRem) + Rem(kCopyGapRem);
    const double badgeOffset = info_.qualityBadges.empty() ? 0.0 : Rem(2.0);
    const double buttonsY = posterY + Rem(8.2) + (info_.englishTitle.empty() ? 0.0 : Rem(1.6)) + badgeOffset;

    if (key == "reviews-link" && ReviewsOpen()) {
        const auto badge = BoxOf("imdb");
        if (!badge) return std::nullopt;
        const double panelHeight = Rem(info_.reviews.contains("reviews") && !info_.reviews["reviews"].empty() ? 33.0 : 9.0);
        const double top = std::min(badge->Bottom() + Rem(0.6), height_ - panelHeight - Rem(1));
        return Box{std::clamp(badge->x, Rem(1), std::max(Rem(1), width_ - Rem(35))), top + panelHeight - Rem(3.3), Rem(32), Rem(2.5)};
    }

    FlowLayout actions(copyX, buttonsY, width_ - copyX - x, Rem(kButtonGapRem));
    for (const std::string& action : ActionKeys()) {
        const double width = action == kListKey ? Rem(14.5) : action == kPlayKey ? Rem(8.4) : action == kDownloadKey ? Rem(10.0) : action.rfind("watch:", 0) == 0 ? Rem(19.0) : Rem(10.0);
        const Box box = actions.Place(width, compact ? std::max(44.0, Rem(kButtonHeightRem)) : Rem(kButtonHeightRem));
        if (action == key) return box;
    }

    const double tabsY = std::max(HeroHeight() - scroll_ + Rem(1.0), actions.Bottom() + Rem(7.4) + (info_.upcoming.empty() ? 0.0 : Rem(2.0)));
    if (StartsWith(key, "collection:")) {
        const auto index = std::stoul(key.substr(11));
        if (index >= CollectionKeys().size()) return std::nullopt;
        const auto columns = CollectionColumns();
        return Box{x + static_cast<double>(index % columns) * Rem(10.5), tabsY + Rem(2.8) + static_cast<double>(index / columns) * Rem(18.0), Rem(9.5), Rem(17.0)};
    }
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
    if ((focused_ == "imdb" || focused_ == "reviews-link") && !focusHidden_) {
        if (ratingEntered_ < 0) ratingEntered_ = nowMs;
    } else ratingEntered_ = -1;
    buttonFocus_.Track(focused_, focusHidden_, nowMs, motion_);
    if (scrollTween_.has_value()) {
        scroll_ = scrollTween_->Value(nowMs);
        if (scrollTween_->Done(nowMs)) scrollTween_.reset();
    }
    return Animating();
}

bool DetailsScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_) || scrollTween_.has_value() || seasonList_.Animating(clockMs_) ||
           (ratingEntered_ >= 0 && clockMs_ - ratingEntered_ < 370);
}

void DetailsScreen::Paint(Painter& painter) const {
    PaintPage(painter);
    PaintBack(painter);
    if (ReviewsOpen()) PaintReviews(painter);
    seasonList_.Paint(painter, clockMs_);
}

void DetailsScreen::PaintBack(Painter& painter) const {
    // A minimal arrow: no pill and no word, a thick rounded stroke on a soft shadow so it reads over any backdrop.
    // The pointer or the remote brightens it and grows it a touch; there is no outline around it.
    const Box box = *BoxOf(kBackKey);
    painter.Glass(box, box.height / 2.0, glass::NavCapsule());
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
    const double posterY = compact ? Rem(5.6) - scroll_ : HeroHeight() - scroll_ - Rem(kHeroPadBottomRem) - Rem(kDetailsPosterHeightRem);
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
    if (!info_.englishTitle.empty()) painter.Text({copyX, posterY + Rem(5.7), copyWidth, Rem(1.5)}, info_.englishTitle, {Rem(1.0), false}, tokens::kTextMuted);
    const double metaY = posterY + Rem(5.8) + (info_.englishTitle.empty() ? 0.0 : Rem(1.6));
    painter.Text(Box{copyX, metaY, copyWidth, Rem(1.5)}, MetaLine(), TextStyle{Rem(1.125), false, 450},
                 tokens::kTextMuted);
    if (!info_.qualityBadges.empty()) {
        double chipX = copyX;
        const double chipY = metaY + Rem(1.85);
        const TextStyle chipStyle{Rem(0.76), true, 700};
        for (const auto& badge : info_.qualityBadges) {
            const double chipW = painter.MeasureText(badge, chipStyle) + Rem(1.05);
            if (chipX + chipW > copyX + copyWidth) break;
            const Box chip{chipX, chipY, chipW, Rem(1.42)};
            GlassStyle chipGlass;
            chipGlass.kind = GlassKind::Tab;
            chipGlass.reduceTransparency = tokens::reduceTransparency;
            chipGlass.tint = WithAlpha(tokens::kSurfaceHover, 0.85);
            painter.Glass(chip, Rem(0.42), chipGlass);
            painter.StrokeRoundRect(chip, Rem(0.42), 1.0, tokens::kBorderSoft);
            painter.Text(Box{chip.x + Rem(0.52), chip.y, chip.width - Rem(0.52), chip.height}, badge, chipStyle, tokens::kText);
            chipX += chipW + Rem(0.45);
        }
    }
    for (const std::string& key : ActionKeys()) {
        if (key == "imdb") {
            const Box badge = *BoxOf(key);
            painter.Glass(badge, badge.height / 2, glass::NavCapsule());
            const Box logo{badge.x + Rem(0.65), badge.CenterY() - Rem(0.8), Rem(3.1), Rem(1.6)};
            painter.FillRoundRect(logo, Rem(0.25), Rgb(0xF5C518));
            painter.Text({logo.x + Rem(0.25), logo.y, logo.width, logo.height}, "IMDb", {Rem(1.0), true, 800}, Rgb(0));
            painter.Text({logo.Right() + Rem(0.6), badge.y, Rem(2.1), badge.height}, info_.rating, {Rem(1.15), true, 650}, tokens::kText);
            painter.Text({logo.Right() + Rem(2.8), badge.y, Rem(2), badge.height}, "/10", {Rem(0.8), false}, tokens::kTextMuted);
            if (ShowsFocus(focused_, key)) painter.StrokeRoundRect(badge, badge.height / 2, 1.5, Rgb(0xFFFFFF, 0.7));
            continue;
        }
        if (key.rfind("watch:", 0) == 0) {
            std::string label;
            for (const auto& service : info_.services) if ("watch:" + service.first == key) label = "Look for it on " + service.second;
            DrawButton(painter, metrics, *BoxOf(key), label, {false, ShowsFocus(focused_, key), buttonFocus_.Amount(key, clockMs_)});
            continue;
        }
        const std::string label = key == kPlayKey   ? "Play"
                                  : key == kListKey ? (info_.saved ? "Remove from My List" : "Add to My List")
                                                    : key == "trailer" ? "Trailer" : key == "versions" ? "Versions" : "Download";
        DrawButton(painter, metrics, *BoxOf(key), label,
                   ButtonLook{key == kPlayKey, ShowsFocus(focused_, key), buttonFocus_.Amount(key, clockMs_)});
    }
    const auto lastAction = BoxOf(ActionKeys().back());
    const Box synopsis{copyX, lastAction ? lastAction->Bottom() + Rem(1.0) : posterY + Rem(11.6), copyWidth, Rem(4.4)};
    std::string body = info_.synopsis;
    if (info_.state == TitleInfo::State::Loading) body = "Loading the details...";
    if (info_.state == TitleInfo::State::Unavailable) {
        body = "This title could not be loaded. Check the connection, or choose another title.";
    }
    if (info_.state == TitleInfo::State::Ready && body.empty()) body = "No synopsis is listed for this title.";
    painter.Paragraph(synopsis, body, TextStyle{Rem(1.0), false}, tokens::kTextMuted);

    if (!info_.upcoming.empty()) painter.Text({copyX, synopsis.Bottom() + Rem(0.4), copyWidth, Rem(1.6)}, info_.upcoming, {Rem(1.0), true, 600}, tokens::kAccentStrong);
    const auto collectionKeys = CollectionKeys();
    if (!collectionKeys.empty()) {
        const auto first = *BoxOf(collectionKeys.front());
        painter.Text({x, first.y - Rem(2.8), width_ - 2 * x, Rem(2.0)}, info_.collectionName, {Rem(1.3), true, 650}, tokens::kText);
        for (std::size_t i = 0; i < collectionKeys.size(); ++i) {
            const auto box = *BoxOf(collectionKeys[i]);
            if (box.Bottom() < 0 || box.y > height_) continue;
            const auto& item = info_.collection[i];
            painter.Glass(box, Rem(0.7), ShowsFocus(focused_, collectionKeys[i]) ? glass::NavSelected() : glass::NavCapsule());
            painter.Image({box.x + Rem(0.3), box.y + Rem(0.3), box.width - Rem(0.6), Rem(13.3)}, item.poster, Rem(0.5));
            painter.Paragraph({box.x + Rem(0.5), box.y + Rem(14.0), box.width - Rem(1.0), Rem(2.5)}, item.title, {Rem(0.9), true, 600}, tokens::kText);
        }
    }
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
        const auto episodeId = episode.id.find(':') != std::string::npos ? episode.id :
            info_.id + ":" + std::to_string(episode.season.value_or(1)) + ":" + std::to_string(episode.episode.value_or(1));
        const bool concealed = info_.spoilerBlur &&
            std::find(info_.watchedEpisodes.begin(), info_.watchedEpisodes.end(), episodeId) == info_.watchedEpisodes.end();
        if (concealed && !episode.poster.empty()) {
            painter.SetBackdrop(still, episode.poster, 0.5, 0.5);
            auto blurred = glass::SheetPanel();
            blurred.tint = Rgb(0x0B0C11, 0.66);
            blurred.frosted = true;
            painter.Glass(still, Rem(0.4), blurred);
            painter.SetBackdrop({}, "");
        } else if (episode.poster.empty() || !painter.Image(still, episode.poster, Rem(0.4))) {
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
        std::string line = concealed ? "Synopsis hidden until watched" : episode.synopsis;
        if (line.empty() && episode.aired.has_value()) line = "Aired " + episode.aired->substr(0, 10);
        painter.Text(Box{textX, row.y + Rem(2.3), textWidth, Rem(1.4)}, line, TextStyle{Rem(0.9), false},
                     tokens::kTextMuted);
        if (info_.showRatings && !episode.rating.empty()) {
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
    if (focused_ == "imdb" && ReviewsOpen() && direction == nav::Direction::Down) { focused_ = "reviews-link"; return true; }
    if (focused_ == "reviews-link") { focused_ = "imdb"; return true; }
    // An open season list takes the arrows.
    if (seasonList_.IsOpen()) return seasonList_.Navigate(direction, nowMs);
    const std::vector<std::string> actions = ActionKeys();
    const auto collection = CollectionKeys();
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
        if (direction == nav::Direction::Down && !collection.empty()) return move(collection.front());
        if (direction == nav::Direction::Down && picker) return move(kSeasonMenuKey);
        if (direction == nav::Direction::Down && episodes > 0) return move(std::string(kEpisodePrefix) + "0");
        return along(actions);
    }
    if (StartsWith(focused_, "collection:")) {
        const auto index = std::stoul(focused_.substr(11));
        const auto columns = CollectionColumns();
        if (direction == nav::Direction::Up) return move(index >= columns ? collection[index - columns] : actions.front());
        if (direction == nav::Direction::Down && index + columns < collection.size()) return move(collection[index + columns]);
        return along(collection);
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

std::optional<Command> DetailsScreen::PickList(std::size_t index, double nowMs) {
    if (!versionList_) {
        PickSeason(index, nowMs);
        return std::nullopt;
    }
    seasonList_.Close(nowMs);
    if (index >= info_.versions.size() || info_.versionTarget.empty()) return std::nullopt;
    return Command{false, "player", {{"id", info_.versionTarget}, {"title", info_.title},
        {"versionId", info_.versions[index].first}}, false};
}

std::optional<Command> DetailsScreen::Select(double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (seasonList_.IsOpen()) {
        return PickList(seasonList_.Highlighted(), nowMs);
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
    if (ReviewsOpen()) {
        const auto link = BoxOf("reviews-link");
        if (link && Contains(*link, x, y)) return "reviews-link";
        // Keep the review panel open while the pointer crosses its text.
        if (link && Contains({link->x, link->y - Rem(30), link->width, Rem(33)}, x, y)) return "imdb";
    }
    if (seasonList_.IsOpen()) {
        // While the season list is open it is the only thing to pick; a click anywhere else closes it.
        if (const std::optional<std::size_t> row = seasonList_.RowAt(x, y)) return kSeasonPickPrefix + std::to_string(*row);
        if (seasonList_.Contains(x, y)) return std::nullopt;
        return std::string("season-dismiss");
    }
    // The arrow sits over the page, so it is found first.
    std::vector<std::string> keys = {kBackKey};
    for (const std::string& key : ActionKeys()) keys.push_back(key);
    for (const auto& key : CollectionKeys()) keys.push_back(key);
    for (const std::string& key : SeasonKeys()) keys.push_back(key);
    for (std::size_t i = 0; i < Episodes().size(); ++i) keys.push_back(kEpisodePrefix + std::to_string(i));
    for (const std::string& key : keys) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && Contains(*box, x, y)) return key;
    }
    return std::nullopt;
}

void DetailsScreen::PaintReviews(Painter& painter) const {
    const auto link = BoxOf("reviews-link");
    if (!link) return;
    const bool hasReviews = info_.reviews.contains("reviews") && info_.reviews["reviews"].is_array() && !info_.reviews["reviews"].empty();
    const double panelHeight = Rem(hasReviews ? 33.0 : 9.0);
    const Box panel{link->x - Rem(0.7), link->Bottom() + Rem(0.8) - panelHeight, link->width + Rem(1.4), panelHeight};
    painter.Glass(panel, Rem(1.75), glass::MenuPanel());
    double y = panel.y + Rem(1.0);
    painter.Text({panel.x + Rem(1.2), y, panel.width - Rem(2.4), Rem(2)}, "IMDb " + info_.rating + "/10", {Rem(1.25), true, 700}, Rgb(0xFFFFFF, 0.95));
    y += Rem(2.8);
    if (hasReviews) {
        const auto& reviews = info_.reviews["reviews"];
        for (std::size_t i = 0; i < std::min<std::size_t>(3, reviews.size()); ++i) {
            const auto& review = reviews[i];
            std::string stars;
            if (review.contains("stars") && review["stars"].is_number()) {
                char value[24]{};
                std::snprintf(value, sizeof(value), "%.1f/5", review["stars"].get<double>());
                stars = std::string("  â˜… ") + value;
            }
            painter.Text({panel.x + Rem(1.2), y, panel.width - Rem(2.4), Rem(1.5)}, review.value("author", "Letterboxd viewer") + stars, {Rem(0.95), true, 650}, Rgb(0xFFFFFF, 0.95));
            painter.Paragraph({panel.x + Rem(1.2), y + Rem(1.8), panel.width - Rem(2.4), Rem(4.6)}, review.value("text", ""), {Rem(0.9), false}, Rgb(0xFFFFFF, 0.66));
            y += Rem(8.2);
        }
    } else painter.Text({panel.x + Rem(1.2), y, panel.width - Rem(2.4), Rem(1.8)}, "Read reviews on IMDb", {Rem(1), false}, Rgb(0xFFFFFF, 0.66));
    painter.Text(*link, hasReviews ? "More reviews on IMDb" : "Open IMDb", {Rem(0.95), true, 600}, Rgb(0x96BAFF));
    if (ShowsFocus(focused_, "reviews-link")) painter.StrokeRoundRect(*link, link->height / 2, 1, Rgb(0xFFFFFF, 0.7));
}

std::optional<Command> DetailsScreen::ActivateItem(const std::string& key, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (key == "season-dismiss") {
        seasonList_.Close(nowMs);
        return std::nullopt;
    }
    if (StartsWith(key, kSeasonPickPrefix)) {
        return PickList(std::stoul(key.substr(sizeof(kSeasonPickPrefix) - 1)), nowMs);
    }
    if (!BoxOf(key).has_value()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> DetailsScreen::Activate(const std::string& key) {
    if (key == "versions") {
        versionList_ = true;
        std::vector<DropdownOption> options;
        for (const auto& version : info_.versions) options.push_back({version.second, ""});
        seasonList_.Open(*BoxOf(key), std::move(options), 0, width_, height_, Rem(1), clockMs_, motion_);
        return std::nullopt;
    }
    if (key == "trailer") { Command command; command.name = "trailer-open"; command.action = true; command.params["id"] = id_; return command; }
    if (StartsWith(key, "collection:")) {
        const auto index = std::stoul(key.substr(11));
        if (index >= info_.collection.size()) return std::nullopt;
        Command command; command.name = "details"; command.params = {{"id", info_.collection[index].id}, {"title", info_.collection[index].title}}; return command;
    }
    if (key == "imdb" || key == "reviews-link") {
        Command command; command.name = "imdb-open"; command.action = true; command.params["id"] = id_; return command;
    }
    if (key.rfind("watch:", 0) == 0) {
        Command command; command.name = "service-watch"; command.action = true; command.params = {{"id", key.substr(6)}, {"title", info_.title}}; return command;
    }
    if (key == kSeasonMenuKey) {
        versionList_ = false;
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
