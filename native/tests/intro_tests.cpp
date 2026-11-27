// Intro tests: the open sting's timeline, its hold while the catalogue loads, its skip, and the frames it draws.
// The timings follow apps/ui/src/brand/TvmIntro.tsx and TvmIntro.css.

#include <string>
#include <string_view>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "ui/intro.h"
#include "ui/franchise_intro.h"
#include "ui/logo_reveal.h"
#include "ui/painter.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::ui::Box;
using tvm::ui::Color;
using tvm::ui::Intro;
using tvm::ui::Rgb;
using tvm::ui::TextStyle;

MotionSettings Auto() {
    return MotionSettings{};
}

MotionSettings Reduced() {
    MotionSettings settings;
    settings.preference = MotionPreference::Reduced;
    return settings;
}

// Whether two colours are the same red, green and blue. The alpha is not compared.
bool SameRgb(const Color& a, const Color& b) {
    return a.r == b.r && a.g == b.g && a.b == b.b;
}

// Records the text and the pictures of one frame, with the alpha each was drawn at.
class IntroPainter final : public tvm::ui::Painter {
public:
    struct TextRecord {
        std::string text;
        double alpha;
        Color color;
        int weight;
    };
    struct ImageRecord {
        std::string url;
        double opacity;
    };

    void Clear(Color /*color*/) override {}
    void FillRoundRect(const Box& /*box*/, double /*radius*/, Color /*color*/) override {}
    void StrokeRoundRect(const Box& /*box*/, double /*radius*/, double /*width*/, Color /*color*/) override {}
    bool Image(const Box& /*box*/, const std::string& url, double /*radius*/) override {
        images.push_back(ImageRecord{url, 1.0});
        return true;
    }
    bool ImageFaded(const Box& /*box*/, const std::string& url, double /*radius*/, double opacity,
                    double /*focusX*/, double /*focusY*/) override {
        images.push_back(ImageRecord{url, opacity});
        return true;
    }
    void Paragraph(const Box& /*box*/, std::string_view /*text*/, const TextStyle& /*style*/,
                   Color /*color*/) override {}
    void Text(const Box& /*box*/, std::string_view text, const TextStyle& style, Color color) override {
        texts.push_back(TextRecord{std::string(text), color.a, color, style.weight});
    }
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}

    // The alpha of the first text drawn as `text`, or -1 when it was not drawn. The word comes before the tag,
    // so "T" is the word's T.
    double AlphaOf(std::string_view text) const {
        for (const TextRecord& record : texts) {
            if (record.text == text) return record.alpha;
        }
        return -1.0;
    }

    // The colour of the first text drawn as `text`.
    Color ColorOf(std::string_view text) const {
        for (const TextRecord& record : texts) {
            if (record.text == text) return record.color;
        }
        return Color{};
    }

    // The font weight of the first text drawn as `text`.
    int WeightOf(std::string_view text) const {
        for (const TextRecord& record : texts) {
            if (record.text == text) return record.weight;
        }
        return -1;
    }

    // Everything drawn as text, in the order it was drawn.
    std::string Joined() const {
        std::string joined;
        for (const TextRecord& record : texts) joined += record.text;
        return joined;
    }

    std::vector<TextRecord> texts;
    std::vector<ImageRecord> images;
};

constexpr double kWidth = 1000.0;
constexpr double kHeight = 600.0;

// ------------------------------------------------------------------- the timeline

TEST(sting_plays_for_its_length_then_fades_out) {
    Intro intro(Auto());
    intro.Start(0.0);
    REQUIRE(intro.Visible());
    REQUIRE(intro.Animating());
    intro.Tick(1000.0);
    REQUIRE(intro.Visible());
    // With nothing to wait for, it leaves once its 3.2 s are up, and the fade takes 420 ms.
    intro.Tick(3200.0);
    intro.Tick(3619.0);
    REQUIRE(intro.Visible());
    intro.Tick(3620.0);
    REQUIRE(!intro.Visible());
    REQUIRE(!intro.Animating());
}

TEST(pending_holds_the_mark_until_the_catalogue_settles) {
    Intro intro(Auto());
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(3200.0);
    intro.Tick(5000.0);
    REQUIRE(intro.Visible());
    intro.SetPending(false);
    intro.Tick(5000.0);
    intro.Tick(5419.0);
    REQUIRE(intro.Visible());
    intro.Tick(5420.0);
    REQUIRE(!intro.Visible());
}

