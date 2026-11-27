// UI tests: the widget tree's layout against the design tokens, the scene's
// navigation and focus, its cameras and focus fades, and what it paints. The
// scene is drawn into a recording painter, so no window is needed.

#include <algorithm>
#include <cstdio>
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
    // wide with 16px between them. Heading 33.6px tall (1.5rem * 1.4), then 31.6px to its rail: the gap takes a hovered
    // poster's rise (its grow, lift and ring), so the card never covers the heading.
    REQUIRE_NEAR(scene.metrics().rem, 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).x, 40.0 + 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).width, 168.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 1).x - scene.CardBox(0, 0).x, 168.0 + 16.0, 1e-9);
    REQUIRE_NEAR(scene.CardBox(0, 0).y, 24.0 + 33.6 + 31.6, 1e-6);
    // 252px poster, 12px gap, 28px label.
    REQUIRE_NEAR(scene.CardBox(0, 0).height, 252.0 + 12.0 + 28.0, 1e-9);
    // Second section starts after the first section and 32px of section spacing.
    REQUIRE_NEAR(scene.CardBox(1, 0).y - scene.CardBox(0, 0).y, (33.6 + 31.6 + 292.0) + 32.0, 1e-6);
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
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));
    // Left at index 0 wraps seamlessly to the last card (index 4).
    REQUIRE(scene.Navigate(Direction::Left, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 4)));
    // Right at index 4 wraps seamlessly back to the first card (index 0).
    REQUIRE(scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(0, 0)));

    // Wrapping on a scrolling rail smoothly scrolls the camera to the wrapped end and back.
    Scene scrolling = MakeScene({{"Long", 12}});
    double now = 0.0;
    REQUIRE(scrolling.Navigate(Direction::Left, now));
    REQUIRE(scrolling.FocusedKey() == std::optional<std::string>(Key(0, 11)));
    Settle(scrolling, now);
    REQUIRE(scrolling.RailScroll(0) > 0.0);
    now += 100.0;
    REQUIRE(scrolling.Navigate(Direction::Right, now));
    REQUIRE(scrolling.FocusedKey() == std::optional<std::string>(Key(0, 0)));
    Settle(scrolling, now);
    REQUIRE_NEAR(scrolling.RailScroll(0), 0.0, 1e-6);
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
    // Four rails: sections are 345.6px tall (33.6 heading, 20 gap, 292 rail), with
    // 32px between them. The page is 1478.4px of content in a 1080px window, so
    // it can scroll by 1478.4 + 2 * 24 - 1080 = 446.4px.
    Scene scene = MakeScene({{"A", 5}, {"B", 5}, {"C", 5}, {"D", 5}});
    double now = 0.0;
    for (int r = 0; r < 3; ++r) {
        REQUIRE(scene.Navigate(Direction::Down, now));
        now = Settle(scene, now);
    }
    REQUIRE_NEAR(scene.PageScroll(), 492.8, 1e-6);
    // The lower rail's top: 24 + 3 * 389.2 + 65.2 - 492.8 = 764px, inside the 1080px window (each section is 11.6px
    // taller now that the heading gap takes a hovered poster's rise).
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

    // The poster's outline is 0.125rem = 2.0px wide. Poster borders are hairlines.
    int rings = 0;
    for (const auto& stroke : painter.strokes) {
        if (std::abs(stroke.width - 2.0) < 1e-6) ++rings;
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

    // Unfocused posters are filled first and the focused card is painted last so its scale and ring sit on top.
    REQUIRE(painter.fills.size() >= 2);
    REQUIRE_NEAR(painter.fills.front().width, 168.0, 1.0);
    bool focusedSized = false;
    for (const Box& fill : painter.fills)
        if (std::abs(fill.width - 168.0 * tvm::ui::kPosterFocusScale) <= 1.0) focusedSized = true;
    REQUIRE(focusedSized);
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
        tvm::ui::TopButton{"Series", command, lane == 2},   tvm::ui::TopButton{"Live TV", command, lane == 3},
        tvm::ui::TopButton{"Library", command, lane == 4},  tvm::ui::TopButton{"Search", command, lane == 5},
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


TEST(hover_look_eases_away_when_the_pointer_leaves_and_returns_on_a_key) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(StreamView(0), 0.0);
    scene.FocusItem("top:1", 0.0, false);
    scene.Tick(400.0);
    REQUIRE_NEAR(scene.EmphasisOf("top:1"), 1.0, 1e-6);

    // The pointer moves onto empty space: the tab keeps the focus for the remote, but stops looking hovered.
    scene.PointerLeft(400.0);
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("top:1"));
    REQUIRE(!scene.FocusShown());
    scene.Tick(450.0);
    const double easing = scene.EmphasisOf("top:1");
    REQUIRE(easing > 0.0);
    REQUIRE(easing < 1.0);
    scene.Tick(1000.0);
    REQUIRE_NEAR(scene.EmphasisOf("top:1"), 0.0, 1e-6);
    REQUIRE(scene.SweepOf("top:1") < 0.0);

    // A key brings it back.
    scene.ShowFocus(1000.0);
    scene.Tick(1400.0);
    REQUIRE_NEAR(scene.EmphasisOf("top:1"), 1.0, 1e-6);
}

