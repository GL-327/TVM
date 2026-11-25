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
#include "ui/details_screen.h"
#include "ui/downloads_screen.h"
#include "ui/logo_reveal.h"
#include "ui/profile_chooser.h"
#include "ui/profile_editor.h"
#include "ui/live_tv_view.h"
#include "core/content.h"
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
        // Search with results, as the app builds it: the field, the All · Movies · Series tabs, the Top Result, then
        // the films and the series.
        view.searchField = true;
        view.query = "light";
        view.status = "9 matches";
        tvm::ui::RailData top;
        top.id = "search-top";
        top.title = "Top Result";
        tvm::ui::CardData feature{"tt-light", "Light", art, std::nullopt};
        feature.feature = true;
        feature.subtitle = "Movie \xC2\xB7 2024";
        top.cards = {feature};
        view.rails.push_back(top);
        const char* films[] = {"The Last Light", "Lighthouse", "Northern Lights", "Light Years", "Pale Light"};
        const char* shows[] = {"Lights Out", "Light & Shadow", "Lightkeepers", "First Light"};
        tvm::ui::RailData movies{"movies-0", "Movies \xC2\xB7 5", {}};
        for (int i = 0; i < 5; ++i) {
            tvm::ui::CardData card{"tt-q" + std::to_string(i), films[i], i == 0 ? "asset:lighthouse.jpg" : i == 2 ? art : "", std::nullopt};
            card.subtitle = std::to_string(2015 + i);
            movies.cards.push_back(card);
        }
        tvm::ui::RailData series{"series-0", "Series \xC2\xB7 4", {}};
        for (int i = 0; i < 4; ++i) {
            tvm::ui::CardData card{"tt-r" + std::to_string(i), shows[i], i == 1 ? art : "", std::nullopt};
            card.subtitle = std::to_string(2008 + i * 3);
            series.cards.push_back(card);
        }
        view.rails.push_back(movies);
        view.rails.push_back(series);
    } else if (lane == 6) {
        // Search before anything is typed: recent searches, then Browse, a tall tile for each genre.
        view.searchField = true;
        for (const char* recent : {"the last light", "northward", "harbor"}) {
            view.pageButtons.push_back(tvm::ui::TopButton{recent, act("search-recent")});
        }
        const char* genres[] = {"Action & Adventure", "Comedy", "Drama", "Kids & Family", "Science Fiction", "Thriller",
                                "Documentary", "Romance", "Horror", "Animation", "Crime", "Mystery"};
        tvm::ui::RailData row;
        for (int i = 0; i < 12; ++i) {
            if (i % 6 == 0) {
                if (!row.cards.empty()) view.rails.push_back(row);
                row = tvm::ui::RailData{"search-browse-" + std::to_string(i / 6), i == 0 ? "Browse" : "", {}};
            }
            tvm::ui::CardData tile{std::string("browse:") + genres[i], genres[i],
                                   i % 3 == 0 ? "asset:lighthouse.jpg" : i % 3 == 1 ? art : "", std::nullopt};
            tile.category = true;
            row.cards.push_back(tile);
        }
        view.rails.push_back(row);
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
    // Labels as the app now makes them from mpv's tracks and Torrentio's releases.
    view.subtitles = {tvm::ui::PlayerOption{"no", "Off", "", false},
                      tvm::ui::PlayerOption{"1", "English", "", true},
                      tvm::ui::PlayerOption{"2", "English \xC2\xB7 SDH", "", false},
                      tvm::ui::PlayerOption{"3", "Spanish", "", false},
                      tvm::ui::PlayerOption{"4", "Spanish (Forced)", "", false},
                      tvm::ui::PlayerOption{"5", "French", "", false},
                      tvm::ui::PlayerOption{"6", "German", "", false},
                      tvm::ui::PlayerOption{"7", "Italian", "", false},
                      tvm::ui::PlayerOption{"8", "Portuguese", "", false},
                      tvm::ui::PlayerOption{"9", "Japanese", "", false},
                      tvm::ui::PlayerOption{"10", "Korean", "", false}};
    view.audios = {tvm::ui::PlayerOption{"1", "English", "Dolby Digital+ \xC2\xB7 5.1", true},
                   tvm::ui::PlayerOption{"2", "English \xC2\xB7 Commentary", "Stereo", false},
                   tvm::ui::PlayerOption{"3", "Spanish", "Dolby Digital \xC2\xB7 5.1", false}};
    view.qualities = {tvm::ui::PlayerOption{"0", "4K", "Remux \xC2\xB7 Dolby Vision \xC2\xB7 58.3 GB", false},
                      tvm::ui::PlayerOption{"1", "1080p", "BluRay \xC2\xB7 12.4 GB", true},
                      tvm::ui::PlayerOption{"2", "1080p", "WEB-DL \xC2\xB7 4.2 GB", false},
                      tvm::ui::PlayerOption{"3", "720p", "WEB \xC2\xB7 1.6 GB \xC2\xB7 Not cached", false}};
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
    // Deterministic 1.1 visual fixtures use the production screens and bundled content, without an account or network.
    if (screen == L"home-1.1" || screen == L"rail-seam" || screen == L"profile-editor" || screen == L"pin-pad" ||
        screen == L"live-free" || screen == L"services") {
        const auto tempData = std::filesystem::temp_directory_path() / (L"tvm-feature-snapshot-" + std::to_wstring(GetCurrentProcessId()));
        tvm::ui::FilePreferenceStore store(tempData);
        store.SaveGlass(glass);
        tvm::content::Store content(tempData);
        auto root = SnapshotHomeScene(store.Motion(), art);
        auto* scene = root.get();
        tvm::ui::Shell shell(std::move(root), store);
        shell.Layout(width, height);
        if (screen == L"profile-editor" || screen == L"pin-pad") {
            tvm::ui::Command open; open.name = "profile-editor";
            shell.Execute(open, 0);
            auto& editor = dynamic_cast<tvm::ui::ProfileEditor&>(shell.ActiveScreen());
            tvm::ui::ProfileEntry person{"visual-check", "Alex", 221};
            person.locked = true;
            editor.SetProfile(person, content.Read("avatars"), "");
            if (screen == L"pin-pad") { editor.Challenge(person.id, person.name); editor.Type("12"); }
        } else if (screen == L"services") {
            tvm::ui::Command open; open.name = "services";
            shell.Execute(open, 0);
            tvm::ui::InfoView view;
            view.kicker = "Streaming services"; view.heading = "Your services"; view.interleaveActions = true;
            view.lede = "Sign in on each service's own page. TVM never sees your password.";
            const auto data = content.Read("services");
            if (data.contains("services")) for (const auto& service : data["services"]) {
                const std::string name = service.value("name", "Service");
                view.blocks.push_back({tvm::ui::InfoBlock::Kind::Row, name, "Not connected"});
                tvm::ui::InfoAction signin; signin.key = "signin:" + name; signin.label = "Sign in to " + name; signin.primary = true;
                tvm::ui::InfoAction launch; launch.key = "open:" + name; launch.label = "Open " + name;
                view.actions.push_back({signin, launch});
            }
            dynamic_cast<tvm::ui::InfoScreen&>(shell.ActiveScreen()).SetView(view);
        } else if (screen == L"live-free") {
            tvm::ui::LiveTvState state; state.loaded = true;
            const auto data = content.Read("free-channels");
            if (data.contains("channels")) for (const auto& channel : data["channels"]) {
                tvm::catalog::LiveChannel item;
                item.id = "live:free:" + channel.value("id", ""); item.name = channel.value("name", "");
                item.group = channel.value("group", ""); if (channel.contains("geo") && channel["geo"].is_string()) item.geo = channel["geo"].get<std::string>(); item.logo = channel.value("logo", "");
                state.freeChannels.push_back(item);
            }
            auto view = tvm::ui::LiveTvView(state);
            view.style = tvm::ui::SceneStyle::Stream; view.pageKey = "live-tv";
            view.pageButtons = view.topButtons; view.topButtons = SnapshotHomeView(3).topButtons;
            view.heading = "Live TV";
            scene->SetHeroes({}, 0); scene->SetView(view, 0);
        } else if (screen == L"rail-seam") {
            auto view = SnapshotHomeView(0);
            view.rails.erase(view.rails.begin()); view.rails.resize(1);
            auto& rail = view.rails.front(); rail.cards.resize(3); rail.loop = true; rail.title = "A short row at its seam";
            scene->SetHeroes({}, 0); scene->SetView(view, 0);
            scene->FocusItem("card:0:0", 0, true);
            scene->Navigate(Direction::Left, 100);
        } else {
            auto view = SnapshotHomeView(0);
            tvm::ui::HeroData hero = SnapshotHero(art);
            const auto data = content.Read("events");
            if (data.contains("events") && !data["events"].empty()) {
                const auto& event = data["events"][0];
                hero.itemId = event.value("imdbId", ""); hero.title = event.value("title", "Release spotlight");
                hero.body = event.value("line", ""); hero.meta = tvm::content::EventKicker(event, event.value("start", ""));
                hero.playLabel = "Watch the saga"; hero.infoLabel = "Details"; hero.rating = "8.0"; hero.accent = tvm::ui::Rgb(0x2F6BFF);
                auto rail = view.rails.back(); rail.title = event["rail"].value("title", "Catch up"); rail.loop = true;
                view.rails.insert(view.rails.begin() + 1, rail);
            }
            scene->SetView(view, 0); scene->SetHeroes({hero}, 0);
            const auto notes = content.Read("changelog");
            if (notes.contains("releases") && !notes["releases"].empty()) {
                const auto& release = notes["releases"][0];
                tvm::ui::Shell::ReleaseCard card; card.version = "1.1"; card.title = release.value("title", "");
                for (const auto& line : release["highlights"]) if (line.is_string() && card.highlights.size() < 4) card.highlights.push_back(line.get<std::string>());
                shell.SetReleaseCard(card);
            }
        }
        for (double now = 0; now <= 1400; now += 16) shell.Tick(now);
        tvm::platform::SaveSnapshot(shell, graphics, width, height, path);
        std::error_code ignored; std::filesystem::remove_all(tempData, ignored);
        std::printf("wrote %ls\n", path.c_str());
        return 0;
    }
    const bool settings = screen == L"settings" || screen == L"settings-language";
    if (screen.rfind(L"downloads", 0) == 0) {
        // Downloads over a title's page: "downloads" with a series and its downloads, "downloads-empty" for a film with
        // none, "downloads-list" for the list alone, "downloads-open" with the quality list open.
        tvm::platform::SnapshotWriter writer(graphics, width, height);
        tvm::ui::DownloadsScreen downloads;
        downloads.Layout(width, height);
        tvm::ui::DownloadsView view;
        if (screen != L"downloads-list") {
            view.title = screen == L"downloads-empty" ? "The Last Light" : "Northward";
            view.subtitle = screen == L"downloads-empty" ? "Film" : "Series \xC2\xB7 18 episodes";
            view.posterUrl = art;
            view.backdropUrl = art;
            if (screen != L"downloads-empty") {
                view.choices.push_back({"scope", "Download", {"Full series", "One season", "One episode"}, 1});
                view.choices.push_back({"season", "Season", {"Season 1", "Season 2"}, 0});
            }
            view.choices.push_back({"language", "Audio", {"English", "Original / any language", "Japanese", "French"}, 0});
            view.choices.push_back({"quality", "Highest quality", {"Up to 480p", "Up to 720p", "Up to 1080p", "Up to 4K"}, 2});
            view.folder = "C:\\Users\\Viewer\\Downloads\\TVM";
            view.startLabel = screen == L"downloads-empty" ? "Download \xC2\xB7 English \xC2\xB7 up to 1080p"
                                                           : "Download 10 episodes \xC2\xB7 English \xC2\xB7 up to 1080p";
            view.startEnabled = true;
            view.note = "Only English audio is downloaded: a source in another language, or marked MULTi, is never used "
                        "instead, and the download stops if none is found.";
        }
        if (screen != L"downloads-empty") {
            tvm::ui::DownloadJobView running{3, "Northward \xC2\xB7 S1 E2 \xC2\xB7 The Long Road", "downloading", 0.42,
                                             "1.3 GB of 3.1 GB", true, false};
            tvm::ui::DownloadJobView queued{4, "Northward \xC2\xB7 S1 E3 \xC2\xB7 Ice", "queued", -1.0,
                                            "Waiting for the download before it", true, false};
            tvm::ui::DownloadJobView done{2, "Northward \xC2\xB7 S1 E1 \xC2\xB7 Pilot", "complete", 1.0,
                                          "2.8 GB \xC2\xB7 C:\\Users\\Viewer\\Downloads\\TVM\\Northward S01E01.mkv", false, true};
            tvm::ui::DownloadJobView failed{1, "Quiet Harbor", "failed", -1.0, "No English source was found", false, false};
            view.jobs = {running, queued, done, failed};
        }
        downloads.SetView(view);
        if (screen == L"downloads-open") downloads.ActivateItem("choice:quality", 0.0);
        for (double now = 0.0; now <= 800.0; now += 16.0) downloads.Tick(now);
        writer.Save([&](tvm::ui::Painter& painter) {
            const tvm::ui::ThemeScope look(theme);
            painter.Clear(tvm::ui::Rgb(0x071018));
            painter.ImageFaded(tvm::ui::Box{0.0, 0.0, static_cast<double>(width), static_cast<double>(height)}, art, 0.0,
                               0.5, 0.5, 0.3);
            downloads.Paint(painter);
        }, path);
        std::printf("wrote %ls\n", path.c_str());
        return 0;
    }
    if (screen.rfind(L"details", 0) == 0) {
        // A title's page with its backdrop, and the bare Back arrow at the top left. "details-series" is a series with
        // its season picker; "details-series-open" has the season list open.
        const bool series = screen.rfind(L"details-series", 0) == 0;
        tvm::platform::SnapshotWriter writer(graphics, width, height);
        tvm::ui::DetailsScreen details("tt0000001", series ? "Northward" : "The Last Light");
        details.Layout(width, height);
        tvm::ui::TitleInfo info;
        info.state = tvm::ui::TitleInfo::State::Ready;
        info.id = info.media.id = "tt0000001";
        info.title = series ? "Northward" : "The Last Light";
        info.kind = info.media.kind = series ? "series" : "movie";
        if (series) {
            for (const int season : {1, 2, 3, 0}) {
                for (int episode = 1; episode <= (season == 0 ? 2 : 6); ++episode) {
                    tvm::catalog::MediaItem child;
                    child.id = "tt0000001:" + std::to_string(season) + ":" + std::to_string(episode);
                    child.title = "Episode " + std::to_string(episode);
                    child.episodeName = episode == 1 ? "Pilot" : (episode == 2 ? "The Long Road" : "Ice and Light");
                    child.synopsis = "The crew push north as the light starts to fail.";
                    child.kind = "episode";
                    child.season = season;
                    child.episode = episode;
                    child.poster = art;
                    info.children.push_back(child);
                }
            }
        }
        info.year = 2024;
        info.rating = "7.8";
        info.runtime = "2h 6m";
        info.genres = {"Drama", "Mystery"};
        info.synopsis = "A lighthouse keeper on a remote island finds the lamp burning on its own one winter night.";
        info.backdropUrl = art;
        if (screen == L"details-extras" || screen == L"details-series-extras") {
            info.trailerUrl = "https://www.youtube.com/watch?v=abcdefghijk";
            if (series) { info.englishTitle = "The Northern Journey"; info.upcoming = "New episode Thursday, 26 November"; }
            else {
                info.collectionName = "The Last Light collection";
                for (int i = 1; i <= 4; ++i) {
                    tvm::catalog::MediaItem item; item.id = "tt000000" + std::to_string(i + 1);
                    item.title = "The Last Light " + std::to_string(i + 1); item.poster = art; info.collection.push_back(item);
                }
            }
        }
        details.SetInfo(info);
        if (screen == L"details-reviews") {
            info.reviews = {{"reviews", nlohmann::json::array({
                {{"author", "Snapshot reviewer"}, {"stars", 4.0}, {"text", "A visual fixture for checking the review panel's spacing and four-line text area."}},
                {{"author", "Second reviewer"}, {"stars", 3.5}, {"text", "The cast and coastal setting carry this quiet mystery."}},
                {{"author", "Third reviewer"}, {"stars", 4.5}, {"text", "A strong final act, with room for the story to breathe."}}
            })}};
            details.SetInfo(info);
            details.FocusItem("imdb", 0, false);
        }
        // `--keys Up` shows the arrow focused, as the remote reaches it.
        for (const std::wstring& token : SplitCommas(keys)) {
            if (const auto direction = ParseDirection(token)) details.Navigate(*direction, 0.0);
        }
        if (screen == L"details-series-open") details.ActivateItem("season-menu", 0.0);
        for (double now = 0.0; now <= 1000.0; now += 16.0) details.Tick(now);
        writer.Save([&](tvm::ui::Painter& painter) {
            const tvm::ui::ThemeScope look(theme);
            details.Paint(painter);
        }, path);
        std::printf("wrote %ls\n", path.c_str());
        return 0;
    }
    if (screen.rfind(L"player", 0) == 0) {
        // The player's chrome over a still of the picture, as it sits over mpv's video. "player-cc", "player-audio",
        // "player-quality" and "player-speed" show that menu open.
        tvm::platform::SnapshotWriter writer(graphics, width, height);
        auto player = SnapshotPlayer(width, height);
        if (screen == L"player-loading" || screen == L"player-volume") {
            tvm::ui::PlayerView view;
            view.title = "The Last Light";
            if (screen == L"player-volume") {
                view.phase = tvm::ui::PlayerView::Phase::Playing; view.started = true;
                view.volume = 1.5; view.position = 1520; view.duration = 3480;
            } else {
                view.phase = tvm::ui::PlayerView::Phase::Playing;
                view.buffering = true; view.bufferPercent = 42; view.cacheSpeed = 2200000; view.cacheSeconds = 5;
            }
            player->SetView(view, 0);
            player->ShowChrome(0);
            if (screen == L"player-volume") player->FocusItem("mute", 0, false);
            for (double now = 0; now <= 800; now += 16) player->Tick(now);
        }
        if (screen == L"player-extras") {
            auto view = player->view(); view.recap = true; view.skipLabel = "Skip credits";
            view.nextUp = true; view.nextRemaining = 10; view.nextWindow = 10;
            view.nextShow = "Northward"; view.nextEpisode = "S1 E2 - The Long Road"; view.nextStill = art;
            player->SetView(view, 0);
        }
        player->Tick(100.0);
        if (screen.size() > 7 && screen != L"player-loading" && screen != L"player-volume" && screen != L"player-extras") {
            const std::wstring menu = screen.substr(7);
            std::string key;
            for (const wchar_t c : menu) key.push_back(static_cast<char>(c & 0x7F));
            player->ActivateItem(key, 100.0);
            for (double now = 100.0; now <= 900.0; now += 16.0) player->Tick(now);
        }
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
    const int lane = screen == L"live"           ? 3
                     : screen == L"library"      ? 4
                     : screen == L"search"       ? 5
                     : screen == L"search-typing" ? 5
                     : screen == L"search-empty"  ? 6
                                                  : 0;
    if (home != nullptr && lane > 0) ShowSnapshotLane(*home, lane, lane, art, 0.0);
    // The field taking typing: its accent line and caret.
    if (home != nullptr && screen == L"search-typing") home->FocusItem("search-field", 0.0, false);
    // Settings with the App language list open.
    if (screen == L"settings-language") {
        auto& page = dynamic_cast<tvm::ui::SettingsScreen&>(shell.ActiveScreen());
        page.FocusItem("language", 0.0, true);
        page.Select(0.0);
    }
    // "Who's watching?" (with `-edit` in edit mode, `-sheet` with a profile's sheet open) and the orb's menu, over
    // Home, with four sample profiles.
    if (screen.rfind(L"chooser", 0) == 0 || screen == L"profile-menu") {
        tvm::ui::ChooserView people;
        people.profiles = {{"p1", "Alex", 221}, {"p2", "Sam", 28}, {"p3", "Kids", 140}, {"p4", "Jordan", 300}};
        people.activeId = "p1";
        people.max = 5;
        tvm::ui::Command open;
        open.name = screen == L"profile-menu" ? "profile-menu" : "chooser";
        open.modal = screen == L"profile-menu";
        shell.Execute(open, 0.0);
        if (auto* chooser = dynamic_cast<tvm::ui::ProfileChooser*>(&shell.ActiveScreen())) {
            chooser->SetView(people);
            if (screen != L"chooser") chooser->ActivateItem("manage", 0.0);
            if (screen == L"chooser-sheet") chooser->ActivateItem("pick:p2", 0.0);
        }
        if (auto* menu = dynamic_cast<tvm::ui::ProfileMenu*>(&shell.ActiveScreen())) menu->SetView(people);
    }

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
    } else if (scenario == L"logo-reveal") {
        // The launch reveal from start to its fade, over Home's dark ground.
        auto reveal = std::make_shared<tvm::ui::LogoReveal>(store.Motion());
        reveal->Start(0.0);
        endMs = tvm::ui::LogoReveal::kTotalMs + 600.0;
        tick = [reveal](double now) {
            reveal->Tick(now);
            return reveal->Animating();
        };
        paint = [reveal, width, height](tvm::ui::Painter& painter) {
            painter.Clear(tvm::ui::Rgb(0x0B0B0F));
            reveal->Paint(painter, static_cast<double>(width), static_cast<double>(height));
        };
    } else if (scenario == L"menu") {
        // Open the subtitles: the hover slides down the rows, the wheel scrolls the list, the pointer leaves and the
        // highlight fades; then a pick from the quality menu.
        player = SnapshotPlayer(width, height);
        tvm::ui::PlayerScreen* raw = player.get();
        const auto hover = [raw](int row) {
            return [raw, row](double now) {
                raw->ShowChrome(now);
                raw->ShowFocus(now);
                raw->FocusItem("menu:" + std::to_string(row), now, false);
            };
        };
        events.push_back({200.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        events.push_back({600.0, hover(2)});
        events.push_back({800.0, hover(3)});
        events.push_back({1000.0, hover(4)});
        events.push_back({1300.0, [raw](double now) { raw->ShowChrome(now); raw->ScrollMenu(1); }});
        events.push_back({1450.0, [raw](double now) { raw->ShowChrome(now); raw->ScrollMenu(1); }});
        events.push_back({1600.0, [raw](double now) { raw->ShowChrome(now); raw->ScrollMenu(1); }});
        events.push_back({1900.0, [raw](double now) { raw->ShowChrome(now); raw->PointerLeft(now); }});
        events.push_back({2400.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("cc", now); }});
        events.push_back({2700.0, [raw](double now) { raw->ShowChrome(now); raw->ShowFocus(now); raw->ActivateItem("quality", now); }});
        events.push_back({3100.0, hover(2)});
        events.push_back({3400.0, [raw](double now) { raw->ShowChrome(now); raw->ActivateItem("quality", now); }});
        endMs = 3800.0;
        tick = [raw](double now) { return raw->Tick(now); };
        paint = [raw, art, width, height](tvm::ui::Painter& painter) {
            const tvm::ui::ThemeScope look(tvm::ui::Theme::Dark);
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
        } else if (scenario == L"rail-scroll") {
            // A carousel: the pointer comes over it and its arrow shows, a click steps it along twice, the back arrow
            // steps it back, then a mouse drag slides it and lets it coast.
            const tvm::ui::Box card = scene->CardBox(1, 2);
            const double y = card.CenterY();
            const auto move = [host](double x, double yy, bool down) {
                return [host, x, yy, down](double now) { host->MouseMove(x, yy, down, now); };
            };
            const auto arrowClick = [host, scene](bool next) {
                return [host, scene, next](double now) {
                    if (const auto arrow = scene->RailArrowBox(1, next)) {
                        host->MouseMove(arrow->CenterX(), arrow->CenterY(), false, now);
                        host->MouseDown(arrow->CenterX(), arrow->CenterY(), now);
                        host->MouseUp(arrow->CenterX(), arrow->CenterY(), now + 1.0);
                    }
                };
            };
            events = {{0.0, move(card.CenterX(), y, false)},     {120.0, move(card.CenterX() + 4.0, y, false)},
                      {500.0, arrowClick(true)},                 {1300.0, arrowClick(true)},
                      {2100.0, arrowClick(false)},               {2900.0, [host, card, y](double now) { host->MouseDown(card.CenterX() + 300.0, y, now); }},
                      {2950.0, move(card.CenterX() + 200.0, y, true)}, {3000.0, move(card.CenterX() + 60.0, y, true)},
                      {3050.0, move(card.CenterX() - 80.0, y, true)},  {3080.0, [host, card, y](double now) { host->MouseUp(card.CenterX() - 80.0, y, now); }}};
            endMs = 3900.0;
        } else if (scenario == L"card-hover") {
            // The pointer rests on a Continue Watching card with a picture, then on a poster with one, then leaves.
            const tvm::ui::Box wide = scene->CardBox(0, 0);
            const tvm::ui::Box tall = scene->CardBox(1, 0);
            const auto at = [host](double x, double y) { return [host, x, y](double now) { host->MouseMove(x, y, false, now); }; };
            events = {{0.0, at(wide.CenterX(), wide.CenterY())}, {40.0, at(wide.CenterX() + 2.0, wide.CenterY())},
                      {900.0, at(tall.CenterX(), tall.CenterY())}, {940.0, at(tall.CenterX() + 2.0, tall.CenterY())},
                      {1800.0, [host](double now) { host->MouseLeave(now); }}};
            endMs = 2400.0;
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
        tvm::ui::GlassClarity glass = tvm::ui::GlassClarity::Default;
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
