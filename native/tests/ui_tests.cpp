// UI tests: the widget tree's layout against the design tokens, the scene's
// navigation and focus, its cameras and focus fades, and what it paints. The
// scene is drawn into a recording painter, so no window is needed.

#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "ui/painter.h"
#include "ui/scene.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::nav::Direction;
using tvm::ui::Box;
using tvm::ui::Color;
using tvm::ui::RailSpec;
using tvm::ui::Scene;

// Records every drawing call. It does not clip, so tests can see everything
// the widgets asked for.
class RecordingPainter final : public tvm::ui::Painter {
public:
    struct Stroke {
        Box box;
        double radius;
        double width;
        Color color;
    };

    void Clear(Color color) override { clears.push_back(color); }

    void FillRoundRect(const Box& box, double /*radius*/, Color /*color*/) override { fills.push_back(box); }

    void StrokeRoundRect(const Box& box, double radius, double width, Color color) override {
        strokes.push_back(Stroke{box, radius, width, color});
    }

    void Text(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color /*color*/) override {
        texts.emplace_back(text);
    }

    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color /*color*/) override {
        texts.emplace_back(text);
    }

    void PushClip(const Box& /*box*/) override { ++clipDepth; }

    void PopClip() override {
        REQUIRE(clipDepth > 0);
        --clipDepth;
    }

    std::vector<Color> clears;
    std::vector<Box> fills;
    std::vector<Stroke> strokes;
    std::vector<std::string> texts;
    int clipDepth = 0;
};

// Two rails of five cards, the 1080p reference layout.
std::vector<RailSpec> SmallRails() {
    return {{"First", 5}, {"Second", 5}};
}

Scene MakeScene(const std::vector<RailSpec>& rails, MotionPreference preference = MotionPreference::Auto) {
    Scene scene(rails, MotionSettings{preference, false});
    scene.Layout(1920.0, 1080.0);
    return scene;
}

// Runs the scene's motion to completion, one 60 Hz frame at a time, from
// `nowMs`. Returns the time it stopped at.
double Settle(Scene& scene, double nowMs) {
    for (int frame = 0; frame < 2000 && scene.Animating(); ++frame) {
        nowMs += 16.0;
        scene.Tick(nowMs);
    }
    return nowMs;
}

// The card keys a reader would see on the first rail.
std::string Key(std::size_t rail, std::size_t index) {
    return "card:" + std::to_string(rail) + ":" + std::to_string(index);
}

// ---------------------------------------------------------------- layout

TEST(layout_follows_the_design_tokens_at_1080p) {
    Scene scene = MakeScene(SmallRails());
    // rem = 16px. Safe area 40px by 24px. A rail inset of 16px. Cards 168px
    // wide with 16px between them. Heading 28px tall, 16px to its rail.
    REQUIRE_NEAR(scene.metrics().rem, 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).x, 40.0 + 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).width, 168.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 1).x - scene.CardBox(0, 0).x, 168.0 + 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).y, 24.0 + 28.0 + 16.0, 1e-9);
    // 252px poster, 12px gap, 28px label.
    REQUIRE_NEAR(scene.CardBox(0, 0).height, 252.0 + 12.0 + 28.0, 1e-9);
    // Second section starts after the first section and 32px of section spacing.
    REQUIRE_NEAR(scene.CardBox(1, 0).y - scene.CardBox(0, 0).y, (28.0 + 16.0 + 292.0) + 32.0, 1e-9);
}

TEST(metrics_scale_with_the_window_height) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1280.0, 720.0);
    REQUIRE_NEAR(scene.metrics().rem, 720.0 / 67.5, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).width, 10.5 * 720.0 / 67.5, 1e-9);
}

TEST(an_empty_scene_lays_out_while_the_catalogue_loads) {
    // Home starts with no rails. The catalogue fills them in once it arrives.
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    REQUIRE(!scene.FocusedKey().has_value());
    REQUIRE_EQ(scene.RailCount(), std::size_t{0});
    REQUIRE(!scene.Navigate(Direction::Right, 0.0));
}

