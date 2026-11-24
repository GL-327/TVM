#include "ui/scene.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <string_view>

#include "motion/tween.h"
#include "nav/pointer.h"
#include "nav/wrap.h"
#include "ui/glass_styles.h"

namespace tvm::ui {

namespace {

// Glass motion: a quick start and a long, gentle settle with no overshoot, so controls feel responsive but calm.
constexpr motion::CubicBezier kGlassEase{0.32, 0.72, 0.0, 1.0};
constexpr double kEmphasisInMs = 150.0;
constexpr double kEmphasisOutMs = 220.0;
constexpr double kPressInMs = 70.0;
constexpr double kPressOutMs = 240.0;
constexpr double kIndicatorMs = 380.0;
// The focus highlight starts just after the plate brightens and crosses in under a second.
constexpr double kSweepDelayMs = 90.0;
constexpr double kSweepMs = 850.0;
// A focused button's label turns dark on its bright plate.
constexpr Color kPlateInk = Rgb(0x111318);
// The whole chrome entrance, from the first frame it is seen.
constexpr double kChromeEntranceMs = 720.0;

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

// The row the status line takes above the page, when there is one.
constexpr double kStatusRowRem = 2.5;
// The top buttons in the header, until the navigation bar is ported.
constexpr double kTopButtonWidthRem = 10.0;
constexpr double kTopButtonHeightRem = 2.0;
constexpr double kTopButtonGapRem = 1.0;

// The hero, matching Study 03 (Roku Home) and docs/redesign/WINDOWS-VISUAL-SPEC.md at 1080p (1rem = 16px).
constexpr double kPi = 3.14159265358979323846;
constexpr double kHeroHeightFraction = 0.48;  // logical stage height before the first rail heading
constexpr double kHeroRailGapRem = 0.85;      // padding above the first rail
constexpr double kHeroPadBottomRem = 1.25;    // bottom padding inside the hero stage
constexpr double kHeroCopyWidthRem = 44.0;    // max-width for hero headline & metadata
constexpr double kHeroKickerFontRem = 0.8125;
constexpr double kHeroKickerHeightRem = 1.14;
constexpr double kHeroKickerMarginRem = 0.5;
constexpr double kHeroTitleFontRem = 4.5;     // 72px Bold at 1080p
constexpr double kHeroTitleLineRem = 1.15;
constexpr double kHeroMetaFontRem = 1.375;    // 22px Regular at 1080p
constexpr double kHeroMetaHeightRem = 1.85;
constexpr double kHeroMetaMarginTopRem = 0.55;
constexpr double kHeroMetaMarginBottomRem = 1.25;
constexpr double kHeroLearnHeightRem = 3.5;   // 56px tall glass pills at 1080p
constexpr double kHeroPlayMinWidthRem = 11.5; // 184px wide Play pill at 1080p
constexpr double kHeroLearnMinWidthRem = 9.75;// 156px wide Details pill at 1080p
constexpr double kHeroButtonPadRem = 1.5;
constexpr double kHeroButtonFontRem = 1.5;    // 24px SemiBold at 1080p
constexpr double kHeroPillGapRem = 1.125;     // 18px gap between Play and Details pills
constexpr double kHeroDotsMarginRem = 1.15;
constexpr double kHeroDotRem = 0.375;         // 6px carousel dots
constexpr double kHeroDotGapRem = 0.45;
// The dissolves of the picture and the title: `hero-art-dissolve` and `hero-copy-in`, 480 ms.
constexpr double kHeroDissolveMs = 480.0;
constexpr motion::CubicBezier kHeroEase{0.2, 0.65, 0.3, 1.0};
// The picture fades as the page scrolls, to nothing at this share of the hero's height: heroScrollFade.
constexpr double kHeroFadeSpan = 0.92;
constexpr char kHeroPlayKey[] = "hero-play";
constexpr char kHeroInfoKey[] = "hero-info";
constexpr std::string_view kWatchLabel = "Play";
constexpr std::string_view kLearnLabel = "Details";
constexpr std::string_view kDefaultMetaLabel = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
constexpr char kPlayTrianglePath[] = "m10 6 16 10-16 10z";

// The top navigation capsule and brand bar, matching Study 03 (Roku Home).
constexpr double kChromePadTopRem = 2.0;      // 32px top inset at 1080p
constexpr double kChromePadBottomRem = 0.85;
constexpr double kChromeLinkHeightRem = 2.75; // 44px inner tab height inside 56px capsule
constexpr double kChromeLinkPadRem = 1.35;    // 21.6px horizontal tab padding
constexpr double kChromeGapRem = 0.35;        // gap between tabs in the capsule
constexpr double kChromeFontRem = 1.375;      // 22px nav tab label
constexpr double kCapsulePadRem = 0.375;      // 6px padding around tabs inside the outer glass capsule
constexpr double kOrbSizeRem = 3.25;          // 52px circular profile orb at 1080p
constexpr int kChromeWeight = 560;
// TVM wordmark on top-left: clean 30px Bold white letters.
constexpr double kWordmarkMarkRem = 1.35;
constexpr double kWordmarkFontRem = 1.875;    // 30px Bold wordmark
constexpr double kLockupGapRem = 0.45;
// Notice layout for Real-Debrid connect screen.
constexpr double kNoticeBodyRem = 6.0;
constexpr double kNoticeTitleRem = 3.0;       // 48px Bold screen title
constexpr double kNoticeButtonGapRem = 0.85;
constexpr Color kMarkColor = Rgb(0x4AA0E0);
constexpr Color kMarkPlate = Rgb(0x2F6BFF);
constexpr char kMarkImage[] = "asset:tvm-icon.png";
constexpr std::string_view kStreamWatchLabel = "Play";
constexpr std::string_view kStreamLearnLabel = "Details";
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

// The colour at a fraction of its own opacity.
Color Faded(Color color, double amount) {
    color.a *= std::clamp(amount, 0.0, 1.0);
    return color;
}

Box LerpBox(const Box& from, const Box& to, double t) {
    return Box{from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.width + (to.width - from.width) * t,
               from.height + (to.height - from.height) * t};
}

// The box grown or shrunk by `scale` about its centre.
Box ScaledAbout(const Box& box, double scale) {
    const double w = box.width * scale;
    const double h = box.height * scale;
    return Box{box.CenterX() - w / 2.0, box.CenterY() - h / 2.0, w, h};
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
    if (button.orb) return kOrbSizeRem;
    if (button.lockup) {
        return EstimateRem(button.label, kWordmarkFontRem, 0.14) + 1.2;
    }
    return 2.0 * kChromeLinkPadRem + EstimateRem(button.label, kChromeFontRem);
}

// The width of a page-style button, in rems: its label and the button's padding.
double PageButtonWidthRem(const TopButton& button) {
    return EstimateRem(button.label, kButtonLabelRem) + 2.0 * kButtonPadRem + 0.6;
}

std::string CardKey(std::size_t rail, std::size_t index) {
    return "card:" + std::to_string(rail) + ":" + std::to_string(index);
}

std::string RailKey(std::size_t rail) {
    return "rail:" + std::to_string(rail);
}

constexpr const char* kPageKey = "page";
constexpr const char* kSearchFieldKey = "search-field";
constexpr const char* kPageButtonPrefix = "page:";
// The page header under the stream chrome.
constexpr double kLaneKickerRem = 0.8125;
constexpr double kLaneHeadingRem = 2.25;
constexpr double kLaneFieldRem = 3.4;
// The search page's field: a large pill centred under its heading, about half the window wide.
constexpr double kSearchHeroRem = 4.6;
// The gap from the field to the rule under it, and from the rule to what follows.
constexpr double kSearchRuleGapRem = 0.9;
constexpr double kSearchSectionSpacingRem = 3.0;
constexpr double kSearchRailSpacingRem = 1.6;
constexpr double kSegmentRem = 2.6;
constexpr double kCaretBlinkMs = 1060.0;
constexpr double kLaneButtonRem = 2.6;
constexpr double kLaneGapRem = 0.85;
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
    // A new view of the same page (the catalogue or the account refreshed) keeps the viewer's place exactly: the
    // page's scroll, each rail's scroll, and the focused title in its own rail. Nothing moves. A different page
    // starts at the top.
    const bool samePage = view.style == style_ && view.pageKey == pageKey_ && !rails_.empty();
    const double pageWas = pageCamera_.active() ? pageCamera_.target() : pageScroll_;
    std::map<std::string, double> railWas;
    std::string focusedRail;
    for (std::size_t r = 0; r < rails_.size() && r < railIds_.size(); ++r) {
        if (railIds_[r].empty()) continue;
        railWas[railIds_[r]] = r < railCamera_.size() && railCamera_[r].active() ? railCamera_[r].target()
                                                                                    : rails_[r]->scroll();
    }
    if (focused.has_value() && cardByKey_.contains(*focused)) {
        const std::size_t rail = cards_[cardByKey_.at(*focused)].rail;
        if (rail < railIds_.size()) focusedRail = railIds_[rail];
    }
    pageKey_ = view.pageKey;
    // Where the selected tab's glass is now, so it can slide from there to the newly selected tab.
    const std::optional<Box> indicatorWas = TabIndicatorBox();
    const std::optional<std::size_t> activeWas = activeTab_;

    status_ = view.status;
    tops_ = view.topButtons;
    cardAction_ = view.cardAction;
    style_ = view.style;
    query_ = view.query;
    kicker_ = view.kicker;
    heading_ = view.heading;
    brandWord_ = view.brandWord;
    brandColor_ = view.brandColor;
    pageButtons_ = view.pageButtons;
    searchField_ = view.searchField;
    loading_ = view.loading;

    // The page itself changes at once; only the selected tab's glass catches up.
    activeTab_ = ActiveTabIndex();
    if (activeTab_ != activeWas) {
        indicatorMove_.reset();
        if (activeTab_.has_value() && activeWas.has_value() && indicatorWas.has_value() && viewportWidth_ > 0.0 &&
            !motion::PrefersReducedMotion(motion_)) {
            indicatorFrom_ = *indicatorWas;
            indicatorMove_ = motion::Tween(0.0, 1.0, nowMs, kIndicatorMs, kGlassEase);
        }
    }
    SetRails(view.rails);

