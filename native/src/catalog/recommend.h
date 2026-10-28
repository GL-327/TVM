#pragma once

// Rail selection and recommendations. Each title appears on one rail only, and the
// "You might like" and "Because you watched" shelves are scored from the viewer's
// history. Ported from apps/core/src/providers/recommend.ts.

#include <cstddef>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "catalog/media_item.h"

namespace tvm::catalog {

// Records each item's id and title as used.
void MarkUsed(std::set<std::string>& used, const std::vector<MediaItem>& items);

// Takes up to `limit` items not yet used, in order, and marks them used.
std::vector<MediaItem> TakeUnused(const std::vector<MediaItem>& source, std::set<std::string>& used, std::size_t limit);

// Alternates between two lists, taking unused items, up to `limit`.
std::vector<MediaItem> InterleaveUnused(const std::vector<MediaItem>& first, const std::vector<MediaItem>& second,
                                        std::set<std::string>& used, std::size_t limit);

// How often each genre appears in the history, by lower-case name.
std::map<std::string, int> GenreWeights(const std::vector<MediaItem>& history);

// How well a title suits the viewer: a point per matching genre, a bonus for a
// recent year, and the rating.
double ScoreForYou(const MediaItem& item, const std::map<std::string, int>& weights, int currentYear);

// Unused titles that suit the history best, up to `limit`. With no history, the
// catalogue's own order. `exclude` holds ids and titles that are already on a rail.
std::vector<MediaItem> PickYouMightLike(const std::vector<MediaItem>& pool, const std::vector<MediaItem>& history,
                                        const std::set<std::string>& exclude, std::size_t limit, int currentYear);

// Titles that share a genre with `source`, up to `limit`. The source itself and
// any excluded id are left out. Nothing without a source.
std::vector<MediaItem> BecauseYouWatched(const MediaItem* source, const std::vector<MediaItem>& pool,
                                         const std::set<std::string>& exclude, std::size_t limit);

}  // namespace tvm::catalog
