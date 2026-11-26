#pragma once

// The shell owns the view stack and one screen per stack entry. It routes
// remote, mouse, wheel and touch input to the screen on top, and it carries out
// the commands screens return (open Details, open Settings and so on). It has
// no Win32 calls, so it is tested directly.

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "nav/pointer.h"
#include "nav/view_stack.h"
#include "ui/catalog_view.h"
#include "ui/live_playlist_screen.h"
#include "ui/pages.h"
#include "ui/painter.h"
#include "ui/player_screen.h"
#include "ui/preferences_store.h"
#include "ui/realdebrid_screen.h"
#include "ui/screen.h"
#include "ui/settings_screen.h"
#include "ui/stage.h"
#include "ui/xtream_screen.h"

namespace tvm::ui {

class Shell {
public:
    struct ReleaseCard { std::string version, title; std::vector<std::string> highlights; };
    void SetReleaseCard(std::optional<ReleaseCard> card) { releaseCard_ = std::move(card); }
    // The patch notes pop-up: a modal sheet over the whole app, closed with "Got it", Enter or Esc. Its body scrolls
    // when the notes are longer than the sheet (wheel, Up and Down, Page Up and Page Down).
    struct PatchChange {
        std::string area, text;
        // Platform ids as in changelog.json ("windows", "ios", ...). Empty means every app.
        std::vector<std::string> platforms;
    };
    struct PatchNotes {
        std::string version, title;
        std::vector<std::string> highlights;
        std::vector<PatchChange> changes;
        std::vector<std::string> knownIssues;
    };
    void SetPatchNotes(std::optional<PatchNotes> notes) {
        patchNotes_ = std::move(notes);
        patchScroll_ = 0.0;
    }
    bool HasPatchNotes() const { return patchNotes_.has_value(); }
    Box PatchButtonBox() const;
    // The part of the sheet the notes scroll in.
    Box PatchBodyBox() const;
    // Scrolls the notes by `deltaPx` (positive is down), kept inside the notes. True when they moved.
    bool ScrollPatchNotes(double deltaPx);
    double PatchScroll() const { return patchScroll_; }
    double PatchMaxScroll() const;
    // The shown name of a changelog platform id ("ios" is "iPhone"); an unknown id is shown as it is.
    static std::string PlatformLabel(const std::string& id);
    // `root` is the home screen. It is the bottom of the stack and is never removed.
    Shell(std::unique_ptr<Screen> root, PreferenceStore& store);

    void Layout(double width, double height);
    // Advances every screen to `nowMs`. Returns true while anything needs a frame.
    bool Tick(double nowMs);
    bool Animating() const;
    void Paint(Painter& painter) const;

    // Remote.
    void Navigate(nav::Direction direction, double nowMs);
    void Select(double nowMs);
    // Returns false at the root, where the app decides what Back means.
    bool Back(double nowMs);

    // Mouse. Touch-generated mouse messages must be filtered before they get here.
    void MouseMove(double x, double y, bool buttonDown, double nowMs);
    void MouseDown(double x, double y, double nowMs);
    void MouseUp(double x, double y, double nowMs);
    // The pointer left the window, or the window lost the foreground.
    void MouseLeave(double nowMs);
    void Wheel(double x, double y, double deltaX, double deltaY, bool shift, nav::WheelMode mode, double nowMs);
    // Any remote or keyboard press hides the cursor.
    void KeyPressed();
    bool CursorVisible() const { return mouse_.cursorVisible(); }

    // Touch. Only touch pointers are passed in; the caller checks the pointer type.
    void TouchDown(std::uint32_t pointerId, double x, double y, double nowMs);
    void TouchMove(std::uint32_t pointerId, double x, double y, double nowMs);
    void TouchUp(std::uint32_t pointerId, double x, double y, double nowMs);
    void TouchCancel();

    const nav::ViewStackState& stack() const { return stack_; }

