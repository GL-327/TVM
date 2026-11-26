#include "ui/settings_screen.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <utility>

#include "motion/camera.h"
#include "nav/wrap.h"
#include "ui/controls.h"
#include "ui/glass_styles.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;

// One column of slim rows at a comfortable desktop width: the name at the left (with a short second line only for
// the switches and choices that have one), and the value, switch or chevron at the right. Section headings stay.
constexpr double kRowHeightRem = 3.2;
constexpr double kTallRowHeightRem = 3.9;
constexpr double kPreviewHeightRem = 5.0;
constexpr double kGroupGapRem = 1.6;
constexpr double kGroupTitleRem = 0.95;
constexpr double kEnsureVisiblePadRem = 4.0;
constexpr double kRowRadiusRem = 0.75;
constexpr double kCardRadiusRem = 1.0;
constexpr double kCatRowHeightRem = 2.7;
constexpr double kCatRowStepRem = 3.0;
constexpr double kSearchHeightRem = 2.6;
// Where the search field and the first category sit, below the title.
constexpr double kSearchTopRem = 3.1;
constexpr double kCategoriesTopRem = 6.5;
constexpr std::size_t kQueryMax = 60;
constexpr Color kDanger = Rgb(0xFF6B63);

Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}

std::string Lower(std::string text) {
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

std::string Trimmed(const std::string& text) {
    const std::size_t first = text.find_first_not_of(' ');
    if (first == std::string::npos) return "";
    return text.substr(first, text.find_last_not_of(' ') - first + 1);
}

// A toggle row's value ("On", "Dark") and the words after it, split at the first " · ".
std::pair<std::string, std::string> SplitDetail(const std::string& detail) {
    const std::string dot = " \xC2\xB7 ";
    const std::size_t at = detail.find(dot);
    if (at == std::string::npos) return {detail, ""};
    return {detail.substr(0, at), detail.substr(at + dot.size())};
}

struct LanguageOption {
    const char* id;
    const char* name;
};

// The same order and names as apps/ui/src/i18n/locale.ts.
constexpr std::array<LanguageOption, 9> kLanguages = {{
    {"en", "English"},
    {"es", "Español"},
    {"fr", "Français"},
    {"de", "Deutsch"},
    {"it", "Italiano"},
    {"pt", "Português"},
    {"ja", "日本語"},
    {"ko", "한국어"},
    {"zh", "中文"},
}};

// Audio and subtitle languages by ISO 639-2 code, as SUBTITLE_LANGUAGE_OPTIONS in apps/ui/src/data/prefs.ts.
constexpr std::array<LanguageOption, 15> kMediaLanguages = {{
    {"eng", "English"}, {"spa", "Spanish"}, {"fra", "French"}, {"deu", "German"}, {"ita", "Italian"},
    {"por", "Portuguese"}, {"jpn", "Japanese"}, {"kor", "Korean"}, {"zho", "Chinese"}, {"ara", "Arabic"},
    {"hin", "Hindi"}, {"rus", "Russian"}, {"nld", "Dutch"}, {"pol", "Polish"}, {"tur", "Turkish"},
}};

std::string MediaLanguageName(const std::string& code) {
    for (const LanguageOption& option : kMediaLanguages) {
        if (code == option.id) return option.name;
    }
    return code;
}

std::string LanguageName(const std::string& id) {
    for (const LanguageOption& option : kLanguages) {
        if (id == option.id) return option.name;
    }
    return "English";
}

// The preferences with the value Core uses when none is saved. A "1" or "0" fallback is a switch. The last two are
// kept on this PC only, since Core has no field for them.
struct PrefDef {
    const char* path;
    const char* fallback;
};

constexpr std::array<PrefDef, 17> kCorePrefs = {{
    {"quality", "original"},
    {"skipUpscaled", "1"},
    {"audioLanguage", "original"},
    {"autoplayNext", "1"},
    {"skipSegments", "button"},
    {"subtitleMode", "foreign"},
    {"subtitleStyle.size", "m"},
    {"subtitleStyle.color", "white"},
    {"subtitleStyle.background", "shadow"},
    {"heroPreviews", "1"},
    {"sleepTimerDefault", "off"},
    {"spotlightEvents", "1"},
    {"webhookUrl", ""},
    {"volumeBoostMax", "200"},
    {"posterTitles", "1"},
    {"accent", "default"},
    {"showFps", "0"},
}};

// The switch extras, in the order and with the wording of EXTRA_OPTIONS in apps/ui/src/data/polishPrefs.ts.
struct ExtraDef {
    const char* id;
    const char* fallback;
    const char* name;
    const char* detail;
    // Shown after the description where the feature is not on every platform.
    const char* platform;
    // Which block of the Extras page it sits in.
    int group;
};

constexpr std::array<ExtraDef, 22> kExtras = {{
    {"onlineSubtitles", "1", "Online subtitles", "Find additional tracks through OpenSubtitles.", "", 0},
    {"chapters", "1", "Chapters", "Show chapter markers when the player exposes them.", "", 0},
    {"seekPreviews", "1", "Seek previews", "Show a thumbnail while scrubbing.", "Native mpv only", 0},
    {"versionPicker", "1", "Version picker", "Choose a source on Details or during playback.", "", 0},
    {"sleepTimer", "1", "Sleep timer", "Stop playback after a set time or at the end of an episode.", "", 0},
    {"nightMode", "0", "Night mode", "Reduce the difference between quiet and loud sounds.", "", 0},
    {"pauseOnMinimize", "1", "Pause when hidden", "Pause when the window is hidden or minimised.", "Desktop and web", 0},
    {"shortcutsOverlay", "1", "Keyboard shortcuts", "Press ? in the player to see shortcuts.", "Desktop and web", 0},
    {"trailers", "1", "Trailers", "Watch trailers inside TVM.", "", 1},
    {"trailerBackdrops", "1", "Trailer backdrops", "Play a muted trailer on the Details page.", "Desktop and web", 1},
    {"collections", "1", "Collections", "Show related films on Details.", "", 1},
    {"ratings", "1", "IMDb ratings", "Show IMDb scores on Home and Details.", "", 1},
    {"qualityBadges", "1", "Quality badges", "Show resolution, HDR and Atmos where known.", "", 1},
    {"animeTitles", "1", "English anime titles", "Show English titles from AniList when available.", "", 1},
    {"themeSongs", "0", "Theme songs", "Play a theme quietly on Details.", "Desktop and web", 1},
    {"spoilerBlur", "0", "Spoiler blur", "Hide stills and summaries for unwatched episodes.", "", 1},
    {"comingUp", "1", "Coming up", "Show upcoming episodes on Home and Details.", "", 2},
    {"surpriseMe", "1", "Surprise me", "Pick something to watch from recommendations and My List.", "", 2},
    {"autoCollections", "1", "Automatic collections", "Group recommendations into extra rows on Home.", "", 2},
    {"announcements", "1", "Announcements", "Show announcements from TVM on Home.", "", 2},
    {"watchStats", "1", "Watch stats", "Record watch history and show your viewing stats.", "", 2},
    {"webhook", "0", "Playback webhook", "Send play, pause, stop and finish events to your URL.", "", 2},
}};

const char* FallbackOf(const std::string& pref) {
    for (const PrefDef& def : kCorePrefs) {
        if (pref == def.path) return def.fallback;
    }
    if (pref.rfind("extras.", 0) == 0) {
        for (const ExtraDef& extra : kExtras) {
            if (pref.substr(7) == extra.id) return extra.fallback;
        }
    }
    return nullptr;
}

bool NativeOnly(const std::string& pref) {
    return pref == "sleepTimerDefault" || pref == "spotlightEvents" || pref == "accent" || pref == "showFps";
}

// The text a preference holds in a /api/prefs body, or nothing when it is absent or the wrong type.
std::optional<std::string> ReadPref(const nlohmann::json& body, const std::string& pref) {
    const nlohmann::json* node = &body;
    std::string rest = pref;
    while (true) {
        const std::size_t dot = rest.find('.');
        const std::string part = rest.substr(0, dot);
        if (!node->is_object()) return std::nullopt;
        const auto found = node->find(part);
        if (found == node->end()) return std::nullopt;
        node = &*found;
        if (dot == std::string::npos) break;
        rest = rest.substr(dot + 1);
    }
    if (pref == "volumeBoostMax" && node->is_number())
        return std::to_string(static_cast<int>(std::clamp(node->get<double>(), 100.0, 300.0)));
    if (pref == "webhookUrl" && node->is_null()) return "";
    if (node->is_boolean()) return node->get<bool>() ? "1" : "0";
    if (node->is_string() && !node->get<std::string>().empty()) return node->get<std::string>();
    return std::nullopt;
}

Command Open(std::string name, std::map<std::string, std::string> params = {}, bool modal = false) {
    Command command;
    command.modal = modal;
    command.name = std::move(name);
    command.params = std::move(params);
    return command;
}

Command Confirm(std::string title, std::string body, std::string confirmLabel, std::string action) {
    return Open("confirm",
                {{"title", std::move(title)},
                 {"body", std::move(body)},
                 {"confirmLabel", std::move(confirmLabel)},
                 {"action", std::move(action)}},
                true);
}

struct CategoryDef {
    const char* id;
    const char* title;
    const char* description;
    // A stroked icon in a 24 unit square (M, L, H, V, A and Z only).
    const char* icon;
};

// The left pane, in order, as the web's CATEGORIES. A category with no rows is left out of the list.
constexpr std::array<CategoryDef, 14> kCategories = {{
    {"account", "Account", "Manage your TVM account and access.",
     "M8.6 8A3.4 3.4 0 1 0 15.4 8A3.4 3.4 0 1 0 8.6 8Z M5 20V18A7 7 0 0 1 19 18V20"},
    {"profiles", "Profiles", "Choose avatars, age limits and profile PINs.",
     "M6 9A3 3 0 1 0 12 9A3 3 0 1 0 6 9Z M2.5 20V18.5A5.5 5.5 0 0 1 13.5 18.5V20 M16 6.2A3 3 0 0 1 16 11.8 "
     "M18 14A5 5 0 0 1 21.5 18.5V19.5"},
    {"playback", "Playback", "Choose how TVM starts and plays your videos.", "M8 5V19L19 12Z"},
    {"audio", "Audio & subtitles", "Set your preferred captions and sound.",
     "M3.5 6H20.5V18H3.5Z M7 11H10 M12.5 11H17 M7 14.5H9.5 M12 14.5H17"},
    {"appearance", "Appearance", "Adjust the interface for this device.",
     "M4 12A8 8 0 1 0 20 12A8 8 0 1 0 4 12Z M12 4V20 M12 9H16 M12 14H17"},
    {"home", "Home screen", "Choose what appears on Home.", "M3 11L12 4L21 11 M19 10V20H14V14H10V20H5V10"},
    {"extras", "Extras", "Choose which playback and discovery features to use.",
     "M5 6H19 M5 12H19 M5 18H19 M9 4V8 M15 10V14 M10 16V20"},
    {"livetv", "Live TV", "Your Live TV server and playlist.", "M3 6H21V17H3Z M8 21H16 M12 17V21"},
    {"realdebrid", "Real-Debrid", "The token TVM uses to find streams.",
     "M4 12A3.5 3.5 0 1 0 11 12A3.5 3.5 0 1 0 4 12Z M11 12H21 M18 12V15 M21 12V14.5"},
    {"downloads", "Downloads", "Titles saved on this device.", "M12 3V15 M8 11L12 15L16 11 M4 16V20H20V16"},
    {"updates", "Updates", "Keep TVM current and read what is new.", "M19.5 9A8 8 0 1 0 20 13 M20 4V9H15"},
    {"stats", "Your stats", "See what you have watched and how much time you spent watching.",
     "M5 19V14 M10 19V9 M15 19V5 M20 19V8"},
    {"about", "About", "This device, diagnostics and maintenance.",
     "M3 12A9 9 0 1 0 21 12A9 9 0 1 0 3 12Z M12 11V17 M12 7.5V8"},
    {"developer", "Developer", "Tools for admin accounts.", "M8 6L2 12L8 18 M16 6L22 12L16 18 M13.5 4L10.5 20"},
}};

enum Cat {
    kAccount,
    kProfiles,
    kPlayback,
    kAudio,
    kAppearance,
    kHome,
    kExtrasCat,
    kLiveTv,
    kRealDebrid,
    kDownloads,
    kUpdates,
    kStats,
    kAbout,
    kDeveloper
};

constexpr const char* kSearchIcon = "M4 11A7 7 0 1 0 18 11A7 7 0 1 0 4 11Z M16 16L21 21";

}  // namespace

