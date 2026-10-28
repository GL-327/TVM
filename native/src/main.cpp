// TVM native entry point.
//
//   tvm.exe                          run the app
//   tvm.exe --snapshot out.png       render the screen to a PNG and exit
//     --size 1920x1080               snapshot size (default 1920x1080)
//     --keys Right,Down,Select       remote presses to apply before the snapshot
//                                    (Up, Down, Left, Right, Select, Back)
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

namespace {

using tvm::nav::Direction;
using tvm::ui::RailSpec;

// Placeholder rails for the demo home screen. Titles are generic labels, not
// catalogue content.
std::vector<RailSpec> DemoRails() {
    return {
        {"Recently added", 12},
        {"Top picks", 12},
        {"Continue watching", 9},
        {"Live channels", 12},
    };
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

int RunSnapshot(const std::wstring& path, unsigned width, unsigned height, const std::wstring& keys) {
    tvm::platform::Graphics graphics;

    // A throwaway data folder, so a Settings press here cannot change the viewer's files.
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-snapshot-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    tvm::ui::Shell shell(std::make_unique<tvm::ui::Scene>(DemoRails(), store.Motion()), store);
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
        unsigned width = 1920;
        unsigned height = 1080;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == L"--snapshot" && i + 1 < args.size()) {
                snapshot = args[++i];
            } else if (args[i] == L"--keys" && i + 1 < args.size()) {
                keys = args[++i];
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

        if (snapshot.has_value()) return RunSnapshot(*snapshot, width, height, keys);

        tvm::platform::AppOptions options;
        options.dataDir = tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment()).wstring();
        tvm::platform::App app(instance, options);
        return app.Run(showCommand);
    } catch (const std::exception& error) {
        MessageBoxA(nullptr, error.what(), "TVM", MB_ICONERROR | MB_OK);
        return 1;
    }
}
