#pragma once

// Finds the stream for a title, as the Node core's play() does: an owned Real-Debrid file
// plays from its own link, and a catalogue title is looked up on Torrentio through the
// viewer's Real-Debrid token. Ported from apps/core/src/providers/torrentio.ts and the
// play path of apps/core/src/providers/media.ts.
//
// The desktop app hands the address to mpv, which plays any container, so the Node core's
// HLS conversion is not needed here. Every request goes through a Transport, so tests
// answer from a fake.

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/http.h"

namespace tvm::catalog {
class CatalogService;
}

namespace tvm::realdebrid {
class Client;
}

namespace tvm::playback {

// A catalogue id: tt1234567, or tt1234567:season:episode for an episode.
struct PlayId {
    std::string imdb;
    std::optional<int> season;
    std::optional<int> episode;

    bool operator==(const PlayId&) const = default;
};

std::optional<PlayId> ParsePlayId(const std::string& id);

// The Torrentio paths to try for a title, the first that has streams wins.
std::vector<std::string> TorrentioStreamPaths(const std::string& imdb, std::optional<int> season,
                                              std::optional<int> episode);

// One Torrentio stream through Real-Debrid.
struct DebridStream {
    std::string url;
    std::string title;
    int quality = 0;
    bool cached = false;
    std::string description;

    bool operator==(const DebridStream&) const = default;
};

// How well a stream's name fits an audio language: 0 when it is that language alone, 1 when it carries it beside
// others, and -1 when it is in another language. Torrentio flags the languages that are not English, so a name
// with no language marks counts as English.
int LanguageFit(const std::string& description, const std::string& language);
// The streams in a language alone, in their ranked order. A multilingual release is left out, since it can start
// on another track. Empty language keeps all.
std::vector<DebridStream> KeepLanguage(const std::vector<DebridStream>& streams, const std::string& language);

// Nothing for a stream with no address, a refused link, or a camera copy.
std::optional<DebridStream> ParseDebridStream(const nlohmann::json& raw);
// The picture height a release names, 1080 when it names none.
int StreamHeight(const std::string& label);
// Highest quality first. Being cached only breaks a tie at one quality.
std::vector<DebridStream> RankDebridStreams(std::vector<DebridStream> streams);
// The streams no taller than `maxHeight`, or the low ones when none is.
std::vector<DebridStream> CapStreamsToHeight(const std::vector<DebridStream>& streams, int maxHeight);
bool IsTorrentioHost(const std::string& url);
// A Real-Debrid download address, or a file address, plays as it is. Others go through Unrestrict.
bool IsLikelyDirectPlayUrl(const std::string& url);

// How many streams are tried before giving up, as the Node core tries them.
inline constexpr std::size_t kPlayableStreamLimit = 5;

// The stream to play, or why there is none. `reason` is one of the Node core's reasons:
// not-configured, needs-auth, empty, unsupported, not-in-library.
// A stream the viewer can switch to from the quality menu: its height and a short name, and the Torrentio
// address it resolves from.
struct StreamChoice {
    std::string label;
    std::string detail;
    std::string url;
    int height = 0;
    bool cached = false;
};

struct Resolution {
    std::string url;
    std::string title;
    std::string reason;
    // Every ranked stream for a catalogue title, best first, and the one that is playing.
    std::vector<StreamChoice> choices;
    std::size_t chosen = 0;

    bool ok() const { return !url.empty(); }
};

// The viewer-facing message for a reason, from apps/ui/src/data/playbackErrors.ts.
std::string ErrorMessage(const std::string& reason);

struct ResolveInput {
    std::string id;
    // The title the screen opened with. Used as the stream's title when the file name gives none.
    std::string title;
    int maxHeight = 2160;
    // The audio language the file must have, as an ISO code such as "en", or empty for any. A stream whose
    // name says it is in another language is never chosen; when none fits, the reason is "no-language".
    std::string language;
};

class Resolver {
public:
    Resolver(realdebrid::Client& realDebrid, catalog::CatalogService& catalog, http::Transport transport = http::Send);

    // Blocks on the network. Never throws.
    Resolution Resolve(const ResolveInput& input) const;
    // The file behind one of a resolution's choices, for the quality menu. Never throws.
    Resolution ResolveChoice(const StreamChoice& choice, const std::string& fallbackTitle) const;

    // Follows Torrentio's resolve address to the file it points at. Nothing when it points back at
    // Torrentio, which is its placeholder for a file Real-Debrid has not cached.
    std::optional<std::string> ResolveTorrentioUrl(const std::string& url, int hops = 0) const;
    std::vector<DebridStream> FetchTorrentioStreams(const std::string& token, const PlayId& id) const;

private:
    Resolution PlayFromLink(const std::string& link, const std::string& fallbackTitle) const;
    Resolution PlayFromTorrentio(PlayId id, const ResolveInput& input) const;
    std::optional<std::string> OwnedLink(const std::string& id) const;

    realdebrid::Client& realDebrid_;
    catalog::CatalogService& catalog_;
    http::Transport transport_;
};

}  // namespace tvm::playback
