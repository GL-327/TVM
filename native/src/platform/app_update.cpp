#include "platform/app.h"
#include "core/util.h"

namespace tvm::platform {
void App::InstallNativeUpdate() {
    if (updatesView_.busy) return;
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
        DWORD result = 1;
        wchar_t system[32768]{};
        GetSystemDirectoryW(system, 32768);
        const auto powershell = std::filesystem::path(system) / L"WindowsPowerShell/v1.0/powershell.exe";
        const auto script = root / L"bin/update-native.ps1";
        std::wstring command = L"\"" + powershell.wstring() + L"\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script.wstring() +
            L"\" -InstallRoot \"" + root.wstring() + L"\" -ParentId " + std::to_wstring(GetCurrentProcessId());
        STARTUPINFOW startup{}; startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        if (CreateProcessW(powershell.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                           nullptr, root.c_str(), &startup, &process)) {
            CloseHandle(process.hThread);
            WaitForSingleObject(process.hProcess, INFINITE);
            GetExitCodeProcess(process.hProcess, &result);
            CloseHandle(process.hProcess);
        }
        background_->PostToUi([this, result] {
            updatesView_.busy = false;
            updatesView_.message = result == 0 ? "Update verified. Restarting TVM..." : result == 10 ? "This native build is current." : "Update failed verification or download. This copy is unchanged; try again later.";
            ShowUpdates();
            if (result == 0) PostMessageW(window_, WM_CLOSE, 0, 0);
        });
    });
}
}  // namespace tvm::platform
