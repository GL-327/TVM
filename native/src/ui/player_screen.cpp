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
constexpr double kBackHeightRem = 3.0;
constexpr double kBackFontRem = 0.8;
constexpr double kTimelineRem = 1.6;       // .tvm-progress__control min-height
constexpr double kTimelineGapRem = 0.9;    // the timeline's margin over the transport
constexpr double kTimeWidthRem = 3.4;
constexpr double kTimeGapRem = 0.8;
constexpr double kVolumeGapRem = 0.3;
constexpr double kVolumeMeterRem = 5.5;
constexpr double kVolumeTrackRem = 5.0;
constexpr double kVolumeTrackHeightRem = 0.18;
constexpr double kTopScrimRem = 9.0;
constexpr double kBottomScrimRem = 13.0;
// The transport, centred on the window under the timeline, as the TVM Stream Android player lays it out: a larger
// play/pause between round ten-second skips.
constexpr double kTransportPlayRem = 3.6;
constexpr double kTransportSkipRem = 3.0;
constexpr double kTransportGapRem = 2.2;
constexpr double kTransportPlayGlyphRem = 2.9 * 1.08;
constexpr double kTransportSkipGlyphRem = 2.55 * 1.08;
// The transport icons rest a soft white and brighten to full white under the pointer or the remote.
constexpr Color kTransportInk = Rgb(0xECEEF3, 0.92);
// The tool pills (subtitles, audio, quality, speed): slim, borderless, a glass pill only under the pointer.
constexpr double kToolHeightRem = 2.4;
constexpr double kToolPadRem = 0.9;
constexpr double kToolFontRem = 0.8;
// The Android seek bar: a 4 px track (6 px while dragged), a brand gradient for the played part, a 16 px white thumb.
constexpr double kSeekTrackRem = 0.25;
constexpr double kSeekTrackDragRem = 0.375;
constexpr double kSeekThumbRem = 1.0;
constexpr Color kBrandStart = Rgb(0x5714FD);
constexpr Color kBrandMid = Rgb(0x177FFD);
constexpr Color kBrandEnd = Rgb(0x00DFFD);

constexpr Color kInk = Rgb(0xF6F7FA);
constexpr Color kInkMuted = Rgb(0xFFFFFF, 0.67);       // #fffa
constexpr Color kFill = Rgb(0x67BAFF);                 // the cinema chrome's --player-fill
constexpr Color kTrack = Rgb(0xFFFFFF, 0x45 / 255.0);  // #ffffff45
constexpr Color kHover = Rgb(0xFFFFFF, 0x15 / 255.0);  // #ffffff15
// The menus open with a short fade and rise, and close a little faster, on the glass easing curve.
constexpr double kMenuOpenMs = 190.0;
constexpr double kMenuCloseMs = 150.0;
constexpr motion::CubicBezier kMenuEase{0.32, 0.72, 0.0, 1.0};
constexpr Color kMarkPlate = Rgb(0x2F6BFF);
constexpr char kMarkImage[] = "asset:tvm-icon.png";

// The glyphs, from PlayerGlyph in CinemaControls.tsx and IconVolume in Icons.tsx, in a 32 unit square.
constexpr char kBackPath[] = "m17 6-10 10 10 10M8 16h20";
constexpr char kFullscreenPath[] = "M4 12V4h8m8 0h8v8M4 20v8h8m8 0h8v-8";
constexpr char kExitFullscreenPath[] = "M12 4v8H4m16-8v8h8M12 28v-8H4m16 8v-8h8";
constexpr char kSpeakerPath[] = "M6 13h4l6-5v16l-6-5H6z";
constexpr char kWavesPath[] = "M20 12.5a5 5 0 0 1 0 7M23 10a8.5 8.5 0 0 1 0 12";
constexpr char kMutedPath[] = "m20 12 7 8M27 12l-7 8";
// Thick, rounded strokes, so the header's and the toolbar's line icons read at a glance.
constexpr double kGlyphStroke = 2.4;
// The Android player's transport icons, in a 48 unit square: a rounded play triangle, rounded pause bars, and the
// ten-second skips as an open arc with its arrowhead and the "10" drawn inside.
constexpr char kAndroidPlayPath[] =
    "M16.5 11.2v25.6a2.2 2.2 0 0 0 3.3 1.9l20.6-12.8a2.2 2.2 0 0 0 0-3.8L19.8 9.3a2.2 2.2 0 0 0-3.3 1.9z";
constexpr char kAndroidPausePath[] =
    "M15.6 10h2.4a2.6 2.6 0 0 1 2.6 2.6v22.8a2.6 2.6 0 0 1-2.6 2.6h-2.4a2.6 2.6 0 0 1-2.6-2.6V12.6a2.6 2.6 0 0 1 2.6-2.6z"
    "M30 10h2.4a2.6 2.6 0 0 1 2.6 2.6v22.8a2.6 2.6 0 0 1-2.6 2.6H30a2.6 2.6 0 0 1-2.6-2.6V12.6A2.6 2.6 0 0 1 30 10z";
constexpr char kAndroidBackArcPath[] = "M24 10A16 16 0 1 1 10.1 18M28.6 5.2L23.6 10l5 4.8";
constexpr char kAndroidForwardArcPath[] = "M24 10A16 16 0 1 0 37.9 18M19.4 5.2L24.4 10l-5 4.8";
constexpr char kAndroidTenPath[] =
    "M17.6 22.2L20.3 20.3V32M27.6 20.3a3.3 3.3 0 0 1 3.3 3.3v5.1a3.3 3.3 0 0 1-3.3 3.3a3.3 3.3 0 0 1-3.3-3.3v-5.1"
    "a3.3 3.3 0 0 1 3.3-3.3z";
constexpr double kAndroidStroke = 3.1;

// useIdleChrome: the chrome hides after three seconds. It fades over 260 ms on the Android player's curve.
constexpr double kIdleHideMs = 3000.0;
constexpr double kIdleFadeMs = 260.0;
constexpr motion::CubicBezier kChromeEase{0.22, 1.0, 0.36, 1.0};
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

// The menus: a compact dark panel over its button, as wide as its longest row, with a short heading. Long lists
// scroll inside it.
constexpr double kMenuMinWidthRem = 13.0;
constexpr double kMenuMaxWidthRem = 22.0;
constexpr double kMenuRowRem = 2.25;
constexpr double kMenuPadRem = 0.4;
constexpr double kMenuHeadingRem = 1.85;
constexpr double kMenuRadiusRem = 1.0;
constexpr std::size_t kMenuRowsMost = 8;
constexpr std::size_t kMenuRowsLeast = 3;
constexpr double kMenuSlideMs = 170.0;
constexpr double kMenuGlowMs = 160.0;
constexpr Color kMenuFill = Rgb(0x171A20, 0.98);
constexpr Color kMenuSurface = Rgb(0x141720, 0.97);
constexpr Color kMenuCheck = Rgb(0x3B9CFF);
constexpr char kCheckPath[] = "M6 16.5l6.5 6.5L26 9.5";

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
    if (!menu_.empty()) {
        focused_ = menu_;
        // The panel eases out a little faster than it came in.
        const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
        menuFade_ = motion::Tween(MenuFade(), 0.0, clockMs_, reduced ? 0.0 : kMenuCloseMs, kMenuEase);
    }
    menu_.clear();
}

