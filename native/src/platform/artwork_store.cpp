#include "platform/artwork_store.h"

#include <cstdint>

#include "core/http.h"
#include "core/util.h"

namespace tvm::platform {

namespace {

// Pictures are small, so a larger body is refused rather than cached.
constexpr std::size_t kMaxArtworkBytes = 8 * 1024 * 1024;
constexpr unsigned kArtworkTimeoutMs = 12000;

}  // namespace

std::string ArtworkName(const std::string& url) {
    std::uint64_t hash = 1469598103934665603ULL;
    for (unsigned char c : url) {
        hash ^= c;
        hash *= 1099511628211ULL;
    }
    static constexpr char kHex[] = "0123456789abcdef";
    std::string name(16, '0');
    for (int i = 15; i >= 0; --i) {
        name[static_cast<std::size_t>(i)] = kHex[hash & 0xF];
        hash >>= 4;
    }
    return name;
}

ArtworkStore::ArtworkStore(paths::fs::path cacheDir) : cacheDir_(std::move(cacheDir)) {}

paths::fs::path ArtworkStore::FileFor(const std::string& url) const {
    return cacheDir_ / util::ToWide(ArtworkName(url) + ".img");
}

std::optional<paths::fs::path> ArtworkStore::Lookup(const std::string& url) const {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto found = known_.find(url);
        if (found != known_.end()) return found->second;
    }
    const paths::fs::path file = FileFor(url);
    std::error_code ignored;
    const std::optional<paths::fs::path> answer =
        paths::fs::exists(file, ignored) ? std::optional<paths::fs::path>(file) : std::nullopt;
    std::lock_guard<std::mutex> lock(mutex_);
    known_[url] = answer;
    return answer;
}

bool ArtworkStore::Fetch(const std::string& url) {
    if (!http::IsWebUrl(url)) return false;
    if (Lookup(url).has_value()) return true;

    http::Options options;
    options.timeoutMs = kArtworkTimeoutMs;
    options.accept = "image/*";
    options.maxBytes = kMaxArtworkBytes;
    const std::optional<http::Response> response = http::Get(url, options);
    if (!response.has_value() || !response->ok() || response->body.empty()) return false;

    try {
        util::WriteFileAtomically(FileFor(url), response->body);
    } catch (const std::exception&) {
        return false;
    }
    // The picture is on disk now, so later lookups must find it rather than the "not there" remembered before.
    std::lock_guard<std::mutex> lock(mutex_);
    known_[url] = FileFor(url);
    return true;
}

}  // namespace tvm::platform
