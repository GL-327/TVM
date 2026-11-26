#include "harness.h"
#include "catalog/playback.h"
#include "core/extras.h"
#include "core/mpv.h"
#include "ui/guide_view.h"

using namespace tvm;

TEST(native_guide_time_and_navigation) {
    const auto start = *guide::ParseTime("2026-11-26T12:00:00.000Z");
    REQUIRE_EQ(guide::ParseTime("2026-11-26T14:00:00+02:00"), std::optional(start));
    REQUIRE_EQ(guide::IsoTime(start), "2026-11-26T12:00:00Z");
    REQUIRE(!guide::ParseTime("2026-02-29T00:00:00Z"));
    REQUIRE_EQ(guide::FloorHalfHour(start + 1799), start);
    guide::Schedule schedule;
    for (int n = 1; n <= 12; ++n) {
        guide::Channel channel;
        channel.id = channel.number = std::to_string(n);
        channel.programmes = {{start, start + 1800, "News", "", "", "", "", ""},
                              {start + 1800, start + 5400, "Film", "", "", "", "", ""}};
        schedule.channels.push_back(channel);
    }
    guide::View view;
    view.SetSchedule(std::move(schedule), start);
    view.Navigate(guide::View::Move::Right);
    REQUIRE_EQ(view.cursor(), start + 1800);
    view.Navigate(guide::View::Move::PageDown);
    REQUIRE_EQ(view.SelectedId(), "9");
    REQUIRE_EQ(view.cursor(), start + 1800);
    view.Navigate(guide::View::Move::Left);
    view.Navigate(guide::View::Move::Left);
    REQUIRE_EQ(view.start(), start - 1800);
    REQUIRE_EQ(view.Tune("12"), "12");
}

TEST(native_video_single_and_double_click) {
    using Action = mpv::VideoClicks::Action;
    mpv::VideoClicks clicks;
    REQUIRE_EQ(clicks.Click(1000, 200, 215, 4, 4), Action::None);
    REQUIRE_EQ(clicks.Tick(1259), Action::None);
    REQUIRE_EQ(clicks.Click(1259, 202, 215, 4, 4), Action::Fullscreen);
    REQUIRE_EQ(clicks.Tick(2000), Action::None);
    REQUIRE_EQ(clicks.Click(2000, 202, 215, 4, 4), Action::None);
    REQUIRE_EQ(clicks.Tick(2260), Action::Pause);
    REQUIRE_EQ(clicks.Tick(2400), Action::None);
}

TEST(native_version_label_and_transport) {
    REQUIRE_EQ(playback::VersionLabel({{"height", 2160}, {"hdr", "dv"}, {"source", "remux"}, {"bitrateMbps", 58.0}}),
               "4K · Dolby Vision · REMUX · 58 Mb/s");
    REQUIRE_EQ(playback::VersionLabel({{"label", "1080p WEB-DL"}, {"hdr", nullptr}}), "1080p WEB-DL");
    REQUIRE_EQ(playback::PlaybackTransport("https://example.test/video.mkv", "native", "file"), "Original file");
    REQUIRE_EQ(playback::PlaybackTransport("http://127.0.0.1/api/stream/hls/abc/index.m3u8", "", ""), "Core HLS");
}

TEST(native_rd_timing_and_extras_defaults) {
    REQUIRE(!extras::RdRefreshDue(true, false, false, 59999, 0));
    REQUIRE(extras::RdRefreshDue(true, false, false, 60000, 0));
    REQUIRE(!extras::RdRefreshDue(true, true, false, 60000, 0));
    REQUIRE(!extras::RdRefreshDue(true, false, true, 60000, 0));
    REQUIRE(!extras::RdRefreshDue(false, false, false, 60000, 0));
    const auto defaults = extras::ParsePreferences(nullptr);
    REQUIRE(defaults.Enabled("seekPreviews"));
    REQUIRE(defaults.Enabled("announcements"));
    REQUIRE(!defaults.Enabled("themeSongs"));
    REQUIRE(!defaults.Enabled("nightMode"));
    const auto values = extras::ParsePreferences({{"extras", {{"themeSongs", true}, {"seekPreviews", false}, {"chapters", "invalid"}}}});
    REQUIRE(values.Enabled("themeSongs"));
    REQUIRE(!values.Enabled("seekPreviews"));
    REQUIRE(values.Enabled("chapters"));
    REQUIRE(values.Enabled("pauseOnMinimize"));
}
