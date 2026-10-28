#include "ui/player_screen.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>

#include "motion/preferences.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

constexpr double kPi = 3.14159265358979323846;

// cinema-controls.css, in rems.
constexpr double kPadXRem = 2.5;           // the header's and footer's left and right
constexpr double kHeaderTopRem = 2.0;
constexpr double kFooterBottomRem = 1.75;
constexpr double kToolbarRem = 3.6;        // .cinema-chrome__toolbar min-height
constexpr double kToolGapRem = 0.9;        // the transport's and the tools' gap
constexpr double kButtonRem = 2.8;         // .tvm-button
constexpr double kPlayWidthRem = 3.0;      // .cinema-chrome__play
constexpr double kGlyphRem = 1.65;
constexpr double kPlayGlyphRem = 2.1;
constexpr double kButtonRadiusRem = 0.3;
constexpr double kBackHeightRem = 3.0;
constexpr double kBackFontRem = 0.8;
constexpr double kTimelineRem = 1.6;       // .tvm-progress__control min-height
constexpr double kTimelineGapRem = 0.45;   // the timeline's margin under it
constexpr double kTimeWidthRem = 3.4;
constexpr double kTimeGapRem = 0.8;
constexpr double kTrackRem = 0.2;
constexpr double kKnobRem = 0.65;
constexpr double kVolumeGapRem = 0.3;
constexpr double kVolumeMeterRem = 5.5;
constexpr double kVolumeTrackRem = 5.0;
constexpr double kVolumeTrackHeightRem = 0.18;
constexpr double kTopScrimRem = 10.0;
constexpr double kBottomScrimRem = 19.0;

constexpr Color kInk = Rgb(0xF6F7FA);
constexpr Color kInkMuted = Rgb(0xFFFFFF, 0.67);       // #fffa
constexpr Color kFill = Rgb(0x67BAFF);                 // the cinema chrome's --player-fill
constexpr Color kTrack = Rgb(0xFFFFFF, 0x45 / 255.0);  // #ffffff45
constexpr Color kHover = Rgb(0xFFFFFF, 0x15 / 255.0);  // #ffffff15
constexpr Color kMarkPlate = Rgb(0x2F6BFF);
constexpr char kMarkImage[] = "asset:tvm-icon.png";

// The glyphs, from PlayerGlyph in CinemaControls.tsx and IconVolume in Icons.tsx, in a 32 unit square.
constexpr char kBackPath[] = "m17 6-10 10 10 10M8 16h20";
constexpr char kPlayPath[] = "m10 5 18 11-18 11z";
constexpr char kPausePath[] = "M8 5h6v22H8zm10 0h6v22h-6z";
constexpr char kSeekPath[] = "M8 8a11 11 0 1 1-3 10M8 2v7H1";
constexpr char kFullscreenPath[] = "M4 12V4h8m8 0h8v8M4 20v8h8m8 0h8v-8";
constexpr char kExitFullscreenPath[] = "M12 4v8H4m16-8v8h8M12 28v-8H4m16 8v-8h8";
constexpr char kSpeakerPath[] = "M6 13h4l6-5v16l-6-5H6z";
constexpr char kWavesPath[] = "M20 12.5a5 5 0 0 1 0 7M23 10a8.5 8.5 0 0 1 0 12";
constexpr char kMutedPath[] = "m20 12 7 8M27 12l-7 8";
constexpr double kGlyphStroke = 1.8;

// useIdleChrome: the chrome hides after three seconds, and the cinema chrome fades over 180 ms.
constexpr double kIdleHideMs = 3000.0;
constexpr double kIdleFadeMs = 180.0;
constexpr double kSpinnerPeriodMs = 900.0;

constexpr char kBackKey[] = "back";
constexpr char kRewindKey[] = "rewind";
constexpr char kPlayKey[] = "play";
constexpr char kForwardKey[] = "forward";
constexpr char kMuteKey[] = "mute";
constexpr char kFullscreenKey[] = "fullscreen";
constexpr char kRetryKey[] = "retry";
constexpr char kErrorBackKey[] = "error-back";
constexpr char kBackLabel[] = "Back to browse";
constexpr char kSubtitlesKey[] = "cc";
constexpr char kAudioKey[] = "audio";
constexpr char kQualityKey[] = "quality";
constexpr char kSpeedKey[] = "speed";
constexpr char kNextPlayKey[] = "next-play";
constexpr char kNextDismissKey[] = "next-dismiss";
constexpr char kMenuPrefix[] = "menu:";
constexpr char kDownloadKey[] = "download";
constexpr char kWatchlistKey[] = "watchlist";
constexpr char kGoLiveKey[] = "go-live";
// PlayerGlyph's download arrow and IconWatchlist's bookmark, in a 32 unit square.
constexpr char kDownloadPath[] = "M16 3v18m-7-7 7 7 7-7M5 23v6h22v-6";
constexpr char kBookmarkPath[] = "M9 6.5h14v19l-7-4.5-7 4.5Z";
constexpr double kBrandWidthRem = 5.4;
constexpr double kActionGapRem = 1.2;
constexpr double kWatchlistWidthRem = 6.2;
constexpr char kRecapKey[] = "recap";
constexpr char kCreditsSkipKey[] = "credits-skip";
constexpr char kCreditsWatchKey[] = "credits-watch";
// How long a held arrow's target stays in the preview after its last step.
constexpr double kHoldPreviewMs = 1200.0;
// The trickplay thumbnail, 16:9, over the time bubble.
constexpr double kThumbWidthRem = 11.0;

// The menus, from the cinema chrome's `.player-*__menu`: a dark panel over its button.
constexpr double kMenuWidthRem = 17.0;
constexpr double kMenuRowRem = 2.6;
constexpr double kMenuPadRem = 0.55;
constexpr double kMenuHeadingRem = 1.6;
constexpr std::size_t kMenuRowsShown = 9;
constexpr Color kMenuFill = Rgb(0x171A20, 0.98);
constexpr Color kMenuBorder = Rgb(0xFFFFFF, 0x1C / 255.0);

// Next Up, from NextUp.tsx: its card at the right, over the dock.
constexpr double kNextWidthRem = 26.0;
constexpr double kNextHeightRem = 7.6;

Color WithAlpha(Color color, double alpha) {
    color.a *= alpha;
    return color;
}

bool Contains(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

Command Action(const std::string& name) {
    Command command;
    command.name = name;
    command.action = true;
    return command;
}

std::string Fixed(double value, const char* format) {
    char text[32];
    std::snprintf(text, sizeof(text), format, value);
    return text;
}

// A glyph centred in a box, `size` pixels square.
Box GlyphBox(const Box& box, double size) {
    return Box{box.CenterX() - size / 2.0, box.CenterY() - size / 2.0, size, size};
}

// Text centred in a box, measured by the painter.
void CenteredText(Painter& painter, const Box& box, std::string_view text, const TextStyle& style, Color color) {
    const double width = painter.MeasureText(text, style);
    painter.Text(Box{box.CenterX() - width / 2.0, box.y, width + 2.0, box.height}, text, style, color);
}

}  // namespace

std::string FormatClock(double seconds) {
    const long total = std::isfinite(seconds) && seconds > 0.0 ? static_cast<long>(std::floor(seconds)) : 0;
    const long hours = total / 3600;
    const long minutes = (total / 60) % 60;
    const long secs = total % 60;
    char text[32];
    if (hours > 0) {
        std::snprintf(text, sizeof(text), "%ld:%02ld:%02ld", hours, minutes, secs);
    } else {
        std::snprintf(text, sizeof(text), "%ld:%02ld", minutes, secs);
    }
    return text;
}

void PlayerScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

double NextUpWindowSeconds(double duration) {
    if (!std::isfinite(duration) || duration <= 0.0) return 45.0;
    return std::min(45.0, std::max(1.0, duration * 0.2));
}

double CreditsWindowSeconds(double duration) {
    if (!std::isfinite(duration) || duration <= 0.0) return 0.0;
    return std::min(std::min(18.0, std::max(8.0, duration * 0.06)), duration * 0.35);
}

double HoldSkipStep(double heldMs) {
    if (heldMs >= 1500.0) return 60.0;
    if (heldMs >= 700.0) return 30.0;
    return 10.0;
}

std::string RemainingLabel(double seconds) {
    if (!std::isfinite(seconds) || seconds < 0.5) return "";
    return FormatClock(seconds) + " left";
}

