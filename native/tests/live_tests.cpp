// Live TV catalogue tests: the channel ids, the M3U reader, the saved playlist, the
// sources, the picks and the rules that decide what the screen lists. The cases follow
// apps/core/src/providers/live.ts. Files go to a temporary folder, and the network is a
// fake, so no test reaches a real panel or playlist.

#include <windows.h>

#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/live.h"
#include "catalog/live_channel.h"
#include "catalog/xtream.h"
#include "core/paths.h"
#include "core/util.h"
#include "core/vault.h"
#include "fake_network.h"
#include "harness.h"

namespace {

namespace fs = std::filesystem;
using tvm::catalog::LiveChannel;
using tvm::live::Catalog;
using tvm::live::Status;
using tvm::testing::Answer;
using tvm::testing::EnvWith;
using tvm::testing::FakeNetwork;
using tvm::testing::TempFolder;

// A playlist address that nothing answers, for tests that never reach the network.
tvm::http::Transport NoNetwork() {
    return [](const std::string&, const tvm::http::Options&) { return std::optional<tvm::http::Response>(); };
}

// Saves a playlist the way the Node core does: sealed, in the data folder.
void SavePlaylist(const fs::path& dir, const nlohmann::json& playlist) {
    tvm::vault::WriteSealed(dir, tvm::paths::LivePlaylistPath(dir), playlist);
}

LiveChannel Channel(const std::string& id, const std::string& group = "") {
    LiveChannel channel;
    channel.id = id;
    channel.name = id;
    channel.url = "";
    if (!group.empty()) channel.group = group;
    return channel;
}

std::vector<LiveChannel> Channels(std::size_t count) {
    std::vector<LiveChannel> channels;
    for (std::size_t i = 0; i < count; ++i) channels.push_back(Channel("live:c" + std::to_string(i)));
    return channels;
}

// ------------------------------------------------------------------ ids

TEST(live_channel_ids_are_the_node_hash) {
    // The values come from liveChannelId in live.ts.
    REQUIRE_EQ(tvm::live::ChannelId("https://example.com/a.m3u8"), std::string("live:3c2e92a6"));
    REQUIRE_EQ(tvm::live::ChannelId("http://panel.example:8080/live/a/b/1.ts"), std::string("live:1db3ec4e"));
    REQUIRE_EQ(tvm::live::ChannelId("https://cdn.example/Canal+ España.m3u8"), std::string("live:e75bc77e"));
}

TEST(live_group_is_trimmed_and_falls_back_to_live) {
    REQUIRE_EQ(tvm::live::GroupOf(Channel("a", " News ")), std::string("News"));
    REQUIRE_EQ(tvm::live::GroupOf(Channel("a", "   ")), std::string("Live"));
    REQUIRE_EQ(tvm::live::GroupOf(Channel("a")), std::string("Live"));
}

// ------------------------------------------------------------------ M3U

TEST(m3u_reads_names_groups_and_logos) {
    const std::string text =
        "#EXTM3U\r\n"
        "#EXTINF:-1 tvg-name=\"One HD\" group-title=\"News\" tvg-logo=\"//cdn.example/one.png\",Ignored title\r\n"
        "https://a.example/one.m3u8\r\n"
        "#EXTINF:-1 group-title=\"\",  Two  \n"
        "https://a.example/two.m3u8\n"
        "#EXTGRP:Sport\n"
        "#EXTINF:-1 tvg-logo=\"javascript:x\",\n"
        "https://a.example/three.m3u8\n";
    const std::vector<LiveChannel> channels = tvm::live::ParseM3u(text);
    REQUIRE_EQ(channels.size(), std::size_t(3));

    // tvg-name wins over the title after the comma, and the protocol-relative logo gets https.
    REQUIRE_EQ(channels[0], (LiveChannel{tvm::live::ChannelId("https://a.example/one.m3u8"), "One HD",
                                         "https://a.example/one.m3u8", "News", "https://cdn.example/one.png"}));
    // An empty group-title is kept as an empty group, so the channel has no group of its own.
    REQUIRE_EQ(channels[1].name, std::string("Two"));
    REQUIRE(!channels[1].group.has_value());
    // A group hint names the entries after it, unless the entry has a group-title of its own.
    // A logo that is not web is dropped, and an empty title falls back to "Channel".
    REQUIRE_EQ(channels[2].name, std::string("Channel"));
    REQUIRE_EQ(channels[2].group, std::optional<std::string>("Sport"));
    REQUIRE(!channels[2].logo.has_value());
}

TEST(m3u_entries_without_a_name_are_numbered) {
    const std::vector<LiveChannel> channels = tvm::live::ParseM3u("https://a.example/x.m3u8\nhttps://a.example/y.m3u8\n");
    REQUIRE_EQ(channels.size(), std::size_t(2));
    REQUIRE_EQ(channels[0].name, std::string("Channel 1"));
    REQUIRE_EQ(channels[1].name, std::string("Channel 2"));
}

TEST(m3u_a_repeated_address_gets_a_numbered_id) {
    const std::string url = "https://a.example/same.m3u8";
    const std::vector<LiveChannel> channels = tvm::live::ParseM3u("#EXTINF:-1,A\n" + url + "\n#EXTINF:-1,B\n" + url + "\n");
    REQUIRE_EQ(channels.size(), std::size_t(2));
    REQUIRE_EQ(channels[0].id, tvm::live::ChannelId(url));
    REQUIRE_EQ(channels[1].id, tvm::live::ChannelId(url) + "-2");
}

TEST(m3u_a_line_that_is_not_an_address_clears_the_entry_before_it) {
    const std::vector<LiveChannel> channels =
        tvm::live::ParseM3u("#EXTINF:-1,Named\nrelative/path.m3u8\nhttps://a.example/z.m3u8\n");
    REQUIRE_EQ(channels.size(), std::size_t(1));
    REQUIRE_EQ(channels[0].name, std::string("Channel 1"));
}

TEST(m3u_header_lines_are_not_channels) {
    const std::vector<LiveChannel> channels = tvm::live::ParseM3u(
        "#EXTM3U\n#EXTVLCOPT:http-user-agent=x\n#EXTHTTP:{\"a\":1}\n#EXTINF:-1,Only\nhttps://a.example/only.m3u8\n");
    REQUIRE_EQ(channels.size(), std::size_t(1));
    REQUIRE_EQ(channels[0].name, std::string("Only"));
}

// ------------------------------------------------------------ saved playlist

TEST(playlist_reads_a_saved_address_or_text_and_refuses_the_rest) {
    TempFolder dir;
    REQUIRE(tvm::live::ReadPlaylist(dir.path()) == tvm::live::Playlist{});

    SavePlaylist(dir.path(), {{"url", "https://a.example/list.m3u"}});
    REQUIRE_EQ(tvm::live::ReadPlaylist(dir.path()).url, std::optional<std::string>("https://a.example/list.m3u"));

    SavePlaylist(dir.path(), {{"url", "javascript:alert(1)"}, {"text", "  \n"}});
    REQUIRE(tvm::live::ReadPlaylist(dir.path()) == tvm::live::Playlist{});

    SavePlaylist(dir.path(), {{"text", "#EXTM3U\n"}});
    REQUIRE_EQ(tvm::live::ReadPlaylist(dir.path()).text, std::optional<std::string>("#EXTM3U\n"));
}

// ------------------------------------------------------------------ sources

TEST(sources_prefer_the_login_then_the_saved_text_then_the_saved_address) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});

    SavePlaylist(dir.path(), {{"text", "#EXTINF:-1,Text\nhttps://a.example/t.m3u8\n"}, {"url", "https://a.example/list.m3u"}});
    const Catalog fromText = tvm::live::LoadCatalog(dir.path(), login, NoNetwork());
    REQUIRE(fromText.playlist);
    REQUIRE_EQ(fromText.channels.size(), std::size_t(1));
    REQUIRE_EQ(fromText.channels[0].name, std::string("Text"));
    REQUIRE(network.requests.empty());
}

