#include "motion/tween.h"

#include <algorithm>

namespace tvm::motion {

Tween::Tween(double from, double to, double startMs, double durationMs, CubicBezier easing)
    : from_(from), to_(to), startMs_(startMs), durationMs_(durationMs), easing_(easing) {}

double Tween::Value(double clockMs) const {
    if (durationMs_ <= 0.0) return to_;
    const double progress = std::clamp((clockMs - startMs_) / durationMs_, 0.0, 1.0);
    return from_ + (to_ - from_) * easing_.Ease(progress);
}

bool Tween::Done(double clockMs) const {
    return clockMs >= startMs_ + durationMs_;
}

}  // namespace tvm::motion
