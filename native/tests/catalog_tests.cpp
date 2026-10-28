// Catalogue tests. The Cinemeta and artwork expectations are ported from
// apps/core/src/providers/cinemeta.test.ts and artwork.test.ts, with the same
// fixtures and the same expected values. The service is driven by a fake
// network that serves canned responses, so no test needs the internet.

#include <windows.h>

#include <cmath>
#include <filesystem>
#include <set>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/artwork.h"
#include "catalog/catalog_service.h"
#include "catalog/cinemeta.h"
#include "catalog/media_item.h"
#include "catalog/rails.h"
#include "catalog/recommend.h"
#include "core/js.h"
#include "core/util.h"
#include "harness.h"

namespace {

namespace fs = std::filesystem;
using tvm::catalog::MediaItem;
using tvm::http::Response;

class TempFolder {
public:
    TempFolder() {
        static unsigned counter = 0;
        path_ = fs::temp_directory_path() /
                (L"tvm-catalog-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
        fs::create_directories(path_);
    }
    ~TempFolder() {
        std::error_code ignored;
        fs::remove_all(path_, ignored);
    }
    const fs::path& path() const { return path_; }

private:
    fs::path path_;
};

// Serves canned responses by URL. A URL with no entry fails as a network error.
tvm::catalog::Fetcher FakeNetwork(std::map<std::string, Response>& routes, std::vector<std::string>* requested = nullptr) {
    return [&routes, requested](const std::string& url, unsigned /*timeoutMs*/) -> std::optional<Response> {
        if (requested != nullptr) requested->push_back(url);
        const auto found = routes.find(url);
        if (found == routes.end()) return std::nullopt;
        return found->second;
    };
}

Response Json(const std::string& body, unsigned status = 200) {
    Response response;
    response.status = status;
    response.body = body;
    return response;
}

// ------------------------------------------------------------- artwork

TEST(artwork_promotes_metahub_and_tmdb_stills_used_on_the_hero) {
    REQUIRE_EQ(tvm::catalog::UpgradeImageUrl("https://images.metahub.space/background/medium/tt0111161/img", true),
               std::string("https://images.metahub.space/background/large/tt0111161/img"));
    REQUIRE_EQ(tvm::catalog::UpgradeImageUrl("https://image.tmdb.org/t/p/w1280/abc.jpg", true),
               std::string("https://image.tmdb.org/t/p/original/abc.jpg"));
}

TEST(artwork_fills_a_missing_backdrop_from_metahub_instead_of_stretching_a_poster) {
    REQUIRE_EQ(tvm::catalog::PreferBackdrop("tt0111161", "", "https://example/p.jpg"),
               std::string("https://images.metahub.space/background/large/tt0111161/img"));
}

TEST(artwork_turns_protocol_relative_cdn_urls_into_https) {
    REQUIRE_EQ(tvm::catalog::NormalizeArtUrl("//images.metahub.space/poster/medium/tt0111161/img"),
               std::string("https://images.metahub.space/poster/medium/tt0111161/img"));
    REQUIRE_EQ(tvm::catalog::UpgradeImageUrl("//images.metahub.space/poster/medium/tt0111161/img", false),
               std::string("https://images.metahub.space/poster/large/tt0111161/img"));
}

TEST(artwork_upgrades_itunes_thumbnails_to_the_largest_size) {
    REQUIRE_EQ(tvm::catalog::UpgradeImageUrl("https://is1.mzstatic.com/image/100x100bb.jpg", false),
               std::string("https://is1.mzstatic.com/image/2000x2000bb.jpg"));
}

TEST(artwork_reads_a_bare_tmdb_file_name_as_a_tmdb_path) {
    REQUIRE_EQ(tvm::catalog::NormalizeArtUrl("/abc123.jpg"), std::string("https://image.tmdb.org/t/p/original/abc123.jpg"));
    REQUIRE_EQ(tvm::catalog::NormalizeArtUrl("/abc123.gif"), std::string("/abc123.gif"));
}

TEST(artwork_finds_the_imdb_id_in_a_string) {
    REQUIRE_EQ(tvm::catalog::ImdbIdFrom("Show:TT0111161:1"), std::string("tt0111161"));
    REQUIRE_EQ(tvm::catalog::ImdbIdFrom("no id here"), std::string(""));
}

// ----------------------------------------------------------- cinemeta

MediaItem Show() {
    const nlohmann::json meta = {{"id", "tt0944947"}, {"name", "Game of Thrones"}, {"year", "2011"}, {"imdbRating", "9.3"}};
    return *tvm::catalog::MapMeta(meta, "series");
}

TEST(cinemeta_maps_a_movie_onto_a_playable_item) {
    const nlohmann::json meta = {
        {"id", "tt15398776"}, {"name", "Oppenheimer"}, {"releaseInfo", "2023"},
        {"genre", {"Drama", "History"}}, {"imdbRating", "8.3"}, {"poster", "https://image.tmdb.org/t/p/w500/x.jpg"},
    };
    const auto item = tvm::catalog::MapMeta(meta, "movie");
    REQUIRE(item.has_value());
    REQUIRE_EQ(item->id, std::string("tt15398776"));
    REQUIRE_EQ(item->title, std::string("Oppenheimer"));
    REQUIRE(item->year == std::optional<int>(2023));
    REQUIRE(item->playable);
    REQUIRE(item->genres == (std::vector<std::string>{"Drama", "History"}));
    REQUIRE_EQ(item->rating, std::string("8.3"));
    REQUIRE_EQ(item->hue, tvm::js::HueFor("Oppenheimer"));
}

TEST(cinemeta_fills_a_missing_background_from_a_large_metahub_still) {
    const nlohmann::json meta = {{"id", "tt0111161"}, {"name", "The Shawshank Redemption"}};
    const auto item = tvm::catalog::MapMeta(meta, "movie");
    REQUIRE(item.has_value());
    REQUIRE_EQ(item->poster, std::string("https://images.metahub.space/poster/large/tt0111161/img"));
    REQUIRE_EQ(item->backdrop, std::string("https://images.metahub.space/background/large/tt0111161/img"));
}

TEST(cinemeta_maps_series_videos_into_season_and_episode_children) {
    const MediaItem show = Show();
    const nlohmann::json videos = nlohmann::json::array({
        {{"season", 1}, {"episode", 2}, {"title", "The Kingsroad"}, {"released", "2011-04-24T00:00:00.000Z"}, {"imdbRating", 0}},
        {{"season", 0}, {"episode", 1}, {"title", "Extra"}},
        {{"season", 1}, {"episode", 1}, {"title", "Winter Is Coming"}, {"firstAired", "2011-04-17T00:00:00.000Z"},
         {"overview", "The Starks find a direwolf."}, {"imdbRating", "9.1"}},
    });
    const std::vector<MediaItem> kids = tvm::catalog::MapVideos(show, &videos);

    REQUIRE_EQ(kids.size(), std::size_t{2});
    REQUIRE(kids[0].season == std::optional<int>(1));
    REQUIRE(kids[0].episode == std::optional<int>(1));
    REQUIRE(kids[0].episodeName == std::optional<std::string>("Winter Is Coming"));
    REQUIRE(kids[1].episodeName == std::optional<std::string>("The Kingsroad"));

    REQUIRE_EQ(kids[0].id, std::string("tt0944947:1:1"));
    REQUIRE(kids[0].aired == std::optional<std::string>("2011-04-17"));
    REQUIRE_EQ(kids[0].rating, std::string("9.1"));
    REQUIRE(kids[1].aired == std::optional<std::string>("2011-04-24"));
    // A zero score is not a rating.
    REQUIRE_EQ(kids[1].rating, std::string(""));
}

TEST(cinemeta_reads_seasonNumber_aliases_from_videos) {
    const MediaItem show = Show();
    const nlohmann::json videos = nlohmann::json::array({
        {{"id", "tt0944947:2:3"}, {"title", "What Is Dead"}, {"seasonNumber", 2}, {"episodeNumber", 3}},
    });
    const std::vector<MediaItem> kids = tvm::catalog::MapVideos(show, &videos);
    REQUIRE_EQ(kids.size(), std::size_t{1});
    REQUIRE(kids[0].season == std::optional<int>(2));
    REQUIRE(kids[0].episode == std::optional<int>(3));
}

TEST(cinemeta_reads_the_season_from_the_id_only_when_no_field_is_present) {
    const MediaItem show = Show();
    // A present but invalid season is not replaced by the id's season.
    const nlohmann::json invalid = nlohmann::json::array({{{"id", "tt0944947:2:3"}, {"season", "abc"}, {"episode", 3}}});
    REQUIRE(tvm::catalog::MapVideos(show, &invalid).empty());

    const nlohmann::json absent = nlohmann::json::array({{{"id", "tt0944947:2:3"}, {"title", "Absent"}}});
    const auto kids = tvm::catalog::MapVideos(show, &absent);
    REQUIRE_EQ(kids.size(), std::size_t{1});
    REQUIRE(kids[0].season == std::optional<int>(2));
}

TEST(cinemeta_keeps_an_empty_overview_instead_of_using_the_description) {
    const MediaItem show = Show();
    const nlohmann::json videos = nlohmann::json::array({
        {{"season", 1}, {"episode", 1}, {"overview", ""}, {"description", "Not used"}},
    });
    const auto kids = tvm::catalog::MapVideos(show, &videos);
    REQUIRE_EQ(kids.size(), std::size_t{1});
    REQUIRE_EQ(kids[0].synopsis, std::string(""));
}

TEST(cinemeta_parses_years_like_the_web_code) {
    const nlohmann::json range = "2026-2028";
    REQUIRE(tvm::catalog::ParseYear(&range) == std::optional<int>(2026));
    const nlohmann::json number = 1999;
    REQUIRE(tvm::catalog::ParseYear(&number) == std::optional<int>(1999));
    const nlohmann::json tooEarly = 1700;
    REQUIRE(!tvm::catalog::ParseYear(&tooEarly).has_value());
    const nlohmann::json nothing = nullptr;
    REQUIRE(!tvm::catalog::ParseYear(&nothing).has_value());
}

TEST(cinemeta_keeps_films_from_the_current_and_previous_year_only) {
    const std::vector<MediaItem> items = [] {
        std::vector<MediaItem> out;
        for (int year : {2026, 2025, 2024}) {
            MediaItem item;
            item.id = "tt" + std::to_string(year);
            item.title = "Film";
            item.kind = "movie";
            item.year = year;
            out.push_back(item);
        }
        MediaItem show;
        show.id = "tt9";
        show.title = "Show";
        show.kind = "series";
        show.year = 2026;
        out.push_back(show);
        return out;
    }();
    const auto fresh = tvm::catalog::FilterNewFilms(items, 2026);
    REQUIRE_EQ(fresh.size(), std::size_t{2});
    REQUIRE_EQ(fresh[0].id, std::string("tt2026"));
    REQUIRE_EQ(fresh[1].id, std::string("tt2025"));
}

// ------------------------------------------------------- javascript helpers

TEST(hue_matches_the_web_hash) {
    // Computed with the same 31-multiplier hash over UTF-16 code units in JavaScript.
    REQUIRE_EQ(tvm::js::HueFor(""), 0);
    REQUIRE_EQ(tvm::js::HueFor("a"), 97 % 360);
    REQUIRE_EQ(tvm::js::HueFor("ab"), (97 * 31 + 98) % 360);
}

TEST(number_to_string_matches_javascript) {
    REQUIRE_EQ(tvm::js::NumberToString(8.0), std::string("8"));
    REQUIRE_EQ(tvm::js::NumberToString(9.1), std::string("9.1"));
    REQUIRE_EQ(tvm::js::NumberToString(-3.0), std::string("-3"));
}

TEST(number_parsing_matches_javascript_number) {
    const nlohmann::json text = " 12 ";
    REQUIRE_NEAR(tvm::js::Number(&text), 12.0, 1e-12);
    const nlohmann::json empty = "";
    REQUIRE_NEAR(tvm::js::Number(&empty), 0.0, 1e-12);
    const nlohmann::json word = "abc";
    REQUIRE(std::isnan(tvm::js::Number(&word)));
    REQUIRE(std::isnan(tvm::js::Number(nullptr)));
}

TEST(uri_component_encoding_matches_javascript) {
    REQUIRE_EQ(tvm::js::EncodeUriComponent("Sci-Fi"), std::string("Sci-Fi"));
    REQUIRE_EQ(tvm::js::EncodeUriComponent("Game of Thrones"), std::string("Game%20of%20Thrones"));
    REQUIRE_EQ(tvm::js::EncodeUriComponent("a/b?c"), std::string("a%2Fb%3Fc"));
}

// ------------------------------------------------------------ rail rules

MediaItem Movie(const std::string& id, const std::string& title) {
    MediaItem item;
    item.id = id;
    item.title = title;
    item.kind = "movie";
    return item;
}

TEST(a_title_appears_on_one_rail_only) {
    const std::vector<MediaItem> films = {Movie("tt1", "One"), Movie("tt2", "Two"), Movie("tt3", "Three")};
    std::set<std::string> used;
    const auto first = tvm::catalog::TakeUnused(films, used, 2);
    const auto second = tvm::catalog::TakeUnused(films, used, 5);
    REQUIRE_EQ(first.size(), std::size_t{2});
    REQUIRE_EQ(second.size(), std::size_t{1});
    REQUIRE_EQ(second[0].id, std::string("tt3"));
}

TEST(interleave_alternates_and_fills_from_the_longer_list) {
    const std::vector<MediaItem> movies = {Movie("m1", "M1"), Movie("m2", "M2"), Movie("m3", "M3")};
    const std::vector<MediaItem> shows = {Movie("s1", "S1")};
    std::set<std::string> used;
    const auto mixed = tvm::catalog::InterleaveUnused(movies, shows, used, 10);
    REQUIRE_EQ(mixed.size(), std::size_t{4});
    REQUIRE_EQ(mixed[0].id, std::string("m1"));
    REQUIRE_EQ(mixed[1].id, std::string("s1"));
    REQUIRE_EQ(mixed[2].id, std::string("m2"));
    REQUIRE_EQ(mixed[3].id, std::string("m3"));
}

// -------------------------------------------------------- the service

nlohmann::json MetasOf(const std::vector<std::pair<std::string, std::string>>& titles, const std::string& kind) {
    nlohmann::json metas = nlohmann::json::array();
    for (const auto& [id, name] : titles) {
        metas.push_back({{"id", id}, {"name", name}, {"year", "2024"}, {"type", kind}});
    }
    return {{"metas", metas}};
}

std::map<std::string, Response> CannedCatalog() {
    const std::string base = tvm::catalog::kCinemetaBase;
    std::map<std::string, Response> routes;
    routes[base + "/catalog/movie/top.json"] = Json(MetasOf({{"tt0111161", "The Shawshank Redemption"}}, "movie").dump());
    routes[base + "/catalog/series/top.json"] = Json(MetasOf({{"tt0944947", "Game of Thrones"}}, "series").dump());
    routes[base + "/catalog/movie/imdbRating.json"] = Json(MetasOf({{"tt0111161", "The Shawshank Redemption"}}, "movie").dump());
    routes[base + "/catalog/series/imdbRating.json"] = Json(MetasOf({}, "series").dump());
    routes[base + "/catalog/series/last-videos.json"] = Json(MetasOf({{"tt0903747", "Breaking Bad"}}, "series").dump());
    routes[base + "/catalog/movie/top/skip=100.json"] = Json(MetasOf({{"tt0068646", "The Godfather"}}, "movie").dump());
    return routes;
}

TEST(service_builds_the_bundle_from_the_network_and_dedupes_the_catalog) {
    TempFolder folder;
    std::map<std::string, Response> routes = CannedCatalog();
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes));

