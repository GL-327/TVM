// Home hero tests: the stage at the top of Home, its art crossfade and title dissolve, how it fades
// with the page, its two buttons, and how they move the focus. The values follow `.stage` in
// apps/ui/src/app.css, HeroArt.css and heroFade.ts, at 1080p where a rem is 16 px.

#include <cmath>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "ui/scene.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::nav::Axis;
using tvm::nav::Direction;
using tvm::ui::Box;
using tvm::ui::CardData;
using tvm::ui::Color;
using tvm::ui::HeroData;
using tvm::ui::RailData;
using tvm::ui::Scene;

MotionSettings Auto() {
    return MotionSettings{};
}

// Records each text and each picture, in order, with the opacity a picture was drawn at.
class HeroPainter final : public tvm::ui::Painter {
public:
    struct TextDraw {
        std::string text;
        Color color;
        Box box;
    };
    struct PictureDraw {
        std::string url;
        double opacity = 0.0;
        double focusX = 0.0;
        double focusY = 0.0;
    };

    void Clear(Color /*color*/) override {}
    void FillRoundRect(const Box& /*box*/, double /*radius*/, Color /*color*/) override {}
    void StrokeRoundRect(const Box& /*box*/, double /*radius*/, double /*width*/, Color /*color*/) override {}
    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    bool ImageFaded(const Box& /*box*/, const std::string& url, double /*radius*/, double opacity, double focusX,
                    double focusY) override {
        pictures.push_back(PictureDraw{url, opacity, focusX, focusY});
        return true;
    }
    void Paragraph(const Box& /*box*/, std::string_view /*text*/, const tvm::ui::TextStyle& /*style*/,
                   Color /*color*/) override {}
    void Text(const Box& box, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color color) override {
        texts.push_back(TextDraw{std::string(text), color, box});
    }
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}

    const TextDraw* Find(const std::string& text) const {
        for (const TextDraw& draw : texts) {
            if (draw.text == text) return &draw;
        }
        return nullptr;
    }

    // The last draw of a text. A focused watch text is drawn first as a glow, and then as itself.
    const TextDraw* FindLast(const std::string& text) const {
        for (auto draw = texts.rbegin(); draw != texts.rend(); ++draw) {
            if (draw->text == text) return &*draw;
        }
        return nullptr;
    }

    std::vector<TextDraw> texts;
    std::vector<PictureDraw> pictures;
};

HeroData Hero(const std::string& id, const std::string& title, const std::string& backdrop) {
    HeroData hero;
    hero.itemId = id;
    hero.title = title;
    hero.backdropUrl = backdrop;
    hero.hue = 210;
    return hero;
}

RailData Rail(const std::string& id, std::size_t count) {
    RailData rail;
    rail.id = id;
    rail.title = id;
    for (std::size_t i = 0; i < count; ++i) {
        CardData card;
        card.itemId = id + "-" + std::to_string(i);
        card.title = "Card " + std::to_string(i);
        rail.cards.push_back(card);
    }
    return rail;
}

// A Home with a hero of the titles given, and four rails, so the page can scroll.
Scene HomeWith(const std::vector<HeroData>& heroes, double nowMs = 0.0) {
    Scene scene({}, Auto());
    scene.Layout(1920.0, 1080.0);
    scene.SetHeroes(heroes, nowMs);
    scene.SetRails({Rail("a", 3), Rail("b", 3), Rail("c", 3), Rail("d", 3)});
    return scene;
}

// ------------------------------------------------------------------- the stage

TEST(hero_takes_the_top_48_percent_and_the_rails_start_below_it) {
    Scene scene = HomeWith({Hero("a", "Alpha", "https://img.example/a.jpg")});
    const double heroBottom = 0.48 * 1080.0;
    REQUIRE_NEAR(scene.ViewportHeight(), 1080.0, 1e-9);
    // The rails start after the hero and the gap below it, with a heading above the first rail.
    REQUIRE(scene.CardBox(0, 0).y > heroBottom);
    REQUIRE(scene.CardBox(0, 0).y < heroBottom + 100.0);
}

