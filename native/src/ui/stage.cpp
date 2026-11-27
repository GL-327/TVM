#include "ui/stage.h"

#include <array>
#include <cmath>
#include <vector>

#include "motion/easing.h"

namespace tvm::ui {

namespace {

// The dark theme's colours for the stage, from apps/ui/src/theme/dark.css.
constexpr Color kSky = Rgb(0x14284C);
constexpr Color kSkyMid = Rgb(0x0C1C38);
constexpr Color kHorizon = Rgb(0x1A4A72);
constexpr Color kSea = Rgb(0x07101C);
constexpr Color kFoam = Rgb(0xA8D4F0);
constexpr Color kSun = Rgb(0xD8EEFE);
constexpr Color kWhite = Rgb(0xFFFFFF);

// `.tvm-scene { opacity: var(--tvm-scene-opacity) }`, which the dark theme sets to 0.52.
constexpr double kContainerOpacity = 0.52;
// The layers' own opacities: the veil's and the caustics' in scene.css, the sun's and the spec's before
// their keyframes, with the dark theme's overrides applied.
constexpr double kSkyOpacity = 1.0;
constexpr double kVeilOpacity = 0.32;
constexpr double kCausticOpacity = 0.7;
constexpr double kSunOpacity = 0.22;
constexpr double kSpecOpacity = 0.28;
// Reduced motion holds each layer at 0.7, and the sun and the spec at 0.36.
constexpr double kReducedLayerOpacity = 0.7;
constexpr double kReducedGlowOpacity = 0.36;
// Soft-light blends the caustics. Normal blending at the same alpha is about twice as bright over a dark ground,
// so the caustics are drawn at half strength.
constexpr double kSoftLightWeight = 0.5;
// `.tvm-scene__css { inset: -12% }`: the layers sit in a box 12% beyond each side of the window.
constexpr double kInset = 0.12;
constexpr double kSqrtTwo = 1.41421356237309504880;
// The drift easing: cubic-bezier(0.37, 0, 0.63, 1), with alternate directions, infinite.
constexpr motion::CubicBezier kDriftEase{0.37, 0.0, 0.63, 1.0};

// The keyframes of one layer: a transform from its first keyframe to its last, with translations in percent
// of the layer's box, and an opacity when the layer fades. `periodMs` and `delayMs` are its duration and delay.
struct Keyframes {
    double periodMs;
    double delayMs;
    double tx0;
    double ty0;
    double s0;
    double tx1;
    double ty1;
    double s1;
    bool fades;
    double opacity0;
    double opacity1;
};

// scene.css, in the order the layers are painted.
constexpr Keyframes kSkyDrift{24000.0, 0.0, -7.0, 3.5, 1.06, 7.5, -4.5, 1.16, false, 0.0, 0.0};
constexpr Keyframes kVeilDrift{31000.0, 0.0, 6.5, -5.0, 1.08, -8.5, 6.5, 1.2, false, 0.0, 0.0};
constexpr Keyframes kCausticDrift{19000.0, 0.0, -9.0, 4.0, 1.06, 7.5, -7.5, 1.22, false, 0.0, 0.0};
// The second caustic runs the same keyframes over 27 s, starting 9 s in.
constexpr Keyframes kCaustic2Drift{27000.0, -9000.0, -9.0, 4.0, 1.06, 7.5, -7.5, 1.22, false, 0.0, 0.0};
constexpr Keyframes kSunBreathe{21000.0, 0.0, 0.0, 0.0, 0.9, -11.0, 8.0, 1.18, true, 0.26, 0.56};
constexpr Keyframes kSpecDrift{34000.0, 0.0, -6.0, -4.0, 0.92, 74.0, 20.0, 1.3, true, 0.1, 0.4};

// A layer's transform and opacity at one moment. The translation is in pixels.
struct Pose {
    double tx = 0.0;
    double ty = 0.0;
    double scale = 1.0;
    double opacity = 1.0;
};

// The pose of a layer at `clockMs`. Before its delay it is in its own state, which is the layer's base opacity.
Pose PoseAt(const Keyframes& keys, const Box& box, double clockMs, double baseOpacity) {
    Pose pose;
    pose.opacity = baseOpacity;
    const double elapsed = clockMs - keys.delayMs;
    if (elapsed < 0.0) return pose;

    // With alternate directions, every other cycle runs back, and the timing curve is applied after that.
    const double cycles = elapsed / keys.periodMs;
    const double whole = std::floor(cycles);
    const double fraction = cycles - whole;
    const bool backwards = std::fmod(whole, 2.0) == 1.0;
    const double progress = kDriftEase.Ease(backwards ? 1.0 - fraction : fraction);

    pose.tx = (keys.tx0 + (keys.tx1 - keys.tx0) * progress) / 100.0 * box.width;
    pose.ty = (keys.ty0 + (keys.ty1 - keys.ty0) * progress) / 100.0 * box.height;
    pose.scale = keys.s0 + (keys.s1 - keys.s0) * progress;
    if (keys.fades) pose.opacity = keys.opacity0 + (keys.opacity1 - keys.opacity0) * progress;
    return pose;
}

// One radial gradient of a layer: its centre and its radii in window pixels, before the layer's transform.
struct Radial {
    double cx;
    double cy;
    double rx;
    double ry;
    std::vector<GradientStop> stops;
};

// The same colour at another alpha. The stops are given their alphas in scene.css, so they are set, not scaled.
Color Tinted(Color color, double alpha) {
    color.a = alpha;
    return color;
}

// The box of the layers, `.tvm-scene__css`, which is 12% beyond each side of the window.
Box StageBox(double width, double height) {
    return Box{-kInset * width, -kInset * height, (1.0 + 2.0 * kInset) * width, (1.0 + 2.0 * kInset) * height};
}

// The point at fractions of a box, as `at 48% -8%` places a gradient.
double AtX(const Box& box, double fraction) {
    return box.x + fraction * box.width;
}

double AtY(const Box& box, double fraction) {
    return box.y + fraction * box.height;
}

Radial SkyGradient(const Box& box) {
    return Radial{AtX(box, 0.48), AtY(box, -0.08), 1.20 * box.width, 0.80 * box.height,
                  {{0.0, Tinted(kSky, 0.70)}, {0.42, Tinted(kSkyMid, 0.28)}, {0.70, Tinted(kSkyMid, 0.0)},
                   {1.0, Tinted(kSkyMid, 0.0)}}};
}

Radial VeilGradient(const Box& box) {
    return Radial{AtX(box, 0.50), AtY(box, 0.42), 0.90 * box.width, 0.42 * box.height,
                  {{0.0, Tinted(kHorizon, 0.38)}, {0.36, Tinted(kFoam, 0.12)}, {0.68, Tinted(kFoam, 0.0)},
                   {1.0, Tinted(kFoam, 0.0)}}};
}

Radial CausticGradient(const Box& box) {
    return Radial{AtX(box, 0.18), AtY(box, 0.88), 0.70 * box.width, 0.55 * box.height,
                  {{0.0, Tinted(kFoam, 0.32)}, {0.34, Tinted(kSea, 0.22)}, {0.62, Tinted(kSea, 0.0)},
                   {1.0, Tinted(kSea, 0.0)}}};
}

Radial Caustic2Gradient(const Box& box) {
    return Radial{AtX(box, 0.86), AtY(box, 0.78), 0.62 * box.width, 0.50 * box.height,
                  {{0.0, Tinted(kSun, 0.26)}, {0.40, Tinted(kSea, 0.18)}, {0.64, Tinted(kSea, 0.0)},
                   {1.0, Tinted(kSea, 0.0)}}};
}

// `circle at 50% 50%` with the default farthest-corner size: the radius reaches the corner of the box.
Radial SunGradient(const Box& box) {
    const double cx = box.CenterX();
    const double cy = box.CenterY();
    const double radius = std::sqrt((box.width / 2.0) * (box.width / 2.0) + (box.height / 2.0) * (box.height / 2.0));
    const Color core{0.7 * kSun.r + 0.3 * kWhite.r, 0.7 * kSun.g + 0.3 * kWhite.g, 0.7 * kSun.b + 0.3 * kWhite.b, 1.0};
    return Radial{cx, cy, radius, radius,
                  {{0.0, core}, {0.32, Tinted(kSun, 0.28)}, {0.68, Tinted(kSun, 0.0)}, {1.0, Tinted(kSun, 0.0)}}};
}

// `ellipse at 50% 50%` with the default farthest-corner size: each radius is the half side times root two.
Radial SpecGradient(const Box& box) {
    return Radial{box.CenterX(), box.CenterY(), (box.width / 2.0) * kSqrtTwo, (box.height / 2.0) * kSqrtTwo,
                  {{0.0, Tinted(kFoam, 0.55)}, {0.70, Tinted(kFoam, 0.0)}, {1.0, Tinted(kFoam, 0.0)}}};
}

// Paints one layer. The gradient moves and scales about the centre of the layer's box, as the layer's transform
// does. Each colour's alpha is scaled by `alpha`, which carries the layer's opacity, the container's, and the
// blend weight.
void PaintLayer(Painter& painter, const Box& viewport, const Box& box, const Pose& pose, Radial radial, double alpha) {
    const double centerX = box.CenterX();
    const double centerY = box.CenterY();
    const double x = centerX + pose.tx + pose.scale * (radial.cx - centerX);
    const double y = centerY + pose.ty + pose.scale * (radial.cy - centerY);
    for (GradientStop& stop : radial.stops) stop.color.a *= alpha;
    painter.FillRadialGradient(viewport, x, y, pose.scale * radial.rx, pose.scale * radial.ry, radial.stops);
}

// Paints a layered Windows 11 Bloom wave field of overlapping 3D-folded indigo/blue/violet ribbons.
void PaintBloomRibbons(Painter& painter, double width, double height, double clockMs, double strength) {
    const double t = clockMs * 0.00024;
    const double diag = std::hypot(width, height);
    // Deep sapphire/indigo back-lighting behind the silk waves.
    painter.FillRadialGradient(Box{0.0, 0.0, width, height}, width * 0.72, height * 0.44, width * 0.68, height * 0.72,
                               {GradientStop{0.0, Rgb(0x2F6BFF, 0.22 * strength)},
                                GradientStop{0.45, Rgb(0x4338CA, 0.14 * strength)},
                                GradientStop{1.0, Rgb(0x0B1530, 0.0)}});
    painter.FillRadialGradient(Box{0.0, 0.0, width, height}, width * 0.22, height * 0.78, width * 0.52, height * 0.52,
                               {GradientStop{0.0, Rgb(0x1E40AF, 0.18 * strength)},
                                GradientStop{0.6, Rgb(0x312E81, 0.08 * strength)},
                                GradientStop{1.0, Rgb(0x07101C, 0.0)}});

    struct RibbonSpec {
        double phase;
        double baseX;
        double baseY;
        double spanX;
        double spanY;
        double arch;
        double sway;
        double halfWidth;
        Color c0;
        Color c1;
        Color c2;
        Color crease;
        double widthScale;
    };
    const std::array<RibbonSpec, 4> ribbons = {{
        // 0: Deep cobalt velvet foundation ribbon sweeping low left -> upper right.
        {0.0, 0.02, 0.88, 1.06, -0.58, 0.16, 0.042, 0.24,
         Rgb(0x0A1C4A, 0.84 * strength), Rgb(0x1D4ED8, 0.86 * strength), Rgb(0x0F1738, 0.78 * strength),
         Rgb(0x60A5FA, 0.36 * strength), 1.15},
        // 1: Intersecting royal electric-blue wave arching across center-right.
        {1.3, 0.14, 0.98, 0.94, -0.82, 0.22, 0.052, 0.19,
         Rgb(0x142E7A, 0.82 * strength), Rgb(0x2F6BFF, 0.90 * strength), Rgb(0x1E3A8A, 0.74 * strength),
         Rgb(0x93C5FD, 0.55 * strength), 1.0},
        // 2: Deep amethyst/violet sculpted fold wrapping opposite curvature.
        {2.6, 0.28, 1.04, 0.76, -0.96, -0.18, 0.048, 0.16,
         Rgb(0x23175E, 0.80 * strength), Rgb(0x6D4AFF, 0.82 * strength), Rgb(0x1E296B, 0.70 * strength),
         Rgb(0xC4B5FD, 0.48 * strength), 0.92},
        // 3: Iridescent cyan crest ribbon foreground fold for high-contrast glass dispersion.
        {3.9, 0.42, 0.95, 0.64, -0.86, 0.19, 0.036, 0.125,
         Rgb(0x1E40AF, 0.68 * strength), Rgb(0x38BDF8, 0.82 * strength), Rgb(0x2563EB, 0.64 * strength),
         Rgb(0xE0F2FE, 0.72 * strength), 0.85},
    }};

    constexpr int kSteps = 28;
    for (const RibbonSpec& r : ribbons) {
        std::vector<Point> topEdge;
        std::vector<Point> bottomEdge;
        topEdge.reserve(static_cast<std::size_t>(kSteps) + 1);
        bottomEdge.reserve(static_cast<std::size_t>(kSteps) + 1);

        const double ph = t + r.phase;
        for (int i = 0; i <= kSteps; ++i) {
            const double u = static_cast<double>(i) / kSteps;
            const double wave = std::sin(u * 3.14159265 + ph * 0.7) * r.arch +
                                std::sin(u * 5.2 + ph * 1.15) * r.sway;
            const double sx = (r.baseX + r.spanX * u + std::cos(u * 2.6 + ph) * 0.04) * width;
            const double sy = (r.baseY + r.spanY * u + wave) * height;
            // Ribbon pinches organically at ends and twists across center.
            const double env = std::sin(u * 3.14159265);
            const double twist = 0.55 + 0.45 * std::cos(u * 3.6 + ph * 0.8);
            const double halfT = diag * r.halfWidth * (0.28 + 0.72 * env) * twist * r.widthScale;
            const double tilt = std::cos(u * 2.4 + ph * 0.5) * 0.42;
            const double nx = -r.spanY * 0.45 + tilt * 0.35;
            const double ny = r.spanX * 0.75;
            const double nlen = std::max(1e-5, std::hypot(nx, ny));
            const double ox = (nx / nlen) * halfT;
            const double oy = (ny / nlen) * halfT;
            topEdge.push_back(Point{sx - ox * 0.55, sy - oy * 0.75});
            bottomEdge.push_back(Point{sx + ox * 0.75, sy + oy * 0.95});
        }

        std::vector<Point> poly = topEdge;
        for (int i = kSteps; i >= 0; --i) poly.push_back(bottomEdge[static_cast<std::size_t>(i)]);
        const Point& midTop = topEdge[static_cast<std::size_t>(kSteps / 2)];
        const Point& midBot = bottomEdge[static_cast<std::size_t>(kSteps / 2)];
        painter.FillPolygonLinear(poly, midTop.x, midTop.y, midBot.x, midBot.y,
                                  {GradientStop{0.0, r.c1}, GradientStop{0.48, r.c0}, GradientStop{1.0, r.c2}});
        painter.StrokePolyline(topEdge, std::max(1.5, diag * 0.0022), r.crease);
    }
}

}  // namespace

Stage::Stage(motion::MotionSettings motion) : motion_(motion) {}

bool Stage::Shown() const {
    return !motion_.performanceMode;
}

bool Stage::Moving() const {
    return Shown() && !motion::PrefersReducedMotion(motion_);
}

void Stage::Paint(Painter& painter, double width, double height, double clockMs) const {
    if (!Shown() || width <= 0.0 || height <= 0.0) return;

    const bool reduced = motion::PrefersReducedMotion(motion_);
    const Box viewport{0.0, 0.0, width, height};
    const Box box = StageBox(width, height);
    // The sun is 28% of the layer box from its left and top, and the spec is 28% by 9%, both as dark.css and
    // scene.css place them.
    const Box sun{box.x + 0.62 * box.width, box.y - 0.06 * box.height, 0.28 * box.width, 0.28 * box.height};
    const Box spec{box.x + 0.18 * box.width, box.y + 0.28 * box.height, 0.28 * box.width, 0.09 * box.height};

    // Reduced motion holds every layer still, with the opacities it settles at.
    const auto poseOf = [&](const Keyframes& keys, const Box& layer, double baseOpacity, double reducedOpacity) {
        if (reduced) return Pose{0.0, 0.0, 1.0, reducedOpacity};
        return PoseAt(keys, layer, clockMs, baseOpacity);
    };

    const Pose skyPose = poseOf(kSkyDrift, box, kSkyOpacity, kReducedLayerOpacity);
    PaintLayer(painter, viewport, box, skyPose, SkyGradient(box), skyPose.opacity * kContainerOpacity);

    const Pose veilPose = poseOf(kVeilDrift, box, kVeilOpacity, kReducedLayerOpacity);
    PaintLayer(painter, viewport, box, veilPose, VeilGradient(box), veilPose.opacity * kContainerOpacity);

    const Pose causticPose = poseOf(kCausticDrift, box, kCausticOpacity, kReducedLayerOpacity);
    PaintLayer(painter, viewport, box, causticPose, CausticGradient(box),
               causticPose.opacity * kContainerOpacity * kSoftLightWeight);

    const Pose caustic2Pose = poseOf(kCaustic2Drift, box, kCausticOpacity, kReducedLayerOpacity);
    PaintLayer(painter, viewport, box, caustic2Pose, Caustic2Gradient(box),
               caustic2Pose.opacity * kContainerOpacity * kSoftLightWeight);

    const Pose sunPose = poseOf(kSunBreathe, sun, kSunOpacity, kReducedGlowOpacity);
    PaintLayer(painter, viewport, sun, sunPose, SunGradient(sun), sunPose.opacity * kContainerOpacity);

    const Pose specPose = poseOf(kSpecDrift, spec, kSpecOpacity, kReducedGlowOpacity);
    PaintLayer(painter, viewport, spec, specPose, SpecGradient(spec), specPose.opacity * kContainerOpacity);

    PaintBloomRibbons(painter, width, height, reduced ? 4200.0 : clockMs, reduced ? 0.85 : 1.0);
}

}  // namespace tvm::ui
