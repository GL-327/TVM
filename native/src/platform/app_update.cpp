#include "platform/app.h"
#include "platform/core_host.h"
#include "core/config.h"
#include "core/util.h"

namespace tvm::platform {
namespace {

std::string StatusText(const nlohmann::json& status, const char* key) {
    const auto field = status.find(key);
    return field != status.end() && field->is_string() ? field->get<std::string>() : std::string();
}

DWORD RunNativeUpdaterProcess(const std::filesystem::path& script, const std::filesystem::path& root) {
    DWORD result = 1;
    wchar_t system[32768]{};
    GetSystemDirectoryW(system, 32768);
    const auto powershell = std::filesystem::path(system) / L"WindowsPowerShell/v1.0/powershell.exe";
    std::wstring command = L"\"" + powershell.wstring() + L"\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" +
                           script.wstring() + L"\" -InstallRoot \"" + root.wstring() + L"\" -ParentId " +
                           std::to_wstring(GetCurrentProcessId());
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (CreateProcessW(powershell.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                       nullptr, root.c_str(), &startup, &process)) {
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, &result);
        CloseHandle(process.hProcess);
    }
    return result;
}

}  // namespace

void App::RefreshEngineVersion() {
    if (engineVersionFetching_) return;
    engineVersionFetching_ = true;
    background_->Run([this] {
        std::string version;
        std::string commit;
        try {
            const auto status = core_->Call("/api/update/status");
            if (status.is_object()) {
                version = status.value("current", std::string());
                if (status.contains("currentCommit") && status["currentCommit"].is_string()) {
                    commit = status["currentCommit"].get<std::string>();
                }
            }
        } catch (...) {}
        if (version.empty()) {
            try {
                const auto health = core_->Call("/api/health");
                if (health.is_object()) version = health.value("version", std::string());
            } catch (...) {}
        }
        background_->PostToUi([this, version, commit] {
            engineVersionFetching_ = false;
            engineVersion_ = version.empty() ? "offline" : version;
            engineCommit_ = commit;
            UpdateSettingsDiagnostics();
            dirty_ = true;
        });
    });
}

