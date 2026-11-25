#include "harness.h"
#include "fake_network.h"
#include "core/content.h"
#include "core/profiles.h"
#include "catalog/catalog_service.h"
#include "catalog/playback.h"
#include "ui/scene.h"
#include "ui/live_tv_view.h"
#include "ui/orbit.h"
#include "ui/details_screen.h"
#include "ui/profile_chooser.h"

using nlohmann::json;

TEST(profile_pin_matches_the_shared_pbkdf2_vector) {
    const json pin{{"salt", "00112233445566778899aabbccddeeff"},
                   {"hash", "1eeaf002a05b931ed2f5dd9fd99fc48b215f8e2dc3f300d356eb83bfe6a4adb4"}, {"iter", 20000}};
    REQUIRE(tvm::profiles::CheckPin(pin, "1234"));
    REQUIRE(!tvm::profiles::CheckPin(pin, "1235"));
    REQUIRE(!tvm::profiles::CheckPin(json::object(), "1234"));
    REQUIRE_THROWS_CONTAINING(tvm::profiles::HashPin("12"), "4-digit");
}

TEST(locked_profiles_require_the_pin_and_keep_a_cooldown) {
    tvm::testing::TempFolder folder;
    const auto registry = tvm::profiles::Load(folder.path());
    const auto id = registry.activeId;
    tvm::profiles::Update(folder.path(), id, {{"pin", "1234"}});
    REQUIRE_THROWS_CONTAINING(tvm::profiles::Update(folder.path(), id, {{"name", "Other"}}), "PIN");
    for (int i = 0; i < 4; ++i) REQUIRE_THROWS_CONTAINING(tvm::profiles::Verify(folder.path(), id, "9999"), "Wrong PIN");
    REQUIRE_THROWS_CONTAINING(tvm::profiles::Verify(folder.path(), id, "9999"), "60 seconds");
    REQUIRE_THROWS_CONTAINING(tvm::profiles::Verify(folder.path(), id, "1234"), "Try again");
}

TEST(age_limits_follow_shared_genres_and_live_groups) {
    tvm::testing::TempFolder folder;
    tvm::content::Store store(folder.path(), std::filesystem::path(TVM_REPO_ROOT) / "packages/content");
    const auto policy = store.Read("parental");
    REQUIRE(tvm::content::Allows(policy, 7, {"Animation"}));
    REQUIRE(!tvm::content::Allows(policy, 7, {"Animation", "Horror"}));
    REQUIRE(!tvm::content::Allows(policy, 12, {}));
    REQUIRE(tvm::content::Allows(policy, 15, {"Drama"}));
    REQUIRE(tvm::content::AllowsLive(policy, 7, "Kids"));
    REQUIRE(!tvm::content::AllowsLive(policy, 7, "News"));
    REQUIRE(tvm::content::AllowsLive(policy, 15, "News"));
}

TEST(event_dates_are_inclusive_and_release_changes_the_kicker) {
    const json event{{"start", "2026-12-01"}, {"end", "2026-12-31"}, {"release", "2026-12-16"}};
    REQUIRE(!tvm::content::EventLive(event, "2026-11-30"));
    REQUIRE(tvm::content::EventLive(event, "2026-12-01"));
    REQUIRE(tvm::content::EventLive(event, "2026-12-31"));
    REQUIRE(!tvm::content::EventLive(event, "2027-01-01"));
    REQUIRE_EQ(tvm::content::EventKicker(event, "2026-12-16"), std::string("In cinemas now"));
    REQUIRE_EQ(tvm::content::EventKicker(event, "2026-12-15"), std::string("In cinemas 16 December"));
}

TEST(release_notice_waits_for_home_and_input_after_the_grace_period) {
    tvm::content::ReleaseNotice notice("1.1.0", "1.0.0");
    REQUIRE(notice.Pending());
    REQUIRE(!notice.Input(5000));
    notice.Show(6000);
    REQUIRE(notice.Visible());
    REQUIRE(!notice.Input(7199));
    notice.Show(7100);
    REQUIRE(notice.Input(7200));
    REQUIRE(!notice.Pending());
    REQUIRE_EQ(notice.Seen(), std::string("1.1.0"));
    tvm::content::ReleaseNotice same("1.1.0", notice.Seen());
    same.Show(0);
    REQUIRE(!same.Visible());
}