// ---------------------------------------------------------------------------------------------- CoreSettings

CoreSettings CoreSettings::FromJson(const nlohmann::json& body) {
    CoreSettings settings;
    if (!body.is_object()) return settings;
    const auto read = [&](const std::string& pref) {
        if (NativeOnly(pref)) return;
        if (const std::optional<std::string> value = ReadPref(body, pref)) settings.values[pref] = *value;
    };
    for (const PrefDef& def : kCorePrefs) read(def.path);
    for (const ExtraDef& extra : kExtras) read(std::string("extras.") + extra.id);
    if (const auto languages = body.find("subtitleLanguages"); languages != body.end() && languages->is_array()) {
        std::vector<std::string> codes;
        for (const auto& code : *languages) {
            if (code.is_string() && !code.get<std::string>().empty()) codes.push_back(code.get<std::string>());
        }
        if (!codes.empty()) settings.subtitleLanguages = std::move(codes);
    }
    settings.homeSections = ReadHomeSections(body);
    return settings;
}

std::string CoreSettings::Get(const std::string& pref) const {
    const auto found = values.find(pref);
    if (found != values.end()) return found->second;
    return Default(pref);
}

std::string CoreSettings::Default(const std::string& pref) {
    const char* fallback = FallbackOf(pref);
    return fallback == nullptr ? "" : fallback;
}

bool CoreSettings::IsSwitch(const std::string& pref) {
    const char* fallback = FallbackOf(pref);
    return fallback != nullptr && (std::string(fallback) == "1" || std::string(fallback) == "0");
}

nlohmann::json CoreSettings::Patch(const std::string& pref, const std::string& value) {
    nlohmann::json leaf = IsSwitch(pref) ? nlohmann::json(value == "1") : nlohmann::json(value);
    if (pref == "webhookUrl" && value.empty()) leaf = nullptr;
    if (pref == "volumeBoostMax") leaf = std::clamp(std::atoi(value.c_str()), 100, 300);
    // "extras.trailers" nests as {"extras": {"trailers": ...}}.
    std::vector<std::string> parts;
    std::string rest = pref;
    while (true) {
        const std::size_t dot = rest.find('.');
        parts.push_back(rest.substr(0, dot));
        if (dot == std::string::npos) break;
        rest = rest.substr(dot + 1);
    }
    for (auto part = parts.rbegin(); part != parts.rend(); ++part) {
        nlohmann::json wrapper = nlohmann::json::object();
        wrapper[*part] = std::move(leaf);
        leaf = std::move(wrapper);
    }
    return leaf;
}

// ------------------------------------------------------------------------------------------- SettingsScreen

SettingsScreen::SettingsScreen(PreferenceStore& store, motion::MotionSettings motion)
    : store_(store), core_(store.CorePrefs()) {
    motion_ = motion;
    BuildRows();
}

