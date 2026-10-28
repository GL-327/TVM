#include "catalog/playback.h"

#include <algorithm>
#include <cctype>
#include <map>
#include <regex>
#include <set>

#include "catalog/catalog_service.h"
#include "catalog/realdebrid.h"
#include "catalog/title.h"
#include "core/util.h"

namespace tvm::playback {

namespace {

constexpr char kTorrentioBase[] = "https://torrentio.strem.fun";
constexpr char kTorrentioAgent[] = "tvm-core";
constexpr unsigned kTorrentioTimeoutMs = 14000;
constexpr int kMaxResolveHops = 3;

bool Matches(const std::string& text, const char* pattern) {
    return std::regex_search(text, std::regex(pattern, std::regex::ECMAScript | std::regex::icase));
}

int QualityScore(const std::string& label) {
    if (Matches(label, R"(\b2160p|4k|uhd\b)")) return 40;
    if (Matches(label, R"(\b1080p\b)")) return 30;
    if (Matches(label, R"(\b720p\b)")) return 15;
    if (Matches(label, R"(\b480p\b)")) return 5;
    return 10;
}

std::string JsonText(const nlohmann::json& raw, const char* key) {
    const auto found = raw.find(key);
    return found != raw.end() && found->is_string() ? found->get<std::string>() : std::string();
}

std::string Lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

// The file name at the end of an address, without its query.
std::string FileNameOf(const std::string& url) {
    std::string path = url.substr(0, url.find_first_of("?#"));
    const std::size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

// "Title · S1 E2" for an episode file, else the file's title, as the Node core names a stream.
std::string StreamTitle(const std::string& filename, const std::string& fallback) {
    const catalog::title::ParsedName parsed = catalog::title::ParseFilename(filename);
    std::string name = parsed.title.empty() ? fallback : parsed.title;
    if (const std::optional<catalog::title::Episode> episode = catalog::title::ParseEpisode(filename)) {
        name += " \xC2\xB7 S" + std::to_string(episode->season) + " E" + std::to_string(episode->episode);
    }
    return name.empty() ? fallback : name;
}

}  // namespace

std::optional<PlayId> ParsePlayId(const std::string& id) {
    static const std::regex kPattern(R"(^(tt\d+)(?::(\d+):(\d+))?$)", std::regex::ECMAScript | std::regex::icase);
    std::smatch match;
    const std::string trimmed = util::Trim(id);
    if (!std::regex_match(trimmed, match, kPattern)) return std::nullopt;
    PlayId play;
    play.imdb = Lower(match[1].str());
    if (match[2].matched && match[3].matched) {
        play.season = std::stoi(match[2].str());
        play.episode = std::stoi(match[3].str());
        if (*play.episode < 1) return std::nullopt;
    }
    return play;
}

std::vector<std::string> TorrentioStreamPaths(const std::string& imdb, std::optional<int> season,
                                              std::optional<int> episode) {
    const std::string id = imdb.rfind("tt", 0) == 0 ? imdb : "tt" + imdb;
    if (season.has_value() && episode.has_value()) {
        const std::string s = std::to_string(*season);
        const std::string e = std::to_string(*episode);
        return {"stream/series/" + id + ":" + s + ":" + e + ".json",
                "stream/series/" + id + ":" + s + ":" + (e.size() < 2 ? "0" + e : e) + ".json"};
    }
    return {"stream/movie/" + id + ".json", "stream/series/" + id + ".json"};
}

std::optional<DebridStream> ParseDebridStream(const nlohmann::json& raw) {
    if (!raw.is_object()) return std::nullopt;
    const std::string url = JsonText(raw, "url");
    if (!Matches(url, R"(^https?:\/\/)") || Matches(url, R"(failed_access|videos\/failed|copyright|infringement)")) {
        return std::nullopt;
    }
    const std::string name = JsonText(raw, "name");
    std::string title = JsonText(raw, "title");
    if (title.empty()) title = name.empty() ? "Stream" : name;
    title = title.substr(0, title.find('\n'));
    if (Matches(title, R"(\b(cam|camrip|telesync|tsrip|hdcam|hdts)\b)")) return std::nullopt;

    const std::string label = name + " " + title;
    DebridStream stream;
    stream.url = url;
    stream.title = title;
    stream.quality = QualityScore(label);
    // The lightning sign is Torrentio's mark for a file already on Real-Debrid.
    stream.cached = label.find("\xE2\x9A\xA1") != std::string::npos ||
                    Matches(label, R"(\bcached\b|\brd\+|\bdownloaded\b)");
    stream.description = name + " " + JsonText(raw, "title");
    return stream;
}

int StreamHeight(const std::string& label) {
    if (Matches(label, R"(\b2160p|4k|uhd\b)")) return 2160;
    if (Matches(label, R"(\b1080p\b)")) return 1080;
    if (Matches(label, R"(\b720p\b)")) return 720;
    if (Matches(label, R"(\b480p\b)")) return 480;
    return 1080;
}

std::vector<DebridStream> RankDebridStreams(std::vector<DebridStream> streams) {
    // A cached low resolution file should not win over a 4K source the viewer chose, so
    // the cache only breaks ties at one resolution. The sort is stable, as JavaScript's is.
    std::stable_sort(streams.begin(), streams.end(), [](const DebridStream& left, const DebridStream& right) {
        if (left.quality != right.quality) return left.quality > right.quality;
        return left.cached && !right.cached;
    });
    return streams;
}

std::vector<DebridStream> CapStreamsToHeight(const std::vector<DebridStream>& streams, int maxHeight) {
    std::vector<DebridStream> capped;
    for (const DebridStream& stream : streams) {
        const std::string& label = stream.description.empty() ? stream.title : stream.description;
        if (StreamHeight(label) <= maxHeight) capped.push_back(stream);
    }
    if (!capped.empty()) return capped;
    for (const DebridStream& stream : streams) {
        if (stream.quality <= 15) capped.push_back(stream);
    }
    return capped;
}

bool IsTorrentioHost(const std::string& url) {
    static const std::regex kHost(R"(^https?:\/\/torrentio\.strem\.fun(?:[:\/?#]|$))",
                                  std::regex::ECMAScript | std::regex::icase);
    return std::regex_search(url, kHost);
}

bool IsLikelyDirectPlayUrl(const std::string& url) {
    if (!Matches(url, R"(^https?:\/\/)")) return false;
    if (Matches(url, R"(download\.real-debrid\.com)")) return true;
    if (Matches(url, R"(real-debrid\.com\/d\/)")) return false;
    return Matches(url, R"(\.(m3u8|mp4|m4v|mkv|webm|mov)(\?|$))");
}

namespace {

struct LanguageMarks {
    const char* code;
    // Country flags, as two capital letters, and the words release names use for the language.
    std::vector<std::string> flags;
    std::vector<std::string> words;
};

const std::vector<LanguageMarks>& AllLanguageMarks() {
    static const std::vector<LanguageMarks> marks = {
        {"en", {"GB", "US", "AU", "NZ", "IE"}, {"eng", "english"}},
        {"ja", {"JP"}, {"jap", "japanese", "jpn"}},
        {"fr", {"FR"}, {"fre", "french", "vff", "vfq", "vf2", "vfi", "truefrench", "fra"}},
        {"de", {"DE", "AT"}, {"ger", "german", "deu"}},
        {"es", {"ES", "MX", "AR"}, {"spa", "spanish", "latino", "castellano", "esp"}},
        {"it", {"IT"}, {"ita", "italian"}},
        {"pt", {"PT", "BR"}, {"por", "portuguese", "dublado"}},
        {"ko", {"KR"}, {"kor", "korean"}},
        {"hi", {"IN"}, {"hin", "hindi"}},
        {"ru", {"RU"}, {"rus", "russian"}},
        {"uk", {"UA"}, {"ukr", "ukrainian"}},
        {"pl", {"PL"}, {"pol", "polish", "lektor"}},
        {"zh", {"CN", "TW", "HK"}, {"chi", "chinese", "mandarin"}},
        {"ar", {"SA", "AE", "EG"}, {"ara", "arabic"}},
        {"tr", {"TR"}, {"tur", "turkish"}},
        {"nl", {"NL", "BE"}, {"dut", "dutch"}},
        {"sv", {"SE"}, {"swe", "swedish"}},
        {"th", {"TH"}, {"tha", "thai"}},
    };
    return marks;
}

// The flags in a name: each pair of regional indicator letters, U+1F1E6 to U+1F1FF, as its two capitals.
std::vector<std::string> FlagsIn(const std::string& text) {
    std::vector<std::string> flags;
    std::string pending;
    const auto byte = [&](std::size_t at) { return static_cast<unsigned char>(text[at]); };
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (i + 3 < text.size() && byte(i) == 0xF0 && byte(i + 1) == 0x9F && byte(i + 2) == 0x87 && byte(i + 3) >= 0xA6 &&
            byte(i + 3) <= 0xBF) {
            pending += static_cast<char>('A' + (byte(i + 3) - 0xA6));
            i += 3;
            if (pending.size() == 2) {
                flags.push_back(pending);
                pending.clear();
            }
        } else {
            pending.clear();
        }
    }
    return flags;
}

// Whether a lower-case name has a word on its own, between non-letters, as release names separate them.
bool HasWord(const std::string& lower, const std::string& word) {
    for (std::size_t at = lower.find(word); at != std::string::npos; at = lower.find(word, at + 1)) {
        const bool before = at == 0 || !std::isalpha(static_cast<unsigned char>(lower[at - 1]));
        const std::size_t end = at + word.size();
        const bool after = end >= lower.size() || !std::isalpha(static_cast<unsigned char>(lower[end]));
        if (before && after) return true;
    }
    return false;
}

}  // namespace

int LanguageFit(const std::string& description, const std::string& language) {
    if (language.empty()) return 0;
    std::string lower = description;
    for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    // "Multi-sub" is subtitles, not audio, so it is read as subtitles before MULTi is looked for.
    for (const char* subs : {"multi-subs", "multi-sub", "multi.subs", "multi.sub", "multisubs", "multisub", "multi subs", "multi sub"}) {
        for (std::size_t at = lower.find(subs); at != std::string::npos; at = lower.find(subs)) lower.replace(at, std::string(subs).size(), "subs");
    }
    const std::vector<std::string> flags = FlagsIn(description);
    bool wanted = false;
    bool other = false;
    for (const LanguageMarks& marks : AllLanguageMarks()) {
        bool speaks = std::any_of(marks.words.begin(), marks.words.end(), [&](const std::string& word) { return HasWord(lower, word); });
        for (const std::string& flag : marks.flags) {
            if (std::find(flags.begin(), flags.end(), flag) != flags.end()) speaks = true;
        }
        if (!speaks) continue;
        if (language == marks.code) wanted = true;
        else other = true;
    }
    // A flag the table does not name is still another language.
    for (const std::string& flag : flags) {
        const bool known = std::any_of(AllLanguageMarks().begin(), AllLanguageMarks().end(), [&](const LanguageMarks& marks) {
            return std::find(marks.flags.begin(), marks.flags.end(), flag) != marks.flags.end();
        });
        if (!known) other = true;
    }
    // MULTi and dual-audio releases carry more than one track, and their first is often a dub.
    if (HasWord(lower, "multi") || HasWord(lower, "dual")) other = true;
    // Torrentio flags only the languages that are not English, so an unmarked name is English.
    if (language == "en" && !other) return 0;
    if (wanted && !other) return 0;
    if (wanted) return 1;
    return -1;
}

std::vector<DebridStream> KeepLanguage(const std::vector<DebridStream>& streams, const std::string& language) {
    if (language.empty()) return streams;
    std::vector<std::pair<int, DebridStream>> fitted;
    for (const DebridStream& stream : streams) {
        const int fit = LanguageFit(stream.description.empty() ? stream.title : stream.description, language);
        // Only a release in that language alone: a multilingual file that also has it can open on another track.
        if (fit == 0) fitted.emplace_back(fit, stream);
    }
    std::stable_sort(fitted.begin(), fitted.end(), [](const auto& left, const auto& right) { return left.first < right.first; });
    std::vector<DebridStream> kept;
    for (auto& entry : fitted) kept.push_back(std::move(entry.second));
    return kept;
}

std::string ErrorMessage(const std::string& reason) {
    static const std::map<std::string, std::string> kMessages = {
        {"not-in-library", "No playable stream was found. It may not be cached on Real-Debrid yet."},
        {"empty", "Torrentio returned no streams for this title. Try another episode, or retry later."},
        {"unsupported",
         "This file could not be opened. Real-Debrid may have returned a broken link, or the format is not playable."},
        {"needs-auth", "Real-Debrid rejected the saved token. Reconnect Real-Debrid and paste a new one."},
        {"not-configured", "Real-Debrid is not connected. Open the connection settings and paste a token."},
        {"timeout", "Finding a playable stream took too long. Press Retry, or Back to choose another title."},
        {"internal", "Playback failed inside TVM. Retry, or check that core is running."},
        {"no-language", "No source in the chosen audio language was found for this title. Try another language or quality."},
    };
    const auto found = kMessages.find(reason);
    if (found != kMessages.end()) return found->second;
    const std::string trimmed = util::Trim(reason);
    return trimmed.empty() ? kMessages.at("internal") : trimmed;
}

Resolver::Resolver(realdebrid::Client& realDebrid, catalog::CatalogService& catalog, http::Transport transport)
    : realDebrid_(realDebrid), catalog_(catalog), transport_(std::move(transport)) {}

std::optional<std::string> Resolver::ResolveTorrentioUrl(const std::string& url, int hops) const {
    if (!IsTorrentioHost(url)) return url;
    if (hops >= kMaxResolveHops) return std::nullopt;

    http::Options options;
    options.userAgent = kTorrentioAgent;
    options.timeoutMs = kTorrentioTimeoutMs;
    options.followRedirects = false;
    // A resolve answers with a redirect or a little JSON. Anything large is not an answer.
    options.maxBytes = 1024 * 1024;
    const std::optional<http::Response> response = transport_(url, options);
    if (!response.has_value()) return std::nullopt;

    if (!response->location.empty()) {
        std::string next = response->location;
        // A relative Location is on the same host.
        if (next.front() == '/') next = std::string(kTorrentioBase) + next;
        if (IsTorrentioHost(next)) return ResolveTorrentioUrl(next, hops + 1);
        return http::IsWebUrl(next) ? std::optional<std::string>(next) : std::nullopt;
    }
    if (Lower(response->contentType).find("json") == std::string::npos) return std::nullopt;
    const nlohmann::json body = nlohmann::json::parse(response->body, nullptr, false);
    const std::string target = body.is_object() ? JsonText(body, "url") : std::string();
    if (!Matches(target, R"(^https?:\/\/)")) return std::nullopt;
    return IsTorrentioHost(target) ? ResolveTorrentioUrl(target, hops + 1) : std::optional<std::string>(target);
}

std::vector<DebridStream> Resolver::FetchTorrentioStreams(const std::string& token, const PlayId& id) const {
    const std::string base = std::string(kTorrentioBase) + "/realdebrid=" + util::FormEncode(token);
    std::set<std::string> seen;
    std::vector<DebridStream> streams;
    for (const std::string& path : TorrentioStreamPaths(id.imdb, id.season, id.episode)) {
        http::Options options;
        options.userAgent = kTorrentioAgent;
        options.accept = "application/json";
        options.timeoutMs = kTorrentioTimeoutMs;
        const std::optional<http::Response> response = transport_(base + "/" + path, options);
        if (!response.has_value() || !response->ok()) continue;
        const nlohmann::json body = nlohmann::json::parse(response->body, nullptr, false);
        if (!body.is_object() || !body.contains("streams") || !body["streams"].is_array()) continue;
        for (const nlohmann::json& raw : body["streams"]) {
            std::optional<DebridStream> stream = ParseDebridStream(raw);
            if (!stream.has_value() || !seen.insert(stream->url).second) continue;
            streams.push_back(std::move(*stream));
        }
        if (!streams.empty()) break;
    }
    return streams;
}

Resolution Resolver::PlayFromLink(const std::string& link, const std::string& fallbackTitle) const {
    Resolution result;
    if (!catalog::title::IsHttpUrl(link)) {
        result.reason = "unsupported";
        return result;
    }
    if (IsLikelyDirectPlayUrl(link)) {
        result.url = link;
        result.title = StreamTitle(FileNameOf(link), fallbackTitle);
        return result;
    }
    try {
        const realdebrid::Unrestricted unrestricted = realDebrid_.Unrestrict(link);
        if (unrestricted.download.empty()) {
            result.reason = "unsupported";
            return result;
        }
        result.url = unrestricted.download;
        result.title = StreamTitle(unrestricted.filename, fallbackTitle);
    } catch (const realdebrid::RequestError& error) {
        result.reason = error.failure() == realdebrid::Failure::NeedsAuth ? "needs-auth" : "unsupported";
    } catch (const std::exception&) {
        result.reason = "unsupported";
    }
    return result;
}

Resolution Resolver::PlayFromTorrentio(PlayId id, const ResolveInput& input) const {
    Resolution last;
    last.reason = "empty";
    const std::optional<std::string> token = realDebrid_.Token();
    if (!token.has_value() || token->empty()) {
        last.reason = "not-configured";
        return last;
    }
    // A series opened without an episode plays its first one, as the Node core does.
    if (!id.season.has_value() || !id.episode.has_value()) {
        try {
            const std::optional<catalog::TitleMeta> meta = catalog_.Meta(id.imdb);
            if (meta.has_value() && meta->item.kind == "series" && !meta->children.empty()) {
                const catalog::MediaItem& first = meta->children.front();
                if (!id.season.has_value()) id.season = first.season;
                if (!id.episode.has_value()) id.episode = first.episode;
            }
        } catch (const std::exception&) {
            // Without the episodes the title is asked for as a movie, then as a series.
        }
    }

    const std::vector<DebridStream> streams = FetchTorrentioStreams(*token, id);
    const std::vector<DebridStream> capped = CapStreamsToHeight(RankDebridStreams(streams), input.maxHeight);
    // A language asked for is a must: a stream in another language is never played or saved instead.
    const std::vector<DebridStream> ranked = KeepLanguage(capped, input.language);
    if (!input.language.empty() && ranked.empty() && !capped.empty()) {
        last.reason = "no-language";
        return last;
    }

    // The quality menu offers the best twelve streams, best first, so it stays a short list.
    constexpr std::size_t kChoiceLimit = 12;
    std::vector<StreamChoice> choices;
    std::vector<std::size_t> choiceOf(ranked.size(), 0);
    for (std::size_t i = 0; i < ranked.size() && i < kChoiceLimit; ++i) {
        const DebridStream& stream = ranked[i];
        const int height = StreamHeight(stream.description.empty() ? stream.title : stream.description);
        StreamChoice choice;
        choice.height = height;
        choice.cached = stream.cached;
        choice.label = (height >= 2160 ? std::string("4K") : std::to_string(height) + "p") + (stream.cached ? "" : " \xC2\xB7 not cached");
        choice.detail = stream.title;
        choice.url = stream.url;
        choiceOf[i] = choices.size();
        choices.push_back(std::move(choice));
    }

    for (std::size_t i = 0; i < ranked.size() && i < kPlayableStreamLimit; ++i) {
        const std::optional<std::string> resolved = ResolveTorrentioUrl(ranked[i].url);
        if (!resolved.has_value() || IsTorrentioHost(*resolved)) continue;
        Resolution result = PlayFromLink(*resolved, input.title);
        if (result.ok()) {
            result.choices = choices;
            result.chosen = choiceOf[i];
            return result;
        }
        if (result.reason == "needs-auth") return result;
        last = result;
    }
    return last;
}

Resolution Resolver::ResolveChoice(const StreamChoice& choice, const std::string& fallbackTitle) const {
    try {
        const std::optional<std::string> resolved = ResolveTorrentioUrl(choice.url);
        if (resolved.has_value() && !IsTorrentioHost(*resolved)) return PlayFromLink(*resolved, fallbackTitle);
    } catch (const std::exception&) {
        // Reported below as a stream that would not open.
    }
    Resolution failed;
    failed.reason = "not-in-library";
    return failed;
}

std::optional<std::string> Resolver::OwnedLink(const std::string& id) const {
    // rd:t:<torrent>:<index> is a file of a torrent, rd:d:<download> a download, as the library names them.
    try {
        if (id.rfind("rd:t:", 0) == 0) {
            const std::string rest = id.substr(5);
            const std::size_t colon = rest.find_last_of(':');
            const std::string torrentId = colon == std::string::npos ? rest : rest.substr(0, colon);
            const std::size_t index = colon == std::string::npos ? 0 : std::stoul(rest.substr(colon + 1));
            const realdebrid::TorrentInfo info = realDebrid_.GetTorrentInfo(torrentId);
            if (index < info.links.size() && !info.links[index].empty()) return info.links[index];
            return std::nullopt;
        }
        const std::string downloadId = id.rfind("rd:d:", 0) == 0 ? id.substr(5) : id.substr(3);
        for (const realdebrid::Download& download : realDebrid_.Downloads()) {
            if (download.id == downloadId && !download.link.empty()) return download.link;
        }
    } catch (const std::exception&) {
        // Real-Debrid did not answer, so the file cannot be found.
    }
    return std::nullopt;
}

Resolution Resolver::Resolve(const ResolveInput& input) const {
    Resolution result;
    try {
        if (input.id.rfind("rd:", 0) == 0) {
            if (!realDebrid_.Token().has_value()) {
                result.reason = "not-configured";
                return result;
            }
            if (const std::optional<std::string> owned = OwnedLink(input.id)) return PlayFromLink(*owned, input.title);
            result.reason = "not-in-library";
            return result;
        }
        if (const std::optional<PlayId> id = ParsePlayId(input.id)) return PlayFromTorrentio(*id, input);
        static const std::regex kImdb(R"(tt\d+)", std::regex::ECMAScript | std::regex::icase);
        std::smatch match;
        if (std::regex_search(input.id, match, kImdb)) {
            PlayId id;
            id.imdb = Lower(match.str());
            return PlayFromTorrentio(id, input);
        }
        result.reason = "not-in-library";
    } catch (const std::exception&) {
        result.reason = "empty";
    }
    return result;
}

}  // namespace tvm::playback
