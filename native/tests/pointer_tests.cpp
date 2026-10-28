// Pointer tests. The pure cases are ported from apps/ui/src/nav/pointerInput.test.ts.
// The gesture cases are ported from pointerGesture.test.ts, with the DOM events
// replaced by direct calls to the state machines.

#include <cmath>
#include <cstdint>
#include <optional>
#include <string>

#include "harness.h"
#include "nav/pointer.h"

namespace {

using tvm::nav::Axis;
using tvm::nav::ClickTracker;
using tvm::nav::MouseState;
using tvm::nav::TouchGesture;
using tvm::nav::WheelMode;

// ------------------------------------------------------------ scrolling

TEST(can_scroll_sees_a_rail_that_overflows) {
    REQUIRE(tvm::nav::CanScroll(4000, 1200));
    REQUIRE(!tvm::nav::CanScroll(1200, 1200));
}

TEST(can_scroll_sees_a_page_taller_than_its_viewport) {
    REQUIRE(tvm::nav::CanScroll(2400, 1080));
    REQUIRE(!tvm::nav::CanScroll(1080, 1080));
}

TEST(can_scroll_ignores_a_sub_pixel_difference) {
    REQUIRE(!tvm::nav::CanScroll(1080.5, 1080));
}

TEST(wheel_sends_a_trackpad_side_swipe_to_the_rail) {
    REQUIRE(tvm::nav::WheelWantsRail(-40, 2, false));
}

TEST(wheel_sends_a_plain_wheel_down_the_page) {
    REQUIRE(!tvm::nav::WheelWantsRail(0, 120, false));
}

TEST(wheel_lets_shift_redirect_a_mouse_wheel_along_the_rail) {
    // A mouse wheel never reports deltaX, so Shift is the only way to say sideways.
    REQUIRE(tvm::nav::WheelWantsRail(0, 120, true));
}

TEST(wheel_normalises_line_page_and_pixel_deltas) {
    REQUIRE_NEAR(tvm::nav::WheelPixels(2, WheelMode::Line, 800), 32, 1e-9);
    REQUIRE_NEAR(tvm::nav::WheelPixels(-1, WheelMode::Page, 800), -800, 1e-9);
    REQUIRE_NEAR(tvm::nav::WheelPixels(2.5, WheelMode::Pixel, 800), 2.5, 1e-9);
    REQUIRE_NEAR(tvm::nav::WheelPixels(std::nan(""), WheelMode::Pixel, 800), 0, 1e-9);
}

TEST(wheel_accumulates_notches_but_reverses_without_stale_momentum) {
    REQUIRE_NEAR(tvm::nav::WheelTarget(100, 300, 120), 420, 1e-9);
    REQUIRE_NEAR(tvm::nav::WheelTarget(100, 300, -30), 70, 1e-9);
    REQUIRE_NEAR(tvm::nav::WheelTarget(100, 40, 30), 130, 1e-9);
}

// ------------------------------------------------------------ taps and drags

TEST(tap_activates_a_press_inside_the_slop) {
    REQUIRE(tvm::nav::TapShouldActivate(false, 2));
    REQUIRE(!tvm::nav::TapShouldActivate(true, 2));
    REQUIRE(!tvm::nav::TapShouldActivate(false, 40));
}

TEST(pan_waits_for_the_slop_before_locking_an_axis) {
    REQUIRE(!tvm::nav::PanAxis(2, 3).has_value());
    REQUIRE(tvm::nav::PanAxis(4, 20) == std::optional<Axis>(Axis::Y));
    REQUIRE(tvm::nav::PanAxis(24, 3) == std::optional<Axis>(Axis::X));
}

TEST(drag_follows_the_finger_along_a_rail_from_the_press_origin) {
    REQUIRE_NEAR(tvm::nav::DragScroll(400, 80, 30), 450, 1e-9);
    REQUIRE_NEAR(tvm::nav::DragScroll(400, 80, 120), 360, 1e-9);
    REQUIRE(std::isnan(tvm::nav::DragScroll(std::nan(""), 0, 10)));
}

TEST(momentum_continues_a_swipe_and_bounds_implausible_velocity) {
    REQUIRE_NEAR(tvm::nav::MomentumTarget(400, -1), 580, 1e-9);
    REQUIRE_NEAR(tvm::nav::MomentumTarget(400, 1), 220, 1e-9);
    REQUIRE_NEAR(tvm::nav::MomentumTarget(400, 100), 40, 1e-9);
}

// ---------------------------------------------------------- mouse cursor

TEST(cursor_appears_on_the_first_real_move) {
    MouseState mouse;
    REQUIRE(!mouse.cursorVisible());
    const MouseState::MoveResult result = mouse.OnMove(100, 100, false);
    REQUIRE(result.cursorShown);
    REQUIRE(result.counted);
    REQUIRE(mouse.cursorVisible());
}

TEST(jitter_below_the_epsilon_does_not_count_as_a_move) {
    MouseState mouse;
    (void)mouse.OnMove(100, 100, false);
    const MouseState::MoveResult jitter = mouse.OnMove(101, 101, false);
    REQUIRE(!jitter.counted);
    REQUIRE(!jitter.cursorShown);
}

TEST(a_held_button_is_a_drag_and_does_not_hover) {
    MouseState mouse;
    const MouseState::MoveResult result = mouse.OnMove(300, 300, true);
    REQUIRE(result.dragging);
    REQUIRE(!result.counted);
}

TEST(a_remote_press_hides_the_cursor_and_the_next_move_shows_it_again) {
    MouseState mouse;
    (void)mouse.OnMove(100, 100, false);
    mouse.OnKeyPress();
    REQUIRE(!mouse.cursorVisible());
    // The position is forgotten, so the next move counts even if it is small.
    REQUIRE(mouse.OnMove(100, 100, false).counted);
}

// ------------------------------------------------------------- clicks

TEST(a_tap_activates_its_host_on_release) {
    ClickTracker clicks;
    clicks.Press(1, 20, 10, std::string("rail/card"));
    const auto activated = clicks.Release(1, 23, 10);
    REQUIRE(activated == std::optional<std::string>("rail/card"));
    REQUIRE(!clicks.active());
}

TEST(a_drag_beyond_the_slop_does_not_activate) {
    ClickTracker clicks;
    clicks.Press(1, 20, 10, std::string("rail/card"));
    clicks.Move(1, 80, 10);
    REQUIRE(!clicks.Release(1, 80, 10).has_value());
}

TEST(a_second_pointer_does_not_complete_the_first_press) {
    ClickTracker clicks;
    clicks.Press(1, 20, 10, std::string("rail/card"));
    REQUIRE(!clicks.Release(2, 20, 10).has_value());
    REQUIRE(clicks.active());
}

// ------------------------------------------------------------ touch

TEST(touch_tap_activates_once_when_the_finger_stays_put) {
    TouchGesture touch;
    touch.Down(1, 20, 10, std::string("rail/card"), true, 0, true, 0, 0);
    const TouchGesture::ReleaseResult release = touch.Release(1, 23, 10, 200, 0, 0);
    REQUIRE(release.tapKey == std::optional<std::string>("rail/card"));
    REQUIRE(!touch.active());
}

TEST(touch_swipe_pans_the_rail_and_does_not_tap) {
    TouchGesture touch;
    touch.Down(1, 80, 10, std::string("rail/card"), true, 400, true, 0, 0);
    const TouchGesture::MoveResult move = touch.Move(1, 30, 12, 16);
    REQUIRE(move.axis == Axis::X);
    REQUIRE(move.scroll.has_value());
    REQUIRE_NEAR(*move.scroll, 450, 1e-9);

    const TouchGesture::ReleaseResult release = touch.Release(1, 30, 12, 200, 450, 0);
    REQUIRE(!release.tapKey.has_value());
}

TEST(touch_axis_locks_for_the_rest_of_the_drag) {
    TouchGesture touch;
    touch.Down(1, 100, 100, std::nullopt, true, 0, true, 0, 0);
    REQUIRE(touch.Move(1, 130, 102, 16).axis == Axis::X);
    // A later vertical wiggle does not switch the drag to the page.
    const TouchGesture::MoveResult later = touch.Move(1, 130, 200, 32);
    REQUIRE(later.axis == Axis::X);
}

TEST(a_vertical_drag_pans_the_page_and_drops_the_rail) {
    TouchGesture touch;
    touch.Down(1, 100, 100, std::nullopt, true, 0, true, 500, 0);
    const TouchGesture::MoveResult move = touch.Move(1, 101, 160, 16);
    REQUIRE(move.axis == Axis::Y);
    REQUIRE_NEAR(*move.scroll, 440, 1e-9);
}

TEST(a_quick_release_coasts_in_the_swipe_direction) {
    TouchGesture touch;
    touch.Down(1, 300, 10, std::nullopt, true, 400, false, 0, 0);
    // 40px in 16ms is -2.5px/ms, clamped to -2. From 440 the coast goes 2 * 180 = 360px further right.
    (void)touch.Move(1, 260, 10, 16);
    const TouchGesture::ReleaseResult release = touch.Release(1, 260, 10, 32, 440, 0);
    REQUIRE(release.momentum.has_value());
    REQUIRE_NEAR(*release.momentum, 800, 1e-9);
}

TEST(a_second_finger_is_ignored) {
    TouchGesture touch;
    touch.Down(1, 20, 10, std::string("rail/card"), true, 0, true, 0, 0);
    touch.Down(2, 80, 10, std::string("other"), true, 0, true, 0, 0);
    const TouchGesture::ReleaseResult release = touch.Release(1, 21, 10, 200, 0, 0);
    REQUIRE(release.tapKey == std::optional<std::string>("rail/card"));
}

TEST(a_cancelled_touch_never_activates) {
    TouchGesture touch;
    touch.Down(1, 20, 10, std::string("rail/card"), true, 0, true, 0, 0);
    touch.Cancel();
    REQUIRE(!touch.Release(1, 20, 10, 200, 0, 0).tapKey.has_value());
}

}  // namespace
