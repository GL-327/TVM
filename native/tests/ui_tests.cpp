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
    REQUIRE(!scene.Navigate(Direction::Left, 0.0));  // Hard stop at rail start (no wrapping)
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));
    for (int i = 0; i < 4; ++i) REQUIRE(scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 4)));
    REQUIRE(!scene.Navigate(Direction::Right, 0.0));  // Hard stop at rail end (no wrapping)
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 4)));
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

    // A 150ms fast focus token: halfway through (75ms), the eased value is 0.9614 on the way in.
    scene.Tick(75.0);
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
    REQUIRE_NEAR(painter.fills[0].width, 168.0 * 1.04, 1e-6);  // Focused.
    REQUIRE_NEAR(painter.fills[1].width, 168.0, 1e-6);         // Not focused.
}

TEST(optical_glass_material_is_applied_to_cards_hero_pills_and_nav_capsule) {
    class GlassRecordingPainter final : public tvm::ui::Painter {
    public:
        struct GlassCall {
            Box box;
            double radius;
            tvm::ui::GlassStyle style;
        };
        void Clear(Color) override {}
        void FillRoundRect(const Box&, double, Color) override {}
        void StrokeRoundRect(const Box&, double, double, Color) override {}
        void Text(const Box&, std::string_view, const tvm::ui::TextStyle&, Color) override {}
        bool Image(const Box&, const std::string&, double) override { return false; }
        void Paragraph(const Box&, std::string_view, const tvm::ui::TextStyle&, Color) override {}
        void PushClip(const Box&) override {}
        void PopClip() override {}
        void SetBackdrop(const Box& box, const std::string& url, double, double) override {
            backdropBox = box;
            backdropUrl = url;
        }
        void Glass(const Box& box, double radius, const tvm::ui::GlassStyle& style) override {
            calls.push_back(GlassCall{box, radius, style});
        }
        Box backdropBox{};
        std::string backdropUrl;
        std::vector<GlassCall> calls;
    };

    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    tvm::ui::HeroData hero;
    hero.itemId = "featured-1";
    hero.title = "The Last Light";
    hero.meta = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
    hero.backdropUrl = "asset:lighthouse.jpg";
    scene.SetHeroes({hero}, 0.0);

    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    tvm::ui::Command cmd;
    cmd.name = "stream-home";
    view.topButtons = {
        tvm::ui::TopButton{"Home", cmd, true},
        tvm::ui::TopButton{"Movies", cmd, false},
        tvm::ui::TopButton{"Profile", cmd, false, false, true},
    };
    tvm::ui::RailData cw;
    cw.id = "continue-watching";
    cw.title = "Continue Watching";
    cw.cards = {
        tvm::ui::CardData{"cw-1", "The Last Light", "asset:lighthouse.jpg", 0.42},
        tvm::ui::CardData{"cw-2", "Northward", "", 0.72},
    };
    view.rails = {cw};
    scene.SetView(view, 0.0);

    GlassRecordingPainter painter;
    scene.Paint(painter);

    REQUIRE_EQ(painter.backdropUrl, std::string("asset:lighthouse.jpg"));
    REQUIRE(painter.calls.size() >= 6);
    int pills = 0, tabs = 0, orbs = 0, cards = 0;
    for (const auto& call : painter.calls) {
        if (call.style.kind == tvm::ui::GlassKind::Pill) ++pills;
        if (call.style.kind == tvm::ui::GlassKind::Tab) ++tabs;
        if (call.style.kind == tvm::ui::GlassKind::Orb) ++orbs;
        if (call.style.kind == tvm::ui::GlassKind::Card) ++cards;
    }
    REQUIRE(pills >= 3);  // Play pill, Details pill, nav capsule pill
    REQUIRE_EQ(tabs, 1);  // Active Home tab
    REQUIRE_EQ(orbs, 1);  // Profile orb
    REQUIRE_EQ(cards, 2); // 2 Continue Watching cards
}


// Records glass surfaces with their styles, and nothing else.
class GlassOnlyPainter final : public tvm::ui::Painter {
public:
    struct Call {
        Box box;
        tvm::ui::GlassStyle style;
    };
    void Clear(Color) override {}
    void FillRoundRect(const Box&, double, Color) override {}
    void StrokeRoundRect(const Box&, double, double, Color) override {}
    void Text(const Box&, std::string_view, const tvm::ui::TextStyle&, Color) override {}
    bool Image(const Box&, const std::string&, double) override { return false; }
    void Paragraph(const Box&, std::string_view, const tvm::ui::TextStyle&, Color) override {}
    void PushClip(const Box&) override {}
    void PopClip() override {}
    void Glass(const Box& box, double, const tvm::ui::GlassStyle& style) override { calls.push_back(Call{box, style}); }
    // The nav capsule: the widest pill in the chrome band.
    std::optional<Call> Capsule() const {
        std::optional<Call> widest;
        for (const Call& call : calls) {
            if (call.style.kind != tvm::ui::GlassKind::Pill || call.box.y > 120.0) continue;
            if (!widest.has_value() || call.box.width > widest->box.width) widest = call;
        }
        return widest;
    }
    std::vector<Call> calls;
};

// TVM Stream's chrome with `lane` selected: 0 Home, 1 Movies, 2 Series.
tvm::ui::SceneView StreamView(int lane) {
    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    tvm::ui::Command command;
    command.name = "stream-lane";
    command.action = true;
    view.topButtons = {
        tvm::ui::TopButton{"Home", command, lane == 0},     tvm::ui::TopButton{"Movies", command, lane == 1},
        tvm::ui::TopButton{"Series", command, lane == 2},   tvm::ui::TopButton{"Live TV", command, false},
        tvm::ui::TopButton{"Library", command, false},      tvm::ui::TopButton{"Search", command, false},
        tvm::ui::TopButton{"Profile", command, false, false, true},
    };
    return view;
}

