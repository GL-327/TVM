// TVM native entry point.
//
//   tvm.exe                          run the app
//   tvm.exe --snapshot out.png       render the screen to a PNG and exit
//     --size 1920x1080               snapshot size (default 1920x1080)
//     --keys Right,Down,Select       remote presses to apply before the snapshot
//                                    (Up, Down, Left, Right, Select, Back)
//     --theme light --screen settings  capture the light Settings page
//     --art file.jpg                 the Home hero's picture (default: the bundled lighthouse)
//   tvm.exe --frames out-dir --scenario tab-switch
//                                    write an animation as numbered PNG frames, 30 per second:
//                                    nav-intro, tab-switch, buttons, orb or menu
//
// The snapshot mode is for visual checks. It runs the same shell and the same
// animations, then saves the settled frame. It uses a throwaway data folder, so
// it never changes the viewer's preferences.

#include <windows.h>
#include <objbase.h>
#include <shellapi.h>

#include <cstdio>
#include <exception>
#include <filesystem>
#include <functional>
#include <cwchar>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "core/paths.h"
#include "core/util.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "platform/app.h"
#include "platform/graphics.h"
#include "platform/snapshot.h"
#include "ui/player_screen.h"
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/shell.h"
#include "ui/theme.h"
#include "ui/settings_screen.h"

