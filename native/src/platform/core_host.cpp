#include "platform/core_host.h"

#include <windows.h>

#include <stdexcept>
#include <map>
#include <cwchar>
#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <vector>

#include "core/util.h"
#include "core/config.h"
#include "core/update_policy.h"

namespace tvm::platform {

namespace {
std::wstring Quote(const std::wstring& value) {
    std::wstring out = L"\"";
    unsigned slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { ++slashes; continue; }
        if (c == L'"') out.append(slashes * 2 + 1, L'\\');
        else out.append(slashes, L'\\');
        slashes = 0;
        out += c;
    }
    out.append(slashes * 2, L'\\');
    return out + L'"';
}
bool SameCore(const coreapi::Client& client, const std::string& marker) {
    try {
        const auto runtime = client.Call("/api/desktop/runtime");
        return runtime.value("protocol", 0) == 1 && runtime.value("instanceId", std::string()) == marker;
    } catch (...) { return false; }
}

std::string RunningVersion(const coreapi::Client& client) {
    try { return client.Call("/api/health").value("version", std::string()); } catch (...) { return {}; }
}

// Set when this process started the Core: a fresh Core checks for updates as
// it starts, so the window only steps in when that Core is older than itself.
std::atomic<bool> startedCore{false};

// The window and the Core update separately: the window from its own release
// when it opens, the Core from its feed every six hours. The Core also keeps
// running after the window closes. So an updated window can find an older Core
// still running, and TVM 1.3.0 signed in through a 1.1.0 Core for hours. Once
// per launch the window asks the Core it finds to update now: always when the
// Core is older than the window, and otherwise when auto-update is on, so
// opening TVM brings both halves up to date. It then waits for the new Core,
// which keeps the same data-directory marker.
void CatchUpCore(const coreapi::Client& client, const std::string& marker) {
    static std::mutex mutex;
    static bool checked = false;
    const std::lock_guard lock(mutex);
    if (checked) return;
    checked = true;
    const auto running = RunningVersion(client);
    if (!config::VersionOlder(running, config::kCoreVersion)) {
        if (startedCore.load()) return;
        try {
            if (!client.Call("/api/update/status").value("autoUpdate", false)) return;
        } catch (...) { return; }
    }
    nlohmann::json status;
    std::string applied;
    try {
        status = client.Call("/api/update/check", "POST", nlohmann::json::object());
        if (status.value("kind", std::string()) != "available" || !status.value("applyAllowed", false)) return;
        const auto result = client.Call("/api/update/apply", "POST", nlohmann::json::object());
        if (!result.value("changed", false) || result.value("restart", std::string()) != "self") return;
        if (result.contains("commit") && result["commit"].is_string()) applied = result["commit"].get<std::string>();
    } catch (...) {
        return;  // Offline or refused: keep using the Core that is running.
    }
    // The Core exits and starts the new build; it is back once it reports that
    // build's commit (the version can stay the same).
    (void)WaitForCoreRestart(client, marker, status, applied);
}
}  // namespace

std::string ReadRuntimeMarker(const coreapi::Client& client) {
    const auto markerPath = client.dataDir() / L"native-runtime-id";
    std::string marker = util::ReadTextFile(markerPath).value_or("");
    if (marker.empty()) {
        marker = util::Base64Encode(util::RandomBytes(24));
        util::WriteFileAtomically(markerPath, marker);
    }
    return marker;
}

bool WaitForCoreRestart(const coreapi::Client& client, const std::string& marker,
                        const nlohmann::json& previous, const std::string& appliedCommit) {
    const std::string previousBoot = previous.value("bootId", std::string());
    const std::string previousVersion = previous.value("current", std::string());
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(1);
    while (std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        if (!SameCore(client, marker)) continue;
        try {
            const auto status = client.Call("/api/update/status");
            const std::string boot = status.value("bootId", std::string());
            if (!update::IsNewCoreBoot(previousBoot, previousVersion, boot, status.value("current", std::string()))) continue;
            if (appliedCommit.empty() || (status.contains("currentCommit") && status["currentCommit"] == appliedCommit)) return true;
        } catch (...) {}
    }
    return false;
}