    const tvm::catalog::CatalogBundle bundle = service.Bundle();
    REQUIRE_EQ(bundle.moviesTop.size(), std::size_t{1});
    REQUIRE_EQ(bundle.seriesTop[0].title, std::string("Game of Thrones"));
    REQUIRE(bundle.seriesTop[0].kind == "series");
    // The Shawshank Redemption appears in several lists, but once in the catalogue.
    std::size_t shawshank = 0;
    for (const MediaItem& item : bundle.catalog) {
        if (item.id == "tt0111161") ++shawshank;
    }
    REQUIRE_EQ(shawshank, std::size_t{1});
}

TEST(service_writes_the_bundle_cache_in_the_node_format) {
    TempFolder folder;
    std::map<std::string, Response> routes = CannedCatalog();
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes));
    (void)service.Bundle();

    const auto text = tvm::util::ReadTextFile(tvm::paths::CatalogCachePath(folder.path()));
    REQUIRE(text.has_value());
    const nlohmann::json cached = nlohmann::json::parse(*text);
    REQUIRE(cached.at("moviesTop").is_array());
    REQUIRE(cached.at("moviesTop")[0].at("title") == "The Shawshank Redemption");
    REQUIRE(cached.at("at").is_number());
}

TEST(service_falls_back_to_the_disk_cache_when_the_network_is_down) {
    TempFolder folder;
    std::map<std::string, Response> online = CannedCatalog();
    {
        tvm::catalog::CatalogService service(folder.path(), FakeNetwork(online));
        (void)service.Bundle();
    }

    std::map<std::string, Response> offline;
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(offline));
    const tvm::catalog::CatalogBundle bundle = service.Bundle();
    REQUIRE_EQ(bundle.moviesTop.size(), std::size_t{1});
    REQUIRE_EQ(bundle.moviesTop[0].title, std::string("The Shawshank Redemption"));
}

