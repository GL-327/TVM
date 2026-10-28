// Playback tests: the Torrentio stream rules, the resolver's walk from a title to a file, and the
// mpv launch and property bookkeeping. The cases follow apps/core/src/providers/torrentio.test.ts,
// apps/shell/src/mpv.test.ts and nativePlayerState.test.ts. The network is a fake, so no test
// reaches Torrentio or Real-Debrid.

#include <algorithm>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/catalog_service.h"
#include "catalog/playback.h"
#include "catalog/realdebrid.h"
#include "core/mpv.h"
#include "fake_network.h"
#include "harness.h"

namespace {

using tvm::http::Response;
using tvm::playback::DebridStream;
using tvm::playback::PlayId;
using tvm::testing::Answer;
using tvm::testing::EnvWith;
using tvm::testing::FakeNetwork;
using tvm::testing::TempFolder;

Response Redirect(const std::string& location) {
    Response response = Answer(302);
    response.location = location;
    return response;
}

// A resolver whose catalogue never answers, with a Real-Debrid token in the environment.
struct Rig {
    explicit Rig(FakeNetwork::Route route)
        : network(std::move(route)),
          realDebrid(tvm::realdebrid::ClientOptions{folder.path(), EnvWith({{L"TVM_RD_TOKEN", L"tok"}}),
                                                    network.Transport()}),
          catalog(folder.path(), [](const std::string&, unsigned) { return std::optional<Response>(); }),
          resolver(realDebrid, catalog, network.Transport()) {}

