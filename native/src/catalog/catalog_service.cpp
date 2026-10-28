#include "catalog/catalog_service.h"

#include <chrono>
#include <ctime>
#include <filesystem>
#include <cctype>
#include <future>
#include <utility>

#include <nlohmann/json.hpp>

#include "catalog/artwork.h"
#include "catalog/cinemeta.h"
#include "core/js.h"
#include "core/util.h"

namespace tvm::catalog {

namespace {

constexpr unsigned kFetchMs = 12000;
// One dead genre must not hold Home for the full catalogue timeout.
constexpr unsigned kGenreFetchMs = 4000;
constexpr long long kBundleTtlMs = 12LL * 60 * 1000;
constexpr long long kGenreTtlMs = 20LL * 60 * 1000;
constexpr long long kMetaTtlMs = 30LL * 60 * 1000;

long long NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// The year on this machine's clock, as getFullYear() reports it.
int CurrentLocalYear() {
    const std::time_t now = std::time(nullptr);
    std::tm local{};
    localtime_s(&local, &now);
    return local.tm_year + 1900;
}

// The first IMDb id in a string, lower-cased, or nothing.
std::string ImdbOf(const std::string& id) {
    return ImdbIdFrom(id);
}

nlohmann::json ItemsToJson(const std::vector<MediaItem>& items) {
    nlohmann::json array = nlohmann::json::array();
    for (const MediaItem& item : items) array.push_back(ToJson(item));
    return array;
}

std::vector<MediaItem> ItemsFromJson(const nlohmann::json* array) {
    std::vector<MediaItem> items;
    if (array == nullptr || !array->is_array()) return items;
    for (const auto& value : *array) {
        if (auto item = FromJson(value); item.has_value()) items.push_back(*item);
    }
    return items;
}

}  // namespace

Fetcher DefaultFetcher() {
    return [](const std::string& url, unsigned timeoutMs) {
        http::Options options;
        options.timeoutMs = timeoutMs;
        options.userAgent = "tvm-core";
        options.accept = "application/json";
        return http::Get(url, options);
    };
}

CatalogService::CatalogService(paths::fs::path dataDir, Fetcher fetch)
    : dataDir_(std::move(dataDir)), fetch_(std::move(fetch)) {}

std::vector<MediaItem> CatalogService::FetchCatalog(const std::string& path, const std::string& kind, unsigned timeoutMs) {
    const std::optional<http::Response> response = fetch_(std::string(kCinemetaBase) + path, timeoutMs);
    if (!response.has_value()) throw CatalogUnavailable();
    if (!response->ok()) return {};

    const nlohmann::json body = nlohmann::json::parse(response->body);
    std::vector<MediaItem> items;
    const auto metas = body.find("metas");
    if (metas == body.end() || !metas->is_array()) return items;
    for (const auto& meta : *metas) {
        if (auto item = MapMeta(meta, kind); item.has_value()) items.push_back(*item);
    }
    return items;
}

std::optional<CatalogBundle> CatalogService::ReadDisk() const {
    const std::optional<std::string> text = util::ReadTextFile(paths::CatalogCachePath(dataDir_));
    if (!text) return std::nullopt;
    const nlohmann::json parsed = nlohmann::json::parse(text->empty() ? "null" : *text, nullptr, false);
    if (!parsed.is_object()) return std::nullopt;
    const auto movies = parsed.find("moviesTop");
    if (movies == parsed.end() || !movies->is_array()) return std::nullopt;

    CatalogBundle bundle;
    bundle.moviesTop = ItemsFromJson(&*movies);
    bundle.seriesTop = ItemsFromJson(parsed.contains("seriesTop") ? &parsed["seriesTop"] : nullptr);
    bundle.moviesRated = ItemsFromJson(parsed.contains("moviesRated") ? &parsed["moviesRated"] : nullptr);
    bundle.seriesRated = ItemsFromJson(parsed.contains("seriesRated") ? &parsed["seriesRated"] : nullptr);
    bundle.recentTv = ItemsFromJson(parsed.contains("recentTv") ? &parsed["recentTv"] : nullptr);
    bundle.newFilms = ItemsFromJson(parsed.contains("newFilms") ? &parsed["newFilms"] : nullptr);
    bundle.catalog = ItemsFromJson(parsed.contains("catalog") ? &parsed["catalog"] : nullptr);
    return bundle;
}

void CatalogService::WriteDisk(const CatalogBundle& bundle) const {
    // The cache is optional, so a failed write is ignored, as it is in the Node core.
    try {
        nlohmann::ordered_json json;
        json["moviesTop"] = ItemsToJson(bundle.moviesTop);
        json["seriesTop"] = ItemsToJson(bundle.seriesTop);
        json["moviesRated"] = ItemsToJson(bundle.moviesRated);
        json["seriesRated"] = ItemsToJson(bundle.seriesRated);
        json["recentTv"] = ItemsToJson(bundle.recentTv);
        json["newFilms"] = ItemsToJson(bundle.newFilms);
        json["catalog"] = ItemsToJson(bundle.catalog);
        json["at"] = NowMs();
        util::WriteFileAtomically(paths::CatalogCachePath(dataDir_), json.dump());
    } catch (const std::exception&) {
        // Ignored: the catalogue still works without the cache.
    }
}

CatalogBundle CatalogService::Bundle() {
    {
        std::lock_guard lock(mutex_);
        if (bundle_.has_value() && NowMs() - bundle_->atMs < kBundleTtlMs) return bundle_->bundle;
    }

    // The disk copy is the fallback. It is also shown at once, aged so that the
    // network copy is preferred as soon as it arrives.
    std::optional<CatalogBundle> disk = ReadDisk();
    {
        std::lock_guard lock(mutex_);
        if (disk.has_value() && !bundle_.has_value()) {
            bundle_ = Timed{NowMs() - kBundleTtlMs / 2, *disk};
        }
    }

    try {
        auto moviesTop = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/movie/top.json", "movie", kFetchMs); });
        auto seriesTop = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/series/top.json", "series", kFetchMs); });
        auto moviesRated = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/movie/imdbRating.json", "movie", kFetchMs); });
        auto seriesRated = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/series/imdbRating.json", "series", kFetchMs); });
        auto recentTv = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/series/last-videos.json", "series", kFetchMs); });
        auto moviesSkip = std::async(std::launch::async, [this] { return FetchCatalog("/catalog/movie/top/skip=100.json", "movie", kFetchMs); });

        CatalogBundle data;
        data.moviesTop = moviesTop.get();
        data.seriesTop = seriesTop.get();
        data.moviesRated = moviesRated.get();
        data.seriesRated = seriesRated.get();
        data.recentTv = recentTv.get();
        const std::vector<MediaItem> skipped = moviesSkip.get();

        std::vector<MediaItem> movies = DedupeItems([&] {
            std::vector<MediaItem> all = data.moviesTop;
            all.insert(all.end(), skipped.begin(), skipped.end());
            return all;
        }());
        data.newFilms = FilterNewFilms(movies, CurrentLocalYear());

        std::vector<MediaItem> everything = movies;
        for (const auto* part : {&data.seriesTop, &data.moviesRated, &data.seriesRated, &data.recentTv}) {
            everything.insert(everything.end(), part->begin(), part->end());
        }
        data.catalog = DedupeItems(everything);

        {
            std::lock_guard lock(mutex_);
            bundle_ = Timed{NowMs(), data};
        }
        WriteDisk(data);
        return data;
    } catch (const std::exception&) {
        if (disk.has_value()) return *disk;
        throw CatalogUnavailable();
    }
}

std::vector<MediaItem> CatalogService::Genre(const std::string& kind, const std::string& genre) {
    const std::string key = kind + ":" + genre;
    {
        std::lock_guard lock(mutex_);
        const auto hit = genres_.find(key);
        if (hit != genres_.end() && NowMs() - hit->second.atMs < kGenreTtlMs) return hit->second.items;
    }

    try {
        const std::vector<MediaItem> items = FetchCatalog(
            "/catalog/" + kind + "/top/genre=" + js::EncodeUriComponent(genre) + ".json", kind, kGenreFetchMs);
        std::lock_guard lock(mutex_);
        genres_[key] = GenreEntry{NowMs(), items};
        return items;
    } catch (const std::exception&) {
        // A failed genre gives nothing and is not cached, so the next load retries it.
        return {};
    }
}

namespace {

// A request for one Cinemeta meta record. Nothing on any failure.
std::optional<TitleMeta> ReadMeta(Fetcher& fetch, const std::string& kind, const std::string& imdb) {
    try {
        const std::optional<http::Response> response =
            fetch(std::string(kCinemetaBase) + "/meta/" + kind + "/" + imdb + ".json", kFetchMs);
        if (!response.has_value() || !response->ok()) return std::nullopt;

        const nlohmann::json body = nlohmann::json::parse(response->body, nullptr, false);
        if (!body.is_object()) return std::nullopt;
        const auto meta = body.find("meta");
        if (meta == body.end() || !meta->is_object()) return std::nullopt;

        auto item = MapMeta(*meta, kind);
        if (!item.has_value()) return std::nullopt;

        TitleMeta result;
        result.item = *item;
        if (kind == "series") {
            const auto videos = meta->find("videos");
            result.children = MapVideos(*item, videos == meta->end() ? nullptr : &*videos);
        }
        return result;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

}  // namespace

std::optional<TitleMeta> CatalogService::Meta(const std::string& id) {
    const std::string imdb = ImdbOf(id);
    if (imdb.empty()) return std::nullopt;

    {
        std::lock_guard lock(mutex_);
        const auto hit = metas_.find(imdb);
        if (hit != metas_.end() && NowMs() - hit->second.atMs < kMetaTtlMs) return hit->second.meta;
    }

    // Cinemeta reuses some ids: the movie and the series can share one. The
    // series wins, as it does in the Node core.
    const std::optional<TitleMeta> movie = ReadMeta(fetch_, "movie", imdb);
    const std::optional<TitleMeta> series = ReadMeta(fetch_, "series", imdb);
    const std::optional<TitleMeta> picked = series.has_value() ? series : movie;
    if (!picked.has_value()) return std::nullopt;

    TitleMeta result = *picked;
    if (!result.children.empty()) {
        // Episode scores that Cinemeta lacks come from TVMaze.
        bool missing = false;
        for (const MediaItem& child : result.children) {
            if (child.rating.empty()) missing = true;
        }
        if (missing) {
            try {
                const auto lookup = fetch_(std::string(kTvmazeBase) + "/lookup/shows?imdb=" + js::EncodeUriComponent(imdb),
                                           kFetchMs);
                if (lookup.has_value() && lookup->ok()) {
                    const nlohmann::json show = nlohmann::json::parse(lookup->body, nullptr, false);
                    const auto showId = show.is_object() ? show.find("id") : show.end();
                    if (showId != show.end() && showId->is_number_integer()) {
                        const auto episodes = fetch_(
                            std::string(kTvmazeBase) + "/shows/" + std::to_string(showId->get<long long>()) + "/episodes",
                            kFetchMs);
                        if (episodes.has_value() && episodes->ok()) {
                            const nlohmann::json list = nlohmann::json::parse(episodes->body, nullptr, false);
                            result.children = ApplyEpisodeRatings(result.children, ParseTvmazeEpisodes(list));
                        }
                    }
                }
            } catch (const std::exception&) {
                // Missing scores are not an error; the episode list stands as it is.
            }
        }
    }

    std::lock_guard lock(mutex_);
    metas_[imdb] = MetaEntry{NowMs(), result};
    return result;
}

std::vector<MediaItem> CatalogService::Search(const std::string& query) {
    const std::string needle = util::Trim(query);
    if (needle.size() < 2) return {};
    const std::string encoded = js::EncodeUriComponent(needle);
    std::vector<MediaItem> movies = FetchCatalog("/catalog/movie/top/search=" + encoded + ".json", "movie", kFetchMs);
    std::vector<MediaItem> series = FetchCatalog("/catalog/series/top/search=" + encoded + ".json", "series", kFetchMs);
    movies.insert(movies.end(), series.begin(), series.end());
    return DedupeItems(movies);
}

void CatalogService::Clear() {
    {
        std::lock_guard lock(mutex_);
        bundle_.reset();
        genres_.clear();
        metas_.clear();
    }
    std::error_code ignored;
    std::filesystem::remove(paths::CatalogCachePath(dataDir_), ignored);
}

}  // namespace tvm::catalog