TEST(service_reports_unavailable_without_network_or_cache) {
    TempFolder folder;
    std::map<std::string, Response> offline;
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(offline));
    REQUIRE_THROWS_CONTAINING((void)service.Bundle(), "catalog-unavailable");
}

TEST(service_genre_failure_gives_nothing_and_is_not_cached) {
    TempFolder folder;
    std::map<std::string, Response> routes;
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes));
    REQUIRE(service.Genre("movie", "Horror").empty());

    // Once the network answers, the same genre is fetched again rather than cached as empty.
    const std::string url = std::string(tvm::catalog::kCinemetaBase) + "/catalog/movie/top/genre=Horror.json";
    routes[url] = Json(MetasOf({{"tt0078748", "Alien"}}, "movie").dump());
    REQUIRE_EQ(service.Genre("movie", "Horror").size(), std::size_t{1});
}

TEST(service_meta_prefers_the_series_when_both_kinds_share_an_id) {
    TempFolder folder;
    const std::string base = tvm::catalog::kCinemetaBase;
    std::map<std::string, Response> routes;
    routes[base + "/meta/movie/tt1196946.json"] = Json(R"({"meta":{"id":"tt1196946","name":"Le Mans","releaseInfo":"2008"}})");
    routes[base + "/meta/series/tt1196946.json"] = Json(R"({"meta":{"id":"tt1196946","name":"The Mentalist","releaseInfo":"2008",
        "videos":[{"id":"tt1196946:1:1","title":"Pilot","season":1,"episode":1}]}})");
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes));

    const auto meta = service.Meta("tt1196946");
    REQUIRE(meta.has_value());
    REQUIRE_EQ(meta->item.title, std::string("The Mentalist"));
    REQUIRE(meta->item.kind == "series");
    REQUIRE_EQ(meta->children.size(), std::size_t{1});
    REQUIRE_EQ(meta->children[0].id, std::string("tt1196946:1:1"));
}

