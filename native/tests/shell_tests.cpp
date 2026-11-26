// Shell, screen and input tests. These run the real home scene, settings and
// details screens through the shell, with a memory preference store, so no
// test touches the real data folder.

#include <cmath>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "nav/pointer.h"
#include "ui/details_screen.h"
#include "ui/downloads_screen.h"
#include "ui/pending_screen.h"
#include "ui/profile_chooser.h"
#include "ui/scene.h"
#include "ui/screen_base.h"
#include "ui/settings_screen.h"
#include "ui/shell.h"

namespace {

using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;
using tvm::nav::Axis;
using tvm::nav::Direction;
using tvm::nav::WheelMode;
using tvm::ui::Command;
using tvm::ui::DetailsScreen;
using tvm::ui::PendingScreen;
using tvm::ui::PreferenceStore;
using tvm::ui::RailSpec;
using tvm::ui::Scene;
using tvm::ui::ScreenBase;
using tvm::ui::SettingsScreen;
using tvm::ui::Shell;

// Keeps every preference in memory, and counts the saves.
class MemoryStore final : public PreferenceStore {
public:
    MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const MotionSettings& settings) override {
        motion_ = settings;
        ++motionSaves;
    }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& patch) override {
        if (patch.language.has_value()) core_.language = *patch.language;
        if (patch.autoUpdate.has_value()) core_.autoUpdate = *patch.autoUpdate;
        ++coreSaves;
    }
    tvm::ui::Theme Look() const override { return theme_; }
    void SaveLook(tvm::ui::Theme theme) override { theme_ = theme; ++themeSaves; }
    tvm::ui::UiFont Font() const override { return font_; }
    void SetFont(tvm::ui::UiFont font) override { font_ = font; ++fontSaves; }
    bool ReduceTransparency() const override { return reduceTransparency_; }
    void SetReduceTransparency(bool on) override { reduceTransparency_ = on; ++reduceTransparencySaves; }

    MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
    int motionSaves = 0;
    int coreSaves = 0;
    tvm::ui::Theme theme_ = tvm::ui::Theme::Dark;
    int themeSaves = 0;
    tvm::ui::UiFont font_ = tvm::ui::UiFont::Geist;
    int fontSaves = 0;
    bool reduceTransparency_ = false;
    int reduceTransparencySaves = 0;
};

// A root screen whose OK opens Settings. It records the motion it is given, so
// tests can see a change reach the home screen.
class SettingsLauncher final : public ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = "settings";
        return command;
    }
    void SetMotion(const MotionSettings& settings) override {
        ScreenBase::SetMotion(settings);
        received = settings;
    }

    MotionSettings received;
};

// Two rails of five cards: the 1080p reference layout.
std::vector<RailSpec> SmallRails() {
    return {{"First", 5}, {"Second", 5}};
}

std::unique_ptr<Scene> MakeScene(const std::vector<RailSpec>& rails) {
    auto scene = std::make_unique<Scene>(rails, MotionSettings{});
    scene->Layout(1920.0, 1080.0);
    return scene;
}

double Settle(Shell& shell, double nowMs) {
    for (int frame = 0; frame < 2000 && shell.Animating(); ++frame) {
        nowMs += 16.0;
        shell.Tick(nowMs);
    }
    return nowMs;
}

std::vector<std::string> Names(const Shell& shell) {
    std::vector<std::string> names;
    for (const auto& entry : shell.stack().entries) names.push_back(entry.name);
    return names;
}

Shell MakeShell(PreferenceStore& store, const std::vector<RailSpec>& rails = SmallRails()) {
    Shell shell(MakeScene(rails), store);
    shell.Layout(1920.0, 1080.0);
    return shell;
}

// The centre of a card on the home screen.
tvm::ui::Box CardOf(Scene& scene, std::size_t rail, std::size_t index) {
    return scene.CardBox(rail, index);
}

// ------------------------------------------------------------- settings rows

TEST(settings_lists_the_web_rows_in_order) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    const std::vector<std::string> expected = {
        "Picture", "Performance mode",
        "Look", "Theme", "Font", "Reduce transparency", "Reduce motion",
        "Language", "App language",
        "Playback", "TVM Extras", "Your stats", "Account", "Your account", "Privacy & terms", "Plan", "Profiles", "Choose profile on launch", "Streaming services", "Real-Debrid",
        // What's new is the native build's way to the changelog, which the web shows only after it updates itself.
        "Device", "Network", "Display", "Live TV login", "Live TV playlist", "Updates", "Check for updates on launch",
        "What's new", "Diagnostics",
        "Maintenance", "Clear cache", "Fully reset", "Restart",
    };
    REQUIRE(settings.RowLabels() == expected);
}