    TempFolder folder;
    FakeNetwork network;
    tvm::realdebrid::Client realDebrid;
    tvm::catalog::CatalogService catalog;
    tvm::playback::Resolver resolver;
};

// ------------------------------------------------------------------ the stream rules

TEST(a_play_id_reads_a_film_and_an_episode) {
    REQUIRE_EQ(tvm::playback::ParsePlayId("TT0111161"), (std::optional<PlayId>(PlayId{"tt0111161", {}, {}})));
    REQUIRE_EQ(tvm::playback::ParsePlayId("tt0944947:2:9"), (std::optional<PlayId>(PlayId{"tt0944947", 2, 9})));
    REQUIRE(!tvm::playback::ParsePlayId("tt0944947:1:0").has_value());
    REQUIRE(!tvm::playback::ParsePlayId("rd:d:abc").has_value());
}

TEST(torrentio_paths_try_the_padded_episode_second) {
    const std::vector<std::string> episode = tvm::playback::TorrentioStreamPaths("tt1", 1, 2);
    REQUIRE_EQ(episode.size(), std::size_t{2});
    REQUIRE_EQ(episode[0], std::string("stream/series/tt1:1:2.json"));
    REQUIRE_EQ(episode[1], std::string("stream/series/tt1:1:02.json"));
    const std::vector<std::string> film = tvm::playback::TorrentioStreamPaths("tt1", std::nullopt, std::nullopt);
    REQUIRE_EQ(film[0], std::string("stream/movie/tt1.json"));
    REQUIRE_EQ(film[1], std::string("stream/series/tt1.json"));
}

TEST(a_camera_copy_and_a_refused_link_are_not_streams) {
    REQUIRE(!tvm::playback::ParseDebridStream({{"url", "https://x/a"}, {"title", "Film 2024 HDCAM"}}).has_value());
    REQUIRE(!tvm::playback::ParseDebridStream({{"url", "https://x/videos/failed_access.mp4"}, {"title", "Film"}})
                 .has_value());
    REQUIRE(!tvm::playback::ParseDebridStream({{"title", "Film"}}).has_value());
}

TEST(a_stream_reads_its_quality_and_whether_it_is_cached) {
    const std::optional<DebridStream> stream = tvm::playback::ParseDebridStream(
        {{"url", "https://torrentio.strem.fun/resolve/1"}, {"name", "[RD+] Torrentio\n4k"}, {"title", "Film.2160p\nseeds"}});
    REQUIRE(stream.has_value());
    REQUIRE_EQ(stream->quality, 40);
    REQUIRE(stream->cached);
    REQUIRE_EQ(stream->title, std::string("Film.2160p"));
}

TEST(ranking_puts_quality_first_and_the_cache_breaks_ties) {
    std::vector<DebridStream> streams = {
        DebridStream{"a", "a", 30, false, ""},
        DebridStream{"b", "b", 30, true, ""},
        DebridStream{"c", "c", 40, false, ""},
    };
    const std::vector<DebridStream> ranked = tvm::playback::RankDebridStreams(streams);
    REQUIRE_EQ(ranked[0].url, std::string("c"));
    REQUIRE_EQ(ranked[1].url, std::string("b"));
    REQUIRE_EQ(ranked[2].url, std::string("a"));
}

TEST(a_height_cap_keeps_the_low_streams_when_none_fit) {
    const std::vector<DebridStream> streams = {DebridStream{"4k", "Film 2160p", 40, false, "Film 2160p"},
                                               DebridStream{"720", "Film 720p", 15, false, "Film 720p"}};
    const std::vector<DebridStream> capped = tvm::playback::CapStreamsToHeight(streams, 1080);
    REQUIRE_EQ(capped.size(), std::size_t{1});
    REQUIRE_EQ(capped[0].url, std::string("720"));
}

TEST(a_real_debrid_download_plays_as_it_is) {
    REQUIRE(tvm::playback::IsLikelyDirectPlayUrl("https://abc.download.real-debrid.com/d/X/film.mkv"));
    REQUIRE(!tvm::playback::IsLikelyDirectPlayUrl("https://real-debrid.com/d/ABC"));
    REQUIRE(tvm::playback::IsTorrentioHost("https://torrentio.strem.fun/resolve/x"));
    REQUIRE(!tvm::playback::IsTorrentioHost("https://torrentio.strem.fun.evil.example/x"));
}

TEST(an_unknown_reason_reads_as_itself_and_an_empty_one_as_internal) {
    REQUIRE(tvm::playback::ErrorMessage("empty").find("Torrentio returned no streams") == 0);
    REQUIRE_EQ(tvm::playback::ErrorMessage("  odd  "), std::string("odd"));
    REQUIRE(tvm::playback::ErrorMessage("").find("Playback failed inside TVM") == 0);
}

// ------------------------------------------------------------------ the resolver

TEST(torrentio_resolve_follows_its_redirect_to_the_file) {
    Rig rig([](const std::string& url) -> std::optional<Response> {
        if (url == "https://torrentio.strem.fun/resolve/1") return Redirect("https://torrentio.strem.fun/resolve/2");
        if (url == "https://torrentio.strem.fun/resolve/2") return Redirect("https://cdn.download.real-debrid.com/d/f.mkv");
        return std::nullopt;
    });
    REQUIRE_EQ(rig.resolver.ResolveTorrentioUrl("https://torrentio.strem.fun/resolve/1"),
               std::optional<std::string>("https://cdn.download.real-debrid.com/d/f.mkv"));
    // Redirects are read, not followed, so the target can be checked first.
    REQUIRE(!rig.network.requests.front().options.followRedirects);
}

TEST(a_resolve_that_points_back_at_torrentio_is_its_placeholder) {
    Rig rig([](const std::string&) -> std::optional<Response> {
        return Redirect("https://torrentio.strem.fun/videos/downloading_v2.mp4");
    });
    REQUIRE(!rig.resolver.ResolveTorrentioUrl("https://torrentio.strem.fun/resolve/1").has_value());
}

TEST(an_episode_plays_the_best_cached_stream_through_real_debrid) {
    Rig rig([](const std::string& url) -> std::optional<Response> {
        if (url.find("/stream/series/tt9:1:2.json") != std::string::npos) {
            const nlohmann::json body = {
                {"streams",
                 {{{"url", "https://torrentio.strem.fun/resolve/low"}, {"name", "RD 720p"}, {"title", "Show.S01E02.720p"}},
                  {{"url", "https://torrentio.strem.fun/resolve/best"}, {"name", "[RD+] 1080p"},
                   {"title", "Show.S01E02.1080p"}}}}};
            return Answer(200, body.dump());
        }
        if (url == "https://torrentio.strem.fun/resolve/best") {
            return Redirect("https://cdn.download.real-debrid.com/d/Show.S01E02.1080p.mkv");
        }
        return std::nullopt;
    });
    const tvm::playback::Resolution resolution = rig.resolver.Resolve({"tt9:1:2", "Show", 2160});
    REQUIRE(resolution.ok());
    REQUIRE_EQ(resolution.url, std::string("https://cdn.download.real-debrid.com/d/Show.S01E02.1080p.mkv"));
    REQUIRE_EQ(resolution.title, std::string("Show \xC2\xB7 S1 E2"));
    // The token goes to Torrentio in its path, as the Node core sends it.
    REQUIRE(rig.network.requests.front().url.find("/realdebrid=tok/") != std::string::npos);
}

TEST(no_streams_reads_as_empty) {
    Rig rig([](const std::string&) -> std::optional<Response> { return Answer(200, R"({"streams":[]})"); });
    const tvm::playback::Resolution resolution = rig.resolver.Resolve({"tt9:1:2", "Show", 2160});
    REQUIRE(!resolution.ok());
    REQUIRE_EQ(resolution.reason, std::string("empty"));
}

TEST(a_title_that_is_neither_owned_nor_catalogued_is_not_in_the_library) {
    Rig rig([](const std::string&) -> std::optional<Response> { return std::nullopt; });
    REQUIRE_EQ(rig.resolver.Resolve({"local-file", "Home video", 2160}).reason, std::string("not-in-library"));
}

// ------------------------------------------------------------------ mpv

TEST(mpv_draws_into_tvms_window_with_its_own_controls_off) {
    tvm::mpv::LaunchOptions options;
    options.url = "https://cdn.example/film.mkv";
    options.windowId = "1234";
    options.ipcPath = "\\\\.\\pipe\\tvm-test";
    options.startAt = 90.5;
    const std::vector<std::string> args = tvm::mpv::BuildArgs(options);
    const auto has = [&](const std::string& arg) { return std::find(args.begin(), args.end(), arg) != args.end(); };
    REQUIRE(has("--wid=1234"));
    REQUIRE(has("--input-ipc-server=\\\\.\\pipe\\tvm-test"));
    REQUIRE(has("--osc=no"));
    REQUIRE(has("--input-default-bindings=no"));
    REQUIRE(has("--gpu-context=d3d11"));
    REQUIRE(has("--start=90.5"));
    REQUIRE_EQ(args.back(), options.url);
}

TEST(mpv_is_looked_for_where_the_old_app_installs_it_first_after_the_variable) {
    const std::vector<std::filesystem::path> paths =
        tvm::mpv::CandidatePaths(EnvWith({{L"TVM_MPV_PATH", L"D:\\mpv.exe"}, {L"LOCALAPPDATA", L"C:\\L"}}));
    REQUIRE_EQ(paths[0], std::filesystem::path("D:\\mpv.exe"));
    REQUIRE_EQ(paths[1], std::filesystem::path("C:\\L\\TVM\\mpv\\mpv.exe"));
}

TEST(mpv_state_is_buffering_until_a_first_frame_and_when_its_cache_runs_dry) {
    tvm::mpv::State state = tvm::mpv::InitialState(30.0);
    REQUIRE_NEAR(state.position, 30.0, 1e-9);
    REQUIRE(tvm::mpv::Buffering(state));
    state = tvm::mpv::ApplyProperty(state, "time-pos", 31.0);
    REQUIRE(state.started);
    REQUIRE(!tvm::mpv::Buffering(state));
    state = tvm::mpv::ApplyProperty(state, "paused-for-cache", true);
    REQUIRE(tvm::mpv::Buffering(state));
    state = tvm::mpv::ApplyProperty(state, "eof-reached", false);
    REQUIRE(!state.ended);
    state = tvm::mpv::ApplyProperty(state, "eof-reached", true);
    REQUIRE(state.ended);
}

TEST(mpv_commands_are_one_json_line_each) {
    REQUIRE_EQ(tvm::mpv::CommandLine(nlohmann::json::array({"seek", 10, "relative"})),
               std::string("{\"command\":[\"seek\",10,\"relative\"]}\n"));
}

TEST(an_english_download_never_takes_a_stream_marked_as_another_language) {
    using tvm::playback::LanguageFit;
    const std::string gb = "\xF0\x9F\x87\xAC\xF0\x9F\x87\xA7";
    const std::string fr = "\xF0\x9F\x87\xAB\xF0\x9F\x87\xB7";
    // Torrentio flags only the languages that are not English, so an unmarked release is English.
    REQUIRE_EQ(LanguageFit("Torrentio 4k Home.2015.2160p.UHD.BluRay.x265\n12 GB", "en"), 0);
    REQUIRE_EQ(LanguageFit("Home.2015.MULTi.TRUEFRENCH.2160p\n" + fr, "en"), -1);
    REQUIRE_EQ(LanguageFit("Home.2015.FRENCH.1080p.WEB", "en"), -1);
    REQUIRE_EQ(LanguageFit("Home 2015 2160p\n" + gb + " / " + fr, "en"), 1);
    REQUIRE_EQ(LanguageFit("Home.2015.1080p.BluRay.Multi-Sub", "en"), 0);
    REQUIRE_EQ(LanguageFit("Home.2015.FRENCH.1080p.WEB", "fr"), 0);
    // Any other language must be marked, since an unmarked name is English.
    REQUIRE_EQ(LanguageFit("Home.2015.1080p", "fr"), -1);

    DebridStream french;
    french.title = "Home.2015.MULTi.2160p";
    french.description = "Torrentio 4k Home.2015.MULTi.2160p\n" + fr;
    DebridStream mixed;
    mixed.title = "Home.2015.2160p";
    mixed.description = "Home.2015.2160p\n" + gb + " " + fr;
    DebridStream english;
    english.title = "Home.2015.1080p";
    english.description = "Home.2015.1080p.BluRay";
    const std::vector<DebridStream> kept = tvm::playback::KeepLanguage({french, mixed, english}, "en");
    // The release with English beside French is left out too: it can open on the French track.
    REQUIRE_EQ(kept.size(), std::size_t{1});
    REQUIRE_EQ(kept[0].title, english.title);
    REQUIRE_EQ(tvm::playback::KeepLanguage({french}, "en").size(), std::size_t{0});
}

}  // namespace
