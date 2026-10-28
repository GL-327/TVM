// Stage tests: the animated background of the old app's scene. The positions, the keyframes and the
// reduced and performance rules follow apps/ui/src/theme/scene.css and the dark theme, at a 1000 x 600 window.

#include <cmath>
#include <memory>
#include <string_view>
#include <vector>

#include "harness.h"
#include "motion/easing.h"
#include "motion/preferences.h"
#include "ui/painter.h"
#include "ui/preferences_store.h"
#include "ui/screen_base.h"
#include "ui/shell.h"
#include "ui/stage.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::ui::Box;
using tvm::ui::Color;
using tvm::ui::GradientStop;
using tvm::ui::Stage;

MotionSettings Auto() {
    return MotionSettings{};
}

MotionSettings Reduced() {
    MotionSettings settings;
    settings.preference = MotionPreference::Reduced;
    return settings;
}

MotionSettings Performance() {
    MotionSettings settings;
    settings.performanceMode = true;
    return settings;
}

// Records each radial gradient of the stage, in paint order, with its centre, radii and stops.
class StagePainter final : public tvm::ui::Painter {
public:
    struct Radial {
        double cx;
        double cy;
        double rx;
        double ry;
        std::vector<GradientStop> stops;
    };

    void Clear(Color /*color*/) override { clears += 1; }
    void FillRoundRect(const Box& /*box*/, double /*radius*/, Color /*color*/) override {}
    void StrokeRoundRect(const Box& /*box*/, double /*radius*/, double /*width*/, Color /*color*/) override {}
    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const Box& /*box*/, std::string_view /*text*/, const tvm::ui::TextStyle& /*style*/,
                   Color /*color*/) override {}
    void Text(const Box& /*box*/, std::string_view /*text*/, const tvm::ui::TextStyle& /*style*/,
              Color /*color*/) override {}
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}
    void FillRadialGradient(const Box& /*box*/, double cx, double cy, double rx, double ry,
                            const std::vector<GradientStop>& stops) override {
        radials.push_back(Radial{cx, cy, rx, ry, stops});
    }

    std::vector<Radial> radials;
    int clears = 0;
};

// A screen that shows the stage, as a transparent page would, and one that does not.
class TransparentScreen final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    bool ShowsStage() const override { return true; }
};

class OpaqueScreen final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& painter) const override { painter.Clear(Color{}); }
};

class MemoryStore final : public tvm::ui::PreferenceStore {
public:
    tvm::motion::MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const tvm::motion::MotionSettings& settings) override { motion_ = settings; }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& /*patch*/) override {}

    tvm::motion::MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
};

// ------------------------------------------------------------------- the layers

TEST(stage_layers_sit_in_a_box_12_percent_past_each_side_of_the_window) {
    Stage stage(Reduced());
    StagePainter painter;
    stage.Paint(painter, 1000.0, 600.0, 0.0);
    REQUIRE_EQ(painter.radials.size(), std::size_t(6));
    // The sky sits at 48% across and -8% down its box, which runs from -12% to 112%: 475.2 px and -131.52 px.
    REQUIRE_NEAR(painter.radials[0].cx, 475.2, 1e-6);
    REQUIRE_NEAR(painter.radials[0].cy, -131.52, 1e-6);
    // Its radii are 120% and 80% of the box, which is 1240 px by 744 px.
    REQUIRE_NEAR(painter.radials[0].rx, 1.20 * 1240.0, 1e-6);
    REQUIRE_NEAR(painter.radials[0].ry, 0.80 * 744.0, 1e-6);
}

TEST(reduced_motion_holds_every_layer_still_at_its_settled_opacity) {
    Stage stage(Reduced());
    REQUIRE(!stage.Moving());
    StagePainter painter;
    stage.Paint(painter, 1000.0, 600.0, 12345.0);
    REQUIRE_EQ(painter.radials.size(), std::size_t(6));
    // Every layer is at 0.7 and the sun and the spec at 0.36, times the container's 0.52.
    REQUIRE_NEAR(painter.radials[0].stops[0].color.a, 0.70 * 0.7 * 0.52, 1e-9);
    REQUIRE_NEAR(painter.radials[1].stops[0].color.a, 0.38 * 0.7 * 0.52, 1e-9);
    // Soft-light caustics are at half strength.
    REQUIRE_NEAR(painter.radials[2].stops[0].color.a, 0.32 * 0.7 * 0.52 * 0.5, 1e-9);
    REQUIRE_NEAR(painter.radials[4].stops[1].color.a, 0.28 * 0.36 * 0.52, 1e-9);
    REQUIRE_NEAR(painter.radials[5].stops[0].color.a, 0.55 * 0.36 * 0.52, 1e-9);
}

