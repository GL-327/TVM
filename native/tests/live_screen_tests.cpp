// Live TV channel screen tests: what the screen shows for a catalogue and its picks, the top
// buttons and card actions of a scene, and the shell's route to the channel screen. The
// cases follow the rules in apps/ui/src/screens/LiveTV.tsx and LivePicks.tsx.

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "catalog/live.h"
#include "catalog/live_channel.h"
#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "ui/live_tv_view.h"
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/screen_base.h"
#include "ui/shell.h"

namespace {

using tvm::catalog::LiveChannel;
using tvm::live::Catalog;
using tvm::motion::MotionSettings;
using tvm::nav::Direction;
using tvm::ui::CardAction;
using tvm::ui::Command;
using tvm::ui::LiveTvState;
using tvm::ui::LiveTvView;
using tvm::ui::RailData;
using tvm::ui::Scene;
using tvm::ui::SceneView;
using tvm::ui::Shell;
using tvm::ui::TopButton;

LiveChannel Channel(const std::string& id, const std::string& group = "") {
    LiveChannel channel;
    channel.id = id;
    channel.name = "Name " + id;
    channel.url = "";
    if (!group.empty()) channel.group = group;
    return channel;
}

// A source with the channels given, read from a saved playlist.
Catalog PlaylistWith(const std::vector<LiveChannel>& channels) {
    Catalog catalog;
    catalog.playlist = true;
    catalog.channels = channels;
    return catalog;
}

std::vector<LiveChannel> Channels(std::size_t count, const std::string& group = "") {
    std::vector<LiveChannel> channels;
    for (std::size_t i = 0; i < count; ++i) channels.push_back(Channel("live:c" + std::to_string(i), group));
    return channels;
}

LiveTvState Loaded(const Catalog& catalog) {
    LiveTvState state;
    state.loaded = true;
    state.catalog = catalog;
    return state;
}

// Rails of cards with ids "<rail><index>".
RailData RailOf(const std::string& id, std::size_t count) {
    RailData rail;
    rail.id = id;
    rail.title = id;
    for (std::size_t i = 0; i < count; ++i) {
        tvm::ui::CardData card;
        card.itemId = id + std::to_string(i);
        card.title = "Card " + card.itemId;
        rail.cards.push_back(card);
    }
    return rail;
}

Command CommandNamed(const std::string& name, bool action = false) {
    Command command;
    command.name = name;
    command.action = action;
    return command;
}

SceneView ChannelView() {
    SceneView view;
    view.status = "status";
    view.rails = {RailOf("a", 3), RailOf("b", 3)};
    view.topButtons = {TopButton{"Choose channels", CommandNamed("live-choose", true)},
                       TopButton{"Login", CommandNamed("live-xtream")}};
    view.cardAction = CardAction::Play;
    return view;
}

// ---------------------------------------------------------------- the screen

TEST(live_screen_waits_for_the_catalogue) {
    const SceneView view = LiveTvView(LiveTvState{});
    REQUIRE_EQ(view.status, std::string("Loading Live TV..."));
    REQUIRE_EQ(view.topButtons.size(), std::size_t(2));
    REQUIRE_EQ(view.topButtons[0].label, std::string("Login"));
    REQUIRE_EQ(view.topButtons[1].label, std::string("Playlist"));
    REQUIRE(view.rails.empty());
}

TEST(live_screen_asks_for_a_login_when_nothing_is_saved) {
    const SceneView view = LiveTvView(Loaded(Catalog{}));
    REQUIRE_EQ(view.status, std::string("Add a Live TV login, or a playlist you are allowed to use."));
    REQUIRE_EQ(view.topButtons.size(), std::size_t(2));
    REQUIRE_EQ(view.topButtons[0].command.name, std::string("live-xtream"));
    REQUIRE(!view.topButtons[0].command.action);
    REQUIRE_EQ(view.topButtons[1].label, std::string("Playlist"));
}

TEST(live_screen_offers_retry_when_the_source_cannot_be_reached) {
    Catalog catalog;
    catalog.login = true;
    catalog.error = "unreachable";
    const SceneView view = LiveTvView(Loaded(catalog));
    REQUIRE_EQ(view.status, std::string("The channels could not be loaded. Check the connection, then choose Retry."));
    REQUIRE_EQ(view.topButtons.size(), std::size_t(3));
    REQUIRE_EQ(view.topButtons[0].label, std::string("Retry"));
    REQUIRE_EQ(view.topButtons[0].command.name, std::string("live-reload"));
    REQUIRE(view.topButtons[0].command.action);
    REQUIRE(view.rails.empty());
}

TEST(live_screen_says_a_playlist_that_cannot_be_read_is_not_a_source) {
    Catalog catalog;
    catalog.playlist = true;
    catalog.error = "invalid";
    const SceneView view = LiveTvView(Loaded(catalog));
    REQUIRE_EQ(view.status, std::string("No live source connected. The playlist could not be read."));
}

TEST(live_screen_lists_each_group_as_a_rail_and_offers_choosing) {
    std::vector<LiveChannel> channels = {Channel("live:1", "News"), Channel("live:2", "Sport"), Channel("live:3", "News"),
                                         Channel("live:4")};
    const SceneView view = LiveTvView(Loaded(PlaylistWith(channels)));
    REQUIRE_EQ(view.status, std::string("4 of 4 channels on Live TV."));
    // Groups appear in the order their first channel does, and a channel with no group is Live.
    REQUIRE_EQ(view.rails.size(), std::size_t(3));
    REQUIRE_EQ(view.rails[0].title, std::string("News"));
    REQUIRE_EQ(view.rails[0].cards.size(), std::size_t(2));
    REQUIRE_EQ(view.rails[1].title, std::string("Sport"));
    REQUIRE_EQ(view.rails[2].title, std::string("Live"));
    REQUIRE_EQ(view.topButtons[0].label, std::string("Choose channels"));
    REQUIRE_EQ(view.topButtons[0].command.name, std::string("live-choose"));
    REQUIRE(view.topButtons[0].command.action);
    REQUIRE(view.cardAction == CardAction::Play);
}

TEST(live_screen_asks_for_picks_when_the_source_is_too_large) {
    const SceneView view = LiveTvView(Loaded(PlaylistWith(Channels(tvm::live::kPickLimit + 1))));
    REQUIRE_EQ(view.status, std::string("49 channels in the playlist. Choose up to 48 to show here."));
    REQUIRE(view.rails.empty());
    REQUIRE_EQ(view.topButtons[0].command.name, std::string("live-choose"));
}

TEST(live_screen_lists_only_the_picks_once_chosen) {
    LiveTvState state = Loaded(PlaylistWith(Channels(tvm::live::kPickLimit + 1)));
    state.picks = {"live:c7", "live:c2"};
    const SceneView view = LiveTvView(state);
    REQUIRE_EQ(view.status, std::string("2 of 49 channels on Live TV."));
    REQUIRE_EQ(view.rails.size(), std::size_t(1));
    REQUIRE_EQ(view.rails[0].cards.size(), std::size_t(2));
    REQUIRE_EQ(view.rails[0].cards[0].itemId, std::string("live:c7"));
}

TEST(live_screen_choosing_marks_the_picks_and_lists_every_channel) {
    LiveTvState state = Loaded(PlaylistWith(Channels(3)));
    state.choosing = true;
    state.picks = {"live:c1"};
    const SceneView view = LiveTvView(state);
    REQUIRE_EQ(view.status, std::string("1 of 48 on Live TV · 3 in the playlist. Same lineup on this computer and Roku."));
    REQUIRE(view.cardAction == CardAction::TogglePick);
    REQUIRE_EQ(view.topButtons[0].label, std::string("Done"));
    REQUIRE_EQ(view.topButtons[0].command.name, std::string("live-watch"));
    REQUIRE_EQ(view.rails[0].cards.size(), std::size_t(3));
    // The check mark is in front of the picked channel only.
    REQUIRE(view.rails[0].cards[0].title == "Name live:c0");
    REQUIRE(view.rails[0].cards[1].title.rfind("\xE2\x9C\x93 ", 0) == 0);
}

TEST(live_screen_shows_the_refusal_after_the_status) {
    LiveTvState state = Loaded(PlaylistWith(Channels(3)));
    state.choosing = true;
    state.message = "Live TV holds 48 channels. Remove one to add another.";
    const SceneView view = LiveTvView(state);
    REQUIRE(view.status.find("Live TV holds 48 channels. Remove one to add another.") != std::string::npos);
}

TEST(live_screen_choosing_with_nothing_to_choose_says_so) {
    LiveTvState state = Loaded(Catalog{});
    state.choosing = true;
    const SceneView view = LiveTvView(state);
    REQUIRE_EQ(view.status, std::string("Add a live TV login or a playlist first, then choose the channels you watch."));
    REQUIRE(view.rails.empty());
}

TEST(live_screen_offers_the_playlist_in_every_state) {
    LiveTvState choosing = Loaded(PlaylistWith(Channels(3)));
    choosing.choosing = true;
    Catalog unreachable;
    unreachable.login = true;
    unreachable.error = "unreachable";
    const std::vector<SceneView> views = {
        LiveTvView(LiveTvState{}),
        LiveTvView(Loaded(Catalog{})),
        LiveTvView(Loaded(unreachable)),
        LiveTvView(choosing),
        LiveTvView(Loaded(PlaylistWith(Channels(tvm::live::kPickLimit + 1)))),
        LiveTvView(Loaded(PlaylistWith(Channels(3)))),
    };
    for (const SceneView& view : views) {
        const auto playlist = std::find_if(view.topButtons.begin(), view.topButtons.end(),
                                           [](const TopButton& button) { return button.label == "Playlist"; });
        REQUIRE(playlist != view.topButtons.end());
        REQUIRE_EQ(playlist->command.name, std::string("live-playlist"));
        REQUIRE(!playlist->command.action);
    }
}

// ------------------------------------------------------------ the top buttons

TEST(live_scene_top_buttons_move_across_and_run_their_commands) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(ChannelView(), 0.0);
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("card:0:0"));

    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("settings"));
    REQUIRE(!scene.Navigate(Direction::Right, 0.0));
    REQUIRE(scene.Navigate(Direction::Left, 0.0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("top:1"));
    REQUIRE(!scene.Navigate(Direction::Left, 0.0));

    const std::optional<Command> login = scene.Select(0.0);
    REQUIRE(login.has_value());
    REQUIRE_EQ(login->name, std::string("live-xtream"));
    REQUIRE(!login->action);

    REQUIRE(scene.Navigate(Direction::Right, 0.0));
    const std::optional<Command> choose = scene.Select(0.0);
    REQUIRE(choose.has_value());
    REQUIRE_EQ(choose->name, std::string("live-choose"));
    REQUIRE(choose->action);

    REQUIRE(scene.Navigate(Direction::Down, 0.0));
    REQUIRE(scene.FocusedKey()->rfind("card:0:", 0) == 0);
}