std::string DriftLabel(double seconds) {
    const long whole = std::lround(std::max(0.0, seconds));
    if (whole < 60) return std::to_string(whole) + "s behind";
    const long minutes = whole / 60;
    if (minutes < 60) return std::to_string(minutes) + " min behind";
    const long hours = minutes / 60;
    const long rest = minutes % 60;
    return rest == 0 ? std::to_string(hours) + "h behind"
                     : std::to_string(hours) + "h " + std::to_string(rest) + "m behind";
}

double PlayerScreen::HintsOpacity(double nowMs) const {
    if (hintsFromMs_ <= 0.0 || nowMs < hintsFromMs_) return 0.0;
    const bool reduced = motion::PrefersReducedMotion(motion_);
    // In over the slow motion token, out over the hints' own fade once they are asked to leave or run out.
    const double leave = hintsLeaveMs_ > 0.0 ? hintsLeaveMs_ : hintsFromMs_ + kHintsShowMs;
    if (nowMs >= leave) return reduced ? 0.0 : std::clamp(1.0 - (nowMs - leave) / kHintsFadeMs, 0.0, 1.0);
    return reduced ? 1.0 : std::clamp((nowMs - hintsFromMs_) / 260.0, 0.0, 1.0);
}

void PlayerScreen::HoldPreview(double seconds, double nowMs) {
    holdSeconds_ = seconds;
    holdUntilMs_ = nowMs + kHoldPreviewMs;
    ShowChrome(nowMs);
}

std::optional<double> PlayerScreen::PreviewSeconds() const {
    if (view_.duration <= 0.0 || view_.live || view_.phase != PlayerView::Phase::Playing) return std::nullopt;
    if (scrub_.has_value()) return *scrub_ * view_.duration;
    if (clockMs_ < holdUntilMs_) return std::clamp(holdSeconds_, 0.0, view_.duration);
    if (hover_.has_value()) return *hover_ * view_.duration;
    return std::nullopt;
}

void PlayerScreen::SetView(const PlayerView& view, double nowMs) {
    const bool phaseChanged = view.phase != view_.phase;
    const bool nextAppeared = view.nextUp && !view_.nextUp;
    const bool recapAppeared = view.recap && !view_.recap;
    const bool creditsAppeared = view.credits && !view_.credits;
    view_ = view;
    // The hints come up once the picture is up, after the loader has had a moment to clear.
    if (view_.hints && view_.started && hintsFromMs_ <= 0.0) hintsFromMs_ = nowMs + kHintsSettleMs;
    // Skip recap and Skip credits take the focus when they appear, so OK skips, as on the web.
    if (recapAppeared) focused_ = kRecapKey;
    if (creditsAppeared) focused_ = kCreditsSkipKey;
    if (!view_.recap && focused_ == kRecapKey) focused_ = kPlayKey;
    if (!view_.credits && (focused_ == kCreditsSkipKey || focused_ == kCreditsWatchKey)) focused_ = kPlayKey;
    if (phaseChanged) {
        // Each card starts on its first button: Play over the picture, Retry on the error card.
        focused_ = view_.phase == PlayerView::Phase::Error ? kRetryKey : kPlayKey;
        menu_.clear();
        ShowChrome(nowMs);
    }
    // Next Up takes the focus when it appears, so OK plays the next episode, as NextUp.tsx focuses it.
    if (nextAppeared) focused_ = kNextPlayKey;
    if (!view_.nextUp && (focused_ == kNextPlayKey || focused_ == kNextDismissKey)) focused_ = kPlayKey;
    // A menu whose rows went away closes.
    if (MenuOpen() && MenuOptions(menu_).empty()) CloseMenu();
}

void PlayerScreen::CloseMenu() {
    if (!menu_.empty()) focused_ = menu_;
    menu_.clear();
}

std::vector<std::string> PlayerScreen::ToolKeys() const {
    std::vector<std::string> keys;
    if (!view_.subtitles.empty()) keys.push_back(kSubtitlesKey);
    if (view_.audios.size() > 1) keys.push_back(kAudioKey);
    if (!view_.qualities.empty()) keys.push_back(kQualityKey);
    if (!view_.live) keys.push_back(kSpeedKey);
    return keys;
}

std::string PlayerScreen::ToolLabel(const std::string& key) const {
    if (key == kSubtitlesKey) return "CC";
    if (key == kAudioKey) return "Audio";
    if (key == kQualityKey) return view_.qualityLabel.empty() ? "Quality" : view_.qualityLabel;
    if (key == kSpeedKey) return view_.speed == 1.0 ? "1\xC3\x97" : Fixed(view_.speed, "%g\xC3\x97");
    return "";
}

std::vector<PlayerOption> PlayerScreen::MenuOptions(const std::string& menu) const {
    if (menu == kSubtitlesKey) return view_.subtitles;
    if (menu == kAudioKey) return view_.audios;
    if (menu == kQualityKey) return view_.qualities;
    if (menu == kSpeedKey) {
        std::vector<PlayerOption> speeds;
        for (const double speed : kPlaybackSpeeds) {
            speeds.push_back(PlayerOption{Fixed(speed, "%g"), speed == 1.0 ? "Normal" : Fixed(speed, "%g\xC3\x97"), "",
                                          std::abs(speed - view_.speed) < 0.01});
        }
        return speeds;
    }
    return {};
}

std::optional<Box> PlayerScreen::MenuBox() const {
    if (!MenuOpen()) return std::nullopt;
    const std::optional<Box> button = BoxOf(menu_);
    if (!button.has_value()) return std::nullopt;
    const std::size_t rows = std::min(MenuOptions(menu_).size(), kMenuRowsShown);
    const double height = Rem(kMenuPadRem) * 2.0 + Rem(kMenuHeadingRem) + static_cast<double>(rows) * Rem(kMenuRowRem);
    const double width = Rem(menu_ == kQualityKey ? kMenuWidthRem * 1.6 : kMenuWidthRem);
    const double x = std::clamp(button->Right() - width, Rem(kPadXRem), width_ - Rem(kPadXRem) - width);
    return Box{x, button->y - Rem(1.0) - height, width, height};
}

std::optional<double> PlayerScreen::ShareAt(double x) const {
    const Box track = TrackBox();
    if (track.width <= 0.0) return std::nullopt;
    return std::clamp((x - track.x) / track.width, 0.0, 1.0);
}

void PlayerScreen::Hover(std::optional<double> share) {
    hover_ = share;
}

void PlayerScreen::Scrub(double share) {
    scrub_ = std::clamp(share, 0.0, 1.0);
    ShowChrome(clockMs_);
}

std::optional<double> PlayerScreen::EndScrub() {
    if (!scrub_.has_value()) return std::nullopt;
    const double share = *scrub_;
    scrub_.reset();
    if (view_.duration <= 0.0) return std::nullopt;
    return share * view_.duration;
}

void PlayerScreen::ShowChrome(double nowMs) {
    lastActivityMs_ = nowMs;
    // Input sends the hints away, once they have been up long enough not to catch the press that opened them.
    if (hintsFromMs_ > 0.0 && hintsLeaveMs_ <= 0.0 && nowMs - hintsFromMs_ >= kHintsGraceMs) hintsLeaveMs_ = nowMs;
}

double PlayerScreen::ChromeOpacity(double nowMs) const {
    // The chrome stays while the title is paused, waiting, or not yet started, and while a menu or a drag
    // is in use.
    if (view_.paused || view_.buffering || !view_.started || MenuOpen() || scrub_.has_value()) return 1.0;
    const double idle = nowMs - lastActivityMs_ - kIdleHideMs;
    if (idle <= 0.0) return 1.0;
    if (motion::PrefersReducedMotion(motion_)) return 0.0;
    return std::clamp(1.0 - idle / kIdleFadeMs, 0.0, 1.0);
}

bool PlayerScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    // The hints leave with the chrome, as RemoteHints hides itself when the controls go.
    if (hintsFromMs_ > 0.0 && nowMs >= hintsFromMs_ && hintsLeaveMs_ <= 0.0 && ChromeOpacity(nowMs) < 1.0) {
        hintsLeaveMs_ = nowMs;
    }
    buttonFocus_.Track(focused_, nowMs, motion_);
    return Animating();
}