TEST(sources_read_a_saved_address_through_the_transport) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});
    SavePlaylist(dir.path(), {{"url", "https://a.example/list.m3u"}});

    FakeNetwork playlist([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url == "https://a.example/list.m3u") return Answer(200, "#EXTINF:-1,Remote\nhttps://a.example/r.m3u8\n");
        return Answer(404);
    });
    const Catalog catalog = tvm::live::LoadCatalog(dir.path(), login, playlist.Transport());
    REQUIRE_EQ(catalog.error, std::string());
    REQUIRE_EQ(catalog.channels.size(), std::size_t(1));
    REQUIRE_EQ(catalog.channels[0].name, std::string("Remote"));
}

TEST(a_bare_hls_address_is_one_live_stream) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});
    SavePlaylist(dir.path(), {{"url", "https://a.example/live.m3u8?x=1"}});

    FakeNetwork playlist([](const std::string&) { return std::optional<tvm::http::Response>(Answer(200, "not a list")); });
    const Catalog catalog = tvm::live::LoadCatalog(dir.path(), login, playlist.Transport());
    REQUIRE_EQ(catalog.error, std::string());
    REQUIRE_EQ(catalog.channels.size(), std::size_t(1));
    REQUIRE_EQ(catalog.channels[0].name, std::string("Live stream"));
    REQUIRE_EQ(catalog.channels[0].id, tvm::live::ChannelId("https://a.example/live.m3u8?x=1"));
}

