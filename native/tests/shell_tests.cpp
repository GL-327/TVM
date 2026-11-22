// Shell, screen and input tests. These run the real home scene, settings and
// details screens through the shell, with a memory preference store, so no
// test touches the real data folder.

#include <cmath>
#include <optional>
#include <string>
#include <vector>

#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "nav/pointer.h"
#include "ui/details_screen.h"
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
    tvm::ui::GlassClarity Glass() const override { return glass_; }
    void SaveGlass(tvm::ui::GlassClarity clarity) override { glass_ = clarity; ++glassSaves; }

    MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
    int motionSaves = 0;
    int coreSaves = 0;
    tvm::ui::Theme theme_ = tvm::ui::Theme::Dark;
    int themeSaves = 0;
    tvm::ui::GlassClarity glass_ = tvm::ui::GlassClarity::Clear;
    int glassSaves = 0;
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
        "Picture", "Motion", "Performance mode",
        "Look", "Theme", "Liquid Glass",
        "Language", "App language",
        "Account", "Your account", "Privacy & terms", "Plan", "Profiles", "Choose profile on launch", "Real-Debrid",
        // What's new is the native build's way to the changelog, which the web shows only after it updates itself.
        "Device", "Network", "Display", "Live TV login", "Live TV playlist", "Updates", "Check for updates on launch",
        "What's new", "Diagnostics", "Developer",
        "Maintenance", "Clear cache", "Fully reset", "Restart",
    };
    REQUIRE(settings.RowLabels() == expected);
}

TEST(settings_focus_starts_on_motion) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("motion"));
}

TEST(settings_motion_toggles_between_auto_and_reduced_and_saves) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    REQUIRE(settings.DetailOf("motion") == "Auto · UI animates");
    REQUIRE(!settings.Select(0.0).has_value());
    REQUIRE(store.motion_.preference == MotionPreference::Reduced);
    REQUIRE(settings.DetailOf("motion") == "Reduced · freeze decorative loops");

    (void)settings.Select(0.0);
    REQUIRE(store.motion_.preference == MotionPreference::Auto);
    REQUIRE_EQ(store.motionSaves, 2);
}

TEST(settings_performance_mode_toggles_and_saves) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("performance", 0.0, false));
    (void)settings.Select(0.0);
    REQUIRE(store.motion_.performanceMode);
    REQUIRE(settings.DetailOf("performance") == "On · simpler effects and motion");
}

TEST(settings_navigation_skips_groups_and_information_rows) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);

    REQUIRE(settings.Navigate(Direction::Down, 0.0));  // Motion -> Performance
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("performance"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));  // Skips the Look heading.
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("themes"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("glass"));
    REQUIRE(settings.Navigate(Direction::Down, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("language"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("glass"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("themes"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("performance"));
    REQUIRE(settings.Navigate(Direction::Up, 0.0));
    REQUIRE(settings.FocusedKey() == std::optional<std::string>("motion"));
    REQUIRE(!settings.Navigate(Direction::Up, 0.0));  // Nothing above the first row.
}

TEST(settings_language_cycles_in_the_web_order_and_saves) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("language", 0.0, false));

    REQUIRE(settings.DetailOf("language") == "English");
    (void)settings.Select(0.0);
    REQUIRE(store.core_.language == "es");
    REQUIRE(settings.DetailOf("language") == "Español");
    REQUIRE(store.coreSaves == 1);
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

TEST(settings_switches_liquid_glass_between_clear_and_frosted) {
    MemoryStore store;
    SettingsScreen settings(store, MotionSettings{});
    settings.Layout(1920.0, 1080.0);
    REQUIRE(settings.FocusItem("glass", 0.0, false));
    REQUIRE(settings.DetailOf("glass").rfind("Clear", 0) == 0);
    (void)settings.Select(0.0);
    REQUIRE(store.glass_ == tvm::ui::GlassClarity::Frosted);
    REQUIRE_EQ(store.glassSaves, 1);
    REQUIRE(settings.DetailOf("glass").rfind("Frosted", 0) == 0);
    SettingsScreen reopened(store, MotionSettings{});
    REQUIRE(reopened.DetailOf("glass").rfind("Frosted", 0) == 0);
    (void)settings.Select(0.0);
    REQUIRE(store.glass_ == tvm::ui::GlassClarity::Clear);
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

    // Motion is the first focusable row, so OK changes it.
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

TEST(managing_renames_and_deletes_only_after_confirming) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1920.0, 1080.0);
    chooser.SetView(ThreeProfiles());
    REQUIRE(!chooser.ActivateItem("manage", 0.0).has_value());
    REQUIRE(chooser.Editing());
    // In edit mode a profile opens its sheet with its name.
    REQUIRE(!chooser.ActivateItem("pick:a", 0.0).has_value());
    REQUIRE(chooser.SheetOpen());
    REQUIRE_EQ(chooser.SheetName(), std::string("Ana"));
    chooser.Erase();
    chooser.Type("ya");
    const std::optional<Command> rename = chooser.ActivateItem("sheet-save", 0.0);
    REQUIRE_EQ(rename->name, std::string("profile-rename"));
    REQUIRE_EQ(rename->params.at("id"), std::string("a"));
    REQUIRE_EQ(rename->params.at("name"), std::string("Anya"));
    REQUIRE(!chooser.SheetOpen());
    // Delete asks first.
    chooser.ActivateItem("pick:c", 0.0);
    REQUIRE(!chooser.ActivateItem("sheet-delete", 0.0).has_value());
    const std::optional<Command> remove = chooser.ActivateItem("sheet-delete", 0.0);
    REQUIRE_EQ(remove->name, std::string("profile-remove"));
    REQUIRE_EQ(remove->params.at("id"), std::string("c"));
}

TEST(the_last_profile_cannot_be_deleted_and_names_stop_at_24_characters) {
    tvm::ui::ProfileChooser chooser;
    chooser.Layout(1920.0, 1080.0);
    tvm::ui::ChooserView view;
    view.profiles = {{"only", "Profile 1", 221}};
    view.activeId = "only";
    chooser.SetView(view);
    chooser.ActivateItem("manage", 0.0);
    chooser.ActivateItem("pick:only", 0.0);
    REQUIRE((chooser.Keys() == std::vector<std::string>{"sheet-save", "sheet-cancel"}));
    chooser.Type(std::string(40, 'x'));
    REQUIRE_EQ(chooser.SheetName().size(), std::size_t{24});
    // An empty name is not saved.
    chooser.ActivateItem("sheet-cancel", 0.0);
    chooser.ActivateItem("add", 0.0);
    REQUIRE(!chooser.ActivateItem("sheet-save", 0.0).has_value());
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
