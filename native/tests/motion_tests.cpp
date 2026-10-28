// Motion tests: CSS timing functions and keyframes, the camera tween's rules,
// the timeline's pause behaviour, and motion preferences.

#include <cmath>
#include <vector>

#include "harness.h"
#include "motion/camera.h"
#include "motion/easing.h"
#include "motion/preferences.h"
#include "motion/timeline.h"

namespace {

using tvm::motion::CameraStart;
using tvm::motion::CameraTween;
using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;

// Reference values from an exact bisection solve of the same curves
// (Node 24), so the Newton-plus-bisection solver is checked independently.
TEST(css_curves_match_the_exact_solution) {
    REQUIRE_NEAR(tvm::motion::kEase.Ease(0.1), 0.0947963057, 1e-6);
    REQUIRE_NEAR(tvm::motion::kEase.Ease(0.5), 0.8024033876, 1e-6);
    REQUIRE_NEAR(tvm::motion::kEase.Ease(0.9), 0.9943164775, 1e-6);
    REQUIRE_NEAR(tvm::motion::kMotionEase.Ease(0.3), 0.8321920575, 1e-6);
    REQUIRE_NEAR(tvm::motion::kMotionEase.Ease(0.5), 0.9613825478, 1e-6);
    REQUIRE_NEAR(tvm::motion::kEaseOut.Ease(0.7), 0.8704232392, 1e-6);
}

TEST(linear_curve_is_the_identity_and_progress_is_clamped) {
    REQUIRE_NEAR(tvm::motion::kLinear.Ease(0.37), 0.37, 1e-9);
    REQUIRE_NEAR(tvm::motion::kEase.Ease(-1.0), 0.0, 1e-12);
    REQUIRE_NEAR(tvm::motion::kEase.Ease(2.0), 1.0, 1e-12);
}

TEST(glass_sweep_keyframes_rise_then_fall) {
    const std::vector<tvm::motion::Keyframe> sweep = {{0.0, 0.0}, {0.4, 0.28}, {1.0, 0.0}};
    REQUIRE_NEAR(tvm::motion::EvaluateKeyframes(sweep, 0.0), 0.0, 1e-12);
    REQUIRE_NEAR(tvm::motion::EvaluateKeyframes(sweep, 0.4), 0.28, 1e-12);
    REQUIRE_NEAR(tvm::motion::EvaluateKeyframes(sweep, 1.0), 0.0, 1e-12);
    REQUIRE_NEAR(tvm::motion::EvaluateKeyframes(sweep, 0.2), 0.28 * 0.8024033876, 1e-6);
    REQUIRE_NEAR(tvm::motion::EvaluateKeyframes(sweep, 0.7), 0.28 - 0.28 * 0.8024033876, 1e-6);
}

TEST(camera_ease_is_frame_rate_independent_and_capped) {
    REQUIRE_NEAR(tvm::motion::CameraEase(tvm::motion::kFrameMs), 0.24, 1e-12);
    // A stalled tab resumes with at most 64 ms of elapsed time.
    REQUIRE_NEAR(tvm::motion::CameraEase(5000.0), tvm::motion::CameraEase(64.0), 1e-12);
    // Invalid elapsed time counts as one frame.
    REQUIRE_NEAR(tvm::motion::CameraEase(0.0), tvm::motion::CameraEase(tvm::motion::kFrameMs), 1e-12);
    REQUIRE_NEAR(tvm::motion::CameraEase(-4.0), tvm::motion::CameraEase(tvm::motion::kFrameMs), 1e-12);
}

TEST(camera_short_hops_and_reduced_motion_land_at_once) {
    CameraTween tween;
    REQUIRE(tween.Begin(100.0, 100.3, 4000.0, false) == CameraStart::Landed);
    REQUIRE_NEAR(tween.position(), 100.3, 1e-12);
    REQUIRE(!tween.active());

    CameraTween reduced;
    REQUIRE(reduced.Begin(0.0, 900.0, 4000.0, true) == CameraStart::Landed);
    REQUIRE_NEAR(reduced.position(), 900.0, 1e-12);
}

TEST(camera_ignores_non_finite_targets_and_clamps_to_the_scroll_range) {
    CameraTween tween;
    REQUIRE(tween.Begin(0.0, std::nan(""), 4000.0, false) == CameraStart::Ignored);
    REQUIRE(tween.Begin(0.0, 99999.0, 400.0, false) == CameraStart::Animating);
    REQUIRE_NEAR(tween.target(), 400.0, 1e-12);
}

TEST(camera_reduced_step_settles_immediately) {
    CameraTween tween;
    REQUIRE(tween.Begin(0.0, 1000.0, 4000.0, false) == CameraStart::Animating);
    const tvm::motion::CameraStep step = tween.Step(16.0, true);
    REQUIRE(step.settled);
    REQUIRE_NEAR(step.position, 1000.0, 1e-12);
    REQUIRE(!tween.active());
}

TEST(camera_cancel_does_not_settle) {
    CameraTween tween;
    REQUIRE(tween.Begin(0.0, 1000.0, 4000.0, false) == CameraStart::Animating);
    tween.Step(16.0, false);
    tween.Cancel();
    REQUIRE(!tween.active());
    REQUIRE(tween.position() > 0.0);
    REQUIRE(tween.position() < 1000.0);
}

// ------------------------------------------------------------------ timeline

TEST(timeline_runs_updates_and_removes_finished_ones) {
    tvm::motion::Timeline timeline;
    int calls = 0;
    timeline.Add([&calls](double) {
        ++calls;
        return calls == 2;  // Finishes on the second frame.
    });
    timeline.Advance(0.0);
    timeline.Advance(16.0);
    timeline.Advance(32.0);
    REQUIRE_EQ(calls, 2);
    REQUIRE_EQ(timeline.size(), std::size_t{0});
}

TEST(timeline_holds_its_clock_while_paused_and_resumes_without_a_jump) {
    tvm::motion::Timeline timeline;
    std::vector<double> clocks;
    timeline.Add([&clocks](double clock) {
        clocks.push_back(clock);
        return false;
    });

    timeline.Advance(100.0);
    timeline.SetPaused(true, 100.0);
    timeline.Advance(500.0);  // Hidden: the clock does not move.
    timeline.SetPaused(false, 600.0);
    timeline.Advance(700.0);

    REQUIRE_EQ(clocks.size(), std::size_t{3});
    REQUIRE_NEAR(clocks[0], 100.0, 1e-9);
    REQUIRE_NEAR(clocks[1], 100.0, 1e-9);
    REQUIRE_NEAR(clocks[2], 200.0, 1e-9);
}

// --------------------------------------------------------------- preferences

TEST(motion_preference_parses_like_the_web_ui) {
    REQUIRE(tvm::motion::ParseMotionPreference("full") == MotionPreference::Full);
    REQUIRE(tvm::motion::ParseMotionPreference("reduced") == MotionPreference::Reduced);
    REQUIRE(tvm::motion::ParseMotionPreference("auto") == MotionPreference::Auto);
    REQUIRE(tvm::motion::ParseMotionPreference("banana") == MotionPreference::Auto);
    REQUIRE(tvm::motion::ToString(MotionPreference::Reduced) == std::string_view("reduced"));
}

TEST(only_settings_reduce_motion_not_the_os) {
    REQUIRE(!tvm::motion::PrefersReducedMotion(MotionSettings{}));
    REQUIRE(tvm::motion::PrefersReducedMotion(MotionSettings{MotionPreference::Reduced, false}));
    REQUIRE(tvm::motion::PrefersReducedMotion(MotionSettings{MotionPreference::Full, true}));
    REQUIRE(!tvm::motion::PrefersReducedMotion(MotionSettings{MotionPreference::Full, false}));
}

TEST(reduced_motion_snaps_tokens_and_the_glass_sweep) {
    const auto normal = tvm::motion::ResolveMotionTokens(MotionSettings{});
    REQUIRE_NEAR(normal.fastMs, 140.0, 1e-9);
    REQUIRE_NEAR(normal.baseMs, 200.0, 1e-9);
    REQUIRE_NEAR(normal.slowMs, 260.0, 1e-9);
    REQUIRE_NEAR(tvm::motion::GlassSweepMs(MotionSettings{}), 520.0, 1e-9);

    const MotionSettings performance{MotionPreference::Auto, true};
    REQUIRE_NEAR(tvm::motion::ResolveMotionTokens(performance).baseMs, 1.0, 1e-9);
    REQUIRE_NEAR(tvm::motion::GlassSweepMs(performance), 0.0, 1e-9);
}

}  // namespace
