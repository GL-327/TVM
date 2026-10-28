#pragma once

// Watch progress, kept per item id in the active profile's progress.json, and the
// rules that turn it into Continue watching and resume points. Ported from
// apps/core/src/providers/progress.ts. Entries stay JSON, so fields the Node core
// writes and this build does not know about survive a save.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/media_item.h"
#include "core/paths.h"

namespace tvm::catalog {

// Saved progress by item id, as the Node core writes it.
using ProgressMap = nlohmann::json;

// A title, with the share of it watched when the progress rules show one.
struct ProgressItem {
    MediaItem item;
    std::optional<double> progress;
};

// The progress in a profile's folder. A missing or unreadable file gives none.
ProgressMap ReadProgress(const paths::fs::path& folder);

// Records a position for an item, and returns every entry, as the Node core does.
// The first time a title passes the finish line it counts as a completion. A file
// that cannot be read is left as it is: nothing is saved and an empty map returns.
ProgressMap WriteProgress(const paths::fs::path& folder, const std::string& id, double position, double duration);

// Past the finish line: 96% of the way through.
bool IsFinished(const nlohmann::json& entry);

// The share watched, or nothing when the title is too short, the viewer has only
// glanced at it, or it is finished.
std::optional<double> ProgressRatio(const nlohmann::json& entry);

// Where playback starts, in seconds, for a title that is part-watched.
std::optional<double> ResumePosition(const nlohmann::json& entry);

// The titles with their progress. A series or season takes the furthest episode beneath it.
std::vector<ProgressItem> ApplyProgress(const std::vector<MediaItem>& items, const ProgressMap& progress);

// The Continue watching shelf: the titles in progress, newest first, one per show.
std::vector<ProgressItem> PickContinueWatching(const std::vector<ProgressItem>& items, const ProgressMap& progress);

}  // namespace tvm::catalog