bool PlayerScreen::Animating() const {
    if (buttonFocus_.Animating(clockMs_)) return true;
    // The spinner turns, and the chrome's timer runs, only while they are on screen.
    if (view_.phase == PlayerView::Phase::Resolving) return true;
    if (view_.phase != PlayerView::Phase::Playing) return false;
    if (!view_.started || view_.buffering) return true;
    if (hintsFromMs_ > 0.0 && (clockMs_ < hintsFromMs_ || HintsOpacity(clockMs_) > 0.0)) return true;
    // The live pill pulses, and a held arrow's preview runs out on the clock.
    if (view_.live || clockMs_ < holdUntilMs_) return ChromeOpacity(clockMs_) > 0.0 || clockMs_ < holdUntilMs_;
    return ChromeOpacity(clockMs_) > 0.0;
}

std::vector<std::string> PlayerScreen::Items() const {
    switch (view_.phase) {
    case PlayerView::Phase::Error:
        return {kRetryKey, kErrorBackKey};
    case PlayerView::Phase::Playing: {
        // A live channel has no seeking, as CinemaControls leaves out the two seek buttons.
        std::vector<std::string> items = {kBackKey};
        if (!view_.live) items.push_back(kDownloadKey);
        if (view_.canSave) items.push_back(kWatchlistKey);
        if (view_.live && view_.liveBehind >= kLiveDriftThreshold) items.push_back(kGoLiveKey);
        items.push_back(kPlayKey);
        if (!view_.live) {
            items.push_back(kRewindKey);
            items.push_back(kForwardKey);
        }
        items.push_back(kMuteKey);
        for (const std::string& tool : ToolKeys()) items.push_back(tool);
        items.push_back(kFullscreenKey);
        if (view_.nextUp) {
            items.push_back(kNextPlayKey);
            items.push_back(kNextDismissKey);
        }
        if (view_.recap) items.push_back(kRecapKey);
        if (view_.credits) {
            items.push_back(kCreditsSkipKey);
            items.push_back(kCreditsWatchKey);
        }
        return items;
    }
    case PlayerView::Phase::Resolving:
        break;
    }
    return {kBackKey};
}

Box PlayerScreen::TrackBox() const {
    const double toolbarTop = height_ - Rem(kFooterBottomRem) - Rem(kToolbarRem);
    const double y = toolbarTop - Rem(kTimelineGapRem) - Rem(kTimelineRem);
    const double x = Rem(kPadXRem) + Rem(kTimeWidthRem) + Rem(kTimeGapRem);
    const double width = width_ - 2.0 * x;
    return Box{x, y, std::max(0.0, width), Rem(kTimelineRem)};
}

Box PlayerScreen::VolumeTrackBox() const {
    const Box mute = *BoxOf(kMuteKey);
    return Box{mute.Right() + Rem(kVolumeGapRem) + Rem(0.2), mute.y, Rem(kVolumeTrackRem), mute.height};
}

std::optional<Box> PlayerScreen::BoxOf(const std::string& key) const {
    const double x = Rem(kPadXRem);
    if (key == kBackKey) {
        // .cinema-chrome__back: the arrow, then "Back to browse".
        const double width = Rem(0.3 + kGlyphRem + 0.7 + 0.8) +
                             static_cast<double>(std::string_view(kBackLabel).size()) * 0.53 * Rem(kBackFontRem);
        return Box{x, Rem(kHeaderTopRem), width, Rem(kBackHeightRem)};
    }
    // `.cinema-chrome__actions`: Download and My List, left of the TVM CINEMA mark.
    const double actionTop = Rem(kHeaderTopRem) + (Rem(kBackHeightRem) - Rem(kButtonRem)) / 2.0;
    const double watchlistX = width_ - x - Rem(kBrandWidthRem) - Rem(kActionGapRem) - Rem(kWatchlistWidthRem);
    if (key == kWatchlistKey) return Box{watchlistX, actionTop, Rem(kWatchlistWidthRem), Rem(kButtonRem)};
    if (key == kDownloadKey) {
        const double right = view_.canSave ? watchlistX - Rem(kActionGapRem) : watchlistX + Rem(kWatchlistWidthRem);
        return Box{right - Rem(kButtonRem), actionTop, Rem(kButtonRem), Rem(kButtonRem)};
    }
    // Back to live, at the right under the header, as GoLive sits at the top right.
    if (key == kGoLiveKey) {
        const double width = Rem(13.0);
        return Box{width_ - x - width, Rem(kHeaderTopRem) + Rem(kBackHeightRem) + Rem(0.6), width, Rem(2.5)};
    }

    // The toolbar, left to right: play, back ten, forward ten, the sound. Full screen sits at the right.
    const double center = height_ - Rem(kFooterBottomRem) - Rem(kToolbarRem) / 2.0;
    const double button = Rem(kButtonRem);
    const double top = center - button / 2.0;
    double left = x;
    const auto next = [&](double width) {
        const Box box{left, top, width, button};
        left += width + Rem(kToolGapRem);
        return box;
    };
    const Box play = next(Rem(kPlayWidthRem));
    if (key == kPlayKey) return play;
    if (!view_.live) {
        const Box rewind = next(button);
        if (key == kRewindKey) return rewind;
        const Box forward = next(button);
        if (key == kForwardKey) return forward;
    }
    if (key == kMuteKey) return Box{left, top, button, button};
    const Box fullscreen{width_ - x - button, top, button, button};
    if (key == kFullscreenKey) return fullscreen;

    // The tools sit left of full screen, in order, each as wide as its word.
    const std::vector<std::string> tools = ToolKeys();
    double right = fullscreen.x - Rem(kToolGapRem);
    for (auto tool = tools.rbegin(); tool != tools.rend(); ++tool) {
        const double width =
            std::max(button, static_cast<double>(ToolLabel(*tool).size()) * 0.55 * Rem(0.85) + Rem(1.4));
        if (key == *tool) return Box{right - width, top, width, button};
        right -= width + Rem(kToolGapRem);
    }

    // Next Up's card, at the right over the timeline, and its two buttons.
    const Box card = Box{width_ - x - Rem(kNextWidthRem), TrackBox().y - Rem(1.2) - Rem(kNextHeightRem),
                         Rem(kNextWidthRem), Rem(kNextHeightRem)};
    if (key == "next-card") return card;

    // Skip recap and the credits' two buttons sit at the right, just over the timeline, as the cinema
    // chrome's recap slot places them.
    const double endY = TrackBox().y - Rem(1.4) - button;
    if (key == kRecapKey) return Box{width_ - x - Rem(9.2), endY, Rem(9.2), button};
    if (key == kCreditsWatchKey) return Box{width_ - x - Rem(9.6), endY, Rem(9.6), button};
    if (key == kCreditsSkipKey) return Box{width_ - x - Rem(9.6) - Rem(0.7) - Rem(11.6), endY, Rem(11.6), button};
    const double bodyX = card.x + Rem(0.6) + Rem(9.6) + Rem(0.9);
    if (key == kNextPlayKey) return Box{bodyX, card.Bottom() - Rem(0.7) - Rem(2.3), Rem(7.4), Rem(2.3)};
    if (key == kNextDismissKey) return Box{bodyX + Rem(7.9), card.Bottom() - Rem(0.7) - Rem(2.3), Rem(7.2), Rem(2.3)};

    // The error card's buttons, under its copy.
    const double y = height_ * 0.5 + Rem(3.5);
    if (key == kRetryKey) return Box{x, y, Rem(9.0), Rem(3.25)};
    if (key == kErrorBackKey) return Box{x + Rem(10.5), y, Rem(9.0), Rem(3.25)};
    return std::nullopt;
}

void PlayerScreen::Paint(Painter& painter) const {
    switch (view_.phase) {
    case PlayerView::Phase::Resolving:
        painter.Clear(Rgb(0x000000));
        PaintQueue(painter);
        return;
    case PlayerView::Phase::Error:
        painter.Clear(Rgb(0x000000));
        PaintError(painter);
        return;
    case PlayerView::Phase::Playing:
        break;
    }
    // Until the first frame the queue card stays over mpv's black window, as the web overlay does.
    if (!view_.started) {
        PaintQueue(painter);
        return;
    }
    const double opacity = ChromeOpacity(clockMs_);
    if (opacity > 0.0) {
        PaintChrome(painter, opacity);
        PaintTitleOverlay(painter, opacity);
        PaintPreview(painter, opacity);
    }
    if (opacity > 0.0 && MenuOpen()) PaintMenu(painter);
    if (view_.buffering) PaintSpinner(painter);
    // Next Up, Skip recap and Skip credits are their own layer, shown whether or not the chrome is.
    if (view_.nextUp) PaintNextUp(painter);
    PaintEndActions(painter);
    PaintHints(painter);
}

