#pragma once

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "platform/graphics.h"

namespace tvm::platform {

// Owns the Home preview worker for the lifetime of the window loop. Direct2D resources stay on the UI thread.
class VideoTexture {
public:
    explicit VideoTexture(std::string coreOrigin);
    ~VideoTexture();
    VideoTexture(const VideoTexture&) = delete;
    VideoTexture& operator=(const VideoTexture&) = delete;

    void Update(const std::string& id, bool playing, bool muted);
    bool Ready() const;
    bool HasAudio() const { return hasAudio_; }
    bool Draw(ID2D1RenderTarget* target, const ui::Box& box, double opacity, double focusX, double focusY);
    void ClearBitmap();
    static VideoTexture* Current();

private:
    struct Frame {
        unsigned width = 0;
        unsigned height = 0;
        std::vector<BYTE> pixels;
    };

    void Run(std::stop_token stop);
    bool Decode(std::stop_token stop, const std::wstring& url, unsigned generation);

    const std::string origin_;
    mutable std::mutex mutex_;
    std::condition_variable_any changed_;
    std::string id_;
    unsigned generation_ = 0;
    bool playing_ = false;
    bool muted_ = true;
    std::atomic_bool hasAudio_ = false;
    std::shared_ptr<Frame> latest_;
    std::jthread worker_;

    ID2D1RenderTarget* bitmapTarget_ = nullptr;
    ComPtr<ID2D1Bitmap> bitmap_;
    std::shared_ptr<Frame> uploaded_;
};

}  // namespace tvm::platform
