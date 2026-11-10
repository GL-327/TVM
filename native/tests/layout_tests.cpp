#include <string>
#include <vector>

#include "harness.h"
#include "ui/layout.h"
#include "ui/pages.h"
#include "ui/details_screen.h"
#include "ui/player_screen.h"
#include "ui/scene.h"
#include "ui/theme.h"

namespace {

TEST(native_layout_keeps_tv_scale_and_readable_portrait_text) {
    REQUIRE_NEAR(tvm::ui::ViewportRem(1920, 1080), 16.0, 1e-9);
    REQUIRE_NEAR(tvm::ui::ViewportRem(1280, 720), 720.0 / 67.5, 1e-9);
    REQUIRE(tvm::ui::ViewportRem(390, 844) >= 14.0);
    REQUIRE(tvm::ui::ViewportRem(568, 320) >= 10.0);
}

TEST(info_page_wraps_actions_and_preserves_keyboard_reachability_after_resize) {
    tvm::ui::InfoView view;
    view.heading = "Downloads";
    view.topActions = {{"first", "Choose a download folder"}, {"second", "Download selected episodes"}, {"third", "Cancel downloads"}};
    tvm::ui::InfoScreen screen;
    screen.Layout(390, 844);
    screen.SetView(view);
    double bottom = 0;
    for (const std::string key : {"first", "second", "third"}) {
        const auto box = screen.BoxOf(key);
        REQUIRE(box.has_value());
        REQUIRE(box->x >= 0);
        REQUIRE(box->Right() <= 390);
        REQUIRE(box->height >= 44);
        REQUIRE(box->y >= bottom);
        bottom = box->Bottom();
    }
    screen.FocusItem("first", 0, false);
    REQUIRE(screen.Navigate(tvm::nav::Direction::Down, 0));
    REQUIRE_EQ(screen.FocusedKey().value_or(""), std::string("second"));
    screen.Layout(1920, 1080);
    REQUIRE_NEAR(screen.BoxOf("first")->y, screen.BoxOf("third")->y, 1e-9);
}

TEST(profiles_wrap_all_ten_profiles_inside_a_portrait_window) {
    tvm::ui::ProfilesScreen screen;
    tvm::ui::ProfilesView view;
    for (int i = 0; i < 10; ++i) view.profiles.push_back({std::to_string(i), "Profile " + std::to_string(i), 221});
    view.activeId = "0";
    screen.Layout(390, 844);
    screen.SetView(view);
    for (const auto& profile : view.profiles) {
        const auto box = screen.BoxOf("pick:" + profile.id);
        REQUIRE(box.has_value());
        REQUIRE(box->x >= 0);
        REQUIRE(box->Right() <= 390);
    }
    REQUIRE(screen.BoxOf("profiles-back")->y > screen.BoxOf("pick:9")->Bottom());
}

TEST(theme_scope_restores_the_previous_palette_after_a_nested_paint) {
    const double dark = tvm::ui::tokens::kBackground.r;
    {
        tvm::ui::ThemeScope light(tvm::ui::Theme::Light);
        REQUIRE_NEAR(tvm::ui::tokens::kBackground.r, 244.0 / 255.0, 1e-9);
        {
            tvm::ui::ThemeScope video(tvm::ui::Theme::Dark);
            REQUIRE_NEAR(tvm::ui::tokens::kBackground.r, dark, 1e-9);
        }
        REQUIRE_NEAR(tvm::ui::tokens::kText.r, 18.0 / 255.0, 1e-9);
    }
    REQUIRE_NEAR(tvm::ui::tokens::kBackground.r, dark, 1e-9);
    REQUIRE(tvm::ui::ParseTheme("synthwave") == tvm::ui::Theme::Dark);
}

TEST(native_player_controls_and_details_stay_inside_narrow_windows) {
    for (const auto size : {std::pair{390.0, 844.0}, std::pair{568.0, 320.0}, std::pair{320.0, 568.0}}) {
        tvm::ui::PlayerScreen player;
        tvm::ui::PlayerView view;
        view.phase = tvm::ui::PlayerView::Phase::Playing;
        view.started = true;
        view.canSave = true;
        view.duration = 600;
        player.Layout(size.first, size.second);
        player.SetView(view, 0);
        for (const std::string key : {"play", "rewind", "forward", "mute", "speed", "fullscreen", "back", "download", "watchlist"}) {
            const auto box = player.BoxOf(key);
            REQUIRE(box.has_value());
            REQUIRE(box->x >= 0);
            REQUIRE(box->Right() <= size.first + 0.01);
            REQUIRE(box->y >= 0);
            REQUIRE(box->Bottom() <= size.second + 0.01);
        }
        tvm::ui::DetailsScreen details("tt0137523", "Film");
        details.Layout(size.first, size.second);
        tvm::ui::TitleInfo info;
        info.state = tvm::ui::TitleInfo::State::Ready;
        info.media.id = info.id = "tt0137523";
        info.title = "Film";
        details.SetInfo(info);
        for (const std::string key : {"play", "list", "download", "back"}) {
            const auto box = details.BoxOf(key);
            REQUIRE(box.has_value());
            REQUIRE(box->x >= 0);
            REQUIRE(box->Right() <= size.first + 0.01);
        }
    }
}

}  // namespace
