#include "catalog/title.h"

#include <regex>
#include <vector>

#include "core/util.h"

namespace tvm::catalog::title {

namespace {

using WString = std::wstring;
using WRegex = std::wregex;
using WSmatch = std::wsmatch;

// The patterns are written as they are in title.ts. {DASH} stands for the en dash
// (U+2013) that the Node patterns use. Every pattern is case-insensitive, as the
// Node patterns are, except where the letters they name are already both cases.
WRegex Compile(WString pattern) {
    const WString token = L"{DASH}";
    for (std::size_t at = pattern.find(token); at != WString::npos; at = pattern.find(token, at)) {
        pattern.replace(at, token.size(), 1, L'–');
    }
    return WRegex(pattern, WRegex::ECMAScript | WRegex::icase);
}

bool Matches(const WString& text, const WRegex& pattern) {
    return std::regex_search(text, pattern);
}

// The position of the first match, or -1 when there is none, as JavaScript's search does.
long Search(const WString& text, const WRegex& pattern) {
    WSmatch match;
    if (!std::regex_search(text, match, pattern)) return -1;
    return static_cast<long>(match.position());
}

// The whole match and its groups. A group that did not take part is empty.
std::optional<std::vector<WString>> MatchGroups(const WString& text, const WRegex& pattern) {
    WSmatch match;
    if (!std::regex_search(text, match, pattern)) return std::nullopt;
    std::vector<WString> groups;
    for (const auto& group : match) groups.push_back(group.str());
    return groups;
}

WString Replace(const WString& text, const WRegex& pattern, const WString& with) {
    return std::regex_replace(text, pattern, with);
}

// Trims the ASCII white space that file names carry, as String.prototype.trim does for them.
WString Trim(const WString& text) {
    const std::size_t first = text.find_first_not_of(L" \t\r\n\v\f");
    if (first == WString::npos) return L"";
    const std::size_t last = text.find_last_not_of(L" \t\r\n\v\f");
    return text.substr(first, last - first + 1);
}

const WRegex kSpaces = Compile(LR"re(\s+)re");
const WRegex kDotsAndUnderscores = Compile(LR"re([._]+)re");
const WRegex kExtension = Compile(LR"re(\.[a-z0-9]{2,4}$)re");

// Collapses white space runs, then trims: how the spaced release name is read.
WString Spaced(const WString& name) {
    WString spaced = Replace(name, kExtension, L"");
    spaced = Replace(spaced, kDotsAndUnderscores, L" ");
    return Trim(Replace(spaced, kSpaces, L" "));
}

const WRegex kEpisodeRange = Compile(LR"re(\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-{DASH}]\s*E?\d{1,2}\b)re");
const WRegex kSeasonSpan = Compile(LR"re(\bS\d{1,2}\s*[-{DASH}]\s*S?\d{1,2}\b)re");
const WRegex kSeasonEpisodeAny = Compile(LR"re(\bS\d{1,2}[\s._-]*E\d{1,2}\b)re");
const WRegex kPackWords =
    Compile(LR"re(\b(S\d{1,2}|season|seasons|complete|collection|box\s*set|temporada)\b)re");

bool IsEpisodeRange(const WString& name) {
    return Matches(name, kEpisodeRange) || Matches(name, kSeasonSpan);
}

// Release words that name quality, codec or source. Removed from titles.
const WRegex kJunk = Compile(
    LR"re(\b(1080p|720p|2160p|480p|4k|uhd|hdr10\+?|hdr|dv|webrip|web-?dl|bluray|blu-ray|bdrip|brrip|hdrip|dvdrip|bdremux|x264|x265|h264|h265|hevc10?|avc|aac|dts|truehd|atmos|remux|proper|repack|extended|unrated|directors?\.?cut|multi|subbed|dubbed|internal|limited|complete|season|s\d{1,2}e\d{1,2}|e\d{1,2}|ita|eng|spa|subs?|dlmux|oxtorrent|eztv|rartv|rarbg|yts|yify|tgx|10bit|imax|nvenc|web)\b)re");

const WRegex kSkippedFile = Compile(LR"re(\.(srt|idx|sub|nfo|txt|jpg|jpeg|png|gif|bmp|exe|zip|rar|7z|iso|sfv|md5|url)$)re");
const WRegex kYear = Compile(LR"re(\b(19|20)\d{2}\b)re");
const WRegex kAnyYear = Compile(LR"re(\b(?:19|20)\d{2}\b)re");
const WRegex kTitleCut = Compile(
    LR"re(\b(?:S(?:eason)?[\s._-]*\d{1,2}(?:[\s._-]*E[\s._-]*\d{1,2})?|\d{1,2}x\d{1,2}|Season[\s._-]*\d{1,2})\b)re");
const WRegex kQualityWords = Compile(
    LR"re(\b(?:\d{3,4}p|2160p|1080p|720p|480p|4k|uhd|complete|collection|box\s*set|bluray|webrip|web-?dl)\b)re");
const WRegex kSeasonEpisodeWithRest = Compile(LR"re(\bS\d{1,2}[\s._-]*E\d{1,2}\b(.*)$)re");
const WRegex kLeadingSeparators = Compile(LR"re(^[\s\-{DASH}:._]+)re");
const WRegex kReleaseTail = Compile(
    LR"re(\b(?:\d{3,4}p|2160p|1080p|720p|480p|4k|uhd|hdr|webrip|web-?dl|bluray|x264|x265|h264|h265|hevc)\b.*$)re");
const WRegex kEpisodeSxxExx = Compile(LR"re(\bS(\d{1,2})[\s._-]*E(\d{1,2})\b)re");
const WRegex kEpisodeNxM = Compile(LR"re(\b(\d{1,2})x(\d{1,2})\b)re");
const WRegex kEpisodeWords = Compile(LR"re(\bSeason[\s._-]*(\d{1,2})\D{0,20}(?:Episode|Ep)[\s._-]*(\d{1,2})\b)re");
const WRegex kSeasonSxx = Compile(LR"re(\bS(?:eason)?[\s._-]*(\d{1,2})\b)re");
const WRegex kSeasonWord = Compile(LR"re(\bSeason[\s._-]*(\d{1,2})\b)re");

// Filename text before season, episode, year or quality, so episode names do not become the title.
WString ReleaseTitleHead(const WString& filename) {
    const WString spaced = Spaced(filename);
    const long episodeAt = Search(spaced, kTitleCut);
    const long yearAt = Search(spaced, kAnyYear);
    const long qualityAt = Search(spaced, kQualityWords);

    long cut = -1;
    for (const long at : {episodeAt, yearAt, qualityAt}) {
        if (at > 0 && (cut < 0 || at < cut)) cut = at;
    }
    if (cut < 0) return spaced;
    const WString head = Trim(spaced.substr(0, static_cast<std::size_t>(cut)));
    return head.size() >= 2 ? head : spaced;
}

// The base name the title is read from: extension, brackets, website names and separators removed.
WString BaseName(const WString& name) {
    static const WRegex kBrackets = Compile(LR"re(\[[^\]]*\])re");
    static const WRegex kBraces = Compile(LR"re(\{[^}]*\})re");
    static const WRegex kWebsiteInBrackets = Compile(LR"re(\([^)]*www[^)]*\))re");
    static const WRegex kWebsite = Compile(LR"re(www\.\S+)re");
    static const WRegex kGroupSuffix = Compile(LR"re(\s-\s?[A-Za-z0-9@]+$)re");

    WString base = Replace(name, kExtension, L"");
    base = Replace(base, kBrackets, L" ");
    base = Replace(base, kBraces, L" ");
    base = Replace(base, kWebsiteInBrackets, L" ");
    base = Replace(base, kWebsite, L" ");
    base = Replace(base, kDotsAndUnderscores, L" ");
    return Replace(base, kGroupSuffix, L" ");
}

}  // namespace

bool IsPlayableFile(const std::string& filename, const std::optional<std::string>& mimeType) {
    if (mimeType.has_value() && mimeType->rfind("audio/", 0) == 0) return false;
    return !Matches(util::ToWide(filename), kSkippedFile);
}

ParsedName ParseFilename(const std::string& filename) {
    const WString name = util::ToWide(filename);
    const WString base = BaseName(name);

    ParsedName parsed;
    if (const auto year = MatchGroups(base, kYear)) parsed.year = std::stoi((*year)[0]);

    const WString head = ReleaseTitleHead(base);
    WString title = Trim(Replace(Replace(head, kJunk, L" "), kSpaces, L" "));
    if (title.empty()) title = Trim(base);
    if (title.empty()) title = name;
    parsed.title = util::ToUtf8(title);
    return parsed;
}

std::optional<Episode> ParseEpisode(const std::string& filename) {
    const WString name = util::ToWide(filename);
    if (IsEpisodeRange(name)) return std::nullopt;

    std::optional<std::vector<WString>> match = MatchGroups(name, kEpisodeSxxExx);
    if (!match) match = MatchGroups(name, kEpisodeNxM);
    if (!match) match = MatchGroups(name, kEpisodeWords);
    if (!match) return std::nullopt;

    const int season = std::stoi((*match)[1]);
    const int episode = std::stoi((*match)[2]);
    if (season < 1 || episode < 1) return std::nullopt;
    return Episode{season, episode};
}

std::optional<std::string> ParseEpisodeTitle(const std::string& filename) {
    const std::optional<std::vector<WString>> match = MatchGroups(Spaced(util::ToWide(filename)), kSeasonEpisodeWithRest);
    if (!match || match->size() < 2) return std::nullopt;

    WString rest = Replace((*match)[1], kLeadingSeparators, L"");
    rest = Replace(rest, kReleaseTail, L"");
    rest = Replace(rest, kJunk, L" ");
    rest = Trim(Replace(rest, kSpaces, L" "));
    if (rest.size() < 2 || rest.size() > 52) return std::nullopt;
    return util::ToUtf8(rest);
}

std::optional<int> ParseSeason(const std::string& filename) {
    const WString name = util::ToWide(filename);
    std::optional<std::vector<WString>> match = MatchGroups(name, kSeasonSxx);
    if (!match) match = MatchGroups(name, kSeasonWord);
    if (!match) return std::nullopt;

    const int season = std::stoi((*match)[1]);
    return season > 0 ? std::optional<int>(season) : std::nullopt;
}

bool LooksLikePack(const std::string& title, const std::string& filename) {
    const WString name = util::ToWide(title) + L" " + util::ToWide(filename);
    if (IsEpisodeRange(name)) return true;
    if (Matches(name, kSeasonEpisodeAny)) return false;
    return Matches(name, kPackWords);
}

bool IsHttpUrl(const std::string& value) {
    const std::size_t schemeEnd = value.find("://");
    if (schemeEnd == std::string::npos) return false;
    std::string scheme = value.substr(0, schemeEnd);
    for (char& c : scheme) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    if (scheme != "http" && scheme != "https") return false;

    // The host sits between the scheme and the first path, query or fragment mark. A user name
    // before an '@' is not part of the host, and the host may not hold spaces or control characters.
    const std::size_t hostStart = schemeEnd + 3;
    const std::size_t hostEnd = value.find_first_of("/?#", hostStart);
    std::string authority = value.substr(hostStart, hostEnd == std::string::npos ? std::string::npos : hostEnd - hostStart);
    const std::size_t at = authority.rfind('@');
    if (at != std::string::npos) authority = authority.substr(at + 1);
    if (authority.empty()) return false;
    for (const char c : authority) {
        if (static_cast<unsigned char>(c) <= 0x20 || c == '<' || c == '>' || c == '^' || c == '|' || c == '\\') {
            return false;
        }
    }
    return true;
}

std::optional<std::string> HttpAssetUrl(const std::string& value) {
    const std::string trimmed = util::Trim(value);
    if (trimmed.empty()) return std::nullopt;
    const std::string next = trimmed.rfind("//", 0) == 0 ? "https:" + trimmed : trimmed;
    if (!IsHttpUrl(next)) return std::nullopt;
    return next;
}

}  // namespace tvm::catalog::title
