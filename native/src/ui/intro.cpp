#include "ui/intro.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <initializer_list>
#include <span>
#include <string_view>
#include <vector>

#include "motion/easing.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

using motion::Keyframe;

// Reference height the metrics are measured against: rem = height / 67.5, as the other screens do.
constexpr double kReferenceRemsHeight = 67.5;
constexpr double kPi = 3.14159265358979323846;
// The mark's picture. The "asset:" prefix tells the platform painter it is a file shipped with the app.
constexpr char kMarkImage[] = "asset:tvm-icon.png";

// TvmIntro.tsx's timings, in milliseconds.
constexpr double kAnimMs = 3200.0;
constexpr double kFadeMs = 420.0;
constexpr double kReducedFadeMs = 160.0;
constexpr double kHoldMaxMs = 2800.0;

// cubic-bezier(0.16, 1, 0.3, 1), the curve of most of the sting's entrances.
constexpr motion::CubicBezier kSoftEase{0.16, 1.0, 0.3, 1.0};

// The dark theme's values behind the intro's variables (dark.css): --tvm-accent and --tvm-accent-blue, and the text
// mixed 12% toward white for --intro-paper. The stream form swaps the first two, as TvmIntro.css does.
constexpr Color kAccent = Rgb(0x6EC8FF);
constexpr Color kCool = Rgb(0x4AA0E0);
constexpr Color kPaper = Mix(tokens::kText, Rgb(0xFFFFFF), 0.12);
// The stream form's flare centre, `#e8fbff` in TvmIntro.css.
constexpr Color kStreamFlare = Rgb(0xE8FBFF);
// `.tvm-mark`'s background, which shows through where the picture is see-through.
constexpr Color kMarkBackground = Rgb(0x2F6BFF);

// Layout in em. The letter advances of the tag and the skip hint are measured from the web sting in a browser, with
// the body's font and the sting's weight, and without the letter-spacing. The spacing is the CSS value. The word's
// advances are measured the same way, from its own font.
constexpr double kLineHeight = 1.33;
constexpr double kWordSpacingEm = 0.2;
constexpr double kWordGapEm = 0.08;
constexpr std::array<double, 3> kWordAdvance{0.5764, 0.6740, 0.9499};  // T, V, M
constexpr double kTagSpacingEm = 0.52;
constexpr double kTagMarginRem = 0.15;
constexpr std::array<double, 5> kWatchAdvance{0.9619, 0.6246, 0.5292, 0.7183, 0.7575};  // W, A, T, C, H
constexpr std::array<double, 6> kStreamAdvance{0.5974, 0.5752, 0.6519, 0.5224, 0.6979, 0.9517};  // S, T, R, E, A, M
constexpr double kSkipSpacingEm = 0.08;
// The font weights of the word, the tag and the skip hint, from TvmIntro.css, and the alpha of the word's glow.
constexpr int kWordWeight = 800;
constexpr int kTagWeight = 750;
constexpr int kSkipWeight = 400;
constexpr double kGlowAlpha = 0.45;
// "Press OK to skip", one advance for each of its 16 characters.
constexpr std::array<double, 16> kSkipAdvance{0.5491, 0.3632, 0.5210, 0.4496, 0.4515, 0.2336, 0.7482, 0.5792,
                                              0.2336, 0.3576, 0.5829, 0.2355, 0.4496, 0.4928, 0.2317, 0.5886};

// A CSS animation: when it starts, how long it runs, its timing function, and whether it holds its last keyframe
// once it has ended (`both`). Before it starts it shows its first keyframe, as `backwards` does.
struct Anim {
    double delayMs;
    double durationMs;
    motion::CubicBezier timing;
    bool holdsEnd;
};

// The value of one keyframed property at `elapsedMs` since the sting started. Once the animation has ended, the
// property reads `base`, unless the animation holds its end.
double Channel(const Anim& anim, std::span<const Keyframe> frames, double elapsedMs, double base) {
    const double local = elapsedMs - anim.delayMs;
    if (local < 0.0) return frames.front().value;
    if (local >= anim.durationMs) return anim.holdsEnd ? frames.back().value : base;
    return motion::EvaluateKeyframes(frames, local / anim.durationMs, anim.timing);
}

// The value of a property that repeats every `periodMs` from the start of its loop.
double Loop(std::span<const Keyframe> frames, double elapsedMs, double periodMs, const motion::CubicBezier& timing) {
    const double progress = std::fmod(std::max(0.0, elapsedMs), periodMs) / periodMs;
    return motion::EvaluateKeyframes(frames, progress, timing);
}

