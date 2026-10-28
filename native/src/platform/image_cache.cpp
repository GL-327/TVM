#include "platform/image_cache.h"

namespace tvm::platform {

DecodedPicture DecodePicture(Graphics& graphics, const std::wstring& file) {
    DecodedPicture picture;
    IWICImagingFactory* wic = graphics.wic();
    // WIC detects the format from the content, so the file needs no extension.
    ComPtr<IWICBitmapDecoder> decoder;
    ComPtr<IWICBitmapFrameDecode> frame;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(wic->CreateDecoderFromFilename(file.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad,
                                              &decoder)) ||
        FAILED(decoder->GetFrame(0, &frame)) || FAILED(wic->CreateFormatConverter(&converter)) ||
        FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom))) {
        return picture;
    }
    UINT width = 0;
    UINT height = 0;
    if (FAILED(converter->GetSize(&width, &height)) || width == 0 || height == 0) return picture;
    picture.pixels.resize(static_cast<std::size_t>(width) * height * 4);
    if (FAILED(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(picture.pixels.size()),
                                     picture.pixels.data()))) {
        return picture;
    }
    picture.width = width;
    picture.height = height;
    picture.ok = true;
    return picture;
}

ImageCache::ImageCache(Graphics& graphics) : graphics_(graphics) {}

void ImageCache::SetRequest(Request request) {
    request_ = std::move(request);
}

void ImageCache::BeginFrame() {
    uploadsThisFrame_ = 0;
}

ID2D1Bitmap* ImageCache::Get(ID2D1RenderTarget* target, const std::wstring& file) {
    const auto found = bitmaps_.find(file);
    if (found != bitmaps_.end()) return found->second.Get();
    if (failed_.count(file) != 0) return nullptr;

    const auto ready = ready_.find(file);
    if (ready == ready_.end()) {
        if (requested_.insert(file).second && request_) request_(file);
        return nullptr;
    }
    if (uploadsThisFrame_ >= kUploadsPerFrame) return nullptr;
    ++uploadsThisFrame_;

    const DecodedPicture& picture = ready->second;
    const D2D1_BITMAP_PROPERTIES properties =
        D2D1::BitmapProperties(D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    ComPtr<ID2D1Bitmap> bitmap;
    const bool made = SUCCEEDED(target->CreateBitmap(D2D1::SizeU(picture.width, picture.height), picture.pixels.data(),
                                                     picture.width * 4, properties, &bitmap));
    ready_.erase(ready);
    if (!made) {
        failed_[file] = true;
        return nullptr;
    }
    ID2D1Bitmap* raw = bitmap.Get();
    bitmaps_[file] = std::move(bitmap);
    return raw;
}

void ImageCache::Deliver(const std::wstring& file, DecodedPicture picture) {
    requested_.erase(file);
    if (!picture.ok) {
        // A file that is not a picture is remembered, so it is not read again every frame.
        failed_[file] = true;
        return;
    }
    ready_[file] = std::move(picture);
}

bool ImageCache::Busy() const {
    return !requested_.empty() || !ready_.empty();
}

void ImageCache::Clear() {
    // The bitmaps go, so the pictures they were made from are asked for again when they are next drawn.
    bitmaps_.clear();
    failed_.clear();
    requested_.clear();
}

}  // namespace tvm::platform
