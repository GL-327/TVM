#include "ui/scene.h"

#include <algorithm>
#include <cmath>
#include <string_view>

#include "motion/tween.h"
#include "nav/wrap.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;
constexpr double kSectionSpacingRem = 2.0;
// Heading to rail, inside one section. It clears the focus ring, which grows
// about 11px above a focused poster.
constexpr double kHeadingGapRem = 1.0;
constexpr double kRailSpacingRem = 1.0;
constexpr double kRailInsetRem = 1.0;
constexpr double kHeadingSizeRem = 1.25;
// The home camera parks the focused row 72px below the top at 1080p.
constexpr double kRowCameraPadRem = 4.5;
// Reference height the metrics are measured against: rem = height / 67.5.
constexpr double kReferenceRemsHeight = 67.5;
// The row the status line takes above the page, when there is one.
constexpr double kStatusRowRem = 2.5;
// The top buttons in the header, until the navigation bar is ported.
constexpr double kTopButtonWidthRem = 10.0;
constexpr double kTopButtonHeightRem = 2.0;
constexpr double kTopButtonGapRem = 1.0;

// The hero, from `.stage` and `.home--launcher .stage--home` in apps/ui/src/app.css, and from the
// Home screen. Sizes are in rems, as the rest of the layout is.
constexpr double kPi = 3.14159265358979323846;
constexpr double kHeroHeightFraction = 0.48;  // min-height: 48vh on the launcher
constexpr double kHeroRailGapRem = 0.85;      // the padding above the rails, `.home__shelf`
constexpr double kHeroPadBottomRem = 1.25;    // `.home--launcher .stage--home` padding-bottom
constexpr double kHeroCopyWidthRem = 34.0;    // `.stage__copy` max-width
constexpr double kHeroKickerFontRem = 0.8125;  // `--tvm-font-size-caption`
constexpr double kHeroKickerHeightRem = 1.14;  // the caption size at its line height
constexpr double kHeroKickerMarginRem = 0.5;   // `--tvm-space-1`, under the kicker
constexpr double kHeroPillFontRem = 0.66;      // `.home__kicker-home`
constexpr double kHeroPillPadRem = 0.55;
constexpr double kHeroPillHeightRem = 1.28;
constexpr double kHeroPillGapRem = 0.7;  // the gap between the pill and the source line
constexpr double kHeroTitleFontRem = 4.4;  // clamp(2.4rem, 6vw, 4.4rem), which is 4.4rem at these sizes
constexpr double kHeroTitleLineRem = 0.95;
constexpr double kHeroWatchMarginTopRem = 0.85;     // `.stage__watchline` margin
constexpr double kHeroWatchMarginBottomRem = 0.9;   // `.stage__watchline` margin
constexpr double kHeroWatchHeightRem = 1.4;         // the watch line at its line height
constexpr double kHeroWatchFontRem = 0.95;          // `.stage__watchnow`
constexpr double kHeroWatchGlowRem = 0.08;          // a stand-in for the focus glow of the watch text
constexpr double kHeroLearnHeightRem = 2.85;        // `.tvm-button` min-height
constexpr double kHeroLearnMinWidthRem = 8.4;       // `.stage__learn` min-width
constexpr double kHeroButtonPadRem = 1.2;           // `.tvm-button` padding
constexpr double kHeroButtonFontRem = 1.0625;       // `--tvm-font-size-body`
constexpr double kHeroDotsMarginRem = 1.15;         // `.stage__dots` margin-top
constexpr double kHeroDotRem = 0.42;
constexpr double kHeroDotGapRem = 0.4;
// The dissolves of the picture and the title: `hero-art-dissolve` and `hero-copy-in`, 480 ms.
constexpr double kHeroDissolveMs = 480.0;
constexpr motion::CubicBezier kHeroEase{0.2, 0.65, 0.3, 1.0};
// The picture fades as the page scrolls, to nothing at this share of the hero's height: heroScrollFade.
constexpr double kHeroFadeSpan = 0.92;
constexpr char kHeroPlayKey[] = "hero-play";
constexpr char kHeroInfoKey[] = "hero-info";
constexpr std::string_view kWatchLabel = "Watch";
constexpr std::string_view kLearnLabel = "Browse TVM Stream";
constexpr std::string_view kHomeLabel = "HOME";
constexpr std::string_view kSourceLabel = "Featured on TVM Stream";

// The stream chrome, `.stream-chrome` in apps/ui/src/player/features/player-chrome.css, and the
// billboard of apps/ui/src/screens/Library.tsx.
constexpr double kChromePadTopRem = 0.7;
constexpr double kChromePadBottomRem = 0.85;
constexpr double kChromeLinkHeightRem = 2.25;
constexpr double kChromeLinkPadRem = 0.78;
constexpr double kChromeGapRem = 0.4;
constexpr double kChromeFontRem = 1.0625;
constexpr int kChromeWeight = 560;
// `.tvm-lockup--wordmark`: the mark, then TVM spaced out in capitals.
constexpr double kWordmarkMarkRem = 1.35;
constexpr double kWordmarkFontRem = 1.15;
constexpr double kLockupGapRem = 0.45;
// `.tvm-lockup--stream`: the smaller mark, then "tvm stream" in the mark colour.
constexpr double kLockupMarkRem = 1.15;
constexpr double kLockupFontRem = 0.78;
constexpr double kWatchLineGapRem = 0.7;
// Four lines of the lede at its line height, so the last line is not clipped.
constexpr double kNoticeBodyRem = 6.0;
constexpr double kNoticeTitleRem = 2.75;
constexpr double kNoticeButtonGapRem = 0.75;
constexpr Color kChromeFocus = Rgb(0x6EC8FF, 0.24);  // the dark theme's --tvm-accent at 24%
constexpr Color kPlayerInk = Rgb(0xF6F7F8);          // --player-ink
constexpr Color kPlayerInkMuted = Rgb(0xF6F7F8, 0.76);
constexpr Color kMarkColor = Rgb(0x4AA0E0);          // --tvm-mark
constexpr Color kMarkPlate = Rgb(0x2F6BFF);
constexpr char kMarkImage[] = "asset:tvm-icon.png";
constexpr std::string_view kStreamWatchLabel = "WATCH NOW";
constexpr std::string_view kStreamLearnLabel = "Learn More";
constexpr std::string_view kStreamLockupWord = "tvm stream";
constexpr double kSearchFieldRem = 3.2;
// The page style's row of buttons, from `.collection-controls`, under the heading.
constexpr double kPageRowTopRem = 4.7;
constexpr double kButtonRowRem = 2.85;
constexpr double kButtonGapRowRem = 0.75;
// IconSearch: a lens and its handle, in a 32 unit square.
constexpr char kSearchGlyph[] = "M14 5a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM21 21l6 6";

bool IsHeroKey(const std::string& key) {
    return key == kHeroPlayKey || key == kHeroInfoKey;
}

Color WithAlpha(Color color, double alpha) {
    color.a *= alpha;
    return color;
}

// The colour `hsl(hue s% l%)` of the web stage's fallback.
Color HslColor(double hue, double saturation, double lightness) {
    const double h = std::fmod(std::fmod(hue, 360.0) + 360.0, 360.0) / 60.0;
    const double chroma = (1.0 - std::abs(2.0 * lightness - 1.0)) * saturation;
    const double x = chroma * (1.0 - std::abs(std::fmod(h, 2.0) - 1.0));
    const double match = lightness - chroma / 2.0;
    double r = 0.0;
    double g = 0.0;
    double b = 0.0;
    if (h < 1.0) {
        r = chroma;
        g = x;
    } else if (h < 2.0) {
        r = x;
        g = chroma;
    } else if (h < 3.0) {
        g = chroma;
        b = x;
    } else if (h < 4.0) {
        g = x;
        b = chroma;
    } else if (h < 5.0) {
        r = x;
        b = chroma;
    } else {
        r = chroma;
        b = x;
    }
    return Color{r + match, g + match, b + match, 1.0};
}

