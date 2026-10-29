// Player and TVM Stream tests: the player's cards and chrome (Player.tsx, useIdleChrome.ts and
// player-chrome.css), and the TVM Stream page's chrome and billboard (Library.tsx, StreamChrome.tsx).
// Sizes are at 1080p, where a rem is 16 px.

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "ui/player_screen.h"
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/screen_base.h"
#include "ui/shell.h"

namespace {

using tvm::motion::MotionSettings;
using tvm::nav::Direction;
using tvm::ui::Box;
using tvm::ui::Color;
using tvm::ui::Command;
using tvm::ui::HeroData;
using tvm::ui::PlayerScreen;
using tvm::ui::PlayerView;
using tvm::ui::RailData;
using tvm::ui::Scene;
using tvm::ui::SceneStyle;
using tvm::ui::SceneView;
using tvm::ui::Shell;
using tvm::ui::TopButton;

// Records each line of text drawn.
class TextPainter final : public tvm::ui::Painter {
public:
    void Clear(Color /*color*/) override {}
    void FillRoundRect(const Box& /*box*/, double /*radius*/, Color /*color*/) override {}
    void StrokeRoundRect(const Box& /*box*/, double /*radius*/, double /*width*/, Color /*color*/) override {}
    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/,
                   Color /*color*/) override {
        texts.emplace_back(text);
    }
    void Text(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color /*color*/) override {
        texts.emplace_back(text);
    }
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}

    bool Has(const std::string& text) const {
        for (const std::string& drawn : texts) {
            if (drawn == text) return true;
        }
        return false;
    }

    std::vector<std::string> texts;
};

class MemoryStore final : public tvm::ui::PreferenceStore {
public:
    MotionSettings Motion() const override { return {}; }
    void SaveMotion(const MotionSettings& /*settings*/) override {}
    tvm::prefs::CorePrefs CorePrefs() const override { return {}; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& /*patch*/) override {}
};

// A root screen whose OK opens one screen.
class Launcher final : public tvm::ui::ScreenBase {
public:
    explicit Launcher(std::string name) : name_(std::move(name)) {}
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = name_;
        command.params["id"] = "tt1";
        return command;
    }

private:
    std::string name_;
};

PlayerScreen Player(const PlayerView& view) {
    PlayerScreen player;
    player.Layout(1920.0, 1080.0);
    player.SetView(view, 0.0);
    player.Tick(0.0);
    return player;
}

PlayerView Playing() {
    PlayerView view;
    view.phase = PlayerView::Phase::Playing;
    view.title = "Dune";
    view.started = true;
    view.position = 65.0;
    view.duration = 3600.0 + 125.0;
    return view;
}

// ------------------------------------------------------------------ the player

TEST(the_clock_shows_hours_only_past_an_hour) {
    REQUIRE_EQ(tvm::ui::FormatClock(65.0), std::string("1:05"));
    REQUIRE_EQ(tvm::ui::FormatClock(3725.9), std::string("1:02:05"));
    REQUIRE_EQ(tvm::ui::FormatClock(-4.0), std::string("0:00"));
}

TEST(while_the_stream_is_found_the_queue_card_shows) {
    PlayerView view;
    view.title = "Dune";
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("TVM CINEMA"));
    REQUIRE(painter.Has("Getting your stream ready"));
    REQUIRE(painter.Has("Checking the source and preparing playback. Press Back to cancel."));
    REQUIRE(!player.OverVideo());
}

TEST(the_queue_card_stays_until_mpv_draws_a_first_frame) {
    PlayerView view = Playing();
    view.started = false;
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Getting your stream ready"));
    REQUIRE(player.OverVideo());
}

TEST(the_chrome_shows_the_title_and_the_clock) {
    PlayerScreen player = Player(Playing());
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Dune"));
    REQUIRE(painter.Has("1:05"));
    REQUIRE(painter.Has("1:02:05"));
    REQUIRE(painter.Has("Back to browse"));
    REQUIRE(painter.Has("100%"));
}

