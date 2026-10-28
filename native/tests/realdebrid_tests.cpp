// Real-Debrid tests: file-name reading, the library as catalogue items, the client
// (token, status, lists, links) and the Real-Debrid screen through the shell. The
// network is a fake that replays canned answers and records each request, so no test
// reaches Real-Debrid. Files go to a temporary folder, never to the viewer's data.
// The cases are the ones in apps/core/src/providers/media.test.ts.

#include <windows.h>

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/library.h"
#include "catalog/media_item.h"
#include "catalog/realdebrid.h"
#include "catalog/title.h"
#include "core/http.h"
#include "core/paths.h"
#include "core/prefs.h"
#include "core/util.h"
#include "fake_network.h"
#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "ui/preferences_store.h"
#include "ui/realdebrid_screen.h"
#include "ui/screen_base.h"
#include "ui/shell.h"

namespace {

namespace fs = std::filesystem;
using tvm::catalog::MediaItem;
using tvm::realdebrid::Client;
using tvm::realdebrid::ClientOptions;
using tvm::realdebrid::Download;
using tvm::realdebrid::Status;
using tvm::realdebrid::Torrent;
using tvm::testing::Answer;
using tvm::testing::EnvWith;
using tvm::testing::FakeNetwork;
using tvm::testing::HeaderOf;
using tvm::testing::TempFolder;
using tvm::ui::Command;
using tvm::ui::RealDebridScreen;
using tvm::ui::RealDebridView;
using tvm::ui::Shell;

ClientOptions Options(const fs::path& dir, FakeNetwork& network,
                      std::map<std::wstring, std::wstring> env = {}) {
    return ClientOptions{dir, EnvWith(std::move(env)), network.Transport()};
}

// --------------------------------------------------------------- file names

TEST(title_reads_show_name_and_year_from_a_release) {
    REQUIRE_EQ(tvm::catalog::title::ParseFilename("Dune.Part.Two.2024.1080p.BluRay.x264.mkv"),
               (tvm::catalog::title::ParsedName{"Dune Part Two", 2024}));
}

TEST(title_keeps_a_plain_name) {
    REQUIRE_EQ(tvm::catalog::title::ParseFilename("holiday-video.mp4").title, std::string("holiday-video"));
}

TEST(title_drops_episode_names_from_the_show_name) {
    REQUIRE_EQ(tvm::catalog::title::ParseFilename("Stranger.Things.S04E01.Chapter.One.The.Hellfire.Club.1080p.mkv"),
               (tvm::catalog::title::ParsedName{"Stranger Things", std::nullopt}));
    REQUIRE_EQ(tvm::catalog::title::ParseFilename("The.Boys.S01.Complete.1080p.mkv").title, std::string("The Boys"));
}

TEST(title_recognises_playable_files) {
    REQUIRE(tvm::catalog::title::IsPlayableFile("a.mkv"));
    REQUIRE(!tvm::catalog::title::IsPlayableFile("notes.txt"));
    REQUIRE(!tvm::catalog::title::IsPlayableFile("Film.en.srt"));
    REQUIRE(!tvm::catalog::title::IsPlayableFile("song.flac", std::string("audio/flac")));
    REQUIRE(tvm::catalog::title::IsPlayableFile("clip.bin", std::string("video/mp4")));
}

TEST(title_treats_season_packs_as_packs_and_single_episodes_as_plays) {
    using tvm::catalog::title::LooksLikePack;
    REQUIRE(LooksLikePack("The Boys", "The.Boys.S01.2160p.mkv"));
    REQUIRE(!LooksLikePack("The Boys", "The.Boys.S01E01.mkv"));
    REQUIRE(!LooksLikePack("The Boys", "The.Boys.S01.E01.mkv"));
    REQUIRE(LooksLikePack("The Boys", "The.Boys.S01E01-08.mkv"));
    REQUIRE(LooksLikePack("Breaking Bad", "Breaking.Bad.S01-S05.1080p.mkv"));
}

TEST(title_reads_season_and_episode) {
    using tvm::catalog::title::Episode;
    using tvm::catalog::title::ParseEpisode;
    REQUIRE_EQ(ParseEpisode("The.Boys.S01E05.1080p.mkv"), std::optional<Episode>(Episode{1, 5}));
    REQUIRE_EQ(ParseEpisode("The.Boys.S01.E05.1080p.mkv"), std::optional<Episode>(Episode{1, 5}));
    REQUIRE_EQ(ParseEpisode("Show 2x09.mp4"), std::optional<Episode>(Episode{2, 9}));
    REQUIRE_EQ(ParseEpisode("Show Season 2 Episode 9.mkv"), std::optional<Episode>(Episode{2, 9}));
    REQUIRE(!ParseEpisode("Movie.2024.mkv").has_value());
    REQUIRE(!ParseEpisode("The.Boys.S01E01-08.mkv").has_value());
    REQUIRE_EQ(tvm::catalog::title::ParseSeason("The.Boys.S01.Complete.mkv"), std::optional<int>(1));
    REQUIRE(!tvm::catalog::title::ParseSeason("Movie.2024.mkv").has_value());
}

TEST(title_reads_the_chapter_name_after_the_episode) {
    REQUIRE_EQ(tvm::catalog::title::ParseEpisodeTitle("The Boys S01E01 The Name of the Game.mkv"),
               std::optional<std::string>("The Name of the Game"));
    REQUIRE(!tvm::catalog::title::ParseEpisodeTitle("The.Boys.S01E01.mkv").has_value());
}

// ------------------------------------------------------------ transcodes

TEST(transcode_picker_prefers_hls_for_the_browser) {
    const auto both = nlohmann::ordered_json::parse(
        R"({"apple":{"full":"https://cdn.example/a.m3u8"},"liveMP4":{"1080":"https://cdn.example/a.mp4"}})");
    REQUIRE_EQ(tvm::realdebrid::PickHtml5Transcode(both),
               std::optional<tvm::realdebrid::Transcode>(
                   tvm::realdebrid::Transcode{"https://cdn.example/a.m3u8", "application/vnd.apple.mpegurl"}));

    const auto progressive = nlohmann::ordered_json::parse(R"({"liveMP4":{"720":"https://cdn.example/a.mp4"}})");
    REQUIRE_EQ(tvm::realdebrid::PickHtml5Transcode(progressive),
               std::optional<tvm::realdebrid::Transcode>(
                   tvm::realdebrid::Transcode{"https://cdn.example/a.mp4", "video/mp4"}));

    // Real-Debrid's live transcode is MPEG-TS under an .mp4 name when it has no .mp4 extension.
    const auto live = nlohmann::ordered_json::parse(R"({"liveMP4":{"1080":"https://cdn.example/l/abc"}})");
    REQUIRE_EQ(tvm::realdebrid::PickHtml5Transcode(live),
               std::optional<tvm::realdebrid::Transcode>(
                   tvm::realdebrid::Transcode{"https://cdn.example/l/abc", "video/mp2t"}));
}

TEST(transcode_picker_ignores_links_that_are_not_web_addresses) {
    const auto body = nlohmann::ordered_json::parse(R"json({"apple":{"full":"javascript:alert(1)"}})json");
    REQUIRE(!tvm::realdebrid::PickHtml5Transcode(body).has_value());
}

// -------------------------------------------------------------- library

tvm::realdebrid::Download DownloadNamed(const std::string& id, const std::string& filename,
                                        const std::string& mimeType = "") {
    return Download{id, filename, mimeType, "https://hoster.example/" + id};
}

Torrent TorrentNamed(const std::string& id, const std::string& filename, const std::string& status,
                     std::vector<std::string> links = {"https://hoster.example/t"}) {
    Torrent torrent;
    torrent.id = id;
    torrent.filename = filename;
    torrent.status = status;
    torrent.progress = status == "downloaded" ? 100.0 : 40.0;
    torrent.links = std::move(links);
    return torrent;
}

TEST(library_lists_playable_files_and_leaves_out_subtitles) {
    const auto items = tvm::catalog::LibraryItems(
        {DownloadNamed("d1", "Dune.Part.Two.2024.1080p.mkv", "video/x-matroska"), DownloadNamed("d2", "Dune.srt")},
        {});
    REQUIRE_EQ(items.size(), std::size_t(1));
    const MediaItem& item = items.front();
    REQUIRE_EQ(item.id, std::string("rd:d:d1"));
    REQUIRE_EQ(item.title, std::string("Dune Part Two"));
    REQUIRE_EQ(item.year, std::optional<int>(2024));
    REQUIRE_EQ(item.kind, std::string("file"));
    REQUIRE(item.playable);
    REQUIRE_EQ(item.genres, std::vector<std::string>{"Your files"});
    REQUIRE_EQ(item.filename, std::optional<std::string>("Dune.Part.Two.2024.1080p.mkv"));
    REQUIRE_EQ(item.mimeType, std::optional<std::string>("video/x-matroska"));
}

TEST(library_marks_an_episode_as_a_series_entry) {
    const auto items = tvm::catalog::LibraryItems({DownloadNamed("d1", "The.Boys.S01E05.1080p.mkv")}, {});
    REQUIRE_EQ(items.size(), std::size_t(1));
    const MediaItem& item = items.front();
    REQUIRE_EQ(item.kind, std::string("series"));
    REQUIRE_EQ(item.season, std::optional<int>(1));
    REQUIRE_EQ(item.episode, std::optional<int>(5));
    REQUIRE_EQ(item.showTitle, std::optional<std::string>("The Boys"));
}

TEST(library_torrent_with_one_finished_file_is_a_file) {
    const auto items =
        tvm::catalog::LibraryItems({}, {TorrentNamed("t1", "Dune.2024.1080p.mkv", "downloaded")});
    REQUIRE_EQ(items.size(), std::size_t(1));
    REQUIRE_EQ(items.front().id, std::string("rd:t:t1:0"));
    REQUIRE_EQ(items.front().kind, std::string("file"));
}

TEST(library_torrent_still_downloading_is_left_out) {
    REQUIRE(tvm::catalog::LibraryItems({}, {TorrentNamed("t1", "Dune.2024.mkv", "downloading")}).empty());
}

TEST(library_torrent_with_several_files_or_a_pack_is_a_series) {
    const auto several = tvm::catalog::LibraryItems(
        {}, {TorrentNamed("t1", "Dune.2024.mkv", "downloaded", {"https://a", "https://b"})});
    REQUIRE_EQ(several.front().kind, std::string("series"));
    REQUIRE(!several.front().season.has_value());

    const auto pack = tvm::catalog::LibraryItems({}, {TorrentNamed("t2", "The.Boys.S01.2160p.mkv", "downloaded")});
    REQUIRE_EQ(pack.front().kind, std::string("series"));
    REQUIRE(!pack.front().season.has_value());
    REQUIRE(!pack.front().episode.has_value());
}

TEST(library_lists_torrents_before_downloads) {
    const auto items = tvm::catalog::LibraryItems({DownloadNamed("d1", "Film.mkv")},
                                                  {TorrentNamed("t1", "Other.mkv", "downloaded")});
    REQUIRE_EQ(items.size(), std::size_t(2));
    REQUIRE_EQ(items[0].id, std::string("rd:t:t1:0"));
    REQUIRE_EQ(items[1].id, std::string("rd:d:d1"));
}

TEST(library_item_keeps_its_file_fields_through_json) {
    MediaItem item;
    item.id = "rd:d:d1";
    item.title = "Film";
    item.kind = "file";
    item.playable = true;
    item.filename = "Film.mkv";
    item.mimeType = "video/x-matroska";
    REQUIRE(tvm::catalog::FromJson(tvm::catalog::ToJson(item)) == std::optional<MediaItem>(item));
}

// --------------------------------------------------------------- client

TEST(realdebrid_without_a_token_makes_no_request) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(200, "{}")); });
    Client client(Options(dir.path(), network));

