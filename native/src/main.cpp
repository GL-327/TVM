// TVM native entry point.
//
//   tvm.exe                          run the app
//   tvm.exe --snapshot out.png       render the screen to a PNG and exit
//     --size 1920x1080               snapshot size (default 1920x1080)
//     --keys Right,Down,Select       remote presses to apply before the snapshot
//                                    (Up, Down, Left, Right, Select, Back)
//     --theme light --screen settings  capture the light Settings page
//     --screen live|library|search|player  a page lane under the chrome, or the player over the picture
//     --art file.jpg                 the Home hero's picture (default: the bundled lighthouse)
//     --glass frosted                Settings > Look > Liquid Glass (default: clear)
//   tvm.exe --frames out-dir --scenario tab-switch
//                                    write an animation as numbered PNG frames, 30 per second:
//                                    nav-intro, tab-switch, buttons, orb or menu
//
// The snapshot mode is for visual checks. It runs the same shell and the same
// animations, then saves the settled frame. It uses a throwaway data folder, so
// it never changes the viewer's preferences.

#include <windows.h>
#include <objbase.h>
#include <shellapi.h>

#include <algorithm>
#include <cstdio>
#include <cwctype>
#include <exception>
#include <filesystem>
#include <functional>
#include <cwchar>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "core/paths.h"
#include "core/util.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "platform/app.h"
#include "platform/graphics.h"
#include "platform/snapshot.h"
#include "ui/player_screen.h"
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/shell.h"
#include "ui/theme.h"
#include "ui/settings_screen.h"