// The two ends of a CSS linear gradient at `degrees` across `box`: 90 runs left to right, 180 top to bottom.
struct LineEnds {
    double x0;
    double y0;
    double x1;
    double y1;
};

LineEnds CssLine(const Box& box, double degrees) {
    const double radians = degrees * kPi / 180.0;
    const double dx = std::sin(radians);
    const double dy = -std::cos(radians);
    const double length = std::abs(box.width * dx) + std::abs(box.height * dy);
    const double cx = box.CenterX();
    const double cy = box.CenterY();
    return LineEnds{cx - dx * length / 2.0, cy - dy * length / 2.0, cx + dx * length / 2.0, cy + dy * length / 2.0};
}

// The width of a line of text, in rems. The painter does not measure text, so the width is estimated from
// the character count: an average glyph is 0.6 of the font size, plus the letter spacing.
double EstimateRem(std::string_view text, double fontRem, double letterSpacingEm = 0.0) {
    return static_cast<double>(text.size()) * (0.6 + letterSpacingEm) * fontRem;
}

std::string ToUpperAscii(std::string text) {
    for (char& c : text) {
        if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    }
    return text;
}

// The width of a stream chrome link, in rems.
double ChromeLinkWidthRem(const TopButton& button) {
    if (button.lockup) {
        return 2.0 * kChromeLinkPadRem + kWordmarkMarkRem + kLockupGapRem +
               EstimateRem(button.label, kWordmarkFontRem, 0.22);
    }
    return 2.0 * kChromeLinkPadRem + EstimateRem(button.label, kChromeFontRem);
}

// The width of a page-style button, in rems: its label and the button's padding.
double PageButtonWidthRem(const TopButton& button) {
    return EstimateRem(button.label, kButtonLabelRem) + 2.0 * kButtonPadRem + 0.6;
}

// The TVM mark on its blue plate, as TvmMark draws it.
void PaintMark(Painter& painter, const Box& box) {
    painter.FillRoundRect(box, box.width * 0.22, kMarkPlate);
    painter.ImageFaded(box, kMarkImage, box.width * 0.22, 1.0, 0.5, 0.5);
}

std::string CardKey(std::size_t rail, std::size_t index) {
    return "card:" + std::to_string(rail) + ":" + std::to_string(index);
}

std::string RailKey(std::size_t rail) {
    return "rail:" + std::to_string(rail);
}

constexpr const char* kPageKey = "page";
// The first top button keeps the key Home has always used. The others are numbered.
constexpr const char* kFirstTopKey = "settings";
constexpr const char* kTopKeyPrefix = "top:";

std::string TopKey(std::size_t index) {
    return index == 0 ? std::string(kFirstTopKey) : kTopKeyPrefix + std::to_string(index);
}

// Home's top buttons: Settings at the right, and Live TV beside it.
std::vector<TopButton> HomeTopButtons() {
    Command settings;
    settings.name = "settings";
    Command live;
    live.name = "live-tv";
    return {TopButton{"Settings", settings}, TopButton{"Live TV", live}};
}

bool Contains(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

// Rails for the placeholder layout. Titles are generic, and there are no posters.
std::vector<RailData> PlaceholderRails(const std::vector<RailSpec>& specs) {
    std::vector<RailData> rails;
    for (std::size_t r = 0; r < specs.size(); ++r) {
        RailData rail;
        rail.id = RailKey(r);
        rail.title = specs[r].title;
        for (std::size_t i = 0; i < specs[r].count; ++i) {
            CardData card;
            card.itemId = CardKey(r, i);
            card.title = "Title " + std::to_string(r + 1) + "." + std::to_string(i + 1);
            rail.cards.push_back(card);
        }
        rails.push_back(rail);
    }
    return rails;
}

}  // namespace

Scene::Scene(const std::vector<RailSpec>& rails, motion::MotionSettings motion) : tops_(HomeTopButtons()) {
    motion_ = motion;
    Build(PlaceholderRails(rails));
}

void Scene::SetView(const SceneView& view, double nowMs) {
    // What the viewer had focused, read before the buttons and rails change.
    const std::optional<std::string> focused = focus_.Focused();
    const std::optional<std::string> itemId = FocusedItemId();
    const std::optional<std::size_t> top = focused.has_value() ? TopIndexOf(*focused) : std::nullopt;

    status_ = view.status;
    tops_ = view.topButtons;
    cardAction_ = view.cardAction;
    style_ = view.style;
    query_ = view.query;
    kicker_ = view.kicker;
    heading_ = view.heading;
    brandWord_ = view.brandWord;
    brandColor_ = view.brandColor;
    SetRails(view.rails);

    if (itemId.has_value() && FocusTitle(*itemId, nowMs)) return;
    if (top.has_value() && *top < tops_.size()) FocusKey(TopKey(*top), nowMs, false);
    // A hero button keeps the focus too, so a rebuild never drops the viewer onto the first card.
    if (focused.has_value() && IsHeroKey(*focused) && HeroActive()) FocusKey(*focused, nowMs, false);
}

std::optional<std::size_t> Scene::TopIndexOf(const std::string& key) const {
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        if (key == TopKey(i)) return i;
    }
    return std::nullopt;
}

void Scene::Build(const std::vector<RailData>& rails) {
    // Anything that refers to the old cards goes too: fades in flight, the
    // focus tree, and the cameras.
    timeline_ = motion::Timeline{};
    focus_ = nav::FocusTree{};
    railCamera_.clear();
    pageCamera_ = motion::CameraTween{};
    pageScroll_ = 0.0;
    cards_.clear();
    cardByKey_.clear();
    railOffset_.clear();
    rails_.clear();

    page_ = std::make_unique<Stack>(kSectionSpacingRem);
    for (std::size_t r = 0; r < rails.size(); ++r) {
        const RailData& spec = rails[r];
        auto section = std::make_unique<Stack>(kHeadingGapRem);
        section->Add(std::make_unique<Heading>(spec.title, kHeadingSizeRem));

        auto rail = std::make_unique<Rail>(kRailSpacingRem, kRailInsetRem);
        railOffset_.push_back(cards_.size());
        for (std::size_t i = 0; i < spec.cards.size(); ++i) {
            const CardData& data = spec.cards[i];
            const std::string key = CardKey(r, i);
            auto card = std::make_unique<Card>(data.title, key, data.itemId, data.posterUrl, data.progress);
            cards_.push_back(CardRef{card.get(), r, i, key});
            cardByKey_[key] = cards_.size() - 1;
            rail->Add(std::move(card));
        }
        rails_.push_back(rail.get());
        section->Add(std::move(rail));
        page_->Add(std::move(section));
    }
    railCamera_.resize(rails_.size());
}

void Scene::SetRails(const std::vector<RailData>& rails) {
    Build(rails);
    if (viewportWidth_ > 0.0) Layout(viewportWidth_, viewportHeight_);
}

void Scene::SetStatus(std::string status) {
    status_ = std::move(status);
}

void Scene::SetHeroes(std::vector<HeroData> heroes, double nowMs) {
    heroes_ = std::move(heroes);
    if (heroes_.empty()) {
        heroIndex_ = 0;
        heroTitleId_.clear();
        artCurrent_.clear();
        artPrevious_.clear();
        artPending_.clear();
        artFade_.reset();
        titleFade_.reset();
    } else {
        // The title that was on screen stays, when it is still in the list.
        ShowHero(heroIndex_ % heroes_.size(), nowMs);
    }
    if (viewportWidth_ > 0.0) Layout(viewportWidth_, viewportHeight_);
}

void Scene::ShowHero(std::size_t index, double nowMs) {
    if (heroes_.empty()) return;
    heroIndex_ = index % heroes_.size();
    const HeroData& hero = heroes_[heroIndex_];
    const bool reduced = motion::PrefersReducedMotion(motion_);

    // The title dissolves in as soon as the title changes. The picture waits for its file.
    if (hero.itemId != heroTitleId_) {
        heroTitleId_ = hero.itemId;
        titleFade_ = motion::Tween(0.0, 1.0, nowMs, reduced ? 0.0 : kHeroDissolveMs, kHeroEase);
    }
    if (hero.backdropUrl.empty()) {
        // A title with no picture shows the fallback, as the web stage does.
        artPending_.clear();
        artCurrent_.clear();
        artPrevious_.clear();
        artFade_.reset();
    } else {
        artPending_ = hero.backdropUrl;
    }
    StartHeroArt(nowMs);
}