    REQUIRE(!client.Token().has_value());
    const Status status = client.GetStatus();
    REQUIRE(!status.configured);
    REQUIRE(status.error.empty());
    REQUIRE(network.requests.empty());
}

TEST(realdebrid_uses_the_environment_token_when_none_is_saved) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"  env-token  "}}));

    REQUIRE_EQ(client.Token(), std::optional<std::string>("env-token"));
    client.GetStatus();
    REQUIRE_EQ(network.requests.size(), std::size_t(1));
    REQUIRE_EQ(HeaderOf(network.requests[0].options, "Authorization"), std::optional<std::string>("Bearer env-token"));
}

TEST(realdebrid_saved_token_wins_over_the_environment) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"env-token"}}));
    client.SetToken("saved-token");
    REQUIRE_EQ(client.Token(), std::optional<std::string>("saved-token"));
}

TEST(realdebrid_cleared_token_does_not_fall_back_to_the_environment) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"env-token"}}));
    client.SetToken("saved-token");
    client.SetToken("   ");
    REQUIRE(!client.Token().has_value());
    REQUIRE(!client.GetStatus().configured);
}

TEST(realdebrid_token_is_sealed_on_disk) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    Client client(Options(dir.path(), network));
    client.SetToken("  tok-123-abc\n");

    const std::string onDisk = tvm::util::ReadTextFile(tvm::paths::RdTokenPath(dir.path())).value_or("");
    REQUIRE(onDisk.rfind("tvm-secret-v1:", 0) == 0);
    REQUIRE(onDisk.find("tok-123") == std::string::npos);
    REQUIRE_EQ(client.Token(), std::optional<std::string>("tok-123-abc"));
}

