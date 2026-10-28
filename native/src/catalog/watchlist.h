#pragma once

// The viewer's saved titles, newest first, in the active profile's watchlist.json.
// Ported from apps/core/src/providers/watchlist.ts. The file keeps the fields the
// Node core keeps, and the same cap of 200 titles.

#include <string>
#include <vector>

#include "catalog/media_item.h"
#include "core/paths.h"

namespace tvm::catalog {

struct WatchlistEntry {
    MediaItem item;
    // When the title was saved, as an ISO time.
    std::string added;

    bool operator==(const WatchlistEntry&) const = default;
};

// The saved titles in a profile's folder. A missing or unreadable file gives none.
std::vector<WatchlistEntry> ReadWatchlist(const paths::fs::path& folder);

// Saves a title at the front, or moves it there when it is already saved. An item
// without an id or a title is refused, and so is any change to a file that cannot
// be read. Either way the file is left as it was. Returns the list as it now stands.
std::vector<WatchlistEntry> AddWatchlist(const paths::fs::path& folder, const MediaItem& item);

// Takes a title off the list, and returns what is left.
std::vector<WatchlistEntry> RemoveWatchlist(const paths::fs::path& folder, const std::string& id);

bool IsSaved(const std::vector<WatchlistEntry>& entries, const std::string& id);

}  // namespace tvm::catalog