    if (samePage) {
        for (std::size_t r = 0; r < rails_.size() && r < railIds_.size(); ++r) {
            const auto was = railWas.find(railIds_[r]);
            if (was != railWas.end()) rails_[r]->SetScroll(std::clamp(was->second, 0.0, rails_[r]->MaxScroll()));
        }
        pageScroll_ = std::clamp(pageWas, 0.0, MaxPageScroll());
        Arrange();
        // The focused title, in the rail it was in when it is still there, else wherever it now is. No camera.
        if (itemId.has_value()) {
            std::optional<std::string> key;
            for (const CardRef& ref : cards_) {
                if (ref.card->itemId() != *itemId) continue;
                const bool sameRail = ref.rail < railIds_.size() && railIds_[ref.rail] == focusedRail;
                if (!key.has_value() || sameRail) key = ref.key;
                if (sameRail) break;
            }
            if (key.has_value()) {
                FocusKey(*key, nowMs, false);
                return;
            }
        }
        if (top.has_value() && *top < tops_.size()) FocusKey(TopKey(*top), nowMs, false);
        if (focused.has_value() && IsHeroKey(*focused) && HeroActive()) FocusKey(*focused, nowMs, false);
        return;
    }

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

std::optional<std::size_t> Scene::ActiveTabIndex() const {
    if (!Streamy()) return std::nullopt;
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        if (tops_[i].on && !tops_[i].lockup && !tops_[i].orb) return i;
    }
    return std::nullopt;
}

std::optional<Box> Scene::TabIndicatorBox() const {
    if (!activeTab_.has_value() || *activeTab_ >= tops_.size() || !Streamy()) return std::nullopt;
    const Box to = TopBoxScreen(*activeTab_);
    if (!indicatorMove_.has_value() || indicatorMove_->Done(clockMs_)) return to;
    const double t = std::clamp(indicatorMove_->Value(clockMs_), 0.0, 1.0);
    Box box = LerpBox(indicatorFrom_, to, t);
    // The glass stretches a little along its path, like a drop of liquid, and settles back as it arrives.
    const double travel = std::fabs(to.CenterX() - indicatorFrom_.CenterX());
    const double stretch = std::min(to.height * 0.45, travel * 0.10) * std::sin(kPi * t);
    box.x -= stretch / 2.0;
    box.width += stretch;
    return box;
}

double Scene::EmphasisOf(const std::string& key) const {
    const auto found = emphasis_.find(key);
    if (found != emphasis_.end()) return std::clamp(found->second.Value(clockMs_), 0.0, 1.0);
    return ShowsFocus(key) ? 1.0 : 0.0;
}

double Scene::PressOf(const std::string& key) const {
    if (pressKey_.empty() || key != pressKey_) return 0.0;
    return std::clamp(press_.Value(clockMs_), 0.0, 1.0);
}

void Scene::AnimateEmphasis(const std::optional<std::string>& from, const std::string& to, double nowMs) {
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (from.has_value() && *from != to && !cardByKey_.contains(*from)) {
        emphasis_[*from] = motion::Tween(EmphasisOf(*from), 0.0, nowMs, reduced ? 0.0 : kEmphasisOutMs, kGlassEase);
    }
    if (!cardByKey_.contains(to)) {
        emphasis_[to] = motion::Tween(EmphasisOf(to), focusHidden_ ? 0.0 : 1.0, nowMs, reduced ? 0.0 : kEmphasisInMs,
                                      kGlassEase);
        if (!reduced && (!from.has_value() || *from != to)) focusStart_[to] = nowMs;
    }
}

void Scene::EaseFocusedLook(bool shown, double nowMs) {
    const std::optional<std::string> key = focus_.Focused();
    if (!key.has_value()) return;
    if (const auto card = cardByKey_.find(*key); card != cardByKey_.end()) {
        AnimateFocus(card->second, shown ? 1.0 : 0.0, nowMs);
        return;
    }
    const bool reduced = motion::PrefersReducedMotion(motion_);
    emphasis_[*key] = motion::Tween(EmphasisOf(*key), shown ? 1.0 : 0.0, nowMs,
                                    reduced ? 0.0 : (shown ? kEmphasisInMs : kEmphasisOutMs), kGlassEase);
}

void Scene::PointerLeft(double nowMs) {
    if (focusHidden_) return;
    focusHidden_ = true;
    EaseFocusedLook(false, nowMs);
}

void Scene::PointerAt(double x, double y, double nowMs) {
    std::optional<std::size_t> under;
    const bool belowHeader = !(HasLaneHeader() && y < HeaderTop());
    for (std::size_t r = 0; r < rails_.size() && belowHeader; ++r) {
        if (Contains(rails_[r]->box(), x, y)) under = r;
    }
    arrowHover_.clear();
    if (under.has_value()) {
        for (const bool next : {false, true}) {
            const std::optional<Box> box = RailArrowBox(*under, next);
            if (box.has_value() && Contains(*box, x, y)) {
                arrowHover_ = std::string(next ? "rail-next:" : "rail-prev:") + std::to_string(*under);
            }
        }
    }
    if (under == arrowRail_) return;
    // The arrows fade in over the rail under the pointer, and out as it leaves.
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (under.has_value()) {
        arrowRail_ = under;
        arrowFade_ = motion::Tween(0.0, 1.0, nowMs, reduced ? 0.0 : 180.0, kGlassEase);
    } else {
        arrowFade_ = motion::Tween(arrowFade_.Value(nowMs), 0.0, nowMs, reduced ? 0.0 : 160.0, kGlassEase);
        if (reduced) arrowRail_.reset();
    }
}

std::optional<Box> Scene::RailArrowBox(std::size_t rail, bool next) const {
    if (rail >= rails_.size()) return std::nullopt;
    const Rail& row = *rails_[rail];
    const double max = row.MaxScroll();
    if (!nav::CanScroll(row.ContentWidth(), row.box().width) || max <= 0.0) return std::nullopt;
    // A round glass button at the rail's edge, centred on the pictures (not their titles).
    const double size = metrics_.Rem(2.75);
    const double art = std::min(row.box().height, metrics_.Rem(kPosterHeightRem));
    const double y = row.box().y + art / 2.0 - size / 2.0;
    const double x = next ? row.box().Right() - size - metrics_.Rem(0.35) : row.box().x + metrics_.Rem(0.35);
    return Box{x, y, size, size};
}

void Scene::PaintRailArrows(Painter& painter) const {
    if (!arrowRail_.has_value()) return;
    const double fade = std::clamp(arrowFade_.Value(clockMs_), 0.0, 1.0);
    if (fade <= 0.01) return;
    const std::size_t rail = *arrowRail_;
    for (const bool next : {false, true}) {
        const std::optional<Box> box = RailArrowBox(rail, next);
        if (!box.has_value()) continue;
        const std::string key = std::string(next ? "rail-next:" : "rail-prev:") + std::to_string(rail);
        const bool hovered = arrowHover_ == key;
        // The nav pill's glass: the resting capsule, and its hover plate under the pointer.
        painter.Glass(*box, box->height / 2.0, glass::NavCapsule(fade));
        if (hovered) painter.Glass(*box, box->height / 2.0, glass::NavHover(1.0, fade));
        const double glyph = box->width * 0.46;
        painter.Path(Box{box->CenterX() - glyph / 2.0, box->CenterY() - glyph / 2.0, glyph, glyph}, 24.0,
                     next ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7",
                     PathStyle{Color{0, 0, 0, 0}, glass::InkOnPlate(hovered ? 1.0 : 0.0, fade), 2.6, false});
    }
}

void Scene::ShowFocus(double nowMs) {
    if (!focusHidden_) return;
    focusHidden_ = false;
    EaseFocusedLook(true, nowMs);
}

double Scene::SweepOf(const std::string& key) const {
    if (tokens::reduceMotion || !ShowsFocus(key)) return -1.0;
    const auto start = focusStart_.find(key);
    if (start == focusStart_.end()) return -1.0;
    const double t = (clockMs_ - start->second - kSweepDelayMs) / kSweepMs;
    return t >= 0.0 && t <= 1.0 ? t : -1.0;
}

void Scene::SetPressed(const std::optional<std::string>& key, double nowMs) {
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (key.has_value()) {
        const double from = PressOf(*key);
        pressKey_ = *key;
        press_ = motion::Tween(from, 1.0, nowMs, reduced ? 0.0 : kPressInMs, motion::kEaseOut);
    } else if (!pressKey_.empty()) {
        press_ = motion::Tween(PressOf(pressKey_), 0.0, nowMs, reduced ? 0.0 : kPressOutMs, kGlassEase);
    }
}

double Scene::EntranceStage(double delayMs, double durationMs) const {
    if (!chromeEntranceStart_.has_value()) return 1.0;
    const double elapsed = clockMs_ - *chromeEntranceStart_ - delayMs;
    return kGlassEase.Ease(std::clamp(elapsed / durationMs, 0.0, 1.0));
}

bool Scene::ControlsAnimating() const {
    if (!press_.Done(clockMs_)) return true;
    if (indicatorMove_.has_value() && !indicatorMove_->Done(clockMs_)) return true;
    if (chromeEntranceStart_.has_value() && clockMs_ - *chromeEntranceStart_ < kChromeEntranceMs) return true;
    if (const std::optional<std::string> focused = focus_.Focused()) {
        const auto start = focusStart_.find(*focused);
        if (start != focusStart_.end() && clockMs_ - start->second < kSweepDelayMs + kSweepMs) return true;
    }
    return std::any_of(emphasis_.begin(), emphasis_.end(),
                       [this](const auto& entry) { return !entry.second.Done(clockMs_); });
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
    railIds_.clear();
    if (arrowRail_.has_value() && *arrowRail_ >= rails.size()) arrowRail_.reset();

    // Search's results breathe more than the browse rails: more space between rows and between posters.
    page_ = std::make_unique<Stack>(searchField_ ? kSearchSectionSpacingRem : kSectionSpacingRem);
    for (std::size_t r = 0; r < rails.size(); ++r) {
        const RailData& spec = rails[r];
        auto section = std::make_unique<Stack>(kHeadingGapRem);
        // A row that continues the grid above it has no heading, and takes no room for one.
        if (!spec.title.empty()) section->Add(std::make_unique<Heading>(spec.title, kHeadingSizeRem));

        auto rail = std::make_unique<Rail>(searchField_ ? kSearchRailSpacingRem : kRailSpacingRem, kRailInsetRem);
        railOffset_.push_back(cards_.size());
        for (std::size_t i = 0; i < spec.cards.size(); ++i) {
            const CardData& data = spec.cards[i];
            const std::string key = CardKey(r, i);
            auto card = std::make_unique<Card>(data.title, key, data.itemId, data.posterUrl, data.progress);
            if (data.logo) card->SetLogo(data.subtitle);
            else if (data.feature) card->SetFeature(data.subtitle);
            else if (data.category) card->SetCategory();
            else if (!data.subtitle.empty()) card->SetSubtitle(data.subtitle);
            cards_.push_back(CardRef{card.get(), r, i, key});
            cardByKey_[key] = cards_.size() - 1;
            rail->Add(std::move(card));
        }
        rails_.push_back(rail.get());
        railIds_.push_back(spec.id);
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
    const double x = metrics_.Rem(kSafeXRem + kRailInsetRem);
    const double copyWidth = std::min(metrics_.Rem(kHeroCopyWidthRem), viewportWidth_ - 2.0 * x);
    HeroBoxes boxes;

    // The copy sits in the lower-left safe zone of the hero stage, matching Study 03 (Roku Home).
    const bool hasDots = heroes_.size() > 1;
    const double dot = metrics_.Rem(kHeroDotRem);
    const std::size_t dotCount = hasDots ? heroes_.size() : 0;
    const double dotsWidth = static_cast<double>(dotCount) * dot +
                             (dotCount > 0 ? static_cast<double>(dotCount - 1) * metrics_.Rem(kHeroDotGapRem) : 0.0);
    double bottom = hero.Bottom() - metrics_.Rem(kHeroPadBottomRem);
    boxes.dots = Box{x, bottom - dot, dotsWidth, dot};
    if (hasDots) bottom -= dot + metrics_.Rem(kHeroDotsMarginRem);

    const bool compact = CompactViewport(viewportWidth_, viewportHeight_);
    const double pillHeight =
        compact ? std::max(44.0, metrics_.Rem(kHeroLearnHeightRem)) : metrics_.Rem(kHeroLearnHeightRem);
    const double learnWidthRem =
        std::max(kHeroLearnMinWidthRem, EstimateRem(InfoLabel(), kHeroButtonFontRem) + 2.0 * kHeroButtonPadRem);

    if (!heroes_[heroIndex_].body.empty()) {
        // A notice: its two buttons side by side under a paragraph and a smaller heading.
        const double playWidthRem =
            std::max(kHeroLearnMinWidthRem, EstimateRem(PlayLabel(), kHeroButtonFontRem) + 2.0 * kHeroButtonPadRem);
        boxes.watch = Box{x, bottom - pillHeight, std::min(copyWidth, metrics_.Rem(playWidthRem)), pillHeight};
        boxes.learn = Box{boxes.watch.Right() + metrics_.Rem(kNoticeButtonGapRem), boxes.watch.y,
                          std::min(copyWidth, metrics_.Rem(learnWidthRem)), pillHeight};
        if (boxes.learn.Right() > viewportWidth_ - x) {
            boxes.learn.x = x;
            boxes.watch.y -= pillHeight + metrics_.Rem(kNoticeButtonGapRem);
        }
        bottom = boxes.watch.y - metrics_.Rem(kHeroMetaMarginTopRem);
        boxes.body = Box{x, bottom - metrics_.Rem(kNoticeBodyRem),
                         std::min(copyWidth * 1.3, viewportWidth_ - 2.0 * x), metrics_.Rem(kNoticeBodyRem)};
        bottom = boxes.body.y - metrics_.Rem(kHeroKickerMarginRem);
        const double noticeTitle = metrics_.Rem(kNoticeTitleRem * 1.2);
        boxes.title = Box{x, bottom - noticeTitle, std::min(copyWidth * 1.3, viewportWidth_ - 2.0 * x), noticeTitle};
        bottom = boxes.title.y - metrics_.Rem(kHeroKickerMarginRem);
        boxes.kicker = Box{x, bottom - metrics_.Rem(kHeroKickerHeightRem), copyWidth, metrics_.Rem(kHeroKickerHeightRem)};
        return boxes;
    }

    // Study 03 Hero: side-by-side glass Play and Details pills below the metadata line and 72px Bold title.
    const double playWidthRem =
        std::max(kHeroPlayMinWidthRem, EstimateRem(PlayLabel(), kHeroButtonFontRem) + 2.0 * kHeroButtonPadRem + 1.4);
    boxes.watch = Box{x, bottom - pillHeight, std::min(copyWidth, metrics_.Rem(playWidthRem)), pillHeight};
    boxes.learn = Box{boxes.watch.Right() + metrics_.Rem(kHeroPillGapRem), boxes.watch.y,
                      std::min(copyWidth, metrics_.Rem(learnWidthRem)), pillHeight};
    if (boxes.learn.Right() > viewportWidth_ - x) {
        boxes.learn.x = x;
        boxes.watch.y -= pillHeight + metrics_.Rem(0.75);
    }
    bottom = boxes.watch.y - metrics_.Rem(kHeroMetaMarginBottomRem);

    const double metaHeight = metrics_.Rem(kHeroMetaHeightRem);
    boxes.meta = Box{x, bottom - metaHeight, copyWidth, metaHeight};
    bottom = boxes.meta.y - metrics_.Rem(kHeroMetaMarginTopRem);

    const double titleHeight = metrics_.Rem(kHeroTitleFontRem * kHeroTitleLineRem);
    boxes.title = Box{x, bottom - titleHeight, copyWidth, titleHeight};
    bottom = boxes.title.y - metrics_.Rem(kHeroKickerMarginRem);

    const double kickerHeight = metrics_.Rem(kHeroKickerHeightRem);
    boxes.kicker = Box{x, bottom - kickerHeight, copyWidth, kickerHeight};
    return boxes;
}

void Scene::PaintHeroBackdrop(Painter& painter) const {
    const Box hero = HeroBox();
    // The full-bleed hero artwork extends behind the Continue Watching shelf and fades smoothly into the ink ground.
    // On whole pixels, so the picture and the scrim closing it never share a partly covered last row (a thin line).
    const double backdropTop = std::round(hero.y);
    const double backdropBottom = std::round(hero.y + std::max(hero.height * 1.62, viewportHeight_ * 0.78));
    const Box backdrop{hero.x, backdropTop, hero.width, backdropBottom - backdropTop};
    const double fade = HeroFade();
    const HeroData& data = heroes_[heroIndex_];
    const double dissolve = artFade_.has_value() ? std::clamp(artFade_->Value(clockMs_), 0.0, 1.0) : 1.0;

    painter.SetBackdrop(backdrop, !artCurrent_.empty() ? artCurrent_ : "asset:lighthouse.jpg", 0.7, 0.2);

    // Fallback stage gradient under the artwork.
    const LineEnds slant = CssLine(backdrop, 160.0);
    painter.FillLinearGradient(backdrop, slant.x0, slant.y0, slant.x1, slant.y1,
                               {GradientStop{0.0, WithAlpha(tokens::kBackgroundElevated, fade)},
                                GradientStop{0.7, WithAlpha(tokens::kBackgroundDeep, fade)},
                                GradientStop{1.0, WithAlpha(tokens::kBackground, fade)}});
    const Color hue = HslColor(static_cast<double>(data.hue), 0.55, 0.38);
    painter.FillRadialGradient(backdrop, backdrop.x + 0.7 * backdrop.width, backdrop.y + 0.2 * backdrop.height,
                               0.7 * backdrop.width, 0.8 * backdrop.height,
                               {GradientStop{0.0, WithAlpha(hue, fade * 0.75)},
                                GradientStop{0.62, WithAlpha(hue, 0.0)},
                                GradientStop{1.0, WithAlpha(hue, 0.0)}});

    // The picture is cover-fitted with focal point (0.7, 0.2).
    if (!artPrevious_.empty() && artFade_.has_value() && !artFade_->Done(clockMs_)) {
        painter.ImageFaded(backdrop, artPrevious_, 0.0, fade, 0.7, 0.2);
    }
    if (!artCurrent_.empty()) {
        painter.ImageFaded(backdrop, artCurrent_, 0.0, fade * dissolve, 0.7, 0.2);
    }

    // Left and bottom readable scrims (Study 03: dark behind left headline & rails, clear over right lighthouse).
    const Color background = tokens::kBackground;
    const LineEnds across = CssLine(backdrop, 90.0);
    painter.FillLinearGradient(backdrop, across.x0, across.y0, across.x1, across.y1,
                               {GradientStop{0.0, WithAlpha(background, fade * 0.84)},
                                GradientStop{0.28, WithAlpha(background, fade * 0.52)},
                                GradientStop{0.54, WithAlpha(background, fade * 0.12)},
                                GradientStop{0.72, WithAlpha(background, 0.0)},
                                GradientStop{1.0, WithAlpha(background, 0.0)}});
    const LineEnds up = CssLine(backdrop, 180.0);
    painter.FillLinearGradient(backdrop, up.x0, up.y0, up.x1, up.y1,
                               {GradientStop{0.0, WithAlpha(background, 0.0)},
                                GradientStop{0.34, WithAlpha(background, 0.0)},
                                GradientStop{0.58, WithAlpha(background, fade * 0.36)},
                                GradientStop{0.82, WithAlpha(background, fade * 0.84)},
                                // The foot is always the page's own ground, whatever the scroll fade, so the backdrop
                                // never ends in a hard edge against the page as it scrolls away.
                                GradientStop{0.96, background},
                                GradientStop{1.0, background}});
    painter.FillRoundRect(Box{backdrop.x, backdrop.Bottom() - 2.0, backdrop.width, 3.0}, 0.0, background);
}

void Scene::PaintHero(Painter& painter) const {
    const HeroData& data = heroes_[heroIndex_];
    const HeroBoxes boxes = HeroLayout();
    const TextStyle kickerStyle{metrics_.Rem(kHeroKickerFontRem), true};
    const bool notice = !data.body.empty();
    const bool watchFocused = ShowsFocus(kHeroPlayKey);
    const bool learnFocused = ShowsFocus(kHeroInfoKey);
    const Color white = Rgb(0xFFFFFF);
    const double titleAlpha = titleFade_.has_value() ? std::clamp(titleFade_->Value(clockMs_), 0.0, 1.0) : 1.0;

    if (notice) {
        const double padX = metrics_.Rem(1.8);
        const double padY = metrics_.Rem(1.5);
        const double cardRight =
            std::max({boxes.kicker.Right(), boxes.title.Right(), boxes.body.Right(), boxes.watch.Right(), boxes.learn.Right()});
        const double cardBottom = std::max(boxes.watch.Bottom(), boxes.learn.Bottom());
        const Box card{boxes.kicker.x - padX, boxes.kicker.y - padY, cardRight - boxes.kicker.x + 2.0 * padX,
                       cardBottom - boxes.kicker.y + 2.0 * padY};
        GlassStyle cardGlass;
        cardGlass.kind = GlassKind::Panel;
        cardGlass.reduceTransparency = tokens::reduceTransparency;
        cardGlass.tint = tokens::kSurface;
        painter.Glass(card, metrics_.Rem(1.25), cardGlass);

        painter.Text(boxes.kicker, data.itemId == "account-gate" ? "TVM" : "TVM STREAM", kickerStyle,
                     tokens::kAccentStrong);
        painter.Text(boxes.title, data.title, TextStyle{metrics_.Rem(kNoticeTitleRem), true, 700},
                     WithAlpha(tokens::kText, titleAlpha));
        painter.Paragraph(boxes.body, data.body, TextStyle{metrics_.Rem(1.125), false}, tokens::kTextMuted);
        DrawButton(painter, metrics_, boxes.watch, PlayLabel(),
                   ButtonLook{true, watchFocused, watchFocused ? std::max(EmphasisOf(kHeroPlayKey), 1.0) : EmphasisOf(kHeroPlayKey)});
        DrawButton(painter, metrics_, boxes.learn, InfoLabel(),
                   ButtonLook{false, learnFocused, learnFocused ? std::max(EmphasisOf(kHeroInfoKey), 1.0) : EmphasisOf(kHeroInfoKey)});
        return;
    }

    if (Streamy() && !kicker_.empty()) {
        painter.Text(Box{boxes.kicker.x, boxes.kicker.y, viewportWidth_ - 2.0 * boxes.kicker.x, boxes.kicker.height},
                     kicker_, TextStyle{metrics_.Rem(0.95), false, 500}, tokens::kTextMuted);
    }

    // 1. 72px Bold mixed-case hero title.
    painter.Text(boxes.title, data.title, TextStyle{metrics_.Rem(kHeroTitleFontRem), true, 700},
                 WithAlpha(tokens::kText, titleAlpha));

    // 2. 22px Regular metadata line ("Movie · Drama · 2h 6m · 4K").
    const std::string metaText = !data.meta.empty() ? data.meta : std::string(kDefaultMetaLabel);
    const TextStyle metaStyle{metrics_.Rem(kHeroMetaFontRem), false, 400};
    painter.Text(boxes.meta, metaText, metaStyle, WithAlpha(tokens::kTextMuted, titleAlpha));
    if (!brandWord_.empty()) {
        const double metaW = painter.MeasureText(metaText, metaStyle);
        const Color brand = brandColor_.value_or(kMarkColor);
        const Color shown = brand.r + brand.g + brand.b < 0.25 ? Rgb(0xFFFFFF) : brand;
        painter.Text(Box{boxes.meta.x + metaW + metrics_.Rem(1.0), boxes.meta.y, metrics_.Rem(14.0), boxes.meta.height},
                     brandWord_, TextStyle{metrics_.Rem(1.25), true, 750}, shown);
    }

    // 3. Glass Play pill (with play triangle glyph) and Details pill.
    const auto paintHeroPill = [&](const Box& rawBox, const std::string& label, const char* key, bool focused,
                                   bool withPlayGlyph) {
        // Hover and focus raise the pill a touch and light it; a press sinks it. Both ease, neither is dramatic.
        const double emphasis = EmphasisOf(key);
        const double press = PressOf(key);
        const bool still = tokens::reduceMotion;
        const double scale = still ? 1.0 : 1.0 + 0.06 * emphasis - 0.06 * press;
        const double lift = still ? 0.0 : metrics_.Rem(0.375) * emphasis * (1.0 - press);
        Box shape = ScaledAbout(rawBox, scale);
        shape.y -= lift;
        const double radius = shape.height / 2.0;

        GlassStyle glass;
        glass.kind = GlassKind::Pill;
        glass.focused = focused;
        glass.focusAmount = focused ? std::max(emphasis, 1e-3) : emphasis;
        glass.pressAmount = press;
        glass.focusPlate = true;
        glass.sweep = SweepOf(key);
        glass.reduceTransparency = tokens::reduceTransparency;
        glass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
        glass.ringOutset = metrics_.Rem(kFocusRingOffsetRem) + glass.ringWidth / 2.0;
        glass.ringColor = tokens::kFocusRing;
        painter.Glass(shape, radius, glass);

        // The label darkens as the plate brightens behind it.
        const Color ink = tokens::reduceTransparency ? tokens::kText : Mix(tokens::kText, kPlateInk, emphasis);
        const TextStyle labelStyle{metrics_.Rem(kHeroButtonFontRem), true, 600};
        const double textWidth = painter.MeasureText(label, labelStyle);
        if (withPlayGlyph) {
            const double glyphSize = metrics_.Rem(1.25);
            const double gap = metrics_.Rem(0.55);
            const double totalWidth = glyphSize + gap + textWidth;
            const double startX = shape.CenterX() - totalWidth / 2.0;
            const Box glyphBox{startX, shape.CenterY() - glyphSize / 2.0, glyphSize, glyphSize};
            painter.Path(glyphBox, 32.0, kPlayTrianglePath, PathStyle{ink, Color{0, 0, 0, 0}, 0.0, false});
            painter.Text(Box{glyphBox.Right() + gap, shape.y, textWidth + metrics_.Rem(1.0), shape.height}, label,
                         labelStyle, ink);
        } else {
            const double textX = shape.CenterX() - textWidth / 2.0;
            painter.Text(Box{textX, shape.y, textWidth + metrics_.Rem(1.0), shape.height}, label, labelStyle, ink);
        }
    };

    paintHeroPill(boxes.watch, PlayLabel(), kHeroPlayKey, watchFocused, true);
    paintHeroPill(boxes.learn, InfoLabel(), kHeroInfoKey, learnFocused, false);

    // 4. Carousel indicator dots when there is more than one hero title.
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
    if (Streamy()) {
        if (!HasLaneHeader()) return ChromeHeight();
        double bottom = ChromeHeight();
        if (const std::optional<Box> heading = LaneHeadingBox()) bottom = heading->Bottom();
        for (const HeaderItem& item : HeaderItems()) {
            bottom = std::max(bottom, item.box.Bottom());
            // Search keeps room for the rule under its field.
            if (item.key == kSearchFieldKey) bottom = std::max(bottom, item.box.Bottom() + metrics_.Rem(kSearchRuleGapRem) * 2.0);
        }
        return bottom + metrics_.Rem(kLaneGapRem);
    }
    if (style_ == SceneStyle::Page) return tops_.empty()
        ? metrics_.Rem(kSafeYRem + kPageRowTopRem + kButtonRowRem + 1.0)
        : TopBoxScreen(tops_.size() - 1).Bottom() + metrics_.Rem(1.0);
    if (style_ == SceneStyle::Search) return metrics_.Rem(kSafeYRem + kSearchFieldRem + 0.6);
    if (CompactViewport(viewportWidth_, viewportHeight_) && !tops_.empty())
        return TopBoxScreen(tops_.size() - 1).Bottom() + pageScroll_ + metrics_.Rem(1.0);
    return metrics_.Rem(kSafeYRem);
}

bool Scene::HasLaneHeader() const {
    return Streamy() && !HeroActive() && (!heading_.empty() || searchField_ || !pageButtons_.empty());
}

std::optional<Box> Scene::LaneHeadingBox() const {
    if (!Streamy() || HeroActive() || heading_.empty()) return std::nullopt;
    const double x = metrics_.Rem(kSafeXRem + (CompactViewport(viewportWidth_, viewportHeight_) ? 0.0 : kRailInsetRem));
    // Search gets more air under the chrome and a larger heading, as a television search page has.
    const double top = ChromeHeight() + metrics_.Rem(searchField_ ? 1.2 : 0.35);
    const double heading = kLaneHeadingRem * (searchField_ ? 1.15 : 1.0);
    const double height = metrics_.Rem((kicker_.empty() ? 0.0 : kLaneKickerRem * 1.6) + heading * 1.2);
    return Box{x, top, viewportWidth_ - 2.0 * x, height};
}

std::vector<Scene::HeaderItem> Scene::HeaderItems() const {
    std::vector<HeaderItem> items;
    if (!Streamy() || HeroActive()) return items;
    const double x = metrics_.Rem(kSafeXRem + (CompactViewport(viewportWidth_, viewportHeight_) ? 0.0 : kRailInsetRem));
    const double width = viewportWidth_ - 2.0 * x;
    double y = ChromeHeight() + metrics_.Rem(searchField_ ? 2.2 : 0.35);
    if (const std::optional<Box> heading = LaneHeadingBox()) y = heading->Bottom() + metrics_.Rem(0.5);
    if (searchField_) {
        // Search, as the Apple TV app's: the field is one line across the page, a large lens and large type, with no
        // box and no heading; a thin rule runs under it (PaintLaneHeader).
        items.push_back(HeaderItem{kSearchFieldKey, Box{x, y, width, metrics_.Rem(kSearchHeroRem)}, -1});
        y += metrics_.Rem(kSearchHeroRem) + metrics_.Rem(kSearchRuleGapRem) * 2.0;
    }
    // A segmented control's tabs sit side by side in one row, touching, centred under the field.
    const bool segmented = std::any_of(pageButtons_.begin(), pageButtons_.end(), [](const TopButton& b) { return b.segment; });
    if (segmented) {
        double total = 0.0;
        std::vector<double> widths;
        for (const TopButton& button : pageButtons_) {
            widths.push_back(metrics_.Rem(1.6 * 2.0) + static_cast<double>(button.label.size()) * 0.56 * metrics_.Rem(0.95));
            total += widths.back();
        }
        double left = searchField_ ? x : viewportWidth_ / 2.0 - total / 2.0;
        for (std::size_t i = 0; i < pageButtons_.size(); ++i) {
            items.push_back(HeaderItem{kPageButtonPrefix + std::to_string(i), Box{left, y, widths[i], metrics_.Rem(kSegmentRem)},
                                       static_cast<int>(i)});
            left += widths[i];
        }
        return items;
    }
    FlowLayout flow(x, y, width, metrics_.Rem(0.75));
    for (std::size_t i = 0; i < pageButtons_.size(); ++i) {
        items.push_back(HeaderItem{kPageButtonPrefix + std::to_string(i),
                                   flow.Place(metrics_.Rem(PageButtonWidthRem(pageButtons_[i])), metrics_.Rem(kLaneButtonRem)),
                                   static_cast<int>(i)});
    }
    return items;
}

std::optional<std::size_t> Scene::HeaderIndexOf(const std::string& key) const {
    if (key != kSearchFieldKey && key.rfind(kPageButtonPrefix, 0) != 0) return std::nullopt;
    const std::vector<HeaderItem> items = HeaderItems();
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (items[i].key == key) return i;
    }
    return std::nullopt;
}

void Scene::FadeContentIn(double nowMs) {
    if (motion::PrefersReducedMotion(motion_)) {
        contentFade_.reset();
        return;
    }
    contentFade_ = motion::Tween(0.0, 1.0, nowMs, kHeroDissolveMs, kHeroEase);
}

void Scene::PaintLaneHeader(Painter& painter) const {
    // A band of the page's own ground under the chrome and the header, so the rails scroll away beneath them.
    const double bottom = HeaderTop() + (status_.empty() ? 0.0 : metrics_.Rem(kStatusRowRem));
    const double fadeRem = 1.25;
    painter.FillRoundRect(Box{0.0, 0.0, viewportWidth_, std::max(0.0, bottom - metrics_.Rem(fadeRem))}, 0.0,
                          tokens::kBackground);
    painter.FillLinearGradient(Box{0.0, bottom - metrics_.Rem(fadeRem), viewportWidth_, metrics_.Rem(fadeRem)}, 0.0,
                               bottom - metrics_.Rem(fadeRem), 0.0, bottom,
                               {GradientStop{0.0, tokens::kBackground}, GradientStop{1.0, WithAlpha(tokens::kBackground, 0.0)}});

    if (const std::optional<Box> heading = LaneHeadingBox()) {
        double y = heading->y;
        if (!kicker_.empty()) {
            painter.Text(Box{heading->x, y, heading->width, metrics_.Rem(kLaneKickerRem * 1.6)}, ToUpperAscii(kicker_),
                         TextStyle{metrics_.Rem(kLaneKickerRem), true, 700}, tokens::kTextFaint);
            y += metrics_.Rem(kLaneKickerRem * 1.6);
        }
        const TextStyle headingStyle{metrics_.Rem(searchField_ ? kLaneHeadingRem * 1.15 : kLaneHeadingRem), true, 750};
        // On Search the heading is centred over the field.
        const double headingX = searchField_
                                    ? viewportWidth_ / 2.0 - painter.MeasureText(heading_, headingStyle) / 2.0
                                    : heading->x;
        painter.Text(Box{headingX, y, heading->width, metrics_.Rem(kLaneHeadingRem * (searchField_ ? 1.15 : 1.0) * 1.2)},
                     heading_, headingStyle,
                     tokens::kText);
    }

    for (const HeaderItem& item : HeaderItems()) {
        const bool focused = ShowsFocus(item.key);
        const double emphasis = EmphasisOf(item.key);
        if (item.button < 0) {
            PaintSearchField(painter, item.box, focus_.Focused() == std::optional<std::string>(item.key), emphasis);
            continue;
        }
        const TopButton& button = pageButtons_[static_cast<std::size_t>(item.button)];
        if (button.segment) {
            // The segmented control, drawn as the Home navigation pill draws its tabs: one resting capsule round them
            // all (painted with the first tab), the light plate under the chosen one, the hover plate under the one
            // the pointer or the remote is on, and dark ink on a plate.
            if (item.button == 0 || !pageButtons_[static_cast<std::size_t>(item.button) - 1].segment) {
                double right = item.box.Right();
                for (const HeaderItem& other : HeaderItems()) {
                    if (other.button >= 0 && pageButtons_[static_cast<std::size_t>(other.button)].segment) {
                        right = std::max(right, other.box.Right());
                    }
                }
                const double pad = metrics_.Rem(0.3);
                const Box capsule{item.box.x - pad, item.box.y - pad, right - item.box.x + 2.0 * pad, item.box.height + 2.0 * pad};
                painter.Glass(capsule, capsule.height / 2.0, glass::NavCapsule());
            }
            const double hover = focused ? std::max(emphasis, 1e-3) : emphasis;
            if (button.on) painter.Glass(item.box, item.box.height / 2.0, glass::NavSelected());
            else if (hover > 0.01) painter.Glass(item.box, item.box.height / 2.0, glass::NavHover(hover));
            const TextStyle style{metrics_.Rem(0.95), true, button.on ? 700 : 600};
            const double textWidth = painter.MeasureText(button.label, style);
            painter.Text(Box{item.box.CenterX() - textWidth / 2.0, item.box.y, textWidth + 2.0, item.box.height},
                         button.label, style, glass::InkOnPlate(button.on ? 1.0 : hover));
            continue;
        }
        DrawButton(painter, metrics_, item.box, button.label,
                   ButtonLook{button.on, focused, focused ? std::max(emphasis, 1e-3) : emphasis});
    }
}

void Scene::PaintSearchExtras(Painter& painter) const {
    if (!rails_.empty()) return;
    const double top = HeaderTop() + metrics_.Rem(kStatusRowRem) + metrics_.Rem(1.0);
    const double x = metrics_.Rem(kSafeXRem + (CompactViewport(viewportWidth_, viewportHeight_) ? 0.0 : kRailInsetRem));
    if (loading_) {
        // Placeholder posters, breathing gently, where the results will land.
        const double width = metrics_.Rem(kPosterWidthRem);
        const double height = metrics_.Rem(kPosterHeightRem);
        const double gap = metrics_.Rem(kRailSpacingRem);
        const double breath = motion::PrefersReducedMotion(motion_) ? 0.5 : 0.5 + 0.5 * std::sin(clockMs_ / 520.0);
        const auto count = static_cast<int>(std::max(1.0, std::floor((viewportWidth_ - 2.0 * x + gap) / (width + gap))));
        for (int i = 0; i < count; ++i) {
            const Box poster{x + static_cast<double>(i) * (width + gap), top, width, height};
            if (poster.y > viewportHeight_) break;
            painter.FillRoundRect(poster, metrics_.Rem(0.7), WithAlpha(tokens::kText, 0.05 + 0.04 * breath));
            painter.FillRoundRect(Box{poster.x, poster.Bottom() + metrics_.Rem(0.6), width * 0.7, metrics_.Rem(0.8)},
                                  metrics_.Rem(0.4), WithAlpha(tokens::kText, 0.05 + 0.03 * breath));
        }
        return;
    }
    if (!query_.empty() && !status_.empty()) {
        // Nothing matched (or the search failed): a large, quiet lens under the message.
        const double mark = metrics_.Rem(4.0);
        painter.Path(Box{viewportWidth_ / 2.0 - mark / 2.0, top + metrics_.Rem(1.0), mark, mark}, 32.0, kSearchGlyph,
                     PathStyle{Color{0, 0, 0, 0}, WithAlpha(tokens::kText, 0.18), 1.8, false});
    }
}

void Scene::PaintSearchField(Painter& painter) const {
    // `.search-pill__bar`: glass search bar with magnifier and query/placeholder.
    const double x = metrics_.Rem(kSafeXRem);
    const Box field{x, metrics_.Rem(kSafeYRem), std::min(viewportWidth_ - 2.0 * x, metrics_.Rem(48.0)),
                    metrics_.Rem(kSearchFieldRem)};
    PaintSearchField(painter, field, true, 1.0);
}

void Scene::PaintSearchField(Painter& painter, const Box& field, bool active, double emphasis) const {
    // The search page's field: flat, as the Apple TV app's, a large lens and large type on one line.
    if (searchField_ && Streamy()) {
        const double glyph = metrics_.Rem(2.6);
        const double hover = active ? 1.0 : std::clamp(emphasis, 0.0, 1.0);
        const Color lens = Mix(tokens::kTextMuted, tokens::kText, hover);
        painter.Path(Box{field.x, field.CenterY() - glyph / 2.0, glyph, glyph}, 32.0, kSearchGlyph,
                     PathStyle{Color{0, 0, 0, 0}, lens, 2.6, false});
        const double textX = field.x + glyph + metrics_.Rem(1.3);
        const TextStyle style{metrics_.Rem(2.6), true, 650};
        const bool caretOn = motion::PrefersReducedMotion(motion_) || std::fmod(clockMs_, kCaretBlinkMs) < kCaretBlinkMs / 2.0;
        const TextStyle hintStyle{metrics_.Rem(1.2), false, 500};
        if (query_.empty()) {
            painter.Text(Box{textX, field.y, field.Right() - textX - metrics_.Rem(16.0), field.height},
                         "Movies, Series, and More", style, WithAlpha(tokens::kText, 0.34 + 0.12 * hover));
            if (active && caretOn) {
                painter.FillRoundRect(Box{textX - 2.0, field.y + field.height * 0.22, 3.0, field.height * 0.56}, 1.5,
                                      tokens::kAccentStrong);
            }
            // On a computer the keyboard is the way in, so the hint says so (the TV app offers dictation here).
            const std::string hint = active ? "Start typing" : "Type to search";
            const double hintWidth = painter.MeasureText(hint, hintStyle);
            painter.Text(Box{field.Right() - hintWidth - 2.0, field.y, hintWidth + 4.0, field.height}, hint, hintStyle,
                         WithAlpha(tokens::kText, 0.38));
        } else {
            const double width = painter.MeasureText(query_, style);
            painter.Text(Box{textX, field.y, field.Right() - textX - metrics_.Rem(3.5), field.height}, query_, style,
                         tokens::kText);
            if (active && caretOn) {
                const double caretX = std::min(textX + width + 3.0, field.Right() - metrics_.Rem(3.5));
                painter.FillRoundRect(Box{caretX, field.y + field.height * 0.22, 3.0, field.height * 0.56}, 1.5,
                                      tokens::kAccentStrong);
            }
            // Clear, at the end of the line.
            const double mark = metrics_.Rem(1.1);
            painter.Path(Box{field.Right() - metrics_.Rem(1.4) - mark / 2.0, field.CenterY() - mark / 2.0, mark, mark},
                         32.0, "M7 7l18 18M25 7L7 25", PathStyle{Color{0, 0, 0, 0}, tokens::kTextMuted, 3.0, false});
        }
        // The rule under the line, brightening to the accent while the field takes typing.
        const double ruleY = field.Bottom() + metrics_.Rem(kSearchRuleGapRem);
        painter.FillRoundRect(Box{field.x, ruleY, field.width, active ? 2.0 : 1.0}, 0.0,
                              active ? WithAlpha(tokens::kAccentStrong, 0.75) : WithAlpha(tokens::kText, 0.14));
        return;
    }

    GlassStyle glass;
    glass.kind = GlassKind::Pill;
    glass.focused = active;
    glass.focusAmount = active ? 1.0 : std::clamp(emphasis, 0.0, 1.0) * 0.6;
    glass.reduceTransparency = tokens::reduceTransparency;
    glass.tint = tokens::kSurface;
    glass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
    glass.ringColor = tokens::kFocusRing;
    painter.Glass(field, field.height / 2.0, glass);

    const double glyph = metrics_.Rem(1.4);
    painter.Path(Box{field.x + metrics_.Rem(1.0), field.CenterY() - glyph / 2.0, glyph, glyph}, 32.0, kSearchGlyph,
                 PathStyle{Color{0, 0, 0, 0}, active ? tokens::kText : tokens::kTextMuted, 2.4, false});
    const double textX = field.x + metrics_.Rem(3.0);
    const TextStyle style{metrics_.Rem(1.25), false, 500};
    if (query_.empty()) {
        painter.Text(Box{textX, field.y, field.Right() - textX, field.height},
                     searchField_ ? "Search films and series" : "Title or https://\xE2\x80\xA6", style, tokens::kTextFaint);
        if (active) {
            painter.FillRoundRect(Box{textX - 1.0, field.y + field.height * 0.28, 2.0, field.height * 0.44}, 0.0,
                                  tokens::kText);
        }
    } else {
        const double width = painter.MeasureText(query_, style);
        painter.Text(Box{textX, field.y, field.Right() - textX - metrics_.Rem(3.0), field.height}, query_, style,
                     tokens::kText);
        // The caret, after the last letter, while typing goes into the field.
        if (active) {
            const double caretX = std::min(textX + width + 2.0, field.Right() - metrics_.Rem(3.0));
            painter.FillRoundRect(Box{caretX, field.y + field.height * 0.25, 2.0, field.height * 0.5}, 0.0,
                                  tokens::kText);
        }
        // A clear mark at the end of a field with something in it.
        if (searchField_) {
            const double mark = metrics_.Rem(0.9);
            painter.Path(Box{field.Right() - metrics_.Rem(1.6) - mark / 2.0, field.CenterY() - mark / 2.0, mark, mark},
                         32.0, "M7 7l18 18M25 7L7 25", PathStyle{Color{0, 0, 0, 0}, tokens::kTextMuted, 3.0, false});
        }
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
    painter.Text(Box{x, top + metrics_.Rem(1.1), viewportWidth_ - 2.0 * x, metrics_.Rem(3.4)}, heading_,
                 TextStyle{metrics_.Rem(3.0), true, 700}, tokens::kText);
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const bool focused = ShowsFocus(TopKey(i));
        // A chosen filter is the primary button, as the web marks it with variant=primary.
        const double emphasis = EmphasisOf(TopKey(i));
        DrawButton(painter, metrics_, TopBoxScreen(i), tops_[i].label,
                   ButtonLook{tops_[i].on, focused, focused ? std::max(emphasis, 1e-3) : emphasis});
    }
}

double Scene::ChromeHeight() const {
    if (tops_.empty()) return metrics_.Rem(kChromePadTopRem + kChromeLinkHeightRem + kChromePadBottomRem);
    double maxBottom = 0.0;
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        maxBottom = std::max(maxBottom, TopBoxScreen(i).Bottom());
    }
    return maxBottom + metrics_.Rem(kChromePadBottomRem);
}

