#include "catalog/recommend.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/js.h"

namespace tvm::catalog {

namespace {

// Points for each genre the title shares with the viewer's history, times how often it appears there.
constexpr double kGenrePoints = 8.0;
// Points for a title from the last two years.
constexpr double kRecentPoints = 6.0;
constexpr int kRecentYears = 2;

bool IsUsed(const std::set<std::string>& used, const MediaItem& item) {
    return used.count(item.id) != 0 || used.count(item.title) != 0;
}

void Use(std::set<std::string>& used, const MediaItem& item) {
    used.insert(item.id);
    used.insert(item.title);
}

// Returns the next unused item from `source` at `cursor`, marking it used.
std::optional<MediaItem> TakeNext(const std::vector<MediaItem>& source, std::size_t& cursor, std::set<std::string>& used) {
    while (cursor < source.size()) {
        const MediaItem& item = source[cursor];
        ++cursor;
        if (IsUsed(used, item)) continue;
        Use(used, item);
        return item;
    }
    return std::nullopt;
}

// ASCII lower case. Cinemeta's genre names are ASCII, so this matches JavaScript's toLowerCase for them.
std::string Lower(const std::string& text) {
    std::string out = text;
    for (char& c : out) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

}  // namespace

void MarkUsed(std::set<std::string>& used, const std::vector<MediaItem>& items) {
    for (const MediaItem& item : items) Use(used, item);
}

std::vector<MediaItem> TakeUnused(const std::vector<MediaItem>& source, std::set<std::string>& used, std::size_t limit) {
    std::vector<MediaItem> out;
    for (const MediaItem& item : source) {
        if (IsUsed(used, item)) continue;
        Use(used, item);
        out.push_back(item);
        if (out.size() >= limit) break;
    }
    return out;
}

std::vector<MediaItem> InterleaveUnused(const std::vector<MediaItem>& first, const std::vector<MediaItem>& second,
                                        std::set<std::string>& used, std::size_t limit) {
    std::size_t leftCursor = 0;
    std::size_t rightCursor = 0;
    std::vector<MediaItem> out;
    bool fromFirst = true;
    while (out.size() < limit) {
        // When one side runs dry, the other side fills in.
        std::optional<MediaItem> item = fromFirst ? TakeNext(first, leftCursor, used) : TakeNext(second, rightCursor, used);
        if (!item.has_value()) {
            item = fromFirst ? TakeNext(second, rightCursor, used) : TakeNext(first, leftCursor, used);
        }
        if (!item.has_value()) break;
        out.push_back(*item);
        fromFirst = !fromFirst;
    }
    return out;
}

std::map<std::string, int> GenreWeights(const std::vector<MediaItem>& history) {
    std::map<std::string, int> weights;
    for (const MediaItem& item : history) {
        for (const std::string& genre : item.genres) {
            const std::string key = Lower(genre);
            // "Your files" labels a folder of the viewer's own, so it says nothing about taste.
            if (key.empty() || key == "your files") continue;
            ++weights[key];
        }
    }
    return weights;
}

double ScoreForYou(const MediaItem& item, const std::map<std::string, int>& weights, int currentYear) {
    double score = 0.0;
    for (const std::string& genre : item.genres) {
        const auto found = weights.find(Lower(genre));
        if (found != weights.end()) score += found->second * kGenrePoints;
    }
    if (item.year.value_or(0) >= currentYear - kRecentYears) score += kRecentPoints;
    if (!item.rating.empty()) {
        // The rating is read as JavaScript's Number() reads it, and counted only when it is a number.
        const nlohmann::json text(item.rating);
        const double rating = js::Number(&text);
        if (std::isfinite(rating)) score += rating;
    }
    return score;
}

std::vector<MediaItem> PickYouMightLike(const std::vector<MediaItem>& pool, const std::vector<MediaItem>& history,
                                        const std::set<std::string>& exclude, std::size_t limit, int currentYear) {
    std::vector<MediaItem> unused;
    for (const MediaItem& item : pool) {
        if (exclude.count(item.id) == 0 && exclude.count(item.title) == 0) unused.push_back(item);
    }
    if (history.empty()) {
        if (unused.size() > limit) unused.resize(limit);
        return unused;
    }

    const std::map<std::string, int> weights = GenreWeights(history);
    std::vector<std::pair<double, MediaItem>> scored;
    scored.reserve(unused.size());
    for (MediaItem& item : unused) {
        const double score = ScoreForYou(item, weights, currentYear);
        scored.emplace_back(score, std::move(item));
    }
    // Best first. The sort is stable, so equal scores keep the catalogue's order.
    std::stable_sort(scored.begin(), scored.end(),
                     [](const std::pair<double, MediaItem>& left, const std::pair<double, MediaItem>& right) {
                         return left.first > right.first;
                     });

    std::vector<MediaItem> out;
    for (std::pair<double, MediaItem>& entry : scored) {
        if (out.size() >= limit) break;
        out.push_back(std::move(entry.second));
    }
    return out;
}

std::vector<MediaItem> BecauseYouWatched(const MediaItem* source, const std::vector<MediaItem>& pool,
                                         const std::set<std::string>& exclude, std::size_t limit) {
    std::vector<MediaItem> out;
    if (source == nullptr) return out;

    std::set<std::string> wanted;
    for (const std::string& genre : source->genres) wanted.insert(Lower(genre));
    if (wanted.empty()) return out;

    for (const MediaItem& item : pool) {
        if (out.size() >= limit) break;
        if (item.id == source->id || exclude.count(item.id) != 0) continue;
        const bool shares = std::any_of(item.genres.begin(), item.genres.end(), [&wanted](const std::string& genre) {
            return wanted.count(Lower(genre)) != 0;
        });
        if (shares) out.push_back(item);
    }
    return out;
}

}  // namespace tvm::catalog
