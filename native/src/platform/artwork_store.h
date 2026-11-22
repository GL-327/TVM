#pragma once

// Artwork on disk. Each address is downloaded once into the cache folder and
// read from there afterwards, so Home and Details draw without the network. A
// file is named from a hash of its address, which keeps names short and safe.

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/paths.h"

namespace tvm::platform {

// What a download came to.
enum class FetchResult {
    // On disk now, or already was.
    Stored,
    // The server says there is no such picture (404 or 410), or the address is not a web address.
    Missing,
    // A timeout, a server error, or a body that is not a picture: worth trying again later.
    Failed,
};

class ArtworkStore {
public:
    explicit ArtworkStore(paths::fs::path cacheDir);

    // The cached file for `url`, when it has been downloaded. The answer is remembered, so a picture that is not
    // there yet costs no disk check on every frame it is drawn or laid out.
    std::optional<paths::fs::path> Lookup(const std::string& url) const;

    // Downloads `url` to the cache unless it is already there. Blocking: call it
    // from a worker thread. Only a body that starts like a picture is kept.
    FetchResult Fetch(const std::string& url);

    // Drops a cached file that turned out not to decode, so the next request downloads it again. Returns the
    // address the file was for, when it is known.
    std::optional<std::string> Forget(const paths::fs::path& file);

    // Painting asks for pictures it has no file for yet. The window thread collects them each frame and queues the
    // downloads, so whatever is on screen is fetched first and a failed picture is asked for again.
    void Want(const std::string& url) const;
    std::vector<std::string> TakeWanted() const;

    paths::fs::path FileFor(const std::string& url) const;

private:
    paths::fs::path cacheDir_;
    // Lookup runs on the window thread and on the workers, so the remembered answers are guarded.
    mutable std::mutex mutex_;
    mutable std::unordered_map<std::string, std::optional<paths::fs::path>> known_;
    // Cached file name back to its address, for Forget.
    mutable std::unordered_map<std::wstring, std::string> urls_;
    mutable std::vector<std::string> wanted_;
    mutable std::unordered_set<std::string> wantedSet_;
};

// FNV-1a over the address, as 16 hex digits. Stable across runs.
std::string ArtworkName(const std::string& url);

// True when `body` starts with the signature of a picture format Windows can decode: JPEG, PNG, GIF, BMP, WebP,
// ICO, or the HEIF/AVIF family. An HTML error page or an SVG is not a picture.
bool LooksLikePicture(const std::string& body);

}  // namespace tvm::platform