// The same colour at another alpha.
Color Tinted(Color color, double alpha) {
    color.a = alpha;
    return color;
}

// The colour with its alpha scaled by `factor`, which is how an opacity or a fade applies to a colour.
Color Scaled(Color color, double factor) {
    color.a *= std::clamp(factor, 0.0, 1.0);
    return color;
}

// The gradient stops with their alphas scaled by `factor`.
std::vector<GradientStop> Faded(std::initializer_list<GradientStop> stops, double factor) {
    std::vector<GradientStop> faded(stops);
    for (GradientStop& stop : faded) stop.color = Scaled(stop.color, factor);
    return faded;
}

// A line of letter-spaced text, as the web sets it. `advances` are in em, one for each character, without the spacing,
// and `spacingEm` is the letter-spacing added after each one. The line is drawn a letter at a time so that every
// letter lands where the web's does.
struct Spaced {
    std::string_view text;
    std::span<const double> advances;
    double spacingEm;

    // The width of the whole line in em. Like the web's box, it includes the spacing after the last letter.
    double WidthEm() const {
        double total = 0.0;
        for (std::size_t i = 0; i < text.size(); ++i) total += advances[i] + spacingEm;
        return total;
    }
};

// The keyframes of the intro's animations, from TvmIntro.css and TvmMark.css. Each property has its own list.
constexpr Keyframe kBloomOpacity[] = {{0.0, 0.0}, {0.55, 1.0}, {1.0, 0.55}};
constexpr Keyframe kBloomScale[] = {{0.0, 0.45}, {0.55, 1.04}, {1.0, 1.0}};
constexpr Keyframe kBloomIdleOpacity[] = {{0.0, 0.4}, {0.5, 0.7}, {1.0, 0.4}};
constexpr Keyframe kBloomIdleScale[] = {{0.0, 1.0}, {0.5, 1.08}, {1.0, 1.0}};
constexpr Keyframe kRingOpacity[] = {{0.0, 0.7}, {1.0, 0.0}};
constexpr Keyframe kRingScale[] = {{0.0, 0.28}, {1.0, 1.55}};
constexpr Keyframe kFlareOpacity[] = {{0.0, 0.0}, {0.35, 1.0}, {1.0, 0.0}};
constexpr Keyframe kFlareShift[] = {{0.0, -1.2}, {0.35, -1.2}, {1.0, 0.28}};  // fraction of the flare's width
constexpr Keyframe kMoteOpacity[] = {{0.0, 0.0}, {0.3, 1.0}, {1.0, 0.0}};
constexpr Keyframe kMoteScale[] = {{0.0, 0.5}, {0.3, 1.0}, {1.0, 0.2}};
constexpr Keyframe kMoteShift[] = {{0.0, -0.5}, {0.3, 0.0}, {1.0, -0.5}};  // fraction of the mote's own size
constexpr Keyframe kMoteTurn[] = {{0.0, 0.0}, {0.3, 0.0}, {1.0, 1.0}};     // fraction of the mote's angle
constexpr Keyframe kMoteRise[] = {{0.0, 0.0}, {0.3, 0.0}, {1.0, -6.5}};     // rem
constexpr Keyframe kRayOpacity[] = {{0.0, 0.0}, {0.4, 0.9}, {1.0, 0.0}};
constexpr Keyframe kRayScale[] = {{0.0, 0.2}, {0.4, 1.1}, {1.0, 0.4}};  // scaleY
constexpr Keyframe kStageOpacity[] = {{0.0, 0.0}, {1.0, 1.0}};
constexpr Keyframe kStageRise[] = {{0.0, 0.7}, {1.0, 0.0}};  // rem
constexpr Keyframe kMarkOpacity[] = {{0.0, 0.0}, {1.0, 1.0}};
constexpr Keyframe kMarkScale[] = {{0.0, 0.72}, {1.0, 1.0}};
constexpr Keyframe kPictureOpacity[] = {{0.0, 0.0}, {0.55, 1.0}, {1.0, 1.0}};
constexpr Keyframe kPictureScale[] = {{0.0, 0.72}, {0.55, 1.04}, {1.0, 1.0}};
constexpr Keyframe kPictureIdleOpacity[] = {{0.0, 0.92}, {0.5, 1.0}, {1.0, 0.92}};
constexpr Keyframe kPictureIdleScale[] = {{0.0, 1.0}, {0.5, 1.03}, {1.0, 1.0}};
constexpr Keyframe kLetterOpacity[] = {{0.0, 0.0}, {1.0, 1.0}};
constexpr Keyframe kLetterRise[] = {{0.0, 0.55}, {1.0, 0.0}};  // em
constexpr Keyframe kSheenShift[] = {{0.0, -1.3}, {1.0, 1.3}};   // fraction of the sheen's width
constexpr Keyframe kTagOpacity[] = {{0.0, 0.0}, {1.0, 1.0}};
constexpr Keyframe kTagRise[] = {{0.0, 0.4}, {1.0, 0.0}};  // rem
constexpr Keyframe kTagIdleOpacity[] = {{0.0, 0.78}, {0.5, 1.0}, {1.0, 0.78}};
constexpr Keyframe kSkipOpacity[] = {{0.0, 0.0}, {1.0, 1.0}};

