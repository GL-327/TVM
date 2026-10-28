#include "catalog/live.h"

#include <algorithm>
#include <cstdint>
#include <format>
#include <map>
#include <regex>
#include <set>
#include <utility>

#include <nlohmann/json.hpp>

#include "catalog/title.h"
#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

namespace tvm::live {

namespace {

std::string Lower(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return text;
}

// The value of name="..." in a line, found without regard to case. Nothing when the
// attribute is missing or its quote is never closed.
std::optional<std::string> Attribute(const std::string& line, const std::string& name) {
    const std::string needle = Lower(name) + "=\"";
    const std::size_t at = Lower(line).find(needle);
    if (at == std::string::npos) return std::nullopt;
    const std::size_t start = at + needle.size();
    const std::size_t end = line.find('"', start);
    if (end == std::string::npos) return std::nullopt;
    return line.substr(start, end - start);
}

// Only ids of Live TV channels are read from the picks file.
bool IsPick(const std::string& id) {
    return id.rfind("live:", 0) == 0;
}

// The one place a playlist's text is checked against its size limit.
bool TooLarge(const std::string& text) {
    return text.size() > kMaxPlaylistBytes;
}

const std::regex kM3u8Address(R"(\.m3u8(\?|$))", std::regex::icase);

}  // namespace

std::string ChannelId(const std::string& url) {
    // The Node core hashes UTF-16 code units, which is what a wide string holds on Windows.
    std::uint32_t hash = 2166136261u;
    for (const wchar_t unit : util::ToWide(url)) {
        hash ^= static_cast<std::uint32_t>(unit);
        hash *= 16777619u;
    }
    return "live:" + std::format("{:x}", hash);
}

std::string GroupOf(const catalog::LiveChannel& channel) {
    const std::string group = util::Trim(channel.group.value_or(""));
    return group.empty() ? "Live" : group;
}

std::vector<catalog::LiveChannel> ParseM3u(const std::string& text) {
    struct Pending {
        std::string name;
        std::optional<std::string> group;
        std::optional<std::string> logo;
    };

    std::vector<catalog::LiveChannel> channels;
    std::set<std::string> used;
    std::optional<Pending> pending;
    std::optional<std::string> groupHint;

    // Each line is read on its own, without its line break and surrounding white space.
    std::size_t start = 0;
    while (start <= text.size()) {
        std::size_t end = text.find('\n', start);
        if (end == std::string::npos) end = text.size();
        const std::string line = util::Trim(text.substr(start, end - start));
        start = end + 1;
        if (line.empty() || line == "#EXTM3U") continue;

        if (line.rfind("#EXTGRP:", 0) == 0) {
            const std::string group = util::Trim(line.substr(std::string("#EXTGRP:").size()));
            groupHint = group.empty() ? std::nullopt : std::optional<std::string>(group);
            continue;
        }

        if (line.rfind("#EXTINF:", 0) == 0) {
            const std::size_t comma = line.find(',');
            const std::string title = comma == std::string::npos ? "" : util::Trim(line.substr(comma + 1));
            const std::optional<std::string> named = Attribute(line, "tvg-name");
            std::optional<std::string> group = Attribute(line, "group-title");
            if (!group.has_value()) group = groupHint;
            const std::optional<std::string> logoRaw = Attribute(line, "tvg-logo");

            Pending next;
            next.name = (named.has_value() && !named->empty()) ? *named : title;
            if (next.name.empty()) next.name = "Channel";
            next.group = group;
            if (logoRaw.has_value()) next.logo = catalog::title::HttpAssetUrl(*logoRaw);
            pending = std::move(next);
            continue;
        }

        // Any other comment line is a header line. Those are read for playback, which is not ported yet.
        if (line.front() == '#') continue;

        if (!catalog::title::IsHttpUrl(line)) {
            pending.reset();
            continue;
        }

        std::string id = ChannelId(line);
        if (used.contains(id)) {
            int n = 2;
            while (used.contains(id + "-" + std::to_string(n))) ++n;
            id += "-" + std::to_string(n);
        }
        used.insert(id);

        catalog::LiveChannel channel;
        channel.id = id;
        channel.name = pending.has_value() ? pending->name : "Channel " + std::to_string(channels.size() + 1);
        channel.url = line;
        if (pending.has_value() && pending->group.has_value() && !pending->group->empty()) channel.group = pending->group;
        if (pending.has_value() && pending->logo.has_value()) channel.logo = pending->logo;
        channels.push_back(channel);
        pending.reset();
    }
    return channels;
}

Playlist ReadPlaylist(const paths::fs::path& dataDir) {
    Playlist playlist;
    const std::optional<nlohmann::json> stored = secrets::ReadPrivateJson(dataDir, paths::LivePlaylistPath(dataDir));
    if (!stored.has_value() || !stored->is_object()) return playlist;

    const auto url = stored->find("url");
    if (url != stored->end() && url->is_string() && catalog::title::IsHttpUrl(url->get<std::string>())) {
        playlist.url = url->get<std::string>();
    }
    const auto text = stored->find("text");
    if (text != stored->end() && text->is_string() && !util::Trim(text->get<std::string>()).empty()) {
        playlist.text = text->get<std::string>();
    }
    return playlist;
}

bool LooksLikePlaylistText(const std::string& value) {
    const std::string trimmed = util::Trim(value);
    if (trimmed.empty() || TooLarge(trimmed)) return false;
    const std::string lower = Lower(trimmed);
    if (lower.rfind("#extm3u", 0) == 0 || lower.find("#extinf:") != std::string::npos) return true;
    return trimmed.find('\n') != std::string::npos &&
           (lower.find("http://") != std::string::npos || lower.find("https://") != std::string::npos);
}

namespace {

// Writes both fields, as the Node core does, with null for a field that is not set.
void WritePlaylist(const paths::fs::path& dataDir, const std::optional<std::string>& url,
                   const std::optional<std::string>& text) {
    const nlohmann::json stored{{"url", url.has_value() ? nlohmann::json(*url) : nlohmann::json(nullptr)},
                                {"text", text.has_value() ? nlohmann::json(*text) : nlohmann::json(nullptr)}};
    vault::WriteSealed(dataDir, paths::LivePlaylistPath(dataDir), stored);
}

}  // namespace

PlaylistChange SetPlaylist(const paths::fs::path& dataDir, const std::string& value) {
    const std::string trimmed = util::Trim(value);
    if (trimmed.empty()) {
        WritePlaylist(dataDir, std::nullopt, std::nullopt);
        return PlaylistChange::Cleared;
    }
    if (LooksLikePlaylistText(trimmed)) {
        // Text is kept only when it has channels, so a bad paste never replaces a good playlist.
        if (ParseM3u(trimmed).empty()) return PlaylistChange::Invalid;
        WritePlaylist(dataDir, std::nullopt, trimmed);
        return PlaylistChange::Stored;
    }
    if (!catalog::title::IsHttpUrl(trimmed)) return PlaylistChange::Invalid;
    WritePlaylist(dataDir, trimmed, std::nullopt);
    return PlaylistChange::Stored;
}

Catalog LoadCatalog(const paths::fs::path& dataDir, const xtream::Client& login, const http::Transport& transport) {
    Catalog catalog;
    if (const std::optional<xtream::Account> account = login.Saved()) {
        // The login's own channels are the whole catalogue while one is saved.
        catalog.login = true;
        catalog.host = account->host;
        catalog.username = account->username;
        const xtream::Load load = login.LoadChannels(*account);
        catalog.channels = load.channels;
        catalog.error = load.error;
        return catalog;
    }

    const Playlist playlist = ReadPlaylist(dataDir);
    catalog.playlist = playlist.url.has_value() || playlist.text.has_value();
    if (playlist.url.has_value()) {
        catalog.playlistUrl = playlist.url;
    } else if (playlist.text.has_value()) {
        catalog.playlistUrl = std::string(kPastedPlaylist);
    }

    if (playlist.text.has_value()) {
        if (TooLarge(*playlist.text)) {
            catalog.error = "invalid";
            return catalog;
        }
        catalog.channels = ParseM3u(*playlist.text);
        if (catalog.channels.empty()) catalog.error = "invalid";
        return catalog;
    }
    if (!playlist.url.has_value()) return catalog;

    const std::string& url = *playlist.url;
    const std::optional<http::Response> response = transport(url, http::Options{});
    if (!response.has_value() || !response->ok()) {
        catalog.error = "unreachable";
        return catalog;
    }
    if (TooLarge(response->body)) {
        catalog.error = "invalid";
        return catalog;
    }
    catalog.channels = ParseM3u(response->body);
    // A bare HLS address is a single channel, as the Node core treats it.
    if (catalog.channels.empty() && std::regex_search(url, kM3u8Address)) {
        catalog::LiveChannel channel;
        channel.id = ChannelId(url);
        channel.name = "Live stream";
        channel.url = url;
        catalog.channels.push_back(channel);
    }
    if (catalog.channels.empty()) catalog.error = "invalid";
    return catalog;
}

std::vector<std::string> ReadPicks(const paths::fs::path& dataDir) {
    std::vector<std::string> ids;
    const std::optional<std::string> text = util::ReadTextFile(paths::LivePicksPath(dataDir));
    if (!text.has_value()) return ids;

    const nlohmann::json parsed = nlohmann::json::parse(*text, nullptr, false);
    if (parsed.is_discarded() || !parsed.is_object()) return ids;
    const auto list = parsed.find("ids");
    if (list == parsed.end() || !list->is_array()) return ids;
    for (const nlohmann::json& entry : *list) {
        if (entry.is_string() && IsPick(entry.get<std::string>())) ids.push_back(entry.get<std::string>());
    }
    return ids;
}

void WritePicks(const paths::fs::path& dataDir, const std::vector<std::string>& ids) {
    const nlohmann::json stored{{"ids", ids}};
    util::WriteFileAtomically(paths::LivePicksPath(dataDir), stored.dump());
}

std::vector<std::string> AllowedPicks(const std::vector<catalog::LiveChannel>& channels, const std::vector<std::string>& ids) {
    std::set<std::string> known;
    for (const catalog::LiveChannel& channel : channels) known.insert(channel.id);

    std::vector<std::string> allowed;
    std::set<std::string> seen;
    for (const std::string& id : ids) {
        if (!known.contains(id) || seen.contains(id)) continue;
        seen.insert(id);
        allowed.push_back(id);
        if (allowed.size() >= kPickLimit) break;
    }
    return allowed;
}

std::vector<std::string> WithPick(const std::vector<catalog::LiveChannel>& channels, const std::vector<std::string>& picks,
                                  const std::string& id, bool picked) {
    std::vector<std::string> next = AllowedPicks(channels, picks);
    if (picked) {
        if (std::find(next.begin(), next.end(), id) == next.end()) next.push_back(id);
    } else {
        next.erase(std::remove(next.begin(), next.end(), id), next.end());
    }
    return AllowedPicks(channels, next);
}

Status Compose(const Catalog& catalog, const std::vector<std::string>& picks) {
    Status status;
    status.configured = catalog.login || catalog.playlist;
    status.host = catalog.host;
    status.username = catalog.username;
    if (!status.configured) return status;

    const std::vector<std::string> chosen = AllowedPicks(catalog.channels, picks);
    status.picked = chosen.size();
    status.total = catalog.channels.size();

    if (!chosen.empty()) {
        std::map<std::string, const catalog::LiveChannel*> byId;
        for (const catalog::LiveChannel& channel : catalog.channels) byId[channel.id] = &channel;
        for (const std::string& id : chosen) status.shown.push_back(*byId.at(id));
    } else if (catalog.channels.size() <= kPickLimit) {
        status.shown = catalog.channels;
    }

    status.needsPicks = catalog.error.empty() && catalog.channels.size() > kPickLimit && chosen.empty();
    if (!catalog.error.empty() && status.shown.empty()) status.error = catalog.error;
    return status;
}

}  // namespace tvm::live
