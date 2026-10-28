// Live TV playlist screen tests: what the screen shows for the saved playlist and the pasted
// fields, the focus and the actions of its controls, and the shell's route to it. The rows and
// buttons are laid out as in ui/live_playlist_screen.cpp, at 1080p where a rem is 16 px.

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "catalog/live.h"
#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "ui/live_playlist_screen.h"
#include "ui/preferences_store.h"
#include "ui/screen_base.h"
#include "ui/shell.h"

namespace {

using tvm::motion::MotionSettings;
using tvm::nav::Direction;
using tvm::ui::Command;
using tvm::ui::LivePlaylistScreen;
using tvm::ui::LivePlaylistView;
using tvm::ui::Shell;

// Records the text drawn, so a test can read what is on the screen.
class TextPainter final : public tvm::ui::Painter {
public:
    void Clear(tvm::ui::Color /*color*/) override {}
    void FillRoundRect(const tvm::ui::Box& /*box*/, double /*radius*/, tvm::ui::Color /*color*/) override {}
    void StrokeRoundRect(const tvm::ui::Box& /*box*/, double /*radius*/, double /*width*/,
                         tvm::ui::Color /*color*/) override {}
    bool Image(const tvm::ui::Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const tvm::ui::Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/,
                   tvm::ui::Color /*color*/) override {
        texts.push_back(std::string(text));
    }
    void Text(const tvm::ui::Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/,
              tvm::ui::Color /*color*/) override {
        texts.push_back(std::string(text));
    }
    void PushClip(const tvm::ui::Box& /*box*/) override {}
    void PopClip() override {}

    std::vector<std::string> texts;
};

bool Drawn(const TextPainter& painter, const std::string& text) {
    return std::find(painter.texts.begin(), painter.texts.end(), text) != painter.texts.end();
}

class PlaylistLauncher final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = "live-playlist";
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

// ------------------------------------------------------------------ what it shows

TEST(playlist_screen_shows_dashes_until_the_saved_playlist_is_read) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    const auto facts = screen.Facts();
    REQUIRE_EQ(facts.size(), std::size_t(4));
    REQUIRE_EQ(facts[0].first, std::string("Playlist"));
    REQUIRE_EQ(facts[0].second, std::string("..."));
    REQUIRE_EQ(facts[1].first, std::string("Channels"));
    REQUIRE_EQ(facts[1].second, std::string("..."));
    REQUIRE_EQ(facts[2].second, std::string("Not pasted"));
    REQUIRE_EQ(facts[3].second, std::string("Not pasted"));
}

TEST(playlist_screen_says_what_is_saved_and_what_is_pasted) {
    LivePlaylistScreen screen;
    LivePlaylistView view;
    view.loaded = true;
    view.playlistUrl = std::string("https://example.com/list.m3u");
    view.channels = 12;
    view.addressField = "https://example.com/list.m3u";
    view.textBytes = 2048;
    screen.SetView(view);

    const auto facts = screen.Facts();
    REQUIRE_EQ(facts[0].second, std::string("https://example.com/list.m3u"));
    REQUIRE_EQ(facts[1].second, std::string("12"));
    REQUIRE_EQ(facts[2].second, std::string("https://example.com/list.m3u"));
    REQUIRE_EQ(facts[3].second, std::string("Pasted, 2048 bytes"));
}

TEST(playlist_screen_names_pasted_text_and_a_playlist_that_is_not_added) {
    LivePlaylistScreen screen;
    LivePlaylistView view;
    view.loaded = true;
    view.playlistUrl = std::string(tvm::live::kPastedPlaylist);
    screen.SetView(view);
    REQUIRE_EQ(screen.Facts()[0].second, std::string("Pasted on this machine"));

    view.playlistUrl.reset();
    view.channels = 0;
    screen.SetView(view);
    REQUIRE_EQ(screen.Facts()[0].second, std::string("Not added"));
    REQUIRE_EQ(screen.Facts()[1].second, std::string("0"));
}

TEST(playlist_screen_draws_its_rows_message_and_buttons) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    LivePlaylistView view;
    view.loaded = true;
    view.message = "Playlist removed.";
    screen.SetView(view);

    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(Drawn(painter, "Add a playlist"));
    REQUIRE(Drawn(painter, "Playlist removed."));
    REQUIRE(Drawn(painter, "Save playlist"));
    REQUIRE(Drawn(painter, "Remove"));
    REQUIRE(Drawn(painter, "Open Live TV"));
    REQUIRE(Drawn(painter, "Not added"));
}

// ------------------------------------------------------------- focus and actions