TEST(a_playlist_that_cannot_be_fetched_or_read_is_reported) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});

    SavePlaylist(dir.path(), {{"url", "https://a.example/list.m3u"}});
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).error, std::string("unreachable"));

    FakeNetwork junk([](const std::string&) { return std::optional<tvm::http::Response>(Answer(200, "hello")); });
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, junk.Transport()).error, std::string("invalid"));

    SavePlaylist(dir.path(), {{"text", "no channels here\n"}});
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).error, std::string("invalid"));
}

TEST(a_playlist_over_the_size_limit_is_refused) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});
    const std::string huge = "#EXTINF:-1,Big\nhttps://a.example/b.m3u8\n" + std::string(tvm::live::kMaxPlaylistBytes, ' ');
    SavePlaylist(dir.path(), {{"text", huge}});
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).error, std::string("invalid"));
}

TEST(a_saved_login_supplies_the_channels_and_the_account) {
    TempFolder dir;
    FakeNetwork panel([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url.find("get_live_streams") != std::string::npos) {
            return Answer(200, R"([{"stream_id":42,"name":"Match TV"}])");
        }
        if (url.find("action=") == std::string::npos) {
            return Answer(200, R"({"user_info":{"username":"alice","auth":1}})");
        }
        return Answer(200, "[]");
    });
    tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), panel.Transport()});
    login.Save(tvm::xtream::Account{"http://panel.example", "alice", "secret"});

    const Catalog catalog = tvm::live::LoadCatalog(dir.path(), login, NoNetwork());
    REQUIRE(catalog.login);
    REQUIRE_EQ(catalog.host, std::optional<std::string>("http://panel.example"));
    REQUIRE_EQ(catalog.username, std::optional<std::string>("alice"));
    REQUIRE_EQ(catalog.channels.size(), std::size_t(1));
    REQUIRE_EQ(catalog.channels[0].id, std::string("live:xtream:42"));
}

// -------------------------------------------------------------- saving

TEST(text_is_playlist_text_when_it_has_m3u_lines_or_an_address_on_several_lines) {
    REQUIRE(tvm::live::LooksLikePlaylistText("#EXTM3U\n#EXTINF:-1,One\nhttps://a.example/one.m3u8"));
    REQUIRE(tvm::live::LooksLikePlaylistText("#extinf:-1,lower case"));
    REQUIRE(tvm::live::LooksLikePlaylistText("first line\nhttps://a.example/x.m3u8"));
    REQUIRE(!tvm::live::LooksLikePlaylistText("https://a.example/single.m3u8"));
    REQUIRE(!tvm::live::LooksLikePlaylistText("   "));
    REQUIRE(!tvm::live::LooksLikePlaylistText("just words\nand more words"));
}