void Scene::StartHeroArt(double nowMs) {
    if (artPending_.empty()) return;
    if (artPending_ == artCurrent_) {
        artPending_.clear();
        return;
    }
    // Without a way to ask, a picture counts as ready. Otherwise the app says when its file is there.
    if (imageReady_ && !imageReady_(artPending_)) return;

    const bool first = artCurrent_.empty();
    const bool reduced = motion::PrefersReducedMotion(motion_);
    artPrevious_ = first ? std::string{} : artCurrent_;
    artCurrent_ = artPending_;
    artPending_.clear();
    // The first picture is there at once. Each later one dissolves over the picture before it.
    artFade_ = motion::Tween(first ? 1.0 : 0.0, 1.0, nowMs, first || reduced ? 0.0 : kHeroDissolveMs, kHeroEase);
}

Box Scene::HeroBox() const {
    return Box{0.0, -pageScroll_, viewportWidth_, heroHeight_};
}

double Scene::HeroFade() const {
    if (heroHeight_ <= 0.0) return 1.0;
    const double span = heroHeight_ * kHeroFadeSpan;
    return std::clamp(1.0 - pageScroll_ / span, 0.0, 1.0);
}

Scene::HeroBoxes Scene::HeroLayout() const {
    const Box hero = HeroBox();
    const double x = metrics_.Rem(kSafeXRem);
    const double copyWidth = metrics_.Rem(kHeroCopyWidthRem);
    HeroBoxes boxes;

    // The copy sits at the foot of the hero and stacks upwards, as `.stage` lays it out with flex-end.
    // The dots are there only when there is more than one title.
    const bool hasDots = heroes_.size() > 1;
    const double dot = metrics_.Rem(kHeroDotRem);
    const std::size_t dotCount = hasDots ? heroes_.size() : 0;
    const double dotsWidth = static_cast<double>(dotCount) * dot +
                             (dotCount > 0 ? static_cast<double>(dotCount - 1) * metrics_.Rem(kHeroDotGapRem) : 0.0);
    double bottom = hero.Bottom() - metrics_.Rem(kHeroPadBottomRem);
    boxes.dots = Box{x, bottom - dot, dotsWidth, dot};
    if (hasDots) bottom -= dot + metrics_.Rem(kHeroDotsMarginRem);

    const double learnHeight = metrics_.Rem(kHeroLearnHeightRem);
    const double learnWidthRem = std::max(
        kHeroLearnMinWidthRem, EstimateRem(InfoLabel(), kHeroButtonFontRem) + 2.0 * kHeroButtonPadRem);

    if (!heroes_[heroIndex_].body.empty()) {
        // A notice: its two buttons side by side, `.hero__actions`, under a paragraph and a smaller heading.
        const double playWidthRem = std::max(
            kHeroLearnMinWidthRem, EstimateRem(PlayLabel(), kHeroButtonFontRem) + 2.0 * kHeroButtonPadRem);
        boxes.watch = Box{x, bottom - learnHeight, metrics_.Rem(playWidthRem), learnHeight};
        boxes.learn = Box{boxes.watch.Right() + metrics_.Rem(kNoticeButtonGapRem), boxes.watch.y,
                          metrics_.Rem(learnWidthRem), learnHeight};
        bottom = boxes.watch.y - metrics_.Rem(kHeroWatchMarginTopRem);
        boxes.body = Box{x, bottom - metrics_.Rem(kNoticeBodyRem), copyWidth * 1.3, metrics_.Rem(kNoticeBodyRem)};
        bottom = boxes.body.y - metrics_.Rem(kHeroKickerMarginRem);
        const double noticeTitle = metrics_.Rem(kNoticeTitleRem * 1.2);
        boxes.title = Box{x, bottom - noticeTitle, copyWidth * 1.3, noticeTitle};
        bottom = boxes.title.y - metrics_.Rem(kHeroKickerMarginRem);
        boxes.kicker = Box{x, bottom - metrics_.Rem(kHeroKickerHeightRem), copyWidth, metrics_.Rem(kHeroKickerHeightRem)};
        return boxes;
    }

    boxes.learn = Box{x, bottom - learnHeight, metrics_.Rem(learnWidthRem), learnHeight};
    bottom = boxes.learn.y - metrics_.Rem(kHeroWatchMarginBottomRem);

    const double watchHeight = metrics_.Rem(kHeroWatchHeightRem);
    boxes.watch = Box{x, bottom - watchHeight, metrics_.Rem(EstimateRem(PlayLabel(), kHeroWatchFontRem, 0.08)),
                      watchHeight};
    bottom = boxes.watch.y - metrics_.Rem(kHeroWatchMarginTopRem);

    const double titleHeight = metrics_.Rem(kHeroTitleFontRem * kHeroTitleLineRem);
    boxes.title = Box{x, bottom - titleHeight, copyWidth, titleHeight};
    bottom = boxes.title.y - metrics_.Rem(kHeroKickerMarginRem);

    const double kickerHeight = metrics_.Rem(kHeroKickerHeightRem);
    const double kickerY = bottom - kickerHeight;
    const double pillHeight = metrics_.Rem(kHeroPillHeightRem);
    const double pillWidth = metrics_.Rem(EstimateRem(kHomeLabel, kHeroPillFontRem, 0.2) + 2.0 * kHeroPillPadRem);
    boxes.kicker = Box{x, kickerY, copyWidth, kickerHeight};
    boxes.pill = Box{x, kickerY + (kickerHeight - pillHeight) / 2.0, pillWidth, pillHeight};
    const double sourceX = x + pillWidth + metrics_.Rem(kHeroPillGapRem);
    boxes.source = Box{sourceX, kickerY, copyWidth - (sourceX - x), kickerHeight};
    return boxes;
}

