#pragma once

// What the screens show of the catalogue. The screens never see the network
// or the JSON; they see these plain values, converted here.

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "catalog/catalog_service.h"
#include "catalog/progress.h"
#include "catalog/rails.h"
#include "catalog/watchlist.h"
#include "ui/scene.h"

namespace tvm::ui {

// A title's details, as the details screen shows them.
struct TitleInfo {
    enum class State {
        Loading,
        Ready,
        Unavailable,
    };

    State state = State::Loading;
    std::string id;
    std::string title;
    std::string kind;  // "movie" or "series"
    std::optional<int> year;
    std::string rating;
    std::optional<std::string> runtime;
    std::vector<std::string> genres;
    std::string synopsis;
    std::string posterUrl;
    std::string backdropUrl;
    std::size_t episodes = 0;
    // A series' episodes, sorted by season then number, as Cinemeta lists them.
    std::vector<catalog::MediaItem> children;
    // The title as the catalogue has it, which is what the watchlist keeps. Empty until the details load.
    catalog::MediaItem media;
    // Whether the title is on the viewer's watchlist.
    bool saved = false;
};

// Home's rails as the scene shows them.
std::vector<RailData> RailsFromCatalog(const std::vector<catalog::HomeRail>& rails);

// The details of a title. A title with no metadata is Unavailable.
TitleInfo InfoFromMeta(const std::string& id, const std::optional<catalog::TitleMeta>& meta);

// The Continue watching shelf: titles in progress, each with its share watched.
RailData ContinueWatchingRail(const std::vector<catalog::ProgressItem>& items);

// The Watchlist shelf, in the order the titles were saved.
RailData WatchlistRail(const std::vector<catalog::WatchlistEntry>& entries);

}  // namespace tvm::ui