TEST(a_hold_gives_up_after_2_8_seconds) {
    Intro intro(Auto());
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(3200.0);
    intro.Tick(5999.0);
    REQUIRE(intro.Visible());
    intro.Tick(6000.0);
    intro.Tick(6419.0);
    REQUIRE(intro.Visible());
    intro.Tick(6420.0);
    REQUIRE(!intro.Visible());
}

TEST(skip_leaves_at_once_and_a_second_skip_changes_nothing) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(500.0);
    intro.Skip(500.0);
    // The sting is already leaving, so a second skip does not restart the fade.
    intro.Skip(700.0);
    intro.Tick(919.0);
    REQUIRE(intro.Visible());
    intro.Tick(920.0);
    REQUIRE(!intro.Visible());
}

TEST(skip_before_the_sting_starts_does_nothing) {
    Intro intro(Auto());
    intro.Skip(0.0);
    REQUIRE(!intro.Visible());
    intro.Start(0.0);
    REQUIRE(intro.Visible());
}

TEST(reduced_motion_closes_after_a_short_hold) {
    Intro intro(Reduced());
    intro.Start(0.0);
    intro.Tick(0.0);
    intro.Tick(159.0);
    REQUIRE(intro.Visible());
    intro.Tick(160.0);
    REQUIRE(!intro.Visible());
}

TEST(reduced_motion_holds_the_settled_frame_while_pending) {
    Intro intro(Reduced());
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(0.0);
    intro.Tick(2000.0);
    REQUIRE(intro.Visible());
    intro.Tick(2800.0);
    intro.Tick(2959.0);
    REQUIRE(intro.Visible());
    intro.Tick(2960.0);
    REQUIRE(!intro.Visible());
}

// ------------------------------------------------------------------- the frames

TEST(the_mark_comes_from_the_shipped_picture_and_fades_in) {
    Intro intro(Auto());
    intro.Start(0.0);
    IntroPainter start;
    intro.Paint(start, kWidth, kHeight);
    REQUIRE(!start.images.empty());
    REQUIRE(start.images.back().url == "asset:tvm-icon.png");
    REQUIRE_NEAR(start.images.back().opacity, 0.0, 1e-9);

    intro.Tick(2400.0);
    IntroPainter settled;
    intro.Paint(settled, kWidth, kHeight);
    REQUIRE_NEAR(settled.images.back().opacity, 1.0, 1e-9);
}

TEST(letters_are_written_one_after_another) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(1000.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    // T starts at 850 ms, and V and M at 1000 ms and 1150 ms.
    REQUIRE(frame.AlphaOf("T") > 0.0);
    REQUIRE_NEAR(frame.AlphaOf("V"), 0.0, 1e-9);
    REQUIRE_NEAR(frame.AlphaOf("M"), 0.0, 1e-9);
}

TEST(skip_hint_appears_after_the_mark_has_settled) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(1000.0);
    IntroPainter early;
    intro.Paint(early, kWidth, kHeight);
    REQUIRE_NEAR(early.AlphaOf("P"), 0.0, 1e-9);
    intro.Tick(2200.0);
    IntroPainter later;
    intro.Paint(later, kWidth, kHeight);
    // It fades in from 1.7 s to 2.1 s, at 55% ink. It is drawn letter by letter, so its first letter stands for it.
    REQUIRE_NEAR(later.AlphaOf("P"), 0.55, 1e-9);
}

TEST(skip_hint_reads_press_ok_to_skip) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(2200.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.Joined().find("Press OK to skip") != std::string::npos);
}

TEST(reduced_motion_paints_the_settled_word_at_full_strength) {
    Intro intro(Reduced());
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(0.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE_NEAR(frame.AlphaOf("T"), 1.0, 1e-9);
    REQUIRE_NEAR(frame.AlphaOf("V"), 1.0, 1e-9);
    REQUIRE_NEAR(frame.AlphaOf("M"), 1.0, 1e-9);
    REQUIRE_NEAR(frame.AlphaOf("P"), 0.55, 1e-9);
    REQUIRE_NEAR(frame.images.back().opacity, 1.0, 1e-9);
}

TEST(a_finished_sting_draws_nothing) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(3200.0);
    intro.Tick(4000.0);
    REQUIRE(!intro.Visible());
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.texts.empty());
    REQUIRE(frame.images.empty());
}