// The animations' delays and lengths, from TvmIntro.css.
constexpr Anim kBloomIn{80.0, 1600.0, motion::kMotionEase, false};
constexpr Anim kRingIn{120.0, 1150.0, kSoftEase, false};
constexpr Anim kMidRingIn{280.0, 1150.0, kSoftEase, false};
constexpr Anim kFlareIn{1050.0, 900.0, motion::kMotionEase, false};
constexpr Anim kStageIn{0.0, 700.0, kSoftEase, false};
constexpr Anim kMarkIn{0.0, 900.0, kSoftEase, false};
constexpr Anim kPictureIn{0.0, 2400.0, motion::kMotionEase, true};
constexpr Anim kLetterIn[] = {
    {850.0, 550.0, kSoftEase, true},
    {1000.0, 550.0, kSoftEase, true},
    {1150.0, 550.0, kSoftEase, true},
};
constexpr Anim kSheenIn{1550.0, 700.0, motion::kEase, false};
constexpr Anim kTagIn{1350.0, 500.0, motion::kMotionEase, true};
constexpr Anim kSkipIn{1700.0, 400.0, motion::kEase, true};
constexpr Anim kMoteIn[] = {
    {220.0, 900.0, kSoftEase, false},
    {300.0, 900.0, kSoftEase, false},
    {380.0, 900.0, kSoftEase, false},
    {460.0, 900.0, kSoftEase, false},
    {540.0, 900.0, kSoftEase, false},
    {620.0, 900.0, kSoftEase, false},
};
constexpr Anim kRayIn[] = {
    {450.0, 550.0, motion::kEase, false},
    {500.0, 550.0, motion::kEase, false},
    {550.0, 550.0, motion::kEase, false},
    {600.0, 550.0, motion::kEase, false},
};

// The mote and ray values, one per index, from TvmIntro.css.
constexpr std::size_t kMoteCount = 6;
constexpr Color kMoteColor[kMoteCount] = {
    tokens::kAccentStrong, kAccent, kCool, tokens::kAccentStrong, kAccent, kPaper,
};
// The stream form's motes: the accent and the cool blue swapped.
constexpr Color kStreamMoteColor[kMoteCount] = {
    tokens::kAccentStrong, kCool, kAccent, tokens::kAccentStrong, kCool, kPaper,
};
constexpr double kMoteTurnDeg[kMoteCount] = {20.0, 80.0, 140.0, 200.0, 260.0, 320.0};
constexpr std::size_t kRayCount = 4;
constexpr double kRayAngleDeg[kRayCount] = {-24.0, 18.0, -62.0, 58.0};

// What one frame draws with: the window's size, the time since each stage began, and the fade of the whole sting.
struct Frame {
    Painter& painter;
    double width;
    double height;
    double rem;
    double smaller;      // the shorter side of the window
    double elapsed;      // since the sting started
    double holdElapsed;  // since the hold began, or negative while it has not begun
    bool reduced;
    double alpha;        // the sting's fade, multiplied into everything it draws
    bool stream;         // the stream form, which swaps the accent and the cool blue
    // Since a hold ended in a skip, or negative. The bloom and the tag play their entrances again from then, as the
    // web's stylesheet restarts them when the hold's classes come off.
    double restartElapsed;
};

// Draws `line` with its left edge at `left` and its line box at `top`, each letter in its own box. The boxes are two
// em wide, so that no letter is cut with an ellipsis.
void DrawSpaced(const Frame& f, const Spaced& line, double left, double top, double size, double height, int weight,
                Color color) {
    double offset = 0.0;  // in em from `left`
    for (std::size_t i = 0; i < line.text.size(); ++i) {
        f.painter.Text(Box{left + offset * size, top, 2.0 * size, height}, line.text.substr(i, 1),
                       TextStyle{size, false, weight}, color);
        offset += line.advances[i] + line.spacingEm;
    }
}