void SettingsScreen::BuildRows() {
    rows_.clear();
    int cat = kAccount;
    auto group = [this, &cat](std::string title) {
        rows_.push_back(Row{RowKind::Group, "", std::move(title), "", {}, 0.0, 0.0, 0, 0.0, 0.0, cat});
    };
    auto row = [this, &cat](RowKind kind, std::string key, std::string label, std::string detail = "", Command command = {}) {
        rows_.push_back(
            Row{kind, std::move(key), std::move(label), std::move(detail), std::move(command), 0.0, 0.0, 0, 0.0, 0.0, cat});
    };
    auto push = [&row](std::string key, std::string label, std::string detail, Command command) {
        row(RowKind::Push, std::move(key), std::move(label), std::move(detail), std::move(command));
    };
    // A Core preference: its control, the path it has in /api/prefs, and (segmented or select) its choices.
    auto pref = [this, &cat](Ctl ctl, std::string key, std::string label, std::string desc, std::string path,
                             std::vector<Option> options = {}) {
        Row made{RowKind::Pref, std::move(key), std::move(label), "", {}, 0.0, 0.0, 0, 0.0, 0.0, cat};
        made.ctl = ctl;
        made.pref = std::move(path);
        made.options = std::move(options);
        made.desc = std::move(desc);
        rows_.push_back(std::move(made));
    };

    cat = kAccount;
    group("Sign in and access");
    push("account", "Your account", "Sign in, email verification and access", Open("account"));
    push("privacy", "Privacy & terms", "Terms, data export and deletion", Open("legal"));
    push("plan", "Plan", "Access and pricing", Open("plans"));
    group("Services");
    push("services", "Streaming services", "Sign in to your services", Open("services"));

    cat = kProfiles;
    group("Profiles");
    push("profiles", "Profiles", "Switch, add, rename or remove", Open("chooser"));
    row(RowKind::ChooseProfile, "choose-profile", "Choose profile on launch");

    cat = kPlayback;
    group("Quality");
    pref(Ctl::Select, "quality", "Quality", "Set the highest resolution TVM should play.", "quality",
         {{"original", "Original \xE2\x80\x93 best available"}, {"2160", "4K"}, {"1080", "1080p"}, {"720", "720p"},
          {"saver", "Data saver"}});
    pref(Ctl::Switch, "skip-upscaled", "Skip upscaled releases", "Prefer versions mastered at their listed resolution.",
         "skipUpscaled");
    {
        std::vector<Option> languages{{"original", "Original language"}};
        for (const LanguageOption& language : kMediaLanguages) languages.push_back({language.id, language.name});
        pref(Ctl::Select, "audio-language", "Audio language", "Choose the audio track used when playback starts.",
             "audioLanguage", std::move(languages));
    }
    group("Watching");
    pref(Ctl::Switch, "autoplay-next", "Autoplay next episode", "Start the next episode after the countdown.",
         "autoplayNext");
    pref(Ctl::Segmented, "skip-segments", "Skip intro, recap & credits",
         "Seek bar markers highlight intros, recaps, credits and chapters. Button lets you jump past skipped segments. Automatic skips them for you.",
         "skipSegments", {{"off", "Off"}, {"button", "Button"}, {"auto", "Automatic"}});
    pref(Ctl::Slider, "volume-boost", "Volume boost maximum", "Limit how far you can turn up player volume.",
         "volumeBoostMax");
    pref(Ctl::Select, "sleep-default", "Sleep timer default", "Start each video with this timer.", "sleepTimerDefault",
         {{"off", "Off"}, {"15", "15 minutes"}, {"30", "30 minutes"}, {"45", "45 minutes"}, {"60", "60 minutes"},
          {"end", "End of episode"}});

    cat = kAudio;
    group("Subtitles");
    pref(Ctl::Segmented, "subtitle-mode", "Subtitle mode", "Choose when captions appear by default.", "subtitleMode",
         {{"off", "Off"}, {"foreign", "Foreign audio"}, {"always", "Always"}});
    {
        Row languages{RowKind::Push, "subtitle-languages", "Preferred subtitle languages", "", Open("extras-settings"),
                      0.0, 0.0, 0, 0.0, 0.0, cat};
        languages.desc = "TVM tries these languages in order.";
        rows_.push_back(std::move(languages));
    }
    pref(Ctl::Segmented, "subtitle-size", "Size", "Subtitle text size.", "subtitleStyle.size",
         {{"s", "S"}, {"m", "M"}, {"l", "L"}, {"xl", "XL"}});
    pref(Ctl::Segmented, "subtitle-color", "Colour", "Subtitle text colour.", "subtitleStyle.color",
         {{"white", "White"}, {"yellow", "Yellow"}, {"cyan", "Cyan"}});
    pref(Ctl::Segmented, "subtitle-back", "Background", "Change how subtitle text stands out from the picture.",
         "subtitleStyle.background", {{"shadow", "Shadow"}, {"box", "Box"}, {"none", "None"}});
    {
        Row preview{RowKind::Preview, "subtitle-preview", "Preview", "", {}, 0.0, 0.0, 0, 0.0, 0.0, cat};
        preview.desc = "See how your subtitles will look.";
        rows_.push_back(std::move(preview));
    }
    group("Sound");
    pref(Ctl::Switch, "audio-night", "Night mode", "Reduce loud peaks in the player.", "extras.nightMode");

    cat = kAppearance;
    group("Picture");
    row(RowKind::Performance, "performance", "Performance mode");
    group("Look");
    row(RowKind::Theme, "themes", "Theme");
    row(RowKind::Glass, "font", "Font");
    row(RowKind::Glass, "reduce-transparency", "Reduce transparency");
    row(RowKind::Motion, "motion", "Reduce motion");
    pref(Ctl::Select, "accent", "Accent colour", "Highlight colour for active controls.", "accent",
         {{"default", "Ice blue"}, {"indigo", "Indigo"}, {"coral", "Coral"}, {"amber", "Amber"}, {"emerald", "Emerald"}});
    pref(Ctl::Switch, "poster-titles", "Poster titles", "Show names below poster artwork.", "posterTitles");
    group("Language");
    row(RowKind::Language, "language", "App language");

    cat = kHome;
    group("Home");
    pref(Ctl::Switch, "hero-previews", "Hero previews", "Play a muted clip when one is available.", "heroPreviews");
    pref(Ctl::Switch, "spotlight-events", "Spotlight events", "Feature film and TV releases at the top of Home.",
         "spotlightEvents");
    group("Home rows");
    homeRows_.clear();
    const auto appendSection = [&](const HomeSection& section) {
        const auto label = std::find_if(homeLabels_.begin(), homeLabels_.end(), [&](const auto& choice) { return choice.first == section.id; });
        if (label == homeLabels_.end()) return;
        homeRows_.push_back(section);
        row(RowKind::HomeSection, "home-row-" + section.id, label->second);
        rows_.back().pref = section.id;
    };
    for (const auto& section : settings_.homeSections) appendSection(section);
    const auto automatic = std::find_if(settings_.homeSections.begin(), settings_.homeSections.end(),
                                        [](const auto& section) { return section.id == "automatic"; });
    for (const auto& [id, label] : homeLabels_) {
        if (std::none_of(homeRows_.begin(), homeRows_.end(), [&](const auto& section) { return section.id == id; })) {
            appendSection({id, id != "because" || automatic == settings_.homeSections.end() || automatic->visible});
        }
    }

    cat = kExtrasCat;
    {
        const std::array<const char*, 3> titles = {"Playback", "Details pages", "Home and activity"};
        for (int block = 0; block < 3; ++block) {
            group(titles[static_cast<std::size_t>(block)]);
            for (const ExtraDef& extra : kExtras) {
                if (extra.group != block) continue;
                std::string desc = extra.detail;
                if (extra.platform[0] != '\0') desc += std::string(" ") + extra.platform + ".";
                pref(Ctl::Switch, std::string("extra-") + extra.id, extra.name, std::move(desc),
                     std::string("extras.") + extra.id);
                if (std::string_view(extra.id) == "webhook") {
                    pref(Ctl::Text, "webhook-url", "Webhook URL", "Enter to save. Leave blank to remove the URL.", "webhookUrl");
                }
            }
        }
    }

    cat = kLiveTv;
    group("Live TV");
    push("livetv", "Live TV login", "Server, username and password", Open("live-xtream"));
    push("live-playlist", "Live TV playlist", "M3U / M3U8", Open("live-playlist"));

    cat = kRealDebrid;
    group("Real-Debrid");
    push("realdebrid", "Real-Debrid", "Your token", Open("realdebrid"));

    cat = kDownloads;
    group("Downloads");
    push("downloads", "Downloads", "Saved titles and their progress", Open("downloads"));

    cat = kUpdates;
    group("Updates");
    push("updates", "Updates", "GLogic Studios", Open("updates"));
    row(RowKind::AutoUpdate, "auto-update", "Check for updates on launch");
    push("changelog", "What's new", "Release notes for TVM", Open("changelog", {}, true));

    cat = kStats;
    group("Your stats");
    push("stats", "Your stats", "Watch time and history", Open("stats"));

    cat = kAbout;
    group("This device");
    push("network", "Network", "Connected or offline", Open("system-info", {{"section", "network"}}));
    push("display", "Display", "Panel, window and stream cap", Open("system-info", {{"section", "display"}}));
    push("diagnostics", "Diagnostics", "", Open("diagnostics", {}, true));
    group("Maintenance");
    push("clear-cache", "Clear cache", "Artwork and catalogs",
         Confirm("Clear cache?",
                 "Artwork and catalog caches are deleted. Your Real-Debrid token, profiles and watch history stay.",
                 "Clear cache", "clear-cache"));
    push("factory-reset", "Fully reset", "Including the Real-Debrid token",
         Confirm("Fully reset TVM?",
                 "Profiles, watch history, My List, Live TV playlist, caches and the Real-Debrid token are removed. You will need to paste the token again.",
                 "Fully reset", "factory-reset"));
    push("restart", "Restart", "",
         Confirm("Restart TVM?", "The interface reloads. Nothing on disk is changed.", "Restart", "restart"));

    if (diag_.active) {
        cat = kDeveloper;
        group("Accounts");
        push("accounts", "Accounts", "Manage member access", Open("accounts"));
        group("Developer Diagnostics");
        row(RowKind::Info, "dev-build", "Build info", diag_.buildVersion);
        row(RowKind::Info, "dev-rd-source", "RD token source", diag_.rdTokenSource);
        row(RowKind::Info, "dev-glass", "Glass mode");
        pref(Ctl::Switch, "show-fps", "Show FPS", "Show the Windows frame rate and frame time in a corner.", "showFps");
        push("dev-refresh-cache", "Quick cache refresh", "Reload catalog and artwork",
             Command{false, "dev-refresh-cache", {}, true});
    }

    RefreshDetails();
    const std::vector<int> present = PresentCategories();
    if (std::find(present.begin(), present.end(), category_) == present.end()) category_ = kAccount;
    categoryFocus_ = category_;
    focus_ = FirstFocusable();
}

std::vector<int> SettingsScreen::PresentCategories() const {
    std::vector<int> present;
    for (int c = 0; c < static_cast<int>(kCategories.size()); ++c) {
        for (const Row& row : rows_) {
            if (row.category == c && row.kind != RowKind::Group) {
                present.push_back(c);
                break;
            }
        }
    }
    return present;
}

bool SettingsScreen::Shown(const Row& row) const {
    if (row.key == "accent" && store_.Look() != Theme::Dark) return false;
    if (term_.empty()) return row.category == category_;
    // A search lists the rows that match, across every category, without the groups' own headings.
    return row.kind != RowKind::Group && row.haystack.find(term_) != std::string::npos;
}

std::optional<std::size_t> SettingsScreen::FirstFocusable() const {
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (Focusable(rows_[i])) return i;
    }
    return std::nullopt;
}

void SettingsScreen::SelectCategory(int category, bool resetScroll) {
    category_ = category;
    categoryFocus_ = category;
    if (resetScroll) {
        camera_.Cancel();
        pageScroll_ = 0.0;
    }
    if (width_ > 0.0 && height_ > 0.0) Arrange();
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
    focus_ = FirstFocusable();
}

void SettingsScreen::SetDeveloperDiagnostics(DeveloperDiagnostics diag) {
    if (diag_ == diag) return;
    diag_ = std::move(diag);
    RebuildRowsKeepingFocus();
}

void SettingsScreen::RebuildRowsKeepingFocus() {
    const auto previous = FocusedKey();
    if (select_.IsOpen()) select_.Close(clockMs_);
    selectRow_.reset();
    BuildRows();
    if (width_ > 0.0 && height_ > 0.0) Arrange();
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
    if (previous && pane_ == Pane::Content) {
        const auto found = std::find_if(rows_.begin(), rows_.end(), [&](const auto& row) { return row.key == *previous; });
        if (found != rows_.end() && Focusable(*found)) focus_ = static_cast<std::size_t>(found - rows_.begin());
    }
}

void SettingsScreen::SetCoreSettings(CoreSettings settings) {
    const bool homeChanged = settings.homeSections != settings_.homeSections;
    settings_ = std::move(settings);
    if (homeChanged) RebuildRowsKeepingFocus();
    else RefreshDetails();
}

void SettingsScreen::SetHomeSectionLabels(HomeSectionLabels labels) {
    if (labels == homeLabels_) return;
    homeLabels_ = std::move(labels);
    RebuildRowsKeepingFocus();
}

void SettingsScreen::RefreshDetails() {
    for (Row& row : rows_) {
        if (row.kind == RowKind::Group) continue;
        row.detail = DetailFor(row);
        row.haystack = Lower(std::string(kCategories[static_cast<std::size_t>(row.category)].title) + " " + row.label + " " +
                             Caption(row));
    }
}

std::string SettingsScreen::PrefValue(const std::string& pref) const {
    if (pref == "sleepTimerDefault") return store_.SleepTimerDefault();
    if (pref == "accent") return store_.Accent();
    if (pref == "showFps") return store_.ShowFps() ? "1" : "0";
    if (pref == "volumeBoostMax" && !settings_.values.contains(pref)) return std::to_string(store_.VolumeBoostMax());
    if (pref == "posterTitles" && !settings_.values.contains(pref)) return store_.PosterTitles() ? "1" : "0";
    if (pref == "spotlightEvents") return store_.SpotlightEvents() ? "1" : "0";
    return settings_.Get(pref);
}

std::string SettingsScreen::OptionLabel(const Row& row, const std::string& id) const {
    for (const Option& option : row.options) {
        if (option.id == id) return option.label;
    }
    return row.pref == "audioLanguage" ? MediaLanguageName(id) : id;
}

void SettingsScreen::SetPref(const std::string& pref, const std::string& value) {
    if (pref == "sleepTimerDefault") {
        store_.SaveSleepTimerDefault(value);
    } else if (pref == "spotlightEvents") {
        store_.SaveSpotlightEvents(value == "1");
    } else if (pref == "accent") {
        store_.SaveAccent(value);
    } else if (pref == "showFps") {
        store_.SaveShowFps(value == "1");
    } else {
        if (pref == "volumeBoostMax") store_.SaveVolumeBoostMax(std::atoi(value.c_str()));
        if (pref == "posterTitles") store_.SavePosterTitles(value == "1");
        settings_.values[pref] = value;
    }
    RefreshDetails();
    if (sink_ && pref != "accent" && pref != "showFps") sink_(CoreSettings::Patch(pref, value));
}