void PlayerScreen::PaintGoLive(Painter& painter, double opacity) const {
    // `.player__go-live`: a dark pill with a pulsing red dot, "Back to live", and how far behind.
    const Box box = *BoxOf(kGoLiveKey);
    const bool focused = focused_ == kGoLiveKey;
    painter.FillRoundRect(box, box.height / 2.0, WithAlpha(focused ? Rgb(0x181820, 0.92) : Rgb(0x0C0C10, 0.72), opacity));
    painter.StrokeRoundRect(box, box.height / 2.0, 1.0, WithAlpha(Rgb(0xFFFFFF, focused ? 0.45 : 0.22), opacity));
    const double dot = Rem(0.55);
    const double dotX = box.x + Rem(1.0);
    const double pulse = motion::PrefersReducedMotion(motion_) ? 0.0 : std::fmod(clockMs_ / 2000.0, 1.0);
    if (pulse < 0.7) {
        const double ring = dot + Rem(1.0) * (pulse / 0.7);
        painter.FillRoundRect(Box{dotX + dot / 2.0 - ring / 2.0, box.CenterY() - ring / 2.0, ring, ring}, ring / 2.0,
                              Rgb(0xFF3B30, 0.6 * (1.0 - pulse / 0.7) * opacity));
    }
    painter.FillRoundRect(Box{dotX, box.CenterY() - dot / 2.0, dot, dot}, dot / 2.0, WithAlpha(Rgb(0xFF3B30), opacity));
    const TextStyle labelStyle{Rem(0.95), true, 600};
    const double labelX = dotX + dot + Rem(0.6);
    const double labelWidth = painter.MeasureText("Back to live", labelStyle);
    painter.Text(Box{labelX, box.y, labelWidth + 2.0, box.height}, "Back to live", labelStyle, Rgb(0xFFFFFF, opacity));
    painter.Text(Box{labelX + labelWidth + Rem(0.6), box.y, box.Right() - labelX - labelWidth, box.height},
                 DriftLabel(view_.liveBehind), TextStyle{Rem(0.8), false, 500}, Rgb(0xFFFFFF, 0.65 * opacity));
}

void PlayerScreen::PaintHints(Painter& painter) const {
    const double opacity = HintsOpacity(clockMs_);
    if (opacity <= 0.0) return;
    // `.player-remote-hints__phrase`: a dark pill of lessons, each its keys then its action, centred over the dock.
    struct Lesson {
        std::vector<std::string> keys;
        std::string action;
    };
    std::vector<Lesson> lessons;
    if (!view_.live) lessons.push_back({{"Left", "Right"}, "Skip"});
    lessons.push_back({{"OK"}, "Pause"});
    lessons.push_back({{"Back"}, "Exit"});

    const TextStyle keyStyle{Rem(0.68), true, 750};
    const TextStyle actionStyle{Rem(0.8125), true, 650};
    const auto upper = [](std::string text) {
        for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        return text;
    };
    double width = Rem(0.7) + Rem(0.85);
    for (std::size_t i = 0; i < lessons.size(); ++i) {
        for (const std::string& key : lessons[i].keys) {
            width += std::max(Rem(2.05), painter.MeasureText(upper(key), keyStyle) + Rem(0.84)) + Rem(0.22);
        }
        width += Rem(0.2) + painter.MeasureText(upper(lessons[i].action), actionStyle);
        if (i + 1 < lessons.size()) width += Rem(0.95) + Rem(0.34);
    }
    // It rises 0.45rem into place as it comes in.
    const double rise = Rem(0.45) * (1.0 - opacity);
    const double height = Rem(1.45) + Rem(0.96);
    const Box pill{width_ / 2.0 - width / 2.0, height_ - Rem(1.5) - Rem(10.4) - height + rise, width, height};
    painter.FillRoundRect(pill, height / 2.0, Rgb(0x000000, 0.76 * opacity));
    painter.FillLinearGradient(Box{pill.x + height / 2.0, pill.y + 1.0, pill.width - height, pill.height * 0.46}, 0.0,
                               pill.y, 0.0, pill.y + pill.height * 0.46,
                               {GradientStop{0.0, Rgb(0xFFFFFF, 0.08 * opacity)}, GradientStop{1.0, Rgb(0xFFFFFF, 0.0)}});
    painter.StrokeRoundRect(pill, height / 2.0, 1.0, Rgb(0x6EC8FF, 0.18 * opacity));

    double x = pill.x + Rem(0.7);
    const double keyHeight = Rem(1.45);
    const double keyY = pill.CenterY() - keyHeight / 2.0;
    std::size_t keyIndex = 0;
    for (std::size_t i = 0; i < lessons.size(); ++i) {
        if (i > 0) {
            painter.FillRoundRect(Box{x, pill.CenterY() - Rem(0.11), Rem(0.22), Rem(0.22)}, Rem(0.11),
                                  Rgb(0x8A8A8A, 0.5 * opacity));
            x += Rem(0.34);
        }
        for (const std::string& key : lessons[i].keys) {
            const std::string label = upper(key);
            const double keyWidth = std::max(Rem(2.05), painter.MeasureText(label, keyStyle) + Rem(0.84));
            const Box cap{x, keyY, keyWidth, keyHeight};
            // Each key lights in turn, a press every 0.55 s, as the hints' keyframes do.
            const double phase = std::fmod((clockMs_ - hintsFromMs_) / 2600.0 - static_cast<double>(keyIndex) * 0.55 / 2.6 + 1.0, 1.0);
            const double press = motion::PrefersReducedMotion(motion_) ? 0.0 : std::max(0.0, 1.0 - std::abs(phase - 0.38) / 0.2);
            painter.FillRoundRect(cap, Rem(0.38), Rgb(0xFFFFFF, (0.07 + 0.13 * press) * opacity));
            painter.StrokeRoundRect(cap, Rem(0.38), 1.0, Rgb(0xFFFFFF, 0.26 * opacity));
            CenteredText(painter, cap, label, keyStyle, Rgb(0xF5F5F5, opacity));
            x += keyWidth + Rem(0.22);
            ++keyIndex;
        }
        x += Rem(0.2);
        const std::string action = upper(lessons[i].action);
        const double actionWidth = painter.MeasureText(action, actionStyle);
        painter.Text(Box{x, pill.y, actionWidth + 2.0, pill.height}, action, actionStyle, Rgb(0xF5F5F5, 0.78 * opacity));
        x += actionWidth + Rem(0.95);
    }
}

void PlayerScreen::PaintTitleOverlay(Painter& painter, double opacity) const {
    // TitleOverlay.tsx: the kicker, the title with its short accent rule, then the episode and the time left.
    const double x = Rem(kPadXRem);
    const double top = Rem(kHeaderTopRem) + Rem(kBackHeightRem) + Rem(1.4);
    const Color ink = WithAlpha(kInk, opacity);
    if (view_.live) {
        const TextStyle liveStyle{Rem(0.72), true, 800};
        const Box pill{x, top, painter.MeasureText("LIVE", liveStyle) + Rem(1.6), Rem(1.35)};
        painter.FillRoundRect(pill, pill.height / 2.0, WithAlpha(Rgb(0xFF6B6B), opacity));
        const double pulse = motion::PrefersReducedMotion(motion_) ? 1.0 : 0.65 + 0.35 * std::cos(clockMs_ / 1400.0 * 2.0 * kPi);
        painter.FillRoundRect(Box{pill.x + Rem(0.45), pill.CenterY() - Rem(0.22), Rem(0.44), Rem(0.44)}, Rem(0.22),
                              Rgb(0xFFFFFF, opacity * pulse));
        painter.Text(Box{pill.x + Rem(1.05), pill.y, pill.width, pill.height}, "LIVE", liveStyle, ink);
    } else {
        painter.Text(Box{x, top, Rem(20.0), Rem(1.3)}, "NOW PLAYING", TextStyle{Rem(0.8), true, 800},
                     WithAlpha(kFill, opacity));
    }
    const std::string title = view_.title == "Loading" ? "" : view_.title;
    if (title.empty()) return;
    const double size = std::clamp(width_ * 0.052, Rem(2.25), Rem(3.85));
    const double titleY = top + Rem(1.72);
    const Box titleBox{x, titleY, std::min(width_ * 0.76, Rem(56.0)), size * 1.15};
    // --player-shadow: a soft dark halo, so the title reads over a bright frame.
    for (const auto [dx, dy, alpha] : {std::tuple{0.0, 2.0, 0.55}, std::tuple{1.5, 3.5, 0.3}, std::tuple{-1.5, 3.5, 0.3}}) {
        painter.Text(Box{titleBox.x + dx, titleBox.y + dy, titleBox.width, titleBox.height}, title,
                     TextStyle{size, true, 800}, Rgb(0x000000, alpha * opacity));
    }
    painter.Text(titleBox, title, TextStyle{size, true, 800}, ink);
    const double ruleY = titleY + size * 1.1 + Rem(0.4);
    painter.FillRoundRect(Box{x, ruleY, Rem(3.4), Rem(0.18)}, Rem(0.09), WithAlpha(kFill, opacity));

    // The meta line: the episode, a dot, and the time left.
    const std::string remaining = view_.live ? "" : RemainingLabel(view_.duration - view_.position);
    if (view_.episode.empty() && remaining.empty()) return;
    const TextStyle metaStyle{Rem(1.25), true, 600};
    const double metaY = ruleY + Rem(0.75);
    double left = x;
    if (!view_.episode.empty() && !view_.live) {
        const double width = painter.MeasureText(view_.episode, metaStyle);
        painter.Text(Box{left, metaY, width + 2.0, Rem(1.8)}, view_.episode, metaStyle, WithAlpha(kInkMuted, opacity));
        left += width + Rem(0.6);
        if (!remaining.empty()) {
            painter.FillRoundRect(Box{left, metaY + Rem(0.75), Rem(0.3), Rem(0.3)}, Rem(0.15), WithAlpha(kFill, 0.7 * opacity));
            left += Rem(0.9);
        }
    }
    if (!remaining.empty()) {
        painter.Text(Box{left, metaY, Rem(14.0), Rem(1.8)}, remaining, metaStyle, WithAlpha(kInkMuted, opacity));
    }
}

