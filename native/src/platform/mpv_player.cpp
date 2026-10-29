#include "platform/mpv_player.h"

#include <algorithm>
#include <chrono>
#include <vector>

namespace tvm::platform {

namespace {

constexpr wchar_t kHostClass[] = L"TVMVideoHost";
// mpv takes a moment to open its pipe. It is tried every 100 ms for six seconds, as the old app does.
constexpr int kConnectAttempts = 60;
constexpr DWORD kConnectRetryMs = 100;
// Position updates are sent at most this often. Pause, duration and cache changes are never held back.
constexpr double kStateThrottleMs = 250.0;
constexpr DWORD kQuitGraceMs = 300;

constexpr char kConnectError[] = "The native player started but TVM could not connect to its controls.";
constexpr char kStoppedError[] = "The native player stopped unexpectedly. Check the connection and try again.";
constexpr char kMissingError[] =
    "Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.";

// One argument quoted as CommandLineToArgvW reads it back: backslashes are doubled only before a quote.
std::wstring QuoteArgument(const std::wstring& arg) {
    std::wstring quoted = L"\"";
    std::size_t backslashes = 0;
    for (wchar_t c : arg) {
        if (c == L'\\') {
            ++backslashes;
            continue;
        }
        if (c == L'"') {
            quoted.append(backslashes * 2 + 1, L'\\');
        } else {
            quoted.append(backslashes, L'\\');
        }
        backslashes = 0;
        quoted.push_back(c);
    }
    quoted.append(backslashes * 2, L'\\');
    quoted.push_back(L'"');
    return quoted;
}

LRESULT CALLBACK HostProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_ERASEBKGND) {
        // Black until mpv's first frame, as the old app's video window is.
        RECT client{};
        GetClientRect(window, &client);
        FillRect(reinterpret_cast<HDC>(wParam), &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
        return 1;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

double NowMs() {
    using namespace std::chrono;
    return static_cast<double>(duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

}  // namespace

MpvPlayer::MpvPlayer(HINSTANCE instance, HWND parent, Post post, Events events)
    : instance_(instance), parent_(parent), post_(std::move(post)), events_(std::move(events)) {
    WNDCLASSEXW cls{};
    cls.cbSize = sizeof(cls);
    cls.lpfnWndProc = &HostProc;
    cls.hInstance = instance_;
    cls.lpszClassName = kHostClass;
    RegisterClassExW(&cls);
}

MpvPlayer::~MpvPlayer() {
    Stop();
    if (host_ != nullptr) DestroyWindow(host_);
}

bool MpvPlayer::Start(const std::filesystem::path& executable, const std::string& url, std::optional<double> startAt,
                      double volume, bool muted) {
    Stop();
    volume_ = volume;
    muted_ = muted;

    if (host_ == nullptr) {
        // Disabled, so a click on the picture reaches TVM's window rather than mpv's.
        host_ = CreateWindowExW(0, kHostClass, L"TVM Video", WS_CHILD | WS_DISABLED | WS_CLIPCHILDREN, 0, 0, 0, 0,
                                parent_, nullptr, instance_, nullptr);
        if (host_ == nullptr) {
            events_.error(kStoppedError);
            return false;
        }
    }
    Resize();
    ShowWindow(host_, SW_SHOWNA);

    const std::wstring pipeName =
        L"\\\\.\\pipe\\tvm-mpv-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
    mpv::LaunchOptions launch;
    launch.url = url;
    launch.windowId = std::to_string(reinterpret_cast<std::uintptr_t>(host_));
    launch.ipcPath = util::ToUtf8(pipeName);
    launch.startAt = startAt;
    boost_ = std::clamp(volume, 1.0, 10.0);
    launch.boost = boost_;

    std::wstring commandLine = QuoteArgument(executable.wstring());
    for (const std::string& arg : mpv::BuildArgs(launch)) commandLine += L" " + QuoteArgument(util::ToWide(arg));

    // mpv lives in a job that ends with TVM, so a crash never leaves a player running.
    job_ = CreateJobObjectW(nullptr, nullptr);
    if (job_ != nullptr) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION info{};
    const std::wstring folder = executable.parent_path().wstring();
    if (!CreateProcessW(executable.wstring().c_str(), commandLine.data(), nullptr, nullptr, FALSE,
                        CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, folder.empty() ? nullptr : folder.c_str(),
                        &startup, &info)) {
        if (job_ != nullptr) CloseHandle(job_);
        job_ = nullptr;
        ShowWindow(host_, SW_HIDE);
        events_.error(kMissingError);
        return false;
    }
    if (job_ != nullptr) AssignProcessToJobObject(job_, info.hProcess);
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    process_ = info.hProcess;

    stop_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    alive_ = std::make_shared<std::atomic<bool>>(true);
    reader_ = std::thread([this, pipeName, alive = alive_] { ReadLoop(pipeName, alive); });
    // mpv's window must not take the keyboard from TVM.
    SetFocus(parent_);
    return true;
}

void MpvPlayer::Stop() {
    if (alive_) alive_->store(false);
    if (process_ != nullptr) Write(nlohmann::json::array({"quit"}));
    if (stop_ != nullptr) SetEvent(stop_);
    if (reader_.joinable()) reader_.join();
    if (process_ != nullptr) {
        if (WaitForSingleObject(process_, kQuitGraceMs) != WAIT_OBJECT_0) TerminateProcess(process_, 1);
        CloseHandle(process_);
        process_ = nullptr;
    }
    if (job_ != nullptr) CloseHandle(job_);
    job_ = nullptr;
    if (stop_ != nullptr) CloseHandle(stop_);
    stop_ = nullptr;
    if (host_ != nullptr) ShowWindow(host_, SW_HIDE);
}

void MpvPlayer::TogglePause() {
    Write(nlohmann::json::array({"cycle", "pause"}));
}

void MpvPlayer::SetPaused(bool paused) {
    Write(nlohmann::json::array({"set_property", "pause", paused}));
}

void MpvPlayer::SeekBy(double seconds) {
    Write(nlohmann::json::array({"seek", seconds, "relative"}));
}

void MpvPlayer::SeekTo(double seconds) {
    Write(nlohmann::json::array({"seek", seconds < 0.0 ? 0.0 : seconds, "absolute"}));
}

void MpvPlayer::SetAudio(double volume, bool muted) {
    std::lock_guard<std::mutex> lock(audioLock_);
    // From 0 to 10. mpv's own volume covers up to 1, and the boost filter the rest.
    volume_ = volume < 0.0 ? 0.0 : (volume > 10.0 ? 10.0 : volume);
    muted_ = muted;
    const int level = static_cast<int>(std::min(volume_, 1.0) * 100.0 + 0.5);
    Write(nlohmann::json::array({"set_property", "mute", muted_ || level == 0}));
    Write(nlohmann::json::array({"set_property", "volume", muted_ ? 0 : level}));
    // Changing the filter rebuilds mpv's audio chain, so it is only sent when the gain moves. The whole
    // filter is set rather than its gain changed in place: mpv rebuilds the filter on every seek, from this.
    const double boost = std::max(volume_, 1.0);
    if (boost != boost_) {
        boost_ = boost;
        Write(nlohmann::json::array({"set_property", "af", mpv::BoostFilter(boost_)}));
    }
}

bool MpvPlayer::RunOnce(const std::filesystem::path& executable, const std::vector<std::string>& args, DWORD timeoutMs) {
    std::wstring commandLine = QuoteArgument(executable.wstring());
    for (const std::string& arg : args) commandLine += L" " + QuoteArgument(util::ToWide(arg));
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION info{};
    const std::wstring folder = executable.parent_path().wstring();
    if (!CreateProcessW(executable.wstring().c_str(), commandLine.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS, nullptr, folder.empty() ? nullptr : folder.c_str(),
                        &startup, &info)) {
        return false;
    }
    CloseHandle(info.hThread);
    const bool finished = WaitForSingleObject(info.hProcess, timeoutMs) == WAIT_OBJECT_0;
    if (!finished) TerminateProcess(info.hProcess, 1);
    CloseHandle(info.hProcess);
    return finished;
}

void MpvPlayer::SetProperty(const std::string& name, const nlohmann::json& value) {
    Write(nlohmann::json::array({"set_property", name, value}));
}

void MpvPlayer::Resize() {
    if (host_ == nullptr) return;
    RECT client{};
    GetClientRect(parent_, &client);
    SetWindowPos(host_, HWND_TOP, 0, 0, client.right - client.left, client.bottom - client.top,
                 SWP_NOACTIVATE | SWP_NOZORDER);
}

void MpvPlayer::Write(const nlohmann::json& command) {
    std::lock_guard<std::mutex> lock(pipeLock_);
    if (pipe_ == INVALID_HANDLE_VALUE) return;
    const std::string line = mpv::CommandLine(command);
    OVERLAPPED overlapped{};
    overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    DWORD written = 0;
    if (!WriteFile(pipe_, line.data(), static_cast<DWORD>(line.size()), nullptr, &overlapped) &&
        GetLastError() == ERROR_IO_PENDING) {
        GetOverlappedResult(pipe_, &overlapped, &written, TRUE);
    }
    CloseHandle(overlapped.hEvent);
}

void MpvPlayer::Deliver(std::function<void()> work, const std::shared_ptr<std::atomic<bool>>& alive) {
    post_([work = std::move(work), alive] {
        if (alive->load()) work();
    });
}

void MpvPlayer::ReadLoop(std::wstring pipeName, std::shared_ptr<std::atomic<bool>> alive) {
    HANDLE pipe = INVALID_HANDLE_VALUE;
    for (int attempt = 0; attempt < kConnectAttempts && pipe == INVALID_HANDLE_VALUE; ++attempt) {
        pipe = CreateFileW(pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
                           FILE_FLAG_OVERLAPPED, nullptr);
        if (pipe != INVALID_HANDLE_VALUE) break;
        const HANDLE waits[] = {stop_, process_};
        const DWORD woke = WaitForMultipleObjects(2, waits, FALSE, kConnectRetryMs);
        if (woke == WAIT_OBJECT_0) return;
        if (woke == WAIT_OBJECT_0 + 1) break;
    }
    if (pipe == INVALID_HANDLE_VALUE) {
        if (WaitForSingleObject(stop_, 0) == WAIT_OBJECT_0) return;
        const bool exited = WaitForSingleObject(process_, 0) == WAIT_OBJECT_0;
        Deliver([this, exited] { events_.error(exited ? kStoppedError : kConnectError); }, alive);
        return;
    }
    {
        std::lock_guard<std::mutex> lock(pipeLock_);
        pipe_ = pipe;
    }
    // The viewer's mpv.conf must never leave the picture muted, so the level is set outright.
    Write(nlohmann::json::array({"set_property", "mute", false}));
    Write(nlohmann::json::array({"set_property", "volume", 100}));
    SetAudio(volume_, muted_);
    for (const char* property : mpv::kObservedProperties) Write(nlohmann::json::array({"observe_property", 1, property}));

    mpv::State state = mpv::InitialState(std::nullopt);
    double lastSentMs = 0.0;
    bool ended = false;
    std::string lines;
    std::vector<char> buffer(16 * 1024);
    OVERLAPPED overlapped{};
    overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    bool stopping = false;
    for (;;) {
        ResetEvent(overlapped.hEvent);
        DWORD read = 0;
        if (!ReadFile(pipe, buffer.data(), static_cast<DWORD>(buffer.size()), nullptr, &overlapped) &&
            GetLastError() != ERROR_IO_PENDING) {
            break;
        }
        const HANDLE waits[] = {overlapped.hEvent, stop_};
        if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) != WAIT_OBJECT_0) {
            CancelIoEx(pipe, &overlapped);
            GetOverlappedResult(pipe, &overlapped, &read, TRUE);
            stopping = true;
            break;
        }
        if (!GetOverlappedResult(pipe, &overlapped, &read, FALSE) || read == 0) break;

        lines.append(buffer.data(), read);
        std::size_t newline = 0;
        while ((newline = lines.find('\n')) != std::string::npos) {
            const std::string line = lines.substr(0, newline);
            lines.erase(0, newline + 1);
            const nlohmann::json message = nlohmann::json::parse(line, nullptr, false);
            // A malformed line is skipped. The next property event repairs the state.
            if (!message.is_object() || message.value("event", "") != "property-change") continue;
            const std::string name = message.value("name", "");
            state = mpv::ApplyProperty(state, name, message.contains("data") ? message["data"] : nlohmann::json());
            if (state.ended) {
                if (!ended) Deliver([this] { events_.ended(); }, alive);
                ended = true;
                continue;
            }
            const double now = NowMs();
            if (name == "time-pos" && now - lastSentMs < kStateThrottleMs && !state.pausedForCache) continue;
            lastSentMs = now;
            Deliver([this, state] { events_.state(state); }, alive);
        }
    }
    CloseHandle(overlapped.hEvent);
    {
        std::lock_guard<std::mutex> lock(pipeLock_);
        pipe_ = INVALID_HANDLE_VALUE;
    }
    CloseHandle(pipe);
    if (stopping || ended || WaitForSingleObject(stop_, 0) == WAIT_OBJECT_0) return;

    // The pipe closed on its own: mpv quit. A clean exit is the end of the file.
    WaitForSingleObject(process_, 2000);
    DWORD code = 1;
    GetExitCodeProcess(process_, &code);
    if (code == 0) {
        Deliver([this] { events_.ended(); }, alive);
    } else {
        Deliver([this] { events_.error(kStoppedError); }, alive);
    }
}

}  // namespace tvm::platform
