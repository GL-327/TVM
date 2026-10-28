#pragma once

// CSS timing functions and keyframes, evaluated the way browsers evaluate
// them. The web UI's motion comes from these curves, so the native port uses
// the same maths.

#include <span>

namespace tvm::motion {

// A CSS cubic-bezier(x1, y1, x2, y2) timing function. Ease() solves x(t) for
// the given progress with Newton iterations, falling back to bisection, which
// is what browsers do.
class CubicBezier {
public:
    constexpr CubicBezier(double x1, double y1, double x2, double y2)
        : x1_(x1), y1_(y1), x2_(x2), y2_(y2) {}

    // Progress is clamped to [0, 1].
    double Ease(double progress) const;

private:
    double SampleX(double t) const;
    double SampleY(double t) const;
    double SlopeX(double t) const;

    double x1_;
    double y1_;
    double x2_;
    double y2_;
};

inline constexpr CubicBezier kLinear{0.0, 0.0, 1.0, 1.0};
// CSS `ease`, the default timing function for transitions and keyframes.
inline constexpr CubicBezier kEase{0.25, 0.1, 0.25, 1.0};
inline constexpr CubicBezier kEaseOut{0.0, 0.0, 0.58, 1.0};
inline constexpr CubicBezier kEaseInOut{0.42, 0.0, 0.58, 1.0};
// --tvm-motion-ease in packages/design/src/tokens.css.
inline constexpr CubicBezier kMotionEase{0.22, 1.0, 0.36, 1.0};

struct Keyframe {
    double offset;  // Position in the animation, 0 to 1, ascending.
    double value;
};

// Evaluates keyframes at progress in [0, 1]. Each interval is eased with the
// CSS default, `ease`.
double EvaluateKeyframes(std::span<const Keyframe> frames, double progress);
// The same, with each interval eased by the timing function of the animation, as CSS does when the
// animation names one.
double EvaluateKeyframes(std::span<const Keyframe> frames, double progress, const CubicBezier& timing);

}  // namespace tvm::motion
