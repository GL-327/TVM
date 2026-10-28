#include "catalog/rails.h"

#include <future>
#include <set>
#include <string>
#include <utility>

#include "catalog/cinemeta.h"
#include "catalog/recommend.h"

namespace tvm::catalog {

namespace {

constexpr std::size_t kRailLimit = 16;
constexpr std::size_t kBecauseLimit = 12;

}  // namespace

std::vector<HomeRail> BuildHomeRails(const CatalogBundle& bundle, const std::vector<GenreShelf>& shelves,
                                     const std::vector<MediaItem>& watching, const std::vector<MediaItem>& watchlist,
                                     int currentYear) {
    // The shelves above the catalogue already hold these titles, so they stay off every rail below.
    std::set<std::string> used;
    MarkUsed(used, watching);
    MarkUsed(used, watchlist);

    // The history "You might like" is scored from: the watchlist, then what is in progress.
    std::vector<MediaItem> history = watchlist;
    history.insert(history.end(), watching.begin(), watching.end());

    std::vector<HomeRail> rails;
    const auto add = [&rails](std::string id, std::string title, std::vector<MediaItem> items) {
        if (!items.empty()) rails.push_back(HomeRail{std::move(id), std::move(title), std::move(items)});
    };

    std::vector<MediaItem> forYou = PickYouMightLike(bundle.catalog, history, used, kRailLimit, currentYear);
    MarkUsed(used, forYou);
    add("for-you", "You might like", std::move(forYou));

    add("films", "Popular films", TakeUnused(bundle.moviesTop, used, kRailLimit));
    add("series", "Popular series", TakeUnused(bundle.seriesTop, used, kRailLimit));
    add("new-films", "New films", TakeUnused(bundle.newFilms, used, kRailLimit));
    add("new-series", "Recently updated", TakeUnused(bundle.recentTv, used, kRailLimit));

    // "Because you watched" follows the title that is first on Continue watching.
    const MediaItem* source = watching.empty() ? nullptr : &watching.front();
    std::vector<MediaItem> because = BecauseYouWatched(source, bundle.catalog, used, kBecauseLimit);
    MarkUsed(used, because);
    if (source != nullptr) add("because", "Because you watched " + source->title, std::move(because));

    for (const GenreRail& rail : GenreRails()) {
        for (const GenreShelf& shelf : shelves) {
            if (shelf.genre != rail.genre) continue;
            add(rail.id, rail.title, InterleaveUnused(shelf.movies, shelf.shows, used, kRailLimit));
            break;
        }
    }
    return rails;
}

std::vector<GenreShelf> FetchGenreShelves(CatalogService& service) {
    // One rail's requests run together, as Promise.all does in the web core.
    std::vector<std::future<GenreShelf>> pending;
    for (const GenreRail& rail : GenreRails()) {
        pending.push_back(std::async(std::launch::async, [&service, genre = std::string(rail.genre)] {
            GenreShelf shelf;
            shelf.genre = genre;
            shelf.movies = service.Genre("movie", genre);
            for (const std::string& series : SeriesGenresForRail(genre)) {
                const std::vector<MediaItem> items = service.Genre("series", series);
                shelf.shows.insert(shelf.shows.end(), items.begin(), items.end());
            }
            shelf.shows = DedupeItems(shelf.shows);
            return shelf;
        }));
    }
    std::vector<GenreShelf> shelves;
    for (auto& future : pending) shelves.push_back(future.get());
    return shelves;
}

}  // namespace tvm::catalog
