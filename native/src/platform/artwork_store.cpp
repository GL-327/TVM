#include "platform/artwork_store.h"

#include <cstdint>
#include <cstring>

#include "core/http.h"
#include "core/util.h"

namespace tvm::platform {

namespace {

// Pictures are small, so a larger body is refused rather than cached.
constexpr std::size_t kMaxArtworkBytes = 8 * 1024 * 1024;
constexpr unsigned kArtworkTimeoutMs = 15000;
// Painting can ask for many pictures in one frame; the window thread takes them all each frame anyway.
constexpr std::size_t kMaxWanted = 512;

bool StartsWith(const std::string& body, const char* signature, std::size_t length, std::size_t at = 0) {
    return body.size() >= at + length && std::memcmp(body.data() + at, signature, length) == 0;
}

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

bool LooksLikePicture(const std::string& body) {
    return StartsWith(body, "\xFF\xD8\xFF", 3) ||                                // JPEG
           StartsWith(body, "\x89PNG\r\n\x1A\n", 8) ||                           // PNG
           StartsWith(body, "GIF87a", 6) || StartsWith(body, "GIF89a", 6) ||     // GIF
           StartsWith(body, "BM", 2) ||                                          // BMP
           (StartsWith(body, "RIFF", 4) && StartsWith(body, "WEBP", 4, 8)) ||    // WebP
           StartsWith(body, "\x00\x00\x01\x00", 4) ||                            // ICO
           StartsWith(body, "ftyp", 4, 4);                                       // HEIF, AVIF
}

ArtworkStore::ArtworkStore(paths::fs::path cacheDir) : cacheDir_(std::move(cacheDir)) {}

paths::fs::path ArtworkStore::FileFor(const std::string& url) const {
    return cacheDir_ / util::ToWide(ArtworkName(url) + ".img");
}

std::optional<paths::fs::path> ArtworkStore::Lookup(const std::string& url) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto found = known_.find(url);
    if (found != known_.end()) return found->second;
    // Checked under the lock, so a download finishing on a worker cannot be overwritten with "not there".
    const paths::fs::path file = FileFor(url);
    std::error_code ignored;
    const std::optional<paths::fs::path> answer =
        paths::fs::exists(file, ignored) ? std::optional<paths::fs::path>(file) : std::nullopt;
    known_[url] = answer;
    urls_[file.wstring()] = url;
    return answer;
}

FetchResult ArtworkStore::Fetch(const std::string& url) {
    if (!http::IsWebUrl(url)) return FetchResult::Missing;
    if (Lookup(url).has_value()) return FetchResult::Stored;

    http::Options options;
    options.timeoutMs = kArtworkTimeoutMs;
    options.accept = "image/*";
    options.maxBytes = kMaxArtworkBytes;
    const std::optional<http::Response> response = http::Get(url, options);
    if (!response.has_value()) return FetchResult::Failed;
    if (response->status == 404 || response->status == 410) return FetchResult::Missing;
    if (!response->ok() || response->body.empty()) return FetchResult::Failed;
    // A captive portal, a CDN error page or a truncated body is not cached: it would never decode, and it would
    // stop the real picture from ever being fetched.
    if (!LooksLikePicture(response->body)) return FetchResult::Failed;

    try {
        util::WriteFileAtomically(FileFor(url), response->body);
    } catch (const std::exception&) {
        return FetchResult::Failed;
    }
    // The picture is on disk now, so later lookups must find it rather than the "not there" remembered before.
    std::lock_guard<std::mutex> lock(mutex_);
    known_[url] = FileFor(url);
    urls_[FileFor(url).wstring()] = url;
    return FetchResult::Stored;
}

std::optional<std::string> ArtworkStore::Forget(const paths::fs::path& file) {
    std::error_code ignored;
    paths::fs::remove(file, ignored);
    std::lock_guard<std::mutex> lock(mutex_);
    const auto url = urls_.find(file.wstring());
    if (url == urls_.end()) return std::nullopt;
    known_[url->second] = std::nullopt;
    return url->second;
}

void ArtworkStore::Want(const std::string& url) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (wanted_.size() >= kMaxWanted || !wantedSet_.insert(url).second) return;
    wanted_.push_back(url);
}

std::vector<std::string> ArtworkStore::TakeWanted() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> taken;
    taken.swap(wanted_);
    wantedSet_.clear();
    return taken;
}

}  // namespace tvm::platform
