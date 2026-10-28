#include "core/vault.h"

#include <map>
#include <mutex>
#include <stdexcept>
#include <string_view>

#include "core/crypto.h"
#include "core/util.h"

namespace tvm::vault {

namespace {

using util::Bytes;

constexpr std::size_t kKeyBytes = 32;
constexpr std::size_t kIvBytes = 12;
constexpr std::size_t kTagBytes = 16;
constexpr std::string_view kKeyPrefix = "tvm-dpapi-v1:";

struct CachedKey {
    std::string stored;
    Bytes key;
};

std::mutex g_cacheMutex;
std::map<std::string, CachedKey> g_keyCache;

std::string CacheKey(const paths::fs::path& path) {
    return util::ToUtf8(path.wstring());
}

// Reads the master key without creating one. Migrates a legacy plain key to
// DPAPI wrapping on first read, as the Node core did.
std::optional<Bytes> ReadMasterKey(const paths::fs::path& path) {
    const std::optional<std::string> text = util::ReadTextFile(path);
    if (!text) return std::nullopt;
    const std::string raw = util::Trim(util::StripBom(*text));

    {
        std::lock_guard lock(g_cacheMutex);
        const auto cached = g_keyCache.find(CacheKey(path));
        if (cached != g_keyCache.end() && cached->second.stored == raw) return cached->second.key;
    }

    if (raw.rfind(kKeyPrefix, 0) == 0) {
        const std::optional<Bytes> key =
            crypto::UnprotectForUser(util::Base64Decode(raw.substr(kKeyPrefix.size())));
        if (!key || key->size() != kKeyBytes) throw std::runtime_error("master key is unreadable");

        std::lock_guard lock(g_cacheMutex);
        g_keyCache[CacheKey(path)] = CachedKey{raw, *key};
        return key;
    }

    // Legacy plain key: wrap it with DPAPI and rewrite the file.
    const Bytes key = util::Base64Decode(raw);
    if (key.size() != kKeyBytes) throw std::runtime_error("master key is unreadable");

    const std::string stored =
        std::string(kKeyPrefix) + util::Base64Encode(crypto::ProtectForUser(key));
    util::WriteFileAtomically(path, stored);

    std::lock_guard lock(g_cacheMutex);
    g_keyCache[CacheKey(path)] = CachedKey{stored, key};
    return key;
}

Bytes LoadOrCreateKey(const paths::fs::path& dataDir) {
    const paths::fs::path path = paths::MasterKeyPath(dataDir);
    if (paths::fs::exists(path)) {
        if (const std::optional<Bytes> key = ReadMasterKey(path)) return *key;
        throw std::runtime_error("master key is unreadable");
    }

    const Bytes key = util::RandomBytes(kKeyBytes);
    const std::string stored = std::string(kKeyPrefix) + util::Base64Encode(crypto::ProtectForUser(key));
    util::WriteFileAtomically(path, stored);

    std::lock_guard lock(g_cacheMutex);
    g_keyCache[CacheKey(path)] = CachedKey{stored, key};
    return key;
}

}  // namespace

std::string SealJson(const paths::fs::path& dataDir, const nlohmann::json& value) {
    const Bytes key = LoadOrCreateKey(dataDir);
    const Bytes iv = util::RandomBytes(kIvBytes);
    const Bytes plain = util::ToBytes(value.dump());

    Bytes tag;
    const Bytes cipher = crypto::AesGcmEncrypt(key, iv, plain, tag);
    return util::Base64Encode(util::Concat({&iv, &tag, &cipher}));
}

std::optional<nlohmann::json> OpenJson(const paths::fs::path& dataDir, const std::string& blob) {
    try {
        const paths::fs::path path = paths::MasterKeyPath(dataDir);
        if (!paths::fs::exists(path)) return std::nullopt;
        const std::optional<Bytes> key = ReadMasterKey(path);
        if (!key) return std::nullopt;

        const Bytes packed = util::Base64Decode(blob);
        if (packed.size() < kIvBytes + kTagBytes + 1) return std::nullopt;

        const Bytes iv(packed.begin(), packed.begin() + kIvBytes);
        const Bytes tag(packed.begin() + kIvBytes, packed.begin() + kIvBytes + kTagBytes);
        const Bytes cipher(packed.begin() + kIvBytes + kTagBytes, packed.end());

        const std::optional<Bytes> plain = crypto::AesGcmDecrypt(*key, iv, tag, cipher);
        if (!plain) return std::nullopt;

        nlohmann::json value = nlohmann::json::parse(util::ToString(*plain), nullptr, false);
        if (value.is_discarded()) return std::nullopt;
        return value;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

void WriteSealed(const paths::fs::path& dataDir, const paths::fs::path& path, const nlohmann::json& value) {
    util::WriteFileAtomically(path, SealJson(dataDir, value));
}

std::optional<nlohmann::json> ReadSealed(const paths::fs::path& dataDir, const paths::fs::path& path) {
    const std::optional<std::string> text = util::ReadTextFile(path);
    if (!text) return std::nullopt;
    const std::string blob = util::Trim(*text);
    if (blob.empty()) return std::nullopt;
    return OpenJson(dataDir, blob);
}

}  // namespace tvm::vault
