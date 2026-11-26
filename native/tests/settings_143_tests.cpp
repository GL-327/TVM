// Settings 1.4.3: the preference rows and the controls they use, the search field, Back out of the content pane, the
// guide's re-poll while Core downloads a feed, the patch notes sheet's scrolling, and the profile editor's sets row.

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "harness.h"
#include "ui/guide_view.h"
#include "ui/profile_editor.h"
#include "ui/settings_screen.h"
#include "ui/shell.h"

namespace {

using tvm::motion::MotionSettings;
using tvm::nav::Direction;
using tvm::ui::CoreSettings;
using tvm::ui::SettingsScreen;

class SettingsStore final : public tvm::ui::PreferenceStore {
public:
    MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const MotionSettings& settings) override { motion_ = settings; }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& patch) override {
        if (patch.language.has_value()) core_.language = *patch.language;
        if (patch.autoUpdate.has_value()) core_.autoUpdate = *patch.autoUpdate;
    }
    std::string SleepTimerDefault() const override { return sleep_; }
    void SaveSleepTimerDefault(const std::string& value) override { sleep_ = value; }
    bool SpotlightEvents() const override { return spotlight_; }
    void SaveSpotlightEvents(bool on) override { spotlight_ = on; }

    MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
    std::string sleep_ = "off";
    bool spotlight_ = true;
};

// A Settings screen at 1080p that records every patch it sends.
struct Page {
    SettingsStore store;
    SettingsScreen screen{store, MotionSettings{}};
    std::vector<nlohmann::json> patches;

    Page() {
        screen.Layout(1920.0, 1080.0);
        screen.SetPrefsSink([this](const nlohmann::json& patch) { patches.push_back(patch); });
    }
};

bool Has(const std::vector<std::string>& list, const std::string& value) {
    return std::find(list.begin(), list.end(), value) != list.end();
}

}  // namespace

TEST(core_settings_read_prefs_with_defaults_for_what_is_missing) {
    const CoreSettings empty = CoreSettings::FromJson(nlohmann::json::object());
    REQUIRE_EQ(empty.Get("quality"), std::string("original"));
    REQUIRE_EQ(empty.Get("skipUpscaled"), std::string("1"));
    REQUIRE_EQ(empty.Get("subtitleStyle.background"), std::string("shadow"));
    REQUIRE_EQ(empty.Get("extras.themeSongs"), std::string("0"));
    REQUIRE_EQ(empty.Get("extras.trailers"), std::string("1"));

    const CoreSettings read = CoreSettings::FromJson(nlohmann::json::parse(R"({
        "quality": "1080", "autoplayNext": false, "skipSegments": "auto",
        "subtitleStyle": {"size": "xl", "color": "cyan"},
        "extras": {"trailers": false, "themeSongs": true, "bogus": true},
        "subtitleLanguages": ["eng", "fra"]})"));
    REQUIRE_EQ(read.Get("quality"), std::string("1080"));
    REQUIRE_EQ(read.Get("autoplayNext"), std::string("0"));
    REQUIRE_EQ(read.Get("skipSegments"), std::string("auto"));
    REQUIRE_EQ(read.Get("subtitleStyle.size"), std::string("xl"));
    REQUIRE_EQ(read.Get("subtitleStyle.color"), std::string("cyan"));
    REQUIRE_EQ(read.Get("subtitleStyle.background"), std::string("shadow"));
    REQUIRE_EQ(read.Get("extras.trailers"), std::string("0"));
    REQUIRE_EQ(read.Get("extras.themeSongs"), std::string("1"));
    REQUIRE((read.subtitleLanguages == std::vector<std::string>{"eng", "fra"}));
}

TEST(core_settings_patches_use_the_keys_and_values_core_expects) {
    REQUIRE(CoreSettings::Patch("quality", "2160") == nlohmann::json::parse(R"({"quality":"2160"})"));
    REQUIRE(CoreSettings::Patch("skipUpscaled", "0") == nlohmann::json::parse(R"({"skipUpscaled":false})"));
    REQUIRE(CoreSettings::Patch("skipSegments", "auto") == nlohmann::json::parse(R"({"skipSegments":"auto"})"));
    REQUIRE(CoreSettings::Patch("subtitleStyle.size", "xl") == nlohmann::json::parse(R"({"subtitleStyle":{"size":"xl"}})"));
    REQUIRE(CoreSettings::Patch("extras.trailers", "0") == nlohmann::json::parse(R"({"extras":{"trailers":false}})"));
    REQUIRE(CoreSettings::Patch("heroPreviews", "1") == nlohmann::json::parse(R"({"heroPreviews":true})"));
}