// The page colour, and the two glows over it, `.tvm-intro__wash`. The stream form has the same two colours, with
// their strengths swapped.
void DrawWash(const Frame& f) {
    const Box whole{0.0, 0.0, f.width, f.height};
    f.painter.FillRoundRect(whole, 0.0, Scaled(tokens::kBackgroundDeep, f.alpha));
    const double cx = f.width / 2.0;
    const double upper = f.stream ? 0.26 : 0.28;
    const double lower = f.stream ? 0.16 : 0.22;
    f.painter.FillRadialGradient(whole, cx, f.height / 2.0, 0.70 * f.width, 0.58 * f.height,
                                 Faded({{0.0, Tinted(kAccent, upper)}, {0.64, Tinted(kAccent, 0.0)},
                                        {1.0, Tinted(kAccent, 0.0)}},
                                       f.alpha));
    f.painter.FillRadialGradient(whole, cx, 1.08 * f.height, 0.90 * f.width, 0.70 * f.height,
                                 Faded({{0.0, Tinted(kCool, lower)}, {0.58, Tinted(kCool, 0.0)},
                                        {1.0, Tinted(kCool, 0.0)}},
                                       f.alpha));
}

// The glow behind the mark, `.tvm-intro__bloom`. It blooms, is gone after 1.68 s, and breathes while the sting holds.
void DrawBloom(const Frame& f) {
    double opacity = 1.0;
    double scale = 1.0;
    if (!f.reduced && f.holdElapsed >= 0.0) {
        opacity = Loop(kBloomIdleOpacity, f.holdElapsed, 3200.0, motion::kEaseInOut);
        scale = Loop(kBloomIdleScale, f.holdElapsed, 3200.0, motion::kEaseInOut);
    } else if (!f.reduced) {
        const double t = f.restartElapsed >= 0.0 ? f.restartElapsed : f.elapsed;
        opacity = Channel(kBloomIn, kBloomOpacity, t, 0.0);
        scale = Channel(kBloomIn, kBloomScale, t, 0.72);
    }
    const double size = std::min(42.0 * f.rem, 0.7 * f.smaller) * scale;
    const double cx = f.width / 2.0;
    const double cy = f.height / 2.0;
    // The gradient's radius is the distance from the centre to a corner of its box.
    const double radius = size / std::sqrt(2.0);
    // The stream form's bloom is the cool blue at lower strengths, as `.tvm-intro--stream .tvm-intro__bloom` has it.
    const Color core = f.stream ? Tinted(kAccent, 0.34) : Tinted(tokens::kAccentStrong, 0.36);
    const double mid = f.stream ? 0.12 : 0.14;
    f.painter.FillRadialGradient(Box{cx - size / 2.0, cy - size / 2.0, size, size}, cx, cy, radius, radius,
                                 Faded({{0.0, core}, {0.46, Tinted(kAccent, mid)},
                                        {0.72, Tinted(kAccent, 0.0)}, {1.0, Tinted(kAccent, 0.0)}},
                                       opacity * f.alpha));
}

// One ring that rings out from the mark, `.tvm-intro__ring`. Its 2px border sits inside its box.
void DrawRing(const Frame& f, double size, const Anim& anim, Color color) {
    double opacity = 1.0;
    double scale = 1.0;
    if (!f.reduced) {
        opacity = Channel(anim, kRingOpacity, f.elapsed, 0.0);
        scale = Channel(anim, kRingScale, f.elapsed, 0.35);
    }
    const double cx = f.width / 2.0;
    const double cy = f.height / 2.0;
    const double radius = (size / 2.0 - 1.0) * scale;
    f.painter.StrokeRoundRect(Box{cx - radius, cy - radius, 2.0 * radius, 2.0 * radius}, radius, 2.0 * scale,
                              Scaled(color, opacity * f.alpha));
}