void Scene::PaintHero(Painter& painter) const {
    const Box hero = HeroBox();
    const double fade = HeroFade();
    const HeroData& data = heroes_[heroIndex_];
    const double dissolve = artFade_.has_value() ? std::clamp(artFade_->Value(clockMs_), 0.0, 1.0) : 1.0;

    // The fallback, under any picture: a gradient from the elevated background to the deep one, with the
    // title's hue lit from the upper right, as `.stage__art--fallback` paints it.
    const LineEnds slant = CssLine(hero, 160.0);
    painter.FillLinearGradient(hero, slant.x0, slant.y0, slant.x1, slant.y1,
                               {GradientStop{0.0, WithAlpha(tokens::kBackgroundElevated, fade)},
                                GradientStop{0.7, WithAlpha(tokens::kBackgroundDeep, fade)},
                                GradientStop{1.0, WithAlpha(tokens::kBackgroundDeep, fade)}});
    const Color hue = HslColor(static_cast<double>(data.hue), 0.55, 0.38);
    painter.FillRadialGradient(hero, hero.x + 0.7 * hero.width, hero.y + 0.2 * hero.height, 0.7 * hero.width,
                               0.8 * hero.height,
                               {GradientStop{0.0, WithAlpha(hue, fade)}, GradientStop{0.62, WithAlpha(hue, 0.0)},
                                GradientStop{1.0, WithAlpha(hue, 0.0)}});

    // The picture is cropped with its focal point at 70% across and 20% down, as `object-position` gives it.
    // The previous picture stays under the new one until the dissolve ends.
    if (!artPrevious_.empty() && artFade_.has_value() && !artFade_->Done(clockMs_)) {
        painter.ImageFaded(hero, artPrevious_, 0.0, fade, 0.7, 0.2);
    }
    if (!artCurrent_.empty()) painter.ImageFaded(hero, artCurrent_, 0.0, fade * dissolve, 0.7, 0.2);

    // The vignette: a fade up from the bottom, then a fade in from the left, both in the background colour.
    const Color background = tokens::kBackground;
    const LineEnds up = CssLine(hero, 180.0);
    painter.FillLinearGradient(hero, up.x0, up.y0, up.x1, up.y1,
                               {GradientStop{0.0, WithAlpha(background, 0.0)},
                                GradientStop{0.28, WithAlpha(background, 0.0)},
                                GradientStop{0.52, WithAlpha(background, fade * 0.28)},
                                GradientStop{0.78, WithAlpha(background, fade * 0.72)},
                                GradientStop{0.92, WithAlpha(background, fade)},
                                GradientStop{1.0, WithAlpha(background, fade)}});
    const LineEnds across = CssLine(hero, 90.0);
    painter.FillLinearGradient(hero, across.x0, across.y0, across.x1, across.y1,
                               {GradientStop{0.0, WithAlpha(background, fade * 0.86)},
                                GradientStop{0.28, WithAlpha(background, fade * 0.32)},
                                GradientStop{0.56, WithAlpha(background, 0.0)},
                                GradientStop{1.0, WithAlpha(background, 0.0)}});
    // The hero's bottom edge can fall inside a pixel row. The picture would show through that row, so the
    // background is laid over the edge, which the rails below are painted in anyway.
    painter.FillRoundRect(Box{hero.x, hero.Bottom() - 1.0, hero.width, 2.0}, 0.0, background);

    // The copy is not faded with the page, as on the web.
    const HeroBoxes boxes = HeroLayout();
    const TextStyle kickerStyle{metrics_.Rem(kHeroKickerFontRem), true};
    const bool notice = !data.body.empty();
    const bool watchFocused = focus_.Focused() == std::optional<std::string>(kHeroPlayKey);
    const bool learnFocused = focus_.Focused() == std::optional<std::string>(kHeroInfoKey);
    const Color white = Rgb(0xFFFFFF);
    const double titleAlpha = titleFade_.has_value() ? std::clamp(titleFade_->Value(clockMs_), 0.0, 1.0) : 1.0;

    if (notice) {
        // `.stream-connect`: the kicker, the heading, the lede, then the primary button and the glass one.
        painter.Text(boxes.kicker, "TVM STREAM", kickerStyle, tokens::kTextMuted);
        painter.Text(boxes.title, data.title, TextStyle{metrics_.Rem(kNoticeTitleRem), true, 750},
                     WithAlpha(tokens::kText, titleAlpha));
        painter.Paragraph(boxes.body, data.body, TextStyle{metrics_.Rem(1.0625), false}, tokens::kTextMuted);
        DrawButton(painter, metrics_, boxes.watch, PlayLabel(), ButtonLook{true, watchFocused, watchFocused ? 1.0 : 0.0});
    }
    if (Streamy() && !notice && !kicker_.empty()) {
        // A service hub's line over its billboard: that it is not the licensed app.
        painter.Text(Box{boxes.kicker.x, boxes.kicker.y, viewportWidth_ - 2.0 * boxes.kicker.x, boxes.kicker.height},
                     kicker_, TextStyle{metrics_.Rem(0.85), false, 500}, tokens::kTextMuted);
    }
    if (!Streamy()) {
        painter.FillRoundRect(boxes.pill, boxes.pill.height / 2.0, tokens::kAccentStrong);
        painter.Text(Box{boxes.pill.x + metrics_.Rem(kHeroPillPadRem), boxes.pill.y, boxes.pill.width, boxes.pill.height},
                     kHomeLabel, TextStyle{metrics_.Rem(kHeroPillFontRem), true}, tokens::kAccentInk);
        painter.Text(boxes.source, ToUpperAscii(std::string(kSourceLabel)), kickerStyle, tokens::kTextMuted);
    }

    // The title dissolves in when it changes, on the same curve as the picture.
    if (!notice) {
        painter.Text(boxes.title, ToUpperAscii(data.title), TextStyle{metrics_.Rem(kHeroTitleFontRem), true},
                     WithAlpha(tokens::kText, titleAlpha));
    }

    // The watch text. Its focus is a glow on the text, with no outline, as the web button has.
    const std::string watchLabel = PlayLabel();
    const TextStyle watchStyle{metrics_.Rem(kHeroWatchFontRem), true, Streamy() ? 800 : 0};
    if (notice) {
        // The notice's first button is drawn above, as a pill.
    } else if (watchFocused) {
        const double glow = metrics_.Rem(kHeroWatchGlowRem);
        for (const auto [dx, dy] : {std::pair{-1.0, 0.0}, std::pair{1.0, 0.0}, std::pair{0.0, -1.0},
                                    std::pair{0.0, 1.0}, std::pair{-0.7, -0.7}, std::pair{0.7, 0.7},
                                    std::pair{-0.7, 0.7}, std::pair{0.7, -0.7}}) {
            const Box shifted{boxes.watch.x + dx * glow, boxes.watch.y + dy * glow, boxes.watch.width, boxes.watch.height};
            painter.Text(shifted, watchLabel, watchStyle, WithAlpha(white, 0.10));
        }
    }
    if (!notice) {
        painter.Text(Box{boxes.watch.x, boxes.watch.y, boxes.watch.width + metrics_.Rem(1.0), boxes.watch.height},
                     watchLabel, watchStyle, white);
    }
    if (!notice && Streamy()) {
        // `.stage__watchline`: WATCH NOW, a faint rule, then the "tvm stream" lockup.
        const double gap = metrics_.Rem(kWatchLineGapRem);
        const double ruleX = boxes.watch.Right() + gap;
        painter.Text(Box{ruleX, boxes.watch.y, metrics_.Rem(1.0), boxes.watch.height}, "|",
                     TextStyle{metrics_.Rem(kHeroWatchFontRem), true, 700}, WithAlpha(white, 0.7));
        if (!brandWord_.empty()) {
            // A service hub signs its billboard with its own wordmark, in its own colour.
            const double wordX = ruleX + metrics_.Rem(0.3) + gap;
            const Color brand = brandColor_.value_or(kMarkColor);
            // A near-black brand reads as white on the dark stage.
            const Color shown = brand.r + brand.g + brand.b < 0.25 ? Rgb(0xFFFFFF) : brand;
            painter.Text(Box{wordX, boxes.watch.y - metrics_.Rem(0.15), metrics_.Rem(14.0), boxes.watch.height + metrics_.Rem(0.3)},
                         brandWord_, TextStyle{metrics_.Rem(1.15), true, 850}, shown);
        } else {
            const double mark = metrics_.Rem(kLockupMarkRem);
            const double markX = ruleX + metrics_.Rem(0.3) + gap;
            PaintMark(painter, Box{markX, boxes.watch.CenterY() - mark / 2.0, mark, mark});
            const double wordX = markX + mark + metrics_.Rem(kLockupGapRem);
            painter.Text(Box{wordX, boxes.watch.y, metrics_.Rem(EstimateRem(kStreamLockupWord, kLockupFontRem, 0.16) + 2.0),
                             boxes.watch.height},
                         kStreamLockupWord, TextStyle{metrics_.Rem(kLockupFontRem), true, 800}, kMarkColor);
        }
    }

    // The browse button is the glass pill: its fill turns lighter on focus, with no ring and no scale.
    const std::string learnLabel = InfoLabel();
    const double learnRadius = boxes.learn.height / 2.0;
    painter.FillRoundRect(boxes.learn, learnRadius, learnFocused ? tokens::kGlassFocus : tokens::kGlassFill);
    painter.StrokeRoundRect(boxes.learn, learnRadius, 1.0, tokens::kGlassBorder);
    const double learnTextWidth = metrics_.Rem(EstimateRem(learnLabel, kHeroButtonFontRem));
    const double learnTextX = boxes.learn.CenterX() - learnTextWidth / 2.0;
    painter.Text(Box{learnTextX, boxes.learn.y, learnTextWidth + metrics_.Rem(1.0), boxes.learn.height}, learnLabel,
                 TextStyle{metrics_.Rem(kHeroButtonFontRem), true}, tokens::kText);

    // One dot per title, the shown one white.
    if (heroes_.size() > 1) {
        const double dot = metrics_.Rem(kHeroDotRem);
        const double step = dot + metrics_.Rem(kHeroDotGapRem);
        for (std::size_t i = 0; i < heroes_.size(); ++i) {
            const Color dotColor = i == heroIndex_ ? white : Rgb(0xFFFFFF, 0.35);
            painter.FillRoundRect(Box{boxes.dots.x + static_cast<double>(i) * step, boxes.dots.y, dot, dot}, dot / 2.0,
                                  dotColor);
        }
    }
}