TEST(the_drift_starts_from_its_first_keyframe) {
    Stage stage(Auto());
    REQUIRE(stage.Moving());
    StagePainter painter;
    stage.Paint(painter, 1000.0, 600.0, 0.0);
    // The sky starts at (-7%, 3.5%) of its box, and at 1.06 times its size about the box's centre (500, 300).
    // Its centre is then (475.2 - 0.07 * 1240 - 1.06 * 24.8, -131.52 + 0.035 * 744 - 1.06 * 431.52) with the
    // scale applied about the centre, which gives (386.912, -131.3712).
    REQUIRE_NEAR(painter.radials[0].cx, 386.912, 1e-3);
    REQUIRE_NEAR(painter.radials[0].cy, -131.3712, 1e-3);
    REQUIRE_NEAR(painter.radials[0].rx, 1.06 * 1488.0, 1e-3);
}

TEST(the_drift_is_halfway_at_half_its_period_and_returns_on_the_way_back) {
    Stage stage(Auto());
    StagePainter halfway;
    stage.Paint(halfway, 1000.0, 600.0, 12000.0);
    // Half of 24 s, with the easing at its midpoint: the sky is 1.11 times its size, moved by (+0.25%, -0.5%).
    REQUIRE_NEAR(halfway.radials[0].cx, 475.572, 1e-2);
    REQUIRE_NEAR(halfway.radials[0].cy, -182.707, 1e-2);

    // With alternate directions, the cycle that runs back has the same halfway point.
    StagePainter back;
    stage.Paint(back, 1000.0, 600.0, 36000.0);
    REQUIRE_NEAR(back.radials[0].cx, halfway.radials[0].cx, 1e-6);
    REQUIRE_NEAR(back.radials[0].cy, halfway.radials[0].cy, 1e-6);

    // At the end of the first cycle the sky is at its last keyframe.
    StagePainter end;
    stage.Paint(end, 1000.0, 600.0, 24000.0);
    REQUIRE_NEAR(end.radials[0].rx, 1.16 * 1488.0, 1e-3);
}

TEST(the_second_caustic_starts_nine_seconds_into_its_drift) {
    Stage stage(Auto());
    StagePainter painter;
    stage.Paint(painter, 1000.0, 600.0, 0.0);
    // Its 27 s cycle is 9 s in at 0, a third of the way along, and the easing is applied to that third.
    // Its scale runs from 1.06 to 1.22. Its base radius is 62% of the 1240 px box.
    const double progress = tvm::motion::CubicBezier(0.37, 0.0, 0.63, 1.0).Ease(9.0 / 27.0);
    const double expected = 1.06 + (1.22 - 1.06) * progress;
    REQUIRE_NEAR(painter.radials[3].rx / (0.62 * 1240.0), expected, 1e-9);
}

TEST(performance_mode_hides_the_stage_altogether) {
    Stage stage(Performance());
    REQUIRE(!stage.Shown());
    REQUIRE(!stage.Moving());
    StagePainter painter;
    stage.Paint(painter, 1000.0, 600.0, 0.0);
    REQUIRE(painter.radials.empty());
}

TEST(a_moving_stage_is_shown_and_moves) {
    Stage stage(Auto());
    REQUIRE(stage.Shown());
    REQUIRE(stage.Moving());
}

// ----------------------------------------------------------------- the shell

TEST(a_screen_that_shows_the_stage_has_it_painted_behind_it) {
    MemoryStore store;
    tvm::ui::Shell shell(std::make_unique<TransparentScreen>(), store);
    shell.Layout(1000.0, 600.0);
    StagePainter painter;
    shell.Paint(painter);
    // The app's black ground is painted first, and the stage over it.
    REQUIRE_EQ(painter.clears, 1);
    REQUIRE_EQ(painter.radials.size(), std::size_t(6));
}

TEST(an_opaque_screen_hides_the_stage_and_keeps_the_frame_still) {
    MemoryStore store;
    tvm::ui::Shell shell(std::make_unique<OpaqueScreen>(), store);
    shell.Layout(1000.0, 600.0);
    StagePainter painter;
    shell.Paint(painter);
    REQUIRE(painter.radials.empty());
    REQUIRE(!shell.Animating());
}

TEST(a_transparent_screen_keeps_the_frames_coming_while_the_stage_moves) {
    MemoryStore store;
    tvm::ui::Shell shell(std::make_unique<TransparentScreen>(), store);
    shell.Layout(1000.0, 600.0);
    shell.Tick(0.0);
    REQUIRE(shell.Animating());
}

}  // namespace