TEST(a_card_unfocuses_its_look_when_the_pointer_leaves) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.Tick(1000.0);
    REQUIRE_NEAR(scene.CardFocus(0, 0), 1.0, 1e-6);
    scene.PointerLeft(1000.0);
    scene.Tick(2000.0);
    REQUIRE_NEAR(scene.CardFocus(0, 0), 0.0, 1e-6);
    scene.ShowFocus(2000.0);
    scene.Tick(3000.0);
    REQUIRE_NEAR(scene.CardFocus(0, 0), 1.0, 1e-6);
}

TEST(a_page_under_the_stream_chrome_keeps_the_chrome_and_adds_its_own_row) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    tvm::ui::SceneView view = StreamView(4);  // Library on
    view.heading = "Library";
    tvm::ui::Command filter;
    filter.name = "watchlist-filter";
    filter.action = true;
    view.pageButtons = {tvm::ui::TopButton{"All titles", filter, true}, tvm::ui::TopButton{"Movies", filter, false}};
    tvm::ui::RailData saved;
    saved.id = "saved-0";
    saved.cards = {tvm::ui::CardData{"tt1", "One", "", std::nullopt}, tvm::ui::CardData{"tt2", "Two", "", std::nullopt}};
    view.rails = {saved};
    scene.SetHeroes({}, 0.0);
    scene.SetView(view, 0.0);

    // The chrome is still painted, with Library selected.
    GlassOnlyPainter painter;
    scene.Paint(painter);
    REQUIRE(painter.Capsule().has_value());
    int tabs = 0;
    for (const auto& call : painter.calls) {
        if (call.style.kind == tvm::ui::GlassKind::Tab && call.style.activeTab) ++tabs;
    }
    REQUIRE_EQ(tabs, 1);

    // Down from the Library tab reaches the page's first button; Up returns to the chrome.
    REQUIRE(scene.FocusItem("top:4", 0.0, false));
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    // The nearest button of the row under the tab.
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("page:1"));
    REQUIRE(scene.Navigate(Direction::Left, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("page:0"));
    REQUIRE(scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("page:1"));
    const auto command = scene.Select(0.0);
    REQUIRE(command.has_value());
    REQUIRE_EQ(command->name, std::string("watchlist-filter"));
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE(scene.FocusedKey().has_value());
    // The first tab keeps Home's historical key, "settings"; the others are "top:N".
    REQUIRE(*scene.FocusedKey() == "settings" || scene.FocusedKey()->rfind("top:", 0) == 0);

    // The rails start below the header, and a card is reached going down.
    REQUIRE(scene.FocusItem("page:0", 0.0, false));
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("card:0:0"));
    REQUIRE(scene.CardBox(0, 0).y > scene.metrics().Rem(9.0));
}

