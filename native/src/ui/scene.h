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
};

struct RailData {
    std::string id;
    std::string title;
    std::vector<CardData> cards;
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
    // A lane that is chosen, such as Shows on TVM Stream. Its label is drawn at full strength.
    bool on = false;
    // The TVM wordmark lockup: the mark, then the label spaced out in capitals.
    bool lockup = false;
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
    // A paragraph under the title. When there is one the hero is a notice, such as TVM Stream's
    // "Connect Real-Debrid to watch", and its first button is a primary pill.
    std::string body;
    // The buttons' labels and what they open. Empty labels and missing commands take the style's own.
    std::string playLabel;
    std::string infoLabel;
    std::optional<Command> playCommand;
    std::optional<Command> infoCommand;
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
    std::optional<Color> brandColor;
};

class Scene final : public Screen {
public:
    // Placeholder rails, with generated titles. Used before the catalogue loads, and in tests.
    Scene(const std::vector<RailSpec>& rails, motion::MotionSettings motion);

    // Replaces the rails with the catalogue's. Focus returns to the first card.
    void SetRails(const std::vector<RailData>& rails);
    // A line shown in the header while the catalogue loads, or when it is unavailable.
    void SetStatus(std::string status);
    // The catalogue title of the focused card, or nothing when no card has focus.
    std::optional<std::string> FocusedItemId() const;
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

    double RailScroll(std::size_t rail) const { return rails_.at(rail)->scroll(); }
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
        Box watch;
        Box learn;
        Box dots;
        Box body;
    };

    bool Streamy() const { return style_ == SceneStyle::Stream; }
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

    void Build(const std::vector<RailData>& rails);
    std::size_t GlobalIndex(std::size_t rail, std::size_t index) const { return railOffset_.at(rail) + index; }
    double MaxPageScroll() const;
    bool HeroActive() const { return !heroes_.empty(); }
    Box HeroBox() const;
    double HeroFade() const;
    HeroBoxes HeroLayout() const;
    // Starts the crossfade to the pending picture, once the picture is there.
    void StartHeroArt(double nowMs);
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
    std::string artCurrent_;
    std::string artPrevious_;
    std::string artPending_;
    std::optional<motion::Tween> artFade_;
    std::optional<motion::Tween> titleFade_;
    std::function<bool(const std::string&)> imageReady_;
    // The clock of the last tick. The hero's fades read it while painting.
    double clockMs_ = 0.0;

    motion::Timeline timeline_;
    nav::FocusTree focus_;
};

}  // namespace tvm::ui