void PlayerScreen::PaintPreview(Painter& painter, double opacity) const {
    // Trickplay: the thumbnail for the time being previewed, with the time under it, over the bar.
    const std::optional<double> seconds = PreviewSeconds();
    if (!seconds.has_value()) return;
    const Box track = TrackBox();
    const double share = view_.duration > 0.0 ? *seconds / view_.duration : 0.0;
    const double centerX = track.x + track.width * share;
    const std::string at = FormatClock(*seconds);
    const TextStyle bubbleStyle{Rem(0.72), true, 600};
    const double bubbleWidth = painter.MeasureText(at, bubbleStyle) + Rem(1.0);
    const double bubbleX = std::clamp(centerX - bubbleWidth / 2.0, 0.0, width_ - bubbleWidth);
    const Box bubble{bubbleX, track.CenterY() - Rem(2.4), bubbleWidth, Rem(1.5)};

    // The thumbnail shows once one has been made for this stretch of the title, within ten seconds.
    if (!view_.thumbnail.empty() && std::abs(view_.thumbnailTime - *seconds) <= 10.0) {
        const double thumbWidth = Rem(kThumbWidthRem);
        const double thumbHeight = thumbWidth * 9.0 / 16.0;
        const double thumbX = std::clamp(centerX - thumbWidth / 2.0, Rem(kPadXRem), width_ - Rem(kPadXRem) - thumbWidth);
        const Box thumb{thumbX, bubble.y - Rem(0.4) - thumbHeight, thumbWidth, thumbHeight};
        painter.FillRoundRect(Box{thumb.x - 2.0, thumb.y - 2.0, thumb.width + 4.0, thumb.height + 4.0}, Rem(0.45),
                              WithAlpha(kMenuFill, opacity));
        painter.ImageFaded(thumb, "file:" + view_.thumbnail, Rem(0.4), opacity, 0.5, 0.5);
        painter.StrokeRoundRect(thumb, Rem(0.4), 1.0, WithAlpha(kMenuBorder, opacity));
    }
    painter.FillRoundRect(bubble, Rem(0.3), WithAlpha(kMenuFill, opacity));
    CenteredText(painter, bubble, at, bubbleStyle, WithAlpha(kInk, opacity));
}

void PlayerScreen::PaintEndActions(Painter& painter) const {
    // `.cinema-chrome__recap .tvm-button`: a light button with dark words.
    const auto light = [&](const char* key, const std::string& label) {
        const Box box = *BoxOf(key);
        const bool focused = focused_ == key;
        painter.FillRoundRect(box, Rem(0.3), focused ? Rgb(0xFFFFFF) : Rgb(0xF5F5F5, 0.94));
        if (focused) {
            const double ring = Rem(0.2);
            painter.StrokeRoundRect(Box{box.x - ring, box.y - ring, box.width + 2.0 * ring, box.height + 2.0 * ring},
                                    Rem(0.45), 2.0, Rgb(0xFFFFFF));
        }
        CenteredText(painter, box, label, TextStyle{Rem(0.85), true, 700}, Rgb(0x14171C));
    };
    if (view_.recap) light(kRecapKey, "Skip recap");
    if (view_.credits) {
        const long total = static_cast<long>(std::ceil(std::max(0.0, view_.creditsRemaining)));
        char remain[16];
        std::snprintf(remain, sizeof(remain), "%ld:%02ld", total / 60, total % 60);
        light(kCreditsSkipKey, std::string("Skip credits  ") + remain);
        const Box watch = *BoxOf(kCreditsWatchKey);
        painter.FillRoundRect(watch, Rem(0.3), focused_ == kCreditsWatchKey ? Rgb(0x171A20, 0.95) : Rgb(0x171A20, 0.75));
        painter.StrokeRoundRect(watch, Rem(0.3), 1.0, kMenuBorder);
        CenteredText(painter, watch, "Watch credits", TextStyle{Rem(0.85), true, 600}, kInk);
    }
}

void PlayerScreen::PaintMenu(Painter& painter) const {
    const std::optional<Box> panel = MenuBox();
    if (!panel.has_value()) return;
    painter.FillRoundRect(*panel, Rem(0.6), kMenuFill);
    painter.StrokeRoundRect(*panel, Rem(0.6), 1.0, kMenuBorder);
    const std::string heading = menu_ == kSubtitlesKey ? "Subtitles"
                                : menu_ == kAudioKey   ? "Audio"
                                : menu_ == kQualityKey ? "Quality"
                                                       : "Playback speed";
    const double x = panel->x + Rem(kMenuPadRem);
    const double width = panel->width - 2.0 * Rem(kMenuPadRem);
    painter.Text(Box{x + Rem(0.25), panel->y + Rem(kMenuPadRem), width, Rem(kMenuHeadingRem)}, heading,
                 TextStyle{Rem(0.68), true, 600}, Rgb(0xFFFFFF, 0.6));

    // The rows scroll so the focused one is in the panel.
    const std::vector<PlayerOption> options = MenuOptions(menu_);
    const std::size_t first = menuIndex_ >= kMenuRowsShown ? menuIndex_ - kMenuRowsShown + 1 : 0;
    for (std::size_t i = first; i < options.size() && i < first + kMenuRowsShown; ++i) {
        const PlayerOption& option = options[i];
        const Box row{x, panel->y + Rem(kMenuPadRem) + Rem(kMenuHeadingRem) + static_cast<double>(i - first) * Rem(kMenuRowRem),
                      width, Rem(kMenuRowRem)};
        if (i == menuIndex_) painter.FillRoundRect(row, Rem(0.35), kHover);
        const TextStyle labelStyle{Rem(0.8), true, option.selected ? 700 : 550};
        const double labelWidth = painter.MeasureText(option.label, labelStyle);
        painter.Text(Box{row.x + Rem(0.8), row.y, labelWidth + 2.0, row.height}, option.label, labelStyle,
                     option.selected ? kFill : kInk);
        if (!option.detail.empty()) {
            painter.Text(Box{row.x + Rem(1.4) + labelWidth, row.y, row.width - labelWidth - Rem(4.0), row.height},
                         option.detail, TextStyle{Rem(0.72), false, 450}, kInkMuted);
        }
        // The chosen row carries a tick at its end.
        if (option.selected) {
            const double tick = Rem(1.0);
            painter.Path(Box{row.Right() - Rem(0.8) - tick, row.CenterY() - tick / 2.0, tick, tick}, 32.0,
                         "M6 17l7 7 13-15", PathStyle{Color{0, 0, 0, 0}, kFill, 3.0, false});
        }
    }
}