TEST(realdebrid_refuses_a_token_with_a_line_break) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    Client client(Options(dir.path(), network));
    REQUIRE_THROWS_CONTAINING(client.SetToken("first\nsecond"), "line breaks");
    REQUIRE(!client.Token().has_value());
}

TEST(realdebrid_status_reads_the_account) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) {
        if (url == "https://api.real-debrid.com/rest/1.0/user") {
            return std::optional<tvm::http::Response>(Answer(200, R"({"username":"ada","premium":30,"expiration":""})"));
        }
        return std::optional<tvm::http::Response>(Answer(404));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));

    const Status status = client.GetStatus();
    REQUIRE(status.configured);
    REQUIRE_EQ(status.username, std::optional<std::string>("ada"));
    REQUIRE(status.premium);
    REQUIRE(status.error.empty());
}

TEST(realdebrid_status_treats_zero_premium_days_as_free) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(200, R"({"username":"ada","premium":0})"));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE(!client.GetStatus().premium);
}

TEST(realdebrid_status_reports_a_refused_token_as_needs_auth) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401, "no")); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"bad-token"}}));

    const Status status = client.GetStatus();
    REQUIRE(status.configured);
    REQUIRE(!status.username.has_value());
    REQUIRE_EQ(status.error, std::string("needs-auth"));
}