// ------------------------------------------------------------------- the 'tvm' tag

TEST(the_tvm_form_writes_watch_under_the_word) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(2400.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.Joined().find("TVMWATCH") != std::string::npos);
    REQUIRE(frame.Joined().find("STREAM") == std::string::npos);
    // The 'tvm' tag is the strong accent.
    REQUIRE(SameRgb(frame.ColorOf("W"), Rgb(0x9EDCFF)));
}

// ------------------------------------------------------------------- the 'stream' form

TEST(the_stream_sting_plays_for_its_length_then_fades_out) {
    Intro intro(Auto(), Intro::Form::Stream);
    intro.Start(0.0);
    REQUIRE(intro.Visible());
    intro.Tick(3200.0);
    intro.Tick(3619.0);
    REQUIRE(intro.Visible());
    intro.Tick(3620.0);
    REQUIRE(!intro.Visible());
}

TEST(the_stream_form_writes_stream_under_the_word) {
    Intro intro(Auto(), Intro::Form::Stream);
    intro.Start(0.0);
    intro.Tick(2400.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.Joined().find("TVMSTREAM") != std::string::npos);
    REQUIRE(frame.Joined().find("WATCH") == std::string::npos);
}

TEST(the_stream_tag_is_the_cool_blue) {
    Intro intro(Auto(), Intro::Form::Stream);
    intro.Start(0.0);
    intro.Tick(2400.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    // The stream form swaps the accent and the cool blue, so its tag is the dark theme's accent.
    REQUIRE(SameRgb(frame.ColorOf("S"), Rgb(0x6EC8FF)));
}

TEST(the_word_is_800_the_tag_750_and_the_hint_regular) {
    Intro intro(Auto());
    intro.Start(0.0);
    intro.Tick(2400.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.WeightOf("T") == 800);
    REQUIRE(frame.WeightOf("W") == 750);
    REQUIRE(frame.WeightOf("P") == 400);
}

TEST(a_skip_during_a_hold_plays_the_tag_entrance_again) {
    Intro intro(Auto());
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(3200.0);
    intro.Tick(4000.0);
    // Holding, the tag keeps its idle loop, so it is lit.
    IntroPainter holding;
    intro.Paint(holding, kWidth, kHeight);
    REQUIRE(holding.AlphaOf("W") > 0.7);
    intro.Skip(4000.0);
    intro.Tick(4000.0);
    // Its entrance starts again from the skip, with a 1.35 s delay, so it is not drawn for the fade.
    IntroPainter leaving;
    intro.Paint(leaving, kWidth, kHeight);
    REQUIRE_NEAR(leaving.AlphaOf("W"), 0.0, 1e-9);
}

TEST(reduced_motion_paints_the_stream_tag_at_full_strength) {
    Intro intro(Reduced(), Intro::Form::Stream);
    intro.SetPending(true);
    intro.Start(0.0);
    intro.Tick(0.0);
    IntroPainter frame;
    intro.Paint(frame, kWidth, kHeight);
    REQUIRE(frame.Joined().find("STREAM") != std::string::npos);
    REQUIRE_NEAR(frame.AlphaOf("S"), 1.0, 1e-9);
}


// ------------------------------------------------------------ the launch reveal (from the Android app)

using tvm::ui::LogoReveal;
using tvm::ui::Point;

// Counts what one frame of the reveal draws: filled shapes, traced lines, shaped clips and the opacity layer.
class RevealPainter final : public tvm::ui::Painter {
public:
    int polygons = 0;
    int polylines = 0;
    int strokeClips = 0;
    int shapeClips = 0;
    int clipDepth = 0;
    int opacityDepth = 0;
    double opacity = 1.0;
    void Clear(Color) override {}
    void FillRoundRect(const Box&, double, Color) override {}
    void StrokeRoundRect(const Box&, double, double, Color) override {}
    bool Image(const Box&, const std::string&, double) override { return false; }
    void Paragraph(const Box&, std::string_view, const TextStyle&, Color) override {}
    void Text(const Box&, std::string_view, const TextStyle&, Color) override {}
    void FillPolygon(const std::vector<Point>& points, Color) override {
        if (points.size() >= 3) ++polygons;
    }
    void StrokePolyline(const std::vector<Point>& points, double, Color, bool) override {
        if (points.size() >= 2) ++polylines;
    }
    void PushClip(const Box&) override { ++clipDepth; }
    void PopClip() override { --clipDepth; }
    void PushClipStroke(const std::vector<Point>&, double) override {
        ++strokeClips;
        ++clipDepth;
    }
    void PushClipPolygons(const std::vector<std::vector<Point>>&) override {
        ++shapeClips;
        ++clipDepth;
    }
    void PushOpacity(double value) override {
        opacity = value;
        ++opacityDepth;
    }
    void PopOpacity() override { --opacityDepth; }
};

RevealPainter RevealFrame(LogoReveal& reveal, double nowMs) {
    reveal.Tick(nowMs);
    RevealPainter painter;
    reveal.Paint(painter, 1920.0, 1080.0);
    return painter;
}

TEST(the_reveal_follows_the_android_timeline) {
    LogoReveal reveal(Auto());
    reveal.Start(0.0);
    // Before the letters: only the wash.
    RevealPainter early = RevealFrame(reveal, 200.0);
    REQUIRE_EQ(early.polygons, 0);
    REQUIRE_EQ(early.polylines, 0);
    // The T is being traced at 400 ms, before it fills.
    RevealPainter tracing = RevealFrame(reveal, 400.0);
    REQUIRE(tracing.polylines >= 1);
    // At 1800 ms the star is on the trail: the lower sweep shows through its stroke clip.
    RevealPainter travelling = RevealFrame(reveal, 1800.0);
    REQUIRE(travelling.strokeClips >= 1);
    // During the shine the letters clip the light.
    RevealPainter shining = RevealFrame(reveal, 3200.0);
    REQUIRE_EQ(shining.shapeClips, 1);
    REQUIRE_EQ(shining.clipDepth, 0);
    REQUIRE(reveal.Covers());
}

TEST(the_reveal_holds_while_pending_then_fades_out_in_350_ms) {
    LogoReveal reveal(Auto());
    reveal.SetPending(true);
    reveal.Start(0.0);
    reveal.Tick(5000.0);
    REQUIRE(reveal.Visible());
    REQUIRE(reveal.Covers());
    reveal.SetPending(false);
    reveal.Tick(5100.0);
    REQUIRE(reveal.Visible());
    REQUIRE(!reveal.Covers());
    RevealPainter fading = RevealFrame(reveal, 5275.0);
    REQUIRE_EQ(fading.opacityDepth, 0);
    REQUIRE(fading.opacity < 1.0 && fading.opacity > 0.0);
    reveal.Tick(5100.0 + LogoReveal::kFadeOutMs);
    REQUIRE(!reveal.Visible());
}

TEST(the_reveal_never_holds_forever) {
    LogoReveal reveal(Auto());
    reveal.SetPending(true);
    reveal.Start(0.0);
    reveal.Tick(LogoReveal::kTotalMs + LogoReveal::kHoldMaxMs);
    REQUIRE(!reveal.Covers());
    reveal.Tick(LogoReveal::kTotalMs + LogoReveal::kHoldMaxMs + LogoReveal::kFadeOutMs);
    REQUIRE(!reveal.Visible());
}

TEST(skipping_the_reveal_fades_it_out_and_reduced_motion_shows_the_last_frame) {
    LogoReveal reveal(Auto());
    reveal.Start(0.0);
    reveal.Tick(900.0);
    reveal.Skip(900.0);
    REQUIRE(!reveal.Covers());
    reveal.Tick(900.0 + LogoReveal::kFadeOutMs);
    REQUIRE(!reveal.Visible());

    LogoReveal still(Reduced());
    still.Start(0.0);
    REQUIRE_NEAR(still.Elapsed(), LogoReveal::kTotalMs, 1e-9);
    RevealPainter last = RevealFrame(still, 10.0);
    // Three letters, the two sweeps, the upper arc and the star are all there.
    REQUIRE(last.polygons >= 7);
}

TEST(franchise_intro_matches_by_imdb_and_regex_and_plays_once_per_session) {
    const auto catalog = nlohmann::json::parse(R"({
        "schema": 1,
        "intros": [
            {
                "id": "hunger-games",
                "event": "sunrise-on-the-reaping",
                "style": "mockingjay",
                "imdbIds": ["tt1951264"],
                "titlePattern": "\\b(hunger games|mockingjay)\\b",
                "accent": "#E8A33D",
                "glow": "#FF6A2A",
                "durationMs": 3800,
                "titles": { "tt1951264": "Catching Fire" }
            },
            {
                "id": "avengers-doomsday",
                "event": "avengers-doomsday",
                "style": "doom",
                "imdbIds": ["tt21357150"],
                "titlePattern": "\\bavengers\\b",
                "accent": "#3FA34D",
                "glow": "#1E6B2A",
                "durationMs": 3800,
                "titles": { "tt21357150": "Avengers: Doomsday" }
            }
        ]
    })");
    std::set<std::string> played;
    const auto hg = tvm::ui::PlanFranchiseIntro(catalog, "tt1951264:1:1", "Something", played);
    REQUIRE(hg.has_value());
    REQUIRE_EQ(hg->id, std::string("hunger-games"));
    REQUIRE_EQ(hg->title, std::string("Catching Fire"));

    played.insert(hg->id);
    REQUIRE(!tvm::ui::PlanFranchiseIntro(catalog, "tt9999999", "The Hunger Games: Mockingjay", played).has_value());

    const auto doom = tvm::ui::PlanFranchiseIntro(catalog, "tt0000001", "Avengers: Endgame (2019)", played);
    REQUIRE(doom.has_value());
    REQUIRE_EQ(doom->style, std::string("doom"));
    REQUIRE_EQ(doom->title, std::string("Avengers: Endgame"));
}