void Scene::PaintStreamChrome(Painter& painter) const {
    // Subtle top scrim so the glass capsule and wordmark float cleanly over full-bleed hero photography,
    // deepening when the page scrolls down.
    const double height = ChromeHeight() + metrics_.Rem(2.5);
    const double scrollAlpha = std::clamp(pageScroll_ / std::max(1.0, metrics_.Rem(8.0)), 0.0, 1.0);
    const double topAlpha = 0.36 + 0.62 * scrollAlpha;
    const double midAlpha = 0.16 + 0.76 * scrollAlpha;
    painter.FillLinearGradient(Box{0.0, 0.0, viewportWidth_, height}, 0.0, 0.0, 0.0, height,
                               {GradientStop{0.0, WithAlpha(tokens::kBackground, topAlpha)},
                                GradientStop{0.66, WithAlpha(tokens::kBackground, midAlpha)},
                                GradientStop{1.0, WithAlpha(tokens::kBackground, 0.0)}});

    const bool compact = CompactViewport(viewportWidth_, viewportHeight_);
    const double safeX = metrics_.Rem(kSafeXRem + (compact ? 0.0 : kRailInsetRem));
    const double topY = metrics_.Rem(kChromePadTopRem);
    const double tabHeight = metrics_.Rem(kChromeLinkHeightRem);

    // The entrance plays once, from the first frame the chrome is seen: the glass bar settles in, its labels
    // follow one by one, and the selected tab's glass arrives last. Without an entrance every stage is 1.
    if (chromeEntrancePending_ && !chromeEntranceStart_.has_value() && !motion::PrefersReducedMotion(motion_) &&
        !tokens::reduceMotion) {
        chromeEntranceStart_ = clockMs_;
    }
    const double barStage = EntranceStage(0.0, 340.0);
    const double orbStage = EntranceStage(70.0, 340.0);
    const double indicatorStage = EntranceStage(330.0, 330.0);
    const double barRise = metrics_.Rem(0.5) * (1.0 - barStage);

    // 1. Outer centred glass capsule enclosing all navigation tabs (!lockup && !orb).
    bool hasCapsuleTabs = false;
    bool hasLockup = false;
    bool hasOrb = false;
    double minX = 1e18, minY = 1e18, maxR = -1e18, maxB = -1e18;
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        if (tops_[i].lockup) {
            hasLockup = true;
            continue;
        }
        if (tops_[i].orb) {
            hasOrb = true;
            continue;
        }
        const Box b = TopBoxScreen(i);
        minX = std::min(minX, b.x);
        minY = std::min(minY, b.y);
        maxR = std::max(maxR, b.Right());
        maxB = std::max(maxB, b.Bottom());
        hasCapsuleTabs = true;
    }
    if (hasCapsuleTabs && barStage > 0.0) {
        const double pad = metrics_.Rem(kCapsulePadRem);
        Box capsule = ScaledAbout(Box{minX - pad, minY - pad, (maxR - minX) + 2.0 * pad, (maxB - minY) + 2.0 * pad},
                                  0.96 + 0.04 * barStage);
        capsule.y -= barRise;
        GlassStyle capsuleGlass;
        capsuleGlass.kind = GlassKind::Pill;
        capsuleGlass.reduceTransparency = tokens::reduceTransparency;
        capsuleGlass.opacity = barStage;
        painter.Glass(capsule, capsule.height / 2.0, capsuleGlass);
    }

    // 2. Top-left TVM wordmark (drawn as static brand mark when no lockup button is in tops_).
    if (!hasLockup && !compact) {
        painter.Text(Box{safeX, topY - metrics_.Rem(0.25), metrics_.Rem(7.5), tabHeight + metrics_.Rem(0.5)}, "TVM",
                     TextStyle{metrics_.Rem(kWordmarkFontRem), true, 800}, Faded(tokens::kText, barStage));
    }

    // 3. Top-right profile orb (drawn as ambient profile orb when no orb button is in tops_).
    if (!hasOrb && !compact && orbStage > 0.0) {
        const double orbSize = metrics_.Rem(kOrbSizeRem);
        const Box orbBox{viewportWidth_ - safeX - orbSize, topY + (tabHeight - orbSize) / 2.0, orbSize, orbSize};
        GlassStyle orbGlass;
        orbGlass.kind = GlassKind::Orb;
        orbGlass.reduceTransparency = tokens::reduceTransparency;
        orbGlass.opacity = orbStage;
        painter.Glass(orbBox, orbSize / 2.0, orbGlass);
        const TextStyle orbText{metrics_.Rem(1.35), true, 700};
        const double w = painter.MeasureText("P", orbText);
        painter.Text(Box{orbBox.CenterX() - w / 2.0, orbBox.y, w + 4.0, orbBox.height}, "P", orbText,
                     Faded(tokens::kText, orbStage));
    }

    // 4. The selected tab: its own lighter piece of glass, sliding between tabs when the selection changes.
    const std::optional<Box> indicator = TabIndicatorBox();
    if (indicator.has_value() && indicatorStage > 0.0) {
        const std::string key = TopKey(*activeTab_);
        const bool focused = ShowsFocus(key);
        const double emphasis = EmphasisOf(key);
        const double press = PressOf(key);
        const double scale = tokens::reduceMotion
                                 ? 1.0
                                 : (0.9 + 0.1 * indicatorStage) * (1.0 + 0.02 * emphasis - 0.035 * press);
        Box shape = ScaledAbout(*indicator, scale);
        shape.y -= barRise;
        GlassStyle tabGlass;
        tabGlass.kind = GlassKind::Tab;
        tabGlass.activeTab = true;
        tabGlass.focused = focused;
        tabGlass.focusAmount = focused ? std::max(emphasis, 1e-3) : emphasis;
        tabGlass.pressAmount = press;
        tabGlass.opacity = indicatorStage;
        tabGlass.reduceTransparency = tokens::reduceTransparency;
        tabGlass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
        tabGlass.ringOutset = metrics_.Rem(0.08);
        tabGlass.ringColor = tokens::kFocusRing;
        painter.Glass(shape, shape.height / 2.0, tabGlass);
    }

    // 5. Individual buttons: lockup wordmark, hover glass and labels of the capsule tabs, and the profile orb.
    std::size_t labelOrder = 0;
    for (std::size_t i = 0; i < tops_.size(); ++i) {
        const Box box = TopBoxScreen(i);
        const std::string key = TopKey(i);
        const bool focused = ShowsFocus(key);
        const double emphasis = EmphasisOf(key);
        const double press = PressOf(key);
        if (tops_[i].lockup) {
            if (focused) {
                GlassStyle lockupGlass;
                lockupGlass.kind = GlassKind::Tab;
                lockupGlass.focused = true;
                lockupGlass.focusAmount = std::max(emphasis, 1e-3);
                lockupGlass.reduceTransparency = tokens::reduceTransparency;
                painter.Glass(box, box.height / 2.0, lockupGlass);
            }
            painter.Text(Box{box.x + (focused ? metrics_.Rem(0.6) : 0.0), box.y, box.width, box.height},
                         ToUpperAscii(tops_[i].label), TextStyle{metrics_.Rem(kWordmarkFontRem), true, 800},
                         Faded(tokens::kText, barStage));
            continue;
        }
        if (tops_[i].orb) {
            if (orbStage <= 0.0) continue;
            // The orb answers hover and press as the other glass does, and never grows past the bar's weight.
            const double scale =
                tokens::reduceMotion ? 1.0 : (0.94 + 0.06 * orbStage) * (1.0 + 0.05 * emphasis - 0.06 * press);
            Box orbShape = ScaledAbout(box, scale);
            orbShape.y -= barRise;
            GlassStyle orbGlass;
            orbGlass.kind = GlassKind::Orb;
            orbGlass.focused = focused;
            orbGlass.focusAmount = focused ? std::max(emphasis, 1e-3) : emphasis;
            orbGlass.pressAmount = press;
            orbGlass.focusPlate = true;
            orbGlass.sweep = SweepOf(key);
            orbGlass.opacity = orbStage;
            orbGlass.reduceTransparency = tokens::reduceTransparency;
            orbGlass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
            orbGlass.ringOutset = metrics_.Rem(kFocusRingOffsetRem);
            orbGlass.ringColor = tokens::kFocusRing;
            painter.Glass(orbShape, orbShape.height / 2.0, orbGlass);

            std::string initial = tops_[i].label.empty() ? "P" : tops_[i].label.substr(0, 1);
            if (initial[0] >= 'a' && initial[0] <= 'z') initial[0] = static_cast<char>(initial[0] - 'a' + 'A');
            const TextStyle orbText{metrics_.Rem(1.35), true, 700};
            const double tw = painter.MeasureText(initial, orbText);
            const Color orbInk = tokens::reduceTransparency ? tokens::kText : Mix(tokens::kText, kPlateInk, emphasis);
            painter.Text(Box{orbShape.CenterX() - tw / 2.0, orbShape.y, tw + 4.0, orbShape.height}, initial, orbText,
                         Faded(orbInk, orbStage));
            continue;
        }

        // Capsule navigation tab (Home · Movies · Series · Live TV · Library · Search).
        const double labelStage = EntranceStage(110.0 + 30.0 * static_cast<double>(labelOrder++), 280.0);
        // How much of the selected glass sits under this label, so its colour follows the glass as it slides.
        double under = 0.0;
        if (indicator.has_value()) {
            under = std::clamp(1.0 - std::fabs(indicator->CenterX() - box.CenterX()) / (box.width * 0.8), 0.0, 1.0) *
                    indicatorStage;
        }
        // A tab that is not selected shows hover as a faint glass of its own, fading in and out.
        // The selected tab's hover plate gives way to the sliding glass, so its label follows the glass alone.
        const bool selectedTab = activeTab_.has_value() && *activeTab_ == i;
        const double hover = selectedTab ? 0.0 : emphasis * (1.0 - under);
        if (hover > 0.01) {
            Box tabShape = ScaledAbout(box, tokens::reduceMotion ? 1.0 : 1.0 + 0.04 * emphasis - 0.05 * press);
            tabShape.y -= barRise;
            GlassStyle tabGlass;
            tabGlass.kind = GlassKind::Tab;
            tabGlass.focused = focused;
            tabGlass.focusAmount = focused ? std::max(emphasis, 1e-3) : emphasis;
            tabGlass.pressAmount = press;
            tabGlass.focusPlate = true;
            tabGlass.sweep = SweepOf(key);
            tabGlass.opacity = hover * barStage;
            tabGlass.reduceTransparency = tokens::reduceTransparency;
            tabGlass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
            tabGlass.ringOutset = metrics_.Rem(0.08);
            tabGlass.ringColor = tokens::kFocusRing;
            painter.Glass(tabShape, tabShape.height / 2.0, tabGlass);
        }

        const bool strong = tops_[i].on || focused;
        const TextStyle tabStyle{metrics_.Rem(kChromeFontRem), strong, strong ? 650 : kChromeWeight};
        const double textWidth = painter.MeasureText(tops_[i].label, tabStyle);
        const double textX = std::max(box.x + metrics_.Rem(0.5), box.CenterX() - textWidth / 2.0);
        // Clear glass lets bright artwork through, so resting labels sit closer to full white than muted grey,
        // and in the dark theme a soft shadow keeps them legible over a white sky or a light branch.
        const Color resting = Mix(Mix(tokens::kTextMuted, tokens::kText, 0.55), tokens::kText, emphasis);
        // On the selected glass, or on a hovered tab's bright plate, the label is dark.
        const double plated = tokens::reduceTransparency ? under : std::max(under, hover);
        const Color textColor = Faded(Mix(resting, tokens::kOnPrimary, plated), labelStage);
        const double textRise = barRise + metrics_.Rem(0.3) * (1.0 - labelStage);
        const Box labelBox{textX, box.y - textRise, textWidth + metrics_.Rem(0.8), box.height};
        const bool lightTheme = tokens::kBackground.r + tokens::kBackground.g + tokens::kBackground.b > 1.5;
        if (!lightTheme && plated < 0.99) {
            const Color shade = Rgb(0x000000, 0.42 * (1.0 - plated) * labelStage);
            painter.Text(Box{labelBox.x, labelBox.y + 1.0, labelBox.width, labelBox.height}, tops_[i].label, tabStyle,
                         shade);
            painter.Text(Box{labelBox.x + 0.6, labelBox.y + 1.6, labelBox.width, labelBox.height}, tops_[i].label,
                         tabStyle, Faded(shade, 0.5));
        }
        painter.Text(labelBox, tops_[i].label, tabStyle, textColor);
    }
}

