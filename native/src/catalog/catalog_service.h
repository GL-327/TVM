#pragma once

// The catalogue: the Cinemeta bundle behind Home, genre rails, title details
// and search. Each lookup has the same timeouts and cache lifetimes as the Node
// core. The bundle is cached on disk in cache/catalog.json, in the same format,
// so either core can show the catalogue when the network is down.
//
// The network is reached through a Fetcher, so tests replay canned responses.

#include <functional>
#include <mutex>
#include <optional>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "catalog/media_item.h"
#include "core/http.h"
#include "core/paths.h"

namespace tvm::catalog {

// Returns the response, or nothing when the request failed to complete.
using Fetcher = std::function<std::optional<http::Response>(const std::string& url, unsigned timeoutMs)>;

// The request could not complete and no cached copy is available.
class CatalogUnavailable : public std::runtime_error {
public:
    CatalogUnavailable() : std::runtime_error("catalog-unavailable") {}
};

struct CatalogBundle {
    std::vector<MediaItem> moviesTop;
    std::vector<MediaItem> seriesTop;
    std::vector<MediaItem> moviesRated;
    std::vector<MediaItem> seriesRated;
    std::vector<MediaItem> recentTv;
    std::vector<MediaItem> newFilms;
    std::vector<MediaItem> catalog;

    bool operator==(const CatalogBundle&) const = default;
};

struct TitleMeta {
    MediaItem item;
    std::vector<MediaItem> children;

    bool operator==(const TitleMeta&) const = default;
};

Fetcher DefaultFetcher();

class CatalogService {
public:
    explicit CatalogService(paths::fs::path dataDir, Fetcher fetch = DefaultFetcher());

    // Home's catalogue. Throws CatalogUnavailable when there is neither a
    // network answer nor a cached copy.
    CatalogBundle Bundle();

    // Titles for one genre. A failed request gives nothing, and is not cached.
    std::vector<MediaItem> Genre(const std::string& kind, const std::string& genre);

    // The movie or series with this IMDb id, with its episodes. Nothing when
    // Cinemeta has neither.
    std::optional<TitleMeta> Meta(const std::string& id);

    std::vector<MediaItem> Search(const std::string& query);

    // Forgets the memory caches and deletes the disk cache.
    void Clear();

private:
    struct Timed {
        long long atMs;
        CatalogBundle bundle;
    };

    std::vector<MediaItem> FetchCatalog(const std::string& path, const std::string& kind, unsigned timeoutMs);
    std::optional<CatalogBundle> ReadDisk() const;
    void WriteDisk(const CatalogBundle& bundle) const;

    paths::fs::path dataDir_;
    Fetcher fetch_;
    std::mutex mutex_;
    std::optional<Timed> bundle_;
    struct GenreEntry {
        long long atMs;
        std::vector<MediaItem> items;
    };
    std::map<std::string, GenreEntry> genres_;
    struct MetaEntry {
        long long atMs;
        TitleMeta meta;
    };
    std::map<std::string, MetaEntry> metas_;
};

}  // namespace tvm::catalog