std::optional<std::string> Scene::FocusedItemId() const {
    const std::optional<std::string> focused = focus_.Focused();
    if (!focused.has_value() || !cardByKey_.contains(*focused)) return std::nullopt;
    return cards_[cardByKey_.at(*focused)].card->itemId();
}

bool Scene::FocusTitle(const std::string& itemId, double nowMs) {
    for (const CardRef& ref : cards_) {
        if (ref.card->itemId() != itemId) continue;
        FocusKey(ref.key, nowMs, true);
        return true;
    }
    return false;
}

double Scene::MaxPageScroll() const {
    return std::max(0.0, pageContentHeight_ + 2.0 * metrics_.Rem(kSafeYRem) - viewportHeight_);
}

std::string Scene::PlayLabel() const {
    if (HeroActive() && !heroes_[heroIndex_].playLabel.empty()) return heroes_[heroIndex_].playLabel;
    return std::string(Streamy() ? kStreamWatchLabel : kWatchLabel);
}

std::string Scene::InfoLabel() const {
    if (HeroActive() && !heroes_[heroIndex_].infoLabel.empty()) return heroes_[heroIndex_].infoLabel;
    return std::string(Streamy() ? kStreamLearnLabel : kLearnLabel);
}

double Scene::HeaderTop() const {
    if (Streamy()) return ChromeHeight();
    if (style_ == SceneStyle::Page) return metrics_.Rem(kSafeYRem + kPageRowTopRem + kButtonRowRem + 1.0);
    if (style_ == SceneStyle::Search) return metrics_.Rem(kSafeYRem + kSearchFieldRem + 0.6);
    return metrics_.Rem(kSafeYRem);
}

void Scene::PaintSearchField(Painter& painter) const {
    // `.search-pill__bar`: the magnifier, then the query, or the placeholder while it is empty.
    const double x = metrics_.Rem(kSafeXRem);
    const Box field{x, metrics_.Rem(kSafeYRem), std::min(viewportWidth_ - 2.0 * x, metrics_.Rem(48.0)),
                    metrics_.Rem(kSearchFieldRem)};
    painter.FillRoundRect(field, field.height / 2.0, tokens::kSurface);
    painter.StrokeRoundRect(field, field.height / 2.0, metrics_.Rem(kFocusRingWidthRem), tokens::kFocusRing);
    const double glyph = metrics_.Rem(1.4);
    painter.Path(Box{field.x + metrics_.Rem(1.0), field.CenterY() - glyph / 2.0, glyph, glyph}, 32.0, kSearchGlyph,
                 PathStyle{Color{0, 0, 0, 0}, tokens::kTextMuted, 2.4, false});
    const double textX = field.x + metrics_.Rem(3.0);
    const TextStyle style{metrics_.Rem(1.25), false, 500};
    if (query_.empty()) {
        painter.Text(Box{textX, field.y, field.Right() - textX, field.height}, "Title or https://\xE2\x80\xA6", style,
                     tokens::kTextFaint);
    } else {
        const double width = painter.MeasureText(query_, style);
        painter.Text(Box{textX, field.y, field.Right() - textX - metrics_.Rem(1.0), field.height}, query_, style,
                     tokens::kText);
        // The caret, after the last letter.
        const double caretX = std::min(textX + width + 2.0, field.Right() - metrics_.Rem(1.0));
        painter.FillRoundRect(Box{caretX, field.y + field.height * 0.25, 2.0, field.height * 0.5}, 0.0, tokens::kText);
    }
}

void Scene::PaintPageHeader(Painter& painter) const {
    // The page's header stays over the grid as it scrolls: the kicker, the heading, then the row of buttons.
    const double headerTop = HeaderTop();
    painter.FillRoundRect(Box{0.0, 0.0, viewportWidth_, headerTop}, 0.0, tokens::kBackground);
    if (!status_.empty()) {
        painter.Text(Box{metrics_.Rem(kSafeXRem), headerTop, viewportWidth_ * 0.6, metrics_.Rem(kTopButtonHeightRem)},
                     status_, TextStyle{metrics_.Rem(1.0), false}, tokens::kTextMuted);
    }
    const double x = metrics_.Rem(kSafeXRem);
    const double top = metrics_.Rem(kSafeYRem);
    painter.Text(Box{x, top, viewportWidth_ - 2.0 * x, metrics_.Rem(1.2)}, ToUpperAscii(kicker_),
                 TextStyle{metrics_.Rem(0.8125), true, 700}, tokens::kTextFaint);
    painter.Text(Box{x, top + metrics_.Rem(1.1), viewportWidth_ - 2.0 * x, metrics_.Rem(3.25)}, heading_,
                 TextStyle{metrics_.Rem(2.75), true, 750}, tokens::kText);
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const bool focused = focus_.Focused() == std::optional<std::string>(TopKey(i));
        // A chosen filter is the primary button, as the web marks it with variant=primary.
        DrawButton(painter, metrics_, TopBoxScreen(i), tops_[i].label,
                   ButtonLook{tops_[i].on, focused, focused ? 1.0 : 0.0});
    }
}

double Scene::ChromeHeight() const {
    return metrics_.Rem(kChromePadTopRem + kChromeLinkHeightRem + kChromePadBottomRem);
}

void Scene::PaintStreamChrome(Painter& painter) const {
    // The band fades from the background at 82% to nothing, so the page shows through under it.
    const double height = ChromeHeight();
    painter.FillLinearGradient(Box{0.0, 0.0, viewportWidth_, height}, 0.0, 0.0, 0.0, height,
                               {GradientStop{0.0, WithAlpha(tokens::kBackground, 0.82)},
                                GradientStop{0.72, WithAlpha(tokens::kBackground, 0.82)},
                                GradientStop{1.0, WithAlpha(tokens::kBackground, 0.0)}});
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const Box box = TopBoxScreen(i);
        const bool focused = focus_.Focused() == std::optional<std::string>(TopKey(i));
        // Focus is a soft accent pill, with no ring, as the default look's stream chrome has.
        if (focused) painter.FillRoundRect(box, box.height / 2.0, kChromeFocus);
        const double x = box.x + metrics_.Rem(kChromeLinkPadRem);
        if (tops_[i].lockup) {
            const double mark = metrics_.Rem(kWordmarkMarkRem);
            PaintMark(painter, Box{x, box.CenterY() - mark / 2.0, mark, mark});
            painter.Text(Box{x + mark + metrics_.Rem(kLockupGapRem), box.y, box.width, box.height},
                         ToUpperAscii(tops_[i].label), TextStyle{metrics_.Rem(kWordmarkFontRem), true, 800},
                         tokens::kText);
            continue;
        }
        painter.Text(Box{x, box.y, box.width, box.height}, tops_[i].label,
                     TextStyle{metrics_.Rem(kChromeFontRem), false, kChromeWeight},
                     focused || tops_[i].on ? kPlayerInk : kPlayerInkMuted);
    }
}

