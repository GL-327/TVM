#include "platform/graphics.h"

#include <dwrite_3.h>

#include <cmath>
#include <stdexcept>
#include <string>

#include "core/util.h"
#include "platform/assets.h"

namespace tvm::platform {

namespace {

void Check(HRESULT result, const char* what) {
    if (FAILED(result)) {
        throw std::runtime_error(std::string(what) + " failed (HRESULT " + std::to_string(result) + ")");
    }
}

// Loads Inter privately from packaged assets when available.
ComPtr<IDWriteFontCollection> LoadPrivateInter(IDWriteFactory* factory) {
    ComPtr<IDWriteFactory5> factory5;
    if (FAILED(factory->QueryInterface(IID_PPV_ARGS(&factory5)))) return nullptr;

    ComPtr<IDWriteFontSetBuilder1> builder;
    if (FAILED(factory5->CreateFontSetBuilder(&builder))) return nullptr;

    int added = 0;
    for (const char* file : {"fonts/Inter-Regular.otf", "fonts/Inter-SemiBold.otf", "fonts/Inter-Bold.otf"}) {
        const auto path = AssetFile(file);
        if (!path.has_value()) continue;
        ComPtr<IDWriteFontFile> fontFile;
        if (SUCCEEDED(factory5->CreateFontFileReference(path->c_str(), nullptr, &fontFile)) &&
            SUCCEEDED(builder->AddFontFile(fontFile.Get()))) {
            ++added;
        }
    }
    if (added == 0) return nullptr;

    ComPtr<IDWriteFontSet> fontSet;
    if (FAILED(builder->CreateFontSet(&fontSet))) return nullptr;

    ComPtr<IDWriteFontCollection1> collection1;
    if (FAILED(factory5->CreateFontCollectionFromFontSet(fontSet.Get(), &collection1))) return nullptr;

    UINT32 index = 0;
    BOOL exists = FALSE;
    if (FAILED(collection1->FindFamilyName(L"Inter", &index, &exists)) || !exists) return nullptr;
    return collection1;
}

// The design tokens name Inter first (privately loaded), then Segoe UI Variable Display, then Segoe UI.
std::wstring ChooseFamily(IDWriteFactory* factory) {
    ComPtr<IDWriteFontCollection> collection;
    if (FAILED(factory->GetSystemFontCollection(&collection, FALSE))) return L"Segoe UI";
    for (const wchar_t* candidate : {L"Segoe UI Variable Display", L"Segoe UI"}) {
        UINT32 index = 0;
        BOOL exists = FALSE;
        if (SUCCEEDED(collection->FindFamilyName(candidate, &index, &exists)) && exists) return candidate;
    }
    return L"Segoe UI";
}

}  // namespace

Graphics::Graphics() {
    Check(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, d2d_.GetAddressOf()), "Direct2D");
    Check(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                              reinterpret_cast<IUnknown**>(dwrite_.GetAddressOf())),
          "DirectWrite");
    Check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic_)),
          "Windows Imaging Component");
    fontCollection_ = LoadPrivateInter(dwrite_.Get());
    family_ = fontCollection_ ? L"Inter" : ChooseFamily(dwrite_.Get());
}

ComPtr<ID2D1HwndRenderTarget> Graphics::CreateHwndTarget(HWND window, UINT width, UINT height) {
    ComPtr<ID2D1HwndRenderTarget> target;
    // Layout and pointer hit testing use client pixels. Pin the target to that
    // same coordinate system instead of multiplying it by the system DPI.
    const D2D1_RENDER_TARGET_PROPERTIES properties = D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(), 96.0f, 96.0f);
    const D2D1_HWND_RENDER_TARGET_PROPERTIES hwnd =
        D2D1::HwndRenderTargetProperties(window, D2D1::SizeU(width, height));
    Check(d2d_->CreateHwndRenderTarget(properties, hwnd, &target), "Direct2D window target");
    return target;
}

