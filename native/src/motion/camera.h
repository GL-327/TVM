#pragma once

// The camera tween: a scroll position eased toward a target one frame at a
// time. Ported from apps/ui/src/nav/scrollAnim.ts, with the same constants and
// the same rules for short hops, reduced motion and retargeting.

namespace tvm::motion {

inline constexpr double kCameraEase = 0.24;
// A remaining distance under this many pixels snaps to the target.
inline constexpr double kCameraSettle = 0.6;
inline constexpr int kCameraMaxSteps = 90;
inline constexpr double kFrameMs = 1000.0 / 60.0;
// A background tab resumes with at most this much elapsed time per step.
inline constexpr double kMaxStepMs = 64.0;

// Fraction of the remaining distance covered in one step. Frame-rate
// independent: 30, 60 and 120 Hz displays cover the same ground per second.
double CameraEase(double elapsedMs);

enum class CameraStart {
    Ignored,    // The target was not a finite number.
    Landed,     // Reduced motion, or a hop shorter than the settle distance.
    Animating,  // A tween is running.
};

struct CameraStep {
    double position;
    bool settled;
};

class CameraTween {
public:
    // Starts toward `target`, clamped to [0, maxOffset]. A tween already in
    // flight keeps its position and changes its target.
    CameraStart Begin(double current, double target, double maxOffset, bool reduced);

    // Advances to `nowMs`. Settles exactly on the target.
    CameraStep Step(double nowMs, bool reduced);

    // Stops without settling. Used when the scroller leaves the view.
    void Cancel();

    bool active() const { return active_; }
    double target() const { return target_; }
    double position() const { return position_; }

private:
    void Finish();

    bool active_ = false;
    double position_ = 0.0;
    double target_ = 0.0;
    int steps_ = 0;
    bool hasLastTime_ = false;
    double lastTimeMs_ = 0.0;
};

}  // namespace tvm::motion
