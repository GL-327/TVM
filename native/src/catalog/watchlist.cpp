#include "catalog/watchlist.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>
#include <utility>

#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

namespace tvm::catalog {

namespace {

// The most titles kept. Saving one more drops the oldest.
constexpr std::size_t kMaxItems = 200;
// The hue a saved title gets when its record has none, as watchlist.ts gives.
constexpr int kDefaultHue = 220;
// A year beyond this is not a year. It is kept out of the int field.
constexpr double kMaxYear = 1.0e9;

const nlohmann::json* Field(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}

std::string TextField(const nlohmann::json& object, const char* key) {
    const nlohmann::json* field = Field(object, key);
    return field != nullptr && field->is_string() ? field->get<std::string>() : std::string();
}

// The same rules as asItem in watchlist.ts. A saved title needs an id and a
// title. Any other field that is missing or of the wrong type takes its default.
std::optional<WatchlistEntry> EntryFrom(const nlohmann::json& value) {
    if (!value.is_object()) return std::nullopt;
    WatchlistEntry entry;
    entry.item.id = TextField(value, "id");
    entry.item.title = TextField(value, "title");
    if (util::Trim(entry.item.id).empty() || util::Trim(entry.item.title).empty()) return std::nullopt;

    if (const nlohmann::json* year = Field(value, "year"); year != nullptr && year->is_number()) {
        const double number = year->get<double>();
        if (std::isfinite(number) && std::abs(number) < kMaxYear) entry.item.year = static_cast<int>(number);
    }
    const std::string kind = TextField(value, "kind");
    entry.item.kind = kind == "series" || kind == "file" ? kind : "movie";
    entry.item.synopsis = TextField(value, "synopsis");
    entry.item.poster = TextField(value, "poster");
    entry.item.backdrop = TextField(value, "backdrop");
    entry.item.rating = TextField(value, "rating");
    if (const nlohmann::json* genres = Field(value, "genres"); genres != nullptr && genres->is_array()) {
        for (const nlohmann::json& genre : *genres) {
            if (genre.is_string()) entry.item.genres.push_back(genre.get<std::string>());
        }
    }
    const nlohmann::json* playable = Field(value, "playable");
    entry.item.playable = playable != nullptr && playable->is_boolean() && playable->get<bool>();
    const nlohmann::json* hue = Field(value, "hue");
    entry.item.hue = hue != nullptr && hue->is_number() ? static_cast<int>(hue->get<double>()) : kDefaultHue;

    const nlohmann::json* added = Field(value, "added");
    entry.added = added != nullptr && added->is_string() ? added->get<std::string>() : util::IsoTimestamp();
    return entry;
}

nlohmann::json ToJson(const WatchlistEntry& entry) {
    const MediaItem& item = entry.item;
    return nlohmann::json{
        {"id", item.id},
        {"title", item.title},
        {"year", item.year.has_value() ? nlohmann::json(*item.year) : nlohmann::json(nullptr)},
        {"kind", item.kind},
        {"synopsis", item.synopsis},
        {"poster", item.poster},
        {"backdrop", item.backdrop},
        {"genres", item.genres},
        {"rating", item.rating},
        {"playable", item.playable},
        {"hue", item.hue},
        {"added", entry.added},
    };
}

// The saved list, or none when the file is missing. Nothing when the file exists
// but cannot be read, so a change is refused rather than written over it.
std::optional<std::vector<WatchlistEntry>> StoredEntries(const paths::fs::path& folder) {
    const paths::fs::path path = paths::WatchlistPath(folder);
    std::error_code ignored;
    if (!paths::fs::exists(path, ignored)) return std::vector<WatchlistEntry>{};
    const std::optional<nlohmann::json> stored = secrets::ReadPrivateJson(folder, path);
    if (!stored.has_value() || !stored->is_array()) return std::nullopt;
    std::vector<WatchlistEntry> entries;
    for (const nlohmann::json& value : *stored) {
        if (std::optional<WatchlistEntry> entry = EntryFrom(value)) entries.push_back(*entry);
    }
    return entries;
}

// Writes the list, newest first, capped at kMaxItems. Returns what was written.
std::vector<WatchlistEntry> Persist(const paths::fs::path& folder, std::vector<WatchlistEntry> entries) {
    if (entries.size() > kMaxItems) entries.resize(kMaxItems);
    nlohmann::json stored = nlohmann::json::array();
    for (const WatchlistEntry& entry : entries) stored.push_back(ToJson(entry));
    vault::WriteSealed(folder, paths::WatchlistPath(folder), stored);
    return entries;
}

}  // namespace

std::vector<WatchlistEntry> ReadWatchlist(const paths::fs::path& folder) {
    return StoredEntries(folder).value_or(std::vector<WatchlistEntry>{});
}

std::vector<WatchlistEntry> AddWatchlist(const paths::fs::path& folder, const MediaItem& item) {
    // The same checks as a stored entry. Without an added time, EntryFrom stamps it now.
    nlohmann::json candidate = ToJson(WatchlistEntry{item, ""});
    candidate.erase("added");
    const std::optional<WatchlistEntry> next = EntryFrom(candidate);
    const std::optional<std::vector<WatchlistEntry>> current = StoredEntries(folder);
    if (!next.has_value() || !current.has_value()) return ReadWatchlist(folder);

    std::vector<WatchlistEntry> entries{*next};
    for (const WatchlistEntry& entry : *current) {
        if (entry.item.id != next->item.id) entries.push_back(entry);
    }
    return Persist(folder, std::move(entries));
}

std::vector<WatchlistEntry> RemoveWatchlist(const paths::fs::path& folder, const std::string& id) {
    const std::optional<std::vector<WatchlistEntry>> current = StoredEntries(folder);
    if (!current.has_value()) return ReadWatchlist(folder);

    std::vector<WatchlistEntry> entries;
    for (const WatchlistEntry& entry : *current) {
        if (entry.item.id != id) entries.push_back(entry);
    }
    return Persist(folder, std::move(entries));
}

bool IsSaved(const std::vector<WatchlistEntry>& entries, const std::string& id) {
    return std::any_of(entries.begin(), entries.end(),
                       [&id](const WatchlistEntry& entry) { return entry.item.id == id; });
}

}  // namespace tvm::catalog
