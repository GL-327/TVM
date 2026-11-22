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

void WritePng(Graphics& graphics, IWICBitmap* bitmap, unsigned width, unsigned height, const std::wstring& path) {
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
    Check(frame->WriteSource(bitmap, nullptr), "PNG pixels");
    Check(frame->Commit(), "PNG frame commit");
    Check(encoder->Commit(), "PNG commit");
}

}  // namespace

void SaveSnapshot(const ui::Shell& shell, Graphics& graphics, unsigned width, unsigned height,
                  const std::wstring& path) {
    SnapshotWriter writer(graphics, width, height);
    writer.Save(shell, path);
}

SnapshotWriter::SnapshotWriter(Graphics& graphics, unsigned width, unsigned height)
    : graphics_(graphics), width_(width), height_(height) {
    // Render into a premultiplied BGRA bitmap. The background is opaque, so
    // premultiplied and straight alpha are the same.
    Check(graphics.wic()->CreateBitmap(width, height, GUID_WICPixelFormat32bppPBGRA, WICBitmapCacheOnLoad, &bitmap_),
          "snapshot bitmap");
    target_ = graphics.CreateBitmapTarget(bitmap_.Get());
    images_ = std::make_unique<ImageCache>(graphics);
}

// The image cache's bitmaps belong to the target, so they go first.
SnapshotWriter::~SnapshotWriter() {
    images_.reset();
    target_.Reset();
}

void SnapshotWriter::Save(const ui::Shell& shell, const std::wstring& path) {
    Save([&shell](ui::Painter& painter) { shell.Paint(painter); }, path);
}

void SnapshotWriter::Save(const std::function<void(ui::Painter&)>& paint, const std::wstring& path) {
    images_->BeginFrame();
    target_->BeginDraw();
    {
        D2dPainter painter(target_.Get(), graphics_, nullptr, images_.get());
        paint(painter);
    }
    Check(target_->EndDraw(), "snapshot drawing");
    WritePng(graphics_, bitmap_.Get(), width_, height_, path);
}

}  // namespace tvm::platform
