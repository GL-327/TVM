#pragma once

// The service hubs: Netflix, Prime Video, HBO Max, Apple TV, Disney+, Hulu and Peacock as TVM catalogues,
// each in its own colours, from apps/core/src/providers/apps.ts and hubSeeds.ts. They are not the licensed
// apps: every title plays through TVM Stream and Real-Debrid.
//
// A hub's rails are its originals (series in the catalogue whose network TVMaze names as the service, then
// the seed list), its films and its series (the seed lists), Trending Now and Because you watched. The Node
// core also asks TMDB for each service's titles when a TMDB key is set; this build uses the seed lists only.

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "catalog/catalog_service.h"
#include "catalog/media_item.h"
#include "core/http.h"

namespace tvm::hubs {

struct Spec {
    std::string id;
    std::string name;
    std::string wordmark;
    std::uint32_t accent = 0;
    std::vector<std::string> networks;
    std::vector<std::string> originals;
    std::vector<std::string> movies;
    std::vector<std::string> series;
};

struct Rail {
    std::string id;
    std::string title;
    std::vector<catalog::MediaItem> items;
};

struct Hub {
    std::string id;
    std::string name;
    std::string wordmark;
    std::uint32_t accent = 0;
    std::string disclaimer;
    std::optional<catalog::MediaItem> hero;
    std::vector<Rail> rails;
};

// The seven hubs, in the order the Apps grid shows them.
const std::vector<Spec>& Specs();
const Spec* Find(const std::string& id);

// Whether TVMaze's show names this service as its network or web channel, as matchStudio checks.
bool MatchStudio(const nlohmann::json& show, const std::vector<std::string>& networks);

// Builds a hub. Blocks on the network: Cinemeta for each seed, and TVMaze for the catalogue's series.
// `watching` is the viewer's Continue watching, kept for titles that belong to this hub. Without
// `matchNetworks` TVMaze is not asked, so the hub is ready in seconds from the seed lists alone. Never throws.
Hub Build(const Spec& spec, catalog::CatalogService& catalog, const http::Transport& transport,
          const std::vector<catalog::MediaItem>& watching, bool matchNetworks = true);

}  // namespace tvm::hubs
