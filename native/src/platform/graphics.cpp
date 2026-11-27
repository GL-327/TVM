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

// Packaged fonts are private to TVM and require no installation.
ComPtr<IDWriteFontCollection> LoadPrivateFont(IDWriteFactory* factory, const char* family,
                                             std::initializer_list<const char*> weights) {
    ComPtr<IDWriteFactory5> factory5;
    if (FAILED(factory->QueryInterface(IID_PPV_ARGS(&factory5)))) return nullptr;

    ComPtr<IDWriteFontSetBuilder1> builder;
    if (FAILED(factory5->CreateFontSetBuilder(&builder))) return nullptr;

    int added = 0;
    for (const char* weight : weights) {
        const auto path = AssetFile(std::string("fonts/") + family + "-" + weight + ".otf");
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
    if (FAILED(collection1->FindFamilyName(util::ToWide(family).c_str(), &index, &exists)) || !exists) return nullptr;
    return collection1;
}

// Use the Windows UI family when the system font is requested.
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
    bundledFonts_[0] = LoadPrivateFont(dwrite_.Get(), "Geist", {"Regular", "Medium", "SemiBold", "Bold"});
    bundledFonts_[1] = LoadPrivateFont(dwrite_.Get(), "Inter", {"Regular", "SemiBold", "Bold"});
    systemFamily_ = ChooseFamily(dwrite_.Get());
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
    // Pixels, as the window target uses, so snapshots match the window and glass copies line up.
    Check(d2d_->CreateWicBitmapRenderTarget(
              bitmap, D2D1::RenderTargetProperties(D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(), 96.0f, 96.0f),
              &target),
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

ComPtr<IDWriteTextLayout> Graphics::TextLayout(std::wstring_view text, const ui::TextStyle& style, int weight,
                                                float width, float height, bool wrap) {
    ComPtr<IDWriteTextLayout> layout;
    auto* format = CachedFormat(style.sizePx, weight, wrap);
    if (FAILED(dwrite_->CreateTextLayout(text.data(), static_cast<UINT32>(text.size()), format, width, height, &layout)))
        return nullptr;
    if (style.trackingEm != 0.0 && text.size() > 1) {
        ComPtr<IDWriteTextLayout1> spacing;
        if (SUCCEEDED(layout.As(&spacing))) {
            // Apply tracking between adjacent characters only so negative tracking does not shift
            // the first glyph left of the origin where CLIP would clip it.
            const DWRITE_TEXT_RANGE inner{0, static_cast<UINT32>(text.size() - 1)};
            spacing->SetCharacterSpacing(0.0f, static_cast<float>(style.trackingEm * style.sizePx), 0.0f, inner);
        }
    }
    const DWRITE_TEXT_RANGE range{0, static_cast<UINT32>(text.size())};
    if (style.tabular) {
        ComPtr<IDWriteTypography> typography;
        if (SUCCEEDED(dwrite_->CreateTypography(&typography))) {
            typography->AddFontFeature({DWRITE_FONT_FEATURE_TAG_TABULAR_FIGURES, 1});
            layout->SetTypography(typography.Get(), range);
        }
    }
    return layout;
}

double Graphics::MeasureText(std::string_view text, const ui::TextStyle& style, int weight) {
    if (text.empty()) return 0.0;
    const auto key = std::make_tuple(ui::tokens::font, std::string(text), std::lround(style.sizePx * 10.0), weight,
                                     style.trackingEm, style.tabular);
    const auto found = measuredText_.find(key);
    if (found != measuredText_.end()) return found->second;

    const auto layout = TextLayout(util::ToWide(std::string(text)), style, weight, 100000.0f, 1000.0f, false);
    DWRITE_TEXT_METRICS metrics{};
    const double width = layout && SUCCEEDED(layout->GetMetrics(&metrics))
                             ? metrics.widthIncludingTrailingWhitespace
                             : static_cast<double>(text.size()) * 0.56 * style.sizePx;
    if (measuredText_.size() > 4096) measuredText_.clear();
    measuredText_.emplace(key, width);
    return width;
}

IDWriteTextFormat* Graphics::CachedFormat(double sizePx, int weight, bool wrap) {
    // Whole pixels for the key: sizes that differ only past a tenth of a pixel
    // look identical on screen.
    const auto font = ui::tokens::font;
    const auto key = std::make_tuple(font, std::lround(sizePx * 10.0), weight, wrap);
    const auto found = formats_.find(key);
    if (found != formats_.end()) return found->second.Get();

    IDWriteFontCollection* collection = nullptr;
    const wchar_t* family = systemFamily_.c_str();
    if (font == ui::UiFont::Geist && bundledFonts_[0]) {
        family = L"Geist";
        collection = bundledFonts_[0].Get();
    } else if (font != ui::UiFont::System && bundledFonts_[1]) {
        family = L"Inter";
        collection = bundledFonts_[1].Get();
    }
    ComPtr<IDWriteTextFormat> format;
    Check(dwrite_->CreateTextFormat(family, collection, static_cast<DWRITE_FONT_WEIGHT>(weight),
                                    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL,
                                    static_cast<FLOAT>(sizePx), L"en-us", &format),
          "DirectWrite text format");
    Check(format->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING), "text alignment");

    if (wrap) {
        // Paragraphs wrap at words and start at the top of their box, with ellipsis when clipped.
        Check(format->SetWordWrapping(DWRITE_WORD_WRAPPING_WRAP), "text wrapping");
        Check(format->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR), "paragraph alignment");
    } else {
        // Labels are one line, centred vertically, and end with an ellipsis.
        Check(format->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP), "text wrapping");
        Check(format->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER), "paragraph alignment");
    }
    ComPtr<IDWriteInlineObject> ellipsis;
    Check(dwrite_->CreateEllipsisTrimmingSign(format.Get(), &ellipsis), "ellipsis");
    DWRITE_TRIMMING trimming{};
    trimming.granularity = DWRITE_TRIMMING_GRANULARITY_CHARACTER;
    Check(format->SetTrimming(&trimming, ellipsis.Get()), "trimming");

    IDWriteTextFormat* raw = format.Get();
    formats_.emplace(key, std::move(format));
    return raw;
}

ID2D1PathGeometry* Graphics::CachedPath(const std::string& key) const {
    const auto found = paths_.find(key);
    return found == paths_.end() ? nullptr : found->second.Get();
}

void Graphics::CachePath(const std::string& key, ComPtr<ID2D1PathGeometry> geometry) {
    // The app draws a few dozen distinct glyphs; the bound only guards against an unexpected stream of new ones.
    if (paths_.size() >= 512) paths_.clear();
    paths_[key] = std::move(geometry);
}

ID2D1StrokeStyle* Graphics::RoundStroke() {
    if (!roundStroke_) {
        d2d_->CreateStrokeStyle(D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND,
                                                           D2D1_CAP_STYLE_ROUND, D2D1_LINE_JOIN_ROUND),
                                nullptr, 0, &roundStroke_);
    }
    return roundStroke_.Get();
}

}  // namespace tvm::platform
