#include <algorithm>
#include "harness.h"
#include "fake_network.h"
#include "core/core_client.h"
#include "core/extras.h"
#include "core/prefs.h"
#include "core/profiles.h"
#include "core/util.h"
#include "ui/details_screen.h"

using namespace tvm;
TEST(extras_segments_never_guess_and_reject_invalid_ranges) {
    REQUIRE(!extras::ParseSegments(nlohmann::json::object())[0]);
    const auto segments = extras::ParseSegments({{"intro", {{"start", 10}, {"end", 20}}},
        {"recap", {{"start", 30}, {"end", 20}}}, {"credits", {{"start", 900}, {"end", nullptr}}}});
    REQUIRE(segments[0]); REQUIRE(!segments[1]); REQUIRE(segments[2]);
    extras::SegmentSession session;
    REQUIRE(!session.Update(segments, 9, 1000, 0, "button").visible);
    auto skip = session.Update(segments, 10, 1000, 100, "button");
    REQUIRE(skip.visible); REQUIRE_EQ(skip.label, "Skip intro"); REQUIRE_EQ(skip.target, 20.0);
    REQUIRE(!session.Update(segments, 19, 1000, 8100, "button").visible);
    REQUIRE(!session.Update(segments, 20, 1000, 8200, "button").visible);
    REQUIRE(!session.Update(segments, 910, 1000, 9000, "off").visible);
    skip = session.Update(segments, 910, 1000, 9100, "auto");
    REQUIRE(skip.automatic); REQUIRE_EQ(skip.label, "Skip credits");
    REQUIRE(skip.target > 999 && skip.target < 1000);
    REQUIRE(!session.Update(segments, 911, 1000, 9200, "auto").automatic);
}
TEST(extras_skip_pill_ends_with_the_segment_and_all_segment_kinds_work) {
    const auto segments = extras::ParseSegments({{"recap", {{"start", 0}, {"end", 4}}}});
    extras::SegmentSession session;
    REQUIRE_EQ(session.Update(segments, 0, 100, 0, "button").label, "Skip recap");
    REQUIRE(!session.Update(segments, 4, 100, 1000, "button").visible);
    REQUIRE(session.Update(segments, 1, 100, 2000, "button").visible);
}
TEST(extras_preferences_validate_inputs_and_keep_english_default) {
    auto prefs = extras::ParsePreferences({{"skipSegments", "guess"}, {"subtitleLanguages", {"ENG", "bad code", 12}}});
    REQUIRE_EQ(prefs.skip, "button"); REQUIRE_EQ(prefs.languages.front(), "eng");
    prefs = extras::ParsePreferences({{"skipSegments", "auto"}, {"autoplayNext", false}, {"subtitleLanguages", {"fra", "eng", "fra"}}});
    REQUIRE(!prefs.autoplay); REQUIRE_EQ(prefs.languages.size(), std::size_t(2)); REQUIRE_EQ(prefs.languages.front(), "fra");
}
TEST(extras_next_countdown_waits_ten_playing_seconds_and_resets_after_seeking_back) {
    extras::NextCountdown countdown;
    REQUIRE_EQ(countdown.Update(false, true, 0), 10.0);
    REQUIRE_EQ(countdown.Update(true, true, 1000), 10.0);
    REQUIRE_EQ(countdown.Update(true, true, 2000), 9.0);
    REQUIRE_EQ(countdown.Update(true, false, 3000), 9.0);
    REQUIRE_EQ(countdown.Update(true, false, 30000), 9.0);
    REQUIRE_EQ(countdown.Update(true, true, 31000), 9.0);
    for (int i = 0; i < 9; ++i) countdown.Update(true, true, 32000.0 + i * 1000.0);
    REQUIRE_EQ(countdown.Update(true, true, 42000), 0.0);
    REQUIRE_EQ(countdown.Update(false, true, 43000), 10.0);
    REQUIRE_EQ(countdown.Update(true, true, 44000), 10.0);
}
TEST(native_language_or_update_changes_preserve_core_extras_preferences) {
    testing::TempFolder folder;
    util::WriteFileAtomically(paths::PrefsPath(folder.path()), R"({"skipSegments":"auto","autoplayNext":false,"subtitleLanguages":["fra","eng"],"heroPreviews":false})");
    prefs::WritePrefs(folder.path(), {std::string("fr"), false});
    const auto raw = nlohmann::json::parse(*util::ReadTextFile(paths::PrefsPath(folder.path())));
    REQUIRE_EQ(raw["skipSegments"], "auto"); REQUIRE_EQ(raw["subtitleLanguages"][0], "fra"); REQUIRE_EQ(raw["autoplayNext"], false);
}
TEST(native_extras_clear_accepts_empty_204_and_subtitles_stay_on_core) {
    testing::TempFolder folder; int requests = 0;
    coreapi::Client client(folder.path(), 7345, [&](const std::string& url, const http::Options& options) -> std::optional<http::Response> {
        ++requests; REQUIRE(!options.followRedirects); REQUIRE_EQ(options.timeoutMs, 6000u);
        if (url.ends_with("/clear")) return http::Response{204, ""};
        REQUIRE(url.starts_with("http://127.0.0.1:7345/api/extras/subtitle.vtt?u="));
        return http::Response{200, "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"};
    });
    REQUIRE(client.Call("/api/extras/stats/clear", "POST").is_object());
    REQUIRE(client.Subtitle("/api/extras/subtitle.vtt?u=fixture").starts_with("WEBVTT"));
    REQUIRE_THROWS_CONTAINING(client.Subtitle("https://example.test/subtitle.vtt"), "Invalid subtitle");
    REQUIRE_THROWS_CONTAINING(client.Subtitle("http://127.0.0.1:7345.evil.test/api/extras/subtitle.vtt?u=fixture"), "Invalid subtitle");
    REQUIRE_EQ(requests, 2);
}
TEST(native_account_admin_role_comes_from_private_service_and_does_not_grant_live_tv) {
    const auto state = coreapi::ParseAccount({{"signedIn", true}, {"account", {{"role", "admin"}, {"tier", "stream"}, {"hasRdToken", true}}}, {"usable", {{"ok", true}}}});
    REQUIRE(coreapi::AllowsRoute(state, "accounts")); REQUIRE(!state.liveTv); REQUIRE(state.rdKey);
    const auto legacy = coreapi::ParseAccount({{"signedIn", true}, {"account", {{"role", "dev"}}}, {"usable", {{"ok", true}}}});
    REQUIRE(coreapi::AllowsRoute(legacy, "accounts")); // Core adapter maps private admin to this role.
}
TEST(native_extras_requests_follow_the_selected_profile) {
    testing::TempFolder folder;
    const auto registry = profiles::Create(folder.path(), "Second viewer");
    coreapi::Client client(folder.path(), 7345, [&](const std::string&, const http::Options& options) -> std::optional<http::Response> {
        const auto expected = std::pair<std::string, std::string>{"X-TVM-Profile", registry.activeId};
        REQUIRE(std::find(options.headers.begin(), options.headers.end(), expected) != options.headers.end());
        return http::Response{200, "{}"};
    });
    client.Call("/api/extras/stats");
    client.Call("/api/prefs", "PUT", {{"subtitleLanguages", {"fra"}}});
}
TEST(extras_trailers_and_upcoming_hide_missing_or_invalid_data) {
    REQUIRE(extras::YoutubeUrl({{"trailers", {{{"youtubeId", "../../bad"}}}}}).empty());
    REQUIRE_EQ(extras::YoutubeUrl({{"trailers", {{{"youtubeId", "dQw4w9WgXcQ"}}}}}), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    REQUIRE(extras::UpcomingLabel(nullptr).empty());
    REQUIRE(extras::UpcomingLabel({{"airstamp", "2026-11-25T12:00:00Z"}}).starts_with("New episode Wednesday, 25 November"));
    REQUIRE(extras::UpcomingLabel({{"airstamp", "2026-11-25T23:30:00-05:00"}}).starts_with("New episode Thursday, 26 November"));
}
TEST(native_details_collection_supports_pointer_and_remote_navigation) {
    ui::DetailsScreen screen("tt1", "Film"); screen.Layout(1280, 720);
    ui::TitleInfo info; info.id = "tt1"; info.title = "Film"; info.state = ui::TitleInfo::State::Ready;
    info.media.id = "tt1"; info.collectionName = "Film collection"; info.trailerUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    catalog::MediaItem other; other.id = "tt2"; other.title = "Next film"; info.collection.push_back(other);
    screen.SetInfo(info);
    REQUIRE(screen.BoxOf("trailer")); REQUIRE(screen.BoxOf("collection:0"));
    const auto trailer = screen.ActivateItem("trailer", 0); REQUIRE(trailer); REQUIRE_EQ(trailer->name, "trailer-open");
    REQUIRE(screen.Navigate(nav::Direction::Down, 1)); REQUIRE_EQ(*screen.FocusedKey(), "collection:0");
    const auto details = screen.Select(2); REQUIRE(details); REQUIRE_EQ(details->name, "details"); REQUIRE_EQ(details->params.at("id"), "tt2");
    REQUIRE(screen.Navigate(nav::Direction::Up, 3)); REQUIRE_EQ(*screen.FocusedKey(), "play");
}
