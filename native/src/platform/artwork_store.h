#pragma once

// Artwork on disk. Each address is downloaded once into the cache folder and
// read from there afterwards, so Home and Details draw without the network. A
// file is named from a hash of its address, which keeps names short and safe.

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

#include "core/paths.h"

namespace tvm::platform {

class ArtworkStore {
public:
    explicit ArtworkStore(paths::fs::path cacheDir);

    // The cached file for `url`, when it has been downloaded. The answer is remembered, so a picture that is not
    // there yet costs no disk check on every frame it is drawn or laid out.
    std::optional<paths::fs::path> Lookup(const std::string& url) const;

    // Downloads `url` to the cache unless it is already there. Blocking: call it
    // from a worker thread. Returns true when the file is on disk afterwards.
    bool Fetch(const std::string& url);

    paths::fs::path FileFor(const std::string& url) const;

private:
    paths::fs::path cacheDir_;
    // Lookup runs on the window thread and on the workers, so the remembered answers are guarded.
    mutable std::mutex mutex_;
    mutable std::unordered_map<std::string, std::optional<paths::fs::path>> known_;
};

// FNV-1a over the address, as 16 hex digits. Stable across runs.
std::string ArtworkName(const std::string& url);

}  // namespace tvm::platform