TEST(settings_playback_rows_follow_the_spec) {
    Page page;
    page.screen.ActivateItem("cat:playback", 0.0);
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"quality", "skip-upscaled", "audio-language", "autoplay-next",
                                                                  "skip-segments", "sleep-default"}));
    REQUIRE_EQ(page.screen.ValueOf("quality"), std::string("Original \xE2\x80\x93 best available"));
    REQUIRE_EQ(page.screen.ValueOf("audio-language"), std::string("Original language"));
    REQUIRE_EQ(page.screen.ValueOf("skip-segments"), std::string("Button"));
    REQUIRE_EQ(page.screen.ValueOf("skip-upscaled"), std::string("On"));
}

TEST(a_segmented_preference_steps_with_the_arrows_and_sets_with_a_click) {
    Page page;
    page.screen.ActivateItem("cat:playback", 0.0);
    REQUIRE(page.screen.FocusItem("skip-segments", 0.0, false));
    REQUIRE(page.screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(page.screen.ValueOf("skip-segments"), std::string("Automatic"));
    REQUIRE_EQ(page.patches.size(), std::size_t{1});
    REQUIRE(page.patches[0] == nlohmann::json::parse(R"({"skipSegments":"auto"})"));
    // The last segment has nothing further right; Left steps back.
    REQUIRE(page.screen.Navigate(Direction::Left, 0.0));
    REQUIRE(page.patches[1] == nlohmann::json::parse(R"({"skipSegments":"button"})"));
    page.screen.ActivateItem("skip-segments#0", 0.0);
    REQUIRE_EQ(page.screen.ValueOf("skip-segments"), std::string("Off"));
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"skipSegments":"off"})"));
    // OK steps on to the next choice and wraps round.
    (void)page.screen.Select(0.0);
    REQUIRE_EQ(page.screen.ValueOf("skip-segments"), std::string("Button"));
}

TEST(a_switch_preference_toggles_and_sends_a_boolean) {
    Page page;
    page.screen.ActivateItem("cat:playback", 0.0);
    page.screen.FocusItem("autoplay-next", 0.0, false);
    (void)page.screen.Select(0.0);
    REQUIRE_EQ(page.screen.ValueOf("autoplay-next"), std::string("Off"));
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"autoplayNext":false})"));
    (void)page.screen.Select(0.0);
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"autoplayNext":true})"));

    page.screen.ActivateItem("cat:extras", 0.0);
    page.screen.FocusItem("extra-trailers", 0.0, false);
    (void)page.screen.Select(0.0);
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"extras":{"trailers":false}})"));
    REQUIRE_EQ(page.screen.ValueOf("extra-trailers"), std::string("Off"));
}

TEST(a_select_preference_opens_a_list_and_saves_the_pick) {
    Page page;
    page.screen.ActivateItem("cat:playback", 0.0);
    page.screen.FocusItem("quality", 0.0, false);
    REQUIRE(!page.screen.Select(0.0).has_value());
    REQUIRE(page.screen.LanguageList().IsOpen());
    REQUIRE_EQ(page.screen.LanguageList().Count(), std::size_t{5});
    REQUIRE(page.patches.empty());
    REQUIRE(page.screen.Navigate(Direction::Down, 0.0));
    REQUIRE(page.screen.Navigate(Direction::Down, 0.0));
    (void)page.screen.Select(0.0);
    REQUIRE(!page.screen.LanguageList().IsOpen());
    REQUIRE_EQ(page.screen.ValueOf("quality"), std::string("1080p"));
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"quality":"1080"})"));
}