TEST(the_sound_runs_to_1000_percent_along_its_bar) {
    PlayerScreen player = Player(Playing());
    const Box bar = player.VolumeTrackBox();
    // Just past the bar's end still counts, so the top is easy to reach.
    const std::optional<std::string> key = player.ItemAt(bar.Right() + 1.0, bar.CenterY());
    REQUIRE(key.has_value());
    const std::optional<Command> command = player.ActivateItem(*key, 0.0);
    REQUIRE_EQ(command->name, std::string("player-volume"));
    REQUIRE_NEAR(std::stod(command->params.at("level")), 10.0, 0.01);
}

TEST(the_speed_menu_opens_on_normal_and_picks_a_speed) {
    PlayerScreen player = Player(Playing());
    REQUIRE(player.ActivateItem("speed", 0.0) == std::nullopt);
    REQUIRE(player.MenuOpen());
    REQUIRE_EQ(player.MenuOptions("speed").size(), std::size_t{6});
    REQUIRE(player.MenuOptions("speed")[2].selected);
    player.Navigate(Direction::Down, 0.0);
    const std::optional<Command> pick = player.Select(0.0);
    REQUIRE_EQ(pick->name, std::string("player-pick"));
    REQUIRE_EQ(pick->params.at("kind"), std::string("speed"));
    REQUIRE_EQ(pick->params.at("id"), std::string("1.25"));
    REQUIRE(!player.MenuOpen());
}

TEST(subtitles_and_quality_menus_show_only_when_there_is_a_choice) {
    PlayerView view = Playing();
    PlayerScreen bare = Player(view);
    REQUIRE(!bare.BoxOf("cc").has_value());
    REQUIRE(!bare.BoxOf("quality").has_value());
    view.subtitles = {{"no", "Off", "", true}, {"3", "English", "subrip", false}};
    view.qualities = {{"0", "1080p", "Show.1080p", true}, {"1", "720p", "Show.720p", false}};
    PlayerScreen full = Player(view);
    REQUIRE(full.BoxOf("cc").has_value());
    REQUIRE(full.BoxOf("quality").has_value());
    full.ActivateItem("quality", 0.0);
    full.Navigate(Direction::Down, 0.0);
    REQUIRE_EQ(full.Select(0.0)->params.at("id"), std::string("1"));
}

TEST(dragging_the_timeline_previews_then_seeks_on_release) {
    PlayerScreen player = Player(Playing());
    player.Scrub(0.25);
    REQUIRE(player.Scrubbing());
    REQUIRE_NEAR(player.ChromeOpacity(60000.0), 1.0, 1e-9);
    const std::optional<double> seconds = player.EndScrub();
    REQUIRE_NEAR(*seconds, 3725.0 * 0.25, 1e-6);
    REQUIRE(!player.Scrubbing());
}

TEST(next_up_shows_over_the_last_45_seconds_and_takes_the_focus) {
    REQUIRE_NEAR(tvm::ui::NextUpWindowSeconds(2400.0), 45.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::NextUpWindowSeconds(100.0), 20.0, 1e-9);
    PlayerView view = Playing();
    PlayerScreen player = Player(view);
    view.nextUp = true;
    view.nextShow = "Breaking Bad";
    view.nextEpisode = "S1 E2 \xC2\xB7 Cat's in the Bag...";
    view.nextRemaining = 20.0;
    player.SetView(view, 0.0);
    REQUIRE_EQ(player.FocusedKey(), std::optional<std::string>("next-play"));
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("UP NEXT \xC2\xB7 in 20s"));
    REQUIRE(painter.Has("Play next"));
    REQUIRE_EQ(player.Select(0.0)->name, std::string("player-next"));
}

TEST(credits_and_hold_to_skip_follow_the_web_timings) {
    REQUIRE_NEAR(tvm::ui::CreditsWindowSeconds(6000.0), 18.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::CreditsWindowSeconds(100.0), 8.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::CreditsWindowSeconds(20.0), 7.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::HoldSkipStep(400.0), 10.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::HoldSkipStep(900.0), 30.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::HoldSkipStep(2000.0), 60.0, 1e-9);
    REQUIRE_EQ(tvm::ui::RemainingLabel(2530.0), std::string("42:10 left"));
}