TEST(selected_tab_glass_slides_to_the_new_tab_without_delaying_the_page) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.Tick(1000.0);
    const Box home = *scene.TabIndicatorBox();

    scene.SetView(StreamView(2), 1000.0);
    REQUIRE(scene.Animating());
    // Straight after the switch the glass is still on Home; the page underneath has already changed.
    REQUIRE_NEAR(scene.TabIndicatorBox()->CenterX(), home.CenterX(), 1e-6);

    scene.Tick(1150.0);
    const Box midway = *scene.TabIndicatorBox();
    scene.Tick(2000.0);
    const Box series = *scene.TabIndicatorBox();
    REQUIRE(series.CenterX() > home.CenterX());
    REQUIRE(midway.CenterX() > home.CenterX());
    REQUIRE(midway.CenterX() < series.CenterX());
    // It stretches a little while it travels, then settles to the tab's own width.
    REQUIRE(midway.width > std::min(home.width, series.width));
    REQUIRE(!scene.Animating());
}

TEST(selected_tab_glass_jumps_under_reduced_motion) {
    Scene scene(SmallRails(), MotionSettings{MotionPreference::Reduced, false});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.Tick(10.0);
    scene.SetView(StreamView(1), 10.0);
    const Box now = *scene.TabIndicatorBox();
    scene.Tick(2000.0);
    REQUIRE_NEAR(scene.TabIndicatorBox()->CenterX(), now.CenterX(), 1e-6);
}

TEST(chrome_entrance_plays_once_and_not_on_tab_switches) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.PlayChromeEntrance();
    scene.Tick(0.0);

    GlassOnlyPainter first;
    scene.Paint(first);  // The entrance starts with the first frame that shows the chrome.
    REQUIRE(scene.Animating());
    REQUIRE(!first.Capsule().has_value() || first.Capsule()->style.opacity < 0.05);

    scene.Tick(170.0);
    GlassOnlyPainter partway;
    scene.Paint(partway);
    REQUIRE(partway.Capsule().has_value());
    REQUIRE(partway.Capsule()->style.opacity > 0.05);
    REQUIRE(partway.Capsule()->style.opacity < 1.0);

    scene.Tick(1500.0);
    REQUIRE(!scene.Animating());
    scene.SetView(StreamView(1), 1500.0);
    scene.Tick(1501.0);
    GlassOnlyPainter after;
    scene.Paint(after);
    REQUIRE_NEAR(after.Capsule()->style.opacity, 1.0, 1e-9);
}

TEST(scene_without_an_entrance_draws_the_chrome_at_once) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    GlassOnlyPainter painter;
    scene.Paint(painter);
    REQUIRE_NEAR(painter.Capsule()->style.opacity, 1.0, 1e-9);
}

TEST(hover_and_press_ease_in_and_out) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.FocusItem("top:1", 0.0, false);
    REQUIRE(scene.EmphasisOf("top:1") < 0.5);
    scene.Tick(400.0);
    REQUIRE_NEAR(scene.EmphasisOf("top:1"), 1.0, 1e-6);

    scene.SetPressed(std::string("top:1"), 400.0);
    scene.Tick(500.0);
    REQUIRE_NEAR(scene.PressOf("top:1"), 1.0, 1e-6);
    REQUIRE_NEAR(scene.PressOf("top:2"), 0.0, 1e-9);
    scene.SetPressed(std::nullopt, 500.0);
    scene.Tick(560.0);
    REQUIRE(scene.PressOf("top:1") > 0.0);
    scene.Tick(1000.0);
    REQUIRE_NEAR(scene.PressOf("top:1"), 0.0, 1e-6);

    scene.FocusItem("top:2", 1000.0, false);
    scene.Tick(1050.0);
    REQUIRE(scene.EmphasisOf("top:1") > 0.0);
    REQUIRE(scene.EmphasisOf("top:1") < 1.0);
    scene.Tick(1600.0);
    REQUIRE_NEAR(scene.EmphasisOf("top:1"), 0.0, 1e-6);
    // The focus highlight is still crossing the newly focused tab.
    REQUIRE(scene.Animating());
    scene.Tick(2200.0);
    REQUIRE(!scene.Animating());
}

TEST(focus_highlight_sweeps_once_across_a_newly_focused_button) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.Tick(10.0);
    scene.FocusItem("top:1", 10.0, false);
    scene.Tick(50.0);
    REQUIRE(scene.SweepOf("top:1") < 0.0);  // Waits for the plate to brighten first.
    scene.Tick(400.0);
    const double early = scene.SweepOf("top:1");
    scene.Tick(800.0);
    const double later = scene.SweepOf("top:1");
    REQUIRE(early > 0.0);
    REQUIRE(later > early);
    REQUIRE(later < 1.0);
    REQUIRE(scene.SweepOf("top:2") < 0.0);
    scene.Tick(1200.0);
    REQUIRE(scene.SweepOf("top:1") < 0.0);  // Once, not looping.
}

TEST(focus_highlight_does_not_sweep_under_reduced_motion) {
    Scene scene(SmallRails(), MotionSettings{MotionPreference::Reduced, false});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.FocusItem("top:1", 0.0, false);
    scene.Tick(400.0);
    REQUIRE(scene.SweepOf("top:1") < 0.0);
}

}  // namespace