TEST(the_sleep_timer_default_and_spotlight_events_stay_on_this_pc) {
    Page page;
    page.screen.ActivateItem("cat:playback", 0.0);
    page.screen.FocusItem("sleep-default", 0.0, false);
    (void)page.screen.Select(0.0);
    REQUIRE_EQ(page.screen.LanguageList().Count(), std::size_t{6});
    page.screen.Navigate(Direction::Down, 0.0);
    page.screen.Navigate(Direction::Down, 0.0);
    (void)page.screen.Select(0.0);
    REQUIRE_EQ(page.store.sleep_, std::string("30"));
    REQUIRE_EQ(page.screen.ValueOf("sleep-default"), std::string("30 minutes"));
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"sleepTimerDefault":"30"})"));

    page.screen.ActivateItem("cat:home", 0.0);
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"hero-previews", "spotlight-events"}));
    page.screen.FocusItem("spotlight-events", 0.0, false);
    (void)page.screen.Select(0.0);
    REQUIRE(!page.store.spotlight_);
    // A screen opened later reads both from the store.
    SettingsScreen later(page.store, MotionSettings{});
    REQUIRE_EQ(later.ValueOf("spotlight-events"), std::string("Off"));
    REQUIRE_EQ(later.ValueOf("sleep-default"), std::string("30 minutes"));
}

TEST(audio_and_subtitle_rows_hold_the_subtitle_style) {
    Page page;
    page.screen.ActivateItem("cat:audio", 0.0);
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"subtitle-mode", "subtitle-languages", "subtitle-size",
                                                                  "subtitle-color", "subtitle-back", "audio-night"}));
    page.screen.SetCoreSettings(CoreSettings::FromJson(nlohmann::json::parse(
        R"({"subtitleMode":"always","subtitleStyle":{"size":"l","color":"yellow","background":"box"},"subtitleLanguages":["eng","fra"]})")));
    REQUIRE_EQ(page.screen.ValueOf("subtitle-mode"), std::string("Always"));
    REQUIRE_EQ(page.screen.ValueOf("subtitle-size"), std::string("L"));
    REQUIRE_EQ(page.screen.DetailOf("subtitle-languages"), std::string("English, French"));
    page.screen.ActivateItem("subtitle-color#2", 0.0);
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"subtitleStyle":{"color":"cyan"}})"));
    // The languages page is still the way to change the list.
    page.screen.FocusItem("subtitle-languages", 0.0, false);
    const auto command = page.screen.Select(0.0);
    REQUIRE(command.has_value());
    REQUIRE_EQ(command->name, std::string("extras-settings"));
}

TEST(the_extras_page_has_a_switch_for_every_extra_with_its_note) {
    Page page;
    page.screen.ActivateItem("cat:extras", 0.0);
    const std::vector<std::string> keys = page.screen.ShownKeys();
    REQUIRE_EQ(keys.size(), std::size_t{22});
    for (const char* id : {"onlineSubtitles", "trailers", "trailerBackdrops", "collections", "comingUp", "watchStats",
                           "animeTitles", "ratings", "qualityBadges", "versionPicker", "chapters", "seekPreviews",
                           "themeSongs", "spoilerBlur", "surpriseMe", "autoCollections", "sleepTimer", "nightMode",
                           "pauseOnMinimize", "shortcutsOverlay", "webhook", "announcements"}) {
        REQUIRE(Has(keys, std::string("extra-") + id));
    }
    // The defaults are those in Core: theme songs, spoiler blur, night mode and the webhook start off.
    REQUIRE_EQ(page.screen.ValueOf("extra-themeSongs"), std::string("Off"));
    REQUIRE_EQ(page.screen.ValueOf("extra-chapters"), std::string("On"));
}

TEST(searching_filters_the_rows_of_every_category_as_you_type) {
    Page page;
    REQUIRE(!page.screen.Typing());
    page.screen.ActivateItem("search", 0.0);
    REQUIRE(page.screen.Typing());
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("search"));
    page.screen.Type("night");
    REQUIRE_EQ(page.screen.Query(), std::string("night"));
    // Night mode is in Audio & subtitles and in Extras: both are listed.
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"audio-night", "extra-nightMode"}));
    page.screen.Erase();
    page.screen.Erase();
    page.screen.Erase();
    REQUIRE_EQ(page.screen.Query(), std::string("ni"));
    REQUIRE(Has(page.screen.ShownKeys(), "audio-night"));
    // Typed words match the label and the description, in any case.
    page.screen.Type("ght mode reduce LOUD");
    REQUIRE_EQ(page.screen.Query(), std::string("night mode reduce LOUD"));
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"audio-night"}));
    page.screen.Erase();
    for (int i = 0; i < 20; ++i) page.screen.Erase();
    // Nothing typed shows the open category again.
    REQUIRE(Has(page.screen.ShownKeys(), "account"));
    page.screen.Type("zzzz");
    REQUIRE(page.screen.ShownKeys().empty());
    REQUIRE(page.screen.ShownLabels().empty());
}

