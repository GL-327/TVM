#pragma once

#include "core/core_client.h"

namespace tvm::platform {

// Start the bundled/shared Node Core without a browser engine. Existing Core
// Checks whether the local Core is running for the same data directory and starts it when missing.
// Ensures only the matching Core starts and stops cleanly; reused across launchers and tests.
// services are reused only when they report the same data-directory marker.
void EnsureCore(const coreapi::Client& client);

// Returns the data-directory marker string used to identify the running Core process.
std::string ReadRuntimeMarker(const coreapi::Client& client);

// Waits for Core to restart after an applied update until it answers on the expected commit or version.
bool WaitForCoreRestart(const coreapi::Client& client, const std::string& marker,
                        const std::string& previousVersion, const std::string& appliedCommit);

}  // namespace tvm::platform
