#pragma once

// Windows cryptography for the local vault. DPAPI wraps the master key to the
// current Windows account. AES-256-GCM seals the data. Both match the formats
// the Node core wrote, so existing user data stays readable.

#include <optional>

#include "core/util.h"

namespace tvm::crypto {

// Protects bytes for the current Windows user only (CryptProtectData with the
// default CurrentUser scope and no entropy). Throws on failure.
util::Bytes ProtectForUser(const util::Bytes& plain);

// Reverses ProtectForUser. Returns nothing if the blob was not produced for
// this user or is corrupt.
std::optional<util::Bytes> UnprotectForUser(const util::Bytes& blob);

// AES-256-GCM with a 12-byte IV and a 16-byte tag, the same parameters
// Node's createCipheriv('aes-256-gcm') uses. Throws on invalid sizes.
util::Bytes AesGcmEncrypt(const util::Bytes& key, const util::Bytes& iv,
                          const util::Bytes& plain, util::Bytes& tagOut);

// Returns nothing when the tag does not verify, so tampering is never
// mistaken for data.
std::optional<util::Bytes> AesGcmDecrypt(const util::Bytes& key, const util::Bytes& iv,
                                         const util::Bytes& tag, const util::Bytes& cipher);

// PBKDF2-HMAC-SHA256, as Node's pbkdf2Sync(password, salt, iterations, length, 'sha256') derives it.
// Throws when Windows cannot derive the key.
util::Bytes Pbkdf2Sha256(const std::string& password, const util::Bytes& salt, unsigned long iterations,
                         std::size_t length);

// Compares two byte strings in time that does not depend on where they differ.
bool ConstantTimeEqual(const util::Bytes& left, const util::Bytes& right);

}  // namespace tvm::crypto