TEST(without_a_hero_the_rails_start_at_the_top_as_before) {
    Scene scene({}, Auto());
    scene.Layout(1920.0, 1080.0);
    scene.SetRails({Rail("a", 3)});
    REQUIRE(scene.CardBox(0, 0).y < 100.0);
}

TEST(home_starts_on_watch_and_the_arrows_walk_the_hero_and_the_rails) {
    Scene scene = HomeWith({Hero("a", "Alpha", ""), Hero("b", "Beta", "")});
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("hero-play"));

    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("hero-info"));
    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey()->rfind("card:0:", 0) == 0);

    // Up from the top rail reaches Browse, then Watch, then the first top button.
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("hero-info"));
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("hero-play"));
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("settings"));

    // Left and right do nothing on the hero's buttons.
    REQUIRE(scene.FocusItem("hero-play", 0.0, true));
    REQUIRE(!scene.Navigate(Direction::Right, 0.0));
    REQUIRE(!scene.Navigate(Direction::Left, 0.0));
}

TEST(watch_opens_the_hero_title_and_browse_opens_the_tvm_stream) {
    Scene scene = HomeWith({Hero("a", "Alpha", "")});
    const std::optional<tvm::ui::Command> watch = scene.Select(0.0);
    REQUIRE(watch.has_value());
    REQUIRE_EQ(watch->name, std::string("details"));
    REQUIRE_EQ(watch->params.at("id"), std::string("a"));
    REQUIRE_EQ(watch->params.at("title"), std::string("Alpha"));

    REQUIRE(scene.FocusItem("hero-info", 0.0, true));
    const std::optional<tvm::ui::Command> browse = scene.Select(0.0);
    REQUIRE(browse.has_value());
    REQUIRE_EQ(browse->name, std::string("tvm-stream"));
}

TEST(the_buttons_of_the_hero_are_where_they_are_drawn) {
    Scene scene = HomeWith({Hero("a", "Alpha", "")});
    HeroPainter painter;
    scene.Paint(painter);
    const HeroPainter::TextDraw* watch = painter.FindLast("Watch");
    REQUIRE(watch != nullptr);
    REQUIRE_EQ(scene.ItemAt(watch->box.x + 2.0, watch->box.y + watch->box.height / 2.0),
               std::optional<std::string>("hero-play"));
    const HeroPainter::TextDraw* learn = painter.Find("Browse TVM Stream");
    REQUIRE(learn != nullptr);
    REQUIRE_EQ(scene.ItemAt(learn->box.x + 2.0, learn->box.y + learn->box.height / 2.0),
               std::optional<std::string>("hero-info"));
}

// ------------------------------------------------------------- the dissolves

TEST(the_title_dissolves_in_over_480_milliseconds) {
    Scene scene = HomeWith({Hero("a", "Alpha", "")}, 0.0);
    scene.Tick(0.0);
    HeroPainter start;
    scene.Paint(start);
    REQUIRE_NEAR(start.Find("ALPHA")->color.a, 0.0, 1e-9);

    scene.Tick(240.0);
    HeroPainter middle;
    scene.Paint(middle);
    const double halfway = middle.Find("ALPHA")->color.a;
    REQUIRE(halfway > 0.0 && halfway < 1.0);

    scene.Tick(480.0);
    HeroPainter end;
    scene.Paint(end);
    REQUIRE_NEAR(end.Find("ALPHA")->color.a, 1.0, 1e-9);
    REQUIRE(!scene.Animating());
}

TEST(the_first_picture_is_there_at_once_once_its_file_is) {
    bool ready = false;
    Scene scene({}, Auto());
    scene.Layout(1920.0, 1080.0);
    scene.SetImageReady([&ready](const std::string& /*url*/) { return ready; });
    scene.SetHeroes({Hero("a", "Alpha", "https://img.example/a.jpg")}, 0.0);
    scene.SetRails({Rail("a", 3)});
    scene.Tick(0.0);
    HeroPainter waiting;
    scene.Paint(waiting);
    REQUIRE(waiting.pictures.empty());

    ready = true;
    scene.Tick(100.0);
    HeroPainter shown;
    scene.Paint(shown);
    REQUIRE_EQ(shown.pictures.size(), std::size_t(1));
    REQUIRE_EQ(shown.pictures[0].url, std::string("https://img.example/a.jpg"));
    REQUIRE_NEAR(shown.pictures[0].opacity, 1.0, 1e-9);
    // The picture is cropped with its focal point at 70% across and 20% down, as on the web.
    REQUIRE_NEAR(shown.pictures[0].focusX, 0.7, 1e-9);
    REQUIRE_NEAR(shown.pictures[0].focusY, 0.2, 1e-9);
}

