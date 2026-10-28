#pragma once

// Work that can wait on the network runs on worker threads. Results come back
// to the window's thread as posted messages, so the screens are only ever
// touched from one thread.

#include <windows.h>

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

namespace tvm::platform {

class Background {
public:
    // The message carrying a result back to the window.
    static constexpr UINT kMessage = WM_APP + 1;

    Background(HWND window, std::size_t threads);
    ~Background();

    Background(const Background&) = delete;
    Background& operator=(const Background&) = delete;

    // Queues work for a worker thread.
    void Run(std::function<void()> task);

    // Queues `action` for the window's thread. Safe to call from any thread.
    void PostToUi(std::function<void()> action);

    // Called by the window procedure when kMessage arrives.
    static void RunPosted(LPARAM lParam);

private:
    void WorkerLoop();

    HWND window_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> tasks_;
    bool stopping_ = false;
    std::vector<std::thread> workers_;
};

}  // namespace tvm::platform