TEST(home_has_settings_and_live_tv_at_the_top) {
    Scene scene({{"First", 2}}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    REQUIRE(scene.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(scene.Select(0.0)->name, std::string("settings"));
    REQUIRE(scene.Navigate(Direction::Left, 0.0));
    REQUIRE_EQ(scene.Select(0.0)->name, std::string("live-tv"));
}

TEST(live_scene_keeps_the_title_in_focus_across_a_view_update) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(ChannelView(), 0.0);
    REQUIRE(scene.FocusTitle("b2", 0.0));
    REQUIRE_EQ(scene.FocusedItemId(), std::optional<std::string>("b2"));

    scene.SetView(ChannelView(), 0.0);
    REQUIRE_EQ(scene.FocusedItemId(), std::optional<std::string>("b2"));
}

TEST(live_scene_keeps_a_top_button_in_focus_across_a_view_update) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetView(ChannelView(), 0.0);
    REQUIRE(scene.FocusItem("top:1", 0.0, false));
    scene.SetView(ChannelView(), 0.0);
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("top:1"));
}

TEST(live_scene_page_starts_below_the_status_line_so_they_never_overlap) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    SceneView view = ChannelView();
    view.status = "";
    scene.SetView(view, 0.0);
    const double plain = scene.CardBox(0, 0).y;

    view.status = "6 of 6 channels on Live TV.";
    scene.SetView(view, 0.0);
    // A rem is 16 px at 1080p, and the status row is 2.5 rem.
    REQUIRE_NEAR(scene.CardBox(0, 0).y - plain, 2.5 * 16.0, 0.01);
}

