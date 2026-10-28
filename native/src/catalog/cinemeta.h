#pragma once

// Cinemeta, the public metadata service the catalogue comes from. The mapping
// is ported from apps/core/src/providers/cinemeta.ts with the same rules:
// which fields are read, the fallbacks, the id format for episodes, and the
// ordering. Network access is in catalog_service; this file only maps JSON.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/media_item.h"

namespace tvm::catalog {

inline constexpr char kCinemetaBase[] = "https://v3-cinemeta.strem.io";
inline constexpr char kTvmazeBase[] = "https://api.tvmaze.com";

struct GenreRail {
    const char* id;
    const char* title;
    const char* genre;
};

// The genre rails on Home, in order.
const std::vector<GenreRail>& GenreRails();

// Cinemeta's series Anime catalogue times out, so Anime reads Animation instead.
std::vector<std::string> SeriesGenresForRail(const std::string& genre);

// A year from a number above 1800, or the first four-digit year (19xx or 20xx) in a string.
std::optional<int> ParseYear(const nlohmann::json* value);

// A title from a Cinemeta meta or catalogue record. Nothing when the id is not
// an IMDb id or the title is empty.
std::optional<MediaItem> MapMeta(const nlohmann::json& raw, const std::string& kind);

// The YYYY-MM-DD part of an air date, or nothing.
std::optional<std::string> ParseAired(const nlohmann::json* value);

// Episodes from a series' videos, sorted by season then episode. Videos
// without a usable season and episode are skipped.
std::vector<MediaItem> MapVideos(const MediaItem& show, const nlohmann::json* videos);

// TVMaze episode scores keyed "season:number". Only ratings from 0 to 10 count.
std::vector<std::pair<std::string, std::string>> ParseTvmazeEpisodes(const nlohmann::json& raw);

// Fills episode scores that Cinemeta left empty. Cinemeta's own scores stay.
std::vector<MediaItem> ApplyEpisodeRatings(std::vector<MediaItem> items,
                                           const std::vector<std::pair<std::string, std::string>>& ratings);

// Movies from the current year or the year before, for the New films rail.
std::vector<MediaItem> FilterNewFilms(const std::vector<MediaItem>& items, int currentYear);

// Keeps the first item for each id.
std::vector<MediaItem> DedupeItems(const std::vector<MediaItem>& items);

}  // namespace tvm::catalog
