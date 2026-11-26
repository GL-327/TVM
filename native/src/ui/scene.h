#pragma once

// The home screen: rails of cards. The scene owns the widget tree, binds it to
// the focus engine, and runs every motion (focus fades, rail and page cameras)
// on one timeline. It is a Screen, so the shell can route input to it.
//
// Navigation follows apps/ui/src/nav/railNav.ts. Left and right wrap along a
// rail. Up and down move to the card in the neighbouring rail whose centre is
// closest. The focus engine holds the focus state and resolves containers.

#include <cstddef>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "motion/camera.h"
#include "motion/preferences.h"
#include "motion/timeline.h"
#include "motion/tween.h"
#include "nav/focus_tree.h"
#include "ui/hero_particles.h"
#include "ui/screen.h"
#include "ui/widget.h"

namespace tvm::ui {

// A rail for placeholder layouts: a title and a number of cards.
struct RailSpec {
    std::string title;
    std::size_t count;
};

// One title on a rail, as the catalogue gives it.
struct CardData {
    std::string itemId;
    std::string title;
    std::string posterUrl;
    // The share watched, for a title in progress. Nothing when there is no progress to show.
    std::optional<double> progress;
    // A channel: a 16:9 tile with its logo fitted whole on a dark plate, its name under it, and `subtitle`.
    bool logo = false;
    // Under a channel's name, or under a poster's title (a search result's year).
    std::string subtitle;
    // A large feature card (Search's Top Result): the picture is `posterUrl` (a backdrop), `subtitle` is its meta line.
    bool feature = false;
    // A Browse tile on Search (a genre). OK sends `search-browse` with its title as the genre, not Details.
    bool category = false;
    std::string backdropUrl;
    std::string detailsPosterUrl;
};

struct RailData {
    std::string id;
    std::string title;
    std::vector<CardData> cards;
    bool loop = false;
    bool more = false;
};

// What OK does on a card. Home opens the title's details. The Live TV screen plays
// the channel, or toggles its pick while the channels are being chosen.
enum class CardAction {
    Details,
    Play,
    TogglePick,
};

// A button at the top right of a scene. The first is the rightmost, and Up from the top
// rail reaches it. Home has Settings and Live TV.
struct TopButton {
    std::string label;
    Command command;
    // A lane that is chosen, such as Home, Movies or Series. Its pill is frosted white with dark ink.
    bool on = false;
    // The TVM wordmark lockup at the top left.
    bool lockup = false;
    // The circular profile orb at the top right.
    bool orb = false;
    // One tab of a segmented control (Search's All · Movies · Series): the tabs sit in one glass capsule, the chosen
    // one on the light plate, as the Home navigation pill draws its tabs.
    bool segment = false;
};

// How a scene is dressed. Home has its buttons at the top right and the launcher's hero. TVM Stream
// has the stream chrome, a row of links across the top that stays put while the page scrolls, and the
// billboard hero with WATCH NOW and the "tvm stream" lockup (apps/ui/src/screens/Library.tsx).
enum class SceneStyle {
    Home,
    Stream,
    // The search page: the search field across the top, with the results as rails of posters under it.
    Search,
    // A page such as Watchlist: a kicker and a heading, a row of buttons under them, then a poster grid.
    Page,
};

// A title the Home hero can show: its catalogue id, its name, the picture behind it, and the hue
// its picture falls back to while the picture is not there.
struct HeroData {
    std::string itemId;
    std::string title;
    std::string backdropUrl;
    int hue = 0;
    std::optional<Color> accent;
    std::string rating;
    std::string logoUrl;
    // The metadata line under the 72px hero title, e.g. "Movie · Drama · 2h 6m · 4K".
    std::string meta;
    // A paragraph under the title. When there is one the hero is a notice, such as TVM Stream's
    // "Connect Real-Debrid to watch", and its first button is a primary pill.
    std::string body;
    // The buttons' labels and what they open. Empty labels and missing commands take the style's own.
    std::string playLabel;
    std::string infoLabel;
    std::optional<Command> playCommand;
    std::optional<Command> infoCommand;
    std::string eventKicker;
    std::optional<Color> glow;
    HeroEffect effect = HeroEffect::None;
};

// What a scene other than Home shows: its status line, its rails, its top buttons, and
// what OK does on a card.
struct SceneView {
    std::string status;
    std::vector<RailData> rails;
    std::vector<TopButton> topButtons;
    CardAction cardAction = CardAction::Details;
    SceneStyle style = SceneStyle::Home;
    // What is typed in the search field, on the search page.
    std::string query;
    // A page's kicker and heading, such as "Saved for later" and "Watchlist".
    std::string kicker;
    std::string heading;
    // A service hub's wordmark and colour, which take the "tvm stream" lockup's place on the billboard.
    std::string brandWord;
    // A page under the stream chrome (Live TV, Library, Search): its own controls in a row under the chrome, kept
    // apart from the chrome's tabs, and a search field above them. They stay put while the rails scroll.
    std::vector<TopButton> pageButtons;
    bool searchField = false;
    std::optional<Color> brandColor;
    // A search is on its way: the results area shows placeholder posters until it answers.
    bool loading = false;
    // Which page this is, such as a TVM Stream lane. A new view of the same page keeps the viewer's place (the page's
    // scroll, each rail's scroll by its id, and the focused title) without moving the camera; a different page
    // starts at the top.
    std::string pageKey;
};

class Scene final : public Screen {
public:
    // Placeholder rails, with generated titles. Used before the catalogue loads, and in tests.
    Scene(const std::vector<RailSpec>& rails, motion::MotionSettings motion);