std::string SettingsScreen::DetailFor(const Row& row) const {
    switch (row.kind) {
    case RowKind::Motion:
        return motion::PrefersReducedMotion(motion_) ? "On · simpler animation" : "Off · full animation";
    case RowKind::Performance:
        return motion_.performanceMode ? "On · simpler effects and motion" : "Off · full UI motion";
    case RowKind::Theme:
        return store_.Look() == Theme::Light ? "Light" : "Dark";
    case RowKind::Glass:
        if (row.key == "font") return std::string(UiFontName(store_.Font()));
        return store_.ReduceTransparency() ? "On · solid surfaces" : "Off · Liquid Glass";
    case RowKind::Language:
        return LanguageName(core_.language);
    case RowKind::AutoUpdate:
        return core_.autoUpdate ? "On · check when this app opens" : "Off · check from Updates";
    case RowKind::ChooseProfile:
        return store_.ChooseProfileOnLaunch() ? "On \xC2\xB7 ask who's watching when TVM opens"
                                              : "Off \xC2\xB7 open the last profile";
    case RowKind::Pref:
        if (row.ctl == Ctl::Switch) return PrefValue(row.pref) == "1" ? "On" : "Off";
        if (row.ctl == Ctl::Text) return PrefValue(row.pref).empty() ? "" : "URL saved";
        if (row.ctl == Ctl::Slider) return PrefValue(row.pref) + "%";
        return OptionLabel(row, PrefValue(row.pref));
    case RowKind::Push:
        if (row.key == "subtitle-languages") {
            std::string names;
            for (const std::string& code : settings_.subtitleLanguages) {
                if (!names.empty()) names += ", ";
                names += MediaLanguageName(code);
            }
            return names;
        }
        return row.detail;
    case RowKind::Info:
        if (row.key == "dev-glass") {
            return store_.ReduceTransparency() ? "Solid surfaces" : "Liquid Glass";
        }
        return row.detail;
    case RowKind::HomeSection:
    case RowKind::Preview:
    case RowKind::Group:
        break;
    }
    return "";
}

bool SettingsScreen::Focusable(const Row& row) const {
    return row.kind != RowKind::Group && row.kind != RowKind::Info && row.kind != RowKind::Preview && Shown(row);
}

bool SettingsScreen::SwitchRow(const Row& row) const {
    return row.kind == RowKind::Motion || row.kind == RowKind::Performance || row.kind == RowKind::AutoUpdate ||
           row.kind == RowKind::ChooseProfile || (row.kind == RowKind::Glass && row.key == "reduce-transparency") ||
           (row.kind == RowKind::Pref && row.ctl == Ctl::Switch);
}

bool SettingsScreen::SegmentedRow(const Row& row) const {
    return row.kind == RowKind::Theme || (row.kind == RowKind::Glass && row.key == "font") ||
           (row.kind == RowKind::Pref && row.ctl == Ctl::Segmented);
}

bool SettingsScreen::SelectRow(const Row& row) const {
    return row.kind == RowKind::Language || (row.kind == RowKind::Pref && row.ctl == Ctl::Select);
}

std::vector<std::string> SettingsScreen::SegmentLabels(const Row& row) const {
    if (row.kind == RowKind::Theme) return {"Dark", "Light"};
    if (row.kind == RowKind::Pref) {
        std::vector<std::string> labels;
        for (const Option& option : row.options) labels.push_back(option.label);
        return labels;
    }
    return {"Geist", "Inter", "System"};
}

std::size_t SettingsScreen::SegmentIndex(const Row& row) const {
    if (row.kind == RowKind::Theme) return store_.Look() == Theme::Light ? 1 : 0;
    if (row.kind == RowKind::Pref) {
        const std::string value = PrefValue(row.pref);
        for (std::size_t i = 0; i < row.options.size(); ++i) {
            if (row.options[i].id == value) return i;
        }
        return 0;
    }
    const UiFont font = store_.Font();
    return font == UiFont::Geist ? 0 : font == UiFont::Inter ? 1 : 2;
}

void SettingsScreen::SetSegment(const Row& row, std::size_t index) {
    const std::size_t previous = SegmentIndex(row);
    if (index == previous) return;
    changedSegment_ = row.key;
    previousSegment_ = previous;
    segmentChangedAt_ = clockMs_;
    if (row.kind == RowKind::Pref) {
        if (index < row.options.size()) SetPref(row.pref, row.options[index].id);
        return;
    }
    if (row.kind == RowKind::Theme) {
        store_.SaveLook(index == 1 ? Theme::Light : Theme::Dark);
        if (width_ > 0.0 && height_ > 0.0) Arrange();
    } else {
        store_.SetFont(index == 0 ? UiFont::Geist : index == 1 ? UiFont::Inter : UiFont::System);
    }
    RefreshDetails();
}

std::string SettingsScreen::Caption(const Row& row) const {
    if (row.kind == RowKind::Pref || row.kind == RowKind::Preview) return row.desc;
    if (row.kind == RowKind::Push) return row.desc.empty() ? row.detail : row.desc;
    if (row.kind == RowKind::Info || row.kind == RowKind::HomeSection) return "";
    std::string words = SplitDetail(row.detail).second;
    if (!words.empty()) {
        words[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(words[0])));
        return words;
    }
    if (row.kind == RowKind::Theme) return "Dark or light colours across the app";
    if (row.kind == RowKind::Language) return "Language of menus and labels";
    if (row.key == "font") return "The typeface used across TVM";
    return "";
}

std::vector<std::string> SettingsScreen::RowLabels() const {
    std::vector<std::string> labels;
    for (const Row& row : rows_) labels.push_back(row.label);
    return labels;
}

std::string SettingsScreen::DetailOf(const std::string& key) const {
    for (const Row& row : rows_) {
        if (row.key == key) return row.detail;
    }
    return "";
}

std::string SettingsScreen::ValueOf(const std::string& key) const {
    for (const Row& row : rows_) {
        if (row.key == key && row.kind == RowKind::Pref) return row.detail;
    }
    return "";
}

std::vector<std::string> SettingsScreen::ShownLabels() const {
    std::vector<std::string> labels;
    for (const Row& row : rows_) {
        if (Shown(row) && row.kind != RowKind::Group) labels.push_back(row.label);
    }
    return labels;
}

std::vector<std::string> SettingsScreen::ShownKeys() const {
    std::vector<std::string> keys;
    for (const Row& row : rows_) {
        if (Focusable(row)) keys.push_back(row.key);
    }
    return keys;
}

void SettingsScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    metrics_.rem = ViewportRem(width, height);
    Arrange();
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
}

void SettingsScreen::Arrange() {
    // Two panes. The left one (search and categories) stays put; the right one scrolls. Row positions are in page
    // coordinates.
    const bool compact = CompactViewport(width_, height_);
    const double safe = metrics_.Rem(compact ? 1.0 : kSafeXRem);
    paneLeft_ = safe;
    paneWidth_ = metrics_.Rem(compact ? 8.0 : 17.0);
    contentLeft_ = paneLeft_ + paneWidth_ + metrics_.Rem(compact ? 1.0 : 2.5);
    contentWidth_ = std::max(metrics_.Rem(12.0), std::min(width_ - contentLeft_ - safe, metrics_.Rem(46.0)));
    // Fourteen categories need to fit under the search field even in a short window.
    const double categoriesTop = metrics_.Rem(kSafeYRem) + metrics_.Rem(kCategoriesTopRem);
    const double room = height_ - categoriesTop - metrics_.Rem(kSafeYRem);
    const double count = static_cast<double>(std::max<std::size_t>(PresentCategories().size(), 1));
    categoryStep_ = std::min(metrics_.Rem(kCatRowStepRem), room / count);

    const double titleHeight = metrics_.Rem(kGroupTitleRem) * 1.6;
    double y = metrics_.Rem(kSafeYRem) + metrics_.Rem(5.6);
    cards_.clear();
    headings_.clear();
    const bool searching = !term_.empty();
    int lastCategory = -1;
    bool first = true;
    for (Row& row : rows_) {
        row.column = 0;
        row.left = contentLeft_;
        row.width = contentWidth_;
        if (!Shown(row)) continue;
        if (row.kind == RowKind::Group) {
            if (!first) y += metrics_.Rem(kGroupGapRem);
            row.top = y;
            row.height = titleHeight;
            y += row.height + metrics_.Rem(0.3);
            cards_.push_back(CardBox{y, 0.0});
        } else {
            if (searching && row.category != lastCategory) {
                // Each category's matches sit in a card under its own name.
                lastCategory = row.category;
                if (!first) y += metrics_.Rem(kGroupGapRem);
                headings_.push_back(Heading{y, kCategories[static_cast<std::size_t>(row.category)].title});
                y += titleHeight + metrics_.Rem(0.3);
                cards_.push_back(CardBox{y, 0.0});
            }
            // A row with a description under its name is a little taller.
            const bool tall = !Caption(row).empty();
            const double height = metrics_.Rem(row.ctl == Ctl::Text || row.key == "skip-segments" ? 6.8
                                               : row.kind == RowKind::Preview ? kPreviewHeightRem
                                               : tall                       ? kTallRowHeightRem
                                                                            : kRowHeightRem);
            row.top = y;
            row.height = compact ? std::max(56.0, height) : height;
            y += row.height;
            if (!cards_.empty()) cards_.back().height += row.height;
        }
        first = false;
    }
    contentBottom_ = y;
}

double SettingsScreen::MaxPageScroll() const {
    return std::max(0.0, contentBottom_ + metrics_.Rem(kSafeYRem) - height_);
}

Box SettingsScreen::ScreenBox(const Row& row) const {
    return Box{row.left, row.top - pageScroll_, row.width, row.height};
}

Box SettingsScreen::CategoryBox(std::size_t slot) const {
    return Box{paneLeft_,
               metrics_.Rem(kSafeYRem) + metrics_.Rem(kCategoriesTopRem) + static_cast<double>(slot) * categoryStep_,
               paneWidth_, categoryStep_ * (kCatRowHeightRem / kCatRowStepRem)};
}

