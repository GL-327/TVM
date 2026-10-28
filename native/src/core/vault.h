#pragma once

// The local vault. A 32-byte master key is wrapped by DPAPI in
// secrets\master.key. Sealed values are base64(iv[12] | tag[16] | ciphertext)
// under AES-256-GCM, with the JSON text as the plaintext.

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "core/paths.h"

namespace tvm::vault {

// Creates the master key on first use. Throws if an existing key is damaged,
// because rotating it would silently orphan every sealed file.
std::string SealJson(const paths::fs::path& dataDir, const nlohmann::json& value);

// Returns nothing when the blob is malformed, the tag does not verify, or the
// master key is missing. Reading never creates a key: a missing key with
// sealed data present means the data cannot be recovered, and a fresh key
// would only hide that.
std::optional<nlohmann::json> OpenJson(const paths::fs::path& dataDir, const std::string& blob);

void WriteSealed(const paths::fs::path& dataDir, const paths::fs::path& path, const nlohmann::json& value);
std::optional<nlohmann::json> ReadSealed(const paths::fs::path& dataDir, const paths::fs::path& path);

}  // namespace tvm::vault
