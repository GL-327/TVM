#pragma once

// The launch reveal, ported from the Android app's TvmIntroView.kt: the TVM logo is built from its parts rather than
// faded in. Same shapes (logo_geometry.h), same timeline, same colours.
//
// Timeline (ms):
//  - 0-650      the violet to cyan wash blooms out of the dark background
//  - 280-1500   T, V and M are traced in outline, then filled, one after another
//  - 1050-2450  a glowing star travels the orbital trail, sweeping the lower and right arcs into being; it passes
//               behind the M where the logo's trail breaks
//  - 2380-2950  the star arrives, flares into the four-point star, and the thin upper arc streams out of its arm
//  - 2900-3500  a shine passes over the letters and the glow settles
//
// After the reveal the finished logo holds with a soft breathing glow while the app is still getting ready (at most
// a few seconds), then fades out over 350 ms into what is underneath: the "Who's watching?" chooser, or Home.
// OK, Enter, Escape, Space, a click or a tap starts that fade at once. With reduced motion it shows the last frame.

#include <vector>

#include "motion/preferences.h"
#include "ui/painter.h"

namespace tvm::ui {

class LogoReveal {
public:
    static constexpr double kTotalMs = 3500.0;
    static constexpr double kFadeOutMs = 350.0;
    // The longest it holds on the finished logo waiting for the app, so a slow start never traps the viewer.
    static constexpr double kHoldMaxMs = 6000.0;

    explicit LogoReveal(motion::MotionSettings motion = {});

    // While set, the finished logo holds (with its idle glow) instead of fading out.
    void SetPending(bool pending) { pending_ = pending; }
    // Starts the reveal at `nowMs`. Later calls do nothing, so it plays once per run.
    void Start(double nowMs);
    bool Visible() const { return started_ && !finished_; }
    bool Animating() const { return Visible(); }
    // Opaque over the whole window, so the screen under it need not be drawn. False while it fades out.
    bool Covers() const { return Visible() && !leaving_; }
    // Starts the fade out now.
    void Skip(double nowMs);
    void Tick(double nowMs);
    void Paint(Painter& painter, double width, double height) const;

    // Where the timeline is, from 0 to kTotalMs. Exposed for tests and the frame renderer.
    double Elapsed() const;

private:
    struct Line {
        std::vector<Point> points;
        // Distance along the line to each point.
        std::vector<double> at;
        double Length() const { return at.empty() ? 0.0 : at.back(); }
    };
    struct Shapes {
        double width = 0.0;
        double height = 0.0;
        double unit = 1.0;
        std::vector<Point> letters[3];
        Line letterOutlines[3];
        Box letterBounds[3];
        std::vector<Point> trailLower;
        std::vector<Point> trailRight;
        std::vector<Point> trailUpper;
        std::vector<Point> star;
        Point starCentre;
        Line travel;
        double lowerEnd = 0.0;
        double rightStart = 0.0;
        Line upper;
    };

    const Shapes& ShapesFor(double width, double height) const;
    static Line Measured(std::vector<Point> points);
    static std::vector<Point> Segment(const Line& line, double from, double to);
    static Point PointAt(const Line& line, double distance);

    void RevealAlong(Painter& painter, const Shapes& shapes, const std::vector<Point>& shape, double from, double to,
                     double at) const;
    void PaintComet(Painter& painter, const Shapes& shapes, double t, double at) const;
    void PaintLetter(Painter& painter, const Shapes& shapes, int index, double t) const;
    void PaintStar(Painter& painter, const Shapes& shapes, double t) const;
    void PaintIdleGlow(Painter& painter, const Shapes& shapes) const;

    motion::MotionSettings motion_;
    bool pending_ = false;
    bool started_ = false;
    bool leaving_ = false;
    bool finished_ = false;
    double startMs_ = 0.0;
    double clockMs_ = 0.0;
    double leaveMs_ = 0.0;
    mutable Shapes shapes_;
};

}  // namespace tvm::ui
