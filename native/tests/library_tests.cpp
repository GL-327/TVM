// Library tests: profiles, the watchlist, watch progress, recommendations and the
// Home shelves and Details buttons that use them. The progress cases are the ones
// in apps/core/src/providers/progress.test.ts. Files go to a temporary folder and
// are sealed with a key made there, so no test touches the viewer's data.

#include <windows.h>

#include <cstddef>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/progress.h"
#include "catalog/rails.h"
#include "catalog/recommend.h"
#include "catalog/watchlist.h"
#include "core/paths.h"
#include "core/profiles.h"
#include "core/vault.h"
#include "harness.h"
#include "nav/focus_tree.h"
#include "ui/catalog_view.h"
#include "ui/details_screen.h"
#include "ui/preferences_store.h"
#include "ui/scene.h"
#include "ui/shell.h"

namespace {

namespace fs = std::filesystem;
using tvm::catalog::MediaItem;
using tvm::catalog::ProgressItem;
using tvm::catalog::ProgressMap;
using tvm::catalog::WatchlistEntry;
using tvm::nav::Direction;
using tvm::ui::CardData;
using tvm::ui::DetailsScreen;
using tvm::ui::RailData;
using tvm::ui::RailSpec;
using tvm::ui::Scene;
using tvm::ui::Shell;
using tvm::ui::TitleInfo;

// A fresh folder per test, removed afterwards.
class TempFolder {
public:
    TempFolder() {
        static unsigned counter = 0;
        path_ = fs::temp_directory_path() /
                (L"tvm-library-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
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

MediaItem Movie(const std::string& id, const std::string& title, std::vector<std::string> genres = {"Drama"}) {
    MediaItem item;
    item.id = id;
    item.title = title;
    item.kind = "movie";
    item.genres = std::move(genres);
    item.year = 2020;
    item.rating = "7.1";
    item.poster = "https://img.example/" + id + ".jpg";
    item.hue = 200;
    return item;
}

MediaItem Series(const std::string& id, const std::string& title, const std::string& showTitle) {
    MediaItem item = Movie(id, title);
    item.kind = "series";
    item.showTitle = showTitle;
    return item;
}

nlohmann::json Entry(double position, double duration, const std::string& updated) {
    return nlohmann::json{{"position", position}, {"duration", duration}, {"updated", updated}};
}

void WriteRegistry(const fs::path& dataDir, const std::string& activeId, const std::vector<std::string>& ids) {
    nlohmann::json profiles = nlohmann::json::array();
    for (const std::string& id : ids) {
        const nlohmann::json profile{{"id", id}, {"name", id}, {"hue", 221}, {"created", "2026-01-01T00:00:00.000Z"}};
        profiles.push_back(profile);
    }
    tvm::vault::WriteSealed(dataDir, tvm::paths::ProfilesPath(dataDir),
                            nlohmann::json{{"activeId", activeId}, {"profiles", profiles}});
}

// ------------------------------------------------------------------ profiles

TEST(profiles_without_a_registry_use_the_data_folder) {
    TempFolder folder;
    const auto active = tvm::profiles::ActiveFolder(folder.path());
    REQUIRE(active.has_value());
    REQUIRE(*active == folder.path());
}

TEST(profiles_follow_the_active_profile) {
    TempFolder folder;
    WriteRegistry(folder.path(), "profile-b", {"profile-a", "profile-b"});
    const auto active = tvm::profiles::ActiveFolder(folder.path());
    REQUIRE(active.has_value());
    REQUIRE(*active == tvm::paths::ProfileDir(folder.path(), "profile-b"));
}

TEST(profiles_fall_back_to_the_first_profile_when_the_active_one_is_gone) {
    TempFolder folder;
    WriteRegistry(folder.path(), "removed", {"profile-a", "profile-b"});
    const auto active = tvm::profiles::ActiveFolder(folder.path());
    REQUIRE(active.has_value());
    REQUIRE(*active == tvm::paths::ProfileDir(folder.path(), "profile-a"));
}

TEST(an_unreadable_registry_means_no_profile_folder) {
    // Neither shown nor written: the watchlist and progress must not be guessed at.
    TempFolder folder;
    std::ofstream(tvm::paths::ProfilesPath(folder.path()), std::ios::binary) << "not sealed and not JSON";
    REQUIRE(!tvm::profiles::ActiveFolder(folder.path()).has_value());
}

// ----------------------------------------------------------------- watchlist

TEST(watchlist_saves_newest_first_and_moves_a_repeat_to_the_front) {
    TempFolder folder;
    tvm::catalog::AddWatchlist(folder.path(), Movie("tt1", "One"));
    tvm::catalog::AddWatchlist(folder.path(), Movie("tt2", "Two"));
    const auto list = tvm::catalog::AddWatchlist(folder.path(), Movie("tt1", "One"));

    REQUIRE_EQ(list.size(), std::size_t{2});
    REQUIRE_EQ(list[0].item.id, std::string("tt1"));
    REQUIRE_EQ(list[1].item.id, std::string("tt2"));
    REQUIRE_EQ(tvm::catalog::ReadWatchlist(folder.path()).size(), std::size_t{2});
}

TEST(watchlist_round_trips_the_fields_it_keeps) {
    TempFolder folder;
    MediaItem item = Movie("tt7", "Seven", {"Thriller", "Crime"});
    item.synopsis = "A detective and a killer.";
    item.backdrop = "https://img.example/backdrop.jpg";
    item.playable = true;
    tvm::catalog::AddWatchlist(folder.path(), item);

    const auto entries = tvm::catalog::ReadWatchlist(folder.path());
    REQUIRE_EQ(entries.size(), std::size_t{1});
    const MediaItem& saved = entries[0].item;
    REQUIRE(saved.year == std::optional<int>(2020));
    REQUIRE(saved.genres == (std::vector<std::string>{"Thriller", "Crime"}));
    REQUIRE_EQ(saved.rating, std::string("7.1"));
    REQUIRE_EQ(saved.synopsis, std::string("A detective and a killer."));
    REQUIRE_EQ(saved.backdrop, std::string("https://img.example/backdrop.jpg"));
    REQUIRE(saved.playable);
    REQUIRE_EQ(saved.hue, 200);
    REQUIRE(!entries[0].added.empty());
}

TEST(watchlist_refuses_an_item_without_an_id_or_a_title) {
    TempFolder folder;
    MediaItem nameless = Movie("tt3", "   ");
    REQUIRE(tvm::catalog::AddWatchlist(folder.path(), nameless).empty());
    REQUIRE(!fs::exists(tvm::paths::WatchlistPath(folder.path())));
}

TEST(watchlist_keeps_the_newest_200_titles) {
    TempFolder folder;
    nlohmann::json full = nlohmann::json::array();
    for (int i = 1; i <= 200; ++i) {
        const nlohmann::json entry{{"id", "tt" + std::to_string(i)}, {"title", "Title " + std::to_string(i)}};
        full.push_back(entry);
    }
    tvm::vault::WriteSealed(folder.path(), tvm::paths::WatchlistPath(folder.path()), full);

    tvm::catalog::AddWatchlist(folder.path(), Movie("tt999", "Newest"));
    const auto entries = tvm::catalog::ReadWatchlist(folder.path());
    REQUIRE_EQ(entries.size(), std::size_t{200});
    REQUIRE_EQ(entries.front().item.id, std::string("tt999"));
    REQUIRE_EQ(entries.back().item.id, std::string("tt199"));
}

TEST(watchlist_removes_a_title) {
    TempFolder folder;
    tvm::catalog::AddWatchlist(folder.path(), Movie("tt1", "One"));
    tvm::catalog::AddWatchlist(folder.path(), Movie("tt2", "Two"));
    const auto left = tvm::catalog::RemoveWatchlist(folder.path(), "tt1");
    REQUIRE_EQ(left.size(), std::size_t{1});
    REQUIRE_EQ(left[0].item.id, std::string("tt2"));
    REQUIRE(!tvm::catalog::IsSaved(left, "tt1"));
    REQUIRE(tvm::catalog::IsSaved(left, "tt2"));
}

TEST(watchlist_fills_in_what_an_old_record_lacks) {
    TempFolder folder;
    const nlohmann::json old = nlohmann::json::array({nlohmann::json{
        {"id", "tt9"}, {"title", "Nine"}, {"kind", "tv"}, {"year", "2020"}}});
    tvm::vault::WriteSealed(folder.path(), tvm::paths::WatchlistPath(folder.path()), old);

    const auto entries = tvm::catalog::ReadWatchlist(folder.path());
    REQUIRE_EQ(entries.size(), std::size_t{1});
    REQUIRE_EQ(entries[0].item.kind, std::string("movie"));
    REQUIRE(!entries[0].item.year.has_value());
    REQUIRE_EQ(entries[0].item.hue, 220);
    REQUIRE(!entries[0].added.empty());
}

TEST(a_plain_watchlist_from_an_older_install_is_read_and_sealed) {
    TempFolder folder;
    std::ofstream(tvm::paths::WatchlistPath(folder.path()), std::ios::binary)
        << R"([{"id":"tt5","title":"Five","added":"2026-01-02T03:04:05.000Z"}])";

    const auto entries = tvm::catalog::ReadWatchlist(folder.path());
    REQUIRE_EQ(entries.size(), std::size_t{1});
    REQUIRE_EQ(entries[0].item.title, std::string("Five"));
    REQUIRE_EQ(entries[0].added, std::string("2026-01-02T03:04:05.000Z"));

    // The file is now sealed, so it no longer reads as plain JSON.
    std::ifstream in(tvm::paths::WatchlistPath(folder.path()), std::ios::binary);
    const char first = static_cast<char>(in.get());
    REQUIRE(first != '[');
}

// ------------------------------------------------------------------ progress

TEST(progress_ignores_a_glance_or_a_finished_title) {
    using tvm::catalog::ProgressRatio;
    REQUIRE(!ProgressRatio(Entry(10, 3600, "2026-01-01")).has_value());
    REQUIRE(!ProgressRatio(Entry(20, 40, "2026-01-01")).has_value());
    REQUIRE(!ProgressRatio(Entry(3500, 3600, "2026-01-01")).has_value());
    REQUIRE_NEAR(*ProgressRatio(Entry(900, 3600, "2026-01-01")), 0.25, 1e-12);
}

TEST(progress_keeps_a_film_after_thirty_seconds_even_when_that_is_under_four_percent) {
    REQUIRE_NEAR(*tvm::catalog::ProgressRatio(Entry(30, 7200, "2026-01-01")), 30.0 / 7200.0, 1e-12);
}

TEST(progress_finishes_past_ninety_six_percent) {
    REQUIRE(!tvm::catalog::IsFinished(Entry(3456, 3600, "2026-01-01")));
    REQUIRE(tvm::catalog::IsFinished(Entry(3457, 3600, "2026-01-01")));
}

TEST(resume_point_is_only_for_a_part_watched_title) {
    REQUIRE(tvm::catalog::ResumePosition(Entry(900, 3600, "2026-01-01")) == std::optional<double>(900.0));
    REQUIRE(!tvm::catalog::ResumePosition(Entry(3500, 3600, "2026-01-01")).has_value());
}

TEST(a_first_finish_counts_once) {
    TempFolder folder;
    tvm::catalog::WriteProgress(folder.path(), "tt1", 3500, 3600);
    const ProgressMap again = tvm::catalog::WriteProgress(folder.path(), "tt1", 3550, 3600);
    REQUIRE(again.at("tt1").at("completions") == nlohmann::json(1));
    REQUIRE(again.at("tt1").contains("completedAt"));
}

TEST(progress_writes_keep_fields_this_build_does_not_know) {
    TempFolder folder;
    nlohmann::json stored = nlohmann::json::object();
    stored["tt1"] = Entry(10, 3600, "2026-01-01");
    stored["tt1"]["device"] = "tv-box";
    tvm::vault::WriteSealed(folder.path(), tvm::paths::ProgressPath(folder.path()), stored);

    const ProgressMap saved = tvm::catalog::WriteProgress(folder.path(), "tt1", 900, 3600);
    REQUIRE(saved.at("tt1").at("device") == nlohmann::json("tv-box"));
    REQUIRE(saved.at("tt1").at("position") == nlohmann::json(900.0));
}

TEST(a_series_takes_its_furthest_episode) {
    ProgressMap progress = nlohmann::json::object();
    progress["tt1:1:2"] = Entry(900, 3600, "2026-01-01");
    progress["tt1:1:3"] = Entry(1800, 3600, "2026-01-02");
    const auto applied = tvm::catalog::ApplyProgress({Movie("tt1", "Show")}, progress);
    REQUIRE(applied.size() == 1);
    REQUIRE(applied[0].progress == std::optional<double>(0.5));
}

TEST(continue_watching_keeps_one_card_per_show_newest_first) {
    // The Node core's test case: two episodes of one show, then a film.
    ProgressMap progress = nlohmann::json::object();
    progress["rd:a"] = Entry(900, 3600, "2026-01-02T00:00:00.000Z");
    progress["rd:b"] = Entry(400, 3600, "2026-01-03T00:00:00.000Z");
    progress["rd:c"] = Entry(800, 3600, "2026-01-01T00:00:00.000Z");
    const std::vector<ProgressItem> items = {
        {Series("rd:a", "E1", "Reacher"), 0.25},
        {Series("rd:b", "E2", "Reacher"), 0.11},
        {Movie("rd:c", "Dune"), 0.22},
    };
    const auto shelf = tvm::catalog::PickContinueWatching(items, progress);
    REQUIRE_EQ(shelf.size(), std::size_t{2});
    REQUIRE_EQ(shelf[0].item.id, std::string("rd:b"));
    REQUIRE_EQ(shelf[1].item.id, std::string("rd:c"));
}

TEST(continue_watching_has_at_most_sixteen_cards) {
    ProgressMap progress = nlohmann::json::object();
    std::vector<ProgressItem> items;
    for (int i = 0; i < 20; ++i) {
        const std::string id = "tt" + std::to_string(i);
        progress[id] = Entry(900, 3600, "2026-01-01T00:00:" + std::to_string(10 + i) + ".000Z");
        items.push_back(ProgressItem{Movie(id, "Film " + std::to_string(i)), 0.25});
    }
    REQUIRE_EQ(tvm::catalog::PickContinueWatching(items, progress).size(), std::size_t{16});
}

// ------------------------------------------------------------ recommendations

TEST(genre_weights_ignore_case_and_your_files) {
    const auto weights = tvm::catalog::GenreWeights(
        {Movie("tt1", "One", {"Drama", "Your files"}), Movie("tt2", "Two", {"drama", "Horror"})});
    REQUIRE(weights.at("drama") == 2);
    REQUIRE(weights.at("horror") == 1);
    REQUIRE(weights.count("your files") == 0);
}

TEST(score_adds_genre_matches_a_recent_year_and_the_rating) {
    const std::map<std::string, int> weights{{"drama", 2}};
    MediaItem item = Movie("tt1", "One", {"Drama"});
    item.year = 2026;
    item.rating = "7.5";
    // Two points of genre weight at eight each, six for the recent year, and the rating.
    REQUIRE_NEAR(tvm::catalog::ScoreForYou(item, weights, 2026), 16.0 + 6.0 + 7.5, 1e-9);
    item.year = 2010;
    REQUIRE_NEAR(tvm::catalog::ScoreForYou(item, weights, 2026), 16.0 + 7.5, 1e-9);
}

TEST(you_might_like_ranks_by_score_and_keeps_catalogue_order_on_ties) {
    const std::vector<MediaItem> pool{Movie("tt1", "Comedy", {"Comedy"}), Movie("tt2", "Drama A", {"Drama"}),
                                      Movie("tt3", "Drama B", {"Drama"})};
    const std::vector<MediaItem> history{Movie("tt9", "Seen", {"Drama"})};
    const auto picked = tvm::catalog::PickYouMightLike(pool, history, {}, 16, 2026);
    REQUIRE_EQ(picked.size(), std::size_t{3});
    REQUIRE_EQ(picked[0].id, std::string("tt2"));
    REQUIRE_EQ(picked[1].id, std::string("tt3"));
    REQUIRE_EQ(picked[2].id, std::string("tt1"));
}

TEST(you_might_like_without_history_is_the_catalogue_order) {
    const std::vector<MediaItem> pool{Movie("tt1", "One"), Movie("tt2", "Two"), Movie("tt3", "Three")};
    const auto picked = tvm::catalog::PickYouMightLike(pool, {}, {}, 2, 2026);
    REQUIRE_EQ(picked.size(), std::size_t{2});
    REQUIRE_EQ(picked[0].id, std::string("tt1"));
    REQUIRE_EQ(picked[1].id, std::string("tt2"));
}

TEST(because_you_watched_shares_a_genre_and_skips_the_source) {
    const MediaItem source = Movie("tt1", "Source", {"Horror"});
    const std::vector<MediaItem> pool{source, Movie("tt2", "Scary", {"horror"}), Movie("tt3", "Funny", {"Comedy"})};
    const auto picked = tvm::catalog::BecauseYouWatched(&source, pool, {}, 12);
    REQUIRE_EQ(picked.size(), std::size_t{1});
    REQUIRE_EQ(picked[0].id, std::string("tt2"));
    REQUIRE(tvm::catalog::BecauseYouWatched(nullptr, pool, {}, 12).empty());
}

// ------------------------------------------------------------------- shelves

const tvm::catalog::HomeRail* FindRail(const std::vector<tvm::catalog::HomeRail>& rails, const std::string& id) {
    for (const tvm::catalog::HomeRail& rail : rails) {
        if (rail.id == id) return &rail;
    }
    return nullptr;
}

TEST(home_shelves_put_for_you_first_and_keep_watching_titles_off_the_catalogue_rails) {
    const MediaItem five = Movie("tt5", "Five");
    tvm::catalog::CatalogBundle bundle;
    bundle.moviesTop = {five, Movie("tt1", "One")};
    // "You might like" takes sixteen of these, so "Because you watched" draws on the two left over.
    for (int i = 10; i < 28; ++i) bundle.catalog.push_back(Movie("tt" + std::to_string(i), "Film " + std::to_string(i)));
    bundle.catalog.push_back(five);

    const auto rails = tvm::catalog::BuildHomeRails(bundle, {}, {five}, {}, 2026);
    REQUIRE(!rails.empty());
    REQUIRE_EQ(rails[0].id, std::string("for-you"));

    // Five is in progress, so the popular shelf does not repeat it.
    const auto* films = FindRail(rails, "films");
    REQUIRE(films != nullptr);
    REQUIRE_EQ(films->items.size(), std::size_t{1});
    REQUIRE_EQ(films->items[0].id, std::string("tt1"));

    const auto* because = FindRail(rails, "because");
    REQUIRE(because != nullptr);
    REQUIRE_EQ(because->title, std::string("Because you watched Five"));
    REQUIRE_EQ(because->items.size(), std::size_t{2});
    REQUIRE_EQ(because->items[0].id, std::string("tt26"));
}

TEST(a_title_on_the_watchlist_is_not_repeated_on_the_catalogue_rails) {
    tvm::catalog::CatalogBundle bundle;
    bundle.moviesTop = {Movie("tt1", "One"), Movie("tt2", "Two")};
    const std::vector<MediaItem> watchlist{Movie("tt1", "One")};
    const auto rails = tvm::catalog::BuildHomeRails(bundle, {}, {}, watchlist, 2026);
    REQUIRE_EQ(rails.size(), std::size_t{1});
    REQUIRE_EQ(rails[0].id, std::string("films"));
    REQUIRE_EQ(rails[0].items.size(), std::size_t{1});
    REQUIRE_EQ(rails[0].items[0].id, std::string("tt2"));
}

TEST(continue_and_watchlist_shelves_show_their_titles_and_shares) {
    const std::vector<ProgressItem> watching = {{Movie("tt1", "One"), 0.25}, {Movie("tt2", "Two"), std::nullopt}};
    const RailData continueRail = tvm::ui::ContinueWatchingRail(watching);
    REQUIRE_EQ(continueRail.id, std::string("continue"));
    REQUIRE_EQ(continueRail.title, std::string("Continue watching"));
    REQUIRE_EQ(continueRail.cards.size(), std::size_t{2});
    REQUIRE(continueRail.cards[0].progress == std::optional<double>(0.25));
    REQUIRE(!continueRail.cards[1].progress.has_value());
    REQUIRE_EQ(continueRail.cards[0].posterUrl, std::string("https://img.example/tt1.jpg"));

    const std::vector<WatchlistEntry> saved = {WatchlistEntry{Movie("tt3", "Three"), "2026-01-01T00:00:00.000Z"}};
    const RailData watchlistRail = tvm::ui::WatchlistRail(saved);
    REQUIRE_EQ(watchlistRail.id, std::string("watchlist"));
    REQUIRE_EQ(watchlistRail.title, std::string("Watchlist"));
    REQUIRE_EQ(watchlistRail.cards[0].itemId, std::string("tt3"));
}

// ------------------------------------------------------------ details and shell

TEST(details_watchlist_button_waits_until_the_title_has_loaded) {
    DetailsScreen details("tt1", "One");
    details.Layout(1920.0, 1080.0);
    // Before the title loads, Right passes the missing list button and reaches Back.
    REQUIRE(details.Navigate(Direction::Right, 0.0));
    REQUIRE(details.FocusedKey() == std::optional<std::string>("back"));
    REQUIRE(details.Navigate(Direction::Left, 0.0));

    TitleInfo info;
    info.state = TitleInfo::State::Ready;
    info.id = "tt1";
    info.media = Movie("tt1", "One");
    details.SetInfo(info);
    REQUIRE(details.Navigate(Direction::Right, 0.0));
    REQUIRE(details.FocusedKey() == std::optional<std::string>("list"));

    // If the answer goes again, focus returns to Play rather than sitting on a button that is gone.
    TitleInfo unavailable;
    unavailable.state = TitleInfo::State::Unavailable;
    details.SetInfo(unavailable);
    REQUIRE(details.FocusedKey() == std::optional<std::string>("play"));
}

TEST(details_watchlist_button_asks_the_app_and_leaves_the_stack_alone) {
    TempFolder folder;
    tvm::ui::FilePreferenceStore store(folder.path());
    Shell shell(std::make_unique<Scene>(std::vector<RailSpec>{{"Rail", 2}}, store.Motion()), store);
    shell.Layout(1920.0, 1080.0);
    shell.Select(0.0);
    REQUIRE_EQ(shell.stack().entries.size(), std::size_t{2});

    TitleInfo info;
    info.state = TitleInfo::State::Ready;
    info.id = "card:0:0";
    info.media = Movie("tt1", "One");
    shell.SetTitleInfo("card:0:0", info);

    std::string handled;
    shell.SetActionHandler([&handled](const tvm::ui::Command& command) {
        handled = command.name + ":" + command.params.at("id");
    });
    shell.Navigate(Direction::Right, 0.0);
    shell.Select(0.0);

    REQUIRE_EQ(handled, std::string("watchlist:card:0:0"));
    REQUIRE_EQ(shell.stack().entries.size(), std::size_t{2});
}

std::string ReadText(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

// A file the app cannot read is the viewer's data. It is left alone, never replaced by an empty list.
TEST(an_unreadable_watchlist_is_not_written_over) {
    TempFolder folder;
    const std::string garbage = "not sealed and not JSON";
    std::ofstream(tvm::paths::WatchlistPath(folder.path()), std::ios::binary) << garbage;

    REQUIRE(tvm::catalog::AddWatchlist(folder.path(), Movie("tt1", "One")).empty());
    REQUIRE(tvm::catalog::RemoveWatchlist(folder.path(), "tt1").empty());
    REQUIRE(ReadText(tvm::paths::WatchlistPath(folder.path())) == garbage);
}

TEST(an_unreadable_progress_file_is_not_written_over) {
    TempFolder folder;
    const std::string garbage = "not sealed and not JSON";
    std::ofstream(tvm::paths::ProgressPath(folder.path()), std::ios::binary) << garbage;

    REQUIRE(tvm::catalog::WriteProgress(folder.path(), "tt1", 900, 3600).empty());
    REQUIRE(ReadText(tvm::paths::ProgressPath(folder.path())) == garbage);
}

TEST(scene_focus_title_moves_to_the_card_for_that_title) {
    RailData rail;
    rail.id = "a";
    rail.title = "A";
    CardData first;
    first.itemId = "tt1";
    first.title = "One";
    CardData second;
    second.itemId = "tt2";
    second.title = "Two";
    rail.cards = {first, second};

    Scene scene(std::vector<RailSpec>{}, tvm::motion::MotionSettings{});
    scene.Layout(1920.0, 1080.0);
    scene.SetRails({rail});
    REQUIRE(scene.FocusTitle("tt2", 0.0));
    REQUIRE(scene.FocusedItemId() == std::optional<std::string>("tt2"));
    REQUIRE(!scene.FocusTitle("tt9", 0.0));
}

}  // namespace