namespace {

using tvm::nav::Direction;
using tvm::ui::RailSpec;

// The snapshot Home screen's view, matching Study 03 (Roku Home) and the live Stream Home layout. `lane`
// picks the tab that is on: 0 Home, 1 Movies, 2 Series.
tvm::ui::SceneView SnapshotHomeView(int lane) {
    const auto open = [](const std::string& name, bool modal = false) {
        tvm::ui::Command command;
        command.name = name;
        command.modal = modal;
        return command;
    };
    const auto act = [](const std::string& name, const std::string& lane = "") {
        tvm::ui::Command command;
        command.name = name;
        command.action = true;
        if (!lane.empty()) command.params["lane"] = lane;
        return command;
    };

    tvm::ui::SceneView view;
    view.style = tvm::ui::SceneStyle::Stream;
    view.topButtons = {
        tvm::ui::TopButton{"Home", act("stream-lane", "all"), lane == 0},
        tvm::ui::TopButton{"Movies", act("stream-lane", "movies"), lane == 1},
        tvm::ui::TopButton{"Series", act("stream-lane", "shows"), lane == 2},
        tvm::ui::TopButton{"Live TV", open("live-tv"), lane == 3},
        tvm::ui::TopButton{"Library", open("watchlist"), lane == 4},
        tvm::ui::TopButton{"Search", open("search", true), lane == 5},
        tvm::ui::TopButton{"Profile", open("settings"), false, false, true},
    };

    tvm::ui::RailData continueWatching;
    continueWatching.id = "continue-watching";
    continueWatching.title = "Continue Watching";
    continueWatching.cards = {
        tvm::ui::CardData{"cw-1", "The Last Light", "asset:lighthouse.jpg", 0.38},
        tvm::ui::CardData{"cw-2", "The Winter Road", "", 0.72},
        tvm::ui::CardData{"cw-3", "Northward", "", 0.24},
        tvm::ui::CardData{"cw-4", "Quiet Harbor", "", 0.56},
        tvm::ui::CardData{"cw-5", "Distant Shore", "", 0.18},
    };
    view.rails.push_back(std::move(continueWatching));

    tvm::ui::RailData trending;
    trending.id = "trending-movies";
    trending.title = "Trending Movies";
    const char* trendingTitles[] = {
        "Cold Meridian", "Vesper", "The Glass Coast", "Solstice", "Low Tide",
        "High Water", "Ambergris", "Night Watch", "Far Sound", "Pale Signal"
    };
    for (std::size_t i = 0; i < 10; ++i) {
        trending.cards.push_back(tvm::ui::CardData{
            "tm-" + std::to_string(i + 1),
            trendingTitles[i],
            i == 0 ? "asset:lighthouse.jpg" : "",
            std::nullopt,
        });
    }
    view.rails.push_back(std::move(trending));

    tvm::ui::RailData picks;
    picks.id = "you-might-like";
    picks.title = "You might like";
    for (std::size_t i = 0; i < 10; ++i) {
        picks.cards.push_back(tvm::ui::CardData{
            "pick-" + std::to_string(i + 1),
            "Title " + std::to_string(i + 1),
            "",
            std::nullopt,
        });
    }
    view.rails.push_back(std::move(picks));
    return view;
}

// Configures the snapshot Home screen. `art` is the hero's picture, as a url the painter resolves.
std::unique_ptr<tvm::ui::Scene> SnapshotHomeScene(tvm::motion::MotionSettings motion, const std::string& art) {
    auto scene = std::make_unique<tvm::ui::Scene>(std::vector<RailSpec>{}, motion);
    scene->SetImageReady([](const std::string& url) { return !url.empty(); });

    tvm::ui::HeroData hero;
    hero.itemId = "featured-last-light";
    hero.title = "The Last Light";
    hero.meta = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
    hero.backdropUrl = art;
    hero.hue = 212;

    scene->SetHeroes({hero}, 0.0);
    scene->SetView(SnapshotHomeView(0), 0.0);
    scene->FocusItem("hero-play", 0.0, false);
    return scene;
}

// The hero the snapshot Home shows on its browse lanes.
tvm::ui::HeroData SnapshotHero(const std::string& art) {
    tvm::ui::HeroData hero;
    hero.itemId = "featured-last-light";
    hero.title = "The Last Light";
    hero.meta = "Movie \xC2\xB7 Drama \xC2\xB7 2h 6m \xC2\xB7 4K";
    hero.backdropUrl = art;
    hero.hue = 212;
    return hero;
}

// A page lane as the app builds it (App::ShowPageLane): Stream style, the six-tab chrome with this lane on, and the
// page's own controls under it. Fixture data stands in for the real sources: channels, saved titles and results.
tvm::ui::SceneView SnapshotPageLane(int lane, const std::string& art) {
    tvm::ui::SceneView view = SnapshotHomeView(lane);
    view.rails.clear();
    const auto act = [](const std::string& name) {
        tvm::ui::Command command;
        command.name = name;
        command.action = true;
        return command;
    };
    const auto rows = [](std::vector<tvm::ui::CardData> cards, const std::string& id, const std::string& title) {
        std::vector<tvm::ui::RailData> rails;
        for (std::size_t i = 0; i < cards.size(); i += 8) {
            tvm::ui::RailData rail;
            rail.id = id + "-" + std::to_string(i / 8);
            rail.title = i == 0 ? title : "";
            for (std::size_t j = i; j < std::min(i + 8, cards.size()); ++j) rail.cards.push_back(cards[j]);
            rails.push_back(std::move(rail));
        }
        return rails;
    };
    if (lane == 3) {
        view.kicker = "Channels";
        view.heading = "Live TV";
        view.status = "12 channels.";
        view.cardAction = tvm::ui::CardAction::Play;
        view.pageButtons = {tvm::ui::TopButton{"Choose channels", act("live-choose")},
                            tvm::ui::TopButton{"Login", act("live-xtream")},
                            tvm::ui::TopButton{"Playlist", act("live-playlist")}};
        const char* groups[] = {"News", "Sports", "Movies"};
        const char* names[] = {"TVM News", "World Report", "City 24", "Arena One", "Match Day", "Goal Line",
                               "Cinema Classics", "Late Show", "Premiere", "Studio Nine", "Night Owl", "Replay"};
        for (int g = 0; g < 3; ++g) {
            std::vector<tvm::ui::CardData> cards;
            for (int i = 0; i < 4; ++i) {
                tvm::ui::CardData card;
                card.itemId = "live:fixture:" + std::to_string(g * 4 + i);
                card.title = names[g * 4 + i];
                card.posterUrl = i % 2 == 0 ? "asset:tvm-icon.png" : "";
                card.logo = true;
                cards.push_back(card);
            }
            for (auto& rail : rows(cards, std::string("live-") + groups[g], groups[g])) view.rails.push_back(rail);
        }
    } else if (lane == 4) {
        view.kicker = "10 saved \xC2\xB7 6 films \xC2\xB7 4 series";
        view.heading = "Library";
        view.pageButtons = {tvm::ui::TopButton{"All", act("watchlist-filter"), true},
                            tvm::ui::TopButton{"Movies", act("watchlist-filter")},
                            tvm::ui::TopButton{"Series", act("watchlist-filter")},
                            tvm::ui::TopButton{"Sort: Recently saved", act("watchlist-sort")}};
        std::vector<tvm::ui::CardData> movies, series;
        const char* films[] = {"The Last Light", "Cold Meridian", "Vesper", "The Glass Coast", "Solstice", "Low Tide"};
        const char* shows[] = {"Northward", "Quiet Harbor", "Pale Signal", "Far Sound"};
        for (int i = 0; i < 6; ++i) movies.push_back({"tt-m" + std::to_string(i), films[i], i == 0 ? "asset:lighthouse.jpg" : i == 1 ? art : "", std::nullopt});
        for (int i = 0; i < 4; ++i) series.push_back({"tt-s" + std::to_string(i), shows[i], i == 0 ? art : "", std::nullopt});
        for (auto& rail : rows(movies, "movies", "Movies")) view.rails.push_back(rail);
        for (auto& rail : rows(series, "series", "Series")) view.rails.push_back(rail);
    } else if (lane == 5) {
        view.heading = "Search";
        view.searchField = true;
        view.query = "light";
        view.status = "9 matches";
        std::vector<tvm::ui::CardData> movies, series;
        const char* films[] = {"The Last Light", "Lighthouse", "Northern Lights", "Light Years", "Pale Light"};
        const char* shows[] = {"Lights Out", "Light & Shadow", "Lightkeepers", "First Light"};
        for (int i = 0; i < 5; ++i) movies.push_back({"tt-q" + std::to_string(i), films[i], i == 0 ? "asset:lighthouse.jpg" : i == 2 ? art : "", std::nullopt});
        for (int i = 0; i < 4; ++i) series.push_back({"tt-r" + std::to_string(i), shows[i], i == 1 ? art : "", std::nullopt});
        for (auto& rail : rows(movies, "movies", "Movies")) view.rails.push_back(rail);
        for (auto& rail : rows(series, "series", "Series")) view.rails.push_back(rail);
    }
    return view;
}

// Switches the snapshot Home to a lane as App::SetStreamLane does, fading page lanes in from the ground.
void ShowSnapshotLane(tvm::ui::Scene& scene, int lane, int previous, const std::string& art, double nowMs) {
    if (lane >= 3) {
        scene.SetHeroes({}, nowMs);
        scene.SetView(SnapshotPageLane(lane, art), nowMs);
    } else {
        scene.SetHeroes({SnapshotHero(art)}, nowMs);
        scene.SetView(SnapshotHomeView(lane), nowMs);
    }
    if (lane != previous && (lane >= 3 || previous >= 3)) scene.FadeContentIn(nowMs);
}

// The player over a still of the picture, as the overlay draws it over mpv's video.
std::unique_ptr<tvm::ui::PlayerScreen> SnapshotPlayer(unsigned width, unsigned height) {
    auto player = std::make_unique<tvm::ui::PlayerScreen>();
    player->Layout(width, height);
    tvm::ui::PlayerView view;
    view.phase = tvm::ui::PlayerView::Phase::Playing;
    view.started = true;
    view.title = "Northward";
    view.episode = "S1 \xC2\xB7 E2";
    view.episodeTitle = "The Long Road";
    view.position = 1520.0;
    view.duration = 3480.0;
    view.subtitles = {tvm::ui::PlayerOption{"off", "Off", "", false}, tvm::ui::PlayerOption{"en", "English", "", true}};
    view.audios = {tvm::ui::PlayerOption{"a1", "English", "5.1", true}, tvm::ui::PlayerOption{"a2", "Espa\xC3\xB1ol", "", false}};
    view.qualities = {tvm::ui::PlayerOption{"1080", "1080p", "", true}};
    view.qualityLabel = "1080p";
    player->SetView(view, 0.0);
    player->ShowChrome(0.0);
    return player;
}

std::optional<Direction> ParseDirection(const std::wstring& name) {
    if (name == L"Up") return Direction::Up;
    if (name == L"Down") return Direction::Down;
    if (name == L"Left") return Direction::Left;
    if (name == L"Right") return Direction::Right;
    return std::nullopt;
}

// Parses "WxH". Returns nothing for anything else.
std::optional<std::pair<unsigned, unsigned>> ParseSize(const std::wstring& text) {
    const auto x = text.find(L'x');
    if (x == std::wstring::npos) return std::nullopt;
    try {
        const unsigned long width = std::stoul(text.substr(0, x));
        const unsigned long height = std::stoul(text.substr(x + 1));
        if (width == 0 || height == 0 || width > 8192 || height > 8192) return std::nullopt;
        return std::make_pair(static_cast<unsigned>(width), static_cast<unsigned>(height));
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::vector<std::wstring> SplitCommas(const std::wstring& text) {
    std::vector<std::wstring> parts;
    std::wstring current;
    for (wchar_t c : text) {
        if (c == L',') {
            parts.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) parts.push_back(current);
    return parts;
}

// Runs the shell's motion until it settles, one 60 Hz frame at a time.
void SettleMotion(tvm::ui::Shell& shell, double& nowMs) {
    for (int frame = 0; frame < 2000 && shell.Animating(); ++frame) {
        nowMs += 16.0;
        shell.Tick(nowMs);
    }
}

int RunSnapshot(const std::wstring& path, unsigned width, unsigned height, const std::wstring& keys,
                tvm::ui::Theme theme, const std::wstring& screen, const std::string& art, tvm::ui::GlassClarity glass) {
    tvm::platform::Graphics graphics;
    const bool settings = screen == L"settings";
    if (screen == L"player") {
        // The player's chrome over a still of the picture, as it sits over mpv's video.
        tvm::platform::SnapshotWriter writer(graphics, width, height);
        auto player = SnapshotPlayer(width, height);
        player->Tick(100.0);
        writer.Save([&](tvm::ui::Painter& painter) {
            const tvm::ui::ThemeScope look(tvm::ui::Theme::Dark);
            painter.Clear(tvm::ui::Rgb(0x000000));
            painter.ImageFaded(tvm::ui::Box{0.0, 0.0, static_cast<double>(width), static_cast<double>(height)}, art, 0.0,
                               1.0, 0.5, 0.5);
            player->Paint(painter);
        }, path, false);
        std::printf("wrote %ls\n", path.c_str());
        return 0;
    }

    // A throwaway data folder, so a Settings press here cannot change the viewer's files.
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-snapshot-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    store.SaveLook(theme);
    store.SaveGlass(glass);
    std::unique_ptr<tvm::ui::Screen> root;
    tvm::ui::Scene* home = nullptr;
    if (settings) {
        root = std::make_unique<tvm::ui::SettingsScreen>(store, store.Motion());
    } else {
        auto scene = SnapshotHomeScene(store.Motion(), art);
        home = scene.get();
        root = std::move(scene);
    }
    tvm::ui::Shell shell(std::move(root), store);
    shell.Layout(width, height);
    // Live TV, Library and Search are lanes of Home under the same chrome.
    const int lane = screen == L"live" ? 3 : screen == L"library" ? 4 : screen == L"search" ? 5 : 0;
    if (home != nullptr && lane > 0) ShowSnapshotLane(*home, lane, lane, art, 0.0);

    double nowMs = 0.0;
    for (const std::wstring& token : SplitCommas(keys)) {
        if (token == L"Select") {
            shell.Select(nowMs);
        } else if (token == L"Back") {
            shell.Back(nowMs);
        } else if (const auto direction = ParseDirection(token)) {
            shell.Navigate(*direction, nowMs);
        } else {
            std::fprintf(stderr, "unknown key in --keys\n");
            std::error_code ignored;
            std::filesystem::remove_all(tempData, ignored);
            return 2;
        }
        SettleMotion(shell, nowMs);
    }
    SettleMotion(shell, nowMs);

    tvm::platform::SaveSnapshot(shell, graphics, width, height, path);
    std::error_code ignored;
    std::filesystem::remove_all(tempData, ignored);
    std::printf("wrote %ls\n", path.c_str());
    return 0;
}


// One step of a scripted animation: at `atMs`, `apply` runs before that frame is drawn.
struct FrameEvent {
    double atMs;
    std::function<void(double nowMs)> apply;
};

// Writes an animation as numbered PNG frames at 30 per second, so the motion can be checked frame by frame
// and turned into a GIF. Every frame is drawn by the same Direct2D painter the window uses.
int RunFrames(const std::wstring& dir, const std::wstring& scenario, unsigned width, unsigned height,
              tvm::ui::Theme theme, const std::string& art, tvm::ui::GlassClarity glass) {
    tvm::platform::Graphics graphics;
    const std::filesystem::path tempData =
        std::filesystem::temp_directory_path() / (L"tvm-frames-" + std::to_wstring(GetCurrentProcessId()));
    tvm::ui::FilePreferenceStore store(tempData);
    store.SaveLook(theme);
    store.SaveGlass(glass);
    std::filesystem::create_directories(dir);
    tvm::platform::SnapshotWriter writer(graphics, width, height);

    std::vector<FrameEvent> events;
    double endMs = 1500.0;
    std::function<bool(double)> tick;
    std::function<void(tvm::ui::Painter&)> paint;
    std::unique_ptr<tvm::ui::Shell> shell;
    std::unique_ptr<tvm::ui::PlayerScreen> player;

    if (scenario == L"player-controls") {
        // Hover the transport, then drag along the timeline and let go.
        player = SnapshotPlayer(width, height);
        tvm::ui::PlayerScreen* raw = player.get();
        events.push_back({200.0, [raw](double now) { raw->ShowChrome(now); raw->FocusItem("rewind", now, false); }});
        events.push_back({600.0, [raw](double now) { raw->ShowChrome(now); raw->FocusItem("play", now, false); }});
        events.push_back({1000.0, [raw](double now) { raw->ShowChrome(now); raw->FocusItem("forward", now, false); }});
        events.push_back({1400.0, [raw](double now) { raw->ShowChrome(now); raw->Hover(0.6); }});
        for (int step = 0; step <= 8; ++step) {
            events.push_back({1700.0 + step * 50.0, [raw, step](double now) { raw->ShowChrome(now); raw->Scrub(0.6 - 0.04 * step); }});
        }
        events.push_back({2250.0, [raw](double now) { raw->EndScrub(); raw->Hover(std::nullopt); raw->ShowChrome(now); }});
        endMs = 2700.0;
        tick = [raw](double now) { return raw->Tick(now); };
        paint = [raw, art, width, height](tvm::ui::Painter& painter) {
            const tvm::ui::ThemeScope look(tvm::ui::Theme::Dark);
            painter.Clear(tvm::ui::Rgb(0x000000));
            painter.ImageFaded(tvm::ui::Box{0.0, 0.0, static_cast<double>(width), static_cast<double>(height)}, art,
                               0.0, 1.0, 0.5, 0.5);
            raw->Paint(painter);
        };
    } else if (scenario == L"menu") {
        tvm::ui::ThemeScope look(theme);
        player = std::make_unique<tvm::ui::PlayerScreen>();
        player->Layout(width, height);
        tvm::ui::PlayerView view;
        view.phase = tvm::ui::PlayerView::Phase::Playing;
        view.started = true;
        view.title = "The Last Light";
        view.position = 1520.0;
        view.duration = 7560.0;
        view.subtitles = {tvm::ui::PlayerOption{"off", "Off", "", false},
                          tvm::ui::PlayerOption{"en", "English", "", true},
                          tvm::ui::PlayerOption{"en-sdh", "English", "SDH", false},
                          tvm::ui::PlayerOption{"es", "Espa\xC3\xB1ol", "", false},
                          tvm::ui::PlayerOption{"fr", "Fran\xC3\xA7" "ais", "", false}};
        view.audios = {tvm::ui::PlayerOption{"a1", "English", "5.1", true}};
        player->SetView(view, 0.0);
        player->ShowChrome(0.0);
        tvm::ui::PlayerScreen* raw = player.get();
        events.push_back({200.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        events.push_back({1100.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        endMs = 1600.0;
        tick = [raw](double now) { return raw->Tick(now); };
        paint = [raw, art, width, height, theme](tvm::ui::Painter& painter) {
            tvm::ui::ThemeScope look(theme);
            // A still of the picture stands in for mpv's video under the player's chrome.
            painter.Clear(tvm::ui::Rgb(0x000000));
            painter.ImageFaded(tvm::ui::Box{0.0, 0.0, static_cast<double>(width), static_cast<double>(height)}, art,
                               0.0, 1.0, 0.5, 0.5);
            raw->Paint(painter);
        };
    } else {
        auto root = SnapshotHomeScene(store.Motion(), art);
        tvm::ui::Scene* scene = root.get();
        shell = std::make_unique<tvm::ui::Shell>(std::move(root), store);
        shell->Layout(width, height);
        tvm::ui::Shell* host = shell.get();
        const auto hover = [scene](const std::string& key) {
            return [scene, key](double now) { scene->FocusItem(key, now, false); };
        };
        const auto press = [scene](const std::string& key) {
            return [scene, key](double now) { scene->SetPressed(key, now); };
        };
        const auto release = [scene](double now) { scene->SetPressed(std::nullopt, now); };
        const auto lane = [scene](int which) {
            return [scene, which](double now) { scene->SetView(SnapshotHomeView(which), now); };
        };
        if (scenario == L"nav-all-tabs") {
            // Every tab in turn, by clicking it: Home, Movies, Live TV, Library, Search and back Home.
            const auto go = [scene, art](int lane, int previous) {
                return [scene, art, lane, previous](double now) {
                    scene->FocusItem(lane == 0 ? "settings" : "top:" + std::to_string(lane), now, false);
                    ShowSnapshotLane(*scene, lane, previous, art, now);
                };
            };
            events = {{200.0, go(1, 0)}, {1000.0, go(3, 1)}, {1900.0, go(4, 3)}, {2800.0, go(5, 4)}, {3700.0, go(0, 5)}};
            endMs = 4500.0;
        } else if (scenario == L"hover-leave") {
            // The pointer rests on Play, then moves to empty space: the highlight eases away. Then onto a tab and off.
            const auto leave = [scene](double now) { scene->PointerLeft(now); };
            const auto back = [scene](double now) { scene->ShowFocus(now); };
            events = {{0.0, hover("settings")}, {0.0, leave},          {150.0, back},        {150.0, hover("hero-play")},
                      {900.0, leave},           {1500.0, back},       {1500.0, hover("top:2")}, {2200.0, leave}};
            endMs = 2900.0;
        } else if (scenario == L"nav-intro") {
            scene->PlayChromeEntrance();
            endMs = 1000.0;
        } else if (scenario == L"tab-switch") {
            // Hover Movies, click it, then hover and click Series, then come back Home with the keyboard.
            events = {{150.0, hover("top:1")},  {300.0, press("top:1")},  {380.0, release},
                      {380.0, lane(1)},          {900.0, hover("top:2")}, {1050.0, press("top:2")},
                      {1130.0, release},         {1130.0, lane(2)},       {1700.0, hover("settings")},
                      {1700.0, lane(0)}};
            endMs = 2400.0;
        } else if (scenario == L"buttons") {
            // From a tab, hover Play, press and release it, then hover Details and press it.
            events = {{0.0, hover("settings")}, {200.0, hover("hero-play")}, {700.0, press("hero-play")},
                      {820.0, release},          {1150.0, hover("hero-info")}, {1600.0, press("hero-info")},
                      {1720.0, release}};
            endMs = 2200.0;
        } else if (scenario == L"orb") {
            events = {{0.0, hover("settings")}, {200.0, hover("top:6")}, {700.0, press("top:6")},
                      {820.0, release},          {1150.0, hover("settings")}};
            endMs = 1600.0;
        } else {
            std::fprintf(stderr, "unknown --scenario\n");
            return 2;
        }
        tick = [host](double now) { return host->Tick(now); };
        paint = [host](tvm::ui::Painter& painter) { host->Paint(painter); };
    }

    constexpr double kStepMs = 1000.0 / 30.0;
    std::size_t next = 0;
    int index = 0;
    for (double now = 0.0; now <= endMs + 0.5; now += kStepMs, ++index) {
        while (next < events.size() && events[next].atMs <= now + 0.5) events[next++].apply(now);
        tick(now);
        wchar_t name[64];
        swprintf(name, 64, L"%ls-%04d.png", scenario.c_str(), index);
        // The player's chrome sits in an overlay over mpv's video, where glass has nothing to refract.
        writer.Save(paint, (std::filesystem::path(dir) / name).wstring(),
                    scenario != L"menu" && scenario != L"player-controls");
    }
    std::error_code ignored;
    std::filesystem::remove_all(tempData, ignored);
    std::printf("wrote %d frames\n", index);
    return 0;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE /*previous*/, PWSTR /*commandLine*/, int showCommand) {
    try {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

        int argc = 0;
        LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        std::vector<std::wstring> args;
        for (int i = 0; argv != nullptr && i < argc; ++i) args.emplace_back(argv[i]);
        if (argv != nullptr) LocalFree(argv);

        std::optional<std::wstring> snapshot;
        std::optional<std::wstring> frames;
        std::wstring scenario = L"tab-switch";
        std::string art = "asset:lighthouse.jpg";
        tvm::ui::GlassClarity glass = tvm::ui::GlassClarity::Clear;
        std::wstring keys;
        tvm::ui::Theme theme = tvm::ui::Theme::Dark;
        std::wstring screen;
        unsigned width = 1920;
        unsigned height = 1080;
        for (std::size_t i = 1; i < args.size(); ++i) {
            if (args[i] == L"--snapshot" && i + 1 < args.size()) {
                snapshot = args[++i];
            } else if (args[i] == L"--frames" && i + 1 < args.size()) {
                frames = args[++i];
            } else if (args[i] == L"--scenario" && i + 1 < args.size()) {
                scenario = args[++i];
            } else if (args[i] == L"--glass" && i + 1 < args.size()) {
                glass = tvm::ui::ParseGlassClarity(tvm::util::ToUtf8(args[++i]));
            } else if (args[i] == L"--art" && i + 1 < args.size()) {
                art = "file:" + tvm::util::ToUtf8(std::filesystem::absolute(args[++i]).wstring());
            } else if (args[i] == L"--keys" && i + 1 < args.size()) {
                keys = args[++i];
            } else if (args[i] == L"--theme" && i + 1 < args.size()) {
                theme = tvm::ui::ParseTheme(tvm::util::ToUtf8(args[++i]));
            } else if (args[i] == L"--screen" && i + 1 < args.size()) {
                screen = args[++i];
            } else if (args[i] == L"--size" && i + 1 < args.size()) {
                const auto size = ParseSize(args[++i]);
                if (!size.has_value()) {
                    MessageBoxW(nullptr, L"--size must look like 1920x1080", L"TVM", MB_ICONERROR | MB_OK);
                    return 2;
                }
                width = size->first;
                height = size->second;
            }
        }

        if (frames.has_value()) return RunFrames(*frames, scenario, width, height, theme, art, glass);
        if (snapshot.has_value()) return RunSnapshot(*snapshot, width, height, keys, theme, screen, art, glass);

        tvm::platform::AppOptions options;
        options.dataDir = tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment()).wstring();

        // One TVM per data folder. Two windows over the same profiles, My List and Core fight over the same files, and
        // a second launch (a second shortcut, a double click) only brings the open window forward. A restart (Settings,
        // or after an update) waits for the closing copy to let go instead.
        const bool restarting = std::find(args.begin(), args.end(), L"--restarting") != args.end();
        std::wstring lockName = L"Local\\TVM.Native.";
        for (wchar_t c : options.dataDir) lockName.push_back(c == L'\\' || c == L':' || c == L'/' ? L'_' : static_cast<wchar_t>(towlower(c)));
        if (lockName.size() > 250) lockName.resize(250);
        HANDLE instanceLock = CreateMutexW(nullptr, FALSE, lockName.c_str());
        if (instanceLock != nullptr) {
            const DWORD waited = WaitForSingleObject(instanceLock, restarting ? 10000 : 0);
            if (waited == WAIT_TIMEOUT) {
                if (HWND open = FindWindowW(L"TVM.Native.Window", nullptr)) {
                    if (IsIconic(open)) ShowWindow(open, SW_RESTORE);
                    SetForegroundWindow(open);
                }
                CloseHandle(instanceLock);
                return 0;
            }
        }
        struct InstanceLock {
            HANDLE handle;
            ~InstanceLock() {
                if (handle != nullptr) {
                    ReleaseMutex(handle);
                    CloseHandle(handle);
                }
            }
        } lock{instanceLock};
        tvm::platform::App app(instance, options);
        return app.Run(showCommand);
    } catch (const std::exception& error) {
        MessageBoxA(nullptr, error.what(), "TVM", MB_ICONERROR | MB_OK);
        return 1;
    }
}
