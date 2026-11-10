#include "platform/core_host.h"

#include <windows.h>

#include <stdexcept>
#include <map>
#include <cwchar>
#include <chrono>
#include <thread>
#include <vector>

#include "core/util.h"
#include "core/config.h"

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
}  // namespace

void EnsureCore(const coreapi::Client& client) {
    const auto markerPath = client.dataDir() / L"native-runtime-id";
    std::string marker = util::ReadTextFile(markerPath).value_or("");
    if (marker.empty()) {
        marker = util::Base64Encode(util::RandomBytes(24));
        util::WriteFileAtomically(markerPath, marker);
    }
    if (SameCore(client, marker)) return;
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
