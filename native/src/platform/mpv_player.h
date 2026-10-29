#pragma once

// One mpv session, drawn into a child window that fills TVM's window, as the old app's
// NativePlayerHost draws it into a window behind its page. The child window is disabled, so
// mouse and keys still reach TVM's window, and TVM's chrome is drawn over the picture by the
// overlay window (overlay_window.h).
//
// mpv is driven through its JSON IPC pipe. A reader thread reads the property changes and posts
// them to the window thread, which is the only thread that sees the state.

#include <windows.h>

#include <atomic>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include "core/mpv.h"

namespace tvm::platform {

class MpvPlayer {
public:
    // Runs a function on the window thread.
    using Post = std::function<void(std::function<void()>)>;

    struct Events {
        std::function<void(const mpv::State&)> state;
        std::function<void()> ended;
        std::function<void(const std::string& message)> error;
    };

    MpvPlayer(HINSTANCE instance, HWND parent, Post post, Events events);
    ~MpvPlayer();

    MpvPlayer(const MpvPlayer&) = delete;
    MpvPlayer& operator=(const MpvPlayer&) = delete;

    // Starts mpv on `url`. A session already playing is stopped first. False, with the error
    // event, when mpv could not be started.
    bool Start(const std::filesystem::path& executable, const std::string& url, std::optional<double> startAt,
               double volume, bool muted);
    // Ends the session and hides the picture. Safe to call when nothing plays.
    void Stop();
    bool Active() const { return process_ != nullptr; }

    void TogglePause();
    void SetPaused(bool paused);
    void SeekBy(double seconds);
    void SeekTo(double seconds);
    // `volume` is from 0 to 10, where 1 is the file's own level.
    void SetAudio(double volume, bool muted);
    // Any mpv property, such as "aid", "sid" or "speed".
    void SetProperty(const std::string& name, const nlohmann::json& value);

    // Keeps the picture the size of the parent's client area.
    void Resize();

    // Runs mpv once with these arguments, without a window, and waits for it, at most `timeoutMs`. For the
    // trickplay thumbnails, on a worker. False when it could not start or did not finish in time.
    static bool RunOnce(const std::filesystem::path& executable, const std::vector<std::string>& args, DWORD timeoutMs);

private:
    void Write(const nlohmann::json& command);
    void ReadLoop(std::wstring pipeName, std::shared_ptr<std::atomic<bool>> alive);
    void Deliver(std::function<void()> work, const std::shared_ptr<std::atomic<bool>>& alive);

    HINSTANCE instance_;
    HWND parent_;
    HWND host_ = nullptr;
    Post post_;
    Events events_;

    HANDLE job_ = nullptr;
    HANDLE process_ = nullptr;
    HANDLE stop_ = nullptr;
    std::thread reader_;
    // Turned off when the session ends, so results still on their way are dropped.
    std::shared_ptr<std::atomic<bool>> alive_;

    std::mutex pipeLock_;
    HANDLE pipe_ = INVALID_HANDLE_VALUE;
    // SetAudio runs on the reader once the pipe opens, as well as on the window's thread.
    std::mutex audioLock_;
    double volume_ = 1.0;
    bool muted_ = false;
    // The boost filter's gain as mpv last heard it.
    double boost_ = 1.0;
};

}  // namespace tvm::platform
