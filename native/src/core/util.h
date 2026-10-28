#pragma once

// Text, encoding and file helpers shared by the core. These mirror the Node
// behaviour TVM's existing data depends on, so they are kept exact on purpose.

#include <cstdint>
#include <filesystem>
#include <functional>
#include <initializer_list>
#include <optional>
#include <string>
#include <vector>

namespace tvm::util {

using Bytes = std::vector<std::uint8_t>;

// Looks up an environment variable by name. Injected so tests can supply a
// fixed environment instead of the real one.
using EnvLookup = std::function<std::optional<std::wstring>(const std::wstring& name)>;
EnvLookup ProcessEnvironment();

std::wstring ToWide(const std::string& utf8);
std::string ToUtf8(const std::wstring& wide);

// JavaScript String.prototype.trim for the ASCII whitespace that appears in
// TVM's files. Callers strip a UTF-8 byte order mark first.
std::string Trim(const std::string& text);
std::string StripBom(const std::string& text);

// Form encoding as URLSearchParams writes it: a space becomes '+', letters, digits and
// *-._ are kept, and every other byte becomes %XX.
std::string FormEncode(const std::string& text);

// Standard base64 with padding. Decoding follows Node's Buffer.from(text,
// 'base64'): both alphabets are accepted, characters outside them are
// skipped, and decoding stops at the first '='.
std::string Base64Encode(const Bytes& bytes);
Bytes Base64Decode(const std::string& text);

Bytes Concat(std::initializer_list<const Bytes*> parts);
Bytes ToBytes(const std::string& text);
std::string ToString(const Bytes& bytes);

// Whole-file reads. Nothing is returned for a missing or unreadable file.
std::optional<std::string> ReadTextFile(const std::filesystem::path& path);

// Replaces the file atomically: the content goes to a sibling temporary file
// that is flushed and then moved over the target, so a power loss cannot leave
// a half-written credential. Creates parent directories as needed.
void WriteFileAtomically(const std::filesystem::path& path, const std::string& content);

// Cryptographically secure random bytes from the operating system.
Bytes RandomBytes(std::size_t count);

// The current time as JavaScript's Date.toISOString() writes it: UTC, with milliseconds.
std::string IsoTimestamp();

}  // namespace tvm::util
