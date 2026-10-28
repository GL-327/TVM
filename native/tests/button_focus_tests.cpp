// Button focus tests: the eased focus of a screen's buttons, and how a button is drawn at a focus
// amount. The values follow `.tvm-button` in apps/ui/src/app.css and the focus tokens of the dark
// theme, at 1080p where a rem is 16 px.

#include <cmath>
#include <string>
#include <string_view>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "ui/button_focus.h"
#include "ui/painter.h"
#include "ui/widget.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::ui::Box;
using tvm::ui::ButtonFocusSet;
using tvm::ui::ButtonLook;
using tvm::ui::Color;
using tvm::ui::Metrics;

MotionSettings Auto() {
    return MotionSettings{};
}

MotionSettings Reduced() {
    MotionSettings settings;
    settings.preference = MotionPreference::Reduced;
    return settings;
}

bool SameColor(const Color& a, const Color& b) {
    return std::abs(a.r - b.r) < 1e-9 && std::abs(a.g - b.g) < 1e-9 && std::abs(a.b - b.b) < 1e-9 &&
           std::abs(a.a - b.a) < 1e-9;
}

// Records each shape drawn, in order, so a test can check where a button is and what colour it has.
class ShapePainter final : public tvm::ui::Painter {
public:
    struct Shape {
        std::string kind;
        Box box;
        double radius = 0.0;
        Color color;
        std::string text;
    };

    void Clear(Color /*color*/) override {}
    void FillRoundRect(const Box& box, double radius, Color color) override {
        shapes.push_back(Shape{"fill", box, radius, color, ""});
    }
    void StrokeRoundRect(const Box& box, double radius, double /*width*/, Color color) override {
        shapes.push_back(Shape{"stroke", box, radius, color, ""});
    }
    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const Box& /*box*/, std::string_view /*text*/, const tvm::ui::TextStyle& /*style*/,
                   Color /*color*/) override {}
    void Text(const Box& box, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color color) override {
        shapes.push_back(Shape{"text", box, 0.0, color, std::string(text)});
    }
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}

    std::vector<Shape> shapes;
};

// ------------------------------------------------------------- the eased focus

TEST(button_focus_sets_the_first_focus_at_once_and_eases_the_next) {
    ButtonFocusSet focus;
    focus.Track("play", 0.0, Auto());
    REQUIRE_NEAR(focus.Amount("play", 0.0), 1.0, 1e-9);
    REQUIRE(!focus.Animating(0.0));

    focus.Track("list", 1000.0, Auto());
    REQUIRE_NEAR(focus.Amount("list", 1000.0), 0.0, 1e-9);
    REQUIRE_NEAR(focus.Amount("play", 1000.0), 1.0, 1e-9);
    REQUIRE(focus.Animating(1070.0));
    // The two buttons trade the focus: what one loses, the other gains.
    const double gained = focus.Amount("list", 1070.0);
    REQUIRE(gained > 0.0 && gained < 1.0);
    REQUIRE_NEAR(focus.Amount("play", 1070.0) + gained, 1.0, 1e-9);

    // The fast token is 140 ms.
    REQUIRE_NEAR(focus.Amount("list", 1140.0), 1.0, 1e-9);
    REQUIRE_NEAR(focus.Amount("play", 1140.0), 0.0, 1e-9);
    REQUIRE(!focus.Animating(1140.0));
}

TEST(button_focus_refocused_midway_eases_from_where_the_button_is) {
    ButtonFocusSet focus;
    focus.Track("play", 0.0, Auto());
    focus.Track("list", 1000.0, Auto());
    const double before = focus.Amount("play", 1070.0);
    focus.Track("play", 1070.0, Auto());
    REQUIRE_NEAR(focus.Amount("play", 1070.0), before, 1e-9);
    REQUIRE(focus.Animating(1100.0));
    REQUIRE_NEAR(focus.Amount("play", 1210.0), 1.0, 1e-9);
}

TEST(button_focus_reduced_motion_lands_at_once) {
    ButtonFocusSet focus;
    focus.Track("play", 0.0, Reduced());
    focus.Track("list", 1000.0, Reduced());
    REQUIRE_NEAR(focus.Amount("list", 1001.0), 1.0, 1e-9);
    REQUIRE_NEAR(focus.Amount("play", 1001.0), 0.0, 1e-9);
    REQUIRE(!focus.Animating(1001.0));
}