TEST(a_search_can_be_entered_with_the_keys_and_its_rows_work) {
    Page page;
    REQUIRE(page.screen.Navigate(Direction::Left, 0.0));  // To the category list.
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("cat:account"));
    REQUIRE(page.screen.Navigate(Direction::Up, 0.0));  // Above the first category is the search field.
    REQUIRE(page.screen.Typing());
    page.screen.Type("autoplay");
    REQUIRE((page.screen.ShownKeys() == std::vector<std::string>{"autoplay-next"}));
    REQUIRE(page.screen.Navigate(Direction::Down, 0.0));  // Into the result.
    REQUIRE(!page.screen.Typing());
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("autoplay-next"));
    (void)page.screen.Select(0.0);
    REQUIRE(page.patches.back() == nlohmann::json::parse(R"({"autoplayNext":false})"));
    // Back goes up to the field; Back there clears the words; Back again goes to the categories.
    REQUIRE(page.screen.CloseOverlay(0.0));
    REQUIRE(page.screen.Typing());
    REQUIRE(page.screen.CloseOverlay(0.0));
    REQUIRE(page.screen.Query().empty());
    REQUIRE(page.screen.Typing());
    REQUIRE(page.screen.CloseOverlay(0.0));
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("cat:account"));
    REQUIRE(!page.screen.CloseOverlay(0.0));
}

TEST(choosing_a_category_ends_the_search) {
    Page page;
    page.screen.ActivateItem("search", 0.0);
    page.screen.Type("night");
    page.screen.ActivateItem("cat:livetv", 0.0);
    REQUIRE(page.screen.Query().empty());
    REQUIRE(Has(page.screen.ShownKeys(), "livetv"));
}

TEST(clicking_away_from_the_search_field_stops_the_typing) {
    Page page;
    page.screen.ActivateItem("search", 0.0);
    REQUIRE(page.screen.Typing());
    page.screen.PressedElsewhere(std::optional<std::string>("account"), 0.0);
    REQUIRE(!page.screen.Typing());
    // Typing while it is not focused changes nothing.
    page.screen.Type("abc");
    REQUIRE(page.screen.Query().empty());
}

TEST(back_from_the_rows_returns_to_the_category_list_once_they_were_used) {
    Page page;
    // Straight after opening, Back leaves Settings.
    REQUIRE(!page.screen.CloseOverlay(0.0));
    page.screen.ActivateItem("cat:profiles", 0.0);
    REQUIRE(page.screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("profiles"));
    REQUIRE(page.screen.CloseOverlay(0.0));
    REQUIRE_EQ(page.screen.FocusedKey(), std::optional<std::string>("cat:profiles"));
    REQUIRE(!page.screen.CloseOverlay(0.0));
}

TEST(every_row_is_reachable_by_the_keyboard_in_every_category) {
    Page page;
    for (const char* id : {"account", "profiles", "playback", "audio", "appearance", "home", "extras", "livetv",
                           "realdebrid", "downloads", "updates", "stats", "about"}) {
        page.screen.ActivateItem(std::string("cat:") + id, 0.0);
        const std::vector<std::string> keys = page.screen.ShownKeys();
        REQUIRE(!keys.empty());
        REQUIRE(page.screen.Navigate(Direction::Right, 0.0));
        std::vector<std::string> visited{*page.screen.FocusedKey()};
        while (page.screen.Navigate(Direction::Down, 0.0)) visited.push_back(*page.screen.FocusedKey());
        REQUIRE(visited == keys);
    }
}

// ------------------------------------------------------------------------------------------------ guide

TEST(the_guide_asks_again_while_core_is_still_downloading_a_feed) {
    using tvm::guide::ShouldRepoll;
    REQUIRE(ShouldRepoll(true, 0));
    REQUIRE(ShouldRepoll(true, tvm::guide::kMaxRepolls - 1));
    REQUIRE(!ShouldRepoll(true, tvm::guide::kMaxRepolls));
    REQUIRE(!ShouldRepoll(false, 0));
    REQUIRE_NEAR(tvm::guide::kRepollMs, 4000.0, 1e-9);
    REQUIRE_EQ(tvm::guide::kMaxRepolls, 30);

    const auto body = nlohmann::json::parse(R"({"start":"2026-11-26T12:00:00Z","end":"2026-11-26T18:00:00Z","refreshing":true,"channels":[]})");
    REQUIRE(tvm::guide::ParseSchedule(body, 0, 0).refreshing);
    REQUIRE(!tvm::guide::ParseSchedule(nlohmann::json::parse(R"({"channels":[]})"), 0, 0).refreshing);
    REQUIRE(!tvm::guide::ParseSchedule(nlohmann::json::array(), 0, 0).refreshing);
}

