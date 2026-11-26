#include "ui/catalog_view.h"

#include <algorithm>
#include <map>

#include "catalog/cinemeta.h"

#include "catalog/artwork.h"

namespace tvm::ui {

HomeSectionLabels HomeSections() {
    HomeSectionLabels choices{
        {"continue", "Continue watching"}, {"upcoming", "New episodes this week"}, {"my-list", "My List"},
        {"for-you", "You might like"}, {"films", "Popular films"}, {"series", "Popular series"},
        {"top-films", "Top rated films"}, {"top-series", "Top rated series"}, {"new-films", "New films"},
        {"new-series", "Recently updated"}, {"because", "Because you watched"}
    };
    for (const auto& rail : catalog::GenreRails()) choices.emplace_back(rail.id, rail.title);
    return choices;
}

std::vector<HomeSection> ReadHomeSections(const nlohmann::json& body) {
    std::vector<HomeSection> sections;
    if (!body.is_object()) return sections;
    const auto rows = body.find("homeSections");
    if (rows == body.end() || !rows->is_array()) return sections;
    for (const auto& row : *rows) {
        if (!row.is_object() || !row.contains("id") || !row["id"].is_string() ||
            !row.contains("visible") || !row["visible"].is_boolean()) continue;
        const std::string id = row["id"].get<std::string>();
        if (id.empty() || id.size() > 64) continue;
        const bool visible = row["visible"].get<bool>();
        auto found = std::find_if(sections.begin(), sections.end(), [&](const auto& s) { return s.id == id; });
        if (found == sections.end()) sections.push_back({id, visible});
        else found->visible = visible;
        if (sections.size() >= 100) break;
    }
    return sections;
}

nlohmann::json HomeSectionsPatch(const std::vector<HomeSection>& sections) {
    auto rows = nlohmann::json::array();
    for (const auto& section : sections) rows.push_back({{"id", section.id}, {"visible", section.visible}});
    return {{"homeSections", std::move(rows)}};
}

void ApplyHomeSections(std::vector<RailData>& rails, const std::vector<HomeSection>& sections) {
    std::map<std::string, std::size_t, std::less<>> order;
    for (std::size_t i = 0; i < sections.size(); ++i) order.try_emplace(sections[i].id, i);
    const auto priority = [&](const RailData& rail) {
        auto at = order.find(rail.id);
        if (at == order.end() && (rail.id == "because" || rail.id.starts_with("auto-"))) at = order.find("automatic");
        if (at == order.end() && rail.id == "watchlist") at = order.find("my-list");
        return at == order.end() ? sections.size() : at->second;
    };
    std::erase_if(rails, [&](const RailData& rail) {
        const std::size_t index = priority(rail);
        return index < sections.size() && !sections[index].visible;
    });
    std::stable_sort(rails.begin(), rails.end(), [&](const auto& a, const auto& b) { return priority(a) < priority(b); });
}

CardData CardFromMedia(const catalog::MediaItem& item) {
    CardData card;
    card.itemId = item.id;
    card.title = item.title;
    card.posterUrl = catalog::PreferPoster(item.id, item.poster, item.backdrop);
    card.backdropUrl = item.backdrop;
    return card;
}

std::vector<RailData> RailsFromCatalog(const std::vector<catalog::HomeRail>& rails) {
    std::vector<RailData> out;
    for (const catalog::HomeRail& rail : rails) {
        RailData data;
        data.id = rail.id;
        data.title = rail.title;
        for (const catalog::MediaItem& item : rail.items) {
            data.cards.push_back(CardFromMedia(item));
        }
        out.push_back(data);
    }
    return out;
}

TitleInfo InfoFromMeta(const std::string& id, const std::optional<catalog::TitleMeta>& meta) {
    TitleInfo info;
    info.id = id;
    if (!meta.has_value()) {
        info.state = TitleInfo::State::Unavailable;
        return info;
    }

    const catalog::MediaItem& item = meta->item;
    info.state = TitleInfo::State::Ready;
    info.title = item.title;
    info.kind = item.kind;
    info.year = item.year;
    info.rating = item.rating;
    info.runtime = item.runtime;
    info.genres = item.genres;
    info.synopsis = item.synopsis;
    info.posterUrl = item.poster;
    info.backdropUrl = item.backdrop;
    info.episodes = meta->children.size();
    info.children = meta->children;
    info.media = item;
    return info;
}

RailData ContinueWatchingRail(const std::vector<catalog::ProgressItem>& items) {
    RailData rail;
    rail.id = "continue";
    rail.title = "Continue watching";
    for (const catalog::ProgressItem& entry : items) {
        CardData card = CardFromMedia(entry.item);
        card.progress = entry.progress;
        rail.cards.push_back(card);
    }
    return rail;
}

RailData WatchlistRail(const std::vector<catalog::WatchlistEntry>& entries) {
    RailData rail;
    rail.id = "watchlist";
    rail.title = "Watchlist";
    for (const catalog::WatchlistEntry& entry : entries) {
        rail.cards.push_back(CardFromMedia(entry.item));
    }
    return rail;
}

}  // namespace tvm::ui