TEST(settings_surfaces_developer_diagnostics_when_dev_account_active) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    tvm::ui::DeveloperDiagnostics diag;
    diag.active = true;
    diag.buildVersion = "v1.0.0 · Native Windows";
    diag.rdTokenSource = "account";
    settings.SetDeveloperDiagnostics(diag);

    const std::vector<std::string> labels = settings.RowLabels();
    REQUIRE(std::find(labels.begin(), labels.end(), "Developer Diagnostics") != labels.end());
    REQUIRE_EQ(settings.DetailOf("dev-build"), std::string("v1.0.0 · Native Windows"));
    REQUIRE_EQ(settings.DetailOf("dev-rd-source"), std::string("account"));
    REQUIRE_EQ(settings.DetailOf("dev-glass"), std::string("Liquid Glass"));

    const std::optional<Command> refresh = settings.ActivateItem("dev-refresh-cache", 0.0);
    REQUIRE(refresh.has_value());
    REQUIRE_EQ(refresh->name, std::string("dev-refresh-cache"));
    REQUIRE(refresh->action);
}

TEST(settings_focus_starts_on_first_row) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("performance"));
}

TEST(settings_motion_toggles_between_auto_and_reduced_and_saves) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("motion", 0.0, false));

    REQUIRE(settings.DetailOf("motion") == "Off · full animation");
    REQUIRE(!settings.Select(0.0).has_value());
    REQUIRE(store.motion_.preference == MotionPreference::Reduced);
    REQUIRE(settings.DetailOf("motion") == "On · simpler animation");

    (void)settings.Select(0.0);
    REQUIRE(store.motion_.preference == MotionPreference::Auto);
    REQUIRE_EQ(store.motionSaves, 2);
}

TEST(settings_performance_mode_toggles_and_saves) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("performance"));
    (void)settings.Select(0.0);
    REQUIRE(store.motion_.performanceMode);
    REQUIRE(settings.DetailOf("performance") == "On · simpler effects and motion");
}

TEST(settings_navigation_skips_groups_and_information_rows) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    REQUIRE(settings.Navigate(Direction::Down, 0.0));  // Skips the Look heading.
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("themes"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("font"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("reduce-transparency"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("motion"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("language"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("motion"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("reduce-transparency"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("font"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("themes"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("performance"));
    REQUIRE(!settings.Navigate(Direction::Up, 0.0));  // Nothing above the first row.
}

TEST(settings_language_opens_a_list_and_saves_the_pick) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("language", 0.0, false));
    REQUIRE(settings.DetailOf("language") == "English");

    // OK opens the list of the nine supported languages on the current one, without leaving the page.
    REQUIRE(!settings.Select(0.0).has_value());
    REQUIRE(settings.LanguageList().IsOpen());
    REQUIRE_EQ(settings.LanguageList().Count(), std::size_t{9});
    REQUIRE_EQ(settings.LanguageList().Selected(), std::size_t{0});
    REQUIRE_EQ(store.coreSaves, 0);
    // Down twice reaches Français; OK saves it and closes the list.
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(!settings.Select(0.0).has_value());
    REQUIRE(!settings.LanguageList().IsOpen());
    REQUIRE(store.core_.language == "fr");
    REQUIRE(settings.DetailOf("language") == "Fran\xC3\xA7" "ais");
    REQUIRE_EQ(store.coreSaves, 1);
}

TEST(settings_language_list_closes_on_back_and_on_a_click_outside) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    settings.FocusItem("language", 0.0, false);
    settings.Select(0.0);
    // Back closes the list and keeps the page.
    REQUIRE(settings.CloseOverlay(0.0));
    REQUIRE(!settings.LanguageList().IsOpen());
    REQUIRE(!settings.CloseOverlay(0.0));
    REQUIRE(store.core_.language == "en");
    // Opened again, a click on a row picks it; a click elsewhere closes it.
    settings.Select(0.0);
    const tvm::ui::Box row = *settings.LanguageList().RowBox(1);
    const std::optional<std::string> key = settings.ItemAt(row.CenterX(), row.CenterY());
    REQUIRE(key == std::optional<std::string>("lang:1"));
    settings.ActivateItem(*key, 0.0);
    REQUIRE(store.core_.language == "es");
    settings.Select(0.0);
    REQUIRE(settings.ItemAt(5.0, 5.0) == std::optional<std::string>("lang-dismiss"));
    settings.ActivateItem("lang-dismiss", 0.0);
    REQUIRE(!settings.LanguageList().IsOpen());
}

TEST(settings_automatic_updates_toggle_and_save) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("auto-update", 0.0, false));

    REQUIRE(settings.DetailOf("auto-update") == "On · check when this app opens");
    (void)settings.Select(0.0);
    REQUIRE(!store.core_.autoUpdate);
    REQUIRE(settings.DetailOf("auto-update") == "Off · check from Updates");
}

TEST(settings_cycles_fonts_and_toggles_reduce_transparency) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920, 1080);

    REQUIRE(settings.FocusItem("font", 0, false));
    REQUIRE_EQ(settings.DetailOf("font"), std::string("Geist"));
    (void)settings.Select(0);
    REQUIRE(store.font_ == tvm::ui::UiFont::Inter);
    REQUIRE_EQ(settings.DetailOf("font"), std::string("Inter"));
    (void)settings.Select(0);
    REQUIRE(store.font_ == tvm::ui::UiFont::System);
    SettingsScreen reopened(store, MotionSettings{});
    REQUIRE_EQ(reopened.DetailOf("font"), std::string("System"));
    (void)settings.Select(0);
    REQUIRE(store.font_ == tvm::ui::UiFont::Geist);
    REQUIRE_EQ(store.fontSaves, 3);

    REQUIRE(settings.FocusItem("reduce-transparency", 0, false));
    REQUIRE_EQ(settings.DetailOf("reduce-transparency"), std::string("Off · Liquid Glass"));
    (void)settings.Select(0);
    REQUIRE(store.reduceTransparency_);
    REQUIRE_EQ(settings.DetailOf("reduce-transparency"), std::string("On · solid surfaces"));
    REQUIRE_EQ(store.reduceTransparencySaves, 1);
}