TEST(the_search_lane_field_is_a_focusable_item_and_not_focused_on_entry) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    tvm::ui::SceneView view = StreamView(5);
    view.heading = "Search";
    view.searchField = true;
    scene.SetHeroes({}, 0.0);
    scene.SetView(view, 0.0);
    REQUIRE(scene.FocusItem("top:5", 0.0, false));
    // Opening Search leaves the focus where it was; the field takes it only when chosen.
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("top:5"));
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey() == std::optional<std::string>("search-field"));
    // Reaching the field does not put the caret in it; OK does, and OK again searches.
    REQUIRE(!scene.SearchEditing());
    REQUIRE(!scene.Select(0.0).has_value());
    REQUIRE(scene.SearchEditing());
    const auto command = scene.Select(0.0);
    REQUIRE(command.has_value());
    REQUIRE_EQ(command->name, std::string("search-submit"));
    // Moving off it with the keys takes the caret out.
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE(!scene.SearchEditing());
}

TEST(the_search_field_takes_typing_only_after_a_click_and_keeps_it_while_the_pointer_moves) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    tvm::ui::SceneView view = StreamView(5);
    view.searchField = true;
    scene.SetHeroes({}, 0.0);
    scene.SetView(view, 0.0);
    // Hover alone focuses the field but gives it no caret.
    REQUIRE(scene.FocusItem("search-field", 0.0, false));
    REQUIRE(!scene.SearchEditing());
    // A click does.
    REQUIRE(!scene.ActivateItem("search-field", 10.0).has_value());
    REQUIRE(scene.SearchEditing());
    // The pointer drifting onto something else does not take it away.
    scene.PointerLeft(20.0);
    REQUIRE(scene.SearchEditing());
    // A press on the field or its clear mark keeps it; a press anywhere else ends it.
    scene.PressedElsewhere(std::string("search-field"), 30.0);
    REQUIRE(scene.SearchEditing());
    scene.PressedElsewhere(std::nullopt, 40.0);
    REQUIRE(!scene.SearchEditing());
}

// ---------------------------------------------------------------- rebuilds keep the viewer's place

tvm::ui::SceneView ManyRails(const std::string& pageKey) {
    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    view.pageKey = pageKey;
    for (int r = 0; r < 6; ++r) {
        tvm::ui::RailData rail;
        rail.id = "rail-" + std::to_string(r);
        rail.title = "Rail " + std::to_string(r);
        for (int i = 0; i < 16; ++i) {
            tvm::ui::CardData card;
            card.itemId = "tt" + std::to_string(r * 100 + i);
            card.title = "Title " + std::to_string(i);
            rail.cards.push_back(card);
        }
        view.rails.push_back(rail);
    }
    return view;
}

TEST(a_rebuild_of_the_same_page_keeps_its_scroll_rails_and_focus_without_moving) {
    Scene scene = MakeScene({});
    scene.SetView(ManyRails("home:all"), 0.0);
    // The viewer scrolls the page down, slides rail 3 along, and hovers a card in it.
    tvm::ui::ScrollSurface page;
    page.kind = tvm::ui::ScrollSurface::Kind::Page;
    scene.SetScroll(page, 500.0, 0.0);
    tvm::ui::ScrollSurface rail;
    rail.kind = tvm::ui::ScrollSurface::Kind::Rail;
    rail.index = 3;
    scene.SetScroll(rail, 640.0, 0.0);
    REQUIRE(scene.FocusItem(Key(3, 5), 0.0, false));
    const double pageWas = scene.PageScroll();
    const double railWas = scene.RailScroll(3);

    // The catalogue or the account refreshes: the same page is built again.
    scene.SetView(ManyRails("home:all"), 100.0);
    REQUIRE_NEAR(scene.PageScroll(), pageWas, 1e-6);
    REQUIRE_NEAR(scene.RailScroll(3), railWas, 1e-6);
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(3, 5)));
    Settle(scene, 100.0);
    REQUIRE_NEAR(scene.PageScroll(), pageWas, 1e-6);
    REQUIRE_NEAR(scene.RailScroll(3), railWas, 1e-6);
}

TEST(a_different_page_starts_at_the_top) {
    Scene scene = MakeScene({});
    scene.SetView(ManyRails("home:all"), 0.0);
    tvm::ui::ScrollSurface page;
    page.kind = tvm::ui::ScrollSurface::Kind::Page;
    scene.SetScroll(page, 500.0, 0.0);
    scene.SetView(ManyRails("home:movies"), 100.0);
    Settle(scene, 100.0);
    REQUIRE_NEAR(scene.RailScroll(3), 0.0, 1e-6);
}