void EnsureCore(const coreapi::Client& client) {
    const std::string marker = ReadRuntimeMarker(client);
    if (SameCore(client, marker)) {
        // A Core this launch did not start may predate the window's update.
        CatchUpCore(client, marker);
        if (SameCore(client, marker)) return;
    }
    // A different server at this port must never receive an account password.
    if (http::Get(client.origin() + "/api/health", http::Options{1500}))
        throw std::runtime_error("Another or older Core is using the TVM port. Close that Core, then choose Retry.");

    wchar_t executable[32768]{};
    if (!GetModuleFileNameW(nullptr, executable, 32768)) throw std::runtime_error("Cannot locate TVM.");
    auto folder = std::filesystem::path(executable).parent_path();
    std::filesystem::path entry, ui, node;
    for (int level = 0; level < 5 && !folder.empty(); ++level, folder = folder.parent_path()) {
        if (std::filesystem::is_regular_file(folder / L"core/index.js")) {
            entry = folder / L"core/index.js";
            ui = folder / L"ui";
        } else if (std::filesystem::is_regular_file(folder / L"apps/core/src/index.ts")) {
            entry = folder / L"apps/core/src/index.ts";
            ui = folder / L"apps/ui/dist";
        }
        if (!entry.empty()) {
            node = folder / L"bin/node.exe";
            break;
        }
    }
    if (entry.empty()) throw std::runtime_error("TVM Core is missing. Extract the whole desktop package beside tvm.exe.");
    if (!std::filesystem::is_regular_file(node)) {
        wchar_t found[32768]{};
        if (!SearchPathW(nullptr, L"node.exe", nullptr, 32768, found, nullptr))
            throw std::runtime_error("Node.js 22+ is required for the shared Core. Use the complete TVM download.");
        node = found;
    }
    // Give this child an explicit environment without changing the UI process's
    // environment while artwork/network workers are active.
    struct EnvLess { bool operator()(const std::wstring& a, const std::wstring& b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; } };
    std::map<std::wstring, std::wstring, EnvLess> env;
    wchar_t* raw = GetEnvironmentStringsW();
    if (raw) {
        for (const wchar_t* p = raw; *p; p += std::wcslen(p) + 1) {
            const std::wstring line(p);
            const auto equals = line.find(L'=', 1);
            if (equals != std::wstring::npos) env[line.substr(0, equals)] = line.substr(equals + 1);
        }
        FreeEnvironmentStringsW(raw);
    }
    env[L"TVM_CORE_BIND"] = util::ToWide(config::ResolveBindHost(util::ProcessEnvironment()));
    env[L"TVM_CORE_PORT"] = std::to_wstring(client.port());
    env[L"TVM_DATA_DIR"] = client.dataDir().wstring();
    env[L"TVM_UI_DIST"] = ui.wstring();
    env[L"TVM_ENV"] = entry.extension() == L".ts" ? L"development" : L"production";
    std::vector<wchar_t> block;
    for (const auto& [key, value] : env) {
        const auto line = key + L"=" + value;
        block.insert(block.end(), line.begin(), line.end());
        block.push_back(L'\0');
    }
    block.push_back(L'\0');
    std::wstring command = Quote(node.wstring()) + L" " + Quote(entry.wstring());
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(node.c_str(), command.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, block.data(), entry.parent_path().c_str(), &startup, &process))
        throw std::runtime_error("TVM Core could not start.");
    startedCore = true;
    CloseHandle(process.hThread);
    // The shared Core stays available to web/Roku when the native window closes.
    CloseHandle(process.hProcess);
    for (int attempt = 0; attempt < 40; ++attempt) {
        if (SameCore(client, marker)) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
    }
    throw std::runtime_error("TVM Core did not become ready. Check the Core installation, then choose Retry.");
}

}  // namespace tvm::platform
