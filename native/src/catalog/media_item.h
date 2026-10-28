#pragma once

// A title or an episode, as the catalogue describes it. Field names match
// apps/core/src/providers/types.ts, and the JSON form matches the cache the Node
// core writes, so the two read each other's catalogue cache.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace tvm::catalog {

struct MediaItem {
    std::string id;
    std::string title;
    std::optional<int> year;
    std::string kind;  // "movie", "series" or "file"
    std::string synopsis;
    std::string poster;
    std::string backdrop;
    std::vector<std::string> genres;
    std::string rating;
    std::optional<std::string> runtime;
    bool playable = false;
    int hue = 0;
    std::optional<int> season;
    std::optional<int> episode;
    std::optional<std::string> episodeName;
    std::optional<std::string> showTitle;
    std::optional<std::string> aired;
    // Library files only: the file's name and MIME type, as Real-Debrid reports them.
    std::optional<std::string> filename;
    std::optional<std::string> mimeType;

    bool operator==(const MediaItem&) const = default;
};

nlohmann::json ToJson(const MediaItem& item);
// Returns nothing when the value is not an object with a usable id and title.
std::optional<MediaItem> FromJson(const nlohmann::json& value);

}  // namespace tvm::catalog