// Records what is drawn, in order, so a test can check what sits on top of what.
class EventPainter final : public tvm::ui::Painter {
public:
    struct Event {
        std::string kind;
        tvm::ui::Box box;
        std::string text;
    };

    void Clear(tvm::ui::Color /*color*/) override { events.push_back(Event{"clear", {}, ""}); }
    void FillRoundRect(const tvm::ui::Box& box, double /*radius*/, tvm::ui::Color /*color*/) override {
        events.push_back(Event{"fill", box, ""});
    }
    void StrokeRoundRect(const tvm::ui::Box& box, double /*radius*/, double /*width*/, tvm::ui::Color /*color*/) override {
        events.push_back(Event{"stroke", box, ""});
    }
    bool Image(const tvm::ui::Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const tvm::ui::Box& box, std::string_view text, const tvm::ui::TextStyle& /*style*/,
                   tvm::ui::Color /*color*/) override {
        events.push_back(Event{"paragraph", box, std::string(text)});
    }
    void Text(const tvm::ui::Box& box, std::string_view text, const tvm::ui::TextStyle& /*style*/,
              tvm::ui::Color /*color*/) override {
        events.push_back(Event{"text", box, std::string(text)});
    }
    void PushClip(const tvm::ui::Box& /*box*/) override {}
    void PopClip() override {}