TEST(skip_recap_takes_the_focus_and_skips_on_ok) {
    PlayerView view = Playing();
    PlayerScreen player = Player(view);
    view.recap = true;
    player.SetView(view, 0.0);
    REQUIRE_EQ(player.FocusedKey(), std::optional<std::string>("recap"));
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Skip recap"));
    REQUIRE_EQ(player.Select(10000.0)->name, std::string("player-skip-recap"));
}

TEST(skip_credits_counts_down_beside_watch_credits) {
    PlayerView view = Playing();
    PlayerScreen player = Player(view);
    view.credits = true;
    view.creditsRemaining = 12.0;
    player.SetView(view, 0.0);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Skip credits  0:12"));
    REQUIRE(painter.Has("Watch credits"));
    REQUIRE_EQ(player.Select(0.0)->name, std::string("player-skip-credits"));
}

TEST(the_title_overlay_reads_now_playing_with_the_episode_and_time_left) {
    PlayerView view = Playing();
    view.episode = "S2 E4";
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("NOW PLAYING"));
    REQUIRE(painter.Has("S2 E4"));
    REQUIRE(painter.Has("1:01:00 left"));
}

TEST(a_held_arrow_shows_its_target_in_the_preview) {
    PlayerScreen player = Player(Playing());
    REQUIRE(!player.PreviewSeconds().has_value());
    player.HoldPreview(600.0, 0.0);
    player.Tick(500.0);
    REQUIRE_NEAR(*player.PreviewSeconds(), 600.0, 1e-9);
    player.Tick(5000.0);
    REQUIRE(!player.PreviewSeconds().has_value());
}

TEST(go_live_offers_itself_from_12_seconds_behind) {
    REQUIRE_EQ(tvm::ui::DriftLabel(42.0), std::string("42s behind"));
    REQUIRE_EQ(tvm::ui::DriftLabel(150.0), std::string("2 min behind"));
    REQUIRE_EQ(tvm::ui::DriftLabel(3900.0), std::string("1h 5m behind"));
    PlayerView view = Playing();
    view.live = true;
    view.liveBehind = 8.0;
    PlayerScreen player = Player(view);
    // Under the threshold there is no button to press.
    REQUIRE(!player.ActivateItem("go-live", 0.0).has_value());
    view.liveBehind = 30.0;
    player.SetView(view, 0.0);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Back to live"));
    REQUIRE(painter.Has("30s behind"));
    REQUIRE_EQ(player.ActivateItem("go-live", 0.0)->name, std::string("player-go-live"));
}

TEST(the_remote_hints_come_up_after_the_picture_and_leave_on_input) {
    PlayerView view = Playing();
    view.hints = true;
    PlayerScreen player;
    player.Layout(1920.0, 1080.0);
    player.SetView(view, 1000.0);
    player.Tick(1100.0);
    TextPainter before;
    player.Paint(before);
    REQUIRE(!before.Has("SKIP"));
    player.Tick(2000.0);
    TextPainter during;
    player.Paint(during);
    REQUIRE(during.Has("LEFT"));
    REQUIRE(during.Has("SKIP"));
    REQUIRE(during.Has("EXIT"));
    // Input after the grace sends them away.
    player.ShowChrome(2500.0);
    player.Tick(2900.0);
    TextPainter after;
    player.Paint(after);
    REQUIRE(!after.Has("SKIP"));
}

TEST(my_list_and_download_sit_in_the_header) {
    PlayerView view = Playing();
    view.canSave = true;
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("Add"));
    REQUIRE_EQ(player.ActivateItem("watchlist", 0.0)->name, std::string("player-watchlist"));
    const std::optional<Command> download = player.ActivateItem("download", 0.0);
    REQUIRE_EQ(download->name, std::string("downloads"));
    REQUIRE(download->modal);
    REQUIRE(!download->action);
}