Box Scene::TopBoxScreen(std::size_t index) const {
    if (style_ == SceneStyle::Page) {
        // `.collection-controls`: a row of buttons under the heading, left to right, fixed while the page scrolls.
        double x = metrics_.Rem(kSafeXRem);
        for (std::size_t i = 0; i < index && i < tops_.size(); ++i) {
            x += metrics_.Rem(PageButtonWidthRem(tops_[i]) + kButtonGapRowRem);
        }
        const double width = index < tops_.size() ? metrics_.Rem(PageButtonWidthRem(tops_[index])) : 0.0;
        return Box{x, metrics_.Rem(kSafeYRem + kPageRowTopRem), width, metrics_.Rem(kButtonRowRem)};
    }
    if (Streamy()) {
        // The stream chrome runs left to right across the top, and stays there while the page scrolls.
        double x = metrics_.Rem(kSafeXRem);
        for (std::size_t i = 0; i < index && i < tops_.size(); ++i) {
            x += metrics_.Rem(ChromeLinkWidthRem(tops_[i]) + kChromeGapRem);
        }
        const double width = index < tops_.size() ? metrics_.Rem(ChromeLinkWidthRem(tops_[index])) : 0.0;
        return Box{x, metrics_.Rem(kChromePadTopRem), width, metrics_.Rem(kChromeLinkHeightRem)};
    }
    // The buttons sit in the header row, at the top right, and go leftwards in order. They scroll with the page.
    const double width = metrics_.Rem(kTopButtonWidthRem);
    const double height = metrics_.Rem(kTopButtonHeightRem);
    const double step = width + metrics_.Rem(kTopButtonGapRem);
    const double x = viewportWidth_ - metrics_.Rem(kSafeXRem) - width - static_cast<double>(index) * step;
    return Box{x, metrics_.Rem(kSafeYRem) - pageScroll_, width, height};
}

void Scene::Layout(double width, double height) {
    viewportWidth_ = width;
    viewportHeight_ = height;
    metrics_.rem = height / kReferenceRemsHeight;

    // The hero takes the top of the window, and the rails start below it.
    heroHeight_ = HeroActive() ? kHeroHeightFraction * height : 0.0;
    pageTopOffset_ = HeroActive() ? heroHeight_ + metrics_.Rem(kHeroRailGapRem) : 0.0;

    const double contentWidth = width - 2.0 * metrics_.Rem(kSafeXRem);
    railsHeight_ = page_->Measure(contentWidth, metrics_).height;
    pageContentHeight_ = railsHeight_ + pageTopOffset_;
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
    Arrange();
    SyncFocus();

    // Home starts on Watch, as the web Home does. Without a hero, the first card has the focus.
    if (!focus_.Focused().has_value()) {
        if (HeroActive()) {
            focus_.SetFocus(kHeroPlayKey);
        } else if (!cards_.empty()) {
            focus_.SetFocus(cards_.front().key);
            cards_.front().card->SetFocusAmount(1.0);
            cards_.front().card->SetFocused(true);
        }
    }
}

void Scene::Arrange() {
    // With a hero, the rails start below it. Without one, the page starts below the header, and below
    // the status line while one is shown, so the two never overlap.
    const double headerTop = HeaderTop();
    const double pageTop = HeroActive() ? pageTopOffset_
                                        : headerTop + (status_.empty() ? 0.0 : metrics_.Rem(kStatusRowRem));
    const Box page{metrics_.Rem(kSafeXRem), pageTop - pageScroll_, viewportWidth_ - 2.0 * metrics_.Rem(kSafeXRem),
                   railsHeight_};
    page_->Arrange(page, metrics_);
}

void Scene::SyncFocus() {
    // Each container gets its box, and each card is a leaf under its rail.
    // The focus engine resolves containers to their last focused child.
    nav::FocusNode page;
    page.key = kPageKey;
    page.rect = nav::Rect{page_->box().x, page_->box().y, page_->box().Right(), page_->box().Bottom()};
    page.container = true;
    focus_.Upsert(page);

    for (std::size_t r = 0; r < rails_.size(); ++r) {
        const Box& rb = rails_[r]->box();
        nav::FocusNode rail;
        rail.key = RailKey(r);
        rail.parent = kPageKey;
        rail.rect = nav::Rect{rb.x, rb.y, rb.Right(), rb.Bottom()};
        rail.container = true;
        focus_.Upsert(rail);
    }

    for (const CardRef& ref : cards_) {
        const Box& cb = ref.card->box();
        nav::FocusNode card;
        card.key = ref.key;
        card.parent = RailKey(ref.rail);
        card.rect = nav::Rect{cb.x, cb.y, cb.Right(), cb.Bottom()};
        focus_.Upsert(card);
    }

    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const Box top = TopBoxScreen(i);
        nav::FocusNode button;
        button.key = TopKey(i);
        button.parent = kPageKey;
        button.rect = nav::Rect{top.x, top.y, top.Right(), top.Bottom()};
        focus_.Upsert(button);
    }

    if (HeroActive()) {
        const HeroBoxes boxes = HeroLayout();
        for (const auto& [key, box] : {std::pair<const char*, Box>{kHeroPlayKey, boxes.watch},
                                       std::pair<const char*, Box>{kHeroInfoKey, boxes.learn}}) {
            nav::FocusNode button;
            button.key = key;
            button.parent = kPageKey;
            button.rect = nav::Rect{box.x, box.y, box.Right(), box.Bottom()};
            focus_.Upsert(button);
        }
    }
}

bool Scene::Tick(double nowMs) {
    clockMs_ = nowMs;
    timeline_.Advance(nowMs);
    StartHeroArt(nowMs);

    const bool reduced = motion::PrefersReducedMotion(motion_);
    bool moved = false;
    for (std::size_t r = 0; r < rails_.size(); ++r) {
        if (!railCamera_[r].active()) continue;
        const motion::CameraStep step = railCamera_[r].Step(nowMs, reduced);
        rails_[r]->SetScroll(step.position);
        moved = true;
    }
    if (pageCamera_.active()) {
        const motion::CameraStep step = pageCamera_.Step(nowMs, reduced);
        pageScroll_ = step.position;
        moved = true;
    }

    if (moved) {
        Arrange();
        SyncFocus();
    }
    return moved || Animating();
}

bool Scene::Animating() const {
    const bool titleMoving = titleFade_.has_value() && !titleFade_->Done(clockMs_);
    const bool pictureMoving = artFade_.has_value() && !artFade_->Done(clockMs_);
    return timeline_.size() > 0 || CameraActive() || titleMoving || pictureMoving;
}

bool Scene::CameraActive() const {
    if (pageCamera_.active()) return true;
    return std::any_of(railCamera_.begin(), railCamera_.end(),
                       [](const motion::CameraTween& camera) { return camera.active(); });
}