// The light line that sweeps across the field, `.tvm-intro__flare`.
void DrawFlare(const Frame& f) {
    const double width = std::min(46.0 * f.rem, 0.72 * f.width);
    const double height = 0.14 * f.rem;
    double opacity = 1.0;
    double shift = -0.5 * width;  // translate(-50%): where reduced motion leaves it
    if (!f.reduced) {
        opacity = Channel(kFlareIn, kFlareOpacity, f.elapsed, 0.0);
        shift = Channel(kFlareIn, kFlareShift, f.elapsed, -1.2) * width;
    }
    const Box box{f.width / 2.0 + shift, f.height / 2.0 - height / 2.0, width, height};
    // The stream form's flare has its own bright centre, and the cool blue where the others have the strong tone.
    const Color centre = f.stream ? kStreamFlare : kPaper;
    const Color middle = f.stream ? kAccent : tokens::kAccentStrong;
    f.painter.FillLinearGradient(box, box.x, 0.0, box.Right(), 0.0,
                                 Faded({{0.0, Tinted(kPaper, 0.0)}, {0.32, Tinted(centre, 1.0)},
                                        {0.5, Tinted(middle, 1.0)}, {0.68, Tinted(kAccent, 1.0)},
                                        {1.0, Tinted(kAccent, 0.0)}},
                                       opacity * f.alpha));
}

// The six motes that fly out from the centre along their own angles, `.tvm-intro__mote`. Each one turns as it
// rises, so its path curves. Motes sit at the centre once reduced motion has them.
void DrawMotes(const Frame& f) {
    const double size = 0.28 * f.rem;
    const double half = size / 2.0;
    const double cx = f.width / 2.0;
    const double cy = f.height / 2.0;
    const Color* colours = f.stream ? kStreamMoteColor : kMoteColor;
    for (std::size_t i = 0; i < kMoteCount; ++i) {
        double opacity = 1.0;
        double scale = 1.0;
        double shift = -0.5;
        double turn = 0.0;
        double rise = 0.0;
        if (!f.reduced) {
            opacity = Channel(kMoteIn[i], kMoteOpacity, f.elapsed, 0.0);
            scale = Channel(kMoteIn[i], kMoteScale, f.elapsed, 1.0);
            shift = Channel(kMoteIn[i], kMoteShift, f.elapsed, -0.5);
            turn = Channel(kMoteIn[i], kMoteTurn, f.elapsed, 0.0);
            rise = Channel(kMoteIn[i], kMoteRise, f.elapsed, 0.0) * f.rem;
        }
        // The mote's box starts at the centre, so its centre is half a size in. The translate then moves it by
        // `shift` of its size, and the rise is taken along the axis turned by the angle.
        const double angle = turn * kMoteTurnDeg[i] * kPi / 180.0;
        const double x = cx + half + shift * size - rise * std::sin(angle);
        const double y = cy + half + shift * size + rise * std::cos(angle);
        const double radius = half * scale;
        f.painter.FillRoundRect(Box{x - radius, y - radius, 2.0 * radius, 2.0 * radius}, radius,
                                Scaled(colours[i], opacity * f.alpha));
    }
}

// The glow the word's letters cast: `text-shadow: 0 0 1.2rem` in the strong tone at 45%. The shadow is the glyph
// blurred with a Gaussian of sigma 0.6rem, which beside a straight edge leaves erfc(t / sqrt 2) / 2 at t sigmas outside
// the edge. The glow is a radial gradient about the glyph's centre that follows that falloff. The word's box clips it
// at its top and bottom, as the web's box does.
void DrawGlow(const Frame& f, double cx, double cy, double glyphRadius, double opacity) {
    constexpr double kSteps[] = {0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0};  // in sigmas outside the glyph
    const double sigma = 0.6 * f.rem;
    const double radius = glyphRadius + 3.0 * sigma;
    std::vector<GradientStop> stops{{0.0, Tinted(tokens::kAccentStrong, 0.8 * kGlowAlpha)}};
    for (const double t : kSteps) {
        stops.push_back({(glyphRadius + sigma * t) / radius,
                         Tinted(tokens::kAccentStrong, kGlowAlpha * 0.5 * std::erfc(t / std::sqrt(2.0)))});
    }
    for (GradientStop& stop : stops) stop.color = Scaled(stop.color, opacity * f.alpha);
    f.painter.FillRadialGradient(Box{cx - radius, cy - radius, 2.0 * radius, 2.0 * radius}, cx, cy, radius, radius,
                                 stops);
}