namespace {

using tvm::nav::Direction;
using tvm::ui::RailSpec;

// The snapshot Home screen's view, matching Study 03 (Roku Home) and the live Stream Home layout. `lane`
// picks the tab that is on: 0 Home, 1 Movies, 2 Series.
tvm::ui::SceneView SnapshotHomeView(int lane) {
    const auto open = [](const std::string& name, bool modal = false) {
        tvm::ui::Command command;
        command.name = name;
        command.modal = modal;
        return command;
    };
    const auto act = [](const std::string& name, const std::string& lane = "") {
        tvm::ui::Command command;
        command.name = name;
        command.action = true;
        if (!lane.empty()) command.params["lane"] = lane;
        return command;
    };

    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    view.topButtons = {
        tvm::ui::TopButton{"Home", act("stream-lane", "all"), lane == 0},
        tvm::ui::TopButton{"Movies", act("stream-lane", "movies"), lane == 1},
        tvm::ui::TopButton{"Series", act("stream-lane", "shows"), lane == 2},
        tvm::ui::TopButton{"Live TV", open("live-tv"), false},
        tvm::ui::TopButton{"Library", open("watchlist"), false},
        tvm::ui::TopButton{"Search", open("search", true), false},
        tvm::ui::TopButton{"Profile", open("settings"), false, false, true},
    };

    tvm::ui::RailData continueWatching;
    continueWatching.id = "continue-watching";
    continueWatching.title = "Continue Watching";
    continueWatching.cards = {
        tvm::ui::CardData{"cw-1", "The Last Light", "asset:lighthouse.jpg", 0.38},
        tvm::ui::CardData{"cw-2", "The Winter Road", "", 0.72},
        tvm::ui::CardData{"cw-3", "Northward", "", 0.24},
        tvm::ui::CardData{"cw-4", "Quiet Harbor", "", 0.56},
        tvm::ui::CardData{"cw-5", "Distant Shore", "", 0.18},
    };
    view.rails.push_back(std::move(continueWatching));

    tvm::ui::RailData trending;
    trending.id = "trending-movies";
    trending.title = "Trending Movies";
    const char* trendingTitles[] = {
        "Cold Meridian", "Vesper", "The Glass Coast", "Solstice", "Low Tide",
        "High Water", "Ambergris", "Night Watch", "Far Sound", "Pale Signal"
    };
    for (std::size_t i = 0; i < 10; ++i) {
        trending.cards.push_back(tvm::ui::CardData{
            "tm-" + std::to_string(i + 1),
            trendingTitles[i],
            i == 0 ? "asset:lighthouse.jpg" : "",
            std::nullopt,
        });
    }
    view.rails.push_back(std::move(trending));

    tvm::ui::RailData picks;
    picks.id = "you-might-like";
    picks.title = "You might like";
    for (std::size_t i = 0; i < 10; ++i) {
        picks.cards.push_back(tvm::ui::CardData{
            "pick-" + std::to_string(i + 1),
            "Title " + std::to_string(i + 1),
            "",
            std::nullopt,
        });
    }
    view.rails.push_back(std::move(picks));
    return view;
}

// Configures the snapshot Home screen. `art` is the hero's picture, as a url the painter resolves.
std::unique_ptr<tvm::ui::Scene> SnapshotHomeScene(tvm::motion::MotionSettings motion, const std::string& art) {
    auto scene = std::make_unique<tvm::ui::Scene>(std::vector<RailSpec>{}, motion);
    scene->SetImageReady([](const std::string& url) { return !url.empty(); });

    tvm::ui::HeroData hero;
    hero.itemId = "featured-last-light";
    hero.title = "The Last Light";
    hero.meta = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
    hero.backdropUrl = art;
    hero.hue = 212;

    scene->SetHeroes({hero}, 0.0);
    scene->SetView(SnapshotHomeView(0), 0.0);
    scene->FocusItem("hero-play", 0.0, false);
    return scene;
}

std::optional<Direction> ParseDirection(const std::wstring& name) {
    if (name == L"Up") return Direction::Up;
    if (name == L"Down") return Direction::Down;
    if (name == L"Left") return Direction::Left;
    if (name == L"Right") return Direction::Right;
    return std::nullopt;
}

// Parses "WxH". Returns nothing for anything else.
std::optional<std::pair<unsigned, unsigned>> ParseSize(const std::wstring& text) {
    const auto x = text.find(L'x');
    if (x == std::wstring::npos) return std::nullopt;
    try {
        const unsigned long width = std::stoul(text.substr(0, x));
        const unsigned long height = std::stoul(text.substr(x + 1));
        if (width == 0 || height == 0 || width > 8192 || height > 8192) return std::nullopt;
        return std::make_pair(static_cast<unsigned>(width), static_cast<unsigned>(height));
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::vector<std::wstring> SplitCommas(const std::wstring& text) {
    std::vector<std::wstring> parts;
    std::wstring current;
    for (wchar_t c : text) {
        if (c == L',') {
            parts.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) parts.push_back(current);
    return parts;
}

// Runs the shell's motion until it settles, one 60 Hz frame at a time.
void SettleMotion(tvm::ui::Shell& shell, double& nowMs) {
    for (int frame = 0; frame < 2000 && shell.Animating(); ++frame) {
        nowMs += 16.0;
        shell.Tick(nowMs);
    }
}

int RunSnapshot(const std::wstring& path, unsigned width, unsigned height, const std::wstring& keys,
                tvm::ui::Theme theme, bool settings, const std::string& art) {
    tvm::platform::Graphics graphics;

    // A throwaway data folder, so a Settings press here cannot change the viewer's files.
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-snapshot-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    store.SaveLook(theme);
    std::unique_ptr<tvm::ui::Screen> root;
    if (settings) root = std::make_unique<tvm::ui::SettingsScreen>(store, store.Motion());
    else root = SnapshotHomeScene(store.Motion(), art);
    tvm::ui::Shell shell(std::move(root), store);
    shell.Layout(width, height);

    double nowMs = 0.0;
    for (const std::wstring& token : SplitCommas(keys)) {
        if (token == L"Select") {
            shell.Select(nowMs);
        } else if (token == L"Back") {
            shell.Back(nowMs);
        } else if (const auto direction = ParseDirection(token)) {
            shell.Navigate(*direction, nowMs);
        } else {
            std::fprintf(stderr, "unknown key in --keys\n");
            std::error_code ignored;
            std::filesystem::remove_all(tempData, ignored);
            return 2;
        }
        SettleMotion(shell, nowMs);
    }
    SettleMotion(shell, nowMs);

    tvm::platform::SaveSnapshot(shell, graphics, width, height, path);
    std::error_code ignored;
    std::filesystem::remove_all(tempData, ignored);
    std::printf("wrote %ls\n", path.c_str());
    return 0;
}


// One step of a scripted animation: at `atMs`, `apply` runs before that frame is drawn.
struct FrameEvent {
    double atMs;
    std::function<void(double nowMs)> apply;
};

// Writes an animation as numbered PNG frames at 30 per second, so the motion can be checked frame by frame
// and turned into a GIF. Every frame is drawn by the same Direct2D painter the window uses.
int RunFrames(const std::wstring& dir, const std::wstring& scenario, unsigned width, unsigned height,
              tvm::ui::Theme theme, const std::string& art) {
    tvm::platform::Graphics graphics;
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-frames-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    store.SaveLook(theme);
    std::filesystem::create_directories(dir);
    tvm::platform::SnapshotWriter writer(graphics, width, height);

    std::vector<FrameEvent> events;
    double endMs = 1500.0;
    std::function<bool(double)> tick;
    std::function<void(tvm::ui::Painter&)> paint;
    std::unique_ptr<tvm::ui::Shell> shell;
    std::unique_ptr<tvm::ui::PlayerScreen> player;

    if (scenario == L"menu") {
        tvm::ui::ThemeScope look(theme);
        player = std::make_unique<tvm::ui::PlayerScreen>();
        player->Layout(width, height);
        tvm::ui::PlayerView view;
        view.phase = tvm::ui::PlayerView::Phase::Playing;
        view.started = true;
        view.title = "The Last Light";
        view.position = 1520.0;
        view.duration = 7560.0;
        view.subtitles = {tvm::ui::PlayerOption{"off", "Off", "", false},
                          tvm::ui::PlayerOption{"en", "English", "", true},
                          tvm::ui::PlayerOption{"en-sdh", "English", "SDH", false},
                          tvm::ui::PlayerOption{"es", "Espa\xC3\xB1ol", "", false},
                          tvm::ui::PlayerOption{"fr", "Fran\xC3\xA7" "ais", "", false}};
        view.audios = {tvm::ui::PlayerOption{"a1", "English", "5.1", true}};
        player->SetView(view, 0.0);
        player->ShowChrome(0.0);
        tvm::ui::PlayerScreen* raw = player.get();
        events.push_back({200.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        events.push_back({1100.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        endMs = 1600.0;
        tick = [raw](double now) { return raw->Tick(now); };
        paint = [raw, art, width, height, theme](tvm::ui::Painter& painter) {
            tvm::ui::ThemeScope look(theme);
            // A still of the picture stands in for mpv's video under the player's chrome.
            painter.Clear(tvm::ui::Rgb(0x000000));
            painter.ImageFaded(tvm::ui::Box{0.0, 0.0, static_cast<double>(width), static_cast<double>(height)}, art,
                               0.0, 1.0, 0.5, 0.5);
            raw->Paint(painter);
        };
    } else {
        auto root = SnapshotHomeScene(store.Motion(), art);
        tvm::ui::Scene* scene = root.get();
        shell = std::make_unique<tvm::ui::Shell>(std::move(root), store);
        shell->Layout(width, height);
        tvm::ui::Shell* host = shell.get();
        const auto hover = [scene](const std::string& key) {
            return [scene, key](double now) { scene->FocusItem(key, now, false); };
        };
        const auto press = [scene](const std::string& key) {
            return [scene, key](double now) { scene->SetPressed(key, now); };
        };
        const auto release = [scene](double now) { scene->SetPressed(std::nullopt, now); };
        const auto lane = [scene](int which) {
            return [scene, which](double now) { scene->SetView(SnapshotHomeView(which), now); };
        };
        if (scenario == L"nav-intro") {
            endMs = 1000.0;
        } else if (scenario == L"tab-switch") {
            // Hover Movies, click it, then hover and click Series, then come back Home with the keyboard.
            events = {{150.0, hover("top:1")},  {300.0, press("top:1")},  {380.0, release},
                      {380.0, lane(1)},          {900.0, hover("top:2")}, {1050.0, press("top:2")},
                      {1130.0, release},         {1130.0, lane(2)},       {1700.0, hover("settings")},
                      {1700.0, lane(0)}};
            endMs = 2400.0;
        } else if (scenario == L"buttons") {
            // From a tab, hover Play, press and release it, then hover Details and press it.
            events = {{0.0, hover("settings")}, {200.0, hover("hero-play")}, {700.0, press("hero-play")},
                      {820.0, release},          {1150.0, hover("hero-info")}, {1600.0, press("hero-info")},
                      {1720.0, release}};
            endMs = 2200.0;
        } else if (scenario == L"orb") {
            events = {{0.0, hover("settings")}, {200.0, hover("top:6")}, {700.0, press("top:6")},
                      {820.0, release},          {1150.0, hover("settings")}};
            endMs = 1600.0;
        } else {
            std::fprintf(stderr, "unknown --scenario\n");
            return 2;
        }
        tick = [host](double now) { return host->Tick(now); };
        paint = [host](tvm::ui::Painter& painter) { host->Paint(painter); };
    }

    constexpr double kStepMs = 1000.0 / 30.0;
    std::size_t next = 0;
    int index = 0;
    for (double now = 0.0; now <= endMs + 0.5; now += kStepMs, ++index) {
        while (next < events.size() && events[next].atMs <= now + 0.5) events[next++].apply(now);
        tick(now);
        wchar_t name[64];
        swprintf(name, 64, L"%ls-%04d.png", scenario.c_str(), index);
        writer.Save(paint, (std::filesystem::path(dir) / name).wstring());
    }
    std::error_code ignored;
    std::filesystem::remove_all(tempData, ignored);
    std::printf("wrote %d frames\n", index);
    return 0;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE /*previous*/, PWSTR /*commandLine*/, int showCommand) {
    try {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

        int argc = 0;
        LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        std::vector<std::wstring> args;
        for (int i = 0; argv != nullptr && i < argc; ++i) args.emplace_back(argv[i]);
        if (argv != nullptr) LocalFree(argv);

        std::optional<std::wstring> snapshot;
        std::optional<std::wstring> frames;
        std::wstring scenario = L"tab-switch";
        std::string art = "asset:lighthouse.jpg";
        std::wstring keys;
        tvm::ui::Theme theme = tvm::ui::Theme::Dark;
        bool settings = false;
        unsigned width = 1920;
        unsigned height = 1080;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == L"--snapshot" && i + 1 < args.size()) {
                snapshot = args[++i];
            } else if (args[i] == L"--frames" && i + 1 < args.size()) {
                frames = args[++i];
            } else if (args[i] == L"--scenario" && i + 1 < args.size()) {
                scenario = args[++i];
            } else if (args[i] == L"--art" && i + 1 < args.size()) {
                art = "file:" + tvm::util::ToUtf8(std::filesystem::absolute(args[++i]).wstring());
            } else if (args[i] == L"--keys" && i + 1 < args.size()) {
                keys = args[++i];
            } else if (args[i] == L"--theme" && i + 1 < args.size()) {
                theme = tvm::ui::ParseTheme(tvm::util::ToUtf8(args[++i]));
            } else if (args[i] == L"--screen" && i + 1 < args.size()) {
                settings = args[++i] == L"settings";
            } else if (args[i] == L"--size" && i + 1 < args.size()) {
                const auto size = ParseSize(args[++i]);
                if (!size.has_value()) {
                    MessageBoxW(nullptr, L"--size must look like 1920x1080", L"TVM", MB_ICONERROR | MB_OK);
                    return 2;
                }
                width = size->first;
                height = size->second;
            }
        }

        if (frames.has_value()) return RunFrames(*frames, scenario, width, height, theme, art);
        if (snapshot.has_value()) return RunSnapshot(*snapshot, width, height, keys, theme, settings, art);

        tvm::platform::AppOptions options;
        options.dataDir = tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment()).wstring();
        tvm::platform::App app(instance, options);
        return app.Run(showCommand);
    } catch (const std::exception& error) {
        MessageBoxA(nullptr, error.what(), "TVM", MB_ICONERROR | MB_OK);
        return 1;
    }
}
