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
inline constexpr char kCoreVersion[] = TVM_VERSION;
inline constexpr char kBuildCommit[] = TVM_GIT_COMMIT;

// Formats the window version line shown at the top of Settings, e.g. "TVM 1.4.11 · build 2af8d1a".
inline std::string FormatWindowVersion(const std::string& version = kCoreVersion,
                                       const std::string& commit = kBuildCommit) {
    const std::string trimmed = util::Trim(commit);
    const std::string shortSha = trimmed.size() > 7 ? trimmed.substr(0, 7) : trimmed;
    return shortSha.empty() ? ("TVM " + version) : ("TVM " + version + " \xC2\xB7 build " + shortSha);
}

// Throws std::runtime_error for a value that is not a port, rather than
// falling back to some other port nobody expects.
std::uint16_t ResolvePort(const util::EnvLookup& env);

// Accepts 127.0.0.1, 0.0.0.0 or a literal IPv4 address. Throws otherwise.
std::string ResolveBindHost(const util::EnvLookup& env);

bool IsIPv4(const std::string& text);

// True when `running` is a dotted version (1.2.0) older than `wanted`. Anything
// that is not a version, either side, is never "older": no update is forced on
// a guess.
bool VersionOlder(const std::string& running, const std::string& wanted);

}  // namespace tvm::config