// The word's letters and the sheen across it, centred on `centreX` with its line at `top`.
void DrawWord(const Frame& f, double centreX, double top, double size) {
    std::array<double, 3> position{};
    for (std::size_t i = 1; i < position.size(); ++i) {
        position[i] = position[i - 1] + kWordAdvance[i - 1] + kWordSpacingEm + kWordGapEm;
    }
    const double width = (position.back() + kWordAdvance.back() + kWordSpacingEm) * size;
    const double left = centreX - width / 2.0;
    const Box word{left, top, width, size};
    static constexpr const char* kLetters[] = {"T", "V", "M"};

    f.painter.PushClip(word);
    for (std::size_t i = 0; i < position.size(); ++i) {
        double opacity = 1.0;
        double rise = 0.0;
        if (!f.reduced) {
            opacity = Channel(kLetterIn[i], kLetterOpacity, f.elapsed, 0.0);
            rise = Channel(kLetterIn[i], kLetterRise, f.elapsed, 0.0) * size;
        }
        const double x = left + position[i] * size;
        const double y = top + rise;
        // The span's text-shadow glows behind the letter, and is clipped to the word's box as the web clips it.
        DrawGlow(f, x + 0.5 * kWordAdvance[i] * size, y + 0.5 * size, 0.35 * size, opacity);
        // Each letter's box is two em wide, so a glyph that is wider than an em is not cut with an ellipsis.
        f.painter.Text(Box{x, y, 2.0 * size, size}, kLetters[i], TextStyle{size, true, kWordWeight},
                       Scaled(tokens::kText, opacity * f.alpha));
    }

    // The sheen is a band at 105 degrees, `.tvm-intro__sheen`, which sweeps across the word and is clipped to it.
    double shift = 0.0;
    if (!f.reduced) shift = Channel(kSheenIn, kSheenShift, f.elapsed, -1.3);
    const double sheenWidth = 1.4 * width;
    const Box sheen{left - 0.2 * width + shift * sheenWidth, top - 0.08 * size, sheenWidth, 1.16 * size};
    constexpr double kAngle = 105.0 * kPi / 180.0;
    const double dirX = std::sin(kAngle);
    const double dirY = -std::cos(kAngle);
    const double half = (std::abs(sheen.width * dirX) + std::abs(sheen.height * dirY)) / 2.0;
    const double cx = sheen.CenterX();
    const double cy = sheen.CenterY();
    f.painter.FillLinearGradient(sheen, cx - dirX * half, cy - dirY * half, cx + dirX * half, cy + dirY * half,
                                 Faded({{0.0, Tinted(kPaper, 0.0)}, {0.28, Tinted(kPaper, 0.0)},
                                        {0.5, Tinted(kPaper, 0.7)}, {0.72, Tinted(kPaper, 0.0)},
                                        {1.0, Tinted(kPaper, 0.0)}},
                                       f.alpha));
    f.painter.PopClip();
}

void DrawTag(const Frame& f, double centreX, double top, double size);