TEST(realdebrid_status_reports_no_answer_and_server_errors_as_unreachable) {
    TempFolder dir;
    FakeNetwork silent([](const std::string&) { return std::optional<tvm::http::Response>(); });
    Client offline(Options(dir.path(), silent, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE_EQ(offline.GetStatus().error, std::string("unreachable"));

    FakeNetwork broken([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    Client failing(Options(dir.path(), broken, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE_EQ(failing.GetStatus().error, std::string("unreachable"));
}

TEST(realdebrid_downloads_read_each_page_until_a_short_one) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) {
        const bool firstPage = url.find("offset=0") != std::string::npos;
        const bool secondPage = url.find("offset=100") != std::string::npos;
        if (!firstPage && !secondPage) return std::optional<tvm::http::Response>(Answer(204));
        nlohmann::json page = nlohmann::json::array();
        const int count = firstPage ? 100 : 3;
        for (int i = 0; i < count; ++i) {
            page.push_back({{"id", std::to_string(firstPage ? i : 100 + i)}, {"filename", "Film " + std::to_string(i) + ".mkv"}});
        }
        return std::optional<tvm::http::Response>(Answer(200, page.dump()));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));

    const std::vector<Download> downloads = client.Downloads();
    REQUIRE_EQ(downloads.size(), std::size_t(103));
    REQUIRE_EQ(downloads.back().id, std::string("102"));
    // The third page is never asked for, because the second one was short.
    REQUIRE_EQ(network.requests.size(), std::size_t(2));
}

TEST(realdebrid_an_empty_list_answer_is_an_empty_list) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(204)); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE(client.Downloads().empty());
    REQUIRE(client.Torrents().empty());
}

TEST(realdebrid_torrents_read_numbered_pages) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) {
        if (url.find("page=1") == std::string::npos) return std::optional<tvm::http::Response>(Answer(204));
        return std::optional<tvm::http::Response>(Answer(
            200, R"([{"id":"t1","filename":"Dune.mkv","status":"downloaded","progress":100,"links":["https://a"]},)"
                 R"({"id":"t2","filename":"Other.mkv","status":"queued","progress":3,"links":[]}])"));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));

    const std::vector<Torrent> torrents = client.Torrents();
    REQUIRE_EQ(torrents.size(), std::size_t(2));
    REQUIRE_EQ(torrents[0].links, std::vector<std::string>{"https://a"});
    REQUIRE_EQ(torrents[1].progress, 3.0);
    REQUIRE_EQ(network.requests.size(), std::size_t(1));
}

