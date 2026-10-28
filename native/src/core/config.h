#pragma once

// Core binding and version. Loopback is the default: Core holds provider
// credentials, so it only listens on the LAN when a developer opts in.

#include <cstdint>
#include <string>

#include "core/util.h"

namespace tvm::config {

inline constexpr char kCoreHost[] = "127.0.0.1";
inline constexpr std::uint16_t kDefaultCorePort = 7345;

// Kept equal to the root package.json version. config tests compare them.
inline constexpr char kCoreVersion[] = "1.0.0";

// Throws std::runtime_error for a value that is not a port, rather than
// falling back to some other port nobody expects.
std::uint16_t ResolvePort(const util::EnvLookup& env);

// Accepts 127.0.0.1, 0.0.0.0 or a literal IPv4 address. Throws otherwise.
std::string ResolveBindHost(const util::EnvLookup& env);

bool IsIPv4(const std::string& text);

}  // namespace tvm::config