// The mark, its rays, the word and the tag, stacked in the middle, `.tvm-intro__stage`.
void DrawStage(const Frame& f) {
    double stageOpacity = 1.0;
    double stageRise = 0.0;
    if (!f.reduced) {
        stageOpacity = Channel(kStageIn, kStageOpacity, f.elapsed, 1.0);
        stageRise = Channel(kStageIn, kStageRise, f.elapsed, 0.0) * f.rem;
    }
    const Frame inner{f.painter,     f.width,     f.height,         f.rem,      f.smaller,
                      f.elapsed,     f.holdElapsed, f.reduced,      f.alpha * stageOpacity,
                      f.stream,      f.restartElapsed};

    const double markSize = std::min(13.5 * f.rem, 0.46 * f.width);
    const double gap = 0.85 * f.rem;
    const double wordSize = std::max(3.0 * f.rem, std::min(0.09 * f.width, 6.0 * f.rem));
    const double tagSize = 0.86 * f.rem;
    const double tagLine = kLineHeight * tagSize;
    const double stackHeight = markSize + gap + wordSize + gap + kTagMarginRem * f.rem + tagLine;
    const double markTop = f.height / 2.0 - stackHeight / 2.0 + stageRise;
    const double cx = f.width / 2.0;
    const double markCy = markTop + markSize / 2.0;

    // The mark's group scales in with its opacity, and the rays are in it too.
    double groupOpacity = 1.0;
    double groupScale = 1.0;
    if (!f.reduced) {
        groupOpacity = Channel(kMarkIn, kMarkOpacity, f.elapsed, 1.0);
        groupScale = Channel(kMarkIn, kMarkScale, f.elapsed, 1.0);
    }
    const auto toGroup = [&](double x, double y) {
        return Point{cx + (x - cx) * groupScale, markCy + (y - markCy) * groupScale};
    };

    // The rays fan out behind the picture. TvmMark's picture is drawn over them, so they show through only while
    // the picture is fading in.
    const double rayLength = 2.4 * f.rem;
    const double rayWidth = 0.14 * f.rem;
    const Point pivot{cx, markTop + 0.18 * markSize + rayLength};
    for (std::size_t i = 0; i < kRayCount; ++i) {
        double opacity = 1.0;
        double scaleY = 1.0;
        double angle = 0.0;
        if (!f.reduced) {
            opacity = Channel(kRayIn[i], kRayOpacity, f.elapsed, 0.0);
            scaleY = Channel(kRayIn[i], kRayScale, f.elapsed, 1.0);
            angle = kRayAngleDeg[i] * kPi / 180.0;
        }
        if (opacity <= 0.0) continue;
        const double cosA = std::cos(angle);
        const double sinA = std::sin(angle);
        // A point of the ray, given relative to the pivot with y going up, turned by the ray's angle and then
        // scaled with the group.
        const auto place = [&](double x, double y) {
            return toGroup(pivot.x + x * cosA - y * sinA, pivot.y + x * sinA + y * cosA);
        };
        const double top = -rayLength * scaleY;
        const Point topLeft = place(-rayWidth / 2.0, top);
        const Point topRight = place(rayWidth / 2.0, top);
        const Point bottomLeft = place(-rayWidth / 2.0, 0.0);
        const Point bottomRight = place(rayWidth / 2.0, 0.0);
        const Point tip = place(0.0, top);
        const Point base = place(0.0, 0.0);
        f.painter.FillPolygonLinear({bottomLeft, bottomRight, topRight, topLeft}, tip.x, tip.y, base.x, base.y,
                                    Faded({{0.0, Tinted(kPaper, 1.0)}, {1.0, Tinted(kPaper, 0.0)}},
                                          opacity * groupOpacity * inner.alpha));
    }

    // The picture. Its own bloom and then its loop come from TvmMark, and it is drawn over a blue plate only once
    // it is opaque, which is exact for a picture with no see-through parts.
    double pictureOpacity = 1.0;
    double pictureScale = 1.0;
    if (!f.reduced && f.holdElapsed >= 2400.0) {
        pictureOpacity = Loop(kPictureIdleOpacity, f.holdElapsed - 2400.0, 2600.0, motion::kEaseInOut);
        pictureScale = Loop(kPictureIdleScale, f.holdElapsed - 2400.0, 2600.0, motion::kEaseInOut);
    } else if (!f.reduced) {
        pictureOpacity = Channel(kPictureIn, kPictureOpacity, f.elapsed, 1.0);
        pictureScale = Channel(kPictureIn, kPictureScale, f.elapsed, 1.0);
    }
    const double pictureSize = markSize * groupScale * pictureScale;
    const Box picture{cx - pictureSize / 2.0, markCy - pictureSize / 2.0, pictureSize, pictureSize};
    const double pictureRadius = 0.22 * pictureSize;
    const double total = pictureOpacity * groupOpacity * inner.alpha;
    if (total >= 0.999) f.painter.FillRoundRect(picture, pictureRadius, kMarkBackground);
    f.painter.ImageFaded(picture, kMarkImage, pictureRadius, total, 0.5, 0.5);

    const double wordTop = markTop + markSize + gap;
    DrawWord(inner, cx, wordTop, wordSize);
    DrawTag(inner, cx, wordTop + wordSize + gap + kTagMarginRem * f.rem, tagSize);
}

// The line under the word, `.tvm-intro__tag`: "WATCH", or "STREAM" in the stream form, in the blue cool colour there.
// Its idle loop names no transform, so while the sting holds the tag keeps the 0.4rem drop it had from its entrance,
// as the web version does.
void DrawTag(const Frame& f, double centreX, double top, double size) {
    double opacity = 1.0;
    double rise = 0.0;
    if (!f.reduced && f.holdElapsed >= 0.0) {
        opacity = Loop(kTagIdleOpacity, f.holdElapsed, 2200.0, motion::kEaseInOut);
        rise = 0.4 * f.rem;
    } else if (!f.reduced) {
        const double t = f.restartElapsed >= 0.0 ? f.restartElapsed : f.elapsed;
        opacity = Channel(kTagIn, kTagOpacity, t, 0.0);
        rise = Channel(kTagIn, kTagRise, t, 0.4) * f.rem;
    }
    const Spaced tag = f.stream ? Spaced{"STREAM", kStreamAdvance, kTagSpacingEm}
                                : Spaced{"WATCH", kWatchAdvance, kTagSpacingEm};
    const Color colour = f.stream ? kAccent : tokens::kAccentStrong;
    const double left = centreX - tag.WidthEm() * size / 2.0;
    DrawSpaced(f, tag, left, top + rise, size, kLineHeight * size, kTagWeight,
               Scaled(colour, opacity * f.alpha));
}

