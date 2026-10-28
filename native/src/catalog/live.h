#pragma once

// Live TV: the channels the viewer can watch, from a saved Xtream login or a saved
// playlist, and the picks that choose which of them the Live TV screen lists. Ported
// from the catalogue, picks and status parts of apps/core/src/providers/live.ts, and
// from the M3U reader in the same file.
//
// The header lines of a playlist (#EXTVLCOPT, #EXTHTTP) are not read yet. They only
// matter for playback, which is not ported.

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "catalog/live_channel.h"
#include "catalog/xtream.h"
#include "core/http.h"
#include "core/paths.h"

namespace tvm::live {

// The most channels the Live TV screen lists at once. A source with more channels
// than this needs picks before anything is listed.
inline constexpr std::size_t kPickLimit = 48;
// A playlist larger than this is refused. The Node core counts characters, this counts bytes.
inline constexpr std::size_t kMaxPlaylistBytes = 8'000'000;

// The id a playlist address gets: an FNV-1a hash over its UTF-16 code units, in hex.
std::string ChannelId(const std::string& url);

// The group a channel is listed under: its group without surrounding white space, or "Live".
std::string GroupOf(const catalog::LiveChannel& channel);

// The channels of M3U text, in file order. A repeated id gets a numbered suffix.
std::vector<catalog::LiveChannel> ParseM3u(const std::string& text);

// The playlist the viewer saved: its address, its text, or neither.
struct Playlist {
    std::optional<std::string> url;
    std::optional<std::string> text;

    bool operator==(const Playlist&) const = default;
};

// The saved playlist, from live-playlist.json. A missing or unreadable file gives neither.
Playlist ReadPlaylist(const paths::fs::path& dataDir);

// The label the Node core gives a playlist that is pasted rather than addressed.
inline constexpr char kPastedPlaylist[] = "local:playlist";

// Whether a value is playlist text rather than an address: an #EXTM3U or #EXTINF line, or
// several lines with an address in them. Text over the size limit is not playlist text.
bool LooksLikePlaylistText(const std::string& value);

// What SetPlaylist did with the value it was given.
enum class PlaylistChange {
    // The playlist was saved. Nothing is fetched here: an address is read when the channels are.
    Stored,
    // The value is neither playlist text with channels nor a web address. Nothing was changed.
    Invalid,
    // The value was empty, so the saved playlist was removed.
    Cleared,
};

// Saves what the viewer pasted: playlist text, or a web address. Empty removes the saved playlist.
PlaylistChange SetPlaylist(const paths::fs::path& dataDir, const std::string& value);

// Where the channels come from, and what they are.
struct Catalog {
    // An Xtream login is saved. Its server and account name are kept for the screen.
    bool login = false;
    std::optional<std::string> host;
    std::optional<std::string> username;
    // A playlist is saved, as an address or as text.
    bool playlist = false;
    // The playlist's label as the Node core reports it: its address, kPastedPlaylist for pasted
    // text, or nothing. A saved login takes precedence, so it reports nothing.
    std::optional<std::string> playlistUrl;
    std::vector<catalog::LiveChannel> channels;
    // "", "unreachable" or "invalid": why the channels could not be read.
    std::string error;

    bool operator==(const Catalog&) const = default;
};

// The channels of the saved login, or else of the saved playlist text, or else of the saved
// playlist address. The network is reached through the transport, and the login through its client.
Catalog LoadCatalog(const paths::fs::path& dataDir, const xtream::Client& login, const http::Transport& transport);

// The ids in the picks file, in file order. Only ids that start with "live:" are kept.
std::vector<std::string> ReadPicks(const paths::fs::path& dataDir);

// Writes the picks file as the Node core writes it: {"ids":[...]}.
void WritePicks(const paths::fs::path& dataDir, const std::vector<std::string>& ids);

// The picks that name a channel of the catalogue: each once, in order, and at most kPickLimit.
std::vector<std::string> AllowedPicks(const std::vector<catalog::LiveChannel>& channels, const std::vector<std::string>& ids);

// The picks after one channel is picked or unpicked. Picking adds the channel to the end. The
// caller checks the limit first: a pick beyond the limit is dropped, as the Node core drops it.
std::vector<std::string> WithPick(const std::vector<catalog::LiveChannel>& channels, const std::vector<std::string>& picks,
                                  const std::string& id, bool picked);

// What the Live TV screen shows for a catalogue and its picks.
struct Status {
    bool configured = false;
    std::optional<std::string> host;
    std::optional<std::string> username;
    // The channels to list: the picks in their order, or every channel when there are few enough.
    std::vector<catalog::LiveChannel> shown;
    // Why nothing can be listed, when the channels could not be read. "" otherwise.
    std::string error;
    std::size_t picked = 0;
    std::size_t total = 0;
    // The source has more channels than the screen lists, and none is picked yet.
    bool needsPicks = false;

    bool operator==(const Status&) const = default;
};

Status Compose(const Catalog& catalog, const std::vector<std::string>& picks);

}  // namespace tvm::live