TEST(settings_switches_the_saved_theme_and_keeps_it_on_reopen) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(390, 844);
    REQUIRE(settings.FocusItem("themes", 0, false));
    settings.Select(0);
    REQUIRE(store.theme_ == tvm::ui::Theme::Light);
    REQUIRE_EQ(store.themeSaves, 1);
    SettingsScreen reopened(store, MotionSettings{});
    REQUIRE_EQ(reopened.DetailOf("themes"), std::string("Light"));
}

TEST(settings_rows_open_the_screens_they_name) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    REQUIRE(settings.FocusItem("privacy", 0.0, false));
    const auto privacy = settings.Select(0.0);
    REQUIRE(privacy.has_value());
    REQUIRE(privacy->name == "legal");
    REQUIRE(!privacy->modal);

    REQUIRE(settings.FocusItem("network", 0.0, false));
    const auto network = settings.Select(0.0);
    REQUIRE(network->name == "system-info");
    REQUIRE(network->params.at("section") == "network");
}

TEST(settings_destructive_rows_open_a_confirmation_dialog) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    REQUIRE(settings.FocusItem("factory-reset", 0.0, false));
    const auto reset = settings.Select(0.0);
    REQUIRE(reset.has_value());
    REQUIRE(reset->modal);
    REQUIRE(reset->name == "confirm");
    REQUIRE(reset->params.at("action") == "factory-reset");
    REQUIRE(reset->params.at("confirmLabel") == "Fully reset");
    // Nothing is removed until the confirmation exists, so nothing changed here.
    REQUIRE_EQ(store.coreSaves, 0);
}

TEST(settings_scrolls_the_page_to_reach_the_last_row) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 720.0);
    REQUIRE(settings.FocusItem("restart", 0.0, true));
    double now = 0.0;
    while (settings.Animating()) {
        now += 16.0;
        settings.Tick(now);
    }
    const auto surface = settings.SurfaceAt(100.0, 300.0, Axis::Y);
    REQUIRE(surface.has_value());
    REQUIRE(surface->scroll > 0.0);
    REQUIRE(surface->canPan);
}

// ----------------------------------------------------------- details, pending

TEST(details_play_asks_the_shell_to_open_the_player) {
    DetailsScreen details("card:0:0", "Title 1.1");
    details.Layout(1920.0, 1080.0);
    REQUIRE(details.FocusedKey() == std::optional<std::string>("play"));
    const auto command = details.Select(0.0);
    REQUIRE(command.has_value());
    REQUIRE(command->name == "player");
    REQUIRE(command->params.at("id") == "card:0:0");
}

TEST(pending_screens_have_nothing_to_focus) {
    PendingScreen pending("legal", false);
    pending.Layout(1920.0, 1080.0);
    REQUIRE(!pending.FocusedKey().has_value());
    REQUIRE(!pending.Select(0.0).has_value());
    REQUIRE(!pending.ItemAt(10.0, 10.0).has_value());
}

// ------------------------------------------------------------------- shell

TEST(shell_starts_at_home_and_back_at_the_root_is_refused) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    REQUIRE(!shell.Back(0.0));
}

TEST(shell_select_on_a_title_opens_its_details) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    shell.Select(0.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details"}));
    const auto& params = shell.stack().entries.back().params;
    REQUIRE(params.at("id") == "card:0:0");
    REQUIRE(params.at("title") == "Title 1.1");
}

TEST(shell_back_returns_home_with_the_focus_it_had) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    shell.Navigate(Direction::Right, 0.0);
    shell.Select(0.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details"}));

    REQUIRE(shell.Back(0.0));
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    REQUIRE(shell.ActiveScreen().FocusedKey() == std::optional<std::string>("card:0:1"));
}

TEST(shell_play_opens_the_player_placeholder_and_back_unwinds) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    shell.Select(0.0);
    shell.Select(0.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details", "player"}));
    REQUIRE(shell.Back(0.0));
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details"}));
    REQUIRE(shell.Back(0.0));
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
}