// The "Press OK to skip" hint in the bottom right corner, `.tvm-intro__skip`.
void DrawSkip(const Frame& f) {
    double opacity = 1.0;
    if (!f.reduced) opacity = Channel(kSkipIn, kSkipOpacity, f.elapsed, 0.0);
    const double size = 0.78 * f.rem;
    const double lineHeight = kLineHeight * size;
    const Spaced hint{"Press OK to skip", kSkipAdvance, kSkipSpacingEm};
    const double right = f.width - 1.4 * f.rem;
    const double bottom = f.height - 1.2 * f.rem;
    DrawSpaced(f, hint, right - hint.WidthEm() * size, bottom - lineHeight, size, lineHeight, kSkipWeight,
               Scaled(tokens::kText, 0.55 * opacity * f.alpha));
}

}  // namespace

Intro::Intro(motion::MotionSettings motion, Form form) : motion_(motion), form_(form) {}

void Intro::Start(double nowMs) {
    if (started_) return;
    started_ = true;
    startMs_ = nowMs;
    clockMs_ = nowMs;
}

bool Intro::Visible() const {
    return started_ && !finished_;
}

bool Intro::Covers() const {
    // Its wash is opaque, and it stays opaque until its fade starts. Reduced motion has no fade, so it stays opaque
    // until it is gone.
    return Visible() && (!leaving_ || motion::PrefersReducedMotion(motion_));
}

void Intro::Skip(double nowMs) {
    if (!Visible() || leaving_) return;
    BeginLeave(nowMs);
}

void Intro::Tick(double nowMs) {
    if (!Visible()) return;
    clockMs_ = nowMs;
    if (!animDone_) {
        if (motion::PrefersReducedMotion(motion_)) {
            // Reduced motion shows the final frame at once, so there is nothing to wait for.
            animDone_ = true;
            animDoneMs_ = nowMs;
        } else if (nowMs - startMs_ >= kAnimMs) {
            animDone_ = true;
            animDoneMs_ = startMs_ + kAnimMs;
        }
    }
    if (leaving_) {
        if (nowMs - leaveMs_ >= LeaveMs()) finished_ = true;
        return;
    }
    if (!animDone_) return;
    if (!pending_) {
        BeginLeave(nowMs);
        return;
    }
    // The catalogue is still loading, so the sting holds on the mark. It gives up after kHoldMaxMs.
    if (!holdStarted_) {
        holdStarted_ = true;
        holdStartMs_ = animDoneMs_;
    }
    if (nowMs - animDoneMs_ >= kHoldMaxMs) BeginLeave(animDoneMs_ + kHoldMaxMs);
}

void Intro::Paint(Painter& painter, double width, double height) const {
    if (!Visible()) return;
    const bool reduced = motion::PrefersReducedMotion(motion_);
    // The hold's loops run only while the sting holds. A skip ends the hold, and the loops stop.
    const bool holding = holdStarted_ && !leaving_;
    const bool restarting = holdStarted_ && leaving_;
    Frame frame{painter,
                width,
                height,
                height / kReferenceRemsHeight,
                std::min(width, height),
                clockMs_ - startMs_,
                holding ? clockMs_ - holdStartMs_ : -1.0,
                reduced,
                1.0,
                form_ == Form::Stream,
                restarting ? clockMs_ - leaveMs_ : -1.0};
    // The whole sting fades out after it leaves, unless reduced motion has already cut it.
    if (leaving_ && !reduced) frame.alpha = 1.0 - motion::kEase.Ease((clockMs_ - leaveMs_) / kFadeMs);

    DrawWash(frame);
    DrawBloom(frame);
    DrawRing(frame, std::min(14.0 * frame.rem, 0.28 * frame.smaller), kRingIn, Tinted(tokens::kAccentStrong, 0.55));
    // The mid ring takes the form's accent, which is the cool blue in the stream form.
    DrawRing(frame, std::min(22.0 * frame.rem, 0.44 * frame.smaller), kMidRingIn,
             Tinted(frame.stream ? kCool : kAccent, 0.38));
    DrawFlare(frame);
    DrawMotes(frame);
    DrawStage(frame);
    DrawSkip(frame);
}

void Intro::BeginLeave(double nowMs) {
    leaving_ = true;
    leaveMs_ = nowMs;
}

double Intro::LeaveMs() const {
    return motion::PrefersReducedMotion(motion_) ? kReducedFadeMs : kFadeMs;
}

}  // namespace tvm::ui