bool Scene::Navigate(nav::Direction direction, double nowMs) {
    const std::optional<std::string> focused = focus_.Focused();
    if (!focused.has_value()) return false;

    // Up from the hero reaches the nearest link of the stream chrome, or else the first top button.
    const auto topAbove = [&](const Box& from) {
        if (!RowTops()) return TopKey(0);
        std::vector<double> centers;
        for (std::size_t i = 0; i < tops_.size(); ++i) centers.push_back(TopBoxScreen(i).CenterX());
        const int closest = nav::PickClosestIndex(centers, from.CenterX());
        return TopKey(closest < 0 ? 0 : static_cast<std::size_t>(closest));
    };

    // A notice's two buttons sit side by side.
    if (HeroActive() && !heroes_[heroIndex_].body.empty() && IsHeroKey(*focused)) {
        const bool onPlay = *focused == kHeroPlayKey;
        if (direction == nav::Direction::Right && onPlay) {
            FocusKey(kHeroInfoKey, nowMs, true);
            return true;
        }
        if (direction == nav::Direction::Left && !onPlay) {
            FocusKey(kHeroPlayKey, nowMs, true);
            return true;
        }
        if (direction == nav::Direction::Up && !tops_.empty()) {
            const HeroBoxes boxes = HeroLayout();
            FocusKey(topAbove(onPlay ? boxes.watch : boxes.learn), nowMs, true);
            return true;
        }
        if (direction != nav::Direction::Down || rails_.empty()) return false;
        FocusKey(cards_[GlobalIndex(0, 0)].key, nowMs, true);
        return true;
    }

    // The hero's two buttons stack: Up from Watch reaches the top buttons, and Down from Browse reaches the rails.
    if (*focused == kHeroPlayKey) {
        if (direction == nav::Direction::Up && !tops_.empty()) {
            FocusKey(topAbove(HeroLayout().watch), nowMs, true);
            return true;
        }
        if (direction == nav::Direction::Down) {
            FocusKey(kHeroInfoKey, nowMs, true);
            return true;
        }
        return false;
    }
    if (*focused == kHeroInfoKey) {
        if (direction == nav::Direction::Up) {
            FocusKey(kHeroPlayKey, nowMs, true);
            return true;
        }
        if (direction != nav::Direction::Down || rails_.empty()) return false;
        std::vector<double> centers;
        for (const auto& child : rails_[0]->children()) centers.push_back(child->box().CenterX());
        const int closest = nav::PickClosestIndex(centers, HeroLayout().learn.CenterX());
        if (closest < 0) return false;
        FocusKey(cards_[GlobalIndex(0, static_cast<std::size_t>(closest))].key, nowMs, true);
        return true;
    }

    if (const std::optional<std::size_t> top = TopIndexOf(*focused)) {
        // Right and left move along the top buttons, as the header lays them out: leftwards from the first
        // on Home, rightwards from the first in the stream chrome.
        const nav::Direction toNext = RowTops() ? nav::Direction::Right : nav::Direction::Left;
        const nav::Direction toPrevious = RowTops() ? nav::Direction::Left : nav::Direction::Right;
        if (direction == toPrevious && *top > 0) {
            FocusKey(TopKey(*top - 1), nowMs, true);
            return true;
        }
        if (direction == toNext && *top + 1 < tops_.size()) {
            FocusKey(TopKey(*top + 1), nowMs, true);
            return true;
        }
        // Down from the stream chrome goes to the hero, which sits under it.
        if (direction == nav::Direction::Down && Streamy() && HeroActive()) {
            FocusKey(kHeroPlayKey, nowMs, true);
            return true;
        }
        // Down from a button goes to the first rail, under the button.
        if (direction != nav::Direction::Down || rails_.empty()) return false;
        std::vector<double> centers;
        for (const auto& child : rails_[0]->children()) centers.push_back(child->box().CenterX());
        const int closest = nav::PickClosestIndex(centers, TopBoxScreen(*top).CenterX());
        if (closest < 0) return false;
        FocusKey(cards_[GlobalIndex(0, static_cast<std::size_t>(closest))].key, nowMs, true);
        return true;
    }

    const std::size_t from = cardByKey_.at(*focused);
    const CardRef& current = cards_[from];

    // Up from the top rail reaches the browse button of the hero, or else the first top button.
    if (direction == nav::Direction::Up && current.rail == 0) {
        if (HeroActive()) {
            FocusKey(kHeroInfoKey, nowMs, true);
            return true;
        }
        if (tops_.empty()) return false;
        FocusKey(TopKey(0), nowMs, true);
        return true;
    }

    std::optional<std::size_t> target;
    if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
        const std::size_t count = CardCount(current.rail);
        const auto next = nav::RowWrapIndex(static_cast<int>(current.index), direction, static_cast<int>(count));
        if (next.has_value()) target = GlobalIndex(current.rail, static_cast<std::size_t>(*next));
    } else {
        const auto row = nav::NeighborRowIndex(static_cast<int>(current.rail), direction,
                                               static_cast<int>(rails_.size()));
        if (row.has_value()) {
            const auto targetRail = static_cast<std::size_t>(*row);
            std::vector<double> centers;
            for (const auto& child : rails_[targetRail]->children()) centers.push_back(child->box().CenterX());
            const int closest = nav::PickClosestIndex(centers, current.card->box().CenterX());
            if (closest >= 0) target = GlobalIndex(targetRail, static_cast<std::size_t>(closest));
        }
    }

    if (!target.has_value() || *target == from) return false;
    FocusKey(cards_[*target].key, nowMs, true);
    return true;
}

std::optional<Command> Scene::Select(double /*nowMs*/) {
    const std::optional<std::string> focused = focus_.Focused();
    if (!focused.has_value()) return std::nullopt;

    if (const std::optional<std::size_t> top = TopIndexOf(*focused)) return tops_[*top].command;

    // Watch opens the title on the hero, as its card would. Browse opens the TVM Stream page.
    // On TVM Stream both open the billboard's title, as Library.tsx does. A notice brings its own commands.
    if (IsHeroKey(*focused) && HeroActive()) {
        const HeroData& hero = heroes_[heroIndex_];
        const bool play = *focused == kHeroPlayKey;
        if (play && hero.playCommand.has_value()) return hero.playCommand;
        if (!play && hero.infoCommand.has_value()) return hero.infoCommand;
        Command command;
        if (play || Streamy()) {
            command.name = "details";
            command.params["id"] = hero.itemId;
            command.params["title"] = hero.title;
        } else {
            command.name = "tvm-stream";
        }
        return command;
    }

    const CardRef& card = cards_[cardByKey_.at(*focused)];
    Command command;
    switch (cardAction_) {
    case CardAction::Details:
        // OK on a title opens its details. The shell pushes the screen, and the
        // id is the catalogue's, so the details can be fetched.
        command.name = "details";
        command.params["id"] = card.card->itemId();
        command.params["title"] = card.card->title();
        return command;
    case CardAction::Play:
        // A channel plays over the screen, as the Node core's player does.
        command.name = "player";
        command.modal = true;
        command.params["id"] = card.card->itemId();
        return command;
    case CardAction::TogglePick:
        // Saving the pick is the app's job, so the shell opens nothing.
        command.name = "live-toggle-pick";
        command.action = true;
        command.params["id"] = card.card->itemId();
        return command;
    }
    return std::nullopt;
}

bool Scene::FocusItem(const std::string& key, double nowMs, bool withCamera) {
    if (focus_.Focused() == std::optional<std::string>(key)) return false;
    if (TopIndexOf(key).has_value() || (HeroActive() && IsHeroKey(key))) {
        FocusKey(key, nowMs, withCamera);
        return true;
    }
    if (!cardByKey_.contains(key)) return false;
    FocusKey(key, nowMs, withCamera);
    return true;
}

std::optional<std::string> Scene::ItemAt(double x, double y) const {
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        if (Contains(TopBoxScreen(i), x, y)) return TopKey(i);
    }
    if (HeroActive()) {
        const HeroBoxes boxes = HeroLayout();
        if (Contains(boxes.watch, x, y)) return std::string(kHeroPlayKey);
        if (Contains(boxes.learn, x, y)) return std::string(kHeroInfoKey);
    }
    for (std::size_t r = 0; r < rails_.size(); ++r) {
        if (!Contains(rails_[r]->box(), x, y)) continue;
        for (std::size_t i = 0; i < CardCount(r); ++i) {
            if (Contains(CardBox(r, i), x, y)) return cards_.at(GlobalIndex(r, i)).key;
        }
    }
    return std::nullopt;
}

std::optional<Command> Scene::ActivateItem(const std::string& key, double nowMs) {
    const bool heroKey = HeroActive() && IsHeroKey(key);
    if (!TopIndexOf(key).has_value() && !heroKey && !cardByKey_.contains(key)) return std::nullopt;
    FocusItem(key, nowMs, true);
    return Select(nowMs);
}

std::optional<ScrollSurface> Scene::SurfaceAt(double x, double y, nav::Axis axis) const {
    if (axis == nav::Axis::X) {
        for (std::size_t r = 0; r < rails_.size(); ++r) {
            const Rail& rail = *rails_[r];
            if (!Contains(rail.box(), x, y)) continue;
            ScrollSurface surface;
            surface.kind = ScrollSurface::Kind::Rail;
            surface.index = r;
            surface.scroll = rail.scroll();
            surface.target = railCamera_[r].active() ? railCamera_[r].target() : rail.scroll();
            surface.maxScroll = rail.MaxScroll();
            surface.viewport = rail.box().width;
            surface.canPan = nav::CanScroll(rail.ContentWidth(), rail.box().width);
            return surface;
        }
        return std::nullopt;
    }

    // The page covers the whole window.
    if (x < 0.0 || x >= viewportWidth_ || y < 0.0 || y >= viewportHeight_) return std::nullopt;
    ScrollSurface surface;
    surface.kind = ScrollSurface::Kind::Page;
    surface.index = 0;
    surface.scroll = pageScroll_;
    surface.target = pageCamera_.active() ? pageCamera_.target() : pageScroll_;
    surface.maxScroll = MaxPageScroll();
    surface.viewport = viewportHeight_;
    surface.canPan = nav::CanScroll(pageContentHeight_ + 2.0 * metrics_.Rem(kSafeYRem), viewportHeight_);
    return surface;
}

