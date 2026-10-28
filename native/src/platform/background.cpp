#include "platform/background.h"

#include <memory>
#include <utility>

namespace tvm::platform {

Background::Background(HWND window, std::size_t threads) : window_(window) {
    for (std::size_t i = 0; i < threads; ++i) {
        workers_.emplace_back([this] { WorkerLoop(); });
    }
}

Background::~Background() {
    {
        std::lock_guard lock(mutex_);
        stopping_ = true;
        // Work still queued is dropped. Nothing on the screen depends on it.
        tasks_.clear();
    }
    wake_.notify_all();
    for (std::thread& worker : workers_) worker.join();
}

void Background::Run(std::function<void()> task) {
    {
        std::lock_guard lock(mutex_);
        if (stopping_) return;
        tasks_.push_back(std::move(task));
    }
    wake_.notify_one();
}

void Background::WorkerLoop() {
    for (;;) {
        std::function<void()> task;
        {
            std::unique_lock lock(mutex_);
            wake_.wait(lock, [this] { return stopping_ || !tasks_.empty(); });
            if (stopping_) return;
            task = std::move(tasks_.front());
            tasks_.pop_front();
        }
        // A failing task must not take the worker down with it.
        try {
            task();
        } catch (...) {
            // The result is dropped. The screen keeps its placeholder.
        }
    }
}

void Background::PostToUi(std::function<void()> action) {
    // The closure travels as a pointer in the message, and RunPosted frees it.
    auto* holder = new std::function<void()>(std::move(action));
    if (window_ == nullptr || !PostMessageW(window_, kMessage, 0, reinterpret_cast<LPARAM>(holder))) {
        // The window has gone, so nothing will run it.
        delete holder;
    }
}

void Background::RunPosted(LPARAM lParam) {
    std::unique_ptr<std::function<void()>> action(reinterpret_cast<std::function<void()>*>(lParam));
    if (action && *action) (*action)();
}

}  // namespace tvm::platform