TEST(realdebrid_torrent_info_reads_its_files) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(200, R"({"id":"t-1","filename":"Pack","status":"downloaded",)"
                                                                 R"("progress":100,"links":["https://a","https://b"],)"
                                                                 R"("files":[{"id":1,"path":"/E01.mkv","bytes":10,"selected":1},)"
                                                                 R"({"id":2,"path":"/E02.mkv","bytes":20,"selected":0}]})"));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));

    const tvm::realdebrid::TorrentInfo info = client.GetTorrentInfo("t-1");
    REQUIRE_EQ(network.requests[0].url, std::string("https://api.real-debrid.com/rest/1.0/torrents/info/t-1"));
    REQUIRE_EQ(info.filename, std::string("Pack"));
    REQUIRE_EQ(info.links.size(), std::size_t(2));
    REQUIRE_EQ(info.files.size(), std::size_t(2));
    REQUIRE_EQ(info.files[0].path, std::string("/E01.mkv"));
    REQUIRE_EQ(info.files[1].selected, 0);
}

TEST(realdebrid_unrestrict_posts_the_link_as_a_form) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(
            200, R"({"id":"u1","filename":"Dune.Part.Two.2024.mp4","mimeType":"video/mp4","download":"https://cdn.example/s.mp4"})"));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));

    const tvm::realdebrid::Unrestricted result = client.Unrestrict("https://hoster.example/a file");
    REQUIRE_EQ(network.requests[0].url, std::string("https://api.real-debrid.com/rest/1.0/unrestrict/link"));
    REQUIRE_EQ(network.requests[0].options.method, std::string("POST"));
    REQUIRE_EQ(network.requests[0].options.body, std::string("link=https%3A%2F%2Fhoster.example%2Fa+file"));
    REQUIRE_EQ(HeaderOf(network.requests[0].options, "Content-Type"),
               std::optional<std::string>("application/x-www-form-urlencoded"));
    REQUIRE_EQ(result.download, std::string("https://cdn.example/s.mp4"));
    REQUIRE_EQ(result.mimeType, std::string("video/mp4"));
}

TEST(realdebrid_transcode_is_nothing_when_real_debrid_refuses) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(404)); });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE(!client.GetTranscode("d1").has_value());
}

TEST(realdebrid_transcode_returns_the_html5_stream) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(
            200, R"({"apple":{"full":"https://cdn.example/a.m3u8"},"liveMP4":{"1080":"https://cdn.example/a.mp4"}})"));
    });
    Client client(Options(dir.path(), network, {{L"TVM_RD_TOKEN", L"secret-token"}}));
    REQUIRE_EQ(client.GetTranscode("d1"),
               std::optional<tvm::realdebrid::Transcode>(
                   tvm::realdebrid::Transcode{"https://cdn.example/a.m3u8", "application/vnd.apple.mpegurl"}));
}

// --------------------------------------------------------------- screen

// Keeps every preference in memory.
class MemoryStore final : public tvm::ui::PreferenceStore {
public:
    tvm::motion::MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const tvm::motion::MotionSettings& settings) override { motion_ = settings; }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& /*patch*/) override {}

    tvm::motion::MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
};

// A root screen whose OK opens Real-Debrid, as Settings does.
class RealDebridLauncher final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = "realdebrid";
        return command;
    }
};

RealDebridView Connected() {
    RealDebridView view;
    view.loaded = true;
    view.configured = true;
    view.username = "ada";
    view.premium = true;
    return view;
}

RealDebridScreen& RealDebridOn(Shell& shell) {
    auto* screen = dynamic_cast<RealDebridScreen*>(&shell.ActiveScreen());
    REQUIRE(screen != nullptr);
    return *screen;
}

TEST(realdebrid_screen_shows_placeholders_until_the_account_answers) {
    RealDebridScreen screen;
    screen.Layout(1920.0, 1080.0);
    const auto facts = screen.Facts();
    REQUIRE_EQ(facts.size(), std::size_t(3));
    REQUIRE_EQ(facts[0], (std::pair<std::string, std::string>{"Account", "..."}));
    REQUIRE_EQ(facts[1], (std::pair<std::string, std::string>{"Premium", "..."}));
    REQUIRE_EQ(facts[2], (std::pair<std::string, std::string>{"Status", "..."}));
}