TEST(playlist_screen_focus_moves_between_the_rows_and_stays_in_the_grid) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("address"));
    REQUIRE(!screen.Navigate(Direction::Up, 0.0));
    REQUIRE(!screen.Navigate(Direction::Left, 0.0));

    REQUIRE(screen.Navigate(Direction::Down, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("text"));
    REQUIRE(screen.Navigate(Direction::Down, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("save"));
    REQUIRE(!screen.Navigate(Direction::Down, 0.0));

    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("clear"));
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("open"));
    REQUIRE(!screen.Navigate(Direction::Right, 0.0));

    REQUIRE(screen.Navigate(Direction::Left, 0.0));
    REQUIRE(screen.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("text"));
    REQUIRE(screen.Navigate(Direction::Up, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("address"));
}

TEST(playlist_screen_controls_run_their_action_commands) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);

    const std::optional<Command> paste = screen.ActivateItem("address", 0.0);
    REQUIRE(paste.has_value());
    REQUIRE_EQ(paste->name, std::string("live-playlist-paste-address"));
    REQUIRE(paste->action);

    const std::optional<Command> text = screen.ActivateItem("text", 0.0);
    REQUIRE(text.has_value());
    REQUIRE_EQ(text->name, std::string("live-playlist-paste-text"));
    REQUIRE(text->action);

    const std::optional<Command> save = screen.ActivateItem("save", 0.0);
    REQUIRE(save.has_value());
    REQUIRE_EQ(save->name, std::string("live-playlist-save"));
    REQUIRE(save->action);

    const std::optional<Command> clear = screen.ActivateItem("clear", 0.0);
    REQUIRE(clear.has_value());
    REQUIRE_EQ(clear->name, std::string("live-playlist-clear"));
    REQUIRE(clear->action);

    // Open Live TV is a screen, so the shell pushes it rather than an action running.
    const std::optional<Command> open = screen.ActivateItem("open", 0.0);
    REQUIRE(open.has_value());
    REQUIRE_EQ(open->name, std::string("live-tv"));
    REQUIRE(!open->action);
}

TEST(playlist_screen_select_acts_on_the_focused_control) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    REQUIRE(screen.Navigate(Direction::Down, 0.0));
    REQUIRE(screen.Navigate(Direction::Down, 0.0));
    const std::optional<Command> save = screen.Select(0.0);
    REQUIRE(save.has_value());
    REQUIRE_EQ(save->name, std::string("live-playlist-save"));
}

TEST(playlist_screen_waits_while_a_request_is_in_flight) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    LivePlaylistView view;
    view.loaded = true;
    view.busy = true;
    screen.SetView(view);

    REQUIRE(!screen.ActivateItem("address", 0.0).has_value());
    REQUIRE(!screen.ActivateItem("save", 0.0).has_value());
    REQUIRE(!screen.ActivateItem("clear", 0.0).has_value());

    TextPainter busy;
    screen.Paint(busy);
    REQUIRE(Drawn(busy, "Saving..."));
    REQUIRE(!Drawn(busy, "Save playlist"));

    view.busy = false;
    screen.SetView(view);
    REQUIRE(screen.ActivateItem("save", 0.0).has_value());
    TextPainter idle;
    screen.Paint(idle);
    REQUIRE(Drawn(idle, "Save playlist"));
}

TEST(playlist_screen_clicks_land_on_the_controls_they_show) {
    LivePlaylistScreen screen;
    screen.Layout(1920.0, 1080.0);
    // At 16 px to a rem: the address row is 264 to 304 px, the text row 312 to 352 px, and the
    // buttons 392 to 448 px. Save, Remove and Open Live TV sit side by side along that row.
    REQUIRE_EQ(screen.ItemAt(100.0, 284.0), std::optional<std::string>("address"));
    REQUIRE_EQ(screen.ItemAt(100.0, 332.0), std::optional<std::string>("text"));
    REQUIRE_EQ(screen.ItemAt(100.0, 420.0), std::optional<std::string>("save"));
    REQUIRE_EQ(screen.ItemAt(400.0, 420.0), std::optional<std::string>("clear"));
    REQUIRE_EQ(screen.ItemAt(700.0, 420.0), std::optional<std::string>("open"));
    REQUIRE(!screen.ItemAt(100.0, 20.0).has_value());
}

// ------------------------------------------------------------------- the shell

TEST(shell_opens_the_playlist_screen_and_takes_a_view_on_it) {
    MemoryStore store;
    Shell shell(std::make_unique<PlaylistLauncher>(), store);
    shell.Layout(1920.0, 1080.0);
    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("live-playlist"));

    LivePlaylistView view;
    view.loaded = true;
    view.channels = 7;
    shell.SetLivePlaylistView(view);
    auto* screen = dynamic_cast<LivePlaylistScreen*>(&shell.ActiveScreen());
    REQUIRE(screen != nullptr);
    REQUIRE(screen->view() == view);
    REQUIRE_EQ(screen->Facts()[1].second, std::string("7"));
}

}  // namespace
