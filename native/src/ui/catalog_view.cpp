#include "ui/catalog_view.h"

namespace tvm::ui {

std::vector<RailData> RailsFromCatalog(const std::vector<catalog::HomeRail>& rails) {
    std::vector<RailData> out;
    for (const catalog::HomeRail& rail : rails) {
        RailData data;
        data.id = rail.id;
        data.title = rail.title;
        for (const catalog::MediaItem& item : rail.items) {
            CardData card;
            card.itemId = item.id;
            card.title = item.title;
            card.posterUrl = item.poster;
            data.cards.push_back(card);
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
        CardData card;
        card.itemId = entry.item.id;
        card.title = entry.item.title;
        card.posterUrl = entry.item.poster;
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
        CardData card;
        card.itemId = entry.item.id;
        card.title = entry.item.title;
        card.posterUrl = entry.item.poster;
        rail.cards.push_back(card);
    }
    return rail;
}

}  // namespace tvm::ui
