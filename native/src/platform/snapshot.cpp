#include "platform/snapshot.h"

#include <stdexcept>

#include "platform/d2d_painter.h"

namespace tvm::platform {

namespace {

void Check(HRESULT result, const char* what) {
    if (FAILED(result)) {
        throw std::runtime_error(std::string(what) + " failed (HRESULT " + std::to_string(result) + ")");
    }
}

}  // namespace

void SaveSnapshot(const ui::Shell& shell, Graphics& graphics, unsigned width, unsigned height,
                  const std::wstring& path) {
    // Render into a premultiplied BGRA bitmap. The background is opaque, so
    // premultiplied and straight alpha are the same.
    ComPtr<IWICBitmap> bitmap;
    Check(graphics.wic()->CreateBitmap(width, height, GUID_WICPixelFormat32bppPBGRA, WICBitmapCacheOnLoad, &bitmap),
          "snapshot bitmap");

    {
        const ComPtr<ID2D1RenderTarget> target = graphics.CreateBitmapTarget(bitmap.Get());
        target->BeginDraw();
        D2dPainter painter(target.Get(), graphics);
        shell.Paint(painter);
        Check(target->EndDraw(), "snapshot drawing");
    }

    ComPtr<IWICStream> stream;
    Check(graphics.wic()->CreateStream(&stream), "snapshot file");
    Check(stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE), "opening the snapshot file");

    ComPtr<IWICBitmapEncoder> encoder;
    Check(graphics.wic()->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder), "PNG encoder");
    Check(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache), "PNG encoder setup");

    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    Check(encoder->CreateNewFrame(&frame, &options), "PNG frame");
    Check(frame->Initialize(options.Get()), "PNG frame setup");
    Check(frame->SetSize(width, height), "PNG size");
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    Check(frame->SetPixelFormat(&format), "PNG pixel format");
    // WriteSource converts the premultiplied source to the encoder's format.
    Check(frame->WriteSource(bitmap.Get(), nullptr), "PNG pixels");
    Check(frame->Commit(), "PNG frame commit");
    Check(encoder->Commit(), "PNG commit");
}

}  // namespace tvm::platform
