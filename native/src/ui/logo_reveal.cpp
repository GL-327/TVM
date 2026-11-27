#include "ui/logo_reveal.h"

#include <algorithm>
#include <cmath>

#include "ui/logo_geometry.h"

namespace tvm::ui {

namespace {

constexpr double kPi = 3.14159265358979323846;

// TvmIntroView's companion constants.
constexpr double kContentCx = 520.0;
constexpr double kContentCy = 504.0;
constexpr double kContentW = 900.0;
constexpr double kContentH = 483.0;
constexpr double kLetterStart = 280.0;
constexpr double kLetterStagger = 170.0;
constexpr double kTravelStart = 1050.0;
constexpr double kTravelEnd = 2450.0;
constexpr double kArriveStart = 2380.0;
constexpr double kArriveEnd = 2950.0;
constexpr double kUpperStart = 2450.0;
constexpr double kUpperEnd = 3000.0;
constexpr double kShineStart = 2900.0;
constexpr double kShineEnd = 3500.0;
constexpr double kIdlePeriodMs = 2600.0;
constexpr Color kBackground = Rgb(0x071033);
constexpr Color kWhite = Rgb(0xFFFFFF);
constexpr Color kClear = Rgb(0xFFFFFF, 0.0);

double Span(double t, double a, double b) {
    return std::clamp((t - a) / (b - a), 0.0, 1.0);
}

double Ease(double x) {
    return 1.0 - std::pow(1.0 - x, 3.0);
}

double EaseInOut(double x) {
    return x < 0.5 ? 4.0 * x * x * x : 1.0 - std::pow(-2.0 * x + 2.0, 3.0) / 2.0;
}

double BackOut(double x) {
    constexpr double c1 = 1.70158;
    constexpr double c3 = c1 + 1.0;
    return 1.0 + c3 * std::pow(x - 1.0, 3.0) + c1 * std::pow(x - 1.0, 2.0);
}

Color Alpha(Color color, double alpha) {
    color.a = std::clamp(alpha, 0.0, 1.0);
    return color;
}

Color Argb(double a, int r, int g, int b) {
    return Color{r / 255.0, g / 255.0, b / 255.0, std::clamp(a / 255.0, 0.0, 1.0)};
}

template <std::size_t N>
std::vector<Point> Pairs(const std::array<double, N>& values) {
    std::vector<Point> points;
    for (std::size_t i = 0; i + 1 < N; i += 2) points.push_back(Point{values[i], values[i + 1]});
    return points;
}

// A smooth open curve through the points: quadratics between midpoints, as TvmIntroView.curve draws it, flattened.
void AppendCurve(const std::vector<Point>& points, std::vector<Point>& out) {
    if (points.empty()) return;
    out.push_back(points.front());
    Point from = points.front();
    constexpr int kSteps = 10;
    for (std::size_t i = 1; i + 1 < points.size(); ++i) {
        const Point control = points[i];
        const Point to{(points[i].x + points[i + 1].x) / 2.0, (points[i].y + points[i + 1].y) / 2.0};
        for (int s = 1; s <= kSteps; ++s) {
            const double t = static_cast<double>(s) / kSteps;
            const double u = 1.0 - t;
            out.push_back(Point{u * u * from.x + 2.0 * u * t * control.x + t * t * to.x,
                                u * u * from.y + 2.0 * u * t * control.y + t * t * to.y});
        }
        from = to;
    }
    out.push_back(points.back());
}

void AppendQuad(Point from, Point control, Point to, std::vector<Point>& out) {
    constexpr int kSteps = 16;
    for (int s = 1; s <= kSteps; ++s) {
        const double t = static_cast<double>(s) / kSteps;
        const double u = 1.0 - t;
        out.push_back(Point{u * u * from.x + 2.0 * u * t * control.x + t * t * to.x,
                            u * u * from.y + 2.0 * u * t * control.y + t * t * to.y});
    }
}

double LengthOf(const std::vector<Point>& points) {
    double length = 0.0;
    for (std::size_t i = 1; i < points.size(); ++i) length += std::hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return length;
}

std::vector<Point> Shifted(std::vector<Point> points, double dy) {
    for (Point& point : points) point.y += dy;
    return points;
}

}  // namespace

LogoReveal::LogoReveal(motion::MotionSettings motion) : motion_(motion) {}

void LogoReveal::Start(double nowMs) {
    if (started_) return;
    started_ = true;
    startMs_ = nowMs;
    clockMs_ = nowMs;
}

double LogoReveal::Elapsed() const {
    if (!started_) return 0.0;
    if (motion::SettingsReduceMotion(motion_)) return kTotalMs;
    return std::clamp(clockMs_ - startMs_, 0.0, kTotalMs);
}

void LogoReveal::Skip(double nowMs) {
    if (!Visible() || leaving_) return;
    leaving_ = true;
    leaveMs_ = nowMs;
}

void LogoReveal::Tick(double nowMs) {
    clockMs_ = nowMs;
    if (!started_ || finished_) return;
    if (!leaving_) {
        const double done = startMs_ + (motion::SettingsReduceMotion(motion_) ? 0.0 : kTotalMs);
        // Once built, it goes as soon as the app is ready, or after the longest hold.
        if (nowMs >= done && (!pending_ || nowMs - done >= kHoldMaxMs)) {
            leaving_ = true;
            leaveMs_ = nowMs;
        }
    }
    if (leaving_ && nowMs - leaveMs_ >= kFadeOutMs) finished_ = true;
}

LogoReveal::Line LogoReveal::Measured(std::vector<Point> points) {
    Line line;
    line.points = std::move(points);
    double total = 0.0;
    for (std::size_t i = 0; i < line.points.size(); ++i) {
        if (i > 0) total += std::hypot(line.points[i].x - line.points[i - 1].x, line.points[i].y - line.points[i - 1].y);
        line.at.push_back(total);
    }
    return line;
}

Point LogoReveal::PointAt(const Line& line, double distance) {
    if (line.points.empty()) return Point{};
    if (distance <= 0.0) return line.points.front();
    if (distance >= line.Length()) return line.points.back();
    const auto next = std::lower_bound(line.at.begin(), line.at.end(), distance);
    const std::size_t i = static_cast<std::size_t>(next - line.at.begin());
    if (i == 0) return line.points.front();
    const double span = line.at[i] - line.at[i - 1];
    const double t = span > 0.0 ? (distance - line.at[i - 1]) / span : 0.0;
    return Point{line.points[i - 1].x + (line.points[i].x - line.points[i - 1].x) * t,
                 line.points[i - 1].y + (line.points[i].y - line.points[i - 1].y) * t};
}

std::vector<Point> LogoReveal::Segment(const Line& line, double from, double to) {
    std::vector<Point> out;
    if (line.points.size() < 2 || to <= from) return out;
    out.push_back(PointAt(line, from));
    for (std::size_t i = 0; i < line.points.size(); ++i) {
        if (line.at[i] > from && line.at[i] < to) out.push_back(line.points[i]);
    }
    out.push_back(PointAt(line, to));
    return out;
}

const LogoReveal::Shapes& LogoReveal::ShapesFor(double width, double height) const {
    if (shapes_.width == width && shapes_.height == height) return shapes_;
    Shapes s;
    s.width = width;
    s.height = height;
    // The logo's artwork spans roughly x 70-970, y 262-745 of the 1024 master.
    s.unit = std::min(width * 0.86 / kContentW, height * 0.62 / kContentH);
    const double unit = s.unit;
    const auto view = [&](Point p) { return Point{(p.x - kContentCx) * unit + width / 2.0, (p.y - kContentCy) * unit + height / 2.0}; };
    const auto toView = [&](std::vector<Point> points) {
        for (Point& point : points) point = view(point);
        return points;
    };

    const std::vector<Point> letters[3] = {Pairs(logo::kLetterT), Pairs(logo::kLetterV), Pairs(logo::kLetterM)};
    for (int i = 0; i < 3; ++i) {
        s.letters[i] = toView(letters[i]);
        std::vector<Point> closed = s.letters[i];
        closed.push_back(closed.front());
        s.letterOutlines[i] = Measured(std::move(closed));
        double left = s.letters[i][0].x, top = s.letters[i][0].y, right = left, bottom = top;
        for (const Point& p : s.letters[i]) {
            left = std::min(left, p.x);
            right = std::max(right, p.x);
            top = std::min(top, p.y);
            bottom = std::max(bottom, p.y);
        }
        s.letterBounds[i] = Box{left, top, right - left, bottom - top};
    }
    s.trailLower = toView(Pairs(logo::kTrailLower));
    s.trailRight = toView(Pairs(logo::kTrailRight));
    s.trailUpper = toView(Pairs(logo::kTrailUpper));

    // The star: cubic edges pulled towards the centre along each spoke.
    const double cx = logo::kStarX;
    const double cy = logo::kStarY;
    const Point tips[4] = {{cx, cy - logo::kStarUp}, {cx + logo::kStarSide, cy}, {cx, cy + logo::kStarDown}, {cx - logo::kStarSide, cy}};
    std::vector<Point> star;
    for (int i = 0; i < 4; ++i) {
        const Point a = tips[i];
        const Point b = tips[(i + 1) % 4];
        const double p = logo::kStarPinch;
        const Point c1{a.x + (cx - a.x) * p, a.y + (cy - a.y) * p};
        const Point c2{b.x + (cx - b.x) * p, b.y + (cy - b.y) * p};
        if (i == 0) star.push_back(a);
        constexpr int kSteps = 16;
        for (int k = 1; k <= kSteps; ++k) {
            const double t = static_cast<double>(k) / kSteps;
            const double u = 1.0 - t;
            star.push_back(Point{u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
                                 u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y});
        }
    }
    star.pop_back();
    s.star = toView(star);
    s.starCentre = view(Point{cx, cy});

    // The star's journey: along the lower sweep, behind the M, up the right arc and into its place.
    const std::vector<Point> centreLower = Pairs(logo::kCentreLower);
    const std::vector<Point> centreRight = Pairs(logo::kCentreRight);
    std::vector<Point> lower;
    AppendCurve(centreLower, lower);
    std::vector<Point> bridge{centreLower.back()};
    AppendQuad(centreLower.back(), Point{805.0, 612.0}, centreRight.front(), bridge);
    std::vector<Point> right;
    AppendCurve(centreRight, right);
    AppendQuad(right.back(), Point{centreRight.back().x + 2.0, cy + 8.0}, Point{cx, cy}, right);
    lower = toView(lower);
    bridge = toView(bridge);
    right = toView(right);
    s.lowerEnd = LengthOf(lower);
    s.rightStart = s.lowerEnd + LengthOf(bridge);
    std::vector<Point> travel = lower;
    travel.insert(travel.end(), bridge.begin() + 1, bridge.end());
    travel.insert(travel.end(), right.begin() + 1, right.end());
    s.travel = Measured(std::move(travel));

    std::vector<Point> upper;
    AppendCurve(Pairs(logo::kCentreUpper), upper);
    s.upper = Measured(toView(upper));

    shapes_ = std::move(s);
    return shapes_;
}

void LogoReveal::Paint(Painter& painter, double width, double height) const {
    if (!Visible() || width <= 0.0 || height <= 0.0) return;
    const Shapes& shapes = ShapesFor(width, height);
    const double unit = shapes.unit;
    const double t = Elapsed();
    const double fade = leaving_ ? 1.0 - Ease(std::clamp((clockMs_ - leaveMs_) / kFadeOutMs, 0.0, 1.0)) : 1.0;
    if (leaving_) painter.PushOpacity(fade);
    const Box all{0.0, 0.0, width, height};

    // 1. Background: dark, then the brand wash blooms from the middle.
    painter.FillRoundRect(all, 0.0, kBackground);
    const double bloom = Ease(Span(t, 0.0, 650.0));
    if (bloom > 0.0) {
        std::vector<GradientStop> stops;
        for (std::size_t i = 0; i < logo::kWashStops.size(); ++i) {
            stops.push_back(GradientStop{logo::kWashStops[i], Alpha(Rgb(logo::kWashColors[i]), bloom)});
        }
        painter.FillLinearGradient(all, 0.0, 0.0, width, 0.0, stops);
        if (bloom < 1.0) {
            const double r = std::max(width, height) * (0.35 + 0.9 * bloom);
            painter.FillRadialGradient(all, width / 2.0, height / 2.0, r, r,
                                       {GradientStop{0.0, Alpha(kBackground, 0.0)}, GradientStop{0.55, Alpha(kBackground, 0.0)},
                                        GradientStop{1.0, Alpha(kBackground, 1.0 - bloom)}});
        }
    }

    // 2. The trail, drawn under the letters so it passes behind them.
    const double travelT = EaseInOut(Span(t, kTravelStart, kTravelEnd));
    const double starAt = shapes.travel.Length() * travelT;
    RevealAlong(painter, shapes, shapes.trailLower, 0.0, shapes.lowerEnd, starAt);
    RevealAlong(painter, shapes, shapes.trailRight, shapes.rightStart, shapes.travel.Length(), starAt);
    const double upperT = Ease(Span(t, kUpperStart, kUpperEnd));
    if (upperT > 0.0) {
        const std::vector<Point> along = Segment(shapes.upper, 0.0, shapes.upper.Length() * upperT);
        if (along.size() >= 2) {
            painter.PushClipStroke(along, 70.0 * unit);
            painter.FillPolygon(shapes.trailUpper, kWhite);
            painter.PopClip();
        }
    }

    // 3. The travelling star, under the letters: it disappears behind the M.
    if (t >= kTravelStart && t < kArriveEnd) PaintComet(painter, shapes, t, starAt);

    // 4. Letters: outline traced, then filled with a small rise.
    for (int i = 0; i < 3; ++i) PaintLetter(painter, shapes, i, t);

    // 5. The star in its place.
    PaintStar(painter, shapes, t);

    // 6. A shine across the letters, then the settled logo.
    const double shine = Span(t, kShineStart, kShineEnd);
    if (shine > 0.0 && shine < 1.0) {
        const double b = shapes.letterBounds[0].x;
        const double e = shapes.letterBounds[2].Right();
        const double x = b - 120.0 * unit + (e - b + 240.0 * unit) * EaseInOut(shine);
        painter.PushClipPolygons({shapes.letters[0], shapes.letters[1], shapes.letters[2]});
        painter.FillLinearGradient(all, x - 70.0 * unit, 0.0, x + 70.0 * unit, 0.0,
                                   {GradientStop{0.0, Argb(0, 160, 235, 255)}, GradientStop{0.5, Argb(150, 160, 235, 255)},
                                    GradientStop{1.0, Argb(0, 160, 235, 255)}});
        painter.PopClip();
    }
    if (t >= kTotalMs) PaintIdleGlow(painter, shapes);
    if (leaving_) painter.PopOpacity();
}

void LogoReveal::RevealAlong(Painter& painter, const Shapes& shapes, const std::vector<Point>& shape, double from,
                             double to, double at) const {
    if (at <= from) return;
    const std::vector<Point> along = Segment(shapes.travel, from, std::min(at, to));
    if (along.size() < 2) return;
    painter.PushClipStroke(along, 150.0 * shapes.unit);
    painter.FillPolygon(shape, kWhite);
    painter.PopClip();
}

void LogoReveal::PaintComet(Painter& painter, const Shapes& shapes, double t, double at) const {
    const double fadeIn = Span(t, kTravelStart, kTravelStart + 180.0);
    const double fadeOut = 1.0 - Span(t, kArriveStart, kArriveEnd);
    const double a = fadeIn * fadeOut;
    if (a <= 0.0) return;
    const double unit = shapes.unit;
    // The tail: a run of fading lights behind the head.
    const double tail = 220.0 * unit;
    constexpr int kSteps = 18;
    for (int k = kSteps; k >= 1; --k) {
        const double d = at - tail * k / kSteps;
        if (d < 0.0) continue;
        const Point p = PointAt(shapes.travel, d);
        const double f = 1.0 - static_cast<double>(k) / kSteps;
        const double r = (4.0 + 10.0 * f) * unit;
        painter.FillRadialGradient(Box{p.x - r, p.y - r, 2.0 * r, 2.0 * r}, p.x, p.y, r, r,
                                   {GradientStop{0.0, Argb(150.0 * f * a, 255, 255, 255)}, GradientStop{1.0, kClear}});
    }
    const Point head = PointAt(shapes.travel, at);
    const double halo = 46.0 * unit;
    painter.FillRadialGradient(Box{head.x - halo, head.y - halo, 2.0 * halo, 2.0 * halo}, head.x, head.y, halo, halo,
                               {GradientStop{0.0, Argb(255.0 * a, 255, 255, 255)},
                                GradientStop{0.22, Argb(170.0 * a, 190, 245, 255)}, GradientStop{1.0, kClear}});
}

void LogoReveal::PaintLetter(Painter& painter, const Shapes& shapes, int index, double t) const {
    const double start = kLetterStart + index * kLetterStagger;
    const double trace = Span(t, start, start + 620.0);
    if (trace <= 0.0) return;
    const double filled = Ease(Span(t, start + 380.0, start + 900.0));
    const double unit = shapes.unit;
    const double rise = (1.0 - filled) * 22.0 * unit;
    if (filled < 1.0) {
        const Line& outline = shapes.letterOutlines[index];
        const std::vector<Point> traced = Shifted(Segment(outline, 0.0, outline.Length() * Ease(trace)), rise);
        if (traced.size() >= 2) painter.StrokePolyline(traced, 3.2 * unit, Alpha(kWhite, 1.0 - filled * 0.6));
    }
    if (filled > 0.0) {
        // The fill wipes up from the baseline while it fades in.
        const Box& bounds = shapes.letterBounds[index];
        const double top = bounds.Bottom() - bounds.height * std::min(1.0, filled * 1.25);
        painter.PushClip(Box{bounds.x - 4.0 * unit, top + rise, bounds.width + 8.0 * unit,
                             bounds.Bottom() + 4.0 * unit - top});
        painter.FillPolygon(Shifted(shapes.letters[index], rise), Alpha(kWhite, std::min(1.0, 0.35 + filled)));
        painter.PopClip();
    }
}

void LogoReveal::PaintStar(Painter& painter, const Shapes& shapes, double t) const {
    const double p = Span(t, kArriveStart, kArriveEnd);
    if (p <= 0.0) return;
    const double scale = p < 0.6 ? BackOut(p / 0.6) : 1.0;
    const double unit = shapes.unit;
    const Point c = shapes.starCentre;
    // The flare: a brief bloom and long thin rays as the star lands.
    const double flare = p < 1.0 ? std::sin(kPi * p) : 0.0;
    if (flare > 0.0) {
        const double r = 150.0 * unit * (0.6 + 0.6 * flare);
        painter.FillRadialGradient(Box{c.x - r, c.y - r, 2.0 * r, 2.0 * r}, c.x, c.y, r, r,
                                   {GradientStop{0.0, Argb(210.0 * flare, 255, 255, 255)},
                                    GradientStop{0.25, Argb(90.0 * flare, 160, 240, 255)}, GradientStop{1.0, kClear}});
        const double ray = 260.0 * unit * flare;
        const Color rayColor = Argb(170.0 * flare, 255, 255, 255);
        painter.StrokePolyline({Point{c.x - ray, c.y}, Point{c.x + ray, c.y}}, 2.2 * unit, rayColor);
        painter.StrokePolyline({Point{c.x, c.y - ray * 0.75}, Point{c.x, c.y + ray * 0.75}}, 2.2 * unit, rayColor);
    }
    std::vector<Point> star = shapes.star;
    for (Point& point : star) point = Point{c.x + (point.x - c.x) * scale, c.y + (point.y - c.y) * scale};
    painter.FillPolygon(star, Alpha(kWhite, std::min(1.0, p * 3.0)));
}

void LogoReveal::PaintIdleGlow(Painter& painter, const Shapes& shapes) const {
    if (motion::SettingsReduceMotion(motion_)) return;
    const double held = std::max(0.0, clockMs_ - startMs_ - kTotalMs);
    const double phase = std::fmod(held / kIdlePeriodMs, 1.0);
    const double b = 0.5 - 0.5 * std::cos(2.0 * kPi * phase);
    if (b <= 0.01) return;
    const double r = 90.0 * shapes.unit;
    const Point c = shapes.starCentre;
    painter.FillRadialGradient(Box{c.x - r, c.y - r, 2.0 * r, 2.0 * r}, c.x, c.y, r, r,
                               {GradientStop{0.0, Argb(70.0 * b, 255, 255, 255)}, GradientStop{1.0, kClear}});
    painter.FillPolygon(shapes.star, kWhite);
}

}  // namespace tvm::ui