Box SettingsScreen::SearchBox() const {
    return Box{paneLeft_, metrics_.Rem(kSafeYRem) + metrics_.Rem(kSearchTopRem), paneWidth_, metrics_.Rem(kSearchHeightRem)};
}

Box SettingsScreen::SegmentTrack(const Row& row) const {
    const Box box = ScreenBox(row);
    const double y = row.key == "skip-segments" ? box.Bottom() - metrics_.Rem(1.7) : box.CenterY();
    return controls::SegmentedBox(SegmentLabels(row), box.Right() - metrics_.Rem(1.2), y, metrics_.rem);
}

std::optional<std::size_t> SettingsScreen::FocusedIndex() const {
    return focus_;
}

bool SettingsScreen::Tick(double nowMs) {
    const bool segmentWasAnimating = !changedSegment_.empty();
    clockMs_ = nowMs;
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (nowMs - segmentChangedAt_ >= (reduced ? controls::kDropletFadeMs : controls::kDropletMs)) changedSegment_.clear();
    if (!camera_.active()) return select_.Animating(nowMs) || segmentWasAnimating;
    const motion::CameraStep step = camera_.Step(nowMs, reduced);
    pageScroll_ = step.position;
    return true;
}

bool SettingsScreen::Animating() const {
    return camera_.active() || select_.Animating(clockMs_) || !changedSegment_.empty();
}

void SettingsScreen::EnsureVisible(const Row& row, double nowMs) {
    const double pad = metrics_.Rem(kEnsureVisiblePadRem);
    double target = pageScroll_;
    if (row.top < pageScroll_ + pad) target = row.top - pad;
    else if (row.top + row.height > pageScroll_ + height_ - pad) target = row.top + row.height - (height_ - pad);
    target = std::clamp(target, 0.0, MaxPageScroll());
    if (std::abs(target - pageScroll_) < 1.0) return;
    camera_.Begin(pageScroll_, target, MaxPageScroll(), motion::PrefersReducedMotion(motion_));
    if (!camera_.active()) pageScroll_ = camera_.position();
    (void)nowMs;
}

// ------------------------------------------------------------------------------------------------ search

void SettingsScreen::ChangeQuery(double /*nowMs*/) {
    term_ = Lower(Trimmed(query_));
    camera_.Cancel();
    pageScroll_ = 0.0;
    if (width_ > 0.0 && height_ > 0.0) Arrange();
    focus_ = FirstFocusable();
}

void SettingsScreen::Type(const std::string& text) {
    if (!Typing()) return;
    std::string clean;
    for (const char c : text) {
        if (static_cast<unsigned char>(c) >= 0x20 && static_cast<unsigned char>(c) != 0x7F) clean += c;
    }
    if (webhookDraft_) {
        if (clean.empty() || (webhookSelected_ ? 0 : webhookDraft_->size()) + clean.size() > 2048) return;
        if (webhookSelected_) webhookDraft_->clear();
        webhookSelected_ = webhookInvalid_ = false;
        *webhookDraft_ += clean;
        return;
    }
    if (clean.empty() || query_.size() + clean.size() > kQueryMax) return;
    query_ += clean;
    ChangeQuery(clockMs_);
}

void SettingsScreen::Erase() {
    std::string& field = webhookDraft_ ? *webhookDraft_ : query_;
    if (webhookDraft_ && webhookSelected_) {
        field.clear();
        webhookSelected_ = webhookInvalid_ = false;
        return;
    }
    if (field.empty()) return;
    std::size_t cut = field.size() - 1;
    while (cut > 0 && (static_cast<unsigned char>(field[cut]) & 0xC0) == 0x80) --cut;
    field.erase(cut);
    if (webhookDraft_) webhookInvalid_ = false;
    else ChangeQuery(clockMs_);
}

// ------------------------------------------------------------------------------------------------- input

bool SettingsScreen::Navigate(nav::Direction direction, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (webhookDraft_) return false;
    // An open list takes the arrows.
    if (select_.IsOpen()) return select_.Navigate(direction, nowMs);

    if (pane_ == Pane::Search) {
        if (direction == nav::Direction::Down || direction == nav::Direction::Right) {
            // Into the matches, or with nothing typed, down the list of categories.
            if (!term_.empty() && focus_.has_value()) {
                pane_ = Pane::Content;
                contentUsed_ = true;
                return true;
            }
            if (direction == nav::Direction::Down) {
                pane_ = Pane::Categories;
                categoryFocus_ = category_;
                return true;
            }
        }
        return false;
    }

    if (pane_ == Pane::Categories) {
        const std::vector<int> present = PresentCategories();
        const auto at = std::find(present.begin(), present.end(), categoryFocus_);
        if (at == present.end()) return false;
        if (direction == nav::Direction::Down && at + 1 != present.end()) {
            if (!term_.empty()) {
                // Choosing a category ends the search, as on the web.
                query_.clear();
                term_.clear();
            }
            SelectCategory(*(at + 1), true);
            return true;
        }
        if (direction == nav::Direction::Up && at != present.begin()) {
            if (!term_.empty()) {
                query_.clear();
                term_.clear();
            }
            SelectCategory(*(at - 1), true);
            return true;
        }
        if (direction == nav::Direction::Up) {
            pane_ = Pane::Search;
            return true;
        }
        if (direction == nav::Direction::Right && focus_.has_value()) {
            pane_ = Pane::Content;
            contentUsed_ = true;
            return true;
        }
        return false;
    }

    if (!focus_.has_value()) return false;
    contentUsed_ = true;
    const Row& current = rows_[*focus_];
    if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
        if (current.kind == RowKind::HomeSection) {
            const int step = direction == nav::Direction::Left ? -1 : 1;
            for (int control = homeControl_ + step; control >= 0 && control < 3; control += step) {
                if (!HomeControlEnabled(current, control)) continue;
                homeControl_ = control;
                return true;
            }
            if (step > 0) return false;
        }
        if (current.ctl == Ctl::Slider) {
            const int value = std::atoi(PrefValue(current.pref).c_str());
            const int step = direction == nav::Direction::Left ? -10 : 10;
            SetPref(current.pref, std::to_string(std::clamp(value + step, 100, 300)));
            return true;
        }
        if (SegmentedRow(current)) {
            const std::size_t count = SegmentLabels(current).size();
            const std::size_t index = SegmentIndex(current);
            if (direction == nav::Direction::Right && index + 1 < count) {
                SetSegment(current, index + 1);
                return true;
            }
            if (direction == nav::Direction::Left && index > 0) {
                SetSegment(current, index - 1);
                return true;
            }
        }
        if (direction == nav::Direction::Left) {
            // Back to the list of categories, on the one being shown.
            pane_ = term_.empty() ? Pane::Categories : Pane::Search;
            contentUsed_ = false;
            categoryFocus_ = category_;
            return true;
        }
        return false;
    }
    if (direction != nav::Direction::Up && direction != nav::Direction::Down) return false;
    // The nearest focusable row above or below. Headings and info rows are skipped.
    std::optional<std::size_t> next;
    if (direction == nav::Direction::Down) {
        for (std::size_t i = *focus_ + 1; i < rows_.size() && !next.has_value(); ++i) {
            if (Focusable(rows_[i])) next = i;
        }
    } else {
        for (std::size_t i = *focus_; i > 0 && !next.has_value(); --i) {
            if (Focusable(rows_[i - 1])) next = i - 1;
        }
    }
    if (!next.has_value()) {
        // Up from the first match returns to the search field.
        if (direction == nav::Direction::Up && !term_.empty()) {
            pane_ = Pane::Search;
            return true;
        }
        return false;
    }
    focus_ = next;
    if (!HomeControlEnabled(rows_[*next], homeControl_)) homeControl_ = 2;
    EnsureVisible(rows_[*next], nowMs);
    return true;
}

std::optional<Command> SettingsScreen::Select(double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (webhookDraft_) {
        SaveWebhook();
        return std::nullopt;
    }
    if (select_.IsOpen()) {
        PickOption(select_.Highlighted(), nowMs);
        return std::nullopt;
    }
    if (pane_ == Pane::Search) {
        // Enter in the field moves on to what it found.
        if (!term_.empty() && focus_.has_value()) {
            pane_ = Pane::Content;
            contentUsed_ = true;
        } else if (term_.empty()) {
            pane_ = Pane::Categories;
            categoryFocus_ = category_;
        }
        return std::nullopt;
    }
    if (pane_ == Pane::Categories) {
        if (focus_.has_value()) {
            pane_ = Pane::Content;
            contentUsed_ = true;
        }
        return std::nullopt;
    }
    const std::optional<std::size_t> index = FocusedIndex();
    if (!index.has_value()) return std::nullopt;
    contentUsed_ = true;
    return ApplyRow(*index);
}

void SettingsScreen::OpenSelect(std::size_t index) {
    const Row& row = rows_[index];
    std::vector<DropdownOption> options;
    std::size_t selected = 0;
    double widthRem = 15.0;
    if (row.kind == RowKind::Language) {
        // A list of the supported languages opens under the row's value, as Android's picker does.
        for (std::size_t i = 0; i < kLanguages.size(); ++i) {
            options.push_back(DropdownOption{kLanguages[i].name, ""});
            if (core_.language == kLanguages[i].id) selected = i;
        }
    } else {
        const std::string current = PrefValue(row.pref);
        std::size_t longest = 0;
        for (std::size_t i = 0; i < row.options.size(); ++i) {
            options.push_back(DropdownOption{row.options[i].label, ""});
            if (row.options[i].id == current) selected = i;
            longest = std::max(longest, row.options[i].label.size());
        }
        widthRem = std::clamp(static_cast<double>(longest) * 0.52 + 3.5, 12.0, 24.0);
    }
    const Box box = ScreenBox(row);
    const double width = metrics_.Rem(widthRem);
    select_.Open(Box{box.Right() - width, box.y, width, box.height}, std::move(options), selected, width_, height_,
                 metrics_.rem, clockMs_, motion_);
    selectRow_ = index;
}