void PlayerScreen::PaintNextUp(Painter& painter) const {
    const Box card = *BoxOf("next-card");
    painter.FillRoundRect(card, Rem(0.8), kMenuFill);
    painter.StrokeRoundRect(card, Rem(0.8), 1.0, kMenuBorder);
    // The drain along the top empties as the episode runs out.
    const double drain = view_.nextWindow > 0.0 ? std::clamp(view_.nextRemaining / view_.nextWindow, 0.0, 1.0) : 0.0;
    painter.FillRoundRect(Box{card.x + Rem(0.8), card.y, (card.width - Rem(1.6)) * drain, Rem(0.18)}, Rem(0.09), kFill);

    const Box still{card.x + Rem(0.6), card.y + Rem(0.6), Rem(9.6), card.height - Rem(1.2)};
    if (view_.nextStill.empty() || !painter.ImageFaded(still, view_.nextStill, Rem(0.45), 1.0, 0.5, 0.3)) {
        painter.FillLinearGradient(still, still.x, still.y, still.Right(), still.Bottom(),
                                   {GradientStop{0.0, Rgb(0x1C1C1F)}, GradientStop{1.0, Rgb(0x101012)}});
    }
    const double x = still.Right() + Rem(0.9);
    const double width = card.Right() - x - Rem(0.8);
    const long seconds = static_cast<long>(std::ceil(std::max(0.0, view_.nextRemaining)));
    painter.Text(Box{x, card.y + Rem(0.55), width, Rem(1.1)}, "UP NEXT \xC2\xB7 in " + std::to_string(seconds) + "s",
                 TextStyle{Rem(0.66), true, 800}, kFill);
    painter.Text(Box{x, card.y + Rem(1.55), width, Rem(1.3)}, view_.nextShow, TextStyle{Rem(0.85), false, 550}, kInkMuted);
    painter.Text(Box{x, card.y + Rem(2.75), width, Rem(1.5)}, view_.nextEpisode, TextStyle{Rem(1.0), true, 700}, kInk);

    const Metrics metrics{height_ / 67.5};
    DrawButton(painter, metrics, *BoxOf(kNextPlayKey), "Play next",
               ButtonLook{true, focused_ == kNextPlayKey, focused_ == kNextPlayKey ? 1.0 : 0.0});
    const Box dismiss = *BoxOf(kNextDismissKey);
    if (focused_ == kNextDismissKey) painter.FillRoundRect(dismiss, dismiss.height / 2.0, kHover);
    CenteredText(painter, dismiss, "Watch credits", TextStyle{Rem(0.8), true, 600}, kInkMuted);
}

void PlayerScreen::PaintQueue(Painter& painter) const {
    // `.player__queue`: the veil at 88% black, and the card centred in it.
    painter.FillRoundRect(Box{0.0, 0.0, width_, height_}, 0.0, Rgb(0x000000, 0.88));
    const double mark = Rem(4.5);
    const Box markBox{width_ / 2.0 - mark / 2.0, height_ / 2.0 - Rem(6.2), mark, mark};
    // The mark breathes, as TvmMark's looped animation does.
    const double breath = motion::PrefersReducedMotion(motion_)
                              ? 1.0
                              : 0.82 + 0.18 * (0.5 + 0.5 * std::sin(clockMs_ / 1400.0 * 2.0 * kPi));
    painter.FillRadialGradient(Box{markBox.x - mark, markBox.y - mark, mark * 3.0, mark * 3.0}, markBox.CenterX(),
                               markBox.CenterY(), mark * 1.4, mark * 1.4,
                               {GradientStop{0.0, Rgb(0x7AD7FF, 0.30 * breath)}, GradientStop{1.0, Rgb(0x7AD7FF, 0.0)}});
    painter.FillRoundRect(markBox, mark * 0.22, kMarkPlate);
    painter.ImageFaded(markBox, kMarkImage, mark * 0.22, 1.0, 0.5, 0.5);

    CenteredText(painter, Box{0.0, markBox.Bottom() + Rem(0.9), width_, Rem(1.2)}, "TVM CINEMA",
                 TextStyle{Rem(0.74), true, 800}, kFill);
    const double heading = std::clamp(width_ * 0.034, Rem(1.7), Rem(2.4));
    CenteredText(painter, Box{0.0, markBox.Bottom() + Rem(2.4), width_, heading * 1.35}, "Getting your stream ready",
                 TextStyle{heading, true, 650}, kInk);
    CenteredText(painter, Box{0.0, markBox.Bottom() + Rem(2.6) + heading * 1.4, width_, Rem(1.6)},
                 "Checking the source and preparing playback. Press Back to cancel.", TextStyle{Rem(1.05), false},
                 kInkMuted);
}

