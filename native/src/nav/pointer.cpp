#include "nav/pointer.h"

#include <algorithm>
#include <cmath>

namespace tvm::nav {

namespace {

// A touch sample is only used for velocity if it came 8 to 80ms after the last.
constexpr double kVelocityMinMs = 8.0;
constexpr double kVelocityMaxMs = 80.0;
// A release within this window of the last sample is a swipe, not a hold.
constexpr double kSwipeWindowMs = 80.0;
constexpr double kMaxFingerVelocity = 2.0;
constexpr double kMomentumPx = 180.0;
constexpr double kLinePx = 16.0;

double Distance(double dx, double dy) {
    return std::hypot(dx, dy);
}

}  // namespace

bool TapShouldActivate(bool moved, double distance, double slop) {
    return !moved && std::isfinite(distance) && distance <= slop;
}

std::optional<Axis> PanAxis(double dx, double dy, double slop) {
    const double ax = std::fabs(dx);
    const double ay = std::fabs(dy);
    if (ax <= slop && ay <= slop) return std::nullopt;
    return ax > ay ? Axis::X : Axis::Y;
}

double DragScroll(double startScroll, double startX, double x) {
    if (!std::isfinite(startScroll) || !std::isfinite(startX) || !std::isfinite(x)) return startScroll;
    return startScroll - (x - startX);
}

double MomentumTarget(double scroll, double fingerVelocity) {
    if (!std::isfinite(scroll) || !std::isfinite(fingerVelocity)) return scroll;
    return scroll - std::clamp(fingerVelocity, -kMaxFingerVelocity, kMaxFingerVelocity) * kMomentumPx;
}

bool CanScroll(double contentSize, double viewportSize) {
    return contentSize - viewportSize > 1.0;
}

bool WheelWantsRail(double deltaX, double deltaY, bool shift) {
    return std::fabs(deltaX) > std::fabs(deltaY) || shift;
}

double WheelPixels(double delta, WheelMode mode, double viewport) {
    if (!std::isfinite(delta)) return 0.0;
    switch (mode) {
    case WheelMode::Line:
        return delta * kLinePx;
    case WheelMode::Page:
        return delta * std::max(1.0, viewport);
    case WheelMode::Pixel:
        break;
    }
    return delta;
}

double WheelTarget(double current, double pending, double delta) {
    // A reversal starts from where the camera is, not from stale momentum.
    const double base = (pending - current) * delta < 0.0 ? current : pending;
    return base + delta;
}

// ---------------------------------------------------------------- MouseState

MouseState::MoveResult MouseState::OnMove(double x, double y, bool buttonDown) {
    MoveResult result;
    if (buttonDown) {
        result.dragging = true;
        return result;
    }

    // NaN is not less than the epsilon, so the first real move always counts.
    const double dx = std::fabs(x - lastX_);
    const double dy = std::fabs(y - lastY_);
    if (dx < kMoveEpsilon && dy < kMoveEpsilon) return result;

    lastX_ = x;
    lastY_ = y;
    result.cursorShown = !visible_;
    visible_ = true;
    result.counted = true;
    return result;
}

void MouseState::OnKeyPress() {
    visible_ = false;
    lastX_ = std::numeric_limits<double>::quiet_NaN();
    lastY_ = std::numeric_limits<double>::quiet_NaN();
}

void MouseState::ShowCursor() {
    visible_ = true;
}

// -------------------------------------------------------------- ClickTracker

void ClickTracker::Press(std::uint32_t pointerId, double x, double y, std::optional<std::string> hostKey) {
    press_ = PressState{pointerId, x, y, std::move(hostKey), false};
}

void ClickTracker::Move(std::uint32_t pointerId, double x, double y) {
    if (!press_.has_value() || press_->pointerId != pointerId) return;
    if (Distance(x - press_->x, y - press_->y) > kTapSlop) press_->moved = true;
}

std::optional<std::string> ClickTracker::Release(std::uint32_t pointerId, double x, double y) {
    if (!press_.has_value() || press_->pointerId != pointerId) return std::nullopt;
    const PressState press = *press_;
    press_.reset();
    const bool moved = press.moved || Distance(x - press.x, y - press.y) > kTapSlop;
    if (moved) return std::nullopt;
    return press.hostKey;
}

void ClickTracker::Cancel() {
    press_.reset();
}

// ------------------------------------------------------------- TouchGesture

void TouchGesture::Down(std::uint32_t pointerId, double x, double y, std::optional<std::string> hostKey,
                        bool railCanPan, double railScroll, bool pageCanPan, double pageScroll, double nowMs) {
    // A second finger does not replace the first.
    if (touch_.has_value()) return;
    Touch touch;
    touch.pointerId = pointerId;
    touch.startX = x;
    touch.startY = y;
    touch.lastX = x;
    touch.lastY = y;
    touch.lastMs = nowMs;
    touch.hostKey = std::move(hostKey);
    touch.railCanPan = railCanPan;
    touch.railStart = railScroll;
    touch.pageCanPan = pageCanPan;
    touch.pageStart = pageScroll;
    touch_ = std::move(touch);
}

TouchGesture::MoveResult TouchGesture::Move(std::uint32_t pointerId, double x, double y, double nowMs) {
    MoveResult result;
    if (!touch_.has_value() || touch_->pointerId != pointerId) return result;
    Touch& touch = *touch_;

    const double dx = x - touch.startX;
    const double dy = y - touch.startY;
    const double elapsed = nowMs - touch.lastMs;
    if (elapsed >= kVelocityMinMs && elapsed <= kVelocityMaxMs) {
        touch.velocityX = (x - touch.lastX) / elapsed;
        touch.velocityY = (y - touch.lastY) / elapsed;
    }
    touch.lastX = x;
    touch.lastY = y;
    touch.lastMs = nowMs;
    if (Distance(dx, dy) > kTapSlop) touch.moved = true;

    // The axis is decided once, and then holds for the rest of the drag.
    if (!touch.axis.has_value()) touch.axis = PanAxis(dx, dy);
    if (!touch.axis.has_value()) return result;

    result.axis = *touch.axis;
    if (*touch.axis == Axis::X && touch.railCanPan) {
        result.scroll = DragScroll(touch.railStart, touch.startX, x);
    } else if (*touch.axis == Axis::Y && touch.pageCanPan) {
        result.scroll = DragScroll(touch.pageStart, touch.startY, y);
    }
    return result;
}

TouchGesture::ReleaseResult TouchGesture::Release(std::uint32_t pointerId, double x, double y, double nowMs,
                                                  double railScroll, double pageScroll) {
    ReleaseResult result;
    if (!touch_.has_value() || touch_->pointerId != pointerId) return result;
    const Touch touch = *touch_;
    touch_.reset();

    const std::optional<Axis> axis = touch.axis;
    result.axis = axis.value_or(Axis::X);

    // A quick swipe coasts a little further in the same direction.
    if (nowMs - touch.lastMs < kSwipeWindowMs) {
        if (axis == Axis::X && touch.railCanPan && touch.velocityX != 0.0) {
            result.momentum = MomentumTarget(railScroll, touch.velocityX);
        } else if (axis == Axis::Y && touch.pageCanPan && touch.velocityY != 0.0) {
            result.momentum = MomentumTarget(pageScroll, touch.velocityY);
        }
    }

    // A drag that locked an axis, or left the slop, is not a tap.
    if (axis.has_value() || touch.moved || Distance(x - touch.startX, y - touch.startY) > kTapSlop) return result;
    result.tapKey = touch.hostKey;
    return result;
}

void TouchGesture::Cancel() {
    touch_.reset();
}

}  // namespace tvm::nav