TEST(a_title_in_two_rails_keeps_the_focus_in_the_rail_it_was_in) {
    Scene scene = MakeScene({});
    tvm::ui::SceneView view = ManyRails("home:all");
    // The same title is in rail 0 and rail 4.
    view.rails[4].cards[2].itemId = view.rails[0].cards[2].itemId;
    scene.SetView(view, 0.0);
    REQUIRE(scene.FocusItem(Key(4, 2), 0.0, false));
    scene.SetView(view, 100.0);
    REQUIRE(scene.FocusedKey() == std::optional<std::string>(Key(4, 2)));
}


// ---------------------------------------------------------------- search, as a television search page

tvm::ui::SceneView SearchResults(const std::string& filter) {
    tvm::ui::SceneView view = StreamView(5);
    view.searchField = true;
    view.query = "light";
    for (const auto& [kind, label] : std::vector<std::pair<std::string, std::string>>{
             {"all", "All"}, {"movies", "Movies"}, {"series", "Series"}}) {
        tvm::ui::Command command;
        command.name = "search-filter";
        command.action = true;
        command.params["kind"] = kind;
        tvm::ui::TopButton tab{label, command, filter == kind};
        tab.segment = true;
        view.pageButtons.push_back(tab);
    }
    tvm::ui::RailData top;
    top.id = "search-top";
    top.title = "Top Result";
    tvm::ui::CardData feature;
    feature.itemId = "tt1";
    feature.title = "Light";
    feature.feature = true;
    feature.subtitle = "Movie \xC2\xB7 2024";
    top.cards = {feature};
    tvm::ui::RailData movies;
    movies.id = "movies-0";
    movies.title = "Movies \xC2\xB7 4";
    for (int i = 0; i < 4; ++i) {
        tvm::ui::CardData card;
        card.itemId = "tt" + std::to_string(10 + i);
        card.title = "Film " + std::to_string(i);
        movies.cards.push_back(card);
    }
    view.rails = {top, movies};
    return view;
}

TEST(search_browse_tiles_are_large_and_open_their_genre) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetHeroes({}, 0.0);
    tvm::ui::SceneView view = StreamView(5);
    view.searchField = true;
    tvm::ui::RailData browse;
    browse.id = "search-browse-0";
    browse.title = "Browse";
    for (const char* genre : {"Action", "Comedy", "Drama"}) {
        tvm::ui::CardData tile;
        tile.itemId = std::string("browse:") + genre;
        tile.title = genre;
        tile.category = true;
        browse.cards.push_back(tile);
    }
    view.rails = {browse};
    scene.SetView(view, 0.0);
    // The tiles are tall and larger than posters (15.5rem by 23rem at 1080p).
    REQUIRE_NEAR(scene.CardBox(0, 0).width, 15.5 * 16.0, 1.0);
    REQUIRE(scene.CardBox(0, 0).height >= 23.0 * 16.0 - 1.0);
    // OK on a tile asks the app for that genre, rather than opening a title.
    REQUIRE(scene.FocusItem("card:0:1", 0.0, false));
    const std::optional<tvm::ui::Command> open = scene.Select(0.0);
    REQUIRE(open.has_value());
    REQUIRE_EQ(open->name, std::string("search-browse"));
    REQUIRE_EQ(open->params.at("genre"), std::string("Comedy"));
}

TEST(search_top_result_is_a_large_card_and_the_grid_has_more_room) {
    Scene scene(SmallRails(), MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetHeroes({}, 0.0);
    scene.SetView(SearchResults("all"), 0.0);
    // The Top Result card is far wider than a poster; posters keep their size.
    REQUIRE(scene.CardBox(0, 0).width > 400.0);
    REQUIRE_NEAR(scene.CardBox(1, 0).width, 168.0, 1.0);
    // Posters in Search sit further apart than on the browse rails (1.6rem rather than 1rem).
    REQUIRE_NEAR(scene.CardBox(1, 1).x - scene.CardBox(1, 0).Right(), 1.6 * 16.0, 1.0);
}

}  // namespace
