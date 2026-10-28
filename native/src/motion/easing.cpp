#include "motion/easing.h"

#include <algorithm>
#include <cmath>

namespace tvm::motion {

double CubicBezier::SampleX(double t) const {
    const double ax = 1.0 - 3.0 * x2_ + 3.0 * x1_;
    const double bx = 3.0 * x2_ - 6.0 * x1_;
    const double cx = 3.0 * x1_;
    return ((ax * t + bx) * t + cx) * t;
}

double CubicBezier::SampleY(double t) const {
    const double ay = 1.0 - 3.0 * y2_ + 3.0 * y1_;
    const double by = 3.0 * y2_ - 6.0 * y1_;
    const double cy = 3.0 * y1_;
    return ((ay * t + by) * t + cy) * t;
}

double CubicBezier::SlopeX(double t) const {
    const double ax = 1.0 - 3.0 * x2_ + 3.0 * x1_;
    const double bx = 3.0 * x2_ - 6.0 * x1_;
    const double cx = 3.0 * x1_;
    return (3.0 * ax * t + 2.0 * bx) * t + cx;
}

double CubicBezier::Ease(double progress) const {
    if (progress <= 0.0) return 0.0;
    if (progress >= 1.0) return 1.0;

    constexpr double kTolerance = 1e-7;

    // Newton's method from the progress value itself.
    double t = progress;
    for (int i = 0; i < 8; ++i) {
        const double error = SampleX(t) - progress;
        if (std::abs(error) < kTolerance) return SampleY(t);
        const double slope = SlopeX(t);
        if (std::abs(slope) < 1e-6) break;
        t -= error / slope;
        if (t < 0.0 || t > 1.0) break;
    }

    // Bisection when Newton stalls or leaves [0, 1].
    double low = 0.0;
    double high = 1.0;
    t = progress;
    for (int i = 0; i < 100; ++i) {
        const double error = SampleX(t) - progress;
        if (std::abs(error) < kTolerance) break;
        if (error > 0.0) {
            high = t;
        } else {
            low = t;
        }
        t = (low + high) / 2.0;
    }
    return SampleY(t);
}

double EvaluateKeyframes(std::span<const Keyframe> frames, double progress, const CubicBezier& timing) {
    if (frames.empty()) return 0.0;
    if (progress <= frames.front().offset) return frames.front().value;

    for (std::size_t i = 0; i + 1 < frames.size(); ++i) {
        const Keyframe& from = frames[i];
        const Keyframe& to = frames[i + 1];
        if (progress <= to.offset) {
            const double span = to.offset - from.offset;
            if (span <= 0.0) return to.value;
            const double local = timing.Ease((progress - from.offset) / span);
            return from.value + (to.value - from.value) * local;
        }
    }
    return frames.back().value;
}

double EvaluateKeyframes(std::span<const Keyframe> frames, double progress) {
    return EvaluateKeyframes(frames, progress, kEase);
}

}  // namespace tvm::motion