TEST(a_later_picture_crossfades_over_the_one_before_it) {
    Scene scene = HomeWith({Hero("a", "Alpha", "https://img.example/a.jpg"),
                            Hero("b", "Beta", "https://img.example/b.jpg")});
    scene.SetImageReady([](const std::string& /*url*/) { return true; });
    scene.Tick(0.0);

    scene.ShowHero(1, 1000.0);
    scene.Tick(1000.0);
    HeroPainter start;
    scene.Paint(start);
    // The old picture stays drawn under the new one, which starts at nothing.
    REQUIRE_EQ(start.pictures.size(), std::size_t(2));
    REQUIRE_EQ(start.pictures[0].url, std::string("https://img.example/a.jpg"));
    REQUIRE_NEAR(start.pictures[0].opacity, 1.0, 1e-9);
    REQUIRE_EQ(start.pictures[1].url, std::string("https://img.example/b.jpg"));
    REQUIRE_NEAR(start.pictures[1].opacity, 0.0, 1e-9);

    scene.Tick(1240.0);
    HeroPainter middle;
    scene.Paint(middle);
    REQUIRE(middle.pictures.back().opacity > 0.0 && middle.pictures.back().opacity < 1.0);

    scene.Tick(1480.0);
    HeroPainter end;
    scene.Paint(end);
    // Once the dissolve has ended, only the new picture is drawn.
    REQUIRE_EQ(end.pictures.size(), std::size_t(1));
    REQUIRE_EQ(end.pictures[0].url, std::string("https://img.example/b.jpg"));
    REQUIRE_NEAR(end.pictures[0].opacity, 1.0, 1e-9);
}

TEST(the_title_changes_with_the_turn_and_the_dots_follow_it) {
    Scene scene = HomeWith({Hero("a", "Alpha", ""), Hero("b", "Beta", "")});
    scene.ShowHero(1, 500.0);
    REQUIRE_EQ(scene.HeroIndex(), std::size_t(1));
    scene.Tick(1000.0);
    HeroPainter painter;
    scene.Paint(painter);
    REQUIRE(painter.Find("BETA") != nullptr);
    REQUIRE(painter.Find("ALPHA") == nullptr);
}

// ------------------------------------------------------------- the page scroll

TEST(the_hero_fades_with_the_page_scroll_as_the_web_stage_does) {
    Scene scene = HomeWith({Hero("a", "Alpha", "https://img.example/a.jpg")});
    scene.Tick(0.0);
    // heroScrollFade: 1 - scroll / (0.92 * the hero's height). Halfway to that, the picture is half as strong.
    const double heroHeight = 0.48 * 1080.0;
    const std::optional<tvm::ui::ScrollSurface> page = scene.SurfaceAt(10.0, 10.0, Axis::Y);
    REQUIRE(page.has_value());
    scene.SetScroll(*page, 0.46 * heroHeight, 0.0);

    HeroPainter painter;
    scene.Paint(painter);
    REQUIRE(!painter.pictures.empty());
    REQUIRE_NEAR(painter.pictures.back().opacity, 0.5, 1e-6);
}

TEST(the_copy_is_not_faded_with_the_page) {
    Scene scene = HomeWith({Hero("a", "Alpha", "")});
    scene.Tick(600.0);
    const std::optional<tvm::ui::ScrollSurface> page = scene.SurfaceAt(10.0, 10.0, Axis::Y);
    REQUIRE(page.has_value());
    scene.SetScroll(*page, 0.46 * 0.48 * 1080.0, 0.0);

    HeroPainter painter;
    scene.Paint(painter);
    // The title keeps its full colour: only the pictures and the vignette fade.
    REQUIRE_NEAR(painter.Find("ALPHA")->color.a, 1.0, 1e-9);
}

}  // namespace