    // Gives every details screen for `id` the catalogue's answer.
    void SetTitleInfo(const std::string& id, const TitleInfo& info);
    // The title id of the details screen on top, when one is open.
    std::optional<std::string> TopDetailsId() const;
    // The name of the screen the user is on, a modal included.
    std::string ActiveScreenName() const;
    // Gives every Real-Debrid screen the app's latest answer.
    void SetRealDebridView(const RealDebridView& view);
    // Gives every Live TV login screen the app's latest answer.
    void SetXtreamView(const XtreamView& view);
    // Gives every Live TV playlist screen the app's latest answer.
    void SetLivePlaylistView(const LivePlaylistView& view);
    // Gives the Live TV channel screen on the stack the app's latest view.
    void SetLiveTvView(const SceneView& view, double nowMs);
    // Gives the TVM Stream screen on the stack its rails, its chrome and its billboard. The first view
    // a screen gets puts the focus on the billboard's first button, as the web page opens.
    void SetStreamView(const SceneView& view, const std::vector<HeroData>& heroes, double nowMs);
    // Gives every player screen the app's latest playback state.
    void SetPlayerView(const PlayerView& view, double nowMs);
    // Updates Developer Diagnostics on any open Settings screen.
    void SetDeveloperDiagnostics(const DeveloperDiagnostics& diag);
    // Hands every Settings screen, open now or opened later, the Core preferences it shows.
    void SetCoreSettings(const CoreSettings& settings);
    void SetHomeSectionLabels(HomeSectionLabels labels);
    // Where Settings sends each preference change, as a partial /api/prefs body.
    void SetPrefsSink(PrefsSink sink);
    // The player on top, when the user is on one.
    PlayerScreen* ActivePlayer();
    // Closes every screen down to Home, as the stream chrome's Home link does.
    void PopToRoot(double nowMs);
    // Carries out a command as if a screen had returned it: opens its screen, or hands its action over.
    void Execute(const Command& command, double nowMs) { Open(command, nowMs); }
    // The scene for the TVM Stream screen on the stack, for its pictures.
    Scene* StreamScene();
    // The scene on the stack with this screen name, such as "search". Nothing when none is open.
    Scene* SceneNamed(const std::string& name);
    // The screen on the stack with this name, of whatever kind, for the app to fill in.
    Screen* ScreenNamed(const std::string& name);
    // The screen the user is interacting with: a modal if one is open, else the screen.
    Screen& ActiveScreen();
    // Receives the commands that act rather than open a screen, such as saving a title.
    void SetActionHandler(std::function<void(const Command&)> handler);
    // Told the name of each screen or modal as it opens, after it is on the stack.
    void SetOpenHandler(std::function<void(const std::string& name)> handler);
    void SetNavigationGuard(std::function<bool(const Command&)> guard) { guard_ = std::move(guard); }

private:
    Screen& Top();
    void Open(const Command& command, double nowMs);
    void Reconcile();
    std::unique_ptr<Screen> MakeScreen(const nav::ViewEntry& entry);
    void RestoreFocus(double nowMs);
    void ApplyMotionIfChanged();
    void Pan(const ScrollSurface& surface, double delta, nav::WheelMode mode, double nowMs);
    std::optional<std::string> Hit(double x, double y);
    bool ActivateChrome(const std::string& key, double nowMs);
    std::optional<Box> BackBox() const;
    Box ReleaseBox() const;
    std::optional<ReleaseCard> releaseCard_;
    std::optional<PatchNotes> patchNotes_;
    double patchScroll_ = 0.0;
    enum class PatchItem { Highlight, Area, Change, IssuesHeading, Issue };
    // Lays the notes out from the top of the body, calling `emit` for each item with its top and height (before
    // scrolling). Returns the height of everything, so the same walk paints and measures.
    double WalkPatch(const std::function<void(PatchItem, double, double, const PatchChange&)>& emit) const;
    CoreSettings coreSettings_;
    HomeSectionLabels homeLabels_ = HomeSections();
    PrefsSink prefsSink_;
    bool backFocused_ = false;

    nav::ViewStackState stack_;
    std::map<std::string, std::unique_ptr<Screen>> screens_;
    PreferenceStore& store_;
    motion::MotionSettings motion_;
    // The animated background, and the clock it runs on. It is drawn only behind a screen that shows it.
    Stage stage_;
    double clock_ = 0.0;
    double width_ = 0.0;
    double height_ = 0.0;
    std::function<void(const Command&)> action_;
    std::function<void(const std::string& name)> opened_;
    std::function<bool(const Command&)> guard_;

    nav::MouseState mouse_;
    std::optional<Point> pointer_;
    nav::ClickTracker clicks_;
    // Where the pointer last was over the window, and until when content moving under it (a wheel spin, an arrow's
    // glide, a coasting drag) should re-pick what is hovered. Any key ends that, so the remote's focus is not taken.
    bool pointerIn_ = false;
    double pointerX_ = 0.0;
    double pointerY_ = 0.0;
    double rehoverUntilMs_ = 0.0;
    void HoverAt(double x, double y, double nowMs);
    nav::TouchGesture touch_;
    // A mouse press on a rail that can scroll: once it moves sideways past the tap slop, the rail follows the pointer
    // (and the press is no longer a click); on release it coasts on, as a touch swipe does.
    struct MouseDrag {
        ScrollSurface rail;
        double startX = 0.0;
        double startY = 0.0;
        double lastX = 0.0;
        double lastMs = 0.0;
        double velocity = 0.0;
        bool dragging = false;
    };
    std::optional<MouseDrag> mouseDrag_;
    std::optional<ScrollSurface> touchRail_;
    std::optional<ScrollSurface> touchPage_;
};

}  // namespace tvm::ui
