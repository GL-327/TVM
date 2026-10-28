#include "catalog/cinemeta.h"

#include <algorithm>
#include <initializer_list>
#include <map>
#include <cctype>
#include <cmath>
#include <set>
#include <utility>

#include "catalog/artwork.h"
#include "core/js.h"
#include "core/util.h"

namespace tvm::catalog {

namespace {

// Reads a string field the way `typeof x === 'string' ? x : ''` does.
std::string StringField(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return "";
    return found->get<std::string>();
}

// Reads a field the way `x ?? y` does: the first value that is not null or undefined.
const nlohmann::json* FirstPresent(const nlohmann::json& object, std::initializer_list<const char*> keys) {
    for (const char* key : keys) {
        const auto found = object.find(key);
        if (found != object.end() && !found->is_null()) return &*found;
    }
    return nullptr;
}

bool IsImdbId(const std::string& id) {
    if (id.size() < 3) return false;
    if (std::tolower(static_cast<unsigned char>(id[0])) != 't' || std::tolower(static_cast<unsigned char>(id[1])) != 't') {
        return false;
    }
    for (std::size_t i = 2; i < id.size(); ++i) {
        if (!std::isdigit(static_cast<unsigned char>(id[i]))) return false;
    }
    return true;
}

// String(value) for a JSON scalar, as JavaScript would print it.
std::string ToJsString(const nlohmann::json& value) {
    if (value.is_string()) return value.get<std::string>();
    if (value.is_number()) return js::NumberToString(value.get<double>());
    if (value.is_boolean()) return value.get<bool>() ? "true" : "false";
    return "";
}

}  // namespace

const std::vector<GenreRail>& GenreRails() {
    static const std::vector<GenreRail> rails = {
        {"horror", "Horror", "Horror"},
        {"action", "Action", "Action"},
        {"comedy", "Comedy", "Comedy"},
        {"thriller", "Thriller", "Thriller"},
        {"scifi", "Sci-Fi", "Sci-Fi"},
        {"romance", "Romance", "Romance"},
        {"crime", "Crime", "Crime"},
        {"documentary", "Documentaries", "Documentary"},
        {"anime", "Anime", "Anime"},
    };
    return rails;
}

std::vector<std::string> SeriesGenresForRail(const std::string& genre) {
    if (genre == "Anime") return {"Animation"};
    return {genre};
}

std::optional<int> ParseYear(const nlohmann::json* value) {
    if (value == nullptr) return std::nullopt;
    if (value->is_number()) {
        const double number = value->get<double>();
        if (std::isfinite(number) && number > 1800) return static_cast<int>(std::trunc(number));
        return std::nullopt;
    }
    if (!value->is_string()) return std::nullopt;

    // The first 19xx or 20xx that stands alone, as /\b(19|20)\d{2}\b/ finds it.
    const std::string text = value->get<std::string>();
    for (std::size_t i = 0; i + 4 <= text.size(); ++i) {
        const bool boundaryBefore = i == 0 || !std::isalnum(static_cast<unsigned char>(text[i - 1]));
        if (!boundaryBefore) continue;
        if (text.compare(i, 2, "19") != 0 && text.compare(i, 2, "20") != 0) continue;
        bool digits = true;
        for (std::size_t k = i; k < i + 4; ++k) {
            if (!std::isdigit(static_cast<unsigned char>(text[k]))) digits = false;
        }
        const bool boundaryAfter = i + 4 == text.size() || !std::isalnum(static_cast<unsigned char>(text[i + 4]));
        if (digits && boundaryAfter) return std::stoi(text.substr(i, 4));
    }
    return std::nullopt;
}

std::optional<MediaItem> MapMeta(const nlohmann::json& raw, const std::string& kind) {
    if (!raw.is_object()) return std::nullopt;

    std::string id = StringField(raw, "id");
    if (id.empty()) id = StringField(raw, "imdb_id");
    if (!IsImdbId(id)) return std::nullopt;
    std::transform(id.begin(), id.end(), id.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    // `raw.name || raw.title`: a non-empty name is used even if it is only spaces, which then trim to nothing.
    std::string title = StringField(raw, "name");
    if (title.empty()) title = StringField(raw, "title");
    title = util::Trim(title);
    if (title.empty()) return std::nullopt;

    MediaItem item;
    item.id = id;
    item.title = title;
    item.kind = kind;
    if (const auto genre = raw.find("genre"); genre != raw.end() && genre->is_array()) {
        for (const auto& entry : *genre) {
            if (entry.is_string()) item.genres.push_back(entry.get<std::string>());
        }
    }

    const std::string poster = StringField(raw, "poster");
    item.poster = PreferPoster(id, poster, "");
    std::string background = StringField(raw, "background");
    if (background.empty()) background = StringField(raw, "backdrop");
    item.backdrop = PreferBackdrop(id, background, poster);

    item.year = ParseYear(FirstPresent(raw, {"year"}));
    if (!item.year.has_value()) item.year = ParseYear(FirstPresent(raw, {"releaseInfo"}));
    item.synopsis = StringField(raw, "description");

    if (const auto rating = FirstPresent(raw, {"imdbRating"}); rating != nullptr) {
        item.rating = ToJsString(*rating);
    }
    if (const auto runtime = raw.find("runtime"); runtime != raw.end()) {
        if (runtime->is_string()) {
            item.runtime = runtime->get<std::string>();
        } else if (runtime->is_number()) {
            item.runtime = js::NumberToString(runtime->get<double>()) + " min";
        }
    }
    item.playable = true;
    item.hue = js::HueFor(title);
    item.showTitle = title;
    return item;
}

std::optional<std::string> ParseAired(const nlohmann::json* value) {
    if (value == nullptr || !value->is_string()) return std::nullopt;
    const std::string text = util::Trim(value->get<std::string>());
    if (text.empty()) return std::nullopt;
    // Cinemeta sends ISO dates. The date part is all the UI shows.
    if (text.size() < 10) return std::nullopt;
    for (std::size_t i = 0; i < 10; ++i) {
        const bool separator = i == 4 || i == 7;
        const bool ok = separator ? text[i] == '-' : std::isdigit(static_cast<unsigned char>(text[i])) != 0;
        if (!ok) return std::nullopt;
    }
    return text.substr(0, 10);
}

std::vector<MediaItem> MapVideos(const MediaItem& show, const nlohmann::json* videos) {
    std::vector<MediaItem> items;
    if (videos == nullptr || !videos->is_array()) return items;

    for (const auto& video : *videos) {
        if (!video.is_object()) continue;

        // The season and episode may be in the id, as ":2:3" at the end.
        int idSeason = 0;
        int idEpisode = 0;
        const std::string videoId = StringField(video, "id");
        const auto colon = videoId.rfind(':');
        if (colon != std::string::npos && colon > 0) {
            const auto previous = videoId.rfind(':', colon - 1);
            if (previous != std::string::npos) {
                const std::string first = videoId.substr(previous + 1, colon - previous - 1);
                const std::string second = videoId.substr(colon + 1);
                const bool numeric = !first.empty() && !second.empty() &&
                                     std::all_of(first.begin(), first.end(), [](unsigned char c) { return std::isdigit(c); }) &&
                                     std::all_of(second.begin(), second.end(), [](unsigned char c) { return std::isdigit(c); });
                if (numeric) {
                    idSeason = std::stoi(first);
                    idEpisode = std::stoi(second);
                }
            }
        }

        // `a ?? b ?? c` takes the first field that is present, even if it is invalid.
        // The id is only used when none of the fields is present.
        const nlohmann::json* seasonField = FirstPresent(video, {"season", "seasonNumber", "season_number"});
        const nlohmann::json* episodeField = FirstPresent(video, {"episode", "number", "episodeNumber", "episode_number"});
        const double seasonValue = seasonField != nullptr ? js::Number(seasonField)
                                   : idSeason > 0 ? static_cast<double>(idSeason)
                                                  : std::nan("");
        const double episodeValue = episodeField != nullptr ? js::Number(episodeField)
                                    : idEpisode > 0 ? static_cast<double>(idEpisode)
                                                    : std::nan("");
        if (!std::isfinite(seasonValue) || !std::isfinite(episodeValue) || seasonValue < 1 || episodeValue < 1) continue;

        const int seasonNumber = static_cast<int>(seasonValue);
        const int episodeNumber = static_cast<int>(episodeValue);

        // `video.title || video.name || fallback`: an empty string falls through, but nothing is trimmed.
        std::string name = StringField(video, "title");
        if (name.empty()) name = StringField(video, "name");
        if (name.empty()) name = "Episode " + std::to_string(episodeNumber);

        const std::string thumbnail = StringField(video, "thumbnail");
        const std::string poster = thumbnail.empty() ? show.poster : UpgradeImageUrl(thumbnail, false);

        MediaItem item;
        item.id = show.id + ":" + std::to_string(seasonNumber) + ":" + std::to_string(episodeNumber);
        item.title = show.title;
        item.year = show.year;
        item.kind = "series";
        // A string overview wins even when it is empty; description is only the fallback for a non-string.
        const auto overview = video.find("overview");
        if (overview != video.end() && overview->is_string()) {
            item.synopsis = overview->get<std::string>();
        } else {
            item.synopsis = StringField(video, "description");
        }
        item.poster = poster;
        item.backdrop = show.backdrop;
        item.genres = show.genres;
        // An episode score is kept only when, trimmed, it reads as a 0-10 rating.
        if (const nlohmann::json* raw = FirstPresent(video, {"imdbRating", "rating"}); raw != nullptr) {
            const std::string text = util::Trim(ToJsString(*raw));
            const nlohmann::json trimmed = text;
            const double value = js::Number(&trimmed);
            if (!text.empty() && std::isfinite(value) && value > 0 && value <= 10) item.rating = text;
        }
        item.playable = true;
        item.hue = show.hue;
        item.season = seasonNumber;
        item.episode = episodeNumber;
        item.episodeName = name;
        item.showTitle = show.title;
        if (auto aired = ParseAired(FirstPresent(video, {"released"})); aired.has_value()) item.aired = aired;
        else if (auto first = ParseAired(FirstPresent(video, {"firstAired"})); first.has_value()) item.aired = first;
        items.push_back(item);
    }

    std::stable_sort(items.begin(), items.end(), [](const MediaItem& left, const MediaItem& right) {
        if (left.season.value_or(0) != right.season.value_or(0)) return left.season.value_or(0) < right.season.value_or(0);
        return left.episode.value_or(0) < right.episode.value_or(0);
    });
    return items;
}

std::vector<std::pair<std::string, std::string>> ParseTvmazeEpisodes(const nlohmann::json& raw) {
    std::vector<std::pair<std::string, std::string>> out;
    if (!raw.is_array()) return out;
    for (const auto& entry : raw) {
        if (!entry.is_object()) continue;
        const double season = js::Number(FirstPresent(entry, {"season"}));
        const double number = js::Number(FirstPresent(entry, {"number"}));
        if (!std::isfinite(season) || !std::isfinite(number) || season < 1 || number < 1) continue;

        const auto rating = entry.find("rating");
        if (rating == entry.end() || !rating->is_object()) continue;
        const auto average = rating->find("average");
        if (average == rating->end()) continue;
        const double value = js::Number(&*average);
        if (!std::isfinite(value) || value <= 0 || value > 10) continue;
        out.emplace_back(js::NumberToString(season) + ":" + js::NumberToString(number), ToJsString(*average));
    }
    return out;
}

std::vector<MediaItem> ApplyEpisodeRatings(std::vector<MediaItem> items,
                                           const std::vector<std::pair<std::string, std::string>>& ratings) {
    // The TVMaze lookup is a map in the web code, where a later entry replaces an earlier one.
    std::map<std::string, std::string> byKey;
    for (const auto& [ratingKey, score] : ratings) byKey[ratingKey] = score;

    for (MediaItem& item : items) {
        if (!item.rating.empty() || !item.season.has_value() || !item.episode.has_value()) continue;
        const auto found = byKey.find(std::to_string(*item.season) + ":" + std::to_string(*item.episode));
        if (found != byKey.end()) item.rating = found->second;
    }
    return items;
}

std::vector<MediaItem> FilterNewFilms(const std::vector<MediaItem>& items, int currentYear) {
    const int floor = currentYear - 1;
    std::vector<MediaItem> out;
    for (const MediaItem& item : items) {
        if (item.kind == "movie" && item.year.value_or(0) >= floor) out.push_back(item);
    }
    return out;
}

std::vector<MediaItem> DedupeItems(const std::vector<MediaItem>& items) {
    std::set<std::string> seen;
    std::vector<MediaItem> out;
    for (const MediaItem& item : items) {
        if (seen.insert(item.id).second) out.push_back(item);
    }
    return out;
}

}  // namespace tvm::catalog