TEST(screen_quality_uses_the_physical_display_ladder) {
    REQUIRE_EQ(tvm::playback::ScreenClass(768), 1080);
    REQUIRE_EQ(tvm::playback::ScreenClass(1080), 1080);
    REQUIRE_EQ(tvm::playback::ScreenClass(1200), 1440);
    REQUIRE_EQ(tvm::playback::ScreenClass(1600), 2160);
    REQUIRE_EQ(tvm::playback::StreamHeight("Film.1440p.WEB"), 1440);
    std::vector<tvm::playback::DebridStream> streams;
    for (const auto& label : {"Film.720p", "Film.2160p", "Film.1080p", "Film.1440p"})
        streams.push_back(*tvm::playback::ParseDebridStream({{"url", "https://example.com/file"}, {"title", label}}));
    const auto ranked = tvm::playback::CapStreamsToHeight(tvm::playback::RankDebridStreams(streams), 1440);
    REQUIRE_EQ(ranked.size(), std::size_t{3});
    REQUIRE_EQ(tvm::playback::StreamHeight(ranked.front().title), 1440);
}

TEST(catalogue_paging_uses_distinct_skip_cache_keys) {
    tvm::testing::TempFolder folder;
    std::vector<std::string> requests;
    tvm::catalog::CatalogService catalog(folder.path(), [&](const std::string& url, unsigned) {
        requests.push_back(url);
        return std::optional<tvm::http::Response>(tvm::testing::Answer(200, R"({"metas":[{"id":"tt1","name":"Film","type":"movie"}]})"));
    });
    REQUIRE_EQ(catalog.Genre("movie", "Drama", 0).size(), std::size_t{1});
    REQUIRE_EQ(catalog.Genre("movie", "Drama", 50).size(), std::size_t{1});
    catalog.Genre("movie", "Drama", 50);
    REQUIRE_EQ(requests.size(), std::size_t{2});
    REQUIRE(requests[1].find("skip=50") != std::string::npos);
}

TEST(a_short_visual_ring_repeats_hit_targets_across_the_seam) {
    tvm::ui::Rail rail(1, 0);
    rail.Add(std::make_unique<tvm::ui::Card>("One", "one"));
    rail.Add(std::make_unique<tvm::ui::Card>("Two", "two"));
    rail.SetLoop(true);
    const tvm::ui::Metrics metrics;
    rail.Measure(1920, metrics);
    rail.Arrange({0, 100, 1920, 280}, metrics);
    const double period = rail.Period();
    REQUIRE(period > 0);
    REQUIRE_EQ(rail.IndexAt(2), rail.IndexAt(2 + period));
    REQUIRE_EQ(rail.IndexAt(2), rail.IndexAt(2 + period * 4));
    rail.SetScroll(tvm::ui::Rail::kRingOrigin + period - 4);
    rail.Arrange({0, 100, 1920, 280}, metrics);
    REQUIRE_EQ(rail.IndexAt(6), std::optional<std::size_t>(0));
}

TEST(search_editing_survives_loading_empty_and_populated_results) {
    tvm::ui::Scene scene(std::vector<tvm::ui::RailSpec>{}, tvm::motion::MotionSettings{});
    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    view.pageKey = "search";
    view.searchField = true;
    view.loading = true;
    scene.SetView(view, 0);
    scene.Layout(1920, 1080);
    scene.ActivateItem("search-field", 100);
    REQUIRE(scene.SearchEditing());
    view.query = "a";
    scene.SetView(view, 200);
    REQUIRE(scene.SearchEditing());
    view.loading = false;
    view.rails = {{"results", "Results", {{"tt1", "A film", "", {}}}}};
    scene.SetView(view, 300);
    REQUIRE(scene.SearchEditing());
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("search-field"));
    scene.PressedElsewhere("rail-next:0", 400);
    REQUIRE(!scene.SearchEditing());
}

TEST(free_channels_remain_visible_when_the_playlist_fails) {
    tvm::ui::LiveTvState state;
    state.loaded = true;
    state.catalog.error = "unreachable";
    tvm::catalog::LiveChannel channel;
    channel.id = "live:free:bbc"; channel.name = "BBC One"; channel.group = "General"; channel.geo = "GB";
    state.freeChannels.push_back(channel);
    const auto view = tvm::ui::LiveTvView(state);
    REQUIRE_EQ(view.rails.size(), std::size_t{1});
    REQUIRE_EQ(view.rails[0].cards[0].subtitle, std::string("UK"));
    REQUIRE(view.status.find("No login needed") != std::string::npos);
}