TEST(an_episode_shows_its_season_and_number_beside_the_title) {
    PlayerView view = Playing();
    view.episode = "S1 \xC2\xB7 E2";
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("S1 \xC2\xB7 E2"));
}

TEST(the_chrome_fades_after_three_seconds_without_input) {
    PlayerScreen player = Player(Playing());
    REQUIRE_NEAR(player.ChromeOpacity(3000.0), 1.0, 1e-9);
    // cinema-controls.css fades the chrome over 180 ms.
    REQUIRE_NEAR(player.ChromeOpacity(3090.0), 0.5, 1e-9);
    REQUIRE_NEAR(player.ChromeOpacity(3180.0), 0.0, 1e-9);
    player.ShowChrome(5000.0);
    REQUIRE_NEAR(player.ChromeOpacity(5100.0), 1.0, 1e-9);
}

TEST(the_chrome_stays_while_paused) {
    PlayerView view = Playing();
    view.paused = true;
    PlayerScreen player = Player(view);
    REQUIRE_NEAR(player.ChromeOpacity(60000.0), 1.0, 1e-9);
}

TEST(ok_on_a_faded_chrome_plays_or_pauses) {
    PlayerScreen player = Player(Playing());
    const std::optional<Command> command = player.Select(10000.0);
    REQUIRE(command.has_value());
    REQUIRE_EQ(command->name, std::string("player-toggle"));
    REQUIRE(command->action);
}

TEST(the_transport_seeks_ten_seconds_each_way) {
    PlayerScreen player = Player(Playing());
    const Box rewind = *player.BoxOf("rewind");
    const std::optional<std::string> key = player.ItemAt(rewind.CenterX(), rewind.CenterY());
    REQUIRE_EQ(key, std::optional<std::string>("rewind"));
    const std::optional<Command> command = player.ActivateItem(*key, 0.0);
    REQUIRE_EQ(command->name, std::string("player-seek"));
    REQUIRE_EQ(command->params.at("delta"), std::string("-10"));
    REQUIRE_EQ(player.ActivateItem("forward", 0.0)->params.at("delta"), std::string("10"));
}

TEST(a_click_on_the_bar_seeks_to_that_share) {
    PlayerScreen player = Player(Playing());
    const Box track = player.TrackBox();
    const std::optional<std::string> key = player.ItemAt(track.x + track.width * 0.5, track.CenterY());
    REQUIRE(key.has_value());
    const std::optional<Command> command = player.ActivateItem(*key, 0.0);
    REQUIRE_EQ(command->name, std::string("player-seek-to"));
    REQUIRE_NEAR(std::stod(command->params.at("seconds")), 3725.0 * 0.5, 1.0);
}

TEST(the_error_card_offers_retry_then_back) {
    PlayerView view;
    view.phase = PlayerView::Phase::Error;
    view.errorTitle = "No streams found";
    view.errorBody = "Torrentio returned no streams for this title.";
    PlayerScreen player = Player(view);
    TextPainter painter;
    player.Paint(painter);
    REQUIRE(painter.Has("PLAYBACK"));
    REQUIRE(painter.Has("No streams found"));
    REQUIRE_EQ(player.FocusedKey(), std::optional<std::string>("retry"));
    REQUIRE_EQ(player.Select(0.0)->name, std::string("player-retry"));
    player.Navigate(Direction::Right, 0.0);
    REQUIRE_EQ(player.Select(0.0)->name, std::string("player-close"));
}

TEST(opening_the_player_puts_a_player_screen_on_top) {
    MemoryStore store;
    Shell shell(std::make_unique<Launcher>("player"), store);
    shell.Layout(1920.0, 1080.0);
    shell.Select(0.0);
    REQUIRE(shell.ActivePlayer() != nullptr);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("player"));
}

// ------------------------------------------------------------------ TVM Stream