TEST(a_guide_answer_that_fills_in_keeps_the_focused_cell) {
    using namespace tvm::guide;
    const Time noon = *ParseTime("2026-11-26T12:00:00Z");
    const auto schedule = [&](bool filled) {
        Schedule data;
        data.start = noon;
        data.end = noon + 12 * 3600;
        data.refreshing = !filled;
        for (const char* id : {"a", "b", "c"}) {
            Channel channel;
            channel.id = id;
            channel.name = id;
            channel.number = id;
            if (filled) channel.programmes.push_back({noon, noon + 7200, std::string("Show ") + id, "", "", "", "", ""});
            data.channels.push_back(std::move(channel));
        }
        return data;
    };
    View view;
    view.Layout(1920, 1080);
    view.SetSchedule(schedule(false), noon);
    view.Navigate(View::Move::Down);
    view.Navigate(View::Move::Down);
    view.Navigate(View::Move::Right);
    REQUIRE_EQ(view.SelectedId(), std::string("c"));
    const Time cursor = view.cursor();
    const Time start = view.start();
    // The repoll's answer replaces the schedule; the channel, the time and the window stay.
    view.SetSchedule(schedule(true), noon);
    REQUIRE_EQ(view.SelectedId(), std::string("c"));
    REQUIRE_EQ(view.cursor(), cursor);
    REQUIRE_EQ(view.start(), start);
}

// ------------------------------------------------------------------------------------------ patch notes

namespace {
tvm::ui::Shell::PatchNotes LongNotes(int changes) {
    tvm::ui::Shell::PatchNotes notes;
    notes.version = "1.4.3";
    notes.title = "Settings search and switches";
    notes.highlights = {"Settings has a search field and a switch for every extra."};
    for (int i = 0; i < changes; ++i) {
        notes.changes.push_back({i < changes / 2 ? "Settings" : "Playback", "Change number " + std::to_string(i) + " has a line of its own.",
                                 {"windows", "web"}});
    }
    notes.knownIssues = {"The row order list on Home is not on Windows yet."};
    return notes;
}

struct ShellFixture {
    SettingsStore store;
    tvm::ui::Shell shell;
    ShellFixture() : shell(std::make_unique<tvm::ui::SettingsScreen>(store, MotionSettings{}), store) { shell.Layout(1280.0, 720.0); }
};
}  // namespace

TEST(patch_notes_scroll_inside_their_sheet_and_stop_at_both_ends) {
    ShellFixture fixture;
    fixture.shell.SetPatchNotes(LongNotes(30));
    const double max = fixture.shell.PatchMaxScroll();
    REQUIRE(max > 100.0);
    REQUIRE_NEAR(fixture.shell.PatchScroll(), 0.0, 1e-9);
    REQUIRE(!fixture.shell.ScrollPatchNotes(-50.0));
    REQUIRE(fixture.shell.ScrollPatchNotes(120.0));
    REQUIRE_NEAR(fixture.shell.PatchScroll(), 120.0, 1e-9);
    REQUIRE(fixture.shell.ScrollPatchNotes(1e9));
    REQUIRE_NEAR(fixture.shell.PatchScroll(), max, 1e-9);
    REQUIRE(!fixture.shell.ScrollPatchNotes(10.0));
    REQUIRE(fixture.shell.ScrollPatchNotes(-1e9));
    REQUIRE_NEAR(fixture.shell.PatchScroll(), 0.0, 1e-9);
    // A page is a good part of the body, so two reach further than one.
    const double page = fixture.shell.PatchBodyBox().height * 0.85;
    fixture.shell.ScrollPatchNotes(page);
    fixture.shell.ScrollPatchNotes(page);
    REQUIRE_NEAR(fixture.shell.PatchScroll(), std::min(max, 2.0 * page), 1e-6);
}

