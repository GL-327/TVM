#include "platform/image_cache.h"

#include <algorithm>
#include <cmath>

namespace tvm::platform {

namespace {

// Pre-computes a downsampled (max 256px) Liquid Glass backdrop buffer on the worker thread:
// 1. Box-average downsample (eliminates aliasing and reduces pixel count by ~36x–144x).
// 2. Separable 3-pass Gaussian-approximating blur (radius = 6 at 256px, equivalent to sigma ~36px at 1080p).
// 3. Apple Liquid Glass chromatic saturation boost (1.78x in perceptual luma-chroma space) so refracted
//    colours glow richly through glass instead of desaturating into muddy grey.
void BuildLiquidGlassBuffer(DecodedPicture& pic) {
    if (!pic.ok || pic.width == 0 || pic.height == 0) return;

    constexpr std::uint32_t kMaxBlurDim = 256;
    const double scale =
        std::min(1.0, static_cast<double>(kMaxBlurDim) / static_cast<double>(std::max(pic.width, pic.height)));
    const int bw = std::max(1, static_cast<int>(std::lround(pic.width * scale)));
    const int bh = std::max(1, static_cast<int>(std::lround(pic.height * scale)));
    pic.blurredWidth = static_cast<std::uint32_t>(bw);
    pic.blurredHeight = static_cast<std::uint32_t>(bh);
    pic.blurredPixels.resize(static_cast<std::size_t>(bw) * bh * 4);

    const int sw = static_cast<int>(pic.width);
    const int sh = static_cast<int>(pic.height);

    // 1. Box-average downsample from pic.pixels (sw x sh) into pic.blurredPixels (bw x bh).
    for (int y = 0; y < bh; ++y) {
        const int y0 = (y * sh) / bh;
        const int y1 = std::max(y0 + 1, ((y + 1) * sh) / bh);
        for (int x = 0; x < bw; ++x) {
            const int x0 = (x * sw) / bw;
            const int x1 = std::max(x0 + 1, ((x + 1) * sw) / bw);
            int sumB = 0, sumG = 0, sumR = 0, sumA = 0, count = 0;
            const int stepY = std::max(1, (y1 - y0) / 2);
            const int stepX = std::max(1, (x1 - x0) / 2);
            for (int sy = y0; sy < y1; sy += stepY) {
                for (int sx = x0; sx < x1; sx += stepX) {
                    const std::size_t idx = (static_cast<std::size_t>(sy) * sw + sx) * 4;
                    sumB += pic.pixels[idx + 0];
                    sumG += pic.pixels[idx + 1];
                    sumR += pic.pixels[idx + 2];
                    sumA += pic.pixels[idx + 3];
                    ++count;
                }
            }
            const std::size_t dst = (static_cast<std::size_t>(y) * bw + x) * 4;
            pic.blurredPixels[dst + 0] = static_cast<std::uint8_t>(sumB / count);
            pic.blurredPixels[dst + 1] = static_cast<std::uint8_t>(sumG / count);
            pic.blurredPixels[dst + 2] = static_cast<std::uint8_t>(sumR / count);
            pic.blurredPixels[dst + 3] = static_cast<std::uint8_t>(sumA / count);
        }
    }

    // 2. Separable 3-pass sliding-window blur on the compact (bw x bh) buffer.
    std::vector<std::uint8_t> temp(pic.blurredPixels.size());
    const int radius = std::clamp(std::max(bw, bh) / 36, 2, 10);
    const int window = 2 * radius + 1;

    for (int pass = 0; pass < 3; ++pass) {
        for (int y = 0; y < bh; ++y) {
            int sumB = 0, sumG = 0, sumR = 0, sumA = 0;
            for (int dx = -radius; dx <= radius; ++dx) {
                const int cx = std::clamp(dx, 0, bw - 1);
                const std::size_t idx = (static_cast<std::size_t>(y) * bw + cx) * 4;
                sumB += pic.blurredPixels[idx + 0];
                sumG += pic.blurredPixels[idx + 1];
                sumR += pic.blurredPixels[idx + 2];
                sumA += pic.blurredPixels[idx + 3];
            }
            for (int x = 0; x < bw; ++x) {
                const std::size_t dst = (static_cast<std::size_t>(y) * bw + x) * 4;
                temp[dst + 0] = static_cast<std::uint8_t>(sumB / window);
                temp[dst + 1] = static_cast<std::uint8_t>(sumG / window);
                temp[dst + 2] = static_cast<std::uint8_t>(sumR / window);
                temp[dst + 3] = static_cast<std::uint8_t>(sumA / window);

                const int removeX = std::clamp(x - radius, 0, bw - 1);
                const int addX = std::clamp(x + radius + 1, 0, bw - 1);
                const std::size_t remIdx = (static_cast<std::size_t>(y) * bw + removeX) * 4;
                const std::size_t addIdx = (static_cast<std::size_t>(y) * bw + addX) * 4;
                sumB += pic.blurredPixels[addIdx + 0] - pic.blurredPixels[remIdx + 0];
                sumG += pic.blurredPixels[addIdx + 1] - pic.blurredPixels[remIdx + 1];
                sumR += pic.blurredPixels[addIdx + 2] - pic.blurredPixels[remIdx + 2];
                sumA += pic.blurredPixels[addIdx + 3] - pic.blurredPixels[remIdx + 3];
            }
        }
        for (int x = 0; x < bw; ++x) {
            int sumB = 0, sumG = 0, sumR = 0, sumA = 0;
            for (int dy = -radius; dy <= radius; ++dy) {
                const int cy = std::clamp(dy, 0, bh - 1);
                const std::size_t idx = (static_cast<std::size_t>(cy) * bw + x) * 4;
                sumB += temp[idx + 0];
                sumG += temp[idx + 1];
                sumR += temp[idx + 2];
                sumA += temp[idx + 3];
            }
            for (int y = 0; y < bh; ++y) {
                const std::size_t dst = (static_cast<std::size_t>(y) * bw + x) * 4;
                pic.blurredPixels[dst + 0] = static_cast<std::uint8_t>(sumB / window);
                pic.blurredPixels[dst + 1] = static_cast<std::uint8_t>(sumG / window);
                pic.blurredPixels[dst + 2] = static_cast<std::uint8_t>(sumR / window);
                pic.blurredPixels[dst + 3] = static_cast<std::uint8_t>(sumA / window);

                const int removeY = std::clamp(y - radius, 0, bh - 1);
                const int addY = std::clamp(y + radius + 1, 0, bh - 1);
                const std::size_t remIdx = (static_cast<std::size_t>(removeY) * bw + x) * 4;
                const std::size_t addIdx = (static_cast<std::size_t>(addY) * bw + x) * 4;
                sumB += temp[addIdx + 0] - temp[remIdx + 0];
                sumG += temp[addIdx + 1] - temp[remIdx + 1];
                sumR += temp[addIdx + 2] - temp[remIdx + 2];
                sumA += temp[addIdx + 3] - temp[remIdx + 3];
            }
        }
    }

    // 3. A gentle saturation lift (saturate(115%)) in premultiplied BGRA space, so the glass carries the picture's
    // colour without one strong hue, such as a green coat, flooding the whole surface.
    constexpr float kSaturation = 1.15f;
    for (std::size_t i = 0; i < pic.blurredPixels.size(); i += 4) {
        const float b = static_cast<float>(pic.blurredPixels[i + 0]);
        const float g = static_cast<float>(pic.blurredPixels[i + 1]);
        const float r = static_cast<float>(pic.blurredPixels[i + 2]);
        const float a = static_cast<float>(pic.blurredPixels[i + 3]);
        const float luma = 0.2126f * r + 0.7152f * g + 0.0722f * b;
        const float nr = std::clamp(luma + (r - luma) * kSaturation, 0.0f, a);
        const float ng = std::clamp(luma + (g - luma) * kSaturation, 0.0f, a);
        const float nb = std::clamp(luma + (b - luma) * kSaturation, 0.0f, a);
        pic.blurredPixels[i + 0] = static_cast<std::uint8_t>(nb + 0.5f);
        pic.blurredPixels[i + 1] = static_cast<std::uint8_t>(ng + 0.5f);
        pic.blurredPixels[i + 2] = static_cast<std::uint8_t>(nr + 0.5f);
    }
}

}  // namespace

DecodedPicture DecodePicture(Graphics& graphics, const std::wstring& file) {
    DecodedPicture picture;
    IWICImagingFactory* wic = graphics.wic();
    ComPtr<IWICBitmapDecoder> decoder;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(wic->CreateDecoderFromFilename(file.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad,
                                              &decoder)) ||
        FAILED(decoder->GetFrame(0, &frame))) {
        return picture;
    }