void App::ForceUpdateNow() {
    if (manualUpdateBusy_ || updatesView_.busy) return;
    manualUpdateBusy_ = true;

    auto setStatus = [this](bool busy, const std::string& msg) {
        shell_->SetManualUpdateState({busy, msg});
        updatesView_.busy = busy;
        updatesView_.message = msg;
        ShowUpdates();
        dirty_ = true;
    };
    setStatus(true, "Checking Core and window for updates\xE2\x80\xA6");

    wchar_t executable[32768]{};
    GetModuleFileNameW(nullptr, executable, 32768);
    const auto root = std::filesystem::path(executable).parent_path();

    background_->Run([this, root] {
        auto progress = [this](const std::string& msg) {
            background_->PostToUi([this, msg] {
                shell_->SetManualUpdateState({true, msg});
                updatesView_.busy = true;
                updatesView_.message = msg;
                ShowUpdates();
                dirty_ = true;
            });
        };

        std::string coreSummary;
        std::string coreVer;
        std::string coreCommit;
        try {
            EnsureCore(*core_);
            const std::string marker = ReadRuntimeMarker(*core_);
            progress("Checking Core for updates\xE2\x80\xA6");
            const auto check = core_->Call("/api/update/check", "POST", nlohmann::json::object());
            coreVer = check.value("current", std::string());
            if (check.contains("currentCommit") && check["currentCommit"].is_string()) {
                coreCommit = check["currentCommit"].get<std::string>();
            }
            const bool hasUpdate = check.contains("available") && check["available"].is_object();
            if (!hasUpdate) {
                coreSummary = StatusText(check, "notice");
                if (coreSummary.empty()) {
                    coreSummary = check.value("kind", std::string()) == "up_to_date"
                        ? "Core is up to date" : "Core update check did not finish";
                }
            } else if (!check.value("applyAllowed", false)) {
                coreSummary = StatusText(check, "applyReason");
                if (coreSummary.empty()) coreSummary = "Core update could not be applied";
            } else {
                progress("Applying Core update\xE2\x80\xA6");
                try {
                    const auto apply = core_->Call("/api/update/apply", "POST", nlohmann::json::object());
                    const bool changed = apply.value("changed", false);
                    const std::string restart = apply.value("restart", std::string());
                    const std::string appliedCommit =
                        apply.contains("commit") && apply["commit"].is_string() ? apply["commit"].get<std::string>() : std::string();
                    if (!changed) {
                        const auto latest = core_->Call("/api/update/status");
                        coreSummary = StatusText(latest, "notice");
                        if (coreSummary.empty()) {
                            coreSummary = StatusText(latest, "kind") == "up_to_date"
                                ? "Core is up to date" : "Core did not confirm an update";
                        }
                    } else if (restart == "self" || restart == "automatic") {
                        progress("Core updated. Waiting for Core to restart\xE2\x80\xA6");
                        const auto expectedCommit = appliedCommit.empty()
                            ? StatusText(check["available"], "commit") : appliedCommit;
                        const bool restarted = WaitForCoreRestart(*core_, marker, check, expectedCommit);
                        if (restarted) {
                            try {
                                const auto st = core_->Call("/api/update/status");
                                if (st.is_object()) {
                                    coreVer = st.value("current", coreVer);
                                    if (st.contains("currentCommit") && st["currentCommit"].is_string()) {
                                        coreCommit = st["currentCommit"].get<std::string>();
                                    }
                                }
                            } catch (...) {}
                            coreSummary = "Core updated and restarted";
                        } else {
                            coreSummary = "Core update applied; restart still pending";
                        }
                    } else {
                        coreSummary = "Core updated (manual Core restart needed)";
                    }
                } catch (const coreapi::RequestError& error) {
                    coreSummary = "Core: " + (error.reason.empty() ? std::string(error.what()) : error.reason);
                } catch (const std::exception& error) {
                    coreSummary = std::string("Core: ") + error.what();
                }
            }
        } catch (const std::exception& error) {
            coreSummary = std::string("Core update check failed: ") + error.what();
        }

        progress("Checking the Windows app for updates\xE2\x80\xA6");
        std::string windowSummary;
        bool relaunch = false;
        const auto script = std::filesystem::is_regular_file(root / L"bin/update-native.ps1")
                                ? (root / L"bin/update-native.ps1")
                                : (root.parent_path().parent_path() / L"update-native.ps1");
        if (!std::filesystem::is_regular_file(root / L"native-build.json")) {
            windowSummary = "Window is a source checkout (rebuild locally)";
        } else if (!std::filesystem::is_regular_file(script)) {
            windowSummary = "Window updater script not found";
        } else {
            const DWORD result = RunNativeUpdaterProcess(script, root);
            if (result == 0) {
                relaunch = true;
                windowSummary = "Window update verified. Restarting TVM\xE2\x80\xA6";
            } else if (result == 10) {
                windowSummary = "Window up to date";
            } else if (result == 11) {
                windowSummary = "Window build newer than release";
            } else {
                windowSummary = "Window update check failed";
            }
        }

        const std::string finalMessage = relaunch ? windowSummary : (coreSummary + " \xC2\xB7 " + windowSummary + ".");
        background_->PostToUi([this, root, relaunch, finalMessage, coreVer, coreCommit] {
            manualUpdateBusy_ = false;
            if (!coreVer.empty()) {
                engineVersion_ = coreVer;
                engineCommit_ = coreCommit;
            }
            UpdateSettingsDiagnostics();
            shell_->SetManualUpdateState({false, finalMessage});
            updatesView_.busy = false;
            updatesView_.message = finalMessage;
            ShowUpdates();
            dirty_ = true;
            if (relaunch) {
                try {
                    util::WriteFileAtomically(root / L"native-update-relaunch", "1");
                } catch (...) {}
                PostMessageW(window_, WM_CLOSE, 0, 0);
            }
        });
    });
}

void App::InstallNativeUpdate() {
    if (updatesView_.busy || manualUpdateBusy_) return;
    wchar_t executable[32768]{};
    GetModuleFileNameW(nullptr, executable, 32768);
    const auto root = std::filesystem::path(executable).parent_path();
    if (!std::filesystem::is_regular_file(root / L"native-build.json")) {
        updatesView_.message = "Source checkout: git pull, then run native/build.bat. Packages update here.";
        ShowUpdates(); return;
    }
    updatesView_.busy = true;
    updatesView_.message = "Downloading and verifying the native update...";
    ShowUpdates();
    background_->Run([this, root] {
        const DWORD result = RunNativeUpdaterProcess(root / L"bin/update-native.ps1", root);
        background_->PostToUi([this, result, root] {
            updatesView_.busy = false;
            updatesRetrySoon_ = result != 0 && result != 10 && result != 11;
            updatesView_.message = result == 0    ? "Update verified. Restarting TVM..."
                                   : result == 10 ? "This native build is current."
                                   : result == 11 ? "This copy is newer than the published build, so it is kept."
                                                  : "Update failed verification or download. This copy is unchanged; try again later.";
            ShowUpdates();
            if (result == 0) {
                // TVM closes for the update, so the update opens it again. The marker is the only thing that lets the
                // installer relaunch TVM: an update that finishes after the viewer closed TVM leaves it closed.
                try {
                    util::WriteFileAtomically(root / L"native-update-relaunch", "1");
                } catch (...) {
                    // Without the marker TVM is not reopened; it opens updated next time.
                }
                PostMessageW(window_, WM_CLOSE, 0, 0);
            }
        });
    });
}
}  // namespace tvm::platform