TEST(shell_opens_settings_and_a_motion_change_reaches_the_home_screen) {
    MemoryStore store;
    auto launcher = std::make_unique<SettingsLauncher>();
    SettingsLauncher* root = launcher.get();
    Shell shell(std::move(launcher), store);
    shell.Layout(1920.0, 1080.0);

    shell.Select(0.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "settings"}));

    // Down four times walks from Performance mode to Reduce motion, then OK toggles it.
    for (int i = 0; i < 4; ++i) shell.Navigate(Direction::Down, 0.0);
    shell.Select(0.0);
    REQUIRE(store.motion_.preference == MotionPreference::Reduced);
    REQUIRE(root->received.preference == MotionPreference::Reduced);
}

TEST(the_settings_button_opens_settings_and_back_returns_to_it) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    REQUIRE(shell.ActiveScreen().FocusedKey() == std::optional<std::string>("card:0:0"));
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});

    shell.Navigate(Direction::Up, 0.0);
    REQUIRE(shell.ActiveScreen().FocusedKey() == std::optional<std::string>("settings"));
    shell.Select(0.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "settings"}));

    REQUIRE(shell.Back(0.0));
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    REQUIRE(shell.ActiveScreen().FocusedKey() == std::optional<std::string>("settings"));
}

TEST(clicking_the_settings_button_opens_settings) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    // The button is in the header, at the top right of the 1920x1080 window.
    const double x = 1920.0 - 40.0 - 160.0 + 80.0;
    const double y = 24.0 + 16.0;
    shell.MouseDown(x, y, 0.0);
    shell.MouseUp(x, y, 10.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "settings"}));
}

// ------------------------------------------------------------------- pointer

TEST(cursor_is_hidden_until_the_mouse_moves) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    REQUIRE(!shell.CursorVisible());
    shell.MouseMove(100.0, 100.0, false, 0.0);
    REQUIRE(shell.CursorVisible());
    shell.KeyPressed();
    REQUIRE(!shell.CursorVisible());
}

TEST(hovering_a_card_focuses_it_without_moving_the_camera) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 0, 2);
    shell.MouseMove(card.CenterX(), card.CenterY(), false, 0.0);
    shell.MouseMove(card.CenterX() + 10.0, card.CenterY(), false, 0.0);
    REQUIRE(shell.ActiveScreen().FocusedKey() == std::optional<std::string>("card:0:2"));
    // A hover focuses without a camera move, so the rails and page stay put.
    REQUIRE_NEAR(scene.RailScroll(0), 0.0, 1e-9);
    REQUIRE_NEAR(scene.PageScroll(), 0.0, 1e-9);
}

TEST(clicking_a_card_opens_its_details) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    const tvm::ui::Box card = CardOf(dynamic_cast<Scene&>(shell.ActiveScreen()), 0, 1);
    shell.MouseDown(card.CenterX(), card.CenterY(), 0.0);
    shell.MouseUp(card.CenterX(), card.CenterY(), 10.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details"}));
    REQUIRE(shell.stack().entries.back().params.at("id") == "card:0:1");
}

TEST(dragging_from_a_card_does_not_open_it) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    const tvm::ui::Box card = CardOf(dynamic_cast<Scene&>(shell.ActiveScreen()), 0, 1);
    shell.MouseDown(card.CenterX(), card.CenterY(), 0.0);
    shell.MouseMove(card.CenterX() - 200.0, card.CenterY(), true, 10.0);
    shell.MouseUp(card.CenterX() - 200.0, card.CenterY(), 20.0);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
}

TEST(shift_wheel_over_a_rail_moves_that_rail) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 3, 0);
    shell.Wheel(card.CenterX(), card.CenterY(), 0.0, 100.0, true, WheelMode::Pixel, 0.0);
    Settle(shell, 0.0);
    REQUIRE_NEAR(scene.RailScroll(3), 100.0, 1e-6);
    REQUIRE_NEAR(scene.PageScroll(), 0.0, 1e-6);
}

TEST(wheel_over_the_page_scrolls_the_page) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"D", 5}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    // Above the first rail, where only the page is under the pointer.
    shell.Wheel(100.0, 40.0, 0.0, 100.0, false, WheelMode::Pixel, 0.0);
    Settle(shell, 0.0);
    REQUIRE_NEAR(scene.PageScroll(), 100.0, 1e-6);
}

TEST(a_mouse_drag_along_a_rail_slides_it_and_does_not_open_a_card) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 3, 4);
    shell.MouseDown(card.CenterX(), card.CenterY(), 0.0);
    shell.MouseMove(card.CenterX() - 100.0, card.CenterY(), true, 100.0);
    shell.MouseMove(card.CenterX() - 300.0, card.CenterY(), true, 400.0);
    REQUIRE_NEAR(scene.RailScroll(3), 300.0, 1e-6);
    shell.MouseUp(card.CenterX() - 300.0, card.CenterY(), 2000.0);
    Settle(shell, 2000.0);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    REQUIRE(scene.RailScroll(3) >= 300.0 - 1e-6);
    // The page did not move.
    REQUIRE_NEAR(scene.PageScroll(), 0.0, 1e-6);
}