TEST(saving_text_keeps_it_only_when_it_has_channels) {
    TempFolder dir;
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "#EXTM3U\n#EXTINF:-1,Only\nhttps://a.example/o.m3u8\n") ==
            tvm::live::PlaylistChange::Stored);
    REQUIRE_EQ(tvm::live::ReadPlaylist(dir.path()).text,
               std::optional<std::string>("#EXTM3U\n#EXTINF:-1,Only\nhttps://a.example/o.m3u8"));

    // Text with no channels is refused, and the saved playlist stays as it was.
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "#EXTM3U\nno channels\n") == tvm::live::PlaylistChange::Invalid);
    REQUIRE_EQ(tvm::live::ReadPlaylist(dir.path()).text,
               std::optional<std::string>("#EXTM3U\n#EXTINF:-1,Only\nhttps://a.example/o.m3u8"));
}

TEST(saving_an_address_stores_it_without_fetching_it) {
    TempFolder dir;
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "  https://a.example/list.m3u  ") == tvm::live::PlaylistChange::Stored);
    const tvm::live::Playlist playlist = tvm::live::ReadPlaylist(dir.path());
    REQUIRE_EQ(playlist.url, std::optional<std::string>("https://a.example/list.m3u"));
    REQUIRE(!playlist.text.has_value());
}

TEST(saving_something_that_is_not_web_is_refused) {
    TempFolder dir;
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "javascript:alert(1)") == tvm::live::PlaylistChange::Invalid);
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "file:///etc/passwd") == tvm::live::PlaylistChange::Invalid);
    REQUIRE(tvm::live::ReadPlaylist(dir.path()) == tvm::live::Playlist{});
}

TEST(saving_an_empty_value_removes_the_playlist) {
    TempFolder dir;
    tvm::live::SetPlaylist(dir.path(), "https://a.example/list.m3u");
    REQUIRE(tvm::live::SetPlaylist(dir.path(), "   ") == tvm::live::PlaylistChange::Cleared);
    REQUIRE(tvm::live::ReadPlaylist(dir.path()) == tvm::live::Playlist{});
    REQUIRE(tvm::util::ReadTextFile(tvm::paths::LivePlaylistPath(dir.path())).has_value());
}

TEST(the_playlist_label_is_the_address_or_pasted_and_a_login_hides_it) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    tvm::xtream::Client login(tvm::xtream::ClientOptions{dir.path(), EnvWith({}), network.Transport()});

    tvm::live::SetPlaylist(dir.path(), "https://a.example/list.m3u");
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).playlistUrl,
               std::optional<std::string>("https://a.example/list.m3u"));

    tvm::live::SetPlaylist(dir.path(), "#EXTM3U\n#EXTINF:-1,Pasted\nhttps://a.example/p.m3u8\n");
    REQUIRE_EQ(tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).playlistUrl,
               std::optional<std::string>(tvm::live::kPastedPlaylist));

    tvm::live::SetPlaylist(dir.path(), "");
    REQUIRE(!tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).playlistUrl.has_value());

    login.Save(tvm::xtream::Account{"http://panel.example", "alice", "secret"});
    tvm::live::SetPlaylist(dir.path(), "https://a.example/list.m3u");
    REQUIRE(!tvm::live::LoadCatalog(dir.path(), login, NoNetwork()).playlistUrl.has_value());
}

// ------------------------------------------------------------------ picks

TEST(picks_are_written_as_the_node_core_writes_them) {
    TempFolder dir;
    tvm::live::WritePicks(dir.path(), {"live:aa", "live:bb"});
    REQUIRE_EQ(tvm::util::ReadTextFile(tvm::paths::LivePicksPath(dir.path())).value_or(""),
               std::string(R"({"ids":["live:aa","live:bb"]})"));
    REQUIRE_EQ(tvm::live::ReadPicks(dir.path()), (std::vector<std::string>{"live:aa", "live:bb"}));
}