std::optional<Command> SettingsScreen::ApplyRow(std::size_t index) {
    Row& row = rows_[index];
    switch (row.kind) {
    case RowKind::Motion:
        // Auto and Reduced toggle, as the web row does. Full is set elsewhere.
        motion_.preference = motion_.preference == motion::MotionPreference::Reduced
                                 ? motion::MotionPreference::Auto
                                 : motion::MotionPreference::Reduced;
        store_.SaveMotion(motion_);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Performance:
        motion_.performanceMode = !motion_.performanceMode;
        store_.SaveMotion(motion_);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Language:
        OpenSelect(index);
        return std::nullopt;

    case RowKind::Theme:
        SetSegment(row, store_.Look() == Theme::Dark ? 1 : 0);
        return std::nullopt;

    case RowKind::Glass:
        if (row.key == "font") {
            const UiFont current = store_.Font();
            store_.SetFont(current == UiFont::Geist ? UiFont::Inter : current == UiFont::Inter ? UiFont::System : UiFont::Geist);
        } else {
            store_.SetReduceTransparency(!store_.ReduceTransparency());
        }
        RefreshDetails();
        return std::nullopt;

    case RowKind::AutoUpdate:
        core_.autoUpdate = !core_.autoUpdate;
        store_.SaveCorePrefs(prefs::CorePrefsPatch{std::nullopt, core_.autoUpdate});
        RefreshDetails();
        return std::nullopt;

    case RowKind::ChooseProfile:
        store_.SaveChooseProfileOnLaunch(!store_.ChooseProfileOnLaunch());
        RefreshDetails();
        return std::nullopt;

    case RowKind::Pref:
        if (row.ctl == Ctl::Switch) {
            SetPref(row.pref, PrefValue(row.pref) == "1" ? "0" : "1");
        } else if (row.ctl == Ctl::Segmented) {
            // OK steps to the next choice and wraps, as Theme and Font do.
            SetSegment(row, (SegmentIndex(row) + 1) % std::max<std::size_t>(row.options.size(), 1));
        } else if (row.ctl == Ctl::Select) {
            OpenSelect(index);
        } else if (row.ctl == Ctl::Text) {
            webhookDraft_ = PrefValue(row.pref);
            webhookInvalid_ = false;
            webhookSelected_ = !webhookDraft_->empty();
        }
        return std::nullopt;

    case RowKind::HomeSection: {
        const std::string id = row.pref;
        EditHomeSection(id, homeControl_);
        return std::nullopt;
    }
    case RowKind::Push:
        return row.command;

    case RowKind::Group:
    case RowKind::Info:
    case RowKind::Preview:
        break;
    }
    return std::nullopt;
}

std::optional<std::string> SettingsScreen::FocusedKey() const {
    if (pane_ == Pane::Search) return std::string("search");
    if (pane_ == Pane::Categories) return std::string("cat:") + kCategories[static_cast<std::size_t>(categoryFocus_)].id;
    if (!focus_.has_value()) return std::nullopt;
    return rows_[*focus_].key;
}

void SettingsScreen::PickOption(std::size_t index, double nowMs) {
    if (selectRow_.has_value() && *selectRow_ < rows_.size()) {
        const Row& row = rows_[*selectRow_];
        if (row.kind == RowKind::Language) {
            if (index < kLanguages.size()) {
                core_.language = kLanguages[index].id;
                store_.SaveCorePrefs(prefs::CorePrefsPatch{core_.language, std::nullopt});
                RefreshDetails();
            }
        } else if (index < row.options.size()) {
            SetPref(row.pref, row.options[index].id);
        }
    }
    select_.Close(nowMs);
    selectRow_.reset();
}

bool SettingsScreen::CloseOverlay(double nowMs) {
    if (webhookDraft_) {
        webhookDraft_.reset();
        return true;
    }
    if (select_.IsOpen()) {
        select_.Close(nowMs);
        selectRow_.reset();
        return true;
    }
    // Back steps out one level at a time: a search is cleared, then the field is left for the categories, and the
    // content, once it has been used, returns to the list. From the list, Back leaves Settings.
    if (pane_ == Pane::Search) {
        if (!query_.empty()) {
            query_.clear();
            ChangeQuery(nowMs);
        } else {
            pane_ = Pane::Categories;
            categoryFocus_ = category_;
        }
        return true;
    }
    if (pane_ == Pane::Content && contentUsed_) {
        pane_ = term_.empty() ? Pane::Categories : Pane::Search;
        contentUsed_ = false;
        categoryFocus_ = category_;
        return true;
    }
    return false;
}

void SettingsScreen::PressedElsewhere(const std::optional<std::string>& key, double /*nowMs*/) {
    if (webhookDraft_ && key != std::optional<std::string>("webhook-url")) webhookDraft_.reset();
    // Clicking away from the search field ends the typing, as a desktop text box loses its caret.
    if (pane_ == Pane::Search && key != std::optional<std::string>("search")) {
        pane_ = Pane::Categories;
        categoryFocus_ = category_;
    }
}

bool SettingsScreen::FocusItem(const std::string& key, double nowMs, bool withCamera) {
    if (key.rfind("lang:", 0) == 0) {
        select_.Hover(std::stoul(key.substr(5)), nowMs);
        return true;
    }
    // Text fields take the focus for editing on click, not on hover.
    if (key == "search" || webhookDraft_) return false;
    if (key.rfind("cat:", 0) == 0) {
        const std::string id = key.substr(4);
        for (std::size_t c = 0; c < kCategories.size(); ++c) {
            if (id != kCategories[c].id) continue;
            if (pane_ == Pane::Categories && categoryFocus_ == static_cast<int>(c)) return false;
            pane_ = Pane::Categories;
            categoryFocus_ = static_cast<int>(c);
            return true;
        }
        return false;
    }
    const std::string base = key.substr(0, key.find('#'));
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& candidate = rows_[i];
        if (candidate.kind == RowKind::Group || candidate.kind == RowKind::Info || candidate.kind == RowKind::Preview ||
            candidate.key != base) {
            continue;
        }
        // While a search is shown, only its matches can be focused; otherwise the category is shown first.
        if (!term_.empty() && !Shown(candidate)) continue;
        const bool sameCategory = candidate.category == category_;
        if (pane_ == Pane::Content && focus_ == std::optional<std::size_t>(i)) return false;
        if (term_.empty() && !sameCategory) SelectCategory(candidate.category, true);
        pane_ = Pane::Content;
        focus_ = i;
        homeControl_ = 2;
        if (candidate.kind == RowKind::HomeSection && key.size() == base.size() + 2) {
            const int control = key.back() - '0';
            if (HomeControlEnabled(candidate, control)) homeControl_ = control;
        }
        if (withCamera) EnsureVisible(rows_[i], nowMs);
        return true;
    }
    return false;
}

std::optional<std::string> SettingsScreen::ItemAt(double x, double y) const {
    if (select_.IsOpen()) {
        // While the list is open it is the only thing to pick; a click anywhere else closes it.
        if (const std::optional<std::size_t> row = select_.RowAt(x, y)) return "lang:" + std::to_string(*row);
        if (select_.Contains(x, y)) return std::nullopt;
        return std::string("lang-dismiss");
    }
    const Box search = SearchBox();
    if (x >= search.x && x < search.Right() && y >= search.y && y < search.Bottom()) return std::string("search");
    const std::vector<int> present = PresentCategories();
    for (std::size_t slot = 0; slot < present.size(); ++slot) {
        const Box box = CategoryBox(slot);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) {
            return std::string("cat:") + kCategories[static_cast<std::size_t>(present[slot])].id;
        }
    }
    if (x < contentLeft_ - metrics_.Rem(0.5)) return std::nullopt;
    for (const Row& row : rows_) {
        if (!Focusable(row)) continue;
        const Box box = ScreenBox(row);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) {
            if (row.kind == RowKind::HomeSection) {
                const auto boxes = HomeControls(row);
                for (std::size_t i = 0; i < boxes.size(); ++i) {
                    const auto& control = boxes[i];
                    if (x >= control.x && x < control.Right() && y >= control.y && y < control.Bottom())
                        return row.key + "#" + std::to_string(i);
                }
                return std::nullopt;
            }
            if (row.ctl == Ctl::Slider) {
                const Box track = controls::SliderBox(box.Right() - metrics_.Rem(1.2), box.CenterY(), metrics_.rem);
                if (x >= track.x - metrics_.Rem(0.6) && y >= track.y && y < track.Bottom()) {
                    const int value = 100 + 10 * static_cast<int>(std::lround(20 * controls::SliderRatio(track, x, metrics_.rem)));
                    return row.key + "#" + std::to_string(value);
                }
            }
            if (SegmentedRow(row)) {
                const Box track = SegmentTrack(row);
                if (const std::optional<std::size_t> segment =
                        controls::SegmentAt(track, SegmentLabels(row).size(), x, y)) {
                    return row.key + "#" + std::to_string(*segment);
                }
            }
            return row.key;
        }
    }
    return std::nullopt;
}

std::optional<Command> SettingsScreen::ActivateItem(const std::string& key, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (key == "lang-dismiss") {
        select_.Close(nowMs);
        selectRow_.reset();
        return std::nullopt;
    }
    if (key.rfind("lang:", 0) == 0) {
        PickOption(std::stoul(key.substr(5)), nowMs);
        return std::nullopt;
    }
    if (key == "search") {
        pane_ = Pane::Search;
        return std::nullopt;
    }
    if (key.rfind("cat:", 0) == 0) {
        const std::string id = key.substr(4);
        for (std::size_t c = 0; c < kCategories.size(); ++c) {
            if (id == kCategories[c].id) {
                query_.clear();
                term_.clear();
                SelectCategory(static_cast<int>(c), true);
                pane_ = Pane::Categories;
                contentUsed_ = false;
            }
        }
        return std::nullopt;
    }
    if (webhookDraft_ && key == "webhook-url") return std::nullopt;
    if (const std::size_t hash = key.find('#'); hash != std::string::npos) {
        // A click on one segment of a choice sets it directly.
        const std::string base = key.substr(0, hash);
        FocusItem(base, nowMs, true);
        contentUsed_ = true;
        for (const Row& row : rows_) {
            if (row.key != base || !Shown(row)) continue;
            if (row.ctl == Ctl::Slider) {
                SetPref(row.pref, std::to_string(std::clamp(std::atoi(key.c_str() + hash + 1), 100, 300)));
                return std::nullopt;
            }
            if (row.kind == RowKind::HomeSection) {
                const std::string id = row.pref;
                homeControl_ = key.back() - '0';
                EditHomeSection(id, homeControl_);
                return std::nullopt;
            }
            if (!SegmentedRow(row)) continue;
            const std::size_t index = std::stoul(key.substr(hash + 1));
            if (index < SegmentLabels(row).size()) SetSegment(row, index);
        }
        return std::nullopt;
    }
    if (!FocusItem(key, nowMs, true) && FocusedKey() != std::optional<std::string>(key)) return std::nullopt;
    return Select(nowMs);
}

