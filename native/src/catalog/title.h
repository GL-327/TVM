#pragma once

// Reads a title, season and episode from a release file name, such as
// "The.Boys.S01E05.1080p.mkv". Ported from apps/core/src/providers/title.ts. The
// patterns are the same; the matching uses ECMAScript regular expressions as the
// Node core does, on UTF-16 text.

#include <optional>
#include <string>

namespace tvm::catalog::title {

struct Episode {
    int season = 0;
    int episode = 0;

    bool operator==(const Episode&) const = default;
};

struct ParsedName {
    std::string title;
    std::optional<int> year;

    bool operator==(const ParsedName&) const = default;
};

// Subtitles, images, archives and other non-video files are not playable.
bool IsPlayableFile(const std::string& filename, const std::optional<std::string>& mimeType = std::nullopt);

// The show or film name, and the year when the name has one.
ParsedName ParseFilename(const std::string& filename);

// Season and episode from SxxExx, 2x09 or "Season 2 Episode 9". A range such as S01E01-08 is not one episode.
std::optional<Episode> ParseEpisode(const std::string& filename);

// The chapter name after SxxExx, when the release includes one.
std::optional<std::string> ParseEpisodeTitle(const std::string& filename);

// The season from Sxx or "Season 1". Nothing for a season of zero.
std::optional<int> ParseSeason(const std::string& filename);

// True for a season or series pack, which is a folder of episodes rather than one play.
bool LooksLikePack(const std::string& title, const std::string& filename = "");

// An http or https address with a host, as URL() would read it. Other schemes and text that is not an address are refused.
bool IsHttpUrl(const std::string& value);

// A logo address. A protocol-relative address (//host/logo.png) gets https. Anything else that is not
// an http or https address is dropped, and so is an empty one.
std::optional<std::string> HttpAssetUrl(const std::string& value);

}  // namespace tvm::catalog::title
