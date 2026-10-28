#pragma once

// Home's catalogue rails. Ported from buildRails in apps/core/src/providers/media.ts.
// The Continue watching and Watchlist shelves are not here: they come from the
// viewer's progress and list, and the app builds them (see ui/catalog_view).

#include <string>
#include <vector>

#include "catalog/catalog_service.h"
#include "catalog/media_item.h"

namespace tvm::catalog {

struct HomeRail {
    std::string id;
    std::string title;
    std::vector<MediaItem> items;
};

// The titles for one genre, movies and series combined.
struct GenreShelf {
    std::string genre;
    std::vector<MediaItem> movies;
    std::vector<MediaItem> shows;
};

// The catalogue rails in the order Home shows them: You might like, popular films
// and series, new films and series, Because you watched, then the genre rails.
// `watching` and `watchlist` are the titles already on the Continue watching and
// Watchlist shelves. They are marked used first, so no title appears twice.
std::vector<HomeRail> BuildHomeRails(const CatalogBundle& bundle, const std::vector<GenreShelf>& shelves,
                                     const std::vector<MediaItem>& watching, const std::vector<MediaItem>& watchlist,
                                     int currentYear);

// Fetches the movies and series for every genre rail, in the order of GenreRails().
std::vector<GenreShelf> FetchGenreShelves(CatalogService& service);

}  // namespace tvm::catalog