TEST(set_rails_replaces_the_placeholders_and_focuses_the_first_card) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    REQUIRE(scene.Navigate(Direction::Right, 0.0));

    std::vector<tvm::ui::RailData> rails(1);
    rails[0].id = "films";
    rails[0].title = "Popular films";
    for (int i = 0; i < 3; ++i) {
        tvm::ui::CardData card;
        card.itemId = "tt" + std::to_string(i);
        card.title = "Film " + std::to_string(i);
        rails[0].cards.push_back(card);
    }
    scene.SetRails(rails);
    REQUIRE_EQ(scene.RailCount(), std::size_t{1});
    REQUIRE_EQ(scene.CardCount(0), std::size_t{3});
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));
    REQUIRE_NEAR(scene.CardFocus(0, 0), 1.0, 1e-12);
}

TEST(select_opens_the_catalogue_id_of_the_focused_title) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    std::vector<tvm::ui::RailData> rails(1);
    rails[0].title = "Films";
    tvm::ui::CardData card;
    card.itemId = "tt0111161";
    card.title = "The Shawshank Redemption";
    rails[0].cards.push_back(card);
    scene.SetRails(rails);

    const auto command = scene.Select(0.0);
    REQUIRE(command.has_value());
    REQUIRE_EQ(command->params.at("id"), std::string("tt0111161"));
    REQUIRE_EQ(command->params.at("title"), std::string("The Shawshank Redemption"));
}

// ------------------------------------------------------------- navigation

TEST(focus_starts_on_the_first_card) {
    Scene scene = MakeScene(SmallRails());
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));
    REQUIRE_NEAR(scene.CardFocus(0, 0), 1.0, 1e-12);
    REQUIRE_NEAR(scene.CardFocus(0, 1), 0.0, 1e-12);
}

TEST(right_and_left_wrap_along_a_rail) {
    Scene scene = MakeScene(SmallRails());
    REQUIRE(scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 1)));
    REQUIRE(scene.Navigate(Direction::Left, 0.0));
    REQUIRE(scene.Navigate(Direction::Left, 0.0));  // 0 -> 4, wrapping at the start
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 4)));
    REQUIRE(scene.Navigate(Direction::Right, 0.0));  // 4 -> 0, wrapping at the end
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));
}

TEST(down_moves_to_the_closest_card_in_the_next_rail) {
    Scene scene = MakeScene(SmallRails());
    for (int i = 0; i < 2; ++i) REQUIRE(scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(1, 2)));
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 2)));
}

TEST(up_from_the_top_rail_reaches_the_settings_button_and_down_returns) {
    Scene scene = MakeScene(SmallRails());
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("settings"));
    // The button sits at the top right, so the nearest card is the last one on the rail.
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 4)));
}

TEST(focus_fades_between_cards_on_the_timeline) {
    Scene scene = MakeScene(SmallRails());
    REQUIRE(scene.Navigate(Direction::Right, 0.0));

    // A 200ms base token, as `.poster__art` uses: halfway through, the eased value is 0.9614 on the way in.
    scene.Tick(100.0);
    REQUIRE_NEAR(scene.CardFocus(0, 0), 1.0 - 0.9613825478, 1e-4);
    REQUIRE_NEAR(scene.CardFocus(0, 1), 0.9613825478, 1e-4);

    scene.Tick(300.0);
    REQUIRE_NEAR(scene.CardFocus(0, 0), 0.0, 1e-12);
    REQUIRE_NEAR(scene.CardFocus(0, 1), 1.0, 1e-12);
    REQUIRE(!scene.Animating());
}