    // Replaces the rails with the catalogue's. Focus returns to the first card.
    void SetRails(const std::vector<RailData>& rails);
    // A line shown in the header while the catalogue loads, or when it is unavailable.
    void SetStatus(std::string status);
    // Only the search field's text changes: the rails, header and focus stay as they are, so typing does not rebuild
    // the page.
    void SetQuery(std::string query) { query_ = std::move(query); }
    // The catalogue title of the focused card, or nothing when no card has focus.
    std::optional<std::string> FocusedItemId() const;
    const Card* FocusedDetailsCard() const;
    // Focuses the first card for a catalogue title, moving the cameras to it. False when no card shows it.
    bool FocusTitle(const std::string& itemId, double nowMs);
    // Replaces the status line, the rails, the top buttons and the card action. The viewer's
    // place is kept: the same title keeps the focus, and so does a top button.
    void SetView(const SceneView& view, double nowMs);

    // The Home hero: a picture, a title, and two buttons above the rails. It takes the top 48% of the
    // window, as the web stage does. SetHeroes replaces the titles; the one shown keeps its place when
    // it is still there, and an empty list removes the hero. ShowHero turns to another title, with its
    // title dissolving in at once, and its picture crossfading in when `SetImageReady` says the file is
    // there.
    void SetHeroes(std::vector<HeroData> heroes, double nowMs);
    void ShowHero(std::size_t index, double nowMs);
    std::size_t HeroIndex() const { return heroIndex_; }
    std::size_t HeroCount() const { return heroes_.size(); }
    std::string HeroClipId() const;
    bool HeroOnscreen() const { return HeroActive() && HeroBox().Bottom() > ChromeHeight(); }
    void SetSpotlightRunning(bool running) { spotlightRunning_ = running; }
    void SetHeroClip(bool hasFrame, bool canUnmute, double nowMs);
    bool HeroMuted() const { return heroMuted_; }
    bool HeroClipPlaying() const { return clipStartedAt_.has_value(); }
    void SetImageReady(std::function<bool(const std::string&)> ready) { imageReady_ = std::move(ready); }
    double ViewportHeight() const { return viewportHeight_; }

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    void Paint(Painter& painter) const override;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focus_.Focused(); }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;

    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const override;
    void SetScroll(const ScrollSurface& surface, double value, double nowMs) override;
    void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) override;
    void SetMotion(const motion::MotionSettings& settings) override { motion_ = settings; }
    void SetPressed(const std::optional<std::string>& key, double nowMs) override;
    // Fades the page's content in from the background behind the chrome, with the hero dissolve's timing and
    // easing. Used when switching to or from Live TV, Library or Search, which have no hero to dissolve.
    void FadeContentIn(double nowMs);
    void PointerLeft(double nowMs) override;
    void PressedElsewhere(const std::optional<std::string>& key, double nowMs) override;
    // Whether the search field takes the typing: only after a click on it (or OK/Enter on it, Ctrl+F or /), never
    // from hover. A click elsewhere, Esc, moving into the results or leaving the page ends it.
    bool SearchEditing() const { return searchEditing_ && searchField_; }
    void SetSearchEditing(bool on, double nowMs);
private:
    bool NavigateFocus(nav::Direction direction, double nowMs);
