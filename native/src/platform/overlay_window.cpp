#include "platform/overlay_window.h"

#include <stdexcept>

namespace tvm::platform {

namespace {

constexpr wchar_t kOverlayClass[] = L"TVMPlayerChrome";

// The overlay never keeps the keyboard. Should anything activate it, focus goes straight back to
// TVM's window, which reads the keys.
LRESULT CALLBACK OverlayProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    case WM_NCHITTEST:
        return HTTRANSPARENT;
    case WM_SETFOCUS:
        if (HWND owner = GetWindow(window, GW_OWNER)) {
            SetForegroundWindow(owner);
            SetFocus(owner);
        }
        return 0;
    default:
        return DefWindowProcW(window, message, wParam, lParam);
    }
}

}  // namespace

OverlayWindow::OverlayWindow(HINSTANCE instance, HWND owner) : instance_(instance), owner_(owner) {
    WNDCLASSEXW cls{};
    cls.cbSize = sizeof(cls);
    cls.lpfnWndProc = &OverlayProc;
    cls.hInstance = instance_;
    cls.lpszClassName = kOverlayClass;
    RegisterClassExW(&cls);
    // Owned by TVM's window, so it stays above it, and minimises and closes with it.
    window_ = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, kOverlayClass,
                              L"", WS_POPUP, 0, 0, 0, 0, owner_, nullptr, instance_, nullptr);
    if (window_ == nullptr) throw std::runtime_error("the player overlay could not be created");
}

OverlayWindow::~OverlayWindow() {
    ReleaseSurface();
    if (window_ != nullptr) DestroyWindow(window_);
}

void OverlayWindow::Show(bool visible) {
    if (visible == visible_) return;
    visible_ = visible;
    ShowWindow(window_, visible ? SW_SHOWNA : SW_HIDE);
}

void OverlayWindow::EnsureSurface(Graphics& graphics, int width, int height) {
    if (dc_ != nullptr && width == width_ && height == height_) return;
    ReleaseSurface();

    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(info.bmiHeader);
    info.bmiHeader.biWidth = width;
    // Negative height: rows run top down, as Direct2D writes them.
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HDC screen = GetDC(nullptr);
    dc_ = CreateCompatibleDC(screen);
    bitmap_ = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    ReleaseDC(nullptr, screen);
    if (dc_ == nullptr || bitmap_ == nullptr) throw std::runtime_error("the player overlay surface failed");
    previous_ = SelectObject(dc_, bitmap_);
    width_ = width;
    height_ = height;

    target_ = graphics.CreateDcTarget();
    const RECT bounds{0, 0, width, height};
    if (FAILED(target_->BindDC(dc_, &bounds))) throw std::runtime_error("the player overlay target failed");
}

void OverlayWindow::ReleaseSurface() {
    target_.Reset();
    if (dc_ != nullptr && previous_ != nullptr) SelectObject(dc_, previous_);
    if (bitmap_ != nullptr) DeleteObject(bitmap_);
    if (dc_ != nullptr) DeleteDC(dc_);
    dc_ = nullptr;
    bitmap_ = nullptr;
    previous_ = nullptr;
    width_ = 0;
    height_ = 0;
}

void OverlayWindow::Paint(Graphics& graphics, const std::function<void(ID2D1RenderTarget*)>& draw) {
    RECT client{};
    GetClientRect(owner_, &client);
    const int width = client.right - client.left;
    const int height = client.bottom - client.top;
    if (width <= 0 || height <= 0 || IsIconic(owner_)) return;
    POINT origin{0, 0};
    ClientToScreen(owner_, &origin);

    EnsureSurface(graphics, width, height);
    target_->BeginDraw();
    target_->Clear(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.0f));
    draw(target_.Get());
    if (target_->EndDraw() == D2DERR_RECREATE_TARGET) {
        ReleaseSurface();
        return;
    }

    SIZE size{width, height};
    POINT source{0, 0};
    BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    HDC screen = GetDC(nullptr);
    UpdateLayeredWindow(window_, screen, &origin, &size, dc_, &source, 0, &blend, ULW_ALPHA);
    ReleaseDC(nullptr, screen);
}

}  // namespace tvm::platform