TEST(a_rail_camera_centres_the_focused_card) {
    // Rail 3 has 12 cards, so it scrolls. Card 6 centres at
    // 16 + 6*184 - (1840 - 168)/2 = 284px.
    Scene scene = MakeScene({{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}});
    double now = 0.0;
    for (int i = 0; i < 6; ++i) {
        // Reach rail 3 by moving down, then right along it.
        if (i == 0) {
            for (int r = 0; r < 3; ++r) REQUIRE(scene.Navigate(Direction::Down, now));
        }
        REQUIRE(scene.Navigate(Direction::Right, now));
        now = Settle(scene, now);
    }
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(3, 6)));
    REQUIRE_NEAR(scene.RailScroll(3), 284.0, 1e-6);
}

TEST(the_page_scrolls_to_show_a_lower_rail_but_not_past_the_end) {
    // Four rails: sections are 336px tall (28 heading, 16 gap, 292 rail), with
    // 32px between them. The page is 1440px of content in a 1080px window, so
    // it can scroll by 1440 + 2 * 24 - 1080 = 408px.
    Scene scene = MakeScene({{"A", 5}, {"B", 5}, {"C", 5}, {"D", 5}});
    double now = 0.0;
    for (int r = 0; r < 3; ++r) {
        REQUIRE(scene.Navigate(Direction::Down, now));
        now = Settle(scene, now);
    }
    REQUIRE_NEAR(scene.PageScroll(), 408.0, 1e-6);
    // The lower rail's top: 24 + 3 * 368 + 44 - 408 = 764px, inside the 1080px window.
    REQUIRE_NEAR(scene.CardBox(3, 0).y, 764.0, 1e-6);
}

TEST(reduced_motion_lands_the_camera_and_focus_at_once) {
    Scene scene = MakeScene({{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}}, MotionPreference::Reduced);
    double now = 0.0;
    for (int r = 0; r < 3; ++r) REQUIRE(scene.Navigate(Direction::Down, now));
    for (int i = 0; i < 6; ++i) REQUIRE(scene.Navigate(Direction::Right, now));
    now = Settle(scene, now);
    REQUIRE_NEAR(scene.RailScroll(3), 284.0, 1e-6);
    REQUIRE_NEAR(scene.CardFocus(3, 6), 1.0, 1e-12);
    REQUIRE(!scene.Animating());
}

// --------------------------------------------------------------- painting

TEST(only_the_focused_card_draws_a_ring) {
    Scene scene = MakeScene(SmallRails());
    RecordingPainter painter;
    scene.Paint(painter);

    // The poster's outline is 0.16rem = 2.56px wide. Poster borders are hairlines.
    int rings = 0;
    for (const auto& stroke : painter.strokes) {
        if (std::abs(stroke.width - 2.56) < 1e-6) ++rings;
    }
    REQUIRE_EQ(rings, 1);
    REQUIRE_EQ(painter.clipDepth, 0);
    REQUIRE(!painter.clears.empty());
}

TEST(every_title_is_painted) {
    Scene scene = MakeScene(SmallRails());
    RecordingPainter painter;
    scene.Paint(painter);

    int titles = 0;
    for (const std::string& text : painter.texts) {
        if (text.rfind("Title ", 0) == 0) ++titles;
    }
    REQUIRE_EQ(titles, 10);
    REQUIRE(std::find(painter.texts.begin(), painter.texts.end(), std::string("First")) != painter.texts.end());
}

TEST(the_focused_poster_is_drawn_at_the_focus_scale) {
    Scene scene = MakeScene(SmallRails());
    RecordingPainter painter;
    scene.Paint(painter);

    // Posters are filled in paint order: card 0 of rail 0 first, then card 1.
    REQUIRE(painter.fills.size() >= 2);
    REQUIRE_NEAR(painter.fills[0].width, 168.0 * 1.015, 1e-6);  // Focused.
    REQUIRE_NEAR(painter.fills[1].width, 168.0, 1e-6);         // Not focused.
}

}  // namespace