double PlayerScreen::MenuFade() const {
    if (menuShown_.empty()) return 0.0;
    return std::clamp(menuFade_.Value(clockMs_), 0.0, 1.0);
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

std::size_t PlayerScreen::MenuRowsShown(const std::string& menu) const {
    const std::size_t count = MenuOptions(menu).size();
    const std::optional<Box> button = BoxOf(menu);
    std::size_t fits = kMenuRowsMost;
    if (button.has_value()) {
        // As many rows as fit between the top of the window and the timeline, never fewer than three.
        const double room = std::min(button->y, TrackBox().y) - Rem(1.0) - Rem(1.0) - Rem(kMenuHeadingRem) -
                            2.0 * Rem(kMenuPadRem);
        fits = static_cast<std::size_t>(std::max(0.0, std::floor(room / Rem(kMenuRowRem))));
        fits = std::clamp(fits, kMenuRowsLeast, kMenuRowsMost);
    }
    return std::min(count, fits);
}

bool PlayerScreen::ScrollMenu(int rows) {
    if (!MenuOpen()) return false;
    const std::size_t count = MenuOptions(menu_).size();
    const std::size_t shown = MenuRowsShown(menu_);
    const std::size_t most = count > shown ? count - shown : 0;
    const long long wanted = std::clamp(static_cast<long long>(menuFirst_) + rows, 0LL, static_cast<long long>(most));
    if (static_cast<std::size_t>(wanted) == menuFirst_) return false;
    menuFirst_ = static_cast<std::size_t>(wanted);
    return true;
}

void PlayerScreen::MoveMenuHighlight(std::size_t index, bool instant) {
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    const double from = instant ? static_cast<double>(index) : menuRow_.Value(clockMs_);
    menuRow_ = motion::Tween(from, static_cast<double>(index), clockMs_, instant || reduced ? 0.0 : kMenuSlideMs,
                             kMenuEase);
}

double PlayerScreen::MenuRowTop(const Box& panel) const {
    return panel.y + Rem(kMenuPadRem) + Rem(kMenuHeadingRem);
}

std::optional<Box> PlayerScreen::MenuBox() const {
    if (!MenuOpen()) return std::nullopt;
    return MenuBoxFor(menu_);
}

std::optional<Box> PlayerScreen::MenuBoxFor(const std::string& menu) const {
    if (menu.empty()) return std::nullopt;
    const std::optional<Box> button = BoxOf(menu);
    if (!button.has_value()) return std::nullopt;
    const std::vector<PlayerOption> options = MenuOptions(menu);
    const std::size_t rows = MenuRowsShown(menu);
    const double height = Rem(kMenuPadRem) * 2.0 + Rem(kMenuHeadingRem) + static_cast<double>(rows) * Rem(kMenuRowRem);
    // As wide as the longest row (its label, its detail and the tick), from 13 to 22rem. Text is estimated from
    // its length, so the panel's size does not wait on a painter.
    double longest = 0.0;
    for (const PlayerOption& option : options) {
        double row = static_cast<double>(option.label.size()) * 0.56 * Rem(0.86);
        if (!option.detail.empty()) row += Rem(1.0) + static_cast<double>(option.detail.size()) * 0.5 * Rem(0.72);
        longest = std::max(longest, row);
    }
    const double fit = longest + Rem(0.85) + Rem(2.4) + 2.0 * Rem(kMenuPadRem);
    const double width = std::min(std::clamp(fit, Rem(kMenuMinWidthRem), Rem(kMenuMaxWidthRem)),
                                  std::max(1.0, width_ - 2.0 * Rem(kPadXRem)));
    const double x = std::clamp(button->Right() - width, Rem(kPadXRem), width_ - Rem(kPadXRem) - width);
    // It opens above its button and above the timeline, so it never covers the bar.
    const double bottom = std::min(button->y, TrackBox().y) - Rem(0.9);
    return Box{x, std::max(0.0, bottom - height), width, height};
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
    return std::clamp(1.0 - kChromeEase.Ease(std::clamp(idle / kIdleFadeMs, 0.0, 1.0)), 0.0, 1.0);
}

bool PlayerScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    // The hints leave with the chrome, as RemoteHints hides itself when the controls go.
    if (hintsFromMs_ > 0.0 && nowMs >= hintsFromMs_ && hintsLeaveMs_ <= 0.0 && ChromeOpacity(nowMs) < 1.0) {
        hintsLeaveMs_ = nowMs;
    }
    buttonFocus_.Track(focused_, focusHidden_, nowMs, motion_);
    // The menu's highlight fades away when the pointer leaves its rows, and back when it or a key returns.
    const double glow = focusHidden_ ? 0.0 : 1.0;
    if (glow != menuGlowTarget_) {
        menuGlowTarget_ = glow;
        const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
        menuGlow_ = motion::Tween(menuGlow_.Value(nowMs), glow, nowMs, reduced ? 0.0 : kMenuGlowMs, kMenuEase);
    }
    return Animating();
}