std::vector<TopButton> Chrome(bool showsOn = false) {
    const auto action = [](const std::string& name) {
        Command command;
        command.name = name;
        command.action = true;
        return command;
    };
    Command profiles;
    profiles.name = "profiles";
    return {TopButton{"Gathe", profiles},
            TopButton{"Search", action("search")},
            TopButton{"Home", action("stream-home")},
            TopButton{"Shows", action("stream-lane"), showsOn},
            TopButton{"Movies", action("stream-lane")},
            TopButton{"TVM", action("stream-mark"), false, true},
            TopButton{"Downloads", action("downloads")}};
}

RailData Rail(const std::string& id, std::size_t count) {
    RailData rail;
    rail.id = id;
    rail.title = id;
    for (std::size_t i = 0; i < count; ++i) rail.cards.push_back({id + std::to_string(i), "Card", "", std::nullopt});
    return rail;
}

Shell StreamShell(MemoryStore& store, const std::vector<HeroData>& heroes) {
    Shell shell(std::make_unique<Launcher>("tvm-stream"), store);
    shell.Layout(1920.0, 1080.0);
    shell.Select(0.0);
    SceneView view;
    view.style = SceneStyle::Stream;
    view.topButtons = Chrome();
    view.rails = {Rail("films", 4)};
    shell.SetStreamView(view, heroes, 0.0);
    return shell;
}

HeroData Billboard() {
    HeroData hero;
    hero.itemId = "tt1";
    hero.title = "Dune";
    hero.hue = 30;
    return hero;
}

TEST(tvm_stream_opens_on_watch_now_under_its_chrome) {
    MemoryStore store;
    Shell shell = StreamShell(store, {Billboard()});
    Scene* scene = shell.StreamScene();
    REQUIRE(scene != nullptr);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("hero-play"));
    TextPainter painter;
    scene->Paint(painter);
    REQUIRE(painter.Has("WATCH NOW"));
    REQUIRE(painter.Has("tvm stream"));
    REQUIRE(painter.Has("Learn More"));
    REQUIRE(painter.Has("Search"));
    REQUIRE(painter.Has("TVM"));
    // The launcher's kicker belongs to Home, not to TVM Stream.
    REQUIRE(!painter.Has("HOME"));
}

TEST(both_billboard_buttons_open_the_title) {
    MemoryStore store;
    Shell shell = StreamShell(store, {Billboard()});
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("details"));
    REQUIRE(shell.Back(0.0));
    Scene* scene = shell.StreamScene();
    scene->FocusItem("hero-info", 0.0, false);
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("details"));
}

TEST(the_stream_chrome_runs_left_to_right_and_stays_at_the_top) {
    MemoryStore store;
    Shell shell = StreamShell(store, {Billboard()});
    Scene* scene = shell.StreamScene();
    shell.Navigate(Direction::Up, 0.0);
    const std::optional<std::string> top = scene->FocusedKey();
    REQUIRE(top.has_value());
    REQUIRE(*top != "hero-play");
    scene->FocusItem("settings", 0.0, false);
    shell.Navigate(Direction::Right, 0.0);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("top:1"));
    shell.Navigate(Direction::Left, 0.0);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("settings"));
    shell.Navigate(Direction::Down, 0.0);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("hero-play"));
}

TEST(without_real_debrid_the_page_asks_for_a_token) {
    MemoryStore store;
    HeroData notice;
    notice.itemId = "stream-connect";
    notice.title = "Connect Real-Debrid to watch";
    notice.body = "Paste the API token from real-debrid.com/apitoken, then press OK.";
    notice.playLabel = "Continue";
    notice.infoLabel = "Back to Home";
    Command open;
    open.name = "realdebrid";
    notice.playCommand = open;
    Shell shell = StreamShell(store, {notice});
    Scene* scene = shell.StreamScene();
    TextPainter painter;
    scene->Paint(painter);
    REQUIRE(painter.Has("TVM STREAM"));
    REQUIRE(painter.Has("Connect Real-Debrid to watch"));
    REQUIRE(painter.Has("Continue"));
    REQUIRE(painter.Has("Back to Home"));
    shell.Navigate(Direction::Right, 0.0);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("hero-info"));
    shell.Navigate(Direction::Left, 0.0);
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("realdebrid"));
}

}  // namespace
