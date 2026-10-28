#pragma once

// Direct2D and DirectWrite resources, shared by the window and the snapshot
// renderer. Text formats are cached because they do not depend on the render
// target.

#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <map>
#include <tuple>
#include <string>
#include <utility>

namespace tvm::platform {

using Microsoft::WRL::ComPtr;

class Graphics {
public:
    // Throws std::runtime_error if the factories cannot be created.
    Graphics();

    ComPtr<ID2D1HwndRenderTarget> CreateHwndTarget(HWND window, UINT width, UINT height);
    ComPtr<ID2D1RenderTarget> CreateBitmapTarget(IWICBitmap* bitmap);
    // A target with premultiplied alpha, for drawing into a layered window's bitmap.
    ComPtr<ID2D1DCRenderTarget> CreateDcTarget();

    // A left-aligned, single-line, ellipsised format at `sizePx` pixels.
    IDWriteTextFormat* TextFormat(double sizePx, int weight);
    // Wrapped text, top aligned, for paragraphs.
    IDWriteTextFormat* ParagraphFormat(double sizePx, int weight);

    ID2D1Factory* d2d() const { return d2d_.Get(); }
    IDWriteFactory* dwrite() const { return dwrite_.Get(); }
    IWICImagingFactory* wic() const { return wic_.Get(); }

private:
    ComPtr<ID2D1Factory> d2d_;
    ComPtr<IDWriteFactory> dwrite_;
    ComPtr<IWICImagingFactory> wic_;
    std::wstring family_;
    std::map<std::tuple<long, int, bool>, ComPtr<IDWriteTextFormat>> formats_;
    IDWriteTextFormat* CachedFormat(double sizePx, int weight, bool wrap);
};

}  // namespace tvm::platform