bool PlayerScreen::Animating() const {
    if (buttonFocus_.Animating(clockMs_)) return true;
    if (!menuShown_.empty() && !menuFade_.Done(clockMs_)) return true;
    if (MenuOpen() && (!menuRow_.Done(clockMs_) || !menuGlow_.Done(clockMs_))) return true;
    // The spinner turns, and the chrome's timer runs, only while they are on screen.
    if (view_.phase == PlayerView::Phase::Resolving) return true;
    if (view_.phase != PlayerView::Phase::Playing) return false;
    if (!view_.started || view_.buffering) return true;
    if (hintsFromMs_ > 0.0 && (clockMs_ < hintsFromMs_ || HintsOpacity(clockMs_) > 0.0)) return true;
    // The live pill pulses, and a held arrow's preview runs out on the clock.
    if (view_.live || clockMs_ < holdUntilMs_) return ChromeOpacity(clockMs_) > 0.0 || clockMs_ < holdUntilMs_;
    // A paused or held chrome is still: nothing moves, so no frames are drawn until something changes. Playing, the
    // frames run only while the chrome fades out; the clock's own updates from mpv redraw the time as it passes.
    if (view_.paused || view_.buffering || MenuOpen() || scrub_.has_value()) return false;
    const double idle = clockMs_ - lastActivityMs_ - kIdleHideMs;
    return idle >= -kIdleFadeMs && idle <= kIdleFadeMs;
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

std::map<std::string, Box> PlayerScreen::CompactControls() const {
    const double x = Rem(kPadXRem);
    FlowLayout flow(x, 0, width_ - 2.0 * x, Rem(kToolGapRem));
    std::map<std::string, Box> boxes;
    const double height = std::max(44.0, Rem(kButtonRem));
    const auto add = [&](const std::string& key, double width) { boxes[key] = flow.Place(width, height); };
    add(kPlayKey, std::max(44.0, Rem(kPlayWidthRem)));
    if (!view_.live) { add(kRewindKey, height); add(kForwardKey, height); }
    add(kMuteKey, height);
    add("volume-track", Rem(kVolumeTrackRem + 4.6));
    for (const auto& key : ToolKeys())
        add(key, std::max(height, static_cast<double>(ToolLabel(key).size()) * 0.55 * Rem(0.85) + Rem(1.4)));
    add(kFullscreenKey, height);
    const double top = height_ - Rem(kFooterBottomRem) - flow.Bottom();
    for (auto& [key, box] : boxes) box.y += top;
    return boxes;
}

Box PlayerScreen::TrackBox() const {
    const double toolbarTop = CompactViewport(width_, height_) ? CompactControls().at(kPlayKey).y
                                                              : height_ - Rem(kFooterBottomRem) - Rem(kToolbarRem);
    const double y = toolbarTop - Rem(kTimelineGapRem) - Rem(kTimelineRem);
    const double x = Rem(kPadXRem) + Rem(kTimeWidthRem) + Rem(kTimeGapRem);
    const double width = width_ - 2.0 * x;
    return Box{x, y, std::max(0.0, width), Rem(kTimelineRem)};
}

std::optional<double> PlayerScreen::VolumeAt(double x, double y) const {
    if (view_.phase != PlayerView::Phase::Playing) return std::nullopt;
    const Box volume = VolumeTrackBox();
    // Half a thumb past either end still counts, so silence and full are easy to reach.
    if (!Contains(Box{volume.x - Rem(0.5), volume.y, volume.width + Rem(1.0), volume.height}, x, y)) return std::nullopt;
    return VolumeAtX(x);
}

double PlayerScreen::VolumeAtX(double x) const {
    const Box volume = VolumeTrackBox();
    return std::clamp((x - volume.x) / std::max(1.0, volume.width), 0.0, 1.0) * kSliderVolume;
}

Box PlayerScreen::VolumeTrackBox() const {
    if (CompactViewport(width_, height_)) {
        Box box = CompactControls().at("volume-track");
        box.width = std::min(Rem(kVolumeTrackRem), box.width);
        return box;
    }
    const Box mute = *BoxOf(kMuteKey);
    return Box{mute.Right() + Rem(kVolumeGapRem) + Rem(0.2), mute.y, Rem(kVolumeTrackRem), mute.height};
}

std::optional<Box> PlayerScreen::BoxOf(const std::string& key) const {
    const double x = Rem(kPadXRem);
    const bool compact = CompactViewport(width_, height_);
    if (compact) {
        const auto controls = CompactControls();
        if (const auto found = controls.find(key); found != controls.end()) return found->second;
        FlowLayout header(x, Rem(kHeaderTopRem), width_ - 2.0 * x, Rem(kActionGapRem));
        const Box back = header.Place(Rem(13.0), 44.0);
        if (key == kBackKey) return back;
        if (!view_.live) {
            const Box download = header.Place(44.0, 44.0);
            if (key == kDownloadKey) return download;
        }
        if (view_.canSave) {
            const Box list = header.Place(Rem(kWatchlistWidthRem), 44.0);
            if (key == kWatchlistKey) return list;
        }
    }
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

    // The control row under the timeline. The transport sits in the exact middle of the window: back ten,
    // play or pause, forward ten, evenly spaced. The sound is at the left; the tools and full screen at the right.
    const double center = height_ - Rem(kFooterBottomRem) - Rem(kToolbarRem) / 2.0;
    const double button = Rem(kButtonRem);
    const double top = center - button / 2.0;
    const double playSize = Rem(kTransportPlayRem);
    const double skipSize = Rem(kTransportSkipRem);
    const Box play{width_ / 2.0 - playSize / 2.0, center - playSize / 2.0, playSize, playSize};
    if (key == kPlayKey) return play;
    if (!view_.live) {
        if (key == kRewindKey) return Box{play.x - Rem(kTransportGapRem) - skipSize, center - skipSize / 2.0, skipSize, skipSize};
        if (key == kForwardKey) return Box{play.Right() + Rem(kTransportGapRem), center - skipSize / 2.0, skipSize, skipSize};
    }
    if (key == kMuteKey) return Box{x, top, button, button};
    const Box fullscreen{width_ - x - button, top, button, button};
    if (key == kFullscreenKey) return fullscreen;

    // The tools sit left of full screen, in order, each as wide as its word.
    const std::vector<std::string> tools = ToolKeys();
    double right = fullscreen.x - Rem(kToolGapRem);
    for (auto tool = tools.rbegin(); tool != tools.rend(); ++tool) {
        const double width = std::max(Rem(kToolHeightRem),
                                      static_cast<double>(ToolLabel(*tool).size()) * 0.55 * Rem(kToolFontRem) +
                                          2.0 * Rem(kToolPadRem));
        if (key == *tool) {
            return Box{right - width, top + (button - Rem(kToolHeightRem)) / 2.0, width, Rem(kToolHeightRem)};
        }
        right -= width + Rem(kToolGapRem);
    }

    // Next Up's card, at the right over the timeline, and its two buttons.
    const double cardWidth = std::min(Rem(kNextWidthRem), width_ - 2.0 * x);
    const Box card = Box{width_ - x - cardWidth, TrackBox().y - Rem(1.2) - Rem(kNextHeightRem),
                         cardWidth, Rem(kNextHeightRem)};
    if (key == "next-card") return card;

    // Skip recap and the credits' two buttons sit at the right, just over the timeline, as the cinema
    // chrome's recap slot places them.
    const double endY = TrackBox().y - Rem(1.4) - button;
    if (key == kRecapKey) return Box{width_ - x - Rem(9.2), endY, Rem(9.2), button};
    if (key == kCreditsWatchKey) return Box{width_ - x - Rem(9.6), endY, Rem(9.6), button};
    if (key == kCreditsSkipKey) return Box{width_ - x - Rem(9.6) - Rem(0.7) - Rem(11.6), endY, Rem(11.6), button};
    const double bodyX = compact ? card.x + Rem(0.8) : card.x + Rem(0.6) + Rem(9.6) + Rem(0.9);
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
    if (opacity > 0.0 && MenuFade() > 0.0) PaintMenu(painter);
    if (view_.buffering) PaintSpinner(painter);
    // Next Up, Skip recap and Skip credits are their own layer, shown whether or not the chrome is.
    if (view_.nextUp) PaintNextUp(painter);
    PaintEndActions(painter);
    PaintHints(painter);
}

void PlayerScreen::PaintGoLive(Painter& painter, double opacity) const {
    // `.player__go-live`: an optical glass pill with a pulsing red dot, "Back to live", and how far behind.
    const Box box = *BoxOf(kGoLiveKey);
    const bool focused = ShowsFocus(focused_, kGoLiveKey);
    GlassStyle glass;
    glass.kind = GlassKind::Pill;
    glass.focused = focused;
    glass.focusAmount = focused ? 1.0 : 0.0;
    glass.opacity = opacity;
    glass.reduceTransparency = tokens::reduceTransparency;
    glass.tint = focused ? Rgb(0x181820, 0.82) : Rgb(0x0C0C10, 0.62);
    painter.Glass(box, box.height / 2.0, glass);
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
    // `.player-remote-hints__phrase`: a glass pill of lessons, each its keys then its action, centred over the dock.
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
    GlassStyle pillGlass;
    pillGlass.kind = GlassKind::Pill;
    pillGlass.opacity = opacity;
    pillGlass.reduceTransparency = tokens::reduceTransparency;
    pillGlass.tint = Rgb(0x0A121C, 0.72);
    painter.Glass(pill, height / 2.0, pillGlass);

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
    // As on the Android player: a small kicker, the title, and a fainter line under it, centred at the top. For an
    // episode the title is the show and the line reads "S1 · E2 · Episode title · 42:10 left".
    const bool compact = CompactViewport(width_, height_);
    const double top = compact ? Rem(kHeaderTopRem) + 44.0 + Rem(0.8) : Rem(kHeaderTopRem) - Rem(0.1);
    const double room = compact ? width_ - 2.0 * Rem(kPadXRem) : std::min(width_ * 0.52, Rem(34.0));
    const double left = width_ / 2.0 - room / 2.0;
    const Color ink = WithAlpha(kInk, opacity);
    const Color muted = WithAlpha(Rgb(0xFFFFFF, 0.72), opacity);
    const auto centred = [&](const std::string& text, const TextStyle& style, double y, double height, Color color,
                             bool shadow) {
        const double width = std::min(room, painter.MeasureText(text, style));
        const Box box{width_ / 2.0 - width / 2.0, y, width + 2.0, height};
        if (shadow) painter.Text(Box{box.x, box.y + 1.5, box.width, box.height}, text, style, Rgb(0x000000, 0.55 * opacity));
        painter.Text(box, text, style, color);
    };

    const TextStyle kickerStyle{Rem(0.62), true, 800};
    if (view_.live) {
        const double pillWidth = painter.MeasureText("LIVE", kickerStyle) + Rem(1.6);
        const Box pill{width_ / 2.0 - pillWidth / 2.0, top, pillWidth, Rem(1.15)};
        painter.FillRoundRect(pill, pill.height / 2.0, WithAlpha(Rgb(0xFF6B6B), opacity));
        const double pulse = motion::PrefersReducedMotion(motion_) ? 1.0 : 0.65 + 0.35 * std::cos(clockMs_ / 1400.0 * 2.0 * kPi);
        painter.FillRoundRect(Box{pill.x + Rem(0.45), pill.CenterY() - Rem(0.2), Rem(0.4), Rem(0.4)}, Rem(0.2),
                              Rgb(0xFFFFFF, opacity * pulse));
        painter.Text(Box{pill.x + Rem(1.0), pill.y, pill.width, pill.height}, "LIVE", kickerStyle, ink);
    } else {
        centred("NOW PLAYING", kickerStyle, top, Rem(1.15), WithAlpha(kFill, opacity), false);
    }
    const std::string title = view_.title == "Loading" ? "" : view_.title;
    if (title.empty()) return;
    const TextStyle titleStyle{Rem(1.15), true, 700};
    const double titleY = top + Rem(1.2);
    centred(title, titleStyle, titleY, Rem(1.6), ink, true);

    // The line under it: the episode, its name, and the time left, each its own piece so none is cut short.
    std::vector<std::string> parts;
    if (!view_.episode.empty() && !view_.live) parts.push_back(view_.episode);
    if (!view_.episodeTitle.empty() && !view_.live) parts.push_back(view_.episodeTitle);
    const std::string remaining = view_.live ? "" : RemainingLabel(view_.duration - view_.position);
    if (!remaining.empty()) parts.push_back(remaining);
    if (parts.empty()) return;
    const TextStyle metaStyle{Rem(0.78), false, 500};
    const double dot = Rem(0.22);
    const double gap = Rem(0.5);
    double total = 0.0;
    std::vector<double> widths;
    for (const std::string& part : parts) {
        widths.push_back(painter.MeasureText(part, metaStyle));
        total += widths.back();
    }
    total += static_cast<double>(parts.size() - 1) * (2.0 * gap + dot);
    double x = std::max(left, width_ / 2.0 - total / 2.0);
    const double metaY = titleY + Rem(1.55);
    for (std::size_t i = 0; i < parts.size(); ++i) {
        const double width = std::min(widths[i], left + room - x);
        if (width <= 0.0) break;
        painter.Text(Box{x, metaY, width + 2.0, Rem(1.2)}, parts[i], metaStyle, muted);
        x += width;
        if (i + 1 < parts.size()) {
            x += gap;
            painter.FillRoundRect(Box{x, metaY + Rem(0.6) - dot / 2.0, dot, dot}, dot / 2.0, muted);
            x += dot + gap;
        }
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
        GlassStyle thumbGlass;
        thumbGlass.kind = GlassKind::Card;
        thumbGlass.opacity = opacity;
        thumbGlass.reduceTransparency = tokens::reduceTransparency;
        thumbGlass.tint = kMenuFill;
        painter.Glass(Box{thumb.x - 2.0, thumb.y - 2.0, thumb.width + 4.0, thumb.height + 4.0}, Rem(0.65), thumbGlass);
        painter.ImageFaded(thumb, "file:" + view_.thumbnail, Rem(0.55), opacity, 0.5, 0.5);
    }
    GlassStyle bubbleGlass;
    bubbleGlass.kind = GlassKind::Pill;
    bubbleGlass.opacity = opacity;
    bubbleGlass.reduceTransparency = tokens::reduceTransparency;
    bubbleGlass.tint = kMenuFill;
    painter.Glass(bubble, bubble.height / 2.0, bubbleGlass);
    CenteredText(painter, bubble, at, bubbleStyle, WithAlpha(kInk, opacity));
}

void PlayerScreen::PaintEndActions(Painter& painter) const {
    // `.cinema-chrome__recap .tvm-button`: frosted glass pills for Skip recap, Skip credits, and Watch credits.
    const auto light = [&](const char* key, const std::string& label) {
        const Box box = *BoxOf(key);
        const bool focused = ShowsFocus(focused_, key);
        GlassStyle glass;
        glass.kind = GlassKind::Pill;
        glass.focused = focused;
        glass.activeTab = true;
        glass.focusAmount = focused ? 1.0 : 0.0;
        glass.reduceTransparency = tokens::reduceTransparency;
        glass.tint = focused ? Rgb(0xFFFFFF) : Rgb(0xF5F5F5, 0.92);
        painter.Glass(box, box.height / 2.0, glass);
        CenteredText(painter, box, label, TextStyle{Rem(0.85), true, 700}, Rgb(0x14171C));
    };
    if (view_.recap) light(kRecapKey, "Skip recap");
    if (view_.credits) {
        const long total = static_cast<long>(std::ceil(std::max(0.0, view_.creditsRemaining)));
        char remain[16];
        std::snprintf(remain, sizeof(remain), "%ld:%02ld", total / 60, total % 60);
        light(kCreditsSkipKey, std::string("Skip credits  ") + remain);
        const Box watch = *BoxOf(kCreditsWatchKey);
        const bool watchFocused = ShowsFocus(focused_, kCreditsWatchKey);
        GlassStyle watchGlass;
        watchGlass.kind = GlassKind::Pill;
        watchGlass.focused = watchFocused;
        watchGlass.focusAmount = watchFocused ? 1.0 : 0.0;
        watchGlass.reduceTransparency = tokens::reduceTransparency;
        watchGlass.tint = watchFocused ? Rgb(0x1E2631, 0.88) : Rgb(0x141A22, 0.72);
        painter.Glass(watch, watch.height / 2.0, watchGlass);
        CenteredText(painter, watch, "Watch credits", TextStyle{Rem(0.85), true, 600}, kInk);
    }
}

void PlayerScreen::PaintMenu(Painter& painter) const {
    const std::string& menu = menuShown_;
    const std::optional<Box> resting = MenuBoxFor(menu);
    if (!resting.has_value()) return;
    // Opening and closing: a short fade with a restrained rise and scale toward the toolbar, never a bounce.
    const double fade = MenuFade();
    const auto faded = [fade](Color color) {
        color.a *= fade;
        return color;
    };
    const double scale = 0.96 + 0.04 * fade;
    const double panelWidth = resting->width * scale;
    const double panelHeight = resting->height * scale;
    const Box panel{resting->Right() - panelWidth - (resting->width - panelWidth) / 2.0,
                    resting->Bottom() - panelHeight + Rem(0.5) * (1.0 - fade), panelWidth, panelHeight};
    const double radius = Rem(kMenuRadiusRem);
    // A compact dark panel on a soft shadow, with a hairline edge so it reads over a dark picture.
    for (int layer = 3; layer >= 1; --layer) {
        const double spread = Rem(0.22) * layer;
        painter.FillRoundRect(Box{panel.x - spread, panel.y - spread + Rem(0.35), panel.width + 2.0 * spread,
                                  panel.height + 2.0 * spread},
                              radius + spread, Rgb(0x000000, 0.10 * fade));
    }
    painter.FillRoundRect(panel, radius, faded(kMenuSurface));
    painter.StrokeRoundRect(panel, radius, 1.0, faded(Rgb(0xFFFFFF, 0.08)));

    const std::string heading = menu == kSubtitlesKey ? "Subtitles"
                                : menu == kAudioKey   ? "Audio"
                                : menu == kQualityKey ? "Quality"
                                                      : "Playback speed";
    const double x = panel.x + Rem(kMenuPadRem);
    const double width = panel.width - 2.0 * Rem(kMenuPadRem);
    painter.Text(Box{x + Rem(0.85), panel.y + Rem(kMenuPadRem), width, Rem(kMenuHeadingRem)}, heading,
                 TextStyle{Rem(0.72), true, 700}, faded(Rgb(0xFFFFFF, 0.55)));

    const std::vector<PlayerOption> options = MenuOptions(menu);
    const std::size_t shown = std::min(MenuRowsShown(menu), options.size());
    const double top = MenuRowTop(panel);
    const double rowHeight = Rem(kMenuRowRem);
    const Box rows{x, top, width, static_cast<double>(shown) * rowHeight};
    painter.PushClip(rows);
    // The highlight: the glass pill, sliding between rows and fading when the pointer leaves them.
    const double glow = std::clamp(menuGlow_.Value(clockMs_), 0.0, 1.0);
    if (glow > 0.01 && menu == menu_) {
        const double at = menuRow_.Value(clockMs_) - static_cast<double>(menuFirst_);
        const Box pill{x, top + at * rowHeight + Rem(0.08), width, rowHeight - Rem(0.16)};
        // A soft light under the glass, so the highlight reads over the dark panel even where the overlay gives the
        // glass nothing to refract.
        painter.FillRoundRect(pill, pill.height / 2.0, Rgb(0xFFFFFF, 0.12 * glow * fade));
        GlassStyle rowGlass;
        rowGlass.kind = GlassKind::Pill;
        rowGlass.focused = true;
        rowGlass.focusAmount = glow;
        rowGlass.opacity = fade * glow;
        rowGlass.reduceTransparency = tokens::reduceTransparency;
        painter.Glass(pill, pill.height / 2.0, rowGlass);
    }
    const double tick = Rem(1.05);
    for (std::size_t i = menuFirst_; i < options.size() && i < menuFirst_ + shown; ++i) {
        const PlayerOption& option = options[i];
        const Box row{x, top + static_cast<double>(i - menuFirst_) * rowHeight, width, rowHeight};
        const TextStyle labelStyle{Rem(0.86), true, option.selected ? 650 : 500};
        const double labelLeft = row.x + Rem(0.85);
        const double textRight = row.Right() - Rem(0.7) - tick - Rem(0.5);
        const double labelWidth = std::min(painter.MeasureText(option.label, labelStyle), textRight - labelLeft);
        painter.Text(Box{labelLeft, row.y, labelWidth + 2.0, row.height}, option.label, labelStyle,
                     faded(option.selected ? Rgb(0xFFFFFF) : Rgb(0xFFFFFF, 0.86)));
        if (!option.detail.empty()) {
            // The detail sits after the label, muted, and gives way to it when space is short.
            const TextStyle detailStyle{Rem(0.72), false, 450};
            const double detailLeft = labelLeft + labelWidth + Rem(0.7);
            if (textRight - detailLeft > Rem(1.5)) {
                painter.Text(Box{detailLeft, row.y, textRight - detailLeft, row.height}, option.detail, detailStyle,
                             faded(Rgb(0xFFFFFF, 0.5)));
            }
        }
        // The chosen row carries a blue tick at its end.
        if (option.selected) {
            painter.Path(Box{row.Right() - Rem(0.7) - tick, row.CenterY() - tick / 2.0, tick, tick}, 32.0, kCheckPath,
                         PathStyle{Color{0, 0, 0, 0}, faded(kMenuCheck), 3.2, false});
        }
    }
    painter.PopClip();
    // A long list shows a slim scroll bar at its right edge.
    if (options.size() > shown && shown > 0) {
        const double trackHeight = rows.height - Rem(0.4);
        const double thumbHeight = std::max(Rem(1.2), trackHeight * static_cast<double>(shown) /
                                                           static_cast<double>(options.size()));
        const double share = static_cast<double>(menuFirst_) / static_cast<double>(options.size() - shown);
        const Box thumb{panel.Right() - Rem(0.32), rows.y + Rem(0.2) + (trackHeight - thumbHeight) * share, Rem(0.16),
                        thumbHeight};
        painter.FillRoundRect(thumb, thumb.width / 2.0, faded(Rgb(0xFFFFFF, 0.28)));
    }
}

void PlayerScreen::PaintNextUp(Painter& painter) const {
    const Box card = *BoxOf("next-card");
    GlassStyle cardGlass;
    cardGlass.kind = GlassKind::Panel;
    cardGlass.reduceTransparency = tokens::reduceTransparency;
    cardGlass.tint = kMenuFill;
    painter.Glass(card, Rem(1.25), cardGlass);
    // The drain along the top empties as the episode runs out.
    const double drain = view_.nextWindow > 0.0 ? std::clamp(view_.nextRemaining / view_.nextWindow, 0.0, 1.0) : 0.0;
    painter.FillRoundRect(Box{card.x + Rem(0.8), card.y, (card.width - Rem(1.6)) * drain, Rem(0.18)}, Rem(0.09), kFill);

    const bool compact = CompactViewport(width_, height_);
    const Box still{card.x + Rem(0.6), card.y + Rem(0.6), compact ? 0.0 : Rem(9.6), card.height - Rem(1.2)};
    if (!compact && (view_.nextStill.empty() || !painter.ImageFaded(still, view_.nextStill, Rem(0.45), 1.0, 0.5, 0.3))) {
        painter.FillLinearGradient(still, still.x, still.y, still.Right(), still.Bottom(),
                                   {GradientStop{0.0, Rgb(0x1C1C1F)}, GradientStop{1.0, Rgb(0x101012)}});
    }
    const double x = compact ? card.x + Rem(0.8) : still.Right() + Rem(0.9);
    const double width = card.Right() - x - Rem(0.8);
    const long seconds = static_cast<long>(std::ceil(std::max(0.0, view_.nextRemaining)));
    painter.Text(Box{x, card.y + Rem(0.55), width, Rem(1.1)}, "UP NEXT \xC2\xB7 in " + std::to_string(seconds) + "s",
                 TextStyle{Rem(0.66), true, 800}, kFill);
    painter.Text(Box{x, card.y + Rem(1.55), width, Rem(1.3)}, view_.nextShow, TextStyle{Rem(0.85), false, 550}, kInkMuted);
    painter.Text(Box{x, card.y + Rem(2.75), width, Rem(1.5)}, view_.nextEpisode, TextStyle{Rem(1.0), true, 700}, kInk);

    const Metrics metrics{ViewportRem(width_, height_)};
    DrawButton(painter, metrics, *BoxOf(kNextPlayKey), "Play next",
               ButtonLook{true, ShowsFocus(focused_, kNextPlayKey), ShowsFocus(focused_, kNextPlayKey) ? 1.0 : 0.0});
    const Box dismiss = *BoxOf(kNextDismissKey);
    if (ShowsFocus(focused_, kNextDismissKey)) {
        GlassStyle dismissGlass;
        dismissGlass.kind = GlassKind::Pill;
        dismissGlass.focused = true;
        dismissGlass.focusAmount = 1.0;
        dismissGlass.reduceTransparency = tokens::reduceTransparency;
        dismissGlass.tint = kHover;
        painter.Glass(dismiss, dismiss.height / 2.0, dismissGlass);
    }
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
    // The Android player's scrims: dark at the top behind the title, darker at the foot behind the controls.
    const double topHeight = Rem(kTopScrimRem);
    painter.FillLinearGradient(Box{0.0, 0.0, width_, topHeight}, 0.0, 0.0, 0.0, topHeight,
                               {GradientStop{0.0, Rgb(0x000000, 0.72 * opacity)},
                                GradientStop{0.55, Rgb(0x000000, 0.32 * opacity)},
                                GradientStop{1.0, Rgb(0x000000, 0.0)}});
    const double bottomHeight = std::min(height_ * 0.45, Rem(kBottomScrimRem));
    painter.FillLinearGradient(Box{0.0, height_ - bottomHeight, width_, bottomHeight}, 0.0, height_, 0.0,
                               height_ - bottomHeight,
                               {GradientStop{0.0, Rgb(0x000000, 0.82 * opacity)},
                                GradientStop{0.55, Rgb(0x000000, 0.38 * opacity)},
                                GradientStop{1.0, Rgb(0x000000, 0.0)}});

    const Color ink = WithAlpha(kInk, opacity);
    // Plain white controls, as on Android. Hover or focus lifts a soft light disc behind the control, eased by the
    // screen's button focus, so it comes and goes smoothly.
    const auto lit = [&](const char* key) { return buttonFocus_.Amount(key, clockMs_); };
    const auto button = [&](const char* key) {
        const Box box = *BoxOf(key);
        const double amount = lit(key);
        const std::string_view name(key);
        // The transport is icon only: its hover brightens and grows the icon, with no disc behind it. The tools draw
        // their own glass pill.
        const bool iconOnly = name == kPlayKey || name == kRewindKey || name == kForwardKey;
        const std::vector<std::string> tools = ToolKeys();
        const bool tool = std::find(tools.begin(), tools.end(), std::string(name)) != tools.end();
        if (amount > 0.01 && !iconOnly && !tool) {
            const bool round = name == kMuteKey || name == kFullscreenKey || name == kDownloadKey;
            const double radius = round ? std::min(box.width, box.height) / 2.0 : Rem(0.8);
            painter.FillRoundRect(box, radius, Rgb(0xFFFFFF, 0.14 * amount * opacity));
        }
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
    if (!CompactViewport(width_, height_)) {
    painter.Text(Box{brandRight - cinemaWidth, back.y, cinemaWidth + 2.0, back.height}, "C I N E M A", brandSmall,
                 WithAlpha(Rgb(0xFFFFFF, 0.6), opacity));
    painter.Text(Box{brandRight - cinemaWidth - Rem(0.55) - tvmWidth, back.y - Rem(0.1), tvmWidth + 2.0, back.height},
                 "TVM", brandBig, Rgb(0xFFFFFF, opacity));
    }

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
                     PathStyle{view_.saved ? ink : Color{0, 0, 0, 0}, ink, kGlyphStroke, false});
        painter.Text(Box{glyph.Right() + Rem(0.45), save.y, save.width, save.height}, view_.saved ? "Remove" : "Add",
                     TextStyle{Rem(0.75), true, 650}, ink);
    }
    if (view_.live && view_.liveBehind >= kLiveDriftThreshold) PaintGoLive(painter, opacity);

    // The timeline: the position, the bar, and the length, above the control row.
    const Box track = TrackBox();
    const TextStyle timeStyle{Rem(0.78), true, 600};
    const std::string now = FormatClock(view_.position);
    painter.Text(Box{Rem(kPadXRem), track.y, Rem(kTimeWidthRem), track.height}, view_.live ? "Live" : now, timeStyle, ink);
    const std::string length = view_.live ? "" : view_.duration > 0.0 ? FormatClock(view_.duration) : "\xE2\x80\x94:\xE2\x80\x94";
    const double lengthWidth = painter.MeasureText(length, timeStyle);
    painter.Text(Box{width_ - Rem(kPadXRem) - lengthWidth, track.y, lengthWidth + 2.0, track.height}, length, timeStyle,
                 ink);
    // The Android bar: a thin track that thickens while dragged, the played part in the brand gradient, and a white
    // thumb centred exactly on the position.
    const std::optional<double> preview = scrub_.has_value() ? scrub_ : hover_;
    const bool dragging = scrub_.has_value();
    const double barHeight = Rem(dragging ? kSeekTrackDragRem : kSeekTrackRem);
    const Box bar{track.x, track.CenterY() - barHeight / 2.0, track.width, barHeight};
    painter.FillRoundRect(bar, barHeight / 2.0, Rgb(0xFFFFFF, 0.24 * opacity));
    // While a drag is held the bar follows it, so the viewer sees where the seek will land.
    const double played = view_.duration > 0.0 ? std::clamp(view_.position / view_.duration, 0.0, 1.0) : 0.0;
    const double share = view_.live ? 1.0 : scrub_.value_or(played);
    if (share > 0.0) {
        const Box fill{bar.x, bar.y, bar.width * share, bar.height};
        painter.FillRoundRect(Box{fill.x, fill.y, std::min(fill.width, barHeight), fill.height}, barHeight / 2.0,
                              WithAlpha(kBrandStart, opacity));
        painter.FillLinearGradient(Box{fill.x + barHeight / 2.0, fill.y, std::max(0.0, fill.width - barHeight / 2.0), fill.height},
                                   bar.x, 0.0, bar.Right(), 0.0,
                                   {GradientStop{0.0, WithAlpha(kBrandStart, opacity)},
                                    GradientStop{0.5, WithAlpha(kBrandMid, opacity)},
                                    GradientStop{1.0, WithAlpha(kBrandEnd, opacity)}});
    }
    if (!view_.live) {
        const bool big = dragging || preview.has_value() || ShowsFocus(focused_, "timeline");
        const double thumb = Rem(kSeekThumbRem) * (big ? 1.3 : 1.0);
        const double cx = bar.x + bar.width * share;
        const double halo = thumb + Rem(0.5);
        painter.FillRoundRect(Box{cx - halo / 2.0, bar.CenterY() - halo / 2.0, halo, halo}, halo / 2.0,
                              Rgb(0xFFFFFF, 0.18 * opacity));
        painter.FillRoundRect(Box{cx - thumb / 2.0, bar.CenterY() - thumb / 2.0 + 1.5, thumb, thumb}, thumb / 2.0,
                              Rgb(0x000000, 0.35 * opacity));
        painter.FillRoundRect(Box{cx - thumb / 2.0, bar.CenterY() - thumb / 2.0, thumb, thumb}, thumb / 2.0,
                              Rgb(0xFFFFFF, opacity));
    }

    // The transport, centred on the window: back ten, play or pause, forward ten. White icons with a soft shadow,
    // as on Android; hover or focus grows the icon a touch.
    const PathStyle shade{Rgb(0x000000, 0.35 * opacity), Color{0, 0, 0, 0}, 0.0, false};
    const auto transportInk = [&](double amount) {
        const double t = std::clamp(amount, 0.0, 1.0);
        Color color{kTransportInk.r + (1.0 - kTransportInk.r) * t, kTransportInk.g + (1.0 - kTransportInk.g) * t,
                    kTransportInk.b + (1.0 - kTransportInk.b) * t, kTransportInk.a + (1.0 - kTransportInk.a) * t};
        return WithAlpha(color, color.a * opacity);
    };
    const Box play = button(kPlayKey);
    {
        const double amount = lit(kPlayKey);
        const double grow = 1.0 + 0.04 * amount;
        const Box glyph = GlyphBox(play, Rem(kTransportPlayGlyphRem) * grow);
        const char* path = view_.paused ? kAndroidPlayPath : kAndroidPausePath;
        painter.Path(Box{glyph.x, glyph.y + 1.5, glyph.width, glyph.height}, 48.0, path, shade);
        painter.Path(glyph, 48.0, path, PathStyle{transportInk(amount), Color{0, 0, 0, 0}, 0.0, false});
    }
    if (!view_.live) {
        for (const char* key : {kRewindKey, kForwardKey}) {
            const Box box = button(key);
            const double amount = lit(key);
            const double grow = 1.0 + 0.04 * amount;
            const Box glyph = GlyphBox(box, Rem(kTransportSkipGlyphRem) * grow);
            const bool forward = std::string_view(key) == kForwardKey;
            const char* arc = forward ? kAndroidForwardArcPath : kAndroidBackArcPath;
            const PathStyle shadowLine{Color{0, 0, 0, 0}, Rgb(0x000000, 0.35 * opacity), kAndroidStroke, false};
            const PathStyle whiteLine{Color{0, 0, 0, 0}, transportInk(amount), kAndroidStroke, false};
            const Box shadowBox{glyph.x, glyph.y + 1.5, glyph.width, glyph.height};
            painter.Path(shadowBox, 48.0, arc, shadowLine);
            painter.Path(shadowBox, 48.0, kAndroidTenPath, shadowLine);
            painter.Path(glyph, 48.0, arc, whiteLine);
            painter.Path(glyph, 48.0, kAndroidTenPath, whiteLine);
        }
    }

    // The sound: the speaker, which mutes, then its bar from silence to 100% with a thumb on the level. A boost past
    // 100% shows the bar full and its percentage in blue.
    const Box mute = button(kMuteKey);
    const Box speaker = GlyphBox(mute, Rem(kGlyphRem));
    const bool silent = view_.muted || view_.volume <= 0.0;
    painter.Path(speaker, 32.0, kSpeakerPath, line);
    painter.Path(speaker, 32.0, silent ? kMutedPath : kWavesPath, line);
    const Box volumeTrack = VolumeTrackBox();
    const double volumeHeight = Rem(volumeDragging_ ? 0.3 : 0.22);
    const Box volumeBar{volumeTrack.x, volumeTrack.CenterY() - volumeHeight / 2.0, volumeTrack.width, volumeHeight};
    painter.FillRoundRect(volumeBar, volumeHeight / 2.0, Rgb(0xFFFFFF, 0.24 * opacity));
    const double level = silent ? 0.0 : std::clamp(view_.volume / kSliderVolume, 0.0, 1.0);
    if (level > 0.0) {
        painter.FillRoundRect(Box{volumeBar.x, volumeBar.y, volumeBar.width * level, volumeBar.height},
                              volumeHeight / 2.0, ink);
    }
    const double knob = Rem(volumeDragging_ ? 0.95 : 0.75);
    const double knobX = volumeBar.x + volumeBar.width * level;
    painter.FillRoundRect(Box{knobX - knob / 2.0, volumeBar.CenterY() - knob / 2.0 + 1.0, knob, knob}, knob / 2.0,
                          Rgb(0x000000, 0.3 * opacity));
    painter.FillRoundRect(Box{knobX - knob / 2.0, volumeBar.CenterY() - knob / 2.0, knob, knob}, knob / 2.0, ink);
    const std::string percent = silent ? "Muted" : Fixed(std::round(view_.volume * 100.0), "%.0f%%");
    painter.Text(Box{volumeTrack.Right() + Rem(0.55), volumeTrack.y, Rem(4.0), volumeTrack.height}, percent,
                 TextStyle{Rem(0.72), true, 600}, view_.volume > 1.0 && !silent ? WithAlpha(kFill, opacity) : ink);

    // The tools: subtitles, audio, quality and speed, each a word that opens its menu.
    for (const std::string& tool : ToolKeys()) {
        const Box box = button(tool.c_str());
        // The existing glass comes up under the pointer or the remote, as a rounded square, and stays while its menu
        // is open.
        const double amount = std::max(lit(tool.c_str()), menu_ == tool ? 1.0 : 0.0);
        if (amount > 0.01) {
            GlassStyle toolGlass;
            toolGlass.kind = GlassKind::Pill;
            toolGlass.focused = true;
            toolGlass.focusAmount = amount;
            toolGlass.opacity = amount * opacity;
            toolGlass.reduceTransparency = tokens::reduceTransparency;
            painter.Glass(box, Rem(0.6), toolGlass);
        }
        // Subtitles read faint while they are off.
        const bool off = tool == kSubtitlesKey &&
                         std::none_of(view_.subtitles.begin(), view_.subtitles.end(),
                                      [](const PlayerOption& option) { return option.selected && option.id != "no"; });
        CenteredText(painter, box, ToolLabel(tool), TextStyle{Rem(kToolFontRem), true, 650},
                     off ? WithAlpha(kInkMuted, opacity) : ink);
    }

    // Full screen, at the right.
    const Box full = button(kFullscreenKey);
    painter.Path(GlyphBox(full, Rem(kGlyphRem)), 32.0, view_.fullscreen ? kExitFullscreenPath : kFullscreenPath, line);

    // The title sits at the top centre (PaintTitleOverlay), so the middle of the control row is the transport's.
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
    const Metrics metrics{ViewportRem(width_, height_)};
    const double x = Rem(kPadXRem);
    const double width = std::min(width_ - 2.0 * x, Rem(44.0));
    const double top = height_ * 0.5 - Rem(6.5);
    painter.Text(Box{x, top, width, Rem(1.2)}, "PLAYBACK", TextStyle{Rem(0.8125), true, 700}, kFill);
    painter.Text(Box{x, top + Rem(1.4), width, Rem(3.3)}, view_.errorTitle, TextStyle{Rem(2.6), true, 750}, kInk);
    painter.Paragraph(Box{x, top + Rem(5.2), width, Rem(4.2)}, view_.errorBody, TextStyle{Rem(1.0625), false},
                      kInkMuted);
    for (const char* key : {kRetryKey, kErrorBackKey}) {
        const ButtonLook look{std::string_view(key) == kRetryKey, ShowsFocus(focused_, key), buttonFocus_.Amount(key, clockMs_)};
        DrawButton(painter, metrics, *BoxOf(key), std::string_view(key) == kRetryKey ? "Retry" : "Back", look);
    }
}