void PlayerScreen::PaintChrome(Painter& painter, double opacity) const {
    // The two scrims: #000b fading down from the top, and #000e through #0007 fading up from the foot.
    const double topHeight = Rem(kTopScrimRem);
    painter.FillLinearGradient(Box{0.0, 0.0, width_, topHeight}, 0.0, 0.0, 0.0, topHeight,
                               {GradientStop{0.0, Rgb(0x000000, 0.733 * opacity)}, GradientStop{1.0, Rgb(0x000000, 0.0)}});
    const double bottomHeight = std::min(height_ * 0.42, Rem(kBottomScrimRem));
    painter.FillLinearGradient(Box{0.0, height_ - bottomHeight, width_, bottomHeight}, 0.0, height_, 0.0,
                               height_ - bottomHeight,
                               {GradientStop{0.0, Rgb(0x000000, 0.933 * opacity)},
                                GradientStop{0.4, Rgb(0x000000, 0.467 * opacity)},
                                GradientStop{1.0, Rgb(0x000000, 0.0)}});

    const Color ink = WithAlpha(kInk, opacity);
    const auto button = [&](const char* key) {
        const Box box = *BoxOf(key);
        // Focus and hover share the desktop shell's look: a faint fill, with no ring and no scale.
        if (focused_ == key) painter.FillRoundRect(box, Rem(kButtonRadiusRem), WithAlpha(kHover, opacity));
        return box;
    };
    const PathStyle line{Color{0, 0, 0, 0}, ink, kGlyphStroke, false};

    // The header: Back to browse at the left, the TVM CINEMA mark at the right.
    const Box back = button(kBackKey);
    const Box backGlyph{back.x + Rem(0.3), back.CenterY() - Rem(kGlyphRem) / 2.0, Rem(kGlyphRem), Rem(kGlyphRem)};
    painter.Path(backGlyph, 32.0, kBackPath, line);
    painter.Text(Box{backGlyph.Right() + Rem(0.7), back.y, back.width, back.height}, kBackLabel,
                 TextStyle{Rem(kBackFontRem), true, 600}, ink);
    const TextStyle brandSmall{Rem(0.52), false, 500};
    const TextStyle brandBig{Rem(0.95), true, 850};
    const double cinemaWidth = painter.MeasureText("C I N E M A", brandSmall);
    const double tvmWidth = painter.MeasureText("TVM", brandBig);
    const double brandRight = width_ - Rem(kPadXRem);
    painter.Text(Box{brandRight - cinemaWidth, back.y, cinemaWidth + 2.0, back.height}, "C I N E M A", brandSmall,
                 WithAlpha(Rgb(0xFFFFFF, 0.6), opacity));
    painter.Text(Box{brandRight - cinemaWidth - Rem(0.55) - tvmWidth, back.y - Rem(0.1), tvmWidth + 2.0, back.height},
                 "TVM", brandBig, Rgb(0xFFFFFF, opacity));

    // The header's actions: Download, then My List with its bookmark, which fills once the title is saved.
    if (!view_.live) {
        const Box download = button(kDownloadKey);
        painter.Path(GlyphBox(download, Rem(1.4)), 32.0, kDownloadPath, line);
    }
    if (view_.canSave) {
        const Box save = button(kWatchlistKey);
        const double mark = Rem(1.0);
        const Box glyph{save.x + Rem(0.6), save.CenterY() - mark / 2.0, mark, mark};
        painter.Path(glyph, 32.0, kBookmarkPath,
                     PathStyle{view_.saved ? ink : Color{0, 0, 0, 0}, ink, 2.0, false});
        painter.Text(Box{glyph.Right() + Rem(0.45), save.y, save.width, save.height}, view_.saved ? "Remove" : "Add",
                     TextStyle{Rem(0.75), true, 650}, ink);
    }
    if (view_.live && view_.liveBehind >= kLiveDriftThreshold) PaintGoLive(painter, opacity);

    // The timeline: the position, the bar, and the length. The knob shows while the bar has the mouse.
    const Box track = TrackBox();
    const TextStyle timeStyle{Rem(0.72), false, 450};
    const std::string now = FormatClock(view_.position);
    painter.Text(Box{Rem(kPadXRem), track.y, Rem(kTimeWidthRem), track.height}, view_.live ? "Live" : now, timeStyle, ink);
    const std::string length = view_.live ? "" : view_.duration > 0.0 ? FormatClock(view_.duration) : "\xE2\x80\x94:\xE2\x80\x94";
    const double lengthWidth = painter.MeasureText(length, timeStyle);
    painter.Text(Box{width_ - Rem(kPadXRem) - lengthWidth, track.y, lengthWidth + 2.0, track.height}, length, timeStyle,
                 ink);
    const double barHeight = Rem(kTrackRem);
    const Box bar{track.x, track.CenterY() - barHeight / 2.0, track.width, barHeight};
    painter.FillRoundRect(bar, barHeight / 2.0, WithAlpha(kTrack, opacity));
    // While a drag is held the bar follows it, so the viewer sees where the seek will land.
    const double played = view_.duration > 0.0 ? std::clamp(view_.position / view_.duration, 0.0, 1.0) : 0.0;
    const double share = scrub_.value_or(played);
    if (share > 0.0) {
        painter.FillRoundRect(Box{bar.x, bar.y, bar.width * share, bar.height}, barHeight / 2.0, WithAlpha(kFill, opacity));
    }
    const std::optional<double> preview = scrub_.has_value() ? scrub_ : hover_;
    if (preview.has_value() || focused_ == "timeline") {
        const double knob = Rem(kKnobRem);
        painter.FillRoundRect(Box{bar.x + bar.width * share - knob / 2.0, bar.CenterY() - knob / 2.0, knob, knob},
                              knob / 2.0, WithAlpha(kFill, opacity));
    }

    // The transport: play or pause, then back and forward ten seconds.
    const Box play = button(kPlayKey);
    painter.Path(GlyphBox(play, Rem(kPlayGlyphRem)), 32.0, view_.paused ? kPlayPath : kPausePath,
                 PathStyle{ink, Color{0, 0, 0, 0}, 0.0, false});
    if (!view_.live) {
        for (const char* key : {kRewindKey, kForwardKey}) {
            const Box box = button(key);
            const Box glyph = GlyphBox(box, Rem(kGlyphRem));
            const bool forward = std::string_view(key) == kForwardKey;
            painter.Path(glyph, 32.0, kSeekPath, PathStyle{Color{0, 0, 0, 0}, ink, kGlyphStroke, forward});
            // The "10" sits at (16, 22) of the glyph, 12 units tall, as the web's <text> does.
            const double unit = glyph.width / 32.0;
            CenteredText(painter, Box{glyph.x, glyph.y + 14.0 * unit, glyph.width, 10.0 * unit}, "10",
                         TextStyle{12.0 * unit, true, 600}, ink);
        }
    }

    // The sound: the speaker, which mutes, then its bar and its level, which runs to 400%.
    const Box mute = button(kMuteKey);
    const Box speaker = GlyphBox(mute, Rem(kGlyphRem));
    const bool silent = view_.muted || view_.volume <= 0.0;
    painter.Path(speaker, 32.0, kSpeakerPath, line);
    painter.Path(speaker, 32.0, silent ? kMutedPath : kWavesPath, line);
    const Box volumeTrack = VolumeTrackBox();
    const double volumeHeight = Rem(kVolumeTrackHeightRem);
    const Box volumeBar{volumeTrack.x, volumeTrack.CenterY() - volumeHeight / 2.0, volumeTrack.width, volumeHeight};
    painter.FillRoundRect(volumeBar, volumeHeight / 2.0, WithAlpha(kTrack, opacity));
    const double level = silent ? 0.0 : std::clamp(view_.volume / kMaxVolume, 0.0, 1.0);
    if (level > 0.0) {
        painter.FillRoundRect(Box{volumeBar.x, volumeBar.y, volumeBar.width * level, volumeBar.height},
                              volumeHeight / 2.0, ink);
    }
    // The mark at 100%, so the boost past it reads at a glance.
    painter.FillRoundRect(Box{volumeBar.x + volumeBar.width / kMaxVolume - 0.5, volumeBar.y - Rem(0.12), 1.0,
                              volumeBar.height + Rem(0.24)},
                          0.0, WithAlpha(kInkMuted, opacity));
    const std::string percent = silent ? "Muted" : Fixed(std::round(view_.volume * 100.0), "%.0f%%");
    painter.Text(Box{volumeTrack.Right() + Rem(0.55), mute.y, Rem(4.0), mute.height}, percent,
                 TextStyle{Rem(0.72), true, 600}, view_.volume > 1.0 && !silent ? WithAlpha(kFill, opacity) : ink);

    // The tools: subtitles, audio, quality and speed, each a word that opens its menu.
    for (const std::string& tool : ToolKeys()) {
        const Box box = button(tool.c_str());
        if (menu_ == tool) painter.FillRoundRect(box, Rem(kButtonRadiusRem), WithAlpha(kHover, opacity));
        // Subtitles read faint while they are off.
        const bool off = tool == kSubtitlesKey &&
                         std::none_of(view_.subtitles.begin(), view_.subtitles.end(),
                                      [](const PlayerOption& option) { return option.selected && option.id != "no"; });
        CenteredText(painter, box, ToolLabel(tool), TextStyle{Rem(0.85), true, 700},
                     off ? WithAlpha(kInkMuted, opacity) : ink);
    }

    // Full screen, at the right.
    const Box full = button(kFullscreenKey);
    painter.Path(GlyphBox(full, Rem(kGlyphRem)), 32.0, view_.fullscreen ? kExitFullscreenPath : kFullscreenPath, line);

    // The title in the middle, with the episode beside it in a smaller, fainter line.
    const TextStyle titleStyle{Rem(1.05), false, 550};
    const TextStyle episodeStyle{Rem(0.75), false, 500};
    const double gap = Rem(0.7);
    const double episodeWidth = view_.episode.empty() ? 0.0 : painter.MeasureText(view_.episode, episodeStyle) + gap;
    const double spaceLeft = volumeTrack.Right() + Rem(4.5);
    const std::vector<std::string> tools = ToolKeys();
    const double spaceRight = (tools.empty() ? full.x : BoxOf(tools.front())->x) - Rem(1.6);
    const double room = std::max(0.0, spaceRight - spaceLeft);
    const std::string title = view_.title == "Loading" ? "Preparing your film" : view_.title;
    const double titleWidth = std::min(painter.MeasureText(title, titleStyle), std::max(0.0, room - episodeWidth));
    const double total = titleWidth + episodeWidth;
    const double startX = std::clamp(width_ / 2.0 - total / 2.0, spaceLeft, std::max(spaceLeft, spaceRight - total));
    painter.Text(Box{startX, play.y, titleWidth + 2.0, play.height}, title, titleStyle, ink);
    if (!view_.episode.empty()) {
        painter.Text(Box{startX + titleWidth + gap, play.y + Rem(0.08), episodeWidth, play.height}, view_.episode,
                     episodeStyle, WithAlpha(kInkMuted, opacity));
    }
}

void PlayerScreen::PaintSpinner(Painter& painter) const {
    // Twelve dots around a ring, the brightest turning once in 900 ms, as the web buffering ring turns.
    const double radius = Rem(1.6);
    const double dot = Rem(0.34);
    const double cx = width_ / 2.0;
    const double cy = height_ / 2.0;
    const double turn = motion::PrefersReducedMotion(motion_) ? 0.0 : std::fmod(clockMs_ / kSpinnerPeriodMs, 1.0);
    for (int i = 0; i < 12; ++i) {
        const double angle = static_cast<double>(i) / 12.0 * 2.0 * kPi;
        const double age = std::fmod(turn - static_cast<double>(i) / 12.0 + 1.0, 1.0);
        const double alpha = 0.18 + 0.82 * (1.0 - age);
        painter.FillRoundRect(Box{cx + std::sin(angle) * radius - dot / 2.0, cy - std::cos(angle) * radius - dot / 2.0,
                                  dot, dot},
                              dot / 2.0, Rgb(0xF6F7F8, alpha));
    }
}

