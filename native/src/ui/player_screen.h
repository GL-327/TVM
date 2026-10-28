#pragma once

// The player, from apps/ui/src/screens/Player.tsx and its chrome, apps/ui/src/player/CinemaControls.tsx
// with cinema-controls.css. The picture is mpv's, behind this screen; the screen draws the chrome over
// it: "Back to browse" and the TVM CINEMA mark at the top, and at the foot the timeline, then play,
// back and forward ten seconds and the sound on the left, the title in the middle, and full screen on
// the right. The chrome fades out after three seconds without input while the title plays, as
// useIdleChrome hides it.
//
// Before the stream is found the screen shows the queue card, "Getting your stream ready", and when
// playback cannot go on it shows the error card with Retry and Back.
//
// The app owns playback and hands its state over with SetView. The screen's buttons return action
// commands, which the app carries out.

#include <optional>
#include <string>
#include <vector>

#include "ui/button_focus.h"
#include "ui/screen_base.h"

namespace tvm::ui {

// The loudest the sound goes: 400%, as mpv's --volume-max allows.
inline constexpr double kMaxVolume = 4.0;

// One row of a player menu: subtitles, audio, quality or speed.
struct PlayerOption {
    std::string id;
    std::string label;
    // A fainter second part, such as a release's name in the quality menu.
    std::string detail;
    bool selected = false;

    bool operator==(const PlayerOption&) const = default;
};

struct PlayerView {
    enum class Phase {
        // The stream is being found.
        Resolving,
        Playing,
        Error,
    };

    Phase phase = Phase::Resolving;
    std::string title;
    // "S1 · E2" under the title for an episode, as CinemaControls shows it. Empty for a film.
    std::string episode;
    double position = 0.0;
    double duration = 0.0;
    bool paused = false;
    // mpv has drawn a first frame. Until then the queue card stays up.
    bool started = false;
    // mpv is waiting on its cache.
    bool buffering = false;
    bool live = false;
    // From 0 to kMaxVolume, where 1 is 100%.
    double volume = 1.0;
    bool muted = false;
    bool fullscreen = false;
    std::string errorTitle;
    std::string errorBody;

    // The menus' rows. A menu with no rows has no button, as the web pickers hide themselves.
    std::vector<PlayerOption> subtitles;
    std::vector<PlayerOption> audios;
    std::vector<PlayerOption> qualities;
    double speed = 1.0;
    // The quality button's word, such as "1080p", from the picture mpv is drawing.
    std::string qualityLabel;

    // Next Up, from NextUp.tsx: shown over the last seconds of an episode that has a next one.
    bool nextUp = false;
    std::string nextShow;
    std::string nextEpisode;
    std::string nextStill;
    double nextRemaining = 0.0;
    double nextWindow = 45.0;

    // Skip recap, from SkipRecap.tsx: offered over an episode's opening recap, which runs to recapEnd.
    bool recap = false;
    double recapEnd = 90.0;
    // Skip credits, from CreditsAction.tsx: offered over the last seconds of a title with no next episode.
    bool credits = false;
    double creditsRemaining = 0.0;

    // The trickplay thumbnail for the time being previewed, as a file, and the time it shows.
    std::string thumbnail;
    double thumbnailTime = -1.0;

    // Go Live, from GoLive.tsx: how far a live channel has fallen behind its broadcast, in seconds.
    double liveBehind = 0.0;
    // The remote hints, from RemoteHints.tsx: shown once, the first time anything plays.
    bool hints = false;
    // The header's actions: the title's place on My List, when it can be saved, and Download.
    bool canSave = false;
    bool saved = false;

    bool operator==(const PlayerView&) const = default;
};

// The playback speeds the speed menu offers, as PlaybackSpeed.tsx lists them.
inline constexpr double kPlaybackSpeeds[] = {0.5, 0.75, 1.0, 1.25, 1.5, 2.0};

// The seconds before the end at which Next Up shows: 45, but never more than a fifth of a short title.
double NextUpWindowSeconds(double duration);

// The last seconds over which Skip credits shows: 6% of the title, from 8 to 18 seconds, and never more
// than a third of it. Zero when the length is unknown.
double CreditsWindowSeconds(double duration);

// Hold-to-skip, from Trickplay.tsx: a held arrow steps 10 seconds, then 30 after 700 ms, then 60 after
// 1.5 s, one step every 400 ms once the hold is armed at 320 ms.
double HoldSkipStep(double heldMs);
inline constexpr double kHoldArmMs = 320.0;
inline constexpr double kHoldTickMs = 400.0;

// "42:10 left" for the title overlay's meta line. Empty under half a second.
std::string RemainingLabel(double seconds);

// liveEdge.ts: Go Live shows from 12 seconds behind, which reads "12s behind", "2 min behind" or "1h 5m behind".
inline constexpr double kLiveDriftThreshold = 12.0;
std::string DriftLabel(double seconds);

// RemoteHints.tsx: the hints wait 420 ms after the picture, stay 5.2 s, ignore input for their first
// 750 ms, and fade over 280 ms.
inline constexpr double kHintsSettleMs = 420.0;
inline constexpr double kHintsShowMs = 5200.0;
inline constexpr double kHintsGraceMs = 750.0;
inline constexpr double kHintsFadeMs = 280.0;

// "1:02:03" past an hour, else "2:03", as the web clock shows a position.
std::string FormatClock(double seconds);

class PlayerScreen final : public ScreenBase {
public:
    PlayerScreen() = default;

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    void Paint(Painter& painter) const override;

