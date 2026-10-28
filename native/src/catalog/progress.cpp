#include "catalog/progress.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <map>
#include <set>
#include <utility>

#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

namespace tvm::catalog {

namespace {

// Past this share of its length, a title counts as finished.
constexpr double kFinishedShare = 0.96;
// Runs shorter than this, and positions before this, give no progress at all.
constexpr double kShortRunSeconds = 60.0;
constexpr double kGlanceSeconds = 30.0;
// The Continue watching shelf shows at most this many titles.
constexpr std::size_t kContinueLimit = 16;

// The entry for an id, or null when there is none.
const nlohmann::json& EntryFor(const ProgressMap& progress, const std::string& id) {
    static const nlohmann::json kNone;
    if (!progress.is_object()) return kNone;
    const auto found = progress.find(id);
    return found == progress.end() ? kNone : *found;
}

// A number field, when the field is a finite number.
std::optional<double> NumberField(const nlohmann::json& entry, const char* key) {
    if (!entry.is_object()) return std::nullopt;
    const auto found = entry.find(key);
    if (found == entry.end() || !found->is_number()) return std::nullopt;
    const double value = found->get<double>();
    if (!std::isfinite(value)) return std::nullopt;
    return value;
}

std::optional<std::string> StringField(const nlohmann::json& entry, const char* key) {
    if (!entry.is_object()) return std::nullopt;
    const auto found = entry.find(key);
    if (found == entry.end() || !found->is_string()) return std::nullopt;
    return found->get<std::string>();
}

// Letters and digits only, in lower case, so "The Office (US)" and "theoffice us" meet.
std::string ShowKey(const std::string& title) {
    std::string key;
    for (char c : title) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) key.push_back(c);
    }
    return key;
}

std::string UpdatedOf(const ProgressMap& progress, const std::string& id) {
    return StringField(EntryFor(progress, id), "updated").value_or("");
}

// The stored map, or an empty one when the file is missing. Nothing when the file
// exists but cannot be read, so a save is refused rather than written over it.
std::optional<ProgressMap> StoredProgress(const paths::fs::path& folder) {
    const paths::fs::path path = paths::ProgressPath(folder);
    std::error_code ignored;
    if (!paths::fs::exists(path, ignored)) return nlohmann::json::object();
    const std::optional<nlohmann::json> stored = secrets::ReadPrivateJson(folder, path);
    if (!stored.has_value() || !stored->is_object()) return std::nullopt;
    return *stored;
}

}  // namespace

ProgressMap ReadProgress(const paths::fs::path& folder) {
    return StoredProgress(folder).value_or(nlohmann::json::object());
}

ProgressMap WriteProgress(const paths::fs::path& folder, const std::string& id, double position, double duration) {
    // A file that cannot be read is left as it is, and nothing is saved.
    std::optional<ProgressMap> stored = StoredProgress(folder);
    if (!stored.has_value()) return nlohmann::json::object();
    ProgressMap all = std::move(*stored);
    // A copy, because `all` changes below. A title with no entry starts from an empty one.
    nlohmann::json previous = EntryFor(all, id);
    if (!previous.is_object()) previous = nlohmann::json::object();

    const std::string updated = util::IsoTimestamp();
    const nlohmann::json reading{{"position", position}, {"duration", duration}};
    const bool finished = IsFinished(reading);
    const bool firstCrossing = finished && !IsFinished(previous);

    // Everything already stored is kept, so fields this build does not know about survive a save.
    nlohmann::json entry = previous;
    entry["position"] = position;
    entry["duration"] = duration;
    entry["updated"] = updated;
    if (finished) {
        entry["completedAt"] = firstCrossing ? updated : StringField(previous, "completedAt").value_or(updated);
    }

    // As the Node core counts: an existing count stands, else a title that was ever finished counts once.
    const bool priorCompletion = !StringField(previous, "completedAt").value_or("").empty() || IsFinished(previous);
    const double counted = NumberField(previous, "completions").value_or(priorCompletion ? 1.0 : 0.0);
    entry["completions"] = static_cast<long long>(counted + (firstCrossing ? 1.0 : 0.0));

    all[id] = entry;
    vault::WriteSealed(folder, paths::ProgressPath(folder), all);
    return all;
}

bool IsFinished(const nlohmann::json& entry) {
    const std::optional<double> position = NumberField(entry, "position");
    const std::optional<double> duration = NumberField(entry, "duration");
    return position.has_value() && duration.has_value() && *duration > 0.0 && *position / *duration > kFinishedShare;
}

std::optional<double> ProgressRatio(const nlohmann::json& entry) {
    const std::optional<double> position = NumberField(entry, "position");
    const std::optional<double> duration = NumberField(entry, "duration");
    if (!position.has_value() || !duration.has_value()) return std::nullopt;
    if (*duration < kShortRunSeconds || *position < kGlanceSeconds) return std::nullopt;
    const double value = *position / *duration;
    if (value > kFinishedShare) return std::nullopt;
    return std::clamp(value, 0.0, 1.0);
}

std::optional<double> ResumePosition(const nlohmann::json& entry) {
    if (!ProgressRatio(entry).has_value()) return std::nullopt;
    return NumberField(entry, "position");
}

std::vector<ProgressItem> ApplyProgress(const std::vector<MediaItem>& items, const ProgressMap& progress) {
    // An id's parents are the ids before each ':'. Each parent keeps the furthest
    // share watched beneath it, so a show's card reflects its latest episode.
    std::map<std::string, double> beneath;
    if (progress.is_object()) {
        for (const auto& [id, entry] : progress.items()) {
            const std::optional<double> value = ProgressRatio(entry);
            if (!value.has_value()) continue;
            std::size_t separator = id.rfind(':');
            while (separator != std::string::npos && separator > 0) {
                const std::string parent = id.substr(0, separator);
                const auto known = beneath.find(parent);
                if (known == beneath.end() || *value > known->second) beneath[parent] = *value;
                separator = id.rfind(':', separator - 1);
            }
        }
    }

    std::vector<ProgressItem> out;
    out.reserve(items.size());
    for (const MediaItem& item : items) {
        std::optional<double> value = ProgressRatio(EntryFor(progress, item.id));
        if (!value.has_value()) {
            const auto parent = beneath.find(item.id);
            if (parent != beneath.end()) value = parent->second;
        }
        out.push_back(ProgressItem{item, value});
    }
    return out;
}

std::vector<ProgressItem> PickContinueWatching(const std::vector<ProgressItem>& items, const ProgressMap& progress) {
    std::vector<ProgressItem> ranked;
    for (const ProgressItem& item : items) {
        if (item.progress.has_value()) ranked.push_back(item);
    }
    // Newest first. The sort is stable, so ties keep the catalogue's order, as Array.prototype.sort does.
    std::stable_sort(ranked.begin(), ranked.end(), [&progress](const ProgressItem& left, const ProgressItem& right) {
        return UpdatedOf(progress, left.item.id) > UpdatedOf(progress, right.item.id);
    });

    // One card per show: the newest episode stands for the whole show.
    std::set<std::string> seen;
    std::vector<ProgressItem> out;
    for (const ProgressItem& item : ranked) {
        const std::string key = ShowKey(item.item.showTitle.value_or(item.item.title));
        if (key.empty() || seen.count(key) != 0) continue;
        seen.insert(key);
        out.push_back(item);
        if (out.size() >= kContinueLimit) break;
    }
    return out;
}

}  // namespace tvm::catalog
