#include "platform/app.h"

#include <shellapi.h>
#include "core/js.h"
#include "core/profiles.h"
#include "core/util.h"

namespace tvm::platform {
namespace {
std::wstring Quote(const std::wstring& arg) {
    std::wstring out = L"\"";
    std::size_t slashes = 0;
    for (wchar_t c : arg) {
        if (c == L'\\') { ++slashes; continue; }
        if (c == L'"') out.append(slashes * 2 + 1, L'\\');
        else out.append(slashes, L'\\');
        slashes = 0; out += c;
    }
    out.append(slashes * 2, L'\\');
    return out + L'"';
}
std::filesystem::path EdgePath() {
    for (HKEY hive : {HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER}) {
        wchar_t value[32768]{};
        DWORD bytes = sizeof(value);
        if (RegGetValueW(hive, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe", nullptr,
                         RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY, nullptr, value, &bytes) == ERROR_SUCCESS && std::filesystem::exists(value)) return value;
    }
    const auto env = util::ProcessEnvironment();
    for (const auto* key : {L"ProgramFiles(x86)", L"ProgramFiles"}) {
        const auto root = env(key);
        if (!root) continue;
        const auto file = std::filesystem::path(*root) / "Microsoft/Edge/Application/msedge.exe";
        if (std::filesystem::exists(file)) return file;
    }
    return {};
}
}
nlohmann::json App::ConnectedServices() const {
    const auto folder = profiles::ActiveFolder(dataDir_);
    if (!folder) return nlohmann::json::object();
    const auto text = util::ReadTextFile(*folder / "services.json");
    const auto data = text ? nlohmann::json::parse(*text, nullptr, false) : nlohmann::json::object();
    return data.is_object() ? data : nlohmann::json::object();
}
void App::ConnectService(const std::string& id, bool connected) {
    const auto folder = profiles::ActiveFolder(dataDir_);
    if (!folder) throw std::runtime_error("This profile could not be read.");
    auto data = ConnectedServices();
    data[id] = connected;
    util::WriteFileAtomically(*folder / "services.json", data.dump());
    titles_.clear(); shownTitle_.reset();
}
ui::InfoView App::ServicesView() const {
    ui::InfoView view;
    view.kicker = "Streaming services";
    view.heading = "Your services";
    view.interleaveActions = true;
    view.lede = "Sign in on each service's own page. TVM never sees your password.";
    const auto connected = ConnectedServices();
    const auto button = [](std::string key, std::string label, bool primary = false) { ui::InfoAction action; action.key = std::move(key); action.label = std::move(label); action.primary = primary; return action; };
    const auto data = content_->Read("services");
    if (!pendingService_.empty()) {
        std::string name = pendingService_;
        if (data.contains("services")) for (const auto& service : data["services"]) if (service.value("id", "") == pendingService_) name = service.value("name", name);
        view.message = "Signed in to " + name + "?";
        view.filters.push_back({button("info:service-yes:" + pendingService_, "Yes", true), button("info:service-later:" + pendingService_, "Not yet")});
    }
    if (data.contains("services")) for (const auto& service : data["services"]) {
        const auto id = service.value("id", "");
        const auto name = service.value("name", id);
        const bool on = connected.value(id, false);
        view.blocks.push_back({ui::InfoBlock::Kind::Row, name, on ? "Connected" : "Not connected", on});
        std::vector<ui::InfoAction> actions;
        actions.push_back(button("info:service-signin:" + id, "Sign in to " + name, !on));
        actions.push_back(button("info:service-open:" + id, "Open " + name));
        if (on) actions.push_back(button("info:service-disconnect:" + id, "Disconnect " + name));
        view.actions.push_back(std::move(actions));
    }
    view.topActions = {button("back", "Back")};
    return view;
}
void App::LaunchService(const std::string& id, bool signin, const std::string& title) {
    const auto data = content_->Read("services");
    if (!data.contains("services")) return;
    for (const auto& service : data["services"]) {
        if (service.value("id", "") != id) continue;
        std::string url = service.value(signin ? "signin" : "home", "");
        if (!signin && !title.empty() && service.contains("search") && service["search"].is_string()) {
            url = service["search"].get<std::string>();
            const auto at = url.find("{q}");
            if (at != std::string::npos) url.replace(at, 3, js::EncodeUriComponent(title));
        }
        if (url.rfind("https://", 0) != 0 || url.find_first_of("\r\n\"") != std::string::npos || url.find('\0') != std::string::npos) return;
        const auto edge = EdgePath();
        bool opened = false;
        if (!edge.empty()) {
            const auto local = util::ProcessEnvironment()(L"LOCALAPPDATA");
            if (local) {
                const auto profile = std::filesystem::path(*local) / "TVM/services";
                std::wstring line = Quote(edge.wstring()) + L" " + Quote(L"--app=" + util::ToWide(url)) + L" " + Quote(L"--user-data-dir=" + profile.wstring()) + L" --no-first-run --window-size=1280,800";
                STARTUPINFOW start{}; start.cb = sizeof(start);
                PROCESS_INFORMATION process{};
                if (CreateProcessW(edge.c_str(), line.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &start, &process)) {
                    CloseHandle(process.hThread); CloseHandle(process.hProcess); opened = true;
                }
            }
        }
        if (!opened) opened = reinterpret_cast<INT_PTR>(ShellExecuteW(window_, L"open", util::ToWide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32;
        if (signin && opened) pendingService_ = id;
        if (pageName_ == "services") ShowInfoPage();
        return;
    }
}
}  // namespace tvm::platform
