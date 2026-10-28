#include "catalog/library.h"

#include <optional>
#include <string>

#include "catalog/title.h"
#include "core/js.h"

namespace tvm::catalog {

namespace {

// The genre every library file carries. The recommendations leave it out of the taste profile.
const char kYourFiles[] = "Your files";

// One file as an item, or nothing when the name is not a playable file.
std::optional<MediaItem> ItemFromName(const std::string& id, const std::string& filename,
                                      const std::optional<std::string>& mimeType) {
    if (filename.empty() || !title::IsPlayableFile(filename, mimeType)) return std::nullopt;

    const title::ParsedName parsed = title::ParseFilename(filename);
    const std::optional<title::Episode> episode = title::ParseEpisode(filename);

    MediaItem item;
    item.id = id;
    item.title = parsed.title;
    item.year = parsed.year;
    item.kind = episode.has_value() ? "series" : "file";
    item.synopsis = filename;
    item.genres = {kYourFiles};
    item.playable = true;
    item.hue = js::HueFor(parsed.title);
    item.filename = filename;
    item.mimeType = mimeType;
    item.showTitle = parsed.title;
    if (episode.has_value()) {
        item.season = episode->season;
        item.episode = episode->episode;
    }
    item.episodeName = title::ParseEpisodeTitle(filename);
    return item;
}

std::optional<MediaItem> FromDownload(const realdebrid::Download& download) {
    const std::optional<std::string> mimeType =
        download.mimeType.empty() ? std::nullopt : std::optional<std::string>(download.mimeType);
    return ItemFromName("rd:d:" + download.id, download.filename, mimeType);
}

// A torrent's files are listed when it has finished downloading. A torrent with several
// files, or a pack of episodes, is a series, not a single play.
std::optional<MediaItem> FromTorrent(const realdebrid::Torrent& torrent) {
    const bool ready = torrent.status == "downloaded" || torrent.progress == 100.0;
    if (!ready || torrent.links.empty()) return std::nullopt;

    std::optional<MediaItem> item = ItemFromName("rd:t:" + torrent.id + ":0", torrent.filename, std::nullopt);
    if (!item.has_value()) return std::nullopt;
    if (title::LooksLikePack(item->title, torrent.filename) || torrent.links.size() > 1) {
        item->kind = "series";
        item->season.reset();
        item->episode.reset();
        item->episodeName.reset();
    }
    return item;
}

}  // namespace

std::vector<MediaItem> LibraryItems(const std::vector<realdebrid::Download>& downloads,
                                    const std::vector<realdebrid::Torrent>& torrents) {
    std::vector<MediaItem> items;
    for (const realdebrid::Torrent& torrent : torrents) {
        if (std::optional<MediaItem> item = FromTorrent(torrent)) items.push_back(*item);
    }
    for (const realdebrid::Download& download : downloads) {
        if (std::optional<MediaItem> item = FromDownload(download)) items.push_back(*item);
    }
    return items;
}

}  // namespace tvm::catalog