    UINT srcWidth = 0;
    UINT srcHeight = 0;
    if (FAILED(frame->GetSize(&srcWidth, &srcHeight)) || srcWidth == 0 || srcHeight == 0) return picture;

    // Cap decoded dimensions to 1920x1080 so oversized 4K/8K network backdrops never stall RAM or GPU uploads.
    UINT width = srcWidth;
    UINT height = srcHeight;
    ComPtr<IWICBitmapSource> source = frame;
    if (width > 1920 || height > 1080) {
        const double ratio = std::min(1920.0 / static_cast<double>(width), 1080.0 / static_cast<double>(height));
        width = std::max(1u, static_cast<UINT>(std::lround(width * ratio)));
        height = std::max(1u, static_cast<UINT>(std::lround(height * ratio)));
        ComPtr<IWICBitmapScaler> scaler;
        if (SUCCEEDED(wic->CreateBitmapScaler(&scaler)) &&
            SUCCEEDED(scaler->Initialize(frame.Get(), width, height, WICBitmapInterpolationModeLinear))) {
            source = scaler;
        } else {
            width = srcWidth;
            height = srcHeight;
        }
    }

    ComPtr<IWICFormatConverter> converter;
    if (FAILED(wic->CreateFormatConverter(&converter)) ||
        FAILED(converter->Initialize(source.Get(), GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom))) {
        return picture;
    }