Box Scene::TopBoxScreen(std::size_t index) const {
    if (style_ == SceneStyle::Page) {
        // `.collection-controls`: a row of buttons under the heading, left to right, fixed while the page scrolls.
        const double x = metrics_.Rem(kSafeXRem);
        FlowLayout flow(x, metrics_.Rem(kSafeYRem + kPageRowTopRem), viewportWidth_ - 2.0 * x,
                        metrics_.Rem(kButtonGapRowRem));
        Box box;
        for (std::size_t i = 0; i <= index && i < tops_.size(); ++i)
            box = flow.Place(metrics_.Rem(PageButtonWidthRem(tops_[i])), metrics_.Rem(kButtonRowRem));
        return box;
    }
    if (Streamy()) {
        const bool compact = CompactViewport(viewportWidth_, viewportHeight_);
        const double safeX = metrics_.Rem(kSafeXRem + (compact ? 0.0 : kRailInsetRem));
        const double topY = metrics_.Rem(kChromePadTopRem);
        const double height = compact ? std::max(44.0, metrics_.Rem(kChromeLinkHeightRem))
                                      : metrics_.Rem(kChromeLinkHeightRem);
        if (compact) {
            FlowLayout flow(safeX, topY, viewportWidth_ - 2.0 * safeX, metrics_.Rem(kChromeGapRem));
            Box box;
            for (std::size_t i = 0; i <= index && i < tops_.size(); ++i)
                box = flow.Place(metrics_.Rem(ChromeLinkWidthRem(tops_[i])), height);
            return box;
        }
        if (index < tops_.size() && tops_[index].lockup) {
            return Box{safeX, topY, metrics_.Rem(ChromeLinkWidthRem(tops_[index])), height};
        }
        if (index < tops_.size() && tops_[index].orb) {
            const double orbSize = metrics_.Rem(kOrbSizeRem);
            return Box{viewportWidth_ - safeX - orbSize, topY + (height - orbSize) / 2.0, orbSize, orbSize};
        }
        // Centred glass capsule tabs.
        const double gap = metrics_.Rem(kChromeGapRem);
        double totalWidth = 0.0;
        std::size_t tabCount = 0;
        for (const TopButton& b : tops_) {
            if (b.lockup || b.orb) continue;
            totalWidth += metrics_.Rem(ChromeLinkWidthRem(b));
            ++tabCount;
        }
        if (tabCount > 1) totalWidth += gap * static_cast<double>(tabCount - 1);
        double cursorX = std::max(safeX + metrics_.Rem(5.5), (viewportWidth_ - totalWidth) / 2.0);
        Box box{cursorX, topY, 0.0, height};
        for (std::size_t i = 0; i <= index && i < tops_.size(); ++i) {
            if (tops_[i].lockup || tops_[i].orb) continue;
            const double w = metrics_.Rem(ChromeLinkWidthRem(tops_[i]));
            box = Box{cursorX, topY, w, height};
            cursorX += w + gap;
        }
        return box;
    }
    // The buttons sit in the header row, at the top right, and go leftwards in order. They scroll with the page.
    const double width = std::min(metrics_.Rem(kTopButtonWidthRem), std::max(1.0, viewportWidth_ - 2.0 * metrics_.Rem(kSafeXRem)));
    const double height = metrics_.Rem(kTopButtonHeightRem);
    const double step = width + metrics_.Rem(kTopButtonGapRem);
    const std::size_t columns = std::max(std::size_t{1}, static_cast<std::size_t>(
        std::max(1.0, viewportWidth_ - 2.0 * metrics_.Rem(kSafeXRem) + metrics_.Rem(kTopButtonGapRem)) / step));
    const double x = viewportWidth_ - metrics_.Rem(kSafeXRem) - width - static_cast<double>(index % columns) * step;
    return Box{x, metrics_.Rem(kSafeYRem) + static_cast<double>(index / columns) * (height + metrics_.Rem(kTopButtonGapRem)) - pageScroll_, width, height};
}