TEST(button_focus_ignores_a_repeat_of_the_focus_it_has) {
    ButtonFocusSet focus;
    focus.Track("play", 0.0, Auto());
    focus.Track("play", 500.0, Auto());
    REQUIRE_NEAR(focus.Amount("play", 500.0), 1.0, 1e-9);
    REQUIRE(!focus.Animating(500.0));
}

// ------------------------------------------------------------- how a button is drawn

TEST(button_at_rest_is_a_pill_on_the_surface_colour_with_no_ring) {
    ShapePainter painter;
    const Metrics metrics{};
    DrawButton(painter, metrics, Box{100.0, 100.0, 200.0, 50.0}, "Add to My List", ButtonLook{});
    REQUIRE_EQ(painter.shapes.size(), std::size_t(2));

    const ShapePainter::Shape& fill = painter.shapes[0];
    REQUIRE_EQ(fill.kind, std::string("fill"));
    REQUIRE_NEAR(fill.box.x, 100.0, 1e-9);
    REQUIRE_NEAR(fill.box.width, 200.0, 1e-9);
    REQUIRE_NEAR(fill.box.height, 50.0, 1e-9);
    // The pill's radius is half its height.
    REQUIRE_NEAR(fill.radius, 25.0, 1e-9);
    REQUIRE(SameColor(fill.color, tvm::ui::tokens::kSurface));

    REQUIRE_EQ(painter.shapes[1].kind, std::string("text"));
    REQUIRE(SameColor(painter.shapes[1].color, tvm::ui::tokens::kText));
}

TEST(focused_button_scales_about_its_centre_and_rings_the_scaled_shape) {
    ShapePainter painter;
    const Metrics metrics{};
    DrawButton(painter, metrics, Box{100.0, 100.0, 200.0, 50.0}, "Play", ButtonLook{false, true, 1.0});
    REQUIRE_EQ(painter.shapes.size(), std::size_t(3));

    // 1.08 times the box, with the centre kept at (200, 125).
    const ShapePainter::Shape& fill = painter.shapes[0];
    REQUIRE_NEAR(fill.box.width, 216.0, 1e-9);
    REQUIRE_NEAR(fill.box.height, 54.0, 1e-9);
    REQUIRE_NEAR(fill.box.CenterX(), 200.0, 1e-9);
    REQUIRE_NEAR(fill.box.CenterY(), 125.0, 1e-9);
    REQUIRE_NEAR(fill.radius, 27.0, 1e-9);
    REQUIRE(SameColor(fill.color, tvm::ui::tokens::kSurfaceHover));

    // The ring is the focus outline: 0.14 rem beyond the edge, plus half its own 0.18 rem width.
    const ShapePainter::Shape& ring = painter.shapes[1];
    REQUIRE_EQ(ring.kind, std::string("stroke"));
    const double outset = 0.14 * 16.0 + 0.18 * 16.0 / 2.0;
    REQUIRE_NEAR(ring.box.x, fill.box.x - outset, 1e-9);
    REQUIRE_NEAR(ring.box.width, fill.box.width + 2.0 * outset, 1e-9);
    REQUIRE(SameColor(ring.color, tvm::ui::tokens::kFocusRing));
}

TEST(a_button_part_way_through_its_ease_is_part_way_scaled) {
    ShapePainter painter;
    const Metrics metrics{};
    DrawButton(painter, metrics, Box{100.0, 100.0, 200.0, 50.0}, "Play", ButtonLook{false, true, 0.5});
    REQUIRE_NEAR(painter.shapes[0].box.width, 208.0, 1e-9);
    REQUIRE_NEAR(painter.shapes[0].box.height, 52.0, 1e-9);
}

TEST(primary_button_is_white_with_dark_ink_and_stays_white_when_focused) {
    ShapePainter painter;
    const Metrics metrics{};
    DrawButton(painter, metrics, Box{100.0, 100.0, 200.0, 50.0}, "Save", ButtonLook{true, false, 0.0});
    REQUIRE(SameColor(painter.shapes[0].color, tvm::ui::tokens::kPrimary));
    REQUIRE(SameColor(painter.shapes[1].color, tvm::ui::tokens::kOnPrimary));

    ShapePainter focused;
    DrawButton(focused, metrics, Box{100.0, 100.0, 200.0, 50.0}, "Save", ButtonLook{true, true, 1.0});
    REQUIRE(SameColor(focused.shapes[0].color, tvm::ui::tokens::kPrimary));
    REQUIRE_EQ(focused.shapes.size(), std::size_t(3));
}

}  // namespace