std::optional<ScrollSurface> SettingsScreen::SurfaceAt(double x, double y, nav::Axis axis) const {
    if (axis != nav::Axis::Y) return std::nullopt;
    if (x < 0.0 || x >= width_ || y < 0.0 || y >= height_) return std::nullopt;
    ScrollSurface surface;
    surface.kind = ScrollSurface::Kind::Page;
    surface.scroll = pageScroll_;
    surface.target = camera_.active() ? camera_.target() : pageScroll_;
    surface.maxScroll = MaxPageScroll();
    surface.viewport = height_;
    surface.canPan = MaxPageScroll() > 0.0;
    return surface;
}

void SettingsScreen::SetScroll(const ScrollSurface& surface, double value, double /*nowMs*/) {
    if (surface.kind != ScrollSurface::Kind::Page) return;
    camera_.Cancel();
    pageScroll_ = std::clamp(value, 0.0, MaxPageScroll());
}

void SettingsScreen::AnimateScroll(const ScrollSurface& surface, double target, double /*nowMs*/) {
    if (surface.kind != ScrollSurface::Kind::Page) return;
    const motion::CameraStart start =
        camera_.Begin(pageScroll_, target, MaxPageScroll(), motion::PrefersReducedMotion(motion_));
    if (start == motion::CameraStart::Landed) pageScroll_ = camera_.position();
}

// ----------------------------------------------------------------------------------------------- painting

void SettingsScreen::PaintSearch(Painter& painter, bool focused) const {
    const Box box = SearchBox();
    const double rem = metrics_.rem;
    painter.FillRoundRect(box, metrics_.Rem(kRowRadiusRem), tokens::kSurface);
    painter.StrokeRoundRect(box, metrics_.Rem(kRowRadiusRem), focused ? 2.0 : 1.0,
                            focused ? tokens::kFocusRing : tokens::kBorderSoft);
    const double icon = 1.1 * rem;
    painter.Path(Box{box.x + 0.8 * rem, box.CenterY() - icon / 2.0, icon, icon}, 24.0, kSearchIcon,
                 PathStyle{Color{0, 0, 0, 0}, focused ? tokens::kText : tokens::kTextMuted, 2.0, false});
    const TextStyle style{0.9375 * rem, false, 500};
    const double textX = box.x + 2.5 * rem;
    const double textWidth = std::max(0.0, box.Right() - textX - 0.7 * rem);
    if (query_.empty()) {
        painter.Text(Box{textX, box.y, textWidth, box.height}, "Search settings", style, tokens::kTextFaint);
    } else {
        painter.Text(Box{textX, box.y, textWidth, box.height}, query_, style, tokens::kText);
    }
    if (focused) {
        const double used = query_.empty() ? 0.0 : std::min(painter.MeasureText(query_, style), textWidth);
        painter.FillRoundRect(Box{textX + used + 1.0, box.y + box.height * 0.26, 2.0, box.height * 0.48}, 1.0,
                              tokens::kAccentStrong);
    }
}

void SettingsScreen::Paint(Painter& painter) const {
    painter.Clear(tokens::kBackground);
    // A plain page: no picture behind it. The glass is told there is no backdrop, so nothing faint shows through.
    painter.SetBackdrop(Box{0.0, 0.0, 0.0, 0.0}, "", 0.5, 0.2);

    const double rem = metrics_.rem;
    const bool showFocus = !focusHidden_;
    const bool searching = !term_.empty();

    // Left pane: the title, the search field and the categories. It does not scroll.
    painter.Text(Box{paneLeft_, metrics_.Rem(kSafeYRem), paneWidth_, metrics_.Rem(2.4)}, "Settings", type::H2(rem),
                 tokens::kText);
    PaintSearch(painter, showFocus && pane_ == Pane::Search);
    const std::vector<int> present = PresentCategories();
    for (std::size_t slot = 0; slot < present.size(); ++slot) {
        const int c = present[slot];
        const Box box = CategoryBox(slot);
        const bool selected = !searching && c == category_;
        const bool focused = showFocus && pane_ == Pane::Categories && categoryFocus_ == c;
        if (selected) painter.FillRoundRect(box, metrics_.Rem(kRowRadiusRem), tokens::kSurfaceHover);
        if (focused) painter.StrokeRoundRect(box, metrics_.Rem(kRowRadiusRem), 2.0, tokens::kFocusRing);
        const Color ink = selected || focused ? tokens::kText : tokens::kTextMuted;
        const double icon = 1.25 * rem;
        painter.Path(Box{box.x + 0.8 * rem, box.CenterY() - icon / 2.0, icon, icon}, 24.0,
                     kCategories[static_cast<std::size_t>(c)].icon, PathStyle{Color{0, 0, 0, 0}, ink, 1.8, false});
        painter.Text(Box{box.x + 2.7 * rem, box.y, box.width - 2.9 * rem, box.height},
                     kCategories[static_cast<std::size_t>(c)].title, TextStyle{0.9375 * rem, true, selected ? 650 : 520}, ink);
    }

    // Right pane: title, one line about it, then the cards.
    const CategoryDef& def = kCategories[static_cast<std::size_t>(category_)];
    const double headY = metrics_.Rem(kSafeYRem) - pageScroll_;
    painter.Text(Box{contentLeft_, headY, contentWidth_, metrics_.Rem(3.2)}, searching ? "Search results" : def.title,
                 type::H1(rem), tokens::kText);
    painter.Text(Box{contentLeft_, headY + metrics_.Rem(3.3), contentWidth_, metrics_.Rem(1.6)},
                 searching ? "Settings matching your search." : def.description, type::Body(rem), tokens::kTextMuted);

    if (searching && headings_.empty()) {
        painter.Text(Box{contentLeft_, metrics_.Rem(kSafeYRem) + metrics_.Rem(6.2) - pageScroll_, contentWidth_, metrics_.Rem(2.0)},
                     "No settings match \xE2\x80\x9C" + Trimmed(query_) + "\xE2\x80\x9D.", type::Body(rem), tokens::kTextMuted);
    }

    for (const CardBox& card : cards_) {
        const Box box{contentLeft_, card.top - pageScroll_, contentWidth_, card.height};
        if (box.Bottom() < -20.0 || box.y > height_ + 20.0) continue;
        painter.FillRoundRect(box, metrics_.Rem(kCardRadiusRem), tokens::kSurface);
        painter.StrokeRoundRect(box, metrics_.Rem(kCardRadiusRem), 1.0, tokens::kBorderSoft);
    }

    const auto heading = [&](double top, const std::string& text) {
        const double titleHeight = metrics_.Rem(kGroupTitleRem) * 1.6;
        const Box box{contentLeft_, top - pageScroll_, contentWidth_, titleHeight};
        if (box.Bottom() < -20.0 || box.y > height_ + 20.0) return;
        std::string title = text;
        for (char& c : title) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        painter.Text(Box{box.x + metrics_.Rem(0.4), box.y, box.width, box.height}, title,
                     TextStyle{metrics_.Rem(kGroupTitleRem) * 0.8, true, 700, 0.06}, tokens::kTextFaint);
    };
    for (const Heading& head : headings_) heading(head.top, head.title);

    bool afterRow = false;
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& row = rows_[i];
        if (!Shown(row)) continue;
        const Box box = ScreenBox(row);
        if (row.kind == RowKind::Group) {
            afterRow = false;
            heading(row.top, row.label);
            continue;
        }
        // The first row of a category's matches starts a new card.
        if (searching && i > 0) {
            std::size_t before = i;
            while (before > 0 && !Shown(rows_[before - 1])) --before;
            if (before == 0 || rows_[before - 1].category != row.category) afterRow = false;
        }
        const bool visible = !(box.Bottom() < -20.0 || box.y > height_ + 20.0);
        if (visible) {
            if (afterRow) {
                painter.FillRoundRect(Box{box.x + metrics_.Rem(1.2), box.y, box.width - metrics_.Rem(2.4), 1.0}, 0.0,
                                      tokens::kBorderSoft);
            }
            PaintRow(painter, row, showFocus && pane_ == Pane::Content && focus_ == std::optional<std::size_t>(i));
        }
        afterRow = true;
    }
    select_.Paint(painter, clockMs_);
}

void SettingsScreen::PaintPreview(Painter& painter, const Row& row) const {
    // A strip of picture with the subtitle drawn as the player will draw it.
    const Box box = ScreenBox(row);
    const double rem = metrics_.rem;
    const std::string size = settings_.Get("subtitleStyle.size");
    const std::string color = settings_.Get("subtitleStyle.color");
    const std::string back = settings_.Get("subtitleStyle.background");
    const Box frame{box.Right() - 15.0 * rem - 1.2 * rem, box.y + 0.7 * rem, 15.0 * rem, box.height - 1.4 * rem};
    painter.FillRoundRect(frame, 0.6 * rem, Rgb(0x0B0F17));
    painter.StrokeRoundRect(frame, 0.6 * rem, 1.0, tokens::kBorderSoft);
    painter.FillLinearGradient(frame, frame.x, frame.y, frame.x, frame.Bottom(),
                               {{0.0, Rgb(0x2A3A55, 0.55)}, {1.0, Rgb(0x0B0F17, 0.0)}});
    const double factor = size == "s" ? 0.8 : size == "l" ? 1.25 : size == "xl" ? 1.5 : 1.0;
    const TextStyle style{factor * rem, true, 600};
    const std::string sample = "A quiet evening.";
    const double textWidth = std::min(painter.MeasureText(sample, style), frame.width - 1.0 * rem);
    const Box text{frame.CenterX() - textWidth / 2.0 - 1.0, frame.Bottom() - factor * rem * 1.9, textWidth + 4.0, factor * rem * 1.5};
    if (back == "box") {
        painter.FillRoundRect(Box{text.x - 0.4 * rem, text.y - 0.1 * rem, text.width + 0.8 * rem, text.height + 0.2 * rem},
                              0.25 * rem, Rgb(0x07080B, 0.92));
    } else if (back == "shadow") {
        painter.Text(Box{text.x + 1.0, text.y + 1.5, text.width, text.height}, sample, style, Rgb(0x000000, 0.85));
    }
    const Color ink = color == "yellow" ? Rgb(0xFFE14D) : color == "cyan" ? Rgb(0x4DE3F5) : Rgb(0xFFFFFF);
    painter.Text(text, sample, style, ink);
}