void Scene::Layout(double width, double height) {
    viewportWidth_ = width;
    viewportHeight_ = height;
    metrics_.rem = ViewportRem(width, height);

    // The hero takes the top of the window, and the rails start below it.
    const double heroFraction = Streamy() ? 0.425 : kHeroHeightFraction;
    const double heroGapRem = Streamy() ? 0.5 : kHeroRailGapRem;
    heroHeight_ = HeroActive() ? std::max(heroFraction * height,
        (CompactViewport(width, height) ? HeaderTop() + metrics_.Rem(24.0) : 0.0)) : 0.0;
    pageTopOffset_ = HeroActive() ? heroHeight_ + metrics_.Rem(heroGapRem)
                                 : std::max(0.0, HeaderTop() - metrics_.Rem(kSafeYRem));

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

    // Header items come and go with the page, so ones no longer there leave the tree.
    for (std::size_t i = pageButtons_.size(); i < 32; ++i) {
        const std::string stale = kPageButtonPrefix + std::to_string(i);
        if (focus_.Contains(stale)) focus_.Remove(stale);
    }
    if ((!searchField_ || HeroActive()) && focus_.Contains(kSearchFieldKey)) focus_.Remove(kSearchFieldKey);
    for (const HeaderItem& item : HeaderItems()) {
        nav::FocusNode node;
        node.key = item.key;
        node.parent = kPageKey;
        node.rect = nav::Rect{item.box.x, item.box.y, item.box.Right(), item.box.Bottom()};
        focus_.Upsert(node);
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
    const bool contentFading = contentFade_.has_value() && !contentFade_->Done(clockMs_);
    const bool arrowsFading = arrowRail_.has_value() && !arrowFade_.Done(clockMs_);
    // The search field's caret blinks while the field has the focus.
    const bool caretBlinking = searchField_ && Streamy() && focus_.Focused() == std::optional<std::string>(kSearchFieldKey) &&
                               !motion::PrefersReducedMotion(motion_);
    // The search placeholders breathe while a search runs.
    const bool searching = loading_ && searchField_ && rails_.empty() && !motion::PrefersReducedMotion(motion_);
    return timeline_.size() > 0 || CameraActive() || titleMoving || pictureMoving || contentFading ||
           ControlsAnimating() || searching || arrowsFading || caretBlinking;
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
        std::vector<std::size_t> indices;
        for (std::size_t i = 0; i < tops_.size(); ++i) {
            if (Streamy() && (tops_[i].lockup || tops_[i].orb)) continue;
            centers.push_back(TopBoxScreen(i).CenterX());
            indices.push_back(i);
        }
        if (centers.empty()) {
            for (std::size_t i = 0; i < tops_.size(); ++i) {
                centers.push_back(TopBoxScreen(i).CenterX());
                indices.push_back(i);
            }
        }
        const int closest = nav::PickClosestIndex(centers, from.CenterX());
        return TopKey(closest < 0 ? 0 : indices[static_cast<std::size_t>(closest)]);
    };

    // The nearest header item above or below a box, for Up and Down through a page's header.
    const std::vector<HeaderItem> header = HeaderItems();
    const auto headerToward = [&](const Box& from, bool down) -> std::optional<std::string> {
        std::optional<std::string> best;
        double score = 1e18;
        for (const HeaderItem& item : header) {
            const double dy = item.box.CenterY() - from.CenterY();
            if (std::abs(dy) < 4.0 || (dy > 0.0) != down) continue;
            const double distance = std::abs(dy) * 1000.0 + std::abs(item.box.CenterX() - from.CenterX());
            if (distance < score) {
                best = item.key;
                score = distance;
            }
        }
        return best;
    };
    const auto firstRailCard = [&](const Box& from) -> std::optional<std::string> {
        if (rails_.empty()) return std::nullopt;
        std::vector<double> centers;
        for (const auto& child : rails_[0]->children()) centers.push_back(child->box().CenterX());
        const int closest = nav::PickClosestIndex(centers, from.CenterX());
        if (closest < 0) return std::nullopt;
        return cards_[GlobalIndex(0, static_cast<std::size_t>(closest))].key;
    };

    if (const std::optional<std::size_t> at = HeaderIndexOf(*focused)) {
        const Box from = header[*at].box;
        if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
            const bool next = direction == nav::Direction::Right;
            if (next && *at + 1 < header.size()) {
                FocusKey(header[*at + 1].key, nowMs, true);
                return true;
            }
            if (!next && *at > 0) {
                FocusKey(header[*at - 1].key, nowMs, true);
                return true;
            }
            return false;
        }
        const bool down = direction == nav::Direction::Down;
        if (const std::optional<std::string> row = headerToward(from, down)) {
            FocusKey(*row, nowMs, true);
            return true;
        }
        if (!down) {
            if (tops_.empty()) return false;
            FocusKey(topAbove(from), nowMs, true);
            return true;
        }
        if (const std::optional<std::string> card = firstRailCard(from)) {
            FocusKey(*card, nowMs, true);
            return true;
        }
        return false;
    }

    // The hero's two glass pills (Play and Details) sit side by side, both for regular titles and notices.
    if (HeroActive() && IsHeroKey(*focused)) {
        const bool onPlay = *focused == kHeroPlayKey;
        const HeroBoxes boxes = HeroLayout();
        const bool stacked = std::abs(boxes.watch.CenterY() - boxes.learn.CenterY()) > 4.0;
        if (!stacked) {
            if (direction == nav::Direction::Right && onPlay) {
                FocusKey(kHeroInfoKey, nowMs, true);
                return true;
            }
            if (direction == nav::Direction::Left && !onPlay) {
                FocusKey(kHeroPlayKey, nowMs, true);
                return true;
            }
        } else {
            if (direction == nav::Direction::Down && onPlay) {
                FocusKey(kHeroInfoKey, nowMs, true);
                return true;
            }
            if (direction == nav::Direction::Up && !onPlay) {
                FocusKey(kHeroPlayKey, nowMs, true);
                return true;
            }
        }
        if (direction == nav::Direction::Up && !tops_.empty()) {
            FocusKey(topAbove(onPlay ? boxes.watch : boxes.learn), nowMs, true);
            return true;
        }
        if (direction != nav::Direction::Down || rails_.empty()) return false;
        std::vector<double> centers;
        for (const auto& child : rails_[0]->children()) centers.push_back(child->box().CenterX());
        const int closest = nav::PickClosestIndex(centers, (onPlay ? boxes.watch : boxes.learn).CenterX());
        if (closest < 0) return false;
        FocusKey(cards_[GlobalIndex(0, static_cast<std::size_t>(closest))].key, nowMs, true);
        return true;
    }

    if (const std::optional<std::size_t> top = TopIndexOf(*focused)) {
        // Wrapped navigation has real rows; Up/Down first moves through them.
        if (RowTops() && (direction == nav::Direction::Up || direction == nav::Direction::Down)) {
            const Box fromBox = TopBoxScreen(*top);
            std::optional<std::size_t> best;
            double score = 1e18;
            for (std::size_t i = 0; i < tops_.size(); ++i) {
                const Box box = TopBoxScreen(i);
                const double dy = box.CenterY() - fromBox.CenterY();
                if (std::abs(dy) < 12.0 || (dy > 0.0) != (direction == nav::Direction::Down)) continue;
                const double distance = std::abs(dy) * 1000.0 + std::abs(box.CenterX() - fromBox.CenterX());
                if (distance < score) { best = i; score = distance; }
            }
            if (best) { FocusKey(TopKey(*best), nowMs, true); return true; }
        }
        // Right and left move along the top buttons, with hard stops at both ends (no wrapping).
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
        // Down from the stream chrome goes to the page's header, when it has one.
        if (direction == nav::Direction::Down && !header.empty()) {
            const Box from = TopBoxScreen(*top);
            std::optional<std::string> nearest;
            double best = 1e18;
            const double firstRow = header.front().box.CenterY();
            for (const HeaderItem& item : header) {
                if (std::abs(item.box.CenterY() - firstRow) > 4.0) continue;
                const double dx = std::abs(item.box.CenterX() - from.CenterX());
                if (dx < best) {
                    best = dx;
                    nearest = item.key;
                }
            }
            if (nearest.has_value()) {
                FocusKey(*nearest, nowMs, true);
                return true;
            }
        }
        // Down from the stream chrome goes to the hero, which sits under it.
        if (direction == nav::Direction::Down && HeroActive()) {
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

    // Up from the top rail reaches the page's header, the hero Play button, or else the first top button.
    if (direction == nav::Direction::Up && current.rail == 0 && !header.empty()) {
        std::optional<std::string> nearest;
        double best = 1e18;
        double lowest = -1e18;
        for (const HeaderItem& item : header) lowest = std::max(lowest, item.box.CenterY());
        for (const HeaderItem& item : header) {
            if (std::abs(item.box.CenterY() - lowest) > 4.0) continue;
            const double dx = std::abs(item.box.CenterX() - current.card->box().CenterX());
            if (dx < best) {
                best = dx;
                nearest = item.key;
            }
        }
        if (nearest.has_value()) {
            FocusKey(*nearest, nowMs, true);
            return true;
        }
    }
    if (direction == nav::Direction::Up && current.rail == 0) {
        if (HeroActive()) {
            FocusKey(kHeroPlayKey, nowMs, true);
            return true;
        }
        if (tops_.empty()) return false;
        FocusKey(TopKey(0), nowMs, true);
        return true;
    }

    std::optional<std::size_t> target;
    if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
        // Infinite looping categories: wrap seamlessly at both rail ends.
        const std::size_t count = CardCount(current.rail);
        const std::optional<int> wrapped =
            nav::RowWrapIndex(static_cast<int>(current.index), direction, static_cast<int>(count));
        if (wrapped.has_value()) {
            target = GlobalIndex(current.rail, static_cast<std::size_t>(*wrapped));
        }
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

std::optional<Command> Scene::Select(double nowMs) {
    const std::optional<std::string> focused = focus_.Focused();
    if (!focused.has_value()) return std::nullopt;
    // OK on a button gives the same press as a click: the glass dips at once and eases back, while the
    // command goes out now.
    if (!cardByKey_.contains(*focused) && !motion::PrefersReducedMotion(motion_)) {
        pressKey_ = *focused;
        press_ = motion::Tween(1.0, 0.0, nowMs, kPressOutMs, kGlassEase);
    }

    if (const std::optional<std::size_t> top = TopIndexOf(*focused)) return tops_[*top].command;
    if (const std::optional<std::size_t> at = HeaderIndexOf(*focused)) {
        const HeaderItem item = HeaderItems()[*at];
        if (item.button >= 0) return pageButtons_[static_cast<std::size_t>(item.button)].command;
        // OK on the search field runs the search now.
        Command command;
        command.name = "search-submit";
        command.action = true;
        return command;
    }

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
    if (card.card->itemId().rfind("browse:", 0) == 0) {
        // A Browse tile on Search: the app shows that genre's titles.
        command.name = "search-browse";
        command.action = true;
        command.params["genre"] = card.card->itemId().substr(7);
        return command;
    }
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
    // A rail arrow is not a focus stop: the hover look is set by PointerAt.
    if (key.rfind("rail-", 0) == 0) return false;
    if (focus_.Focused() == std::optional<std::string>(key)) return false;
    if (TopIndexOf(key).has_value() || (HeroActive() && IsHeroKey(key)) || HeaderIndexOf(key).has_value()) {
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
    for (const HeaderItem& item : HeaderItems()) {
        if (!Contains(item.box, x, y)) continue;
        // The clear mark at the end of a field with something typed in it.
        if (item.button < 0 && !query_.empty() && x > item.box.Right() - metrics_.Rem(3.2)) return std::string("search-clear");
        return item.key;
    }
    // Under the header nothing scrolled beneath it can be picked.
    if (HasLaneHeader() && y < HeaderTop()) return std::nullopt;
    if (HeroActive()) {
        const HeroBoxes boxes = HeroLayout();
        if (Contains(boxes.watch, x, y)) return std::string(kHeroPlayKey);
        if (Contains(boxes.learn, x, y)) return std::string(kHeroInfoKey);
    }
    // A rail's arrows sit over its cards, so they are found first.
    if (arrowRail_.has_value() && arrowFade_.target() > 0.0) {
        for (const bool next : {false, true}) {
            const std::optional<Box> box = RailArrowBox(*arrowRail_, next);
            if (box.has_value() && Contains(*box, x, y)) {
                return std::string(next ? "rail-next:" : "rail-prev:") + std::to_string(*arrowRail_);
            }
        }
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
    if (key.rfind("rail-next:", 0) == 0 || key.rfind("rail-prev:", 0) == 0) {
        // A rail's arrow steps the rail by most of its width, wrapping seamlessly at either end.
        const bool next = key[5] == 'n';
        const std::size_t rail = std::stoul(key.substr(10));
        if (rail >= rails_.size()) return std::nullopt;
        const std::optional<ScrollSurface> surface =
            SurfaceAt(rails_[rail]->box().CenterX(), rails_[rail]->box().CenterY(), nav::Axis::X);
        if (!surface.has_value() || surface->kind != ScrollSurface::Kind::Rail) return std::nullopt;
        const double step = rails_[rail]->box().width * 0.85;
        const double max = rails_[rail]->MaxScroll();
        const double from = railCamera_.at(rail).active() ? railCamera_.at(rail).target() : rails_[rail]->scroll();
        const double target = next ? (from >= max - 0.5 ? 0.0 : std::min(from + step, max))
                                   : (from <= 0.5 ? max : std::max(from - step, 0.0));
        AnimateScroll(*surface, target, nowMs);
        return std::nullopt;
    }
    if (key == "search-clear") {
        Command command;
        command.name = "search-clear";
        command.action = true;
        FocusItem(kSearchFieldKey, nowMs, false);
        return command;
    }
    const bool heroKey = HeroActive() && IsHeroKey(key);
    if (!TopIndexOf(key).has_value() && !heroKey && !cardByKey_.contains(key) && !HeaderIndexOf(key).has_value()) {
        return std::nullopt;
    }
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
    AnimateEmphasis(previous, key, nowMs);
    focus_.SetFocus(key);

    const auto card = cardByKey_.find(key);
    // A rebuild that keeps the focus while the pointer rests elsewhere keeps it unlit.
    if (card != cardByKey_.end()) AnimateFocus(card->second, focusHidden_ ? 0.0 : 1.0, nowMs);
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
        const double pad = Streamy() ? std::max(metrics_.Rem(kRowCameraPadRem), HeaderTop() + metrics_.Rem(3.25))
                                     : metrics_.Rem(kRowCameraPadRem);
        const double pageTarget = (HeroActive() && next.rail == 0)
                                      ? 0.0
                                      : nav::PagePanTarget(pageScroll_, rowTop, 0.0, pad);
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

    // Focus transitions ease over 150 ms (fastMs token, per DECISIONS.md and WINDOWS-VISUAL-SPEC.md).
    const double duration = motion::ResolveMotionTokens(motion_).fastMs;
    Card* card = ref.card;
    const motion::Tween tween(from, to, timeline_.Clock(nowMs), duration);
    ref.focusAnimation = timeline_.Add([card, tween](double clockMs) {
        card->SetFocusAmount(tween.Value(clockMs));
        return tween.Done(clockMs);
    });
}

void Scene::Paint(Painter& painter) const {
    painter.Clear(tokens::kBackground);
    if (HeroActive()) PaintHeroBackdrop(painter);
    page_->Paint(painter, metrics_);
    PaintRailArrows(painter);
    if (HeroActive()) PaintHero(painter);
    // Switching to or from Live TV, Library or Search: the new page's content fades in from the ground.
    if (contentFade_.has_value() && !contentFade_->Done(clockMs_)) {
        const double shown = std::clamp(contentFade_->Value(clockMs_), 0.0, 1.0);
        painter.FillRoundRect(Box{0.0, 0.0, viewportWidth_, viewportHeight_}, 0.0,
                              WithAlpha(tokens::kBackground, 1.0 - shown));
    }

    // The status line sits in the header. While it is shown, the page scrolls beneath a band
    // that keeps the header clear, so the line never sits on top of a title.
    const double headerTop = HeaderTop();
    if (HasLaneHeader()) {
        // A page under the stream chrome: its header, its status line, then the chrome itself on top.
        PaintLaneHeader(painter);
        if (!status_.empty()) {
            const double x = metrics_.Rem(kSafeXRem + (CompactViewport(viewportWidth_, viewportHeight_) ? 0.0 : kRailInsetRem));
            const TextStyle statusStyle{metrics_.Rem(1.0), false};
            // On Search the line is centred under the field.
            const double statusX = x;
            painter.Text(Box{statusX, headerTop, viewportWidth_ - statusX - x, metrics_.Rem(kTopButtonHeightRem)},
                         status_, statusStyle, tokens::kTextMuted);
        }
        if (searchField_) PaintSearchExtras(painter);
        PaintStreamChrome(painter);
        return;
    }
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
        const bool focused = ShowsFocus(TopKey(i));
        const double emphasis = EmphasisOf(TopKey(i));
        const double radius = button.height / 2.0;
        GlassStyle glass;
        glass.kind = GlassKind::Pill;
        glass.focused = focused;
        glass.focusAmount = focused ? std::max(emphasis, 1e-3) : emphasis;
        glass.pressAmount = PressOf(TopKey(i));
        glass.reduceTransparency = tokens::reduceTransparency;
        glass.tint = focused ? tokens::kSurfaceHover : tokens::kSurface;
        glass.border = tokens::kBorderSoft;
        glass.ringWidth = metrics_.Rem(kFocusRingWidthRem);
        glass.ringOutset = metrics_.Rem(kFocusRingOffsetRem) + glass.ringWidth / 2.0;
        glass.ringColor = tokens::kFocusRing;
        painter.Glass(button, radius, glass);
        painter.Text(Box{button.x + metrics_.Rem(1.0), button.y, button.width - metrics_.Rem(2.0), button.height},
                     tops_[i].label, TextStyle{metrics_.Rem(0.9375), focused},
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
