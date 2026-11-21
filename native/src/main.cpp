// TVM native entry point.
//
//   tvm.exe                          run the app
//   tvm.exe --snapshot out.png       render the screen to a PNG and exit
//     --size 1920x1080               snapshot size (default 1920x1080)
//     --keys Right,Down,Select       remote presses to apply before the snapshot
//                                    (Up, Down, Left, Right, Select, Back)
//     --theme light --screen settings  capture the light Settings page
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
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/shell.h"
#include "ui/settings_screen.h"

namespace {

using tvm::nav::Direction;
using tvm::ui::RailSpec;

// Configures the snapshot Home screen to match Study 03 (Roku Home) and the live Stream Home layout.
std::unique_ptr<tvm::ui::Scene> SnapshotHomeScene(tvm::motion::MotionSettings motion) {
    auto scene = std::make_unique<tvm::ui::Scene>(std::vector<RailSpec>{}, motion);
    scene->SetImageReady([](const std::string& url) { return !url.empty(); });

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

    tvm::ui::HeroData hero;
    hero.itemId = "featured-last-light";
    hero.title = "The Last Light";
    hero.meta = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
    hero.backdropUrl = "asset:lighthouse.jpg";
    hero.hue = 212;

    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    view.topButtons = {
        tvm::ui::TopButton{"Home", act("stream-lane", "all"), true},
        tvm::ui::TopButton{"Movies", act("stream-lane", "movies"), false},
        tvm::ui::TopButton{"Series", act("stream-lane", "shows"), false},
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

    scene->SetHeroes({hero}, 0.0);
    scene->SetView(view, 0.0);
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
                tvm::ui::Theme theme, bool settings) {
    tvm::platform::Graphics graphics;

    // A throwaway data folder, so a Settings press here cannot change the viewer's files.
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-snapshot-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    store.SaveLook(theme);
    std::unique_ptr<tvm::ui::Screen> root;
    if (settings) root = std::make_unique<tvm::ui::SettingsScreen>(store, store.Motion());
    else root = SnapshotHomeScene(store.Motion());
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
        std::wstring keys;
        tvm::ui::Theme theme = tvm::ui::Theme::Dark;
        bool settings = false;
        unsigned width = 1920;
        unsigned height = 1080;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == L"--snapshot" && i + 1 < args.size()) {
                snapshot = args[++i];
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

        if (snapshot.has_value()) return RunSnapshot(*snapshot, width, height, keys, theme, settings);

        tvm::platform::AppOptions options;
        options.dataDir = tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment()).wstring();
        tvm::platform::App app(instance, options);
        return app.Run(showCommand);
    } catch (const std::exception& error) {
        MessageBoxA(nullptr, error.what(), "TVM", MB_ICONERROR | MB_OK);
        return 1;
    }
}
