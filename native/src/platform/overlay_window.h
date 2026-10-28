#pragma once

// A see-through window over TVM's window, for the player's chrome. The picture is mpv's child
// window, which covers anything TVM's own window draws, so the chrome is drawn here instead: a
// layered popup with per-pixel alpha, as the old app lays its transparent page over mpv's window.
// It takes no input and never activates, so clicks and keys fall through to TVM's window.

#include <windows.h>

#include <functional>

#include "platform/graphics.h"

namespace tvm::platform {

class OverlayWindow {
public:
    OverlayWindow(HINSTANCE instance, HWND owner);
    ~OverlayWindow();

    OverlayWindow(const OverlayWindow&) = delete;
    OverlayWindow& operator=(const OverlayWindow&) = delete;

    void Show(bool visible);
    bool Visible() const { return visible_; }
    // Draws a frame over the owner's client area, which `draw` paints onto a cleared, transparent target.
    void Paint(Graphics& graphics, const std::function<void(ID2D1RenderTarget*)>& draw);

private:
    void EnsureSurface(Graphics& graphics, int width, int height);
    void ReleaseSurface();

    HINSTANCE instance_;
    HWND owner_;
    HWND window_ = nullptr;
    bool visible_ = false;

    HDC dc_ = nullptr;
    HBITMAP bitmap_ = nullptr;
    HGDIOBJ previous_ = nullptr;
    int width_ = 0;
    int height_ = 0;
    ComPtr<ID2D1DCRenderTarget> target_;
};

}  // namespace tvm::platform