TEST(the_orbit_slows_on_stalls_and_smooths_a_burst) {
    tvm::ui::Orbit orbit;
    orbit.Tick(0, 0, 0, false);
    for (int i = 1; i <= 100; ++i) orbit.Tick(i * 16, 0, 0, false);
    REQUIRE_NEAR(orbit.Speed(), 0.35, 0.01);
    orbit.Tick(1616, 10000000, 5, false);
    REQUIRE(orbit.Speed() < 0.5);
    for (int i = 102; i <= 300; ++i) orbit.Tick(i * 16, 10000000, 5, false);
    REQUIRE_NEAR(orbit.Speed(), 2.4, 0.01);
}

TEST(hls_uses_the_best_picture_that_fits_and_keeps_external_audio) {
    const std::string master = "#EXTM3U\n"
        "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"English\",URI=\"../sound/en.m3u8\"\n"
        "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,AUDIO=\"a\"\n720/index.m3u8\n"
        "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO=\"a\"\n1080/index.m3u8\n"
        "#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160,AUDIO=\"a\"\n4k/index.m3u8\n";
    const auto chosen = tvm::playback::SelectHls(master, "https://example.com/live/master.m3u8", 1080);
    REQUIRE(chosen.has_value());
    REQUIRE_EQ(chosen->height, 1080);
    REQUIRE_EQ(chosen->heights, (std::vector<int>{720, 1080, 2160}));
    REQUIRE(chosen->master.find("https://example.com/sound/en.m3u8") != std::string::npos);
    REQUIRE(chosen->master.find("https://example.com/live/1080/index.m3u8") != std::string::npos);
    REQUIRE(chosen->master.find("3840x2160") == std::string::npos);
    REQUIRE(chosen->master.find("1280x720") == std::string::npos);
    REQUIRE_EQ(tvm::playback::SelectHls(master, "https://example.com/a.m3u8", 480)->height, 720);
    REQUIRE(!tvm::playback::SelectHls("#EXTM3U\n#EXTINF:5\na.ts\n", "https://example.com/a.m3u8", 1080));
}

TEST(kids_profile_menu_keeps_switching_and_hides_settings) {
    tvm::ui::ProfileMenu menu;
    tvm::ui::ChooserView view;
    tvm::ui::ProfileEntry child{"child", "Alex", 140}; child.kind = "kids";
    view.profiles = {child, {"adult", "Sam", 221}}; view.activeId = "child";
    menu.SetView(view); menu.Layout(1920, 1080);
    const auto keys = menu.Keys();
    REQUIRE(std::find(keys.begin(), keys.end(), "switch:adult") != keys.end());
    REQUIRE(std::find(keys.begin(), keys.end(), "menu-settings") == keys.end());
}

TEST(details_can_scroll_to_many_connected_services_and_hides_kids_downloads) {
    tvm::ui::DetailsScreen details("tt1", "Film");
    details.Layout(1280, 720);
    tvm::ui::TitleInfo info;
    info.state = tvm::ui::TitleInfo::State::Ready;
    info.id = info.media.id = "tt1"; info.title = "Film"; info.hideDownloads = true;
    for (int i = 0; i < 16; ++i) info.services.push_back({std::to_string(i), "Service " + std::to_string(i)});
    details.SetInfo(info);
    REQUIRE(!details.BoxOf("download"));
    REQUIRE(details.FocusItem("watch:15", 0, true));
    for (double now = 0; now <= 1000; now += 16) details.Tick(now);
    const auto last = details.BoxOf("watch:15");
    REQUIRE(last.has_value());
    REQUIRE(last->Bottom() <= 720);
    REQUIRE(last->y >= 0);
}

TEST(the_hero_imdb_badge_is_reachable_and_opens_the_title_on_imdb) {
    tvm::ui::Scene scene(std::vector<tvm::ui::RailSpec>{}, tvm::motion::MotionSettings{});
    tvm::ui::HeroData hero; hero.itemId = "tt1"; hero.title = "Film"; hero.rating = "8.1";
    scene.SetHeroes({hero}, 0);
    scene.Layout(1920, 1080);
    scene.FocusItem("hero-play", 0, false);
    REQUIRE(scene.Navigate(tvm::nav::Direction::Right, 0));
    REQUIRE(scene.Navigate(tvm::nav::Direction::Right, 0));
    REQUIRE_EQ(scene.FocusedKey(), std::optional<std::string>("hero-imdb"));
    const auto open = scene.Select(0);
    REQUIRE(open.has_value());
    REQUIRE_EQ(open->name, std::string("imdb-open"));
    REQUIRE_EQ(open->params.at("id"), std::string("tt1"));
}