TEST(rail_arrow_clicks_during_a_glide_add_up_and_never_pull_the_rail_back) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 20}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 3, 2);
    shell.MouseMove(card.CenterX(), card.CenterY(), false, 0.0);
    shell.MouseMove(card.CenterX() + 4.0, card.CenterY(), false, 0.0);
    const tvm::ui::Box next = *scene.RailArrowBox(3, true);
    // Over the arrow, only the arrow is lit: the poster under the pointer lets its hover go.
    shell.MouseMove(next.CenterX(), next.CenterY(), false, 10.0);
    // Two quick clicks, the second while the first glide runs, with a hand that wobbles past the pan slop.
    shell.MouseDown(next.CenterX(), next.CenterY(), 20.0);
    shell.MouseUp(next.CenterX(), next.CenterY(), 30.0);
    shell.Tick(60.0);
    const double midway = scene.RailScroll(3);
    shell.MouseDown(next.CenterX(), next.CenterY(), 80.0);
    shell.MouseMove(next.CenterX() + 6.0, next.CenterY(), true, 90.0);
    REQUIRE(scene.RailScroll(3) >= midway - 1e-6);
    shell.MouseUp(next.CenterX() + 6.0, next.CenterY(), 100.0);
    Settle(shell, 100.0);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    // Both steps count: the rail went forward by two steps (or to its end), not one, and never back.
    const double step = scene.RailBox(3).width * 0.85;
    REQUIRE(scene.RailScroll(3) > step * 1.01);
    // The back arrow only ever goes back.
    const double before = scene.RailScroll(3);
    const tvm::ui::Box back = *scene.RailArrowBox(3, false);
    shell.MouseMove(back.CenterX(), back.CenterY(), false, 3000.0);
    shell.MouseDown(back.CenterX(), back.CenterY(), 3000.0);
    shell.MouseUp(back.CenterX(), back.CenterY(), 3010.0);
    Settle(shell, 3010.0);
    REQUIRE(scene.RailScroll(3) < before);
}


TEST(a_rails_arrows_show_only_where_it_can_move_and_step_it_to_its_ends) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 3, 2);
    shell.MouseMove(card.CenterX(), card.CenterY(), false, 0.0);
    shell.MouseMove(card.CenterX() + 4.0, card.CenterY(), false, 0.0);
    REQUIRE(scene.ArrowRail() == std::optional<std::size_t>(3));
    // At the start only the forward arrow shows. A rail that fits has none.
    REQUIRE(!scene.RailArrowBox(3, false).has_value());
    REQUIRE(scene.RailArrowBox(3, true).has_value());
    REQUIRE(!scene.RailArrowBox(0, true).has_value());
    // Clicking it steps the rail along, without opening the card under it.
    double now = 1000.0;
    for (int i = 0; i < 6; ++i) {
        const std::optional<tvm::ui::Box> next = scene.RailArrowBox(3, true);
        if (!next.has_value()) break;
        shell.MouseMove(next->CenterX(), next->CenterY(), false, now);
        shell.MouseDown(next->CenterX(), next->CenterY(), now);
        shell.MouseUp(next->CenterX(), next->CenterY(), now + 10.0);
        now = Settle(shell, now + 10.0) + 10.0;
    }
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
    // It stops at the end: the forward arrow has gone, the back arrow shows.
    REQUIRE(!scene.RailArrowBox(3, true).has_value());
    REQUIRE(scene.RailArrowBox(3, false).has_value());
    const double end = scene.RailScroll(3);
    REQUIRE(end > 0.0);
    const tvm::ui::Box back = *scene.RailArrowBox(3, false);
    shell.MouseMove(back.CenterX(), back.CenterY(), false, now);
    shell.MouseDown(back.CenterX(), back.CenterY(), now);
    shell.MouseUp(back.CenterX(), back.CenterY(), now + 10.0);
    Settle(shell, now + 10.0);
    REQUIRE(scene.RailScroll(3) < end);
}

TEST(touch_tap_opens_the_card_under_the_finger) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    const tvm::ui::Box card = CardOf(dynamic_cast<Scene&>(shell.ActiveScreen()), 0, 3);
    shell.TouchDown(7, card.CenterX(), card.CenterY(), 0.0);
    shell.TouchUp(7, card.CenterX() + 2.0, card.CenterY(), 50.0);
    REQUIRE(Names(shell) == (std::vector<std::string>{"home", "details"}));
    REQUIRE(shell.stack().entries.back().params.at("id") == "card:0:3");
}

TEST(touch_drag_pans_the_rail_under_the_finger_and_does_not_tap) {
    MemoryStore store;
    Shell shell = MakeShell(store, {{"A", 5}, {"B", 5}, {"C", 5}, {"Long", 12}});
    auto& scene = dynamic_cast<Scene&>(shell.ActiveScreen());
    const tvm::ui::Box card = CardOf(scene, 3, 4);
    shell.TouchDown(7, card.CenterX(), card.CenterY(), 0.0);
    shell.TouchMove(7, card.CenterX() - 200.0, card.CenterY(), 16.0);
    shell.TouchUp(7, card.CenterX() - 200.0, card.CenterY(), 300.0);
    REQUIRE_NEAR(scene.RailScroll(3), 200.0, 1e-6);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
}