TEST(picks_file_keeps_only_channel_ids) {
    TempFolder dir;
    {
        std::ofstream(tvm::paths::LivePicksPath(dir.path()), std::ios::binary)
            << R"({"ids":["live:aa","other:bb",7,"live:cc"]})";
    }
    REQUIRE_EQ(tvm::live::ReadPicks(dir.path()), (std::vector<std::string>{"live:aa", "live:cc"}));
    {
        std::ofstream(tvm::paths::LivePicksPath(dir.path()), std::ios::binary) << "not json";
    }
    REQUIRE(tvm::live::ReadPicks(dir.path()).empty());
}

TEST(allowed_picks_drop_unknown_and_repeated_ids_and_stop_at_the_limit) {
    const std::vector<LiveChannel> channels = Channels(60);
    std::vector<std::string> ids{"live:c3", "live:nope", "live:c3", "live:c1"};
    REQUIRE_EQ(tvm::live::AllowedPicks(channels, ids), (std::vector<std::string>{"live:c3", "live:c1"}));

    std::vector<std::string> many;
    for (std::size_t i = 0; i < 60; ++i) many.push_back("live:c" + std::to_string(i));
    REQUIRE_EQ(tvm::live::AllowedPicks(channels, many).size(), tvm::live::kPickLimit);
}

TEST(with_pick_adds_to_the_end_and_removes_the_channel) {
    const std::vector<LiveChannel> channels = Channels(5);
    std::vector<std::string> picks{"live:c4"};
    picks = tvm::live::WithPick(channels, picks, "live:c0", true);
    REQUIRE_EQ(picks, (std::vector<std::string>{"live:c4", "live:c0"}));
    picks = tvm::live::WithPick(channels, picks, "live:c4", false);
    REQUIRE_EQ(picks, (std::vector<std::string>{"live:c0"}));
    picks = tvm::live::WithPick(channels, picks, "live:c0", true);
    REQUIRE_EQ(picks, (std::vector<std::string>{"live:c0"}));
}

// ------------------------------------------------------------------ status

Catalog WithChannels(std::size_t count) {
    Catalog catalog;
    catalog.playlist = true;
    catalog.channels = Channels(count);
    return catalog;
}

TEST(status_lists_every_channel_when_there_are_few) {
    const Status status = tvm::live::Compose(WithChannels(3), {});
    REQUIRE(status.configured);
    REQUIRE_EQ(status.shown.size(), std::size_t(3));
    REQUIRE_EQ(status.total, std::size_t(3));
    REQUIRE_EQ(status.picked, std::size_t(0));
    REQUIRE(!status.needsPicks);
    REQUIRE(status.error.empty());
}

TEST(status_asks_for_picks_when_there_are_more_than_the_limit) {
    const Status status = tvm::live::Compose(WithChannels(tvm::live::kPickLimit + 1), {});
    REQUIRE(status.shown.empty());
    REQUIRE(status.needsPicks);
    REQUIRE_EQ(status.total, tvm::live::kPickLimit + 1);
}

TEST(status_lists_the_picks_in_their_order) {
    const Status status = tvm::live::Compose(WithChannels(tvm::live::kPickLimit + 1), {"live:c9", "live:c2"});
    REQUIRE_EQ(status.shown.size(), std::size_t(2));
    REQUIRE_EQ(status.shown[0].id, std::string("live:c9"));
    REQUIRE_EQ(status.shown[1].id, std::string("live:c2"));
    REQUIRE_EQ(status.picked, std::size_t(2));
    REQUIRE(!status.needsPicks);
}

TEST(status_reports_an_unreachable_source_when_nothing_can_be_listed) {
    Catalog catalog;
    catalog.login = true;
    catalog.host = "http://panel.example";
    catalog.username = "alice";
    catalog.error = "unreachable";
    const Status status = tvm::live::Compose(catalog, {});
    REQUIRE(status.configured);
    REQUIRE_EQ(status.error, std::string("unreachable"));
    REQUIRE(status.shown.empty());
    REQUIRE_EQ(status.host, std::optional<std::string>("http://panel.example"));
}

TEST(status_is_not_configured_without_a_login_or_playlist) {
    const Status status = tvm::live::Compose(Catalog{}, {});
    REQUIRE(!status.configured);
    REQUIRE(status.shown.empty());
    REQUIRE(status.error.empty());
}

}  // namespace
