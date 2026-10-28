#pragma once

// Secret strings (tokens, keys) and private JSON documents. Both are sealed in
// the vault. Plain files left by older installs are migrated in place on their
// first successful read.

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "core/paths.h"

namespace tvm::secrets {

// Returns nothing when the file is missing, empty, or cannot be opened.
std::optional<std::string> ReadSecret(const paths::fs::path& path);
bool HasSecretFile(const paths::fs::path& path);
void WriteSecret(const paths::fs::path& path, const std::string& value);
void DeleteSecret(const paths::fs::path& path);

// Reads a sealed JSON document, or migrates a legacy plain JSON file.
// Unreadable ciphertext is never treated as data.
std::optional<nlohmann::json> ReadPrivateJson(const paths::fs::path& dataDir, const paths::fs::path& path);

}  // namespace tvm::secrets