void Scene::SetScroll(const ScrollSurface& surface, double value, double /*nowMs*/) {
    if (surface.kind == ScrollSurface::Kind::Rail) {
        railCamera_.at(surface.index).Cancel();
        rails_.at(surface.index)->SetScroll(value);
    } else {
        pageCamera_.Cancel();
        pageScroll_ = std::clamp(value, 0.0, MaxPageScroll());
    }
    Arrange();
    SyncFocus();
}

void Scene::AnimateScroll(const ScrollSurface& surface, double target, double /*nowMs*/) {
    bool moved = false;
    if (surface.kind == ScrollSurface::Kind::Rail) {
        StartRailCamera(surface.index, target, moved);
    } else {
        StartPageCamera(target, moved);
    }
    if (moved) {
        Arrange();
        SyncFocus();
    }
}

void Scene::FocusKey(const std::string& key, double nowMs, bool withCamera) {
    // The old card fades out. The button has no fade, it is drawn with its ring.
    const std::optional<std::string> previous = focus_.Focused();
    if (previous.has_value() && cardByKey_.contains(*previous)) {
        AnimateFocus(cardByKey_.at(*previous), 0.0, nowMs);
    }
    focus_.SetFocus(key);

    const auto card = cardByKey_.find(key);
    if (card != cardByKey_.end()) AnimateFocus(card->second, 1.0, nowMs);
    if (!withCamera) return;

    bool moved = false;
    if (card == cardByKey_.end()) {
        // The button is in the header, so the page comes back to the top.
        StartPageCamera(0.0, moved);
    } else {
        // Bring the card to the middle of its rail, then its row under the
        // chrome. A short hop lands at once. A longer one is eased by the camera.
        const CardRef& next = cards_[card->second];
        const Rail& rail = *rails_[next.rail];
        const double viewport = rail.box().width;
        const double cardWidth = next.card->box().width;
        const double goal = nav::CenteredRowOffset(rail.scroll(), rail.box().x + rail.ContentLeftOf(next.index) - rail.scroll(),
                                                   cardWidth, rail.box().x, viewport);
        StartRailCamera(next.rail, goal, moved);

        const double rowTop = rail.box().y;
        const double pad = metrics_.Rem(kRowCameraPadRem);
        const double pageTarget = nav::PagePanTarget(pageScroll_, rowTop, 0.0, pad);
        if (nav::ShouldNudgePageY(pageScroll_, pageTarget)) StartPageCamera(pageTarget, moved);
    }

    if (moved) {
        Arrange();
        SyncFocus();
    }
}

void Scene::StartRailCamera(std::size_t rail, double target, bool& moved) {
    const bool reduced = motion::PrefersReducedMotion(motion_);
    Rail& row = *rails_[rail];
    const motion::CameraStart start = railCamera_[rail].Begin(row.scroll(), target, row.MaxScroll(), reduced);
    if (start == motion::CameraStart::Landed) {
        row.SetScroll(railCamera_[rail].position());
        moved = true;
    }
}

void Scene::StartPageCamera(double target, bool& moved) {
    const bool reduced = motion::PrefersReducedMotion(motion_);
    const motion::CameraStart start = pageCamera_.Begin(pageScroll_, target, MaxPageScroll(), reduced);
    if (start == motion::CameraStart::Landed) {
        pageScroll_ = pageCamera_.position();
        moved = true;
    }
}

void Scene::AnimateFocus(std::size_t cardIndex, double to, double nowMs) {
    CardRef& ref = cards_[cardIndex];
    if (ref.focusAnimation != 0) timeline_.Remove(ref.focusAnimation);
    ref.focusAnimation = 0;
    ref.card->SetFocused(to > 0.0);

    const double from = ref.card->focusAmount();
    if (from == to) return;

    // A poster's transform eases over the base token, 200 ms, as `.poster__art` does.
    const double duration = motion::ResolveMotionTokens(motion_).baseMs;
    Card* card = ref.card;
    const motion::Tween tween(from, to, timeline_.Clock(nowMs), duration);
    ref.focusAnimation = timeline_.Add([card, tween](double clockMs) {
        card->SetFocusAmount(tween.Value(clockMs));
        return tween.Done(clockMs);
    });
}

void Scene::Paint(Painter& painter) const {
    painter.Clear(tokens::kBackground);
    page_->Paint(painter, metrics_);

    // The hero is painted over the rails it scrolls above, as the web stage is layered over the shelves.
    if (HeroActive()) PaintHero(painter);

    // The status line sits in the header. While it is shown, the page scrolls beneath a band
    // that keeps the header clear, so the line never sits on top of a title.
    const double headerTop = HeaderTop();
    if (style_ == SceneStyle::Search) {
        // The field stays at the top while the results scroll under it.
        painter.FillRoundRect(Box{0.0, 0.0, viewportWidth_, headerTop}, 0.0, tokens::kBackground);
        PaintSearchField(painter);
    }
    if (!status_.empty()) {
        const double headerBottom = headerTop + metrics_.Rem(kStatusRowRem);
        // On the search page the band starts under the field, which is already painted.
        const double bandTop = style_ == SceneStyle::Search ? headerTop : 0.0;
        painter.FillRoundRect(Box{0.0, bandTop, viewportWidth_, headerBottom - bandTop}, 0.0, tokens::kBackground);
        const double x = metrics_.Rem(kSafeXRem);
        painter.Text(Box{x, headerTop, viewportWidth_ * 0.6, metrics_.Rem(kTopButtonHeightRem)}, status_,
                     TextStyle{metrics_.Rem(1.0), false}, tokens::kTextMuted);
    }

    if (Streamy()) {
        PaintStreamChrome(painter);
        return;
    }
    if (style_ == SceneStyle::Page) {
        PaintPageHeader(painter);
        return;
    }

    // The top buttons are drawn last, so they sit above the rails.
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const Box button = TopBoxScreen(i);
        if (button.Bottom() < 0.0 || button.y >= viewportHeight_) continue;
        const bool focused = focus_.Focused() == std::optional<std::string>(TopKey(i));
        const double radius = metrics_.Rem(0.5);
        painter.FillRoundRect(button, radius, focused ? tokens::kSurfaceHover : tokens::kSurface);
        painter.StrokeRoundRect(button, radius, 1.0, tokens::kBorderSoft);
        if (focused) {
            const double ringWidth = metrics_.Rem(kFocusRingWidthRem);
            const double outset = metrics_.Rem(kFocusRingOffsetRem) + ringWidth / 2.0;
            const Box ring{button.x - outset, button.y - outset, button.width + 2.0 * outset, button.height + 2.0 * outset};
            painter.StrokeRoundRect(ring, radius + outset, ringWidth, tokens::kFocusRing);
        }
        painter.Text(Box{button.x + metrics_.Rem(1.0), button.y, button.width - metrics_.Rem(2.0), button.height},
                     tops_[i].label, TextStyle{metrics_.Rem(0.9375), false},
                     focused ? tokens::kText : tokens::kTextMuted);
    }
}

const Box& Scene::CardBox(std::size_t rail, std::size_t index) const {
    return cards_.at(GlobalIndex(rail, index)).card->box();
}

double Scene::CardFocus(std::size_t rail, std::size_t index) const {
    return cards_.at(GlobalIndex(rail, index)).card->focusAmount();
}

}  // namespace tvm::ui