public:
    void PointerAt(double x, double y, double nowMs) override;
    // A rail's arrow, at its start (`next` false) or its end, while that side can still move. Exposed for tests.
    std::optional<Box> RailArrowBox(std::size_t rail, bool next) const;
    // Where a rail's arrow sits, whether or not it can move the rail now.
    std::optional<Box> RailArrowShape(std::size_t rail) const;
    std::optional<Box> RailArrowShapeAt(std::size_t rail, bool next) const;
    // The rail's scroll once its glide ends.
    double RailTarget(std::size_t rail) const;
    std::optional<std::size_t> ArrowRail() const { return arrowRail_; }
    void ShowFocus(double nowMs) override;
    // Whether the focused item is drawn focused: false while the pointer rests on empty space.
    bool FocusShown() const { return !focusHidden_; }

    // Plays the stream chrome's entrance (the glass bar, then its labels, then the selected tab) the first time
    // the chrome is drawn after this call. It plays once: switching tabs never replays it. Reduced motion skips it.
    void PlayChromeEntrance() { chromeEntrancePending_ = true; }
    // How lit a top or hero button is by hover or focus, eased from 0 to 1, and how far it is held down.
    double EmphasisOf(const std::string& key) const;
    double PressOf(const std::string& key) const;
    // The focus highlight's sweep across a focused button, 0 to 1, or -1 when none is running.
    double SweepOf(const std::string& key) const;
    // Where the selected tab's glass is drawn now: on the selected tab, or between two tabs while it slides.
    std::optional<Box> TabIndicatorBox() const;

    std::vector<std::string> RailsNearEnd() const;
    double RailScroll(std::size_t rail) const { return rails_.at(rail)->scroll(); }
    Box RailBox(std::size_t rail) const { return rails_.at(rail)->box(); }
    double PageScroll() const { return pageScroll_; }
    const Box& CardBox(std::size_t rail, std::size_t index) const;
    double CardFocus(std::size_t rail, std::size_t index) const;
    std::size_t RailCount() const { return rails_.size(); }
    std::size_t CardCount(std::size_t rail) const { return rails_.at(rail)->children().size(); }
    const Metrics& metrics() const { return metrics_; }