TEST(service_meta_is_nothing_for_a_non_imdb_id) {
    TempFolder folder;
    std::map<std::string, Response> routes;
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes));
    REQUIRE(!service.Meta("local:42").has_value());
}

TEST(home_rails_come_in_order_and_never_repeat_a_title) {
    tvm::catalog::CatalogBundle bundle;
    bundle.moviesTop = {Movie("tt1", "One"), Movie("tt2", "Two")};
    bundle.seriesTop = {Movie("tt2", "Two"), Movie("tt3", "Three")};  // "Two" already used on the first rail.
    bundle.newFilms = {};
    bundle.recentTv = {Movie("tt9", "Nine")};

    tvm::catalog::GenreShelf horror;
    horror.genre = "Horror";
    horror.movies = {Movie("tt7", "Seven")};
    horror.shows = {Movie("tt8", "Eight")};

    const std::vector<tvm::catalog::HomeRail> rails = tvm::catalog::BuildHomeRails(bundle, {horror}, {}, {}, 2026);
    REQUIRE_EQ(rails.size(), std::size_t{4});
    REQUIRE_EQ(rails[0].id, std::string("films"));
    REQUIRE_EQ(rails[1].id, std::string("series"));
    REQUIRE(rails[1].items == (std::vector<MediaItem>{Movie("tt3", "Three")}));
    REQUIRE_EQ(rails[2].id, std::string("new-series"));
    REQUIRE_EQ(rails[3].id, std::string("horror"));
    REQUIRE_EQ(rails[3].title, std::string("Horror"));
    REQUIRE_EQ(rails[3].items.size(), std::size_t{2});
}

TEST(home_rails_leave_out_empty_rails) {
    const tvm::catalog::CatalogBundle empty;
    REQUIRE(tvm::catalog::BuildHomeRails(empty, {}, {}, {}, 2026).empty());
}

TEST(service_search_needs_two_characters) {
    TempFolder folder;
    std::map<std::string, Response> routes;
    std::vector<std::string> requested;
    tvm::catalog::CatalogService service(folder.path(), FakeNetwork(routes, &requested));
    REQUIRE(service.Search(" a ").empty());
    REQUIRE(requested.empty());
}

}  // namespace
