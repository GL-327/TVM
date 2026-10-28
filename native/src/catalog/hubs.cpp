#include "catalog/hubs.h"

#include <algorithm>
#include <cctype>
#include <future>
#include <set>

#include <nlohmann/json.hpp>

namespace tvm::hubs {

namespace {

constexpr char kTvMaze[] = "https://api.tvmaze.com";
constexpr std::size_t kRailSize = 16;
// The catalogue's series asked of TVMaze, and the originals that are enough.
constexpr std::size_t kCandidates = 40;
constexpr std::size_t kMatchedEnough = 12;

std::string Lower(std::string text) {
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

// One copy of each title, by id and by name, as uniqueItems keeps them.
std::vector<catalog::MediaItem> Unique(const std::vector<catalog::MediaItem>& items) {
    std::set<std::string> seen;
    std::vector<catalog::MediaItem> out;
    for (catalog::MediaItem item : items) {
        if (seen.contains(item.id) || seen.contains(Lower(item.title))) continue;
        seen.insert(item.id);
        seen.insert(Lower(item.title));
        item.playable = true;
        out.push_back(std::move(item));
    }
    return out;
}

std::vector<catalog::MediaItem> Take(const std::vector<catalog::MediaItem>& items, std::size_t count) {
    return std::vector<catalog::MediaItem>(items.begin(), items.begin() + static_cast<std::ptrdiff_t>(std::min(count, items.size())));
}

// Runs `work` for 0..count-1, a few at a time, and returns the answers in order. One at a time a hub takes half
// a minute to open; Promise.all in the Node core asks for them together.
template <typename T>
std::vector<T> InParallel(std::size_t count, const std::function<T(std::size_t)>& work) {
    constexpr std::size_t kAtOnce = 8;
    std::vector<T> out(count);
    for (std::size_t start = 0; start < count; start += kAtOnce) {
        std::vector<std::future<T>> batch;
        for (std::size_t i = start; i < std::min(count, start + kAtOnce); ++i) batch.push_back(std::async(std::launch::async, work, i));
        for (std::size_t i = 0; i < batch.size(); ++i) out[start + i] = batch[i].get();
    }
    return out;
}

// The titles behind a list of IMDb ids. A title Cinemeta does not know is left out.
std::vector<catalog::MediaItem> Hydrate(catalog::CatalogService& catalog, const std::vector<std::string>& ids) {
    const std::vector<std::optional<catalog::MediaItem>> found =
        InParallel<std::optional<catalog::MediaItem>>(ids.size(), [&](std::size_t i) -> std::optional<catalog::MediaItem> {
            try {
                if (const std::optional<catalog::TitleMeta> meta = catalog.Meta(ids[i])) return meta->item;
            } catch (const std::exception&) {
                // Cinemeta did not answer for this one; the rail goes on without it.
            }
            return std::nullopt;
        });
    std::vector<catalog::MediaItem> items;
    for (const std::optional<catalog::MediaItem>& item : found) {
        if (item.has_value()) items.push_back(*item);
    }
    return Unique(items);
}

}  // namespace

const std::vector<Spec>& Specs() {
    // HUBS in apps.ts and HUB_SEEDS in hubSeeds.ts, copied as they are.
    static const std::vector<Spec> specs = {
        {"netflix", "Netflix", "NETFLIX", 0xe50914, {"netflix"},
         {"tt4574334", "tt0903747", "tt5180504", "tt5753856", "tt2085059", "tt6468322", "tt10986410", "tt11126994", "tt1312171", "tt4786824", "tt2442560", "tt8111088"},
         {"tt1375666", "tt0816692", "tt0468569", "tt0137523", "tt0114369", "tt0172495", "tt0482571", "tt1853728", "tt0993846", "tt1392190", "tt2267998", "tt2543164"},
         {"tt0944947", "tt0903747", "tt0773262", "tt0386676", "tt1475582", "tt0413573", "tt0108773", "tt4574334", "tt3032476", "tt2442560"}},
        {"prime", "Prime Video", "prime video", 0x00a8e1, {"amazon", "prime video", "amazon prime"},
         {"tt8111088", "tt2306299", "tt1190634", "tt2085059", "tt1312171", "tt1844624", "tt3032476", "tt3006802"},
         {"tt1160419", "tt10872600", "tt1825683", "tt4154796", "tt4154756", "tt3498820", "tt1843866", "tt0848228", "tt0371746", "tt1228705"},
         {"tt2306299", "tt1190634", "tt8111088", "tt3006802", "tt1844624", "tt0412142", "tt11280740", "tt13443470"}},
        {"max", "HBO Max", "max", 0x002be7, {"max", "hbo max", "hbo"},
         {"tt0903747", "tt0944947", "tt7660850", "tt11198330", "tt3581920", "tt0386676", "tt2442560", "tt11280740"},
         {"tt0468569", "tt1345836", "tt0372784", "tt6723592", "tt1853728", "tt0110912", "tt0137523", "tt0114369", "tt7286456", "tt15398776"},
         {"tt0944947", "tt0903747", "tt7660850", "tt11198330", "tt3581920", "tt2442560", "tt11280740", "tt3032476"}},
        {"appletv", "Apple TV", "tv+", 0x141414, {"apple tv+", "apple tv"},
         {"tt10986410", "tt9737326", "tt1312171", "tt1190634", "tt2085059", "tt11198330", "tt3581920", "tt11280740"},
         {"tt15398776", "tt1160419", "tt6723592", "tt1745960", "tt1630029", "tt10872600", "tt9114286", "tt10648342"},
         {"tt10986410", "tt9737326", "tt11198330", "tt3581920", "tt1190634", "tt2085059", "tt1312171", "tt11280740"}},
        {"disney", "Disney+", "disney+", 0x113c8c, {"disney+", "disney plus", "disney"},
         {"tt13622776", "tt1312171", "tt8111088", "tt5196754", "tt10986410", "tt4687880"},
         {"tt4154796", "tt4154756", "tt1825683", "tt3498820", "tt1843866", "tt0848228", "tt0371746", "tt1228705", "tt0800369", "tt0458339", "tt9114286", "tt10648342", "tt10872600", "tt1630029"},
         {"tt13622776", "tt1312171", "tt8111088", "tt5196754", "tt4687880", "tt4574334"}},
        {"hulu", "Hulu", "hulu", 0x1ce783, {"hulu"},
         {"tt2442560", "tt3032476", "tt1844624", "tt11280740", "tt1312171", "tt0773262"},
         {"tt2267998", "tt0993846", "tt1853728", "tt1392190", "tt2543164", "tt0482571", "tt0172495", "tt0114369"},
         {"tt2442560", "tt3032476", "tt1844624", "tt11280740", "tt0773262", "tt0413573", "tt0108773", "tt0386676"}},
        {"peacock", "Peacock", "peacock", 0x000000, {"peacock"},
         {"tt1312171", "tt1844624", "tt0386676", "tt0108773", "tt0773262", "tt0412142"},
         {"tt0120737", "tt0167260", "tt0167261", "tt1201607", "tt0330373", "tt0304141", "tt0241527", "tt0295297"},
         {"tt0386676", "tt0108773", "tt0773262", "tt0412142", "tt1844624", "tt1312171", "tt0944947", "tt0903747"}},
    };
    return specs;
}

const Spec* Find(const std::string& id) {
    for (const Spec& spec : Specs()) {
        if (spec.id == id) return &spec;
    }
    return nullptr;
}

bool MatchStudio(const nlohmann::json& show, const std::vector<std::string>& networks) {
    if (!show.is_object()) return false;
    std::string haystack;
    for (const char* key : {"webChannel", "network"}) {
        const auto found = show.find(key);
        if (found == show.end() || !found->is_object()) continue;
        const auto name = found->find("name");
        if (name == found->end() || !name->is_string()) continue;
        if (!haystack.empty()) haystack += " | ";
        haystack += Lower(name->get<std::string>());
    }
    if (haystack.empty()) return false;
    return std::any_of(networks.begin(), networks.end(),
                       [&](const std::string& needle) { return haystack.find(Lower(needle)) != std::string::npos; });
}

Hub Build(const Spec& spec, catalog::CatalogService& catalog, const http::Transport& transport,
          const std::vector<catalog::MediaItem>& watching, bool matchNetworks) {
    // Originals: the catalogue's series whose network is this service, then the seed list.
    std::vector<catalog::MediaItem> originals;
    if (matchNetworks) try {
        const catalog::CatalogBundle bundle = catalog.Bundle();
        std::set<std::string> seen;
        std::vector<catalog::MediaItem> candidates;
        for (const auto* list : {&bundle.seriesTop, &bundle.seriesRated, &bundle.recentTv, &bundle.catalog}) {
            for (const catalog::MediaItem& item : *list) {
                if (item.kind != "series" || !seen.insert(item.id).second) continue;
                candidates.push_back(item);
            }
        }
        http::Options options;
        options.accept = "application/json";
        options.timeoutMs = 8000;
        candidates.resize(std::min(candidates.size(), kCandidates));
        const std::vector<char> matched = InParallel<char>(candidates.size(), [&](std::size_t i) -> char {
            const std::string& id = candidates[i].id;
            const std::size_t at = Lower(id).find("tt");
            if (at == std::string::npos) return 0;
            std::size_t end = at + 2;
            while (end < id.size() && std::isdigit(static_cast<unsigned char>(id[end]))) ++end;
            const std::optional<http::Response> answer =
                transport(std::string(kTvMaze) + "/lookup/shows?imdb=" + id.substr(at, end - at), options);
            if (!answer.has_value() || !answer->ok()) return 0;
            return MatchStudio(nlohmann::json::parse(answer->body, nullptr, false), spec.networks) ? 1 : 0;
        });
        for (std::size_t i = 0; i < candidates.size() && originals.size() < kMatchedEnough; ++i) {
            if (matched[i] != 0) originals.push_back(candidates[i]);
        }
    } catch (const std::exception&) {
        originals.clear();
    }
    // The three seed lists are asked for together.
    auto seededAsk = std::async(std::launch::async, [&] { return Hydrate(catalog, spec.originals); });
    auto moviesAsk = std::async(std::launch::async, [&] { return Hydrate(catalog, spec.movies); });
    const std::vector<catalog::MediaItem> series = Hydrate(catalog, spec.series);
    const std::vector<catalog::MediaItem> seeded = seededAsk.get();
    const std::vector<catalog::MediaItem> movies = moviesAsk.get();
    originals.insert(originals.end(), seeded.begin(), seeded.end());
    originals = Unique(originals);

    std::vector<catalog::MediaItem> pool = originals;
    pool.insert(pool.end(), movies.begin(), movies.end());
    pool.insert(pool.end(), series.begin(), series.end());
    pool = Unique(pool);

    Hub hub;
    hub.id = spec.id;
    hub.name = spec.name;
    hub.wordmark = spec.wordmark;
    hub.accent = spec.accent;
    hub.disclaimer = "Not the licensed " + spec.name + " app. Playback uses TVM Stream / Real-Debrid.";
    const auto withArt = std::find_if(pool.begin(), pool.end(), [](const catalog::MediaItem& item) { return !item.backdrop.empty(); });
    if (withArt != pool.end()) hub.hero = *withArt;
    else if (!pool.empty()) hub.hero = pool.front();

    // Continue watching keeps the titles that belong to this hub, by their series.
    std::set<std::string> ids;
    for (const catalog::MediaItem& item : pool) ids.insert(item.id.substr(0, item.id.find(':')));
    std::vector<catalog::MediaItem> continuing;
    for (const catalog::MediaItem& item : watching) {
        if (ids.contains(item.id.substr(0, item.id.find(':'))) && continuing.size() < 12) continuing.push_back(item);
    }
    if (!continuing.empty()) hub.rails.push_back({spec.id + "-continue", "Continue Watching", continuing});
    if (!originals.empty()) hub.rails.push_back({spec.id + "-series", spec.name + " originals", Take(originals, kRailSize)});
    if (!movies.empty()) hub.rails.push_back({spec.id + "-films", "Popular films", Take(movies, kRailSize)});
    if (!series.empty()) hub.rails.push_back({spec.id + "-shows", "Popular series", Take(series, kRailSize)});
    if (pool.size() > 4) hub.rails.push_back({spec.id + "-trending", "Trending Now", Take(pool, kRailSize)});
    if (movies.size() > 2 && !series.empty()) {
        std::vector<catalog::MediaItem> mixed = Take(series, 8);
        const std::vector<catalog::MediaItem> films = Take(movies, 8);
        mixed.insert(mixed.end(), films.begin(), films.end());
        hub.rails.push_back({spec.id + "-because", "Because you watched", Take(Unique(mixed), kRailSize)});
    }
    return hub;
}

}  // namespace tvm::hubs