private:
    struct CardRef {
        Card* card;
        std::size_t rail;
        std::size_t index;
        std::string key;
        // Timeline id of the focus fade in flight, or 0.
        motion::Timeline::Id focusAnimation = 0;
    };

    // The boxes of the hero's parts, in window pixels, at the current scroll.
    struct HeroBoxes {
        Box kicker;
        Box pill;
        Box source;
        Box title;
        Box meta;
        Box watch;
        Box learn;
        Box dots;
        Box body;
        Box mute;
    };

    bool Streamy() const { return style_ == SceneStyle::Stream; }
    // The page header under the stream chrome: its heading, search field and control row, in window pixels.
    struct HeaderItem {
        std::string key;
        Box box;
        // The page button's index, or -1 for the search field.
        int button = -1;
    };
    std::vector<HeaderItem> HeaderItems() const;
    // Where the heading sits, when the page has one and no hero.
    std::optional<Box> LaneHeadingBox() const;
    bool HasLaneHeader() const;
    std::optional<std::size_t> HeaderIndexOf(const std::string& key) const;
    void PaintLaneHeader(Painter& painter) const;
    // The top buttons run left to right in a row, as the stream chrome and a page's controls do.
    bool RowTops() const { return style_ == SceneStyle::Stream || style_ == SceneStyle::Page; }
    void PaintPageHeader(Painter& painter) const;
    std::string PlayLabel() const;
    std::string InfoLabel() const;
    // The height of the stream chrome's band, which the page scrolls under.
    double ChromeHeight() const;
    void PaintStreamChrome(Painter& painter) const;
    // Where the page's header ends: under the stream chrome, under the search field, or at the safe area.
    double HeaderTop() const;
    void PaintSearchField(Painter& painter) const;
    // The field at `field`. `active` is whether typing goes into it; `emphasis` its hover.
    void PaintSearchField(Painter& painter, const Box& field, bool active, double emphasis) const;

    void Build(const std::vector<RailData>& rails);
    std::size_t GlobalIndex(std::size_t rail, std::size_t index) const { return railOffset_.at(rail) + index; }
    double MaxPageScroll() const;
    bool HeroActive() const { return !heroes_.empty(); }
    Box HeroBox() const;
    bool Spotlight() const;
    Box SpotlightMediaBox() const;
    Box ParallaxCopy(Box box) const;
    void PaintSpotlight(Painter& painter) const;
    double HeroFade() const;
    HeroBoxes HeroLayout() const;
    std::optional<Box> HeroRatingBox() const;
    void PaintHeroRating(Painter& painter) const;
    // Starts the crossfade to the pending picture, once the picture is there.
    void StartHeroArt(double nowMs);
    void PaintHeroBackdrop(Painter& painter) const;
    void PaintHero(Painter& painter) const;
    // The top button at an index, and the index of a top button's key.
    Box TopBoxScreen(std::size_t index) const;
    std::optional<std::size_t> TopIndexOf(const std::string& key) const;
    void Arrange();
    void SyncFocus();
    void AnimateFocus(std::size_t cardIndex, double to, double nowMs);
    // Focuses a card or the Settings button, fading the card focus and moving the cameras.
    void FocusKey(const std::string& key, double nowMs, bool withCamera);
    void StartRailCamera(std::size_t rail, double target, bool& moved);
    void StartPageCamera(double target, bool& moved);
    bool CameraActive() const;

    motion::MotionSettings motion_;
    Metrics metrics_;
    double viewportWidth_ = 0.0;
    double viewportHeight_ = 0.0;
    std::string status_;
    std::vector<TopButton> tops_;
    CardAction cardAction_ = CardAction::Details;
    SceneStyle style_ = SceneStyle::Home;
    std::string query_;
    std::string kicker_;
    std::string heading_;
    std::string brandWord_;
    std::optional<Color> brandColor_;

    std::unique_ptr<Stack> page_;
    std::vector<Rail*> rails_;
    std::vector<std::size_t> railOffset_;
    // Each rail's id, from its RailData, so a rebuild can put each rail back where the viewer left it.
    std::vector<std::string> railIds_;
    std::vector<bool> railMore_;
    std::string pageKey_;
    // The rail under the pointer, whose arrows show, how far they have faded in, and the arrow under the pointer.
    std::optional<std::size_t> arrowRail_;
    motion::Tween arrowFade_;
    std::string arrowHover_;
    // Each arrow fades out when its side runs out (and back in), instead of vanishing mid-glide.
    motion::Tween arrowSide_[2];
    void PaintRailArrows(Painter& painter) const;
    std::optional<std::pair<std::size_t, Rail::Slot>> focusedSlot_;
    std::optional<std::pair<std::size_t, Rail::Slot>> pointerSlot_;
    std::vector<CardRef> cards_;
    std::unordered_map<std::string, std::size_t> cardByKey_;

    std::vector<motion::CameraTween> railCamera_;
    motion::CameraTween pageCamera_;
    double pageScroll_ = 0.0;
    double pageContentHeight_ = 0.0;
    // The rails' own height, and how far below the top of the page they start: the hero and its gap, or nothing.
    double railsHeight_ = 0.0;
    double pageTopOffset_ = 0.0;

    // The hero. The picture on screen is `artCurrent_`, and the one it dissolves from is `artPrevious_`
    // while `artFade_` runs. `artPending_` is the picture asked for and not yet crossfaded in.
    std::vector<HeroData> heroes_;
    std::size_t heroIndex_ = 0;
    std::string heroTitleId_;
    double heroHeight_ = 0.0;
    double spotlightStartMs_ = 0.0;
    double spotlightElapsedMs_ = 0.0;
    bool spotlightRunning_ = true;
    std::optional<double> clipStartedAt_;
    bool clipCanUnmute_ = false;
    bool heroMuted_ = true;
    std::string artCurrent_;
    std::string artPrevious_;
    std::string artPending_;
    std::optional<motion::Tween> artFade_;
    std::optional<motion::Tween> titleFade_;
    std::function<bool(const std::string&)> imageReady_;
    // The clock of the last tick. The hero's fades read it while painting.
    double clockMs_ = 0.0;

    std::vector<TopButton> pageButtons_;
    bool searchField_ = false;
    bool searchEditing_ = false;
    double caretStartMs_ = 0.0;
    bool loading_ = false;
    // The search page's placeholders while a search runs, and its empty-result mark.
    void PaintSearchExtras(Painter& painter) const;
    std::optional<motion::Tween> contentFade_;

    // Hover and focus emphasis of the top and hero buttons, by key, and the one press in flight.
    void AnimateEmphasis(const std::optional<std::string>& from, const std::string& to, double nowMs);
    bool ControlsAnimating() const;
    // 0 to 1 through a stage of the chrome entrance that starts `delayMs` in and lasts `durationMs`.
    double EntranceStage(double delayMs, double durationMs) const;
    std::optional<std::size_t> ActiveTabIndex() const;

    std::map<std::string, motion::Tween> emphasis_;
    // Set while the pointer is over nothing: the focus keeps its place for the remote, but is not drawn.
    bool focusHidden_ = false;
    bool ShowsFocus(const std::string& key) const {
        return !focusHidden_ && focus_.Focused() == std::optional<std::string>(key);
    }
    // Eases the focused item's look in or out without moving the focus.
    void EaseFocusedLook(bool shown, double nowMs);
    // When each button last took focus, for its highlight sweep.
    std::map<std::string, double> focusStart_;
    std::string pressKey_;
    motion::Tween press_;
    std::optional<double> pressReleasedAt_;
    double releaseDepth_ = 0.0;
    // The selected tab's glass slides from `indicatorFrom_` to the selected tab while `indicatorMove_` runs.
    std::optional<std::size_t> activeTab_;
    Box indicatorFrom_{};
    bool indicatorCrossFade_ = false;
    std::optional<motion::Tween> indicatorMove_;
    bool chromeEntrancePending_ = false;
    // Set the first time the chrome is painted after PlayChromeEntrance, so the entrance starts when it is seen.
    mutable std::optional<double> chromeEntranceStart_;

    motion::Timeline timeline_;
    nav::FocusTree focus_;
};

}  // namespace tvm::ui
