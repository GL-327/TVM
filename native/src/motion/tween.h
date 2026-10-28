#pragma once

// A value that eases from one number to another over a duration. Times are on
// the timeline clock, so a tween started during a pause resumes correctly.

#include "motion/easing.h"

namespace tvm::motion {

class Tween {
public:
    Tween() = default;
    Tween(double from, double to, double startMs, double durationMs, CubicBezier easing = kMotionEase);

    // The eased value at `clockMs`. Before the start it is `from`, after the
    // end it is `to`. A zero duration jumps straight to `to`.
    double Value(double clockMs) const;
    bool Done(double clockMs) const;

    double target() const { return to_; }

private:
    double from_ = 0.0;
    double to_ = 0.0;
    double startMs_ = 0.0;
    double durationMs_ = 0.0;
    CubicBezier easing_ = kMotionEase;
};

}  // namespace tvm::motion