TEST(a_cancelled_touch_opens_nothing) {
    MemoryStore store;
    Shell shell = MakeShell(store);
    const tvm::ui::Box card = CardOf(dynamic_cast<Scene&>(shell.ActiveScreen()), 0, 0);
    shell.TouchDown(7, card.CenterX(), card.CenterY(), 0.0);
    shell.TouchCancel();
    shell.TouchUp(7, card.CenterX(), card.CenterY(), 20.0);
    REQUIRE(Names(shell) == std::vector<std::string>{"home"});
}


// ------------------------------------------------------------ who's watching

tvm::ui::ChooserView ThreeProfiles() {
    tvm::ui::ChooserView view;
    view.profiles = {{"a", "Ana", 210}, {"b", "ben", 30}, {"c", "Cy", 300}};
    view.activeId = "b";
    view.max = 4;
    return view;
}

TEST(the_chooser_opens_on_the_active_profile_and_picks_with_its_animation) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1920.0, 1080.0);
    chooser.SetView(ThreeProfiles());
    REQUIRE(chooser.FocusedKey() == std::optional<std::string>("pick:b"));
    // Three profiles and Add Profile, then Manage profiles.
    REQUIRE((chooser.Keys() == std::vector<std::string>{"pick:a", "pick:b", "pick:c", "add", "manage"}));
    REQUIRE(chooser.Navigate(Direction::Right, 0.0));
    REQUIRE(chooser.FocusedKey() == std::optional<std::string>("pick:c"));
    REQUIRE(chooser.Navigate(Direction::Down, 0.0));
    REQUIRE(chooser.FocusedKey() == std::optional<std::string>("manage"));
    REQUIRE(chooser.Navigate(Direction::Up, 0.0));
    const std::optional<Command> pick = chooser.ActivateItem("pick:a", 100.0);
    REQUIRE_EQ(pick->name, std::string("profile-open"));
    REQUIRE_EQ(pick->params.at("id"), std::string("a"));
    REQUIRE_EQ(pick->params.at("from"), std::string("chooser"));
    chooser.Tick(100.0);
    REQUIRE(chooser.Animating());
    chooser.Tick(100.0 + tvm::ui::ProfileChooser::kPickMs);
    REQUIRE(!chooser.Animating());
}

TEST(the_chooser_hides_add_at_the_plans_limit) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1280.0, 720.0);
    tvm::ui::ChooserView view = ThreeProfiles();
    view.max = 3;
    chooser.SetView(view);
    REQUIRE((chooser.Keys() == std::vector<std::string>{"pick:a", "pick:b", "pick:c", "manage"}));
}

TEST(managing_a_profile_opens_the_full_editor) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1920, 1080);
    chooser.SetView(ThreeProfiles());
    REQUIRE(!chooser.ActivateItem("manage", 0).has_value());
    REQUIRE(chooser.Editing());
    const auto edit = chooser.ActivateItem("pick:a", 0);
    REQUIRE(edit.has_value());
    REQUIRE_EQ(edit->name, std::string("profile-edit"));
    REQUIRE_EQ(edit->params.at("id"), std::string("a"));
}

TEST(adding_from_the_chooser_opens_a_blank_profile_editor) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1920, 1080);
    chooser.SetView(ThreeProfiles());
    const auto add = chooser.ActivateItem("add", 0);
    REQUIRE(add.has_value());
    REQUIRE_EQ(add->name, std::string("profile-edit"));
    REQUIRE(!add->params.contains("id") || add->params.at("id").empty());
}

TEST(the_orb_menu_switches_profile_or_closes_from_outside) {
    tvm::ui::ProfileMenu menu;
    menu.Layout(1920.0, 1080.0);
    menu.SetView(ThreeProfiles());
    REQUIRE(menu.FocusedKey() == std::optional<std::string>("switch:b"));
    REQUIRE((menu.Keys() == std::vector<std::string>{"switch:a", "switch:b", "switch:c", "menu-manage", "menu-settings"}));
    const std::optional<Command> pick = menu.ActivateItem("switch:c", 0.0);
    REQUIRE_EQ(pick->name, std::string("profile-open"));
    REQUIRE_EQ(pick->params.at("from"), std::string("menu"));
    // The panel sits at the top right, and a click off it closes the menu.
    const tvm::ui::Box panel = menu.PanelBox();
    REQUIRE(panel.Right() > 1700.0);
    const std::optional<std::string> outside = menu.ItemAt(200.0, 900.0);
    REQUIRE(outside.has_value());
    REQUIRE_EQ(menu.ActivateItem(*outside, 0.0)->name, std::string("back"));
    // The pick left the focus on Cy; Down reaches Manage profiles.
    REQUIRE(menu.Navigate(Direction::Down, 0.0));
    REQUIRE(menu.FocusedKey() == std::optional<std::string>("menu-manage"));
}


