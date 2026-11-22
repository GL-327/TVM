#pragma once

// Decoded artwork as Direct2D bitmaps. A picture is read on a worker thread, since reading a large one takes
// milliseconds and the window thread must keep drawing. The worker hands back its pixels, and the window thread makes
// each bitmap as it is drawn, a few per frame. A bitmap belongs to the render target it was made for, so the cache is
// cleared when the target is rebuilt.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "platform/graphics.h"

namespace tvm::platform {

// A picture as WIC reads it: premultiplied BGRA pixels, ready for a bitmap, plus a pre-computed
// downsampled Liquid Glass blurred & saturation-boosted buffer computed on the worker thread.
struct DecodedPicture {
    bool ok = false;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::vector<std::uint8_t> pixels;
    std::uint32_t blurredWidth = 0;
    std::uint32_t blurredHeight = 0;
    std::vector<std::uint8_t> blurredPixels;
};

// Reads the picture in `file` and pre-computes its Liquid Glass blurred buffer. Any thread may call it.
DecodedPicture DecodePicture(Graphics& graphics, const std::wstring& file);

class ImageCache {
public:
    // Asks for `file` to be read. The answer comes back through Deliver.
    using Request = std::function<void(const std::wstring& file)>;

    explicit ImageCache(Graphics& graphics);

    void SetRequest(Request request);
    // Starts a frame. Only a few bitmaps are made in each frame, so a page of new pictures does not stall one frame.
    void BeginFrame();
    // The bitmap for `file`, once it is ready. Until then this returns nothing and asks for the picture to be read.
    ID2D1Bitmap* Get(ID2D1RenderTarget* target, const std::wstring& file);
    // A Gaussian-blurred & saturation-boosted Liquid Glass version of the bitmap for `file`, cached per backdrop.
    ID2D1Bitmap* GetBlurred(ID2D1RenderTarget* target, const std::wstring& file, float standardDeviation = 24.0f);
    // Called on the window thread with what a worker read.
    void Deliver(const std::wstring& file, DecodedPicture picture);
    // Whether a picture that was drawn this frame or the last is still waiting for its GPU upload. Pictures for
    // cards no longer on screen wait quietly, so they never keep the frames coming on their own.
    bool Busy() const;
    void Clear();
    // Lets a picture that failed to decode be read again, once its file has been downloaded afresh.
    void ForgetFailure(const std::wstring& file);

private:
    static constexpr int kUploadsPerFrame = 8;
    // Bitmaps not drawn for this many frames may be released once the cache is over its budget.
    static constexpr std::uint64_t kIdleFrames = 600;
    static constexpr std::size_t kBitmapBudgetBytes = 384u * 1024u * 1024u;
    void Evict();

    Graphics& graphics_;
    Request request_;
    int uploadsThisFrame_ = 0;
    std::map<std::wstring, ComPtr<ID2D1Bitmap>> bitmaps_;
    // When each bitmap was last drawn, and how many bytes it and its blurred copy hold.
    std::map<std::wstring, std::uint64_t> lastUsed_;
    std::map<std::wstring, std::size_t> bytes_;
    std::size_t totalBytes_ = 0;
    std::uint64_t frame_ = 0;
    bool deferredThisFrame_ = false;
    bool deferredLastFrame_ = false;
    std::map<std::wstring, ComPtr<ID2D1Bitmap>> blurredBitmaps_;
    std::map<std::wstring, bool> failed_;
    // Pictures asked for and not yet delivered.
    std::set<std::wstring> requested_;
    // Pictures delivered and not yet made into bitmaps.
    std::map<std::wstring, DecodedPicture> ready_;
};

}  // namespace tvm::platform