TEST(short_patch_notes_do_not_scroll_and_a_new_sheet_starts_at_the_top) {
    ShellFixture fixture;
    fixture.shell.SetPatchNotes(LongNotes(1));
    REQUIRE_NEAR(fixture.shell.PatchMaxScroll(), 0.0, 1e-9);
    REQUIRE(!fixture.shell.ScrollPatchNotes(100.0));
    fixture.shell.SetPatchNotes(LongNotes(40));
    fixture.shell.ScrollPatchNotes(300.0);
    REQUIRE(fixture.shell.PatchScroll() > 0.0);
    fixture.shell.SetPatchNotes(LongNotes(40));
    REQUIRE_NEAR(fixture.shell.PatchScroll(), 0.0, 1e-9);
    fixture.shell.SetPatchNotes(std::nullopt);
    REQUIRE(!fixture.shell.ScrollPatchNotes(10.0));
}

TEST(patch_note_platform_tags_use_the_names_people_know) {
    using tvm::ui::Shell;
    REQUIRE_EQ(Shell::PlatformLabel("windows"), std::string("Windows"));
    REQUIRE_EQ(Shell::PlatformLabel("ios"), std::string("iPhone"));
    REQUIRE_EQ(Shell::PlatformLabel("android"), std::string("Android"));
    REQUIRE_EQ(Shell::PlatformLabel("roku"), std::string("Roku"));
    REQUIRE_EQ(Shell::PlatformLabel("web"), std::string("Web"));
    REQUIRE_EQ(Shell::PlatformLabel("desktop"), std::string("Desktop"));
    REQUIRE_EQ(Shell::PlatformLabel("tizen"), std::string("tizen"));
}

// ------------------------------------------------------------------------------------- profile editor

TEST(the_profile_editor_lays_avatar_sets_in_a_scrolling_row_above_the_characters) {
    nlohmann::json sets = nlohmann::json::array();
    for (int s = 0; s < 12; ++s) {
        nlohmann::json avatars = nlohmann::json::array();
        for (int a = 0; a < 5; ++a) avatars.push_back({{"id", "a" + std::to_string(a)}, {"name", "Character " + std::to_string(a)}, {"image", ""}});
        sets.push_back({{"id", "set" + std::to_string(s)}, {"title", "Show " + std::to_string(s)}, {"avatars", avatars}});
    }
    tvm::ui::ProfileEditor editor;
    editor.Layout(1920.0, 1080.0);
    tvm::ui::ProfileEntry profile;
    profile.id = "p1";
    profile.name = "Alex";
    profile.avatar = "set7/a2";
    editor.SetProfile(profile, nlohmann::json{{"sets", sets}}, "");
    REQUIRE_EQ(editor.SetCount(), std::size_t{12});

    // It opens on the set of the profile's character, with that tile on show.
    const std::vector<std::string> keys = editor.ButtonKeys();
    REQUIRE(Has(keys, "set:7"));
    REQUIRE(!Has(keys, "set:0"));
    REQUIRE(editor.SetScroll() > 0.0);
    // Five characters and the profile's own colour and initial.
    REQUIRE(Has(keys, "initial"));
    REQUIRE(Has(keys, "avatar:4"));
    REQUIRE(!Has(keys, "avatar:5"));

    // The arrows walk the row, and it follows the focus.
    REQUIRE(editor.FocusItem("set:7", 0.0, false));
    const double before = editor.SetScroll();
    REQUIRE(editor.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(editor.FocusedKey(), std::optional<std::string>("set:8"));
    REQUIRE(editor.Navigate(Direction::Right, 0.0));
    REQUIRE(editor.Navigate(Direction::Right, 0.0));
    REQUIRE(editor.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(editor.FocusedKey(), std::optional<std::string>("set:11"));
    REQUIRE(!editor.Navigate(Direction::Right, 0.0));
    REQUIRE(editor.SetScroll() >= before);
    REQUIRE(Has(editor.ButtonKeys(), "set:11"));
    // Choosing a set changes the characters shown.
    (void)editor.ActivateItem("set:11", 0.0);
    REQUIRE(Has(editor.ButtonKeys(), "avatar:0"));
    // Picking a character, and the colour and initial, change the saved avatar.
    (void)editor.ActivateItem("avatar:3", 0.0);
    const auto saved = editor.ActivateItem("save", 0.0);
    REQUIRE(saved.has_value());
    REQUIRE(saved->params.at("patch").find("set11/a3") != std::string::npos);
}