ComPtr<ID2D1RenderTarget> Graphics::CreateBitmapTarget(IWICBitmap* bitmap) {
    ComPtr<ID2D1RenderTarget> target;
    Check(d2d_->CreateWicBitmapRenderTarget(bitmap, D2D1::RenderTargetProperties(), &target),
          "Direct2D bitmap target");
    return target;
}

ComPtr<ID2D1DCRenderTarget> Graphics::CreateDcTarget() {
    ComPtr<ID2D1DCRenderTarget> target;
    const D2D1_RENDER_TARGET_PROPERTIES properties = D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    Check(d2d_->CreateDCRenderTarget(&properties, &target), "Direct2D overlay target");
    return target;
}

IDWriteTextFormat* Graphics::TextFormat(double sizePx, int weight) {
    return CachedFormat(sizePx, weight, false);
}

IDWriteTextFormat* Graphics::ParagraphFormat(double sizePx, int weight) {
    return CachedFormat(sizePx, weight, true);
}

double Graphics::MeasureText(std::string_view text, double sizePx, int weight) {
    if (text.empty()) return 0.0;
    const long sizeKey = std::lround(sizePx * 10.0);
    const auto key = std::make_tuple(std::string(text), sizeKey, weight);
    const auto found = measuredText_.find(key);
    if (found != measuredText_.end()) return found->second;

    const std::wstring wide = util::ToWide(std::string(text));
    IDWriteTextFormat* format = TextFormat(sizePx, weight);
    ComPtr<IDWriteTextLayout> layout;
    DWRITE_TEXT_METRICS metrics{};
    double width = static_cast<double>(text.size()) * 0.56 * sizePx;
    if (SUCCEEDED(dwrite_->CreateTextLayout(wide.c_str(), static_cast<UINT32>(wide.size()), format, 100000.0f, 1000.0f,
                                            &layout)) &&
        SUCCEEDED(layout->GetMetrics(&metrics))) {
        width = metrics.widthIncludingTrailingWhitespace;
    }
    if (measuredText_.size() > 4096) measuredText_.clear();
    measuredText_.emplace(key, width);
    return width;
}

IDWriteTextFormat* Graphics::CachedFormat(double sizePx, int weight, bool wrap) {
    // Whole pixels for the key: sizes that differ only past a tenth of a pixel
    // look identical on screen.
    const long key = std::lround(sizePx * 10.0);
    const auto found = formats_.find({key, weight, wrap});
    if (found != formats_.end()) return found->second.Get();

    ComPtr<IDWriteTextFormat> format;
    Check(dwrite_->CreateTextFormat(family_.c_str(), fontCollection_.Get(), static_cast<DWRITE_FONT_WEIGHT>(weight),
                                    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL,
                                    static_cast<FLOAT>(sizePx), L"en-us", &format),
          "DirectWrite text format");
    Check(format->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING), "text alignment");

    if (wrap) {
        // Paragraphs wrap at words and start at the top of their box.
        Check(format->SetWordWrapping(DWRITE_WORD_WRAPPING_WRAP), "text wrapping");
        Check(format->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR), "paragraph alignment");
    } else {
        // Labels are one line, centred vertically, and end with an ellipsis.
        Check(format->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP), "text wrapping");
        Check(format->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER), "paragraph alignment");

        ComPtr<IDWriteInlineObject> ellipsis;
        Check(dwrite_->CreateEllipsisTrimmingSign(format.Get(), &ellipsis), "ellipsis");
        DWRITE_TRIMMING trimming{};
        trimming.granularity = DWRITE_TRIMMING_GRANULARITY_CHARACTER;
        Check(format->SetTrimming(&trimming, ellipsis.Get()), "trimming");
    }

    IDWriteTextFormat* raw = format.Get();
    formats_.emplace(std::make_tuple(key, weight, wrap), std::move(format));
    return raw;
}

}  // namespace tvm::platform