bool PlayerScreen::Navigate(nav::Direction direction, double nowMs) {
    ShowChrome(nowMs);
    if (MenuOpen()) {
        // An open menu holds the remote: up and down move along its rows.
        const std::size_t count = MenuOptions(menu_).size();
        const std::size_t before = menuIndex_;
        if (direction == nav::Direction::Up && menuIndex_ > 0) --menuIndex_;
        if (direction == nav::Direction::Down && menuIndex_ + 1 < count) ++menuIndex_;
        // The list scrolls only as far as keeps the row in view.
        const std::size_t shown = std::max<std::size_t>(1, MenuRowsShown(menu_));
        if (menuIndex_ < menuFirst_) menuFirst_ = menuIndex_;
        if (menuIndex_ >= menuFirst_ + shown) menuFirst_ = menuIndex_ + 1 - shown;
        if (menuIndex_ != before) MoveMenuHighlight(menuIndex_, false);
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
        MoveMenuHighlight(menuIndex_, false);
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
        const std::size_t shown = MenuRowsShown(menu_);
        const double top = MenuRowTop(*panel);
        if (Contains(*panel, x, y)) {
            if (y < top || y >= top + static_cast<double>(shown) * Rem(kMenuRowRem)) return std::nullopt;
            const auto row = menuFirst_ + static_cast<std::size_t>((y - top) / Rem(kMenuRowRem));
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
    if (const std::optional<double> level = VolumeAt(x, y)) return "volume:" + Fixed(*level, "%.4f");
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
        command.params["level"] = Fixed(std::stod(key.substr(7)), "%.3f");
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
        {
            // The panel fades in and rises into place from the button that opened it.
            const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
            const double from = menuShown_ == key ? MenuFade() : 0.0;
            menuShown_ = key;
            menuFade_ = motion::Tween(from, 1.0, clockMs_, reduced ? 0.0 : kMenuOpenMs, kMenuEase);
        }
        const std::vector<PlayerOption> options = MenuOptions(key);
        const auto chosen = std::find_if(options.begin(), options.end(), [](const PlayerOption& o) { return o.selected; });
        menuIndex_ = chosen == options.end() ? 0 : static_cast<std::size_t>(chosen - options.begin());
        // The list opens with the chosen row in view, near its middle when the list is long.
        const std::size_t shown = MenuRowsShown(key);
        const std::size_t most = options.size() > shown ? options.size() - shown : 0;
        menuFirst_ = std::min(menuIndex_ > shown / 2 ? menuIndex_ - shown / 2 : 0, most);
        MoveMenuHighlight(menuIndex_, true);
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
