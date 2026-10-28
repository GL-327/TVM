#pragma once

// Renders a scene into a PNG file, without a window. Used for visual checks
// and for the --snapshot command-line mode.

#include <string>

#include "platform/graphics.h"
#include "ui/shell.h"

namespace tvm::platform {

// Draws the scene's current state at width x height and writes it to `path`.
// Throws std::runtime_error on failure.
void SaveSnapshot(const ui::Shell& shell, Graphics& graphics, unsigned width, unsigned height,
                  const std::wstring& path);

}  // namespace tvm::platform