TEST(franchise_intro_draws_both_scenes_holds_and_skips_cleanly) {
    class ScenePainter final : public tvm::ui::Painter {
    public:
        void Clear(Color) override {}
        void FillRoundRect(const Box&, double, Color) override {}
        void StrokeRoundRect(const Box&, double, double, Color) override {}
        bool Image(const Box&, const std::string&, double) override { return true; }
        bool ImageFaded(const Box&, const std::string&, double, double, double, double) override { return true; }
        void Paragraph(const Box&, std::string_view, const TextStyle&, Color) override {}
        void Text(const Box&, std::string_view t, const TextStyle&, Color) override {
            texts.push_back(std::string(t));
        }
        void PushClip(const Box&) override {}
        void PopClip() override {}
        void FillPolygon(const std::vector<tvm::ui::Point>&, Color) override { ++polygons; }
        void FillPolygonLinear(const std::vector<tvm::ui::Point>&, double, double, double, double,
                               const std::vector<tvm::ui::GradientStop>&) override { ++polygons; }
        void StrokePolyline(const std::vector<tvm::ui::Point>&, double, Color, bool) override { ++polylines; }
        std::vector<std::string> texts;
        int polygons = 0;
        int polylines = 0;
    };

    tvm::ui::FranchiseIntro intro(Auto());
    intro.Start({"hunger-games", "sunrise", "mockingjay", "#E8A33D", "#FF6A2A", "Catching Fire", 3200.0}, 0.0);
    intro.Tick(2600.0);
    REQUIRE(intro.Active());
    REQUIRE(!intro.Released());
    ScenePainter hgPaint;
    intro.Paint(hgPaint, 1920.0, 1080.0);
    REQUIRE(hgPaint.polygons > 10);
    REQUIRE(hgPaint.polylines > 10);
    REQUIRE(std::find(hgPaint.texts.begin(), hgPaint.texts.end(), "THE HUNGER GAMES") != hgPaint.texts.end());

    // Holds after durationMs until playback is ready, then crossfades out.
    intro.Tick(3300.0);
    REQUIRE(intro.Released());
    REQUIRE(intro.Active());
    intro.SetPlaybackReady(true, 3300.0);
    intro.Tick(3800.0);
    REQUIRE(!intro.Active());

    // Skip immediately releases and fades out.
    intro.Start({"avengers-doomsday", "doomsday", "doom", "#3FA34D", "#1E6B2A", "Avengers: Doomsday", 3800.0}, 4000.0);
    intro.Tick(6600.0);
    ScenePainter doomPaint;
    intro.Paint(doomPaint, 1920.0, 1080.0);
    REQUIRE(doomPaint.polygons > 10);
    REQUIRE(doomPaint.polylines > 10);
    REQUIRE(std::find(doomPaint.texts.begin(), doomPaint.texts.end(), "DOOMSDAY") != doomPaint.texts.end());
    intro.Skip(6600.0);
    REQUIRE(intro.Released());
    intro.Tick(6900.0);
    REQUIRE(!intro.Active());
}

}  // namespace
