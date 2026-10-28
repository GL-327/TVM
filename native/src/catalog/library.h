#pragma once

// The Real-Debrid library as catalogue items. Each playable file in the viewer's
// downloads becomes one item, and so does each file of a torrent that has finished
// downloading. Ported from fromDownload, fromTorrent and itemFromName in
// apps/core/src/providers/media.ts.

#include <vector>

#include "catalog/media_item.h"
#include "catalog/realdebrid.h"

namespace tvm::catalog {

// The library in the Node core's order: torrents first, then downloads.
std::vector<MediaItem> LibraryItems(const std::vector<realdebrid::Download>& downloads,
                                    const std::vector<realdebrid::Torrent>& torrents);

}  // namespace tvm::catalog
