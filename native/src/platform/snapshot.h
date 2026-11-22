#pragma once

// Renders a scene into a PNG file, without a window. Used for visual checks
// and for the --snapshot and --frames command-line modes.

#include <functional>
#include <memory>
#include <string>

#include "platform/glass_lens.h"
#include "platform/graphics.h"
#include "platform/image_cache.h"
#include "ui/shell.h"

namespace tvm::platform {

// Draws the scene's current state at width x height and writes it to `path`.
// Throws std::runtime_error on failure.
void SaveSnapshot(const ui::Shell& shell, Graphics& graphics, unsigned width, unsigned height,
                  const std::wstring& path);

// Writes many frames of the same shell, keeping one bitmap target and one image cache, so a
// sequence of animation frames does not decode its pictures again for every frame.
class SnapshotWriter {
public:
    // Throws std::runtime_error when the bitmap or its target cannot be made.
    SnapshotWriter(Graphics& graphics, unsigned width, unsigned height);
    ~SnapshotWriter();
    SnapshotWriter(const SnapshotWriter&) = delete;
    SnapshotWriter& operator=(const SnapshotWriter&) = delete;

    void Save(const ui::Shell& shell, const std::wstring& path);
    // Draws whatever `paint` draws, such as a stand-in picture under a player screen.
    // Without `clearGlass` the glass is frosted, as it is over the player's video in the app.
    void Save(const std::function<void(ui::Painter&)>& paint, const std::wstring& path, bool clearGlass = true);

private:
    Graphics& graphics_;
    unsigned width_;
    unsigned height_;
    ComPtr<IWICBitmap> bitmap_;
    ComPtr<ID2D1RenderTarget> target_;
    std::unique_ptr<ImageCache> images_;
    std::unique_ptr<GlassLens> lens_;
};

}  // namespace tvm::platform