// ------------------------------------------------------------ series details: season picker

tvm::ui::TitleInfo ThreeSeasons() {
    tvm::ui::TitleInfo info;
    info.state = tvm::ui::TitleInfo::State::Ready;
    info.id = info.media.id = "tt5";
    info.title = "A Series";
    info.kind = info.media.kind = "series";
    for (const int season : {1, 2, 3, 0}) {
        for (int episode = 1; episode <= (season == 2 ? 4 : 2); ++episode) {
            tvm::catalog::MediaItem child;
            child.id = "tt5:" + std::to_string(season) + ":" + std::to_string(episode);
            child.title = "Episode " + std::to_string(episode);
            child.kind = "episode";
            child.season = season;
            child.episode = episode;
            info.children.push_back(child);
        }
    }
    return info;
}

TEST(a_series_shows_one_season_picker_and_its_list_switches_the_episodes) {
    tvm::ui::DetailsScreen details("tt5", "A Series");
    details.Layout(1920.0, 1080.0);
    details.SetInfo(ThreeSeasons());
    // The page opens on the picker, showing season 1; there are no season pills.
    REQUIRE(details.FocusedKey() == std::optional<std::string>("season-menu"));
    REQUIRE(details.BoxOf("season-menu").has_value());
    REQUIRE(!details.BoxOf("season:2").has_value());
    REQUIRE_EQ(details.Season(), 1);
    REQUIRE_EQ(details.Episodes().size(), std::size_t{2});

    // OK opens the list of every season, Specials last, on the current one.
    REQUIRE(!details.Select(0.0).has_value());
    REQUIRE(details.SeasonList().IsOpen());
    REQUIRE_EQ(details.SeasonList().Count(), std::size_t{4});
    REQUIRE_EQ(details.SeasonList().Selected(), std::size_t{0});
    // Down picks season 2, whose four episodes then show.
    REQUIRE(details.Navigate(Direction::Down, 0.0));
    REQUIRE(!details.Select(0.0).has_value());
    REQUIRE(!details.SeasonList().IsOpen());
    REQUIRE_EQ(details.Season(), 2);
    REQUIRE_EQ(details.Episodes().size(), std::size_t{4});
    REQUIRE(details.FocusedKey() == std::optional<std::string>("season-menu"));

    // Down reaches the first episode, Up comes back to the picker, and Up again the buttons.
    REQUIRE(details.Navigate(Direction::Down, 0.0));
    REQUIRE(details.FocusedKey() == std::optional<std::string>("ep:0"));
    REQUIRE(details.Navigate(Direction::Up, 0.0));
    REQUIRE(details.FocusedKey() == std::optional<std::string>("season-menu"));
}

TEST(the_season_list_takes_the_mouse_and_closes_on_back_or_outside) {
    tvm::ui::DetailsScreen details("tt5", "A Series");
    details.Layout(1920.0, 1080.0);
    details.SetInfo(ThreeSeasons());
    const tvm::ui::Box picker = *details.BoxOf("season-menu");
    REQUIRE(details.ItemAt(picker.CenterX(), picker.CenterY()) == std::optional<std::string>("season-menu"));
    details.ActivateItem("season-menu", 0.0);
    REQUIRE(details.SeasonList().IsOpen());
    // Back closes only the list.
    REQUIRE(details.CloseOverlay(0.0));
    REQUIRE(!details.SeasonList().IsOpen());
    // A click on the Specials row picks it.
    details.ActivateItem("season-menu", 0.0);
    const tvm::ui::Box specials = *details.SeasonList().RowBox(3);
    const std::optional<std::string> key = details.ItemAt(specials.CenterX(), specials.CenterY());
    REQUIRE(key.has_value());
    details.ActivateItem(*key, 0.0);
    REQUIRE_EQ(details.Season(), 0);
    // A click elsewhere closes it without a pick.
    details.ActivateItem("season-menu", 0.0);
    REQUIRE(details.ItemAt(5.0, 1000.0) == std::optional<std::string>("season-dismiss"));
    details.ActivateItem("season-dismiss", 0.0);
    REQUIRE(!details.SeasonList().IsOpen());
    REQUIRE_EQ(details.Season(), 0);
}


// ------------------------------------------------------------ downloads

tvm::ui::DownloadsView SeriesDownload() {
    tvm::ui::DownloadsView view;
    view.title = "A Series";
    view.subtitle = "Series \xC2\xB7 8 episodes";
    view.choices = {{"scope", "Download", {"Full series", "One season", "One episode"}, 1},
                    {"season", "Season", {"Season 1", "Season 2"}, 0},
                    {"language", "Audio", {"English", "Original / any language", "Japanese"}, 0},
                    {"quality", "Highest quality", {"Up to 480p", "Up to 720p", "Up to 1080p", "Up to 4K"}, 2}};
    view.folder = "C:\\Users\\viewer\\Downloads\\TVM";
    view.startLabel = "Download 4 episodes \xC2\xB7 English \xC2\xB7 up to 1080p";
    view.startEnabled = true;
    view.note = "Only English audio is downloaded.";
    tvm::ui::DownloadJobView running;
    running.id = 7;
    running.title = "A Series S1E1";
    running.state = "downloading";
    running.progress = 0.42;
    running.status = "420 MB of 1.0 GB";
    running.canCancel = true;
    tvm::ui::DownloadJobView done;
    done.id = 6;
    done.title = "A Film";
    done.state = "complete";
    done.status = "C:\\Users\\viewer\\Downloads\\TVM\\A Film.mkv";
    done.canShow = true;
    view.jobs = {running, done};
    return view;
}