std::array<Box, 3> SettingsScreen::HomeControls(const Row& row) const {
    const Box box = ScreenBox(row);
    const double rem = metrics_.rem;
    const Box toggle = controls::SwitchBox(box.Right() - 1.2 * rem, box.CenterY(), rem);
    const double size = 2.0 * rem;
    const Box down{toggle.x - 0.8 * rem - size, box.CenterY() - size / 2.0, size, size};
    const Box up{down.x - 0.35 * rem - size, down.y, size, size};
    return {up, down, toggle};
}

bool SettingsScreen::HomeControlEnabled(const Row& row, int control) const {
    if (row.kind != RowKind::HomeSection || control < 0 || control > 2) return false;
    if (control == 2) return true;
    const auto at = std::find_if(homeRows_.begin(), homeRows_.end(), [&](const auto& section) { return section.id == row.pref; });
    if (at == homeRows_.end()) return false;
    return control == 0 ? at != homeRows_.begin() : std::next(at) != homeRows_.end();
}

void SettingsScreen::EditHomeSection(const std::string& id, int control) {
    const auto row = std::find_if(rows_.begin(), rows_.end(), [&](const auto& item) { return item.pref == id && item.kind == RowKind::HomeSection; });
    if (row == rows_.end() || !HomeControlEnabled(*row, control)) return;
    auto at = std::find_if(homeRows_.begin(), homeRows_.end(), [&](const auto& section) { return section.id == id; });
    if (control == 2) at->visible = !at->visible;
    else std::iter_swap(at, at + (control == 0 ? -1 : 1));

    auto ordered = homeRows_;
    // Keep rows from other clients and inactive releases in the device's preference.
    for (const auto& saved : settings_.homeSections) {
        if (std::none_of(ordered.begin(), ordered.end(), [&](const auto& known) { return known.id == saved.id; }))
            ordered.push_back(saved);
    }
    const auto patch = HomeSectionsPatch(ordered);
    settings_.homeSections = std::move(ordered);
    RebuildRowsKeepingFocus();
    if (focus_) {
        const Row& moved = rows_[*focus_];
        if (!HomeControlEnabled(moved, homeControl_)) homeControl_ = 2;
        EnsureVisible(moved, clockMs_);
    }
    if (sink_) sink_(patch);
}

Box SettingsScreen::WebhookField(const Row& row) const {
    const Box box = ScreenBox(row);
    const double rem = metrics_.rem;
    return {box.x + 1.2 * rem, box.Bottom() - 3.55 * rem, box.width - 2.4 * rem, 3.0 * rem};
}

void SettingsScreen::SaveWebhook() {
    std::string value = Trimmed(*webhookDraft_);
    if (!value.empty()) {
        const std::string scheme = Lower(value.substr(0, value.find(':')));
        const std::size_t start = scheme.size() + 3;
        const std::string host = start <= value.size() ? value.substr(start, value.find_first_of("/?#", start) - start) : "";
        const bool valid = (scheme == "http" || scheme == "https") && value.compare(scheme.size(), 3, "://") == 0 &&
                           !host.empty() && host.find('@') == std::string::npos && value.find_first_of(" \t\r\n\\") == std::string::npos;
        if (!valid) {
            webhookInvalid_ = true;
            return;
        }
    }
    webhookDraft_.reset();
    SetPref("webhookUrl", value);
}

void SettingsScreen::PaintRow(Painter& painter, const Row& row, bool focused) const {
    const Box box = ScreenBox(row);
    const double rem = metrics_.rem;
    if (row.kind == RowKind::HomeSection) {
        const auto boxes = HomeControls(row);
        const auto current = std::find_if(homeRows_.begin(), homeRows_.end(), [&](const auto& item) { return item.id == row.pref; });
        const double x = box.x + 1.2 * rem;
        painter.Text({x, box.y, std::max(0.0, boxes[0].x - x - 0.8 * rem), box.height},
                     row.label, type::Label(rem), tokens::kText);
        for (int i = 0; i < 2; ++i) {
            const Box& button = boxes[static_cast<std::size_t>(i)];
            const bool enabled = HomeControlEnabled(row, i);
            const bool active = enabled && focused && homeControl_ == i;
            painter.FillRoundRect(button, 0.625 * rem, enabled ? tokens::kSurfaceHover : tokens::kSurface);
            if (active) painter.StrokeRoundRect(button, 0.625 * rem, 2.0, tokens::kFocusRing);
            const double pad = 0.38 * rem;
            painter.Path({button.x + pad, button.y + pad, button.width - 2.0 * pad, button.height - 2.0 * pad}, 24.0,
                         i == 0 ? "M6 14l6-6 6 6" : "M6 10l6 6 6-6",
                         {Rgb(0, 0.0), enabled ? tokens::kText : tokens::kTextFaint, 2.0});
        }
        controls::PaintSwitch(painter, boxes[2], current != homeRows_.end() && current->visible, focused && homeControl_ == 2);
        return;
    }
    if (focused) {
        const Box inset{box.x + 4.0, box.y + 3.0, box.width - 8.0, box.height - 6.0};
        painter.FillRoundRect(inset, metrics_.Rem(kRowRadiusRem), WithAlpha(tokens::kText, 0.06));
        painter.StrokeRoundRect(inset, metrics_.Rem(kRowRadiusRem), 2.0, tokens::kFocusRing);
    }

    const bool danger = row.key == "factory-reset" || row.key == "clear-cache";
    const Color labelColor = danger ? kDanger : tokens::kText;
    double right = box.Right() - metrics_.Rem(1.2);

    if (row.ctl == Ctl::Text || row.key == "skip-segments") {
        const double x = box.x + 1.2 * rem;
        const double width = box.width - 2.4 * rem;
        painter.Text({x, box.y + 0.35 * rem, width, 1.4 * rem}, row.label, type::Label(rem), labelColor);
        if (row.ctl == Ctl::Text) {
            const bool editing = webhookDraft_.has_value();
            const bool error = editing && webhookInvalid_;
            painter.Text({x, box.y + 1.75 * rem, width, 1.35 * rem},
                         error ? "Enter an HTTP or HTTPS URL without a username or password." : row.desc,
                         type::Caption(rem), error ? kDanger : tokens::kTextMuted);
            const std::string value = editing ? *webhookDraft_ : (row.detail.empty() ? "https://" : row.detail);
            controls::PaintTextField(painter, WebhookField(row), value, editing, editing && webhookSelected_, rem);
        } else {
            painter.Paragraph({x, box.y + 1.85 * rem, width, 2.2 * rem}, row.desc, type::Caption(rem), tokens::kTextMuted);
            const auto change = changedSegment_ == row.key
                                    ? std::optional(controls::SegmentChange{previousSegment_, clockMs_ - segmentChangedAt_})
                                    : std::nullopt;
            controls::PaintSegmented(painter, SegmentTrack(row), SegmentLabels(row), SegmentIndex(row), false, rem, change);
        }
        return;
    }

    // At the right: a switch, a segmented choice, a value with a chevron, or the way in.
    if (row.ctl == Ctl::Slider) {
        const Box track = controls::SliderBox(right, box.CenterY(), rem);
        const double ratio = (std::atoi(PrefValue(row.pref).c_str()) - 100) / 200.0;
        controls::PaintSlider(painter, track, ratio, row.detail, rem);
        right = track.x - rem;
    } else if (row.kind == RowKind::Preview) {
        PaintPreview(painter, row);
        right = box.Right() - 15.0 * rem - 2.0 * rem;
    } else if (SwitchRow(row)) {
        const Box track = controls::SwitchBox(right, box.CenterY(), rem);
        controls::PaintSwitch(painter, track, SplitDetail(row.detail).first == "On", false);
        right = track.x - metrics_.Rem(0.8);
    } else if (SegmentedRow(row)) {
        const Box track = SegmentTrack(row);
        const auto change = changedSegment_ == row.key
                                ? std::optional(controls::SegmentChange{previousSegment_, clockMs_ - segmentChangedAt_})
                                : std::nullopt;
        controls::PaintSegmented(painter, track, SegmentLabels(row), SegmentIndex(row), false, rem, change);
        right = track.x - metrics_.Rem(0.8);
    } else if (SelectRow(row)) {
        right = controls::PaintValueChevron(painter, right, box, row.detail, focused, rem) - metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Push) {
        // A push row with a description of its own shows its detail as the value, before the chevron.
        right = controls::PaintValueChevron(painter, right, box, row.desc.empty() ? "" : row.detail, focused, rem, true) -
                metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Info && !row.detail.empty()) {
        const TextStyle style{0.9375 * rem, true, 600};
        const double width = std::min(painter.MeasureText(row.detail, style), box.width * 0.52);
        painter.Text(Box{right - width, box.y, width + 2.0, box.height}, row.detail, style, tokens::kAccentStrong);
        right -= width + metrics_.Rem(0.8);
    }

    // The name, with its description under it in caption size.
    const double textX = box.x + metrics_.Rem(1.2);
    const double textWidth = std::max(0.0, right - textX);
    const std::string caption = Caption(row);
    const TextStyle labelStyle{0.9375 * rem, true, 600};
    if (caption.empty()) {
        painter.Text(Box{textX, box.y, textWidth, box.height}, row.label, labelStyle, labelColor);
        return;
    }
    painter.Text(Box{textX, box.y + box.height * 0.12, textWidth, box.height * 0.42}, row.label, labelStyle, labelColor);
    painter.Text(Box{textX, box.y + box.height * 0.52, textWidth, box.height * 0.34}, caption, type::Caption(rem),
                 tokens::kTextMuted);
}

}  // namespace tvm::ui