TEST(realdebrid_screen_rows_describe_a_connected_account) {
    RealDebridScreen screen;
    screen.SetView(Connected());
    const auto facts = screen.Facts();
    REQUIRE_EQ(facts[0], (std::pair<std::string, std::string>{"Account", "ada"}));
    REQUIRE_EQ(facts[1], (std::pair<std::string, std::string>{"Token", "This machine\xE2\x80\x99s"}));
    REQUIRE_EQ(facts[2], (std::pair<std::string, std::string>{"Premium", "Yes"}));
    REQUIRE_EQ(facts[3], (std::pair<std::string, std::string>{"Status", "Ready"}));
}

TEST(realdebrid_screen_reports_a_rejected_token) {
    RealDebridView view = Connected();
    view.error = "needs-auth";
    RealDebridScreen screen;
    screen.SetView(view);
    REQUIRE_EQ(screen.Facts().back(), (std::pair<std::string, std::string>{"Status", "Token rejected"}));
}

TEST(realdebrid_screen_offers_paste_and_terms_when_nothing_is_connected) {
    RealDebridScreen screen;
    RealDebridView view;
    view.loaded = true;
    screen.SetView(view);
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("paste"));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("terms"));
    REQUIRE(!screen.Navigate(tvm::nav::Direction::Right, 0.0));
}

TEST(realdebrid_screen_buttons_return_the_app_actions) {
    RealDebridScreen screen;
    screen.SetView(Connected());

    const std::optional<Command> paste = screen.Select(0.0);
    REQUIRE(paste.has_value());
    REQUIRE_EQ(paste->name, std::string("realdebrid-paste"));
    REQUIRE(paste->action);

    REQUIRE(screen.Navigate(tvm::nav::Direction::Right, 0.0));
    const std::optional<Command> disconnect = screen.Select(0.0);
    REQUIRE(disconnect.has_value());
    REQUIRE_EQ(disconnect->name, std::string("realdebrid-disconnect"));
    REQUIRE(disconnect->action);

    REQUIRE(screen.Navigate(tvm::nav::Direction::Right, 0.0));
    const std::optional<Command> terms = screen.Select(0.0);
    REQUIRE(terms.has_value());
    REQUIRE_EQ(terms->name, std::string("legal"));
    REQUIRE(!terms->action);
}

TEST(realdebrid_screen_buttons_wait_while_a_request_is_in_flight) {
    RealDebridScreen screen;
    RealDebridView view = Connected();
    view.busy = true;
    screen.SetView(view);
    REQUIRE(!screen.Select(0.0).has_value());
}

TEST(realdebrid_screen_moves_focus_off_disconnect_when_it_goes) {
    RealDebridScreen screen;
    screen.SetView(Connected());
    REQUIRE(screen.Navigate(tvm::nav::Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("disconnect"));

    RealDebridView cleared;
    cleared.loaded = true;
    screen.SetView(cleared);
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("paste"));
}

TEST(realdebrid_screen_pointer_picks_the_paste_button) {
    RealDebridScreen screen;
    screen.SetView(Connected());
    screen.Layout(1920.0, 1080.0);
    // At 1080p a rem is 16 px. The paste button starts at 2.5 rem across and 25 + 1.5 rem down.
    REQUIRE_EQ(screen.ItemAt(184.0, 452.0), std::optional<std::string>("paste"));
    REQUIRE(!screen.ItemAt(4.0, 4.0).has_value());
}

TEST(realdebrid_screen_opens_from_settings_and_takes_the_answer) {
    MemoryStore store;
    auto launcher = std::make_unique<RealDebridLauncher>();
    Shell shell(std::move(launcher), store);
    shell.Layout(1920.0, 1080.0);

    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("realdebrid"));
    REQUIRE(!RealDebridOn(shell).view().loaded);

    shell.SetRealDebridView(Connected());
    REQUIRE(RealDebridOn(shell).view().loaded);
    REQUIRE_EQ(RealDebridOn(shell).Facts()[0], (std::pair<std::string, std::string>{"Account", "ada"}));
}

}  // namespace