    std::vector<Event> events;
};

TEST(live_scene_status_line_is_drawn_over_a_band_above_the_page) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    SceneView view = ChannelView();
    view.status = "6 of 6 channels on Live TV.";
    scene.SetView(view, 0.0);

    EventPainter painter;
    scene.Paint(painter);
    std::size_t band = painter.events.size();
    std::size_t status = painter.events.size();
    for (std::size_t i = 0; i < painter.events.size(); ++i) {
        const EventPainter::Event& event = painter.events[i];
        if (event.kind == "fill" && event.box.y == 0.0 && band == painter.events.size()) band = i;
        if (event.kind == "text" && event.text == view.status) status = i;
    }
    REQUIRE(band < painter.events.size());
    // The band covers the header row, which is the safe margin and the status row. At 1080p a rem is 16 px.
    REQUIRE_NEAR(painter.events[band].box.Bottom(), (1.5 + 2.5) * 16.0, 0.01);
    // The page is drawn before the band, and the status line after it, so the band hides scrolled content.
    REQUIRE(status > band);
    REQUIRE(band > 0);
}

TEST(live_scene_without_a_status_line_has_no_band) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    SceneView view = ChannelView();
    view.status = "";
    scene.SetView(view, 0.0);

    EventPainter painter;
    scene.Paint(painter);
    for (const EventPainter::Event& event : painter.events) {
        REQUIRE(!(event.kind == "fill" && event.box.y == 0.0 && event.box.Bottom() > 60.0));
    }
}

TEST(live_scene_a_card_plays_or_toggles_a_pick_by_its_action) {
    Scene scene({}, MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    SceneView view = ChannelView();
    view.cardAction = CardAction::Play;
    scene.SetView(view, 0.0);
    REQUIRE(scene.FocusTitle("a1", 0.0));
    const std::optional<Command> play = scene.Select(0.0);
    REQUIRE(play.has_value());
    REQUIRE_EQ(play->name, std::string("player"));
    REQUIRE(play->modal);
    REQUIRE_EQ(play->params.at("id"), std::string("a1"));

    view.cardAction = CardAction::TogglePick;
    scene.SetView(view, 0.0);
    REQUIRE(scene.FocusTitle("a1", 0.0));
    const std::optional<Command> toggle = scene.Select(0.0);
    REQUIRE(toggle.has_value());
    REQUIRE_EQ(toggle->name, std::string("live-toggle-pick"));
    REQUIRE(toggle->action);
    REQUIRE_EQ(toggle->params.at("id"), std::string("a1"));
}

// ------------------------------------------------------------------ shell

class LiveTvLauncher final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = "live-tv";
        return command;
    }
};

class MemoryStore final : public tvm::ui::PreferenceStore {
public:
    MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const MotionSettings& settings) override { motion_ = settings; }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& /*patch*/) override {}

    MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
};

TEST(shell_opens_the_channel_screen_and_takes_a_view_on_its_scene) {
    MemoryStore store;
    Shell shell(std::make_unique<LiveTvLauncher>(), store);
    shell.Layout(1920.0, 1080.0);
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("live-tv"));

    shell.SetLiveTvView(ChannelView(), 0.0);
    auto* scene = dynamic_cast<Scene*>(&shell.ActiveScreen());
    REQUIRE(scene != nullptr);
    REQUIRE_EQ(scene->FocusedKey(), std::optional<std::string>("card:0:0"));

    // OK on a channel plays it over the screen, as a modal.
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("player"));
}

}  // namespace