TEST(downloads_opens_on_the_download_button_and_sends_the_old_commands) {
    tvm::ui::DownloadsScreen downloads;
    downloads.Layout(1920.0, 1080.0);
    downloads.SetView(SeriesDownload());
    REQUIRE(downloads.FocusedKey() == std::optional<std::string>("start"));
    REQUIRE_EQ(downloads.Select(0.0)->name, std::string("info:dl-start"));
    REQUIRE_EQ(downloads.ActivateItem("folder", 0.0)->name, std::string("info:dl-folder"));
    REQUIRE_EQ(downloads.ActivateItem("cancel:7", 0.0)->name, std::string("info:dl-cancel-7"));
    REQUIRE_EQ(downloads.ActivateItem("show:6", 0.0)->name, std::string("info:dl-show-6"));
    REQUIRE_EQ(downloads.ActivateItem("close", 0.0)->name, std::string("back"));
    // A finished download has no Cancel, a running one no Show file.
    REQUIRE(!downloads.BoxOf("cancel:6").has_value());
    REQUIRE(!downloads.BoxOf("show:7").has_value());
}

TEST(downloads_choices_open_a_list_and_a_pick_sends_its_row) {
    tvm::ui::DownloadsScreen downloads;
    downloads.Layout(1920.0, 1080.0);
    downloads.SetView(SeriesDownload());
    REQUIRE(!downloads.ActivateItem("choice:quality", 0.0).has_value());
    REQUIRE(downloads.List().IsOpen());
    REQUIRE_EQ(downloads.List().Count(), std::size_t{4});
    REQUIRE_EQ(downloads.List().Selected(), std::size_t{2});
    REQUIRE(downloads.Navigate(Direction::Down, 0.0));
    const std::optional<Command> pick = downloads.Select(0.0);
    REQUIRE_EQ(pick->name, std::string("info:dl-set-quality"));
    REQUIRE_EQ(pick->params.at("index"), std::string("3"));
    REQUIRE(!downloads.List().IsOpen());
    // Back closes an open list and keeps the page.
    downloads.ActivateItem("choice:language", 0.0);
    REQUIRE(downloads.CloseOverlay(0.0));
    REQUIRE(!downloads.List().IsOpen());
}

TEST(downloads_waits_on_a_disabled_button_and_shows_an_empty_list) {
    tvm::ui::DownloadsScreen downloads;
    downloads.Layout(1280.0, 720.0);
    tvm::ui::DownloadsView view = SeriesDownload();
    view.startEnabled = false;
    view.jobs.clear();
    downloads.SetView(view);
    REQUIRE(!downloads.ActivateItem("start", 0.0).has_value());
    // Every choice, the folder and the button are reachable with the arrows from Close.
    std::set<std::string> seen;
    REQUIRE(downloads.FocusItem("close", 0.0, false));
    for (int i = 0; i < 12; ++i) {
        seen.insert(*downloads.FocusedKey());
        downloads.Navigate(i % 2 == 0 ? Direction::Down : Direction::Left, 0.0);
    }
    REQUIRE(seen.contains("choice:scope"));
    REQUIRE(seen.contains("start"));
    // The page without a title is just the list.
    tvm::ui::DownloadsScreen list;
    list.Layout(1920.0, 1080.0);
    list.SetView(tvm::ui::DownloadsView{});
    REQUIRE(list.FocusedKey() == std::optional<std::string>("close"));
    REQUIRE(!list.BoxOf("start").has_value());
}

}  // namespace

TEST(shell_navigation_guard_blocks_screens_and_actions_before_dispatch) {
    MemoryStore store;
    auto home = std::make_unique<Scene>(std::vector<RailSpec>{}, store.Motion());
    Shell shell(std::move(home), store);
    shell.Layout(1280, 720);
    int actions = 0;
    shell.SetActionHandler([&](const Command&) { ++actions; });
    shell.SetNavigationGuard([](const Command& command) { return command.name == "account"; });
    Command command; command.name = "player";
    shell.Execute(command, 0);
    REQUIRE_EQ(shell.ActiveScreenName(), "home");
    command.action = true; command.name = "watchlist";
    shell.Execute(command, 0);
    REQUIRE_EQ(actions, 0);
    command.action = false; command.name = "account";
    shell.Execute(command, 0);
    REQUIRE_EQ(shell.ActiveScreenName(), "account");
}