    void SetView(const PlayerView& view, double nowMs);
    const PlayerView& view() const { return view_; }
    // Any input brings the chrome back and restarts its timer.
    void ShowChrome(double nowMs);
    // The chrome's opacity, from 0 when it has faded out to 1.
    double ChromeOpacity(double nowMs) const;
    bool ChromeHidden(double nowMs) const { return ChromeOpacity(nowMs) <= 0.0; }
    // True while the picture is on screen, so the screen is drawn over it rather than on a black ground.
    bool OverVideo() const { return view_.phase == PlayerView::Phase::Playing; }

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focused_; }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;

    // The boxes of the chrome's parts, in window pixels.
    std::optional<Box> BoxOf(const std::string& key) const;
    // The timeline's bar and the sound's bar: a click along either sets it.
    Box TrackBox() const;
    Box VolumeTrackBox() const;

    // The menus. Only one is open at a time; its rows take the remote until it closes.
    bool MenuOpen() const { return !menu_.empty(); }
    const std::string& OpenMenu() const { return menu_; }
    void CloseMenu();
    std::vector<PlayerOption> MenuOptions(const std::string& menu) const;
    std::optional<Box> MenuBox() const;

    // Dragging along the timeline: the share of the bar under the pointer, the preview while the button
    // is held, and the seconds to seek to when it is let go. A hover shows the time under the pointer.
    std::optional<double> ShareAt(double x) const;
    void Hover(std::optional<double> share);
    void Scrub(double share);
    bool Scrubbing() const { return scrub_.has_value(); }
    std::optional<double> EndScrub();
    // A held arrow's target, shown in the trickplay preview for a moment after each step.
    void HoldPreview(double seconds, double nowMs);
    // The time the trickplay preview shows: under a drag, a hover, or a held arrow. Nothing when none.
    std::optional<double> PreviewSeconds() const;

private:
    std::vector<std::string> Items() const;
    bool FocusButton(const std::string& key, double nowMs, bool withCamera);
    std::optional<Command> Activate(const std::string& key);
    double Rem(double rems) const { return rems * height_ / 67.5; }
    void PaintQueue(Painter& painter) const;
    void PaintChrome(Painter& painter, double opacity) const;
    void PaintError(Painter& painter) const;
    void PaintSpinner(Painter& painter) const;
    void PaintMenu(Painter& painter) const;
    void PaintNextUp(Painter& painter) const;
    // The tool buttons at the right of the toolbar that have something to offer, left to right.
    std::vector<std::string> ToolKeys() const;
    std::string ToolLabel(const std::string& key) const;

    PlayerView view_;
    std::string menu_;
    std::size_t menuIndex_ = 0;
    std::optional<double> hover_;
    std::optional<double> scrub_;
    double holdSeconds_ = 0.0;
    double holdUntilMs_ = 0.0;
    // When the hints came up, and when they started to leave. Zero until then.
    double hintsFromMs_ = 0.0;
    double hintsLeaveMs_ = 0.0;
    // The hints' opacity at `nowMs`, from 0 to 1.
    double HintsOpacity(double nowMs) const;
    void PaintHints(Painter& painter) const;
    void PaintGoLive(Painter& painter, double opacity) const;
    void PaintTitleOverlay(Painter& painter, double opacity) const;
    void PaintEndActions(Painter& painter) const;
    void PaintPreview(Painter& painter, double opacity) const;
    std::string focused_ = "play";
    ButtonFocusSet buttonFocus_;
    double width_ = 0.0;
    double height_ = 0.0;
    double clockMs_ = 0.0;
    double lastActivityMs_ = 0.0;
};

}  // namespace tvm::ui