void PlayerScreen::PaintError(Painter& painter) const {
    // PlaybackError: the "Playback" kicker, the title, the reason, then Retry and Back.
    const Metrics metrics{height_ / 67.5};
    const double x = Rem(kPadXRem);
    const double width = std::min(width_ - 2.0 * x, Rem(44.0));
    const double top = height_ * 0.5 - Rem(6.5);
    painter.Text(Box{x, top, width, Rem(1.2)}, "PLAYBACK", TextStyle{Rem(0.8125), true, 700}, kFill);
    painter.Text(Box{x, top + Rem(1.4), width, Rem(3.3)}, view_.errorTitle, TextStyle{Rem(2.6), true, 750}, kInk);
    painter.Paragraph(Box{x, top + Rem(5.2), width, Rem(4.2)}, view_.errorBody, TextStyle{Rem(1.0625), false},
                      kInkMuted);
    for (const char* key : {kRetryKey, kErrorBackKey}) {
        const ButtonLook look{std::string_view(key) == kRetryKey, focused_ == key, buttonFocus_.Amount(key, clockMs_)};
        DrawButton(painter, metrics, *BoxOf(key), std::string_view(key) == kRetryKey ? "Retry" : "Back", look);
    }
}

bool PlayerScreen::Navigate(nav::Direction direction, double nowMs) {
    ShowChrome(nowMs);
    if (MenuOpen()) {
        // An open menu holds the remote: up and down move along its rows.
        const std::size_t count = MenuOptions(menu_).size();
        if (direction == nav::Direction::Up && menuIndex_ > 0) --menuIndex_;
        if (direction == nav::Direction::Down && menuIndex_ + 1 < count) ++menuIndex_;
        return true;
    }
    const std::vector<std::string> items = Items();
    const auto current = std::find(items.begin(), items.end(), focused_);
    if (current == items.end()) {
        focused_ = items.front();
        return true;
    }
    if (direction == nav::Direction::Right && current + 1 != items.end()) {
        focused_ = *(current + 1);
        return true;
    }
    if (direction == nav::Direction::Left && current != items.begin()) {
        focused_ = *(current - 1);
        return true;
    }
    return false;
}

std::optional<Command> PlayerScreen::Select(double nowMs) {
    // OK on a faded chrome brings it back and plays or pauses, as the remote's OK does.
    const bool hidden = ChromeOpacity(nowMs) < 1.0;
    ShowChrome(nowMs);
    if (MenuOpen()) return Activate(kMenuPrefix + std::to_string(menuIndex_));
    // Next Up's buttons, Skip recap and the credits' buttons answer OK even over a faded chrome, since
    // they are always shown.
    if (focused_ == kNextPlayKey || focused_ == kNextDismissKey || focused_ == kRecapKey ||
        focused_ == kCreditsSkipKey || focused_ == kCreditsWatchKey) {
        return Activate(focused_);
    }
    if (hidden && view_.phase == PlayerView::Phase::Playing) return Action("player-toggle");
    return Activate(focused_);
}

bool PlayerScreen::FocusItem(const std::string& key, double nowMs, bool withCamera) {
    if (key.rfind(kMenuPrefix, 0) == 0) {
        // A hover along the open menu moves its highlight.
        const std::size_t index = std::stoul(key.substr(sizeof(kMenuPrefix) - 1));
        if (index == menuIndex_) return false;
        menuIndex_ = index;
        ShowChrome(nowMs);
        return true;
    }
    return FocusButton(key, nowMs, withCamera);
}

bool PlayerScreen::FocusButton(const std::string& key, double nowMs, bool /*withCamera*/) {
    // Hovering the timeline shows its knob. The bars are not stops for the remote.
    const std::vector<std::string> items = Items();
    const bool bar = key.rfind("seek:", 0) == 0;
    if (!bar && std::find(items.begin(), items.end(), key) == items.end()) return false;
    const std::string next = bar ? "timeline" : key;
    if (next == focused_) return false;
    ShowChrome(nowMs);
    focused_ = next;
    return true;
}

std::optional<std::string> PlayerScreen::ItemAt(double x, double y) const {
    if (const std::optional<Box> panel = MenuBox()) {
        // The open menu's rows come first, as the panel sits over everything else.
        const std::size_t count = MenuOptions(menu_).size();
        const std::size_t first = menuIndex_ >= kMenuRowsShown ? menuIndex_ - kMenuRowsShown + 1 : 0;
        const double top = panel->y + Rem(kMenuPadRem) + Rem(kMenuHeadingRem);
        if (Contains(*panel, x, y)) {
            if (y < top) return std::nullopt;
            const auto row = first + static_cast<std::size_t>((y - top) / Rem(kMenuRowRem));
            if (row < count) return kMenuPrefix + std::to_string(row);
            return std::nullopt;
        }
    }
    for (const std::string& key : Items()) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && Contains(*box, x, y)) return key;
    }
    if (view_.phase != PlayerView::Phase::Playing) return std::nullopt;
    // A click along a bar sets it. The key carries the share clicked.
    const Box volume = VolumeTrackBox();
    if (Contains(Box{volume.x - Rem(0.2), volume.y, volume.width + Rem(0.4), volume.height}, x, y)) {
        return "volume:" + Fixed(std::clamp((x - volume.x) / volume.width, 0.0, 1.0), "%.4f");
    }
    const Box track = TrackBox();
    if (!view_.live && Contains(track, x, y)) {
        return "seek:" + Fixed(std::clamp((x - track.x) / std::max(1.0, track.width), 0.0, 1.0), "%.4f");
    }
    return std::nullopt;
}

std::optional<Command> PlayerScreen::ActivateItem(const std::string& key, double nowMs) {
    ShowChrome(nowMs);
    if (key.rfind(kMenuPrefix, 0) == 0) return Activate(key);
    // A click anywhere else closes the menu first, as a click outside a web menu does.
    if (MenuOpen() && key != menu_) CloseMenu();
    if (key.rfind("seek:", 0) == 0) {
        if (view_.duration <= 0.0) return std::nullopt;
        Command command = Action("player-seek-to");
        command.params["seconds"] = Fixed(std::stod(key.substr(5)) * view_.duration, "%.3f");
        return command;
    }
    if (key.rfind("volume:", 0) == 0) {
        Command command = Action("player-volume");
        command.params["level"] = Fixed(std::stod(key.substr(7)) * kMaxVolume, "%.3f");
        return command;
    }
    const std::vector<std::string> items = Items();
    if (std::find(items.begin(), items.end(), key) == items.end()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> PlayerScreen::Activate(const std::string& key) {
    if (key.rfind(kMenuPrefix, 0) == 0) {
        // A row of the open menu: its choice goes to the app, and the menu closes.
        const std::vector<PlayerOption> options = MenuOptions(menu_);
        const std::size_t index = std::stoul(key.substr(sizeof(kMenuPrefix) - 1));
        if (index >= options.size()) return std::nullopt;
        Command command = Action("player-pick");
        command.params["kind"] = menu_;
        command.params["id"] = options[index].id;
        CloseMenu();
        return command;
    }
    const std::vector<std::string> tools = ToolKeys();
    if (std::find(tools.begin(), tools.end(), key) != tools.end()) {
        // A tool opens its menu on the row that is chosen, or closes it when it is open.
        if (menu_ == key) {
            CloseMenu();
            return std::nullopt;
        }
        menu_ = key;
        const std::vector<PlayerOption> options = MenuOptions(key);
        const auto chosen = std::find_if(options.begin(), options.end(), [](const PlayerOption& o) { return o.selected; });
        menuIndex_ = chosen == options.end() ? 0 : static_cast<std::size_t>(chosen - options.begin());
        return std::nullopt;
    }
    if (key == kDownloadKey) {
        // Downloads opens over the player, as the web's Download button does; the player pauses for it.
        Command command;
        command.name = "downloads";
        command.modal = true;
        command.params["title"] = view_.title;
        return command;
    }
    if (key == kWatchlistKey) return Action("player-watchlist");
    if (key == kGoLiveKey) return Action("player-go-live");
    if (key == kRecapKey) return Action("player-skip-recap");
    if (key == kCreditsSkipKey) return Action("player-skip-credits");
    if (key == kCreditsWatchKey) return Action("player-watch-credits");
    if (key == kNextPlayKey) return Action("player-next");
    if (key == kNextDismissKey) return Action("player-next-dismiss");
    if (key == kPlayKey) return Action("player-toggle");
    if (key == kRewindKey || key == kForwardKey) {
        Command command = Action("player-seek");
        command.params["delta"] = key == kRewindKey ? "-10" : "10";
        return command;
    }
    if (key == kMuteKey) return Action("player-mute");
    if (key == kFullscreenKey) return Action("player-fullscreen");
    if (key == kRetryKey) return Action("player-retry");
    if (key == kBackKey || key == kErrorBackKey) return Action("player-close");
    return std::nullopt;
}

}  // namespace tvm::ui
