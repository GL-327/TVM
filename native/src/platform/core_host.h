#pragma once

#include "core/core_client.h"

namespace tvm::platform {

// Start the bundled/shared Node Core without a browser engine. Existing Core
// services are reused only when they report the same data-directory marker.
void EnsureCore(const coreapi::Client& client);

}  // namespace tvm::platform