    picture.pixels.resize(static_cast<std::size_t>(width) * height * 4);
    if (FAILED(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(picture.pixels.size()),
                                     picture.pixels.data()))) {
        return picture;
    }
    picture.width = width;
    picture.height = height;
    picture.ok = true;
    BuildLiquidGlassBuffer(picture);
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

    auto ready = ready_.find(file);
    if (ready == ready_.end()) {
        if (!request_) {
            DecodedPicture picture = DecodePicture(graphics_, file);
            if (!picture.ok) {
                failed_[file] = true;
                return nullptr;
            }
            ready = ready_.emplace(file, std::move(picture)).first;
        } else {
            if (requested_.insert(file).second) request_(file);
            return nullptr;
        }
    }
    if (request_ && uploadsThisFrame_ >= kUploadsPerFrame) return nullptr;
    ++uploadsThisFrame_;

    const DecodedPicture& picture = ready->second;
    const D2D1_BITMAP_PROPERTIES properties =
        D2D1::BitmapProperties(D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    ComPtr<ID2D1Bitmap> bitmap;
    const bool made = SUCCEEDED(target->CreateBitmap(D2D1::SizeU(picture.width, picture.height), picture.pixels.data(),
                                                     picture.width * 4, properties, &bitmap));
    if (made && !picture.blurredPixels.empty() && picture.blurredWidth > 0 && picture.blurredHeight > 0) {
        ComPtr<ID2D1Bitmap> blurred;
        if (SUCCEEDED(target->CreateBitmap(D2D1::SizeU(picture.blurredWidth, picture.blurredHeight),
                                           picture.blurredPixels.data(), picture.blurredWidth * 4, properties,
                                           &blurred))) {
            blurredBitmaps_[file] = std::move(blurred);
        }
    }
    ready_.erase(ready);
    if (!made) {
        failed_[file] = true;
        return nullptr;
    }
    ID2D1Bitmap* raw = bitmap.Get();
    bitmaps_[file] = std::move(bitmap);
    return raw;
}

ID2D1Bitmap* ImageCache::GetBlurred(ID2D1RenderTarget* target, const std::wstring& file, float /*standardDeviation*/) {
    const auto found = blurredBitmaps_.find(file);
    if (found != blurredBitmaps_.end()) return found->second.Get();

    ID2D1Bitmap* source = Get(target, file);
    const auto after = blurredBitmaps_.find(file);
    if (after != blurredBitmaps_.end()) return after->second.Get();
    return source;
}

void ImageCache::Deliver(const std::wstring& file, DecodedPicture picture) {
    requested_.erase(file);
    if (!picture.ok) {
        failed_[file] = true;
        return;
    }
    ready_[file] = std::move(picture);
}

bool ImageCache::Busy() const {
    return !ready_.empty();
}

void ImageCache::Clear() {
    bitmaps_.clear();
    blurredBitmaps_.clear();
    failed_.clear();
    requested_.clear();
}

}  // namespace tvm::platform
