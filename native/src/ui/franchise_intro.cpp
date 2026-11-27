#include "ui/franchise_intro.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <regex>

#include "ui/layout.h"
#include "ui/theme.h"

namespace tvm::ui {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTau = kPi * 2.0;
constexpr double kFadeOutNormalMs = 450.0;
constexpr double kFadeOutSkipMs = 220.0;
constexpr double kReducedDurationMs = 950.0;

constexpr Color WithAlpha(Color color, double alpha) {
    return Color{color.r, color.g, color.b, std::clamp(alpha, 0.0, 1.0)};
}

struct Vec2 {
    double x = 0.0;
    double y = 0.0;
};

double Clamp01(double value) {
    return value < 0.0 ? 0.0 : value > 1.0 ? 1.0 : value;
}

double Lerp(double a, double b, double t) {
    return a + (b - a) * t;
}

double Ramp(double a, double b, double t) {
    if (b <= a) return t >= b ? 1.0 : 0.0;
    return Clamp01((t - a) / (b - a));
}

double Smooth(double a, double b, double t) {
    const double k = Ramp(a, b, t);
    return k * k * (3.0 - 2.0 * k);
}

double EaseOutCubic(double k) {
    const double u = 1.0 - Clamp01(k);
    return 1.0 - u * u * u;
}

double EaseInOutCubic(double k) {
    const double t = Clamp01(k);
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - std::pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

double EaseOutExpo(double k) {
    const double t = Clamp01(k);
    return t >= 1.0 ? 1.0 : 1.0 - std::pow(2.0, -10.0 * t);
}

class Rng {
public:
    explicit Rng(std::uint32_t seed) : state_(seed) {}
    double Next() {
        state_ += 0x6d2b79f5u;
        std::uint32_t t = state_;
        t = (t ^ (t >> 15)) * (t | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return static_cast<double>((t ^ (t >> 14))) / 4294967296.0;
    }

private:
    std::uint32_t state_;
};

Color ParseHex(const std::string& hex, std::uint32_t fallback, double alpha = 1.0) {
    if (hex.size() == 7 && hex[0] == '#') {
        char* end = nullptr;
        const unsigned long val = std::strtoul(hex.c_str() + 1, &end, 16);
        if (end != nullptr && *end == '\0') return Rgb(static_cast<std::uint32_t>(val), alpha);
    }
    return Rgb(fallback, alpha);
}

Color MixColor(Color a, Color b, double t, double alpha = 1.0) {
    const double k = Clamp01(t);
    return Color{Lerp(a.r, b.r, k), Lerp(a.g, b.g, k), Lerp(a.b, b.b, k), alpha};
}

std::string CleanTitleForCard(const std::string& raw) {
    std::string out = raw;
    // Strip trailing release year `(2025)` if present.
    const std::size_t paren = out.rfind(" (");
    if (paren != std::string::npos && paren > 0 && out.back() == ')') {
        bool digits = true;
        for (std::size_t i = paren + 2; i + 1 < out.size(); ++i) {
            if (out[i] < '0' || out[i] > '9') {
                digits = false;
                break;
            }
        }
        if (digits && out.size() - paren >= 7) out = out.substr(0, paren);
    }
    return out;
}

std::string ToUpperAscii(const std::string& s) {
    std::string out = s;
    for (char& ch : out) {
        if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A');
    }
    return out;
}

void AppendCubic(std::vector<Vec2>& pts, Vec2 p0, Vec2 p1, Vec2 p2, Vec2 p3, int steps) {
    for (int i = 1; i <= steps; ++i) {
        const double t = static_cast<double>(i) / steps;
        const double u = 1.0 - t;
        pts.push_back({u * u * u * p0.x + 3.0 * u * u * t * p1.x + 3.0 * u * t * t * p2.x + t * t * t * p3.x,
                       u * u * u * p0.y + 3.0 * u * u * t * p1.y + 3.0 * u * t * t * p2.y + t * t * t * p3.y});
    }
}

std::vector<Vec2> MirrorX(const std::vector<Vec2>& pts) {
    std::vector<Vec2> out;
    out.reserve(pts.size());
    for (const Vec2& p : pts) out.push_back({-p.x, p.y});
    return out;
}

std::vector<Point> ToScreen(const std::vector<Vec2>& pts, double cx, double cy, double sx, double sy, bool close = false) {
    std::vector<Point> out;
    out.reserve(pts.size() + (close ? 1 : 0));
    for (const Vec2& p : pts) out.push_back(Point{cx + p.x * sx, cy + p.y * sy});
    if (close && !out.empty()) out.push_back(out.front());
    return out;
}

std::vector<Point> SliceProgress(const std::vector<Point>& pts, double progress) {
    if (pts.size() < 2 || progress <= 0.0) return {};
    if (progress >= 1.0) return pts;
    double total = 0.0;
    for (std::size_t i = 1; i < pts.size(); ++i) {
        total += std::hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (total <= 1e-6) return {};
    const double target = total * Clamp01(progress);
    std::vector<Point> out{pts.front()};
    double acc = 0.0;
    for (std::size_t i = 1; i < pts.size(); ++i) {
        const double seg = std::hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (acc + seg >= target) {
            const double k = seg > 1e-6 ? (target - acc) / seg : 0.0;
            out.push_back(Point{Lerp(pts[i - 1].x, pts[i].x, k), Lerp(pts[i - 1].y, pts[i].y, k)});
            break;
        }
        acc += seg;
        out.push_back(pts[i]);
    }
    return out;
}

void PaintGlowDot(Painter& painter, double x, double y, double radius, Color core, Color glow, double alpha) {
    if (alpha <= 0.01 || radius <= 0.25) return;
    const Box box{x - radius, y - radius, radius * 2.0, radius * 2.0};
    painter.FillRadialGradient(box, x, y, radius, radius,
                               {GradientStop{0.0, WithAlpha(core, alpha)},
                                GradientStop{0.25, WithAlpha(glow, alpha * 0.72)},
                                GradientStop{0.58, WithAlpha(glow, alpha * 0.22)},
                                GradientStop{1.0, WithAlpha(glow, 0.0)}});
}

void PaintLetterboxAndVignette(Painter& painter, double w, double h, double u, double t, double strength) {
    const double r = std::hypot(w, h) * 0.62;
    painter.FillRadialGradient(Box{0.0, 0.0, w, h}, w * 0.5, h * 0.5, r, r,
                               {GradientStop{0.0, Color{0.0, 0.0, 0.0, 0.0}},
                                GradientStop{0.48, Color{0.0, 0.0, 0.0, 0.12 * strength}},
                                GradientStop{1.0, Color{0.0, 0.0, 0.0, strength}}});
    const double bar = h * 0.055 * EaseOutCubic(Ramp(0.0, 600.0, t));
    if (bar > 0.5) {
        painter.FillRoundRect(Box{0.0, 0.0, w, bar}, 0.0, Rgb(0x000000));
        painter.FillRoundRect(Box{0.0, h - bar, w, bar}, 0.0, Rgb(0x000000));
    }
    const double fadeIn = 1.0 - Smooth(0.0, 450.0, t);
    if (fadeIn > 0.005) painter.FillRoundRect(Box{0.0, 0.0, w, h}, 0.0, Rgb(0x000000, fadeIn));
    (void)u;
}

// Builds Mockingjay geometry in unit space (matching apps/ui/src/intros/scenes/mockingjay.ts).
std::vector<Vec2> Feather(Vec2 root, double angleRad, double length, double width, double bow) {
    const double ca = std::cos(angleRad);
    const double sa = std::sin(angleRad);
    const auto at = [&](double along, double side) {
        const double curve = bow * length * along * along;
        return Vec2{root.x + ca * along * length - sa * (side + curve),
                    root.y + sa * along * length + ca * (side + curve)};
    };
    const auto prof = [&](double k) {
        return width * std::pow(std::sin(kPi * std::min(1.0, k * 0.9 + 0.08)), 0.8);
    };
    std::vector<Vec2> out{at(0.0, 0.0)};
    for (int i = 1; i <= 8; ++i) out.push_back(at(i / 9.0, -prof(i / 9.0) * 0.5));
    out.push_back(at(1.0, 0.0));
    for (int i = 8; i >= 1; --i) out.push_back(at(i / 9.0, prof(i / 9.0) * 0.5));
    return out;
}

const std::vector<std::vector<Vec2>>& MockingjayShapes() {
    static const std::vector<std::vector<Vec2>> shapes = [] {
        std::vector<std::vector<Vec2>> out;
        const double deg = kPi / 180.0;
        const std::array<std::tuple<double, double, double>, 5> tailSpec = {{
            {90.0, 0.62, 0.10}, {72.0, 0.56, 0.095}, {108.0, 0.56, 0.095}, {56.0, 0.40, 0.085}, {124.0, 0.40, 0.085},
        }};
        for (const auto& [a, l, wd] : tailSpec) out.push_back(Feather({0.0, 0.32}, a * deg, l, wd, 0.0));

        const std::array<std::tuple<double, double, double>, 8> fan = {{
            {-52.0, 1.00, 0.12}, {-36.0, 1.14, 0.125}, {-20.0, 1.14, 0.125}, {-5.0, 1.06, 0.12},
            {10.0, 0.94, 0.115}, {25.0, 0.80, 0.11}, {41.0, 0.64, 0.105}, {58.0, 0.46, 0.10},
        }};
        std::vector<std::vector<Vec2>> wingR;
        for (const auto& [a, l, wd] : fan) {
            auto f = Feather({0.08, -0.14}, a * deg, l, wd, 0.16);
            wingR.push_back(f);
            out.push_back(f);
            out.push_back(MirrorX(f));
        }

        std::vector<Vec2> cover{{0.0, -0.20}};
        AppendCubic(cover, {0.0, -0.20}, {0.18, -0.46}, {0.48, -0.52}, {0.66, -0.34}, 10);
        AppendCubic(cover, {0.66, -0.34}, {0.58, -0.20}, {0.40, -0.08}, {0.20, 0.0}, 8);
        cover.push_back({0.0, 0.04});
        out.push_back(MirrorX(cover));
        out.push_back(cover);

        std::vector<Vec2> bodyRight{{0.06, -0.27}, {0.10, -0.12}, {0.105, 0.06}, {0.08, 0.26}, {0.04, 0.38}};
        std::vector<Vec2> body = bodyRight;
        body.push_back({0.0, 0.42});
        auto bodyLeft = MirrorX(bodyRight);
        std::reverse(bodyLeft.begin(), bodyLeft.end());
        body.insert(body.end(), bodyLeft.begin(), bodyLeft.end());
        out.push_back(std::move(body));

        std::vector<Vec2> head;
        for (int i = 0; i < 20; ++i) {
            const double ang = (static_cast<double>(i) / 20.0) * kTau;
            head.push_back({std::cos(ang) * 0.085, -0.34 + std::sin(ang) * 0.085});
        }
        out.push_back(std::move(head));
        out.push_back({{-0.03, -0.405}, {0.0, -0.60}, {0.03, -0.405}});
        out.push_back({{-0.01, -0.41}, {-0.10, -0.52}, {-0.03, -0.43}});
        return out;
    }();
    return shapes;
}

void PaintMockingjay(Painter& painter, double w, double h, double t, const FranchiseIntroPlan& plan) {
    const double u = std::min(w, h) * 0.5;
    const Color accent = ParseHex(plan.accentHex, 0xE8A33D);
    const Color flame = ParseHex(plan.glowHex, 0xFF6A2A);
    const Color hot = MixColor(accent, Rgb(0xFFF4D6), 0.72);
    constexpr double kRingR = 0.82;
    constexpr double kBurstAt = 2050.0;
    constexpr double kTitleAt = 2250.0;

    // Background ember depth + floor heat glow.
    painter.FillLinearGradient(Box{0.0, 0.0, w, h}, 0.0, 0.0, 0.0, h,
                               {GradientStop{0.0, Rgb(0x050202)},
                                GradientStop{0.55, Rgb(0x0D0504)},
                                GradientStop{1.0, Rgb(0x1D0B05)}});
    const double heatR = std::max(w, h) * 0.62;
    painter.FillRadialGradient(Box{0.0, 0.0, w, h}, w * 0.5, h * 1.08, heatR, heatR,
                               {GradientStop{0.0, WithAlpha(flame, 0.42)},
                                GradientStop{0.35, WithAlpha(flame, 0.14)},
                                GradientStop{1.0, WithAlpha(flame, 0.0)}});

    const double kBurst = (t - kBurstAt) / 1000.0;
    const double shake = kBurst > 0.0 ? std::exp(-kBurst * 6.0) * (u * 0.015) : 0.0;
    const double dxShake = std::sin(t * 0.093) * shake;
    const double dyShake = std::cos(t * 0.117) * shake * 0.7;

    // Rising ambient flame haze.
    const double smokeAlpha = 0.22 * Smooth(0.0, 900.0, t);
    if (smokeAlpha > 0.01) {
        Rng sRng(99);
        for (int i = 0; i < 6; ++i) {
            const double x0 = sRng.Next();
            const double y0 = 0.55 + sRng.Next() * 0.5;
            const double sc = 0.8 + sRng.Next() * 1.1;
            const double ph = sRng.Next() * kTau;
            const double sx = x0 * w + std::sin(t * 0.0004 + ph) * u * 0.3;
            const double sy = y0 * h - t * 0.012 * sc;
            PaintGlowDot(painter, sx, sy, u * 0.9 * sc, MixColor(flame, Rgb(0x3C1E14), 0.55), flame, smokeAlpha);
        }
    }

    const double move = EaseInOutCubic(Ramp(kBurstAt + 150.0, kBurstAt + 950.0, t));
    const double breathe = 1.0 + std::sin(t * 0.0021) * 0.006 * Smooth(1800.0, 2400.0, t);
    const double compact = h > w ? 0.78 : 0.62;
    const double cx = w * 0.5 + dxShake;
    const double cy = Lerp(h * 0.5, h > w ? h * 0.36 : h * 0.37, move) + dyShake;
    const double s = u * Lerp(compact + 0.06, compact * 0.78, move) * breathe;

    // Swirling embers gathering into the Mockingjay ring & wings.
    const auto& shapes = MockingjayShapes();
    {
        Rng rng(2026);
        constexpr int kSparks = 110;
        const double edge = Smooth(0.0, 450.0, t);
        for (int i = 0; i < kSparks; ++i) {
            const bool onRing = rng.Next() < 0.55;
            Vec2 target{};
            if (onRing) {
                const double ang = rng.Next() * kTau;
                const double rr = kRingR + (rng.Next() - 0.5) * 0.04;
                target = {std::cos(ang) * rr, std::sin(ang) * rr};
            } else {
                const auto& poly = shapes[static_cast<std::size_t>(rng.Next() * shapes.size()) % shapes.size()];
                target = poly[static_cast<std::size_t>(rng.Next() * poly.size()) % poly.size()];
            }
            const double x0 = rng.Next(), y0 = rng.Next();
            const double vy = 0.1 + rng.Next() * 0.3;
            const double ph = rng.Next() * kTau;
            const double fr = 0.0008 + rng.Next() * 0.0016;
            const double swirl = 0.05 + rng.Next() * 0.16;
            const double sz = 2.5 + rng.Next() * 4.5;
            const double st = 550.0 + rng.Next() * 850.0;
            const double dur = 750.0 + rng.Next() * 450.0;
            const double curve = (rng.Next() - 0.5) * 0.9;
            const bool gold = rng.Next() < 0.48;

            const double b = EaseInOutCubic(Ramp(st, st + dur, t));
            const double rise = t * vy * u * 0.001;
            const double bx = (x0 - 0.5) * w * 0.92 + w * 0.5;
            const double by = h * (0.5 + y0 * 0.58) - rise;
            const double sx = bx + std::cos(t * fr + ph) * swirl * u;
            const double sy = by + std::sin(t * fr * 1.3 + ph) * swirl * u * 0.7;
            const double tx = cx + target.x * s;
            const double ty = cy + target.y * s;
            const double ddx = tx - sx, ddy = ty - sy;
            const double bow = std::sin(b * kPi) * curve;
            const double px = t > kBurstAt - 80.0 ? tx : Lerp(sx, tx, b) - ddy * bow;
            const double py = t > kBurstAt - 80.0 ? ty : Lerp(sy, ty, b) + ddx * bow;
            const double land = t > st + dur ? 1.0 - Smooth(kBurstAt - 120.0, kBurstAt + 160.0, t) : 1.0;
            const double flick = 0.65 + 0.35 * std::sin(t * 0.013 * (0.6 + fr * 500.0) + ph);
            const double a = edge * flick * land * (0.88 - 0.1 * b);
            if (a <= 0.02 || py < -20.0 || py > h + 20.0) continue;
            const double rDot = sz * (1.0 + b * 0.8) * (u / 360.0 + 0.45) * 1.5;
            PaintGlowDot(painter, px, py, rDot, Rgb(0xFFECBE), gold ? accent : flame, a);
        }
    }

    // Mockingjay silhouette + golden ring.
    const double prog = EaseOutCubic(Ramp(900.0, 2000.0, t));
    if (prog > 0.01) {
        const double fillA = Smooth(1550.0, 2150.0, t);
        const double flash = 1.0 + std::max(0.0, 1.0 - std::abs(t - kBurstAt) / 260.0) * 1.2;
        if (fillA > 0.01) {
            const double fa = std::min(1.0, fillA * 0.78 * flash);
            const std::vector<GradientStop> bodyStops = {
                GradientStop{0.0, WithAlpha(MixColor(accent, Rgb(0xFFF6D6), 0.65), fa)},
                GradientStop{0.48, WithAlpha(accent, fa)},
                GradientStop{1.0, WithAlpha(MixColor(flame, Rgb(0x5A1900), 0.4), fa)},
            };
            for (const auto& shape : shapes) {
                painter.FillPolygonLinear(ToScreen(shape, cx, cy, s, s), cx, cy - 0.7 * s, cx, cy + 0.9 * s, bodyStops);
            }
            // Carved feather ribs.
            const std::array<std::array<double, 4>, 4> ribs = {{
                {0.12, -0.12, 0.90, -0.20}, {0.14, -0.06, 0.84, 0.0}, {0.16, 0.02, 0.66, 0.13}, {0.18, 0.10, 0.46, 0.23},
            }};
            for (int side : {1, -1}) {
                for (const auto& rib : ribs) {
                    painter.StrokePolyline({Point{cx + rib[0] * side * s, cy + rib[1] * s},
                                            Point{cx + rib[2] * side * s, cy + rib[3] * s}},
                                           std::max(1.0, 0.011 * s), Rgb(0x461800, 0.75 * fillA));
                }
            }
        }
        // Progressive golden stroke along pin shapes.
        const Color strokeGlow = WithAlpha(flame, std::min(1.0, 0.25 * flash));
        const Color strokeHot = WithAlpha(hot, std::min(1.0, 0.92 * flash));
        for (const auto& shape : shapes) {
            const auto scr = SliceProgress(ToScreen(shape, cx, cy, s, s, true), prog);
            if (scr.size() >= 2) {
                painter.StrokePolyline(scr, std::max(2.0, 0.042 * s), strokeGlow);
                painter.StrokePolyline(scr, std::max(1.2, 0.014 * s), strokeHot);
            }
        }
        // Clockwise golden ring + inner ring + fletch ticks.
        const double ringSweep = Smooth(850.0, 1800.0, t);
        if (ringSweep > 0.005) {
            constexpr int kRingSegs = 64;
            const int count = std::max(2, static_cast<int>(std::ceil(ringSweep * kRingSegs)) + 1);
            std::vector<Point> ringPts;
            ringPts.reserve(static_cast<std::size_t>(count));
            for (int i = 0; i < count; ++i) {
                const double frac = std::min(ringSweep, static_cast<double>(i) / kRingSegs);
                const double ang = -kPi * 0.5 + kTau * frac;
                ringPts.push_back(Point{cx + std::cos(ang) * kRingR * s, cy + std::sin(ang) * kRingR * s});
            }
            painter.StrokePolyline(ringPts, std::max(3.5, 0.068 * s), WithAlpha(flame, std::min(1.0, 0.22 * flash)));
            painter.StrokePolyline(ringPts, std::max(1.8, 0.026 * s), WithAlpha(hot, std::min(1.0, 0.92 * flash)));
        }
        const double inner = Smooth(1500.0, 2100.0, t);
        if (inner > 0.01) {
            std::vector<Point> innerRing;
            innerRing.reserve(65);
            for (int i = 0; i <= 64; ++i) {
                const double ang = (static_cast<double>(i) / 64.0) * kTau;
                innerRing.push_back(Point{cx + std::cos(ang) * (kRingR - 0.065) * s, cy + std::sin(ang) * (kRingR - 0.065) * s});
            }
            painter.StrokePolyline(innerRing, std::max(1.0, 0.008 * s), WithAlpha(hot, inner * 0.72));
            for (int i = 0; i < 48; ++i) {
                const double a = (static_cast<double>(i) / 48.0) * kTau;
                const double r0 = (kRingR + 0.045) * s;
                const double r1 = (kRingR + (i % 4 == 0 ? 0.10 : 0.07)) * s;
                painter.StrokePolyline({Point{cx + std::cos(a) * r0, cy + std::sin(a) * r0},
                                        Point{cx + std::cos(a) * r1, cy + std::sin(a) * r1}},
                                       std::max(1.0, 0.006 * s), WithAlpha(hot, inner * 0.55));
            }
        }
    }

    // Burst light spokes, flash, shockwave rings, and thrown embers.
    if (kBurst >= -0.02) {
        const double env = Smooth(kBurstAt - 60.0, kBurstAt + 160.0, t) * (1.0 - Smooth(kBurstAt + 250.0, kBurstAt + 1000.0, t) * 0.9);
        if (env > 0.01) {
            const double reach = u * (2.5 + kBurst * 0.6);
            const double spin = t * 0.00016;
            for (int i = 0; i < 18; ++i) {
                const double a = (static_cast<double>(i) / 18.0) * kTau + spin;
                const double wd = 0.018 + (i % 3) * 0.012;
                const std::vector<Point> spoke = {
                    Point{cx, cy},
                    Point{cx + std::cos(a - wd) * reach, cy + std::sin(a - wd) * reach},
                    Point{cx + std::cos(a + wd) * reach, cy + std::sin(a + wd) * reach},
                };
                painter.FillPolygonLinear(spoke, cx, cy, cx + std::cos(a) * reach, cy + std::sin(a) * reach,
                                          {GradientStop{0.0, Color{1.0, 0.93, 0.75, 0.35 * env}},
                                           GradientStop{0.45, WithAlpha(flame, 0.14 * env)},
                                           GradientStop{1.0, WithAlpha(flame, 0.0)}});
            }
        }
        const double flashA = std::exp(-std::max(0.0, kBurst) * 5.5) * Smooth(kBurstAt - 90.0, kBurstAt + 30.0, t);
        if (flashA > 0.01) {
            const double r = u * (1.2 + kBurst * 2.0);
            painter.FillRadialGradient(Box{0.0, 0.0, w, h}, cx, cy, r, r,
                                       {GradientStop{0.0, Color{1.0, 0.97, 0.89, std::min(1.0, flashA)}},
                                        GradientStop{0.25, WithAlpha(MixColor(accent, Rgb(0xFFD68C), 0.4), 0.75 * flashA)},
                                        GradientStop{0.6, WithAlpha(flame, 0.30 * flashA)},
                                        GradientStop{1.0, WithAlpha(flame, 0.0)}});
        }
        for (int ring = 0; ring < 2; ++ring) {
            const double kk = kBurst - ring * 0.14;
            if (kk <= 0.0 || kk > 1.1) continue;
            const double rr = s * kRingR + EaseOutCubic(kk / 1.1) * u * 2.4;
            const double fall = std::max(0.0, 1.0 - kk / 1.05);
            std::vector<Point> pts;
            pts.reserve(65);
            for (int i = 0; i <= 64; ++i) {
                const double a = (static_cast<double>(i) / 64.0) * kTau;
                pts.push_back(Point{cx + std::cos(a) * rr, cy + std::sin(a) * rr});
            }
            painter.StrokePolyline(pts, std::max(1.0, 18.0 * (1.0 - kk / 1.1)), WithAlpha(flame, fall * (ring == 0 ? 0.25 : 0.14)));
            painter.StrokePolyline(pts, std::max(1.0, (ring == 0 ? 4.0 : 6.0) * (1.0 - kk / 1.1)),
                                   WithAlpha(MixColor(accent, Rgb(0xFFE1A0), 0.5), fall * (ring == 0 ? 0.8 : 0.45)));
        }
        const double age = t - kBurstAt;
        if (age >= 0.0) {
            Rng eRng(3030);
            for (int i = 0; i < 64; ++i) {
                const double ang = eRng.Next() * kTau;
                const double speed = 0.25 + eRng.Next() * 1.35;
                const double life = 900.0 + eRng.Next() * 1100.0;
                const double size = 2.0 + eRng.Next() * 5.5;
                const double rise = 0.05 + eRng.Next() * 0.25;
                const double drag = 1.6 + eRng.Next() * 2.2;
                const bool gold = eRng.Next() < 0.5;
                const double ph = eRng.Next() * kTau;
                if (age > life) continue;
                const double kk = age / 1000.0;
                const double dist = ((1.0 - std::exp(-drag * kk)) / drag) * speed * u * 1.5;
                const double ex = cx + std::cos(ang) * (s * kRingR + dist);
                const double ey = cy + std::sin(ang) * (s * kRingR * 0.98 + dist) - rise * u * kk * kk * 1.4;
                const double lf = 1.0 - age / life;
                const double a = lf * lf * (0.6 + 0.4 * std::sin(t * 0.02 + ph));
                PaintGlowDot(painter, ex, ey, size * (0.5 + lf) * (u / 360.0 + 0.45) * 1.6, Rgb(0xFFECBE), gold ? accent : flame, a);
            }
        }
    }

    // Gold serif title card with expanding center reveal, diamond divider rule, and subtitle.
    const double wipe = EaseOutCubic(Ramp(kTitleAt, kTitleAt + 900.0, t));
    if (wipe > 0.01) {
        const double titleA = Smooth(kTitleAt, kTitleAt + 350.0, t);
        const double settle = 1.0 + (1.0 - EaseOutCubic(Ramp(kTitleAt, kTitleAt + 1300.0, t))) * 0.045;
        const double titleCy = h * (h > w ? 0.66 : 0.69);
        const double maxW = std::min(w * 0.86, u * 3.1) * settle;
        const double revealHalf = (maxW * 0.54) * (0.04 + wipe * 1.05);
        painter.PushOpacity(titleA);
        painter.PushClip(Box{w * 0.5 - revealHalf, titleCy - u * 0.45, revealHalf * 2.0, u * 0.9});

        const double mainPx = std::min(u * 0.24, w * 0.056) * settle;
        const TextStyle mainStyle{mainPx, true, 700, 0.16, true};
        const std::string heading = "THE HUNGER GAMES";
        const double textW = std::min(maxW, painter.MeasureText(heading, mainStyle) + 16.0);
        painter.Text(Box{w * 0.5 - textW * 0.5, titleCy - mainPx * 0.65 + 2.0, textW, mainPx * 1.25},
                     heading, mainStyle, WithAlpha(flame, 0.55));
        painter.Text(Box{w * 0.5 - textW * 0.5, titleCy - mainPx * 0.65, textW, mainPx * 1.25},
                     heading, mainStyle, MixColor(accent, Rgb(0xFFF7D6), 0.45));

        const double ruleY = titleCy + mainPx * 0.72;
        const double ruleHalf = std::max(u * 0.6, textW * 0.46);
        painter.FillLinearGradient(Box{w * 0.5 - ruleHalf, ruleY - 1.0, ruleHalf * 2.0, 2.0},
                                   w * 0.5 - ruleHalf, ruleY, w * 0.5 + ruleHalf, ruleY,
                                   {GradientStop{0.0, WithAlpha(accent, 0.0)},
                                    GradientStop{0.2, WithAlpha(accent, 0.9)},
                                    GradientStop{0.8, WithAlpha(accent, 0.9)},
                                    GradientStop{1.0, WithAlpha(accent, 0.0)}});
        const double d = mainPx * 0.09;
        painter.FillPolygon({Point{w * 0.5, ruleY - d}, Point{w * 0.5 + d, ruleY}, Point{w * 0.5, ruleY + d}, Point{w * 0.5 - d, ruleY}}, hot);

        if (!plan.title.empty()) {
            const std::string sub = ToUpperAscii(plan.title);
            const double subPx = std::min(mainPx * 0.42, maxW / std::max(1.0, static_cast<double>(sub.size()) * 0.85));
            const TextStyle subStyle{subPx, true, 650, 0.26, false};
            const double subW = std::min(maxW, painter.MeasureText(sub, subStyle) + 20.0);
            painter.Text(Box{w * 0.5 - subW * 0.5, ruleY + mainPx * 0.25, subW, subPx * 1.6},
                         sub, subStyle, MixColor(accent, Rgb(0xFFEEC8), 0.58, 0.96));
        }

        painter.PopClip();
        painter.PopOpacity();
    }

    PaintLetterboxAndVignette(painter, w, h, u, t, 0.70);
}

// Builds Doom mask half geometry (matching apps/ui/src/intros/scenes/doom.ts).
const std::vector<Vec2>& DoomFaceHalf() {
    static const std::vector<Vec2> pts = [] {
        std::vector<Vec2> out{{0.0, -0.66}};
        AppendCubic(out, {0.0, -0.66}, {0.20, -0.67}, {0.40, -0.54}, {0.45, -0.30}, 10);
        AppendCubic(out, {0.45, -0.30}, {0.48, -0.12}, {0.44, 0.12}, {0.38, 0.27}, 10);
        AppendCubic(out, {0.38, 0.27}, {0.33, 0.43}, {0.16, 0.56}, {0.0, 0.61}, 10);
        return out;
    }();
    return pts;
}

const std::vector<Vec2>& DoomHoodHalf() {
    static const std::vector<Vec2> pts = [] {
        std::vector<Vec2> out{{0.0, -1.02}};
        AppendCubic(out, {0.0, -1.02}, {0.50, -1.0}, {0.84, -0.62}, {0.86, -0.12}, 14);
        AppendCubic(out, {0.86, -0.12}, {0.88, 0.30}, {1.0, 0.62}, {1.12, 1.10}, 12);
        out.push_back({1.30, 1.95});
        out.push_back({0.0, 1.95});
        return out;
    }();
    return pts;
}

std::vector<std::vector<Vec2>> BuildRuneGlyphs(int count, std::uint32_t seed) {
    Rng rng(seed);
    std::vector<std::vector<Vec2>> out;
    for (int i = 0; i < count; ++i) {
        const int n = 3 + static_cast<int>(rng.Next() * 3.0);
        int gx = static_cast<int>(rng.Next() * 3.0);
        int gy = static_cast<int>(rng.Next() * 5.0);
        std::vector<Vec2> pts{{gx / 2.0, gy / 4.0}};
        for (int s = 1; s < n; ++s) {
            const int nx = static_cast<int>(rng.Next() * 3.0);
            const int ny = static_cast<int>(rng.Next() * 5.0);
            if (nx == gx && ny == gy) continue;
            gx = nx;
            gy = ny;
            pts.push_back({gx / 2.0, gy / 4.0});
        }
        out.push_back(std::move(pts));
    }
    return out;
}

void PaintRuneRing(Painter& painter, double cx, double cy, double s, double rFactor, double glyphSizeFactor,
                   double spin, double t, double alpha, Color arc, Color core,
                   const std::vector<std::vector<Vec2>>& glyphs) {
    const double r = rFactor * s;
    const double gs = glyphSizeFactor * s;
    std::vector<Point> innerC, outerC;
    innerC.reserve(65);
    outerC.reserve(65);
    for (int i = 0; i <= 64; ++i) {
        const double a = (static_cast<double>(i) / 64.0) * kTau;
        innerC.push_back(Point{cx + std::cos(a) * (r - gs * 0.9), cy + std::sin(a) * (r - gs * 0.9)});
        outerC.push_back(Point{cx + std::cos(a) * (r + gs * 1.7), cy + std::sin(a) * (r + gs * 1.7)});
    }
    painter.StrokePolyline(innerC, std::max(1.0, s * 0.006), WithAlpha(arc, alpha * 0.45));
    painter.StrokePolyline(outerC, std::max(1.0, s * 0.006), WithAlpha(arc, alpha * 0.45));

    const std::size_t n = glyphs.size();
    for (std::size_t i = 0; i < n; ++i) {
        const double born = Ramp(650.0 + (static_cast<double>(i) / n) * 700.0,
                                 800.0 + (static_cast<double>(i) / n) * 700.0, t);
        if (born <= 0.02) continue;
        const double a = (static_cast<double>(i) / n) * kTau + spin;
        const double ux = std::cos(a), uy = std::sin(a);
        const double tx = -uy, ty = ux;
        std::vector<Point> scr;
        scr.reserve(glyphs[i].size());
        for (const Vec2& p : glyphs[i]) {
            const double gx = (p.x - 0.5) * gs * 0.85;
            const double gy = p.y * gs;
            scr.push_back(Point{cx + ux * (r + gy) + tx * gx, cy + uy * (r + gy) + ty * gx});
        }
        painter.StrokePolyline(scr, std::max(2.0, s * 0.018), WithAlpha(arc, alpha * born * 0.22));
        painter.StrokePolyline(scr, std::max(1.0, s * 0.0065), WithAlpha(core, alpha * born * 0.90));
    }
}

void AppendBolt(Rng& rng, Vec2 a, Vec2 b, double disp, int depth, std::vector<std::vector<Point>>& out) {
    std::vector<Vec2> pts{a, b};
    double cur = disp;
    for (int d = 0; d < depth; ++d) {
        std::vector<Vec2> next;
        next.reserve(pts.size() * 2);
        next.push_back(pts.front());
        for (std::size_t i = 1; i < pts.size(); ++i) {
            const Vec2& p = pts[i - 1];
            const Vec2& q = pts[i];
            const double dx = q.x - p.x, dy = q.y - p.y;
            const double len = std::hypot(dx, dy);
            const double off = (rng.Next() - 0.5) * cur * len;
            const double nx = len > 1e-6 ? -dy / len : 0.0;
            const double ny = len > 1e-6 ? dx / len : 0.0;
            next.push_back(Vec2{(p.x + q.x) * 0.5 + nx * off, (p.y + q.y) * 0.5 + ny * off});
            next.push_back(q);
        }
        pts = std::move(next);
        cur *= 0.55;
    }
    std::vector<Point> scr;
    scr.reserve(pts.size());
    for (const Vec2& v : pts) scr.push_back(Point{v.x, v.y});
    out.push_back(std::move(scr));
}

void PaintDoom(Painter& painter, double w, double h, double t, const FranchiseIntroPlan& plan) {
    const double u = std::min(w, h) * 0.5;
    const Color accent = ParseHex(plan.accentHex, 0x3FA34D);
    const Color arc = MixColor(accent, Rgb(0x7CFF8A), 0.42);
    const Color core = Rgb(0xE8FFE8);
    const Color deep = ParseHex(plan.glowHex, 0x1E6B2A);
    constexpr double kBurstAt = 2000.0;
    constexpr double kSlamAt = 2380.0;
    constexpr double kSlamMs = 260.0;

    // Brushed dark-emerald iron wall.
    painter.FillLinearGradient(Box{0.0, 0.0, w, h}, 0.0, 0.0, 0.0, h,
                               {GradientStop{0.0, Rgb(0x020504)},
                                GradientStop{0.55, Rgb(0x040B08)},
                                GradientStop{1.0, Rgb(0x09160E)}});
    const double poolR = std::max(w, h) * 0.65;
    painter.FillRadialGradient(Box{0.0, 0.0, w, h}, w * 0.5, h * 0.48, poolR, poolR,
                               {GradientStop{0.0, WithAlpha(deep, 0.48 * Smooth(300.0, 1700.0, t))},
                                GradientStop{0.45, WithAlpha(deep, 0.16)},
                                GradientStop{1.0, WithAlpha(deep, 0.0)}});

    const double kb = (t - kBurstAt) / 1000.0;
    const double ks = (t - kSlamAt - kSlamMs) / 1000.0;
    const double shake = (kb > 0.0 ? std::exp(-kb * 6.0) * 0.018 : 0.0) + (ks > 0.0 ? std::exp(-ks * 8.0) * 0.010 : 0.0);
    const double dxShake = std::sin(t * 0.097) * shake * u;
    const double dyShake = std::cos(t * 0.121) * shake * u * 0.7;

    const double move = EaseInOutCubic(Ramp(kBurstAt + 200.0, kBurstAt + 1000.0, t));
    const double compact = h > w ? 0.86 : 0.76;
    const double cx = w * 0.5 + dxShake;
    const double cy = Lerp(h * 0.49, h > w ? h * 0.33 : h * 0.325, move) + dyShake;
    const double s = u * Lerp(compact, compact * (h > w ? 0.62 : 0.46), move) * (1.0 + std::sin(t * 0.002) * 0.004);

    // Glowing green pool behind mask.
    PaintGlowDot(painter, cx, cy, u * 1.5, arc, deep, Smooth(300.0, 1700.0, t) * (0.55 + 0.15 * std::sin(t * 0.004)));

    // Spiraling inward green motes.
    const auto& face = DoomFaceHalf();
    {
        Rng mRng(77);
        const double ma = Smooth(300.0, 700.0, t) * (1.0 - Smooth(1500.0, 1850.0, t));
        if (ma > 0.01) {
            for (int i = 0; i < 65; ++i) {
                const Vec2 targetP = face[static_cast<std::size_t>(mRng.Next() * face.size()) % face.size()];
                const double side = mRng.Next() < 0.5 ? -1.0 : 1.0;
                const double ang = mRng.Next() * kTau;
                const double dist = 0.9 + mRng.Next() * 0.7;
                const double start = 380.0 + mRng.Next() * 900.0;
                const double dur = 700.0 + mRng.Next() * 500.0;
                const double sz = 2.0 + mRng.Next() * 4.0;
                const double ph = mRng.Next() * kTau;
                const double curve = (mRng.Next() - 0.5) * 0.8;
                const double b = EaseInOutCubic(Ramp(start, start + dur, t));
                if (b >= 1.0 && t > kBurstAt - 200.0) continue;
                const double sx = cx + std::cos(ang) * dist * u * 1.5;
                const double sy = cy + std::sin(ang) * dist * 0.75 * u * 1.5;
                const double tx = cx + targetP.x * side * s;
                const double ty = cy + targetP.y * s;
                const double bow = std::sin(b * kPi) * curve;
                const double px = Lerp(sx, tx, b) - (ty - sy) * bow;
                const double py = Lerp(sy, ty, b) + (tx - sx) * bow;
                const double flick = 0.55 + 0.45 * std::sin(t * 0.012 + ph);
                PaintGlowDot(painter, px, py, sz * 2.2 * (u / 360.0 + 0.4), core, arc, ma * flick);
            }
        }
    }

    // Orbiting green mystic rune rings.
    static const auto runesA = BuildRuneGlyphs(24, 17);
    static const auto runesB = BuildRuneGlyphs(34, 29);
    const double runeAlpha = Smooth(650.0, 1500.0, t) * (0.5 + 0.5 * Smooth(kBurstAt - 100.0, kBurstAt + 200.0, t));
    if (runeAlpha > 0.01) {
        const double pulse = 0.82 + 0.18 * std::sin(t * 0.007);
        const double flash = std::max(0.0, 1.0 - std::abs(t - kBurstAt - 40.0) / 240.0);
        const double a = std::min(1.0, runeAlpha * pulse * (1.0 + flash * 0.6));
        PaintRuneRing(painter, cx, cy, s, 1.30, 0.10, t * 0.00009, t, a, arc, core, runesA);
        PaintRuneRing(painter, cx, cy, s, 1.58, 0.07, -t * 0.00013, t, a, arc, core, runesB);
    }

    // Hood & Two-plate Riveted Iron Doom Mask.
    const double gather = EaseOutCubic(Ramp(850.0, 1750.0, t));
    const double off = 0.62 * (1.0 - gather);
    const double maskA = Smooth(780.0, 1250.0, t);
    const double hoodA = Smooth(650.0, 1450.0, t);
    const auto& hood = DoomHoodHalf();
    if (hoodA > 0.01) {
        for (int side : {-1, 1}) {
            std::vector<Vec2> scaled;
            scaled.reserve(hood.size());
            for (const Vec2& p : hood) scaled.push_back({(p.x + off * 0.4) * side, p.y});
            painter.FillPolygonLinear(ToScreen(scaled, cx, cy, s, s), cx, cy - 1.02 * s, cx, cy + 1.5 * s,
                                      {GradientStop{0.0, Rgb(0x0E1B16, hoodA * 0.96)},
                                       GradientStop{0.42, Rgb(0x050A08, hoodA * 0.96)},
                                       GradientStop{0.72, Rgb(0x030605, hoodA * 0.80)},
                                       GradientStop{1.0, Rgb(0x020403, 0.0)}});
            std::vector<Vec2> rim(scaled.begin(), scaled.begin() + (scaled.size() > 2 ? scaled.size() - 2 : scaled.size()));
            painter.StrokePolyline(ToScreen(rim, cx, cy, s, s), std::max(1.5, 0.014 * s), WithAlpha(arc, hoodA * 0.55));
        }
    }
    if (maskA > 0.01) {
        const std::array<Vec2, 4> brow = {{{0.03, -0.32}, {0.41, -0.41}, {0.43, -0.35}, {0.05, -0.26}}};
        const std::array<Vec2, 4> nose = {{{0.0, -0.06}, {0.045, 0.03}, {0.07, 0.19}, {0.0, 0.23}}};
        const std::array<Vec2, 4> eyePoly = {{{0.06, -0.12}, {0.33, -0.25}, {0.37, -0.17}, {0.09, -0.04}}};
        const std::array<Vec2, 8> rivets = {{
            {0.36, -0.44}, {0.435, -0.20}, {0.37, 0.18}, {0.27, 0.40},
            {0.12, 0.54}, {0.14, -0.57}, {0.30, -0.52}, {0.06, 0.37},
        }};
        for (int side : {-1, 1}) {
            std::vector<Vec2> plate;
            plate.reserve(face.size());
            for (const Vec2& p : face) plate.push_back({(p.x + off) * side, p.y});
            const auto scr = ToScreen(plate, cx, cy, s, s, false);
            const double lit = side > 0 ? 1.0 : 0.78;
            painter.FillPolygonLinear(scr, cx + side * 0.02 * s, cy - 0.64 * s, cx + side * 0.46 * s, cy + 0.60 * s,
                                      {GradientStop{0.0, MixColor(Rgb(0x28322D), Rgb(0xBED0C6), lit, maskA)},
                                       GradientStop{0.28, MixColor(Rgb(0x1E2824), Rgb(0x788C82), lit, maskA)},
                                       GradientStop{0.62, MixColor(Rgb(0x0E1411), Rgb(0x34423B), lit, maskA)},
                                       GradientStop{1.0, Rgb(0x070C0A, maskA)}});
            painter.StrokePolyline(scr, std::max(1.2, 0.020 * s), Rgb(0x000000, 0.75 * maskA));
            painter.StrokePolyline(scr, std::max(1.0, 0.008 * s), WithAlpha(MixColor(Rgb(0xAACDB9), arc, 0.15), 0.55 * lit * maskA));

            const auto xform = [&](auto&& pts) {
                std::vector<Vec2> v;
                for (const Vec2& p : pts) v.push_back({(p.x + off) * side, p.y});
                return ToScreen(v, cx, cy, s, s);
            };
            painter.FillPolygon(xform(brow), Rgb(0x0A110E, maskA));
            painter.FillPolygon(xform(nose), Rgb(0x020403, maskA));
            for (const auto& [vy, vx1] : std::array<std::pair<double, double>, 3>{{{0.34, 0.20}, {0.405, 0.17}, {0.47, 0.13}}}) {
                painter.StrokePolyline({Point{cx + (0.05 + off) * side * s, cy + vy * s},
                                        Point{cx + (vx1 + off) * side * s, cy + vy * s}},
                                       std::max(1.5, 0.015 * s), Rgb(0x000000, 0.90 * maskA));
            }
            for (const Vec2& rv : rivets) {
                const double rx = cx + (rv.x + off) * side * s;
                const double ry = cy + rv.y * s;
                const double rr = std::max(1.8, 0.026 * s);
                painter.FillRadialGradient(Box{rx - rr, ry - rr, rr * 2.0, rr * 2.0}, rx - rr * 0.2, ry - rr * 0.2, rr, rr,
                                           {GradientStop{0.0, Rgb(0xDCF0E4, 0.95 * maskA)},
                                            GradientStop{0.5, Rgb(0x5A6E64, 0.95 * maskA)},
                                            GradientStop{1.0, Rgb(0x0A100D, maskA)}});
            }
            std::vector<Vec2> sock;
            for (const Vec2& e : eyePoly) sock.push_back({(e.x - 0.008 + off) * side, e.y - 0.012});
            painter.FillPolygon(ToScreen(sock, cx, cy, s, s), Rgb(0x010302, maskA));
        }

        // Centre weld seam and glowing green eyes.
        const double seam = Smooth(1500.0, 1750.0, t) * (1.0 - Smooth(2100.0, 2800.0, t) * 0.7);
        if (seam > 0.01) {
            const double sw = std::max(1.5, 0.014 * s);
            painter.FillLinearGradient(Box{cx - sw * 0.5, cy - 0.66 * s, sw, 1.27 * s},
                                       cx, cy - 0.66 * s, cx, cy + 0.61 * s,
                                       {GradientStop{0.0, WithAlpha(arc, 0.0)},
                                        GradientStop{0.35, WithAlpha(core, seam * 0.9)},
                                        GradientStop{0.7, WithAlpha(arc, seam * 0.85)},
                                        GradientStop{1.0, WithAlpha(arc, 0.0)}});
        }
        double eyeGlow = 0.0;
        if (t >= 1700.0) {
            if (t < kBurstAt) {
                const std::uint32_t k = static_cast<std::uint32_t>(std::floor((t - 1700.0) / 38.0));
                eyeGlow = Rng(k + 5).Next() < 0.55 + (t - 1700.0) / 900.0 ? 1.0 : 0.12;
            } else {
                eyeGlow = 1.0 - 0.1 * std::sin(t * 0.006);
            }
        }
        if (eyeGlow > 0.01) {
            for (int side : {-1, 1}) {
                std::vector<Vec2> slit;
                for (const Vec2& e : eyePoly) slit.push_back({(e.x + off) * side, e.y});
                painter.FillPolygon(ToScreen(slit, cx, cy, s, s), MixColor(arc, Rgb(0xFFFFFF), 0.85, eyeGlow));
                PaintGlowDot(painter, cx + side * (0.215 + off) * s, cy - 0.145 * s, 0.34 * s, core, arc, eyeGlow * 0.82);
            }
        }
    }

    // Mystical lightning arcs.
    {
        const std::uint32_t bucket = static_cast<std::uint32_t>(std::max(0, static_cast<int>(std::floor(t / 48.0))));
        Rng bRng(bucket * 997u + 31u);
        std::vector<std::vector<Point>> bolts;
        const double before = Smooth(450.0, 950.0, t) * (1.0 - Smooth(kBurstAt - 80.0, kBurstAt + 60.0, t));
        if (before > 0.02) {
            for (int i = 0; i < 4; ++i) {
                const double ang = bRng.Next() * kTau;
                const double reach = u * (1.2 + bRng.Next() * 1.1);
                const double toAng = ang + (bRng.Next() - 0.5) * 0.9;
                AppendBolt(bRng, {cx + std::cos(ang) * reach, cy + std::sin(ang) * reach * 0.8},
                           {cx + std::cos(toAng) * s * 0.72, cy + std::sin(toAng) * s * 0.72}, 0.45, 5, bolts);
            }
        }
        const double burstB = Smooth(kBurstAt - 30.0, kBurstAt + 40.0, t) * (1.0 - Smooth(kBurstAt + 250.0, kBurstAt + 1100.0, t));
        if (burstB > 0.02) {
            for (int i = 0; i < 8; ++i) {
                const double ang = (static_cast<double>(i) / 8.0) * kTau + bRng.Next() * 0.45;
                AppendBolt(bRng, {cx + std::cos(ang) * s * 0.4, cy + std::sin(ang) * s * 0.4},
                           {cx + std::cos(ang) * u * (1.2 + bRng.Next() * 1.3), cy + std::sin(ang) * u * (0.9 + bRng.Next() * 1.0)},
                           0.40, 5, bolts);
            }
        }
        const double idleB = Smooth(kBurstAt + 300.0, kBurstAt + 800.0, t) * 0.55;
        if (idleB > 0.02 && bolts.empty() && bRng.Next() < 0.75) {
            const double ang = bRng.Next() * kTau;
            AppendBolt(bRng, {cx + std::cos(ang) * s * 1.05, cy + std::sin(ang) * s * 1.05},
                       {cx + std::cos(ang + 0.7) * s * 1.7, cy + std::sin(ang + 0.7) * s * 1.7}, 0.50, 4, bolts);
        }
        const double bAlpha = std::max({before, burstB, idleB});
        for (const auto& bolt : bolts) {
            painter.StrokePolyline(bolt, 7.0, WithAlpha(arc, 0.16 * bAlpha));
            painter.StrokePolyline(bolt, 3.0, WithAlpha(arc, 0.55 * bAlpha));
            painter.StrokePolyline(bolt, 1.3, WithAlpha(core, 0.92 * bAlpha));
        }
    }

    // Shockwave + Anamorphic title slam.
    const double flash = std::exp(-std::max(0.0, t - kBurstAt) / 160.0) * Smooth(kBurstAt - 60.0, kBurstAt + 20.0, t);
    if (flash > 0.01) {
        painter.FillRadialGradient(Box{0.0, 0.0, w, h}, cx, cy, u * 2.4, u * 2.4,
                                   {GradientStop{0.0, Rgb(0xEBFFF0, flash)},
                                    GradientStop{0.2, WithAlpha(arc, 0.65 * flash)},
                                    GradientStop{0.6, WithAlpha(deep, 0.25 * flash)},
                                    GradientStop{1.0, WithAlpha(deep, 0.0)}});
    }
    for (int wi = 0; wi < 3; ++wi) {
        const double kk = (t - (kBurstAt + wi * 140.0)) / 1200.0;
        if (kk <= 0.0 || kk >= 1.0) continue;
        const double rr = Lerp(s * 0.85, u * (3.0 - wi * 0.55), EaseOutCubic(kk));
        const double env = Smooth(0.0, 0.06, kk) * std::pow(1.0 - kk, 1.4);
        std::vector<Point> ringPts;
        ringPts.reserve(65);
        for (int i = 0; i <= 64; ++i) {
            const double a = (static_cast<double>(i) / 64.0) * kTau;
            ringPts.push_back(Point{cx + std::cos(a) * rr, cy + std::sin(a) * rr});
        }
        painter.StrokePolyline(ringPts, std::max(2.0, (12.0 - wi * 3.0) * (1.0 - kk * 0.5)), WithAlpha(arc, env * 0.45));
    }

    const double kSlam = Ramp(kSlamAt, kSlamAt + kSlamMs, t);
    if (kSlam > 0.01) {
        const double titleCy = h * (h > w ? 0.67 : 0.70);
        const double land = t - kSlamAt - kSlamMs;
        if (land > -30.0) {
            const double fa = std::exp(-std::max(0.0, land) / 230.0) * Smooth(-30.0, 20.0, land);
            if (fa > 0.01) {
                const double fy = titleCy - u * 0.02;
                painter.FillLinearGradient(Box{0.0, fy - 1.5, w, 3.0}, 0.0, fy, w, fy,
                                           {GradientStop{0.0, WithAlpha(arc, 0.0)},
                                            GradientStop{0.5, WithAlpha(core, fa)},
                                            GradientStop{1.0, WithAlpha(arc, 0.0)}});
            }
        }
        const std::string raw = ToUpperAscii(plan.title.empty() ? "AVENGERS: DOOMSDAY" : plan.title);
        const std::size_t colon = raw.find(": ");
        const std::string kicker = colon != std::string::npos && colon > 0 ? raw.substr(0, colon) : "";
        const std::string main = colon != std::string::npos && colon > 0 ? raw.substr(colon + 2) : raw;
        const double scale = Lerp(1.36, 1.0, EaseOutExpo(kSlam));
        const double titleA = Smooth(kSlamAt, kSlamAt + 110.0, t);
        const double maxW = std::min(w * 0.88, u * 3.4);

        painter.PushOpacity(titleA);
        const double mainPx = std::min(u * 0.34, maxW / std::max(1.0, static_cast<double>(main.size()) * 0.68)) * scale;
        if (!kicker.empty()) {
            const double kickPx = std::max(14.0, mainPx * 0.28);
            const TextStyle kStyle{kickPx, true, 700, 0.42, false};
            const double kW = std::min(maxW, painter.MeasureText(kicker, kStyle) + 16.0);
            painter.Text(Box{w * 0.5 - kW * 0.5, titleCy - mainPx * 1.05, kW, kickPx * 1.4},
                         kicker, kStyle, MixColor(arc, Rgb(0xDCFFE6), 0.35, 0.95));
        }
        const TextStyle mStyle{mainPx, true, 800, 0.06, false};
        const double mW = std::min(maxW, painter.MeasureText(main, mStyle) + 20.0);
        const double yTop = titleCy - mainPx * (kicker.empty() ? 0.55 : 0.40);
        painter.Text(Box{w * 0.5 - mW * 0.5, yTop + mainPx * 0.05, mW, mainPx * 1.25}, main, mStyle, Rgb(0x030806, 0.92));
        painter.Text(Box{w * 0.5 - mW * 0.5, yTop, mW, mainPx * 1.25}, main, mStyle, MixColor(accent, Rgb(0xE8F8EE), 0.72));
        painter.PopOpacity();
    }

    PaintLetterboxAndVignette(painter, w, h, u, t, 0.78);
}

}  // namespace

std::vector<FranchiseIntroSpec> ParseFranchiseIntros(const nlohmann::json& data) {
    std::vector<FranchiseIntroSpec> out;
    if (!data.is_object() || !data.contains("intros") || !data["intros"].is_array()) return out;
    for (const auto& row : data["intros"]) {
        if (!row.is_object()) continue;
        FranchiseIntroSpec spec;
        spec.id = row.value("id", "");
        spec.event = row.value("event", "");
        spec.style = row.value("style", "");
        spec.titlePattern = row.value("titlePattern", "");
        spec.accent = row.value("accent", "#E8A33D");
        spec.glow = row.value("glow", "#FF6A2A");
        spec.durationMs = std::clamp(row.value("durationMs", 3800.0), 2500.0, 4000.0);
        if (spec.id.empty() || spec.style.empty()) continue;
        if (row.contains("imdbIds") && row["imdbIds"].is_array()) {
            for (const auto& id : row["imdbIds"]) {
                if (id.is_string() && !id.get<std::string>().empty()) spec.imdbIds.push_back(id.get<std::string>());
            }
        }
        if (row.contains("titles") && row["titles"].is_object()) {
            for (const auto& [k, v] : row["titles"].items()) {
                if (v.is_string()) spec.titles[k] = v.get<std::string>();
            }
        }
        out.push_back(std::move(spec));
    }
    return out;
}

std::string BaseImdbId(const std::string& id) {
    const std::size_t colon = id.find(':');
    return colon == std::string::npos ? id : id.substr(0, colon);
}

std::optional<FranchiseIntroPlan> MatchFranchiseIntro(const std::vector<FranchiseIntroSpec>& specs,
                                                      const std::string& itemId, const std::string& title) {
    const std::string imdb = BaseImdbId(itemId);
    const std::string clean = CleanTitleForCard(title);
    for (const FranchiseIntroSpec& spec : specs) {
        const bool idMatch = std::find(spec.imdbIds.begin(), spec.imdbIds.end(), imdb) != spec.imdbIds.end();
        bool titleMatch = false;
        if (!idMatch && !spec.titlePattern.empty() && !clean.empty()) {
            try {
                const std::regex pattern(spec.titlePattern, std::regex_constants::icase | std::regex_constants::ECMAScript);
                titleMatch = std::regex_search(clean, pattern);
            } catch (const std::regex_error&) {
                titleMatch = false;
            }
        }
        if (!idMatch && !titleMatch) continue;
        const auto mapped = spec.titles.find(imdb);
        const std::string cardTitle = mapped != spec.titles.end() ? mapped->second : clean;
        return FranchiseIntroPlan{spec.id, spec.event, spec.style, spec.accent, spec.glow, cardTitle, spec.durationMs};
    }
    return std::nullopt;
}

std::optional<FranchiseIntroPlan> PlanFranchiseIntro(const nlohmann::json& data, const std::string& itemId,
                                                     const std::string& title, const std::set<std::string>& played) {
    const std::vector<FranchiseIntroSpec> specs = ParseFranchiseIntros(data);
    std::optional<FranchiseIntroPlan> match = MatchFranchiseIntro(specs, itemId, title);
    if (!match.has_value()) return std::nullopt;
    if (played.contains(match->id)) return std::nullopt;
    return match;
}

FranchiseIntro::FranchiseIntro(motion::MotionSettings motion) : motion_(motion) {}

void FranchiseIntro::Start(const FranchiseIntroPlan& plan, double nowMs) {
    plan_ = plan;
    active_ = true;
    released_ = false;
    ready_ = false;
    skipped_ = false;
    leaving_ = false;
    finished_ = false;
    startMs_ = nowMs;
    clockMs_ = nowMs;
    leaveMs_ = 0.0;
}

void FranchiseIntro::SetPlaybackReady(bool ready, double nowMs) {
    ready_ = ready;
    Tick(nowMs);
}

void FranchiseIntro::Skip(double nowMs) {
    if (!active_ || finished_) return;
    skipped_ = true;
    released_ = true;
    if (!leaving_) {
        leaving_ = true;
        leaveMs_ = nowMs;
    }
    Tick(nowMs);
}

void FranchiseIntro::Reset() {
    active_ = false;
    released_ = false;
    ready_ = false;
    skipped_ = false;
    leaving_ = false;
    finished_ = false;
}

void FranchiseIntro::Tick(double nowMs) {
    if (!active_ || finished_) return;
    clockMs_ = std::max(clockMs_, nowMs);
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    const double holdDuration = reduced ? kReducedDurationMs : plan_.durationMs;
    if (clockMs_ - startMs_ >= holdDuration) released_ = true;
    if (!leaving_ && released_ && (ready_ || skipped_)) {
        leaving_ = true;
        leaveMs_ = clockMs_;
    }
    if (leaving_) {
        const double fadeDuration = skipped_ ? kFadeOutSkipMs : kFadeOutNormalMs;
        if (clockMs_ - leaveMs_ >= (reduced ? 120.0 : fadeDuration)) {
            finished_ = true;
            active_ = false;
        }
    }
}

bool FranchiseIntro::Active() const {
    return active_ && !finished_;
}

bool FranchiseIntro::Covers() const {
    return Active() && Opacity(clockMs_) >= 0.995;
}

double FranchiseIntro::Opacity(double nowMs) const {
    if (!active_ || finished_) return 0.0;
    if (!leaving_) return 1.0;
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    const double fadeDuration = skipped_ ? kFadeOutSkipMs : kFadeOutNormalMs;
    const double dur = reduced ? 120.0 : fadeDuration;
    return Clamp01(1.0 - (nowMs - leaveMs_) / dur);
}

void FranchiseIntro::Paint(Painter& painter, double width, double height) const {
    if (!Active() || width <= 2.0 || height <= 2.0) return;
    const double alpha = Opacity(clockMs_);
    if (alpha <= 0.005) return;
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    // Reduced motion renders the settled title card directly without ember motion.
    const double elapsed = reduced ? plan_.durationMs : std::max(0.0, clockMs_ - startMs_);

    const bool pushFade = alpha < 0.995;
    if (pushFade) painter.PushOpacity(alpha);
    if (plan_.style == "doom") PaintDoom(painter, width, height, elapsed, plan_);
    else PaintMockingjay(painter, width, height, elapsed, plan_);

    if (!leaving_ && elapsed >= 550.0) {
        const double rem = ViewportRem(width, height);
        const double hintAlpha = Smooth(550.0, 950.0, elapsed) * 0.72;
        const TextStyle hintStyle{0.82 * rem, true, 550};
        const std::string label = "Press any key or click to skip";
        const double textWidth = painter.MeasureText(label, hintStyle);
        const double padX = 1.0 * rem;
        const double lw = textWidth + padX * 2.0 + 0.4 * rem;
        const Box pill{width - lw - 2.0 * rem, height - 3.6 * rem, lw, 2.0 * rem};
        painter.FillRoundRect(pill, 1.0 * rem, Rgb(0x000000, 0.45 * hintAlpha));
        painter.StrokeRoundRect(pill, 1.0 * rem, 1.0, Rgb(0xFFFFFF, 0.16 * hintAlpha));
        painter.Text(Box{pill.x + padX, pill.y + 0.38 * rem, textWidth + 0.6 * rem, pill.height - 0.5 * rem},
                     label, hintStyle, Rgb(0xFFFFFF, hintAlpha));
    }
    if (pushFade) painter.PopOpacity();
}

}  // namespace tvm::ui
