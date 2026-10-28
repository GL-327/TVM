#include "motion/camera.h"

#include <algorithm>
#include <cmath>

namespace tvm::motion {

double CameraEase(double elapsedMs) {
    const double elapsed = std::isfinite(elapsedMs) && elapsedMs > 0.0 ? elapsedMs : kFrameMs;
    return 1.0 - std::pow(1.0 - kCameraEase, std::min(elapsed, kMaxStepMs) / kFrameMs);
}

CameraStart CameraTween::Begin(double current, double target, double maxOffset, bool reduced) {
    if (!std::isfinite(target)) return CameraStart::Ignored;

    const double next = std::clamp(target, 0.0, std::max(0.0, maxOffset));
    if (reduced || std::abs(next - current) < kCameraSettle) {
        Cancel();
        position_ = next;
        return CameraStart::Landed;
    }

    if (!active_) {
        active_ = true;
        position_ = current;
        target_ = next;
        steps_ = 0;
        hasLastTime_ = false;
    } else if (target_ != next) {
        steps_ = 0;
        target_ = next;
    }
    return CameraStart::Animating;
}

CameraStep CameraTween::Step(double nowMs, bool reduced) {
    if (!active_) return {position_, true};

    if (reduced) {
        Finish();
        return {position_, true};
    }

    const double diff = target_ - position_;
    if (std::abs(diff) < kCameraSettle) {
        Finish();
        return {position_, true};
    }

    const double elapsed = hasLastTime_ ? nowMs - lastTimeMs_ : kFrameMs;
    hasLastTime_ = true;
    lastTimeMs_ = nowMs;

    position_ += diff * CameraEase(elapsed);
    ++steps_;
    if (steps_ >= kCameraMaxSteps) {
        Finish();
        return {position_, true};
    }
    return {position_, false};
}

void CameraTween::Cancel() {
    active_ = false;
    steps_ = 0;
    hasLastTime_ = false;
}

void CameraTween::Finish() {
    position_ = target_;
    Cancel();
}

}  // namespace tvm::motion
