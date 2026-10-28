#pragma once

// Decoded artwork as Direct2D bitmaps. A picture is read on a worker thread, since reading a large one takes
// milliseconds and the window thread must keep drawing. The worker hands back its pixels, and the window thread makes
// each bitmap as it is drawn, a few per frame. A bitmap belongs to the render target it was made for, so the cache is
// cleared when the target is rebuilt.

#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "platform/graphics.h"

namespace tvm::platform {

// A picture as WIC reads it: premultiplied BGRA pixels, ready for a bitmap.
struct DecodedPicture {
    bool ok = false;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::vector<std::uint8_t> pixels;
};

// Reads the picture in `file`. Any thread may call it: WIC's factory is free-threaded.
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
    // Called on the window thread with what a worker read.
    void Deliver(const std::wstring& file, DecodedPicture picture);
    // Whether pictures are still being read or made, so the window should keep drawing.
    bool Busy() const;
    void Clear();

private:
    static constexpr int kUploadsPerFrame = 4;

    Graphics& graphics_;
    Request request_;
    int uploadsThisFrame_ = 0;
    std::map<std::wstring, ComPtr<ID2D1Bitmap>> bitmaps_;
    std::map<std::wstring, bool> failed_;
    // Pictures asked for and not yet delivered.
    std::set<std::wstring> requested_;
    // Pictures delivered and not yet made into bitmaps.
    std::map<std::wstring, DecodedPicture> ready_;
};

}  // namespace tvm::platform
