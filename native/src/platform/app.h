#pragma once

// The window and its frame loop. Win32 messages are translated here into the
// shell's calls: remote keys go through the intent map and the D-pad hop
// queue, mouse and wheel and touch go to the shell's pointer routing. The loop
// ticks the shell each frame and draws it with Direct2D, and sleeps when
// nothing is moving, so an idle TV draws nothing.
//
// The catalogue and the artwork are fetched on worker threads. Their results
// return to this thread as posted messages (see Background).

#include <windows.h>

#include <atomic>
#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "catalog/catalog_service.h"
#include "catalog/hubs.h"
#include "catalog/live.h"
#include "catalog/live_check.h"
#include "catalog/playback.h"
#include "catalog/rails.h"
#include "catalog/realdebrid.h"
#include "catalog/xtream.h"
#include "core/admin.h"
#include "core/paths.h"
#include "nav/hop_queue.h"
#include "platform/artwork_store.h"
#include "platform/background.h"
#include "platform/graphics.h"
#include "platform/image_cache.h"
#include "platform/mpv_player.h"
#include "platform/overlay_window.h"
#include "ui/catalog_view.h"
#include "ui/intro.h"
#include "ui/preferences_store.h"
#include "ui/realdebrid_screen.h"
#include "ui/scene.h"
#include "ui/shell.h"
#include "ui/live_playlist_screen.h"
#include "ui/live_tv_view.h"
#include "ui/xtream_screen.h"

namespace tvm::platform {

// The three fields of the Live TV login, each filled from the clipboard by its own row.
enum class XtreamField {
    Server,
    Username,
    Password,
};

struct AppOptions {
    unsigned width = 1280;
    unsigned height = 720;
    // The folder holding the viewer's preferences, the catalogue cache and the artwork.
    std::wstring dataDir;
};

class App {
public:
    App(HINSTANCE instance, const AppOptions& options);
    ~App();

    App(const App&) = delete;
    App& operator=(const App&) = delete;

    // Runs until the window closes or Back is pressed at the root. Returns the exit code.
    int Run(int showCommand);

private:
    static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam);

    double NowMs() const;
    bool HandleKey(WPARAM virtualKey, LPARAM flags);
    bool HandleMouse(UINT message, WPARAM wParam, LPARAM lParam);
    bool HandlePointer(UINT message, WPARAM wParam);
    // Ends the open sting if it is on screen, and says whether it did.
    bool SkipIntro();
    void Resize();
    void Render();
    POINT ClientPoint(LPARAM lParam) const;

    // The catalogue. Fetching runs on workers; the results are applied here.
    void LoadCatalog();
    // Builds Home's shelves from the stored catalogue and the viewer's watchlist and progress.
    void RebuildHome();
    // Turns the Home hero to its next title every eight seconds, while Home is on screen and not reduced.
    void TurnHero(double now);
    void QueueArtwork(const std::string& url);
    void QueueRailArtwork(const std::vector<ui::RailData>& rails);
    // Keeps the details for the title on top in step with the shell.
    void SyncDetails();
    void ShowTitle(const std::string& id);
    void FinishTitle(const std::string& id, const ui::TitleInfo& info);
    void QueueTitleArtwork(const ui::TitleInfo& info);
    // Saves the title on the details screen, or takes it off the watchlist.
    void ToggleWatchlist(const std::string& id);
    bool SavedOnWatchlist(const std::string& id) const;

    // Real-Debrid. The client makes its requests on workers, and the answers return here.
    // The Real-Debrid screen is brought up to date each time it comes on top.
    void SyncRealDebrid();
    void RefreshRealDebrid();
    // Saves the token on the clipboard, or removes the saved one.
    void SaveRealDebridToken();
    void ClearRealDebridToken();
    void ChangeRealDebridToken(std::string token, bool clearing);
    void FinishRealDebrid(const realdebrid::Status& status, const std::string& message);

    // Live TV login. Asking the panel happens on workers, as for Real-Debrid. The screen is
    // rebuilt from the answer each time, so no part of it is changed on a worker.
    void SyncXtream();
    void RefreshXtream();
    // Fills one field from the clipboard.
    void PasteXtreamField(XtreamField field);
    // Checks the login with the panel, then saves it.
    void SaveXtream();
    void ForgetXtream();
    void ChangeXtream(const xtream::Account& account);
    void FinishXtream(const ui::XtreamView& view);

    // Live TV channels. The catalogue is read on a worker, and the screen is rebuilt here from
    // the catalogue and the picks. Picking a channel saves the picks at once.
    void SyncLiveTv();
    void RefreshLiveTv();
    void ApplyLiveTv();
    void SetLiveChoosing(bool choosing);
    void ToggleLivePick(const std::string& id);

    // Live TV playlist. Reading and saving it happen on workers, as the channels do. The text
    // that is pasted is kept here, and the screen shows only its size.
    void SyncLivePlaylist();
    void RefreshLivePlaylist();
    void PasteLivePlaylistAddress();
    void PasteLivePlaylistText();
    void SaveLivePlaylist();
    void ClearLivePlaylist();
    void FinishLivePlaylist(const ui::LivePlaylistView& view);

    // TVM Stream. The page is built from the stored catalogue, the viewer's progress and list, and the
    // Real-Debrid status, which is checked on a worker each time the page comes on top.
    void SyncStream();
    void RefreshStreamStatus();
    void RebuildStream();
    // Fills Home or the TVM Stream page: the chrome, the billboard and the rails by lane. Home turns
    // through its titles and keeps its catalogue without Real-Debrid; the stream page asks for a token.
    void BuildBrowse(ui::Scene& scene, bool root);
    void SetStreamLane(const std::string& lane);

    // Watchlist, Profiles and Updates, each filled in as it comes on top.
    void SyncPages();
    void BuildWatchlistPage();
    void ShowProfiles(const std::string& message);
    void ApplyProfileAction(const ui::Command& command);
    void CheckForUpdates();
    void ShowUpdates();

    // The info pages: Legal, Donate, Downloads, What's new, Diagnostics, System info, Setup, Recovery, the
    // channel check, the developer pages, Apps and Confirm (app_pages.cpp). Each is filled in from an InfoView
    // when it comes on top and whenever its state changes; its buttons arrive as "info:" actions.
    void OpenInfoPage(const nav::ViewEntry& entry);
    void ShowInfoPage();
    void ApplyInfoAction(const ui::Command& command);
    // The info page on top when it has a field to type into.
    ui::InfoScreen* TypingPage();
    // Keeps what was typed into a page's field, and filters Accounts as its search is typed.
    void TypedIntoPage(ui::InfoScreen& page);
    ui::InfoView LegalView() const;
    ui::InfoView DonateView() const;
    ui::InfoView DownloadsView() const;
    ui::InfoView ChangelogView() const;
    ui::InfoView DiagnosticsView() const;
    ui::InfoView SystemInfoView() const;
    ui::InfoView SetupView() const;
    ui::InfoView RecoveryView() const;
    ui::InfoView LiveCheckView() const;
    ui::InfoView MailView() const;
    ui::InfoView AccountsView() const;
    ui::InfoView DeveloperView() const;
    ui::InfoView AppsView() const;
    ui::InfoView ConfirmView() const;
    void ExportPersonalData();
    // Removes everything TVM keeps in its data folder, then starts a fresh copy, as the web reload does.
    void EraseLocalData();
    void LoadAccounts();
    void LoadDownloadEpisodes(const std::string& seriesId);
    void QueueDownloads();
    void PumpDownloads();
    void ChooseDownloadFolder();
    // The language, quality and folder last chosen, kept in downloads.json so the next download starts with them.
    void LoadDownloadPrefs();
    void SaveDownloadPrefs() const;
    void RunLiveCheck();
    // A service hub: built on a worker from the seed lists and the catalogue, then kept for the session.
    void OpenServiceHub(const std::string& id);
    void ShowServiceHub(const hubs::Hub& hub);
    // Safe mode: three starts within a minute without a clean exit open Recovery, as the web shell does.
    bool CrashLooping();
    void MarkCleanExit();

    // Search. Typing goes into the query; the catalogue is asked 180 ms after the last key, on a
    // worker, as SearchModal debounces it. The results show as rails of posters.
    void SyncSearch();
    bool HandleSearchKey(WPARAM virtualKey);
    void TypeSearch(const std::string& text);
    void RunSearch();
    void ApplySearch();

    // Playback. The stream is found on a worker, then mpv plays it in a child window, and the player's
    // chrome is drawn over it in the overlay window. Leaving the player ends the session.
    void SyncPlayer();
    void StartPlayback();
    void StopPlayback();
    void ApplyPlayerAction(const ui::Command& command);
    void FinishResolve(int generation, const playback::Resolution& resolution);
    void OnPlayerState(const mpv::State& state);
    void OnPlayerError(const std::string& message);
    void ShowPlayerError(const std::string& title, const std::string& body);
    void SavePlayerProgress(bool force);
    // Keys the player takes before the shell: seeking, volume, play and pause.
    bool HandlePlayerKey(WPARAM virtualKey, LPARAM flags);
    // Trickplay: a thumbnail for the time being previewed, made by a second mpv that writes one frame of
    // the stream as a picture. One is made at a time, for ten-second stretches, and kept for the session.
    void SyncThumbnail();
    // The menus: a track, a speed, or another stream from the quality menu.
    void PickPlayerOption(const std::string& kind, const std::string& id);
    void SwitchStream(std::size_t choice);
    void ShowStreamChoices();
    // Next Up: the episode after this one, looked up from the series' episodes, and playing it.
    void LookUpNextEpisode();
    void PlayNextEpisode();
    // The timeline drag, with the mouse captured while the button is held.
    bool HandleScrub(UINT message, POINT point);
    void ChangeVolume(double delta);
    void SetVolume(double level);
    // The sound level and mute, kept between runs as the web keeps them in audioPrefs.
    void LoadAudio();
    void SaveAudio() const;
    // Borderless over the whole monitor, and back to the window as it was.
    void ToggleFullscreen();

    HINSTANCE instance_;
    HWND window_ = nullptr;
    paths::fs::path dataDir_;
    Graphics graphics_;
    ComPtr<ID2D1HwndRenderTarget> target_;
    std::unique_ptr<ui::FilePreferenceStore> store_;
    std::unique_ptr<catalog::CatalogService> catalog_;
    std::unique_ptr<realdebrid::Client> realDebrid_;
    std::unique_ptr<xtream::Client> xtream_;
    std::unique_ptr<ArtworkStore> artwork_;
    std::unique_ptr<ImageCache> images_;
    std::unique_ptr<ui::Shell> shell_;
    // The open sting, drawn over the shell until it has played or been skipped.
    std::unique_ptr<ui::Intro> intro_;
    // TVM Stream's sting, started when that screen first opens.
    std::unique_ptr<ui::Intro> streamIntro_;
    // Owned by the shell. Kept to set the catalogue's rails and status.
    ui::Scene* home_ = nullptr;
    nav::AxisHopQueue hops_;
    double lastHopMs_ = -1.0e9;
    bool dirty_ = true;
    LARGE_INTEGER frequency_{};
    LARGE_INTEGER start_{};

    // The catalogue as last fetched, and whether Home has been built from it.
    catalog::CatalogBundle bundle_;
    std::vector<catalog::GenreShelf> shelves_;
    bool catalogReady_ = false;
    // Set when the watchlist changed, so Home is rebuilt once the details are left.
    bool homeStale_ = false;
    // When the Home hero last turned, on the window clock.
    double lastHeroTurnMs_ = 0.0;

    // Window-thread state. Workers never touch these.
    std::set<std::string> queuedArtwork_;
    std::map<std::string, ui::TitleInfo> titles_;
    std::set<std::string> titlesInFlight_;
    std::optional<std::string> shownTitle_;
    // The Real-Debrid answer as last applied, and whether the screen has been opened for this visit.
    ui::RealDebridView realDebridView_;
    bool realDebridOpened_ = false;
    // The Live TV login as shown, and whether the screen has been opened for this visit.
    // The password is kept here, never in the view, so the screen cannot show it.
    ui::XtreamView xtreamView_;
    bool xtreamOpened_ = false;
    std::string xtreamPassword_;
    // The Live TV catalogue, its picks and mode, as last read. The picks are the ones in the file.
    live::Catalog liveCatalog_;
    std::vector<std::string> livePicks_;
    bool liveLoaded_ = false;
    bool liveChoosing_ = false;
    bool liveOpened_ = false;
    std::string liveMessage_;
    // The Live TV playlist as shown, and whether the screen has been opened for this visit.
    ui::LivePlaylistView livePlaylistView_;
    bool livePlaylistOpened_ = false;
    std::string livePlaylistText_;

    // TVM Stream as shown: its lane, and the Real-Debrid status it last read.
    std::string streamLane_ = "all";
    bool streamOpened_ = false;
    bool streamStatusLoaded_ = false;
    realdebrid::Status streamStatus_;

    // The page last filled in, so each is filled once a visit. The watchlist's filter and order, and the
    // Updates page as last answered.
    std::string pageOpened_;
    std::string watchlistFilter_ = "all";
    std::string watchlistSort_ = "saved";
    ui::UpdatesView updatesView_;

    // The info page on top, its params, and what it says. The fields a page types into are kept by
    // "<page>.<field>"; a secret is held only while its page is open.
    std::string pageName_;
    std::map<std::string, std::string> pageParams_;
    std::string pageMessage_;
    bool pageMessageBad_ = false;
    bool pageBusy_ = false;
    // A second press is asked for, as Legal's erase and Recovery's shutdown ask.
    bool pageConfirm_ = false;
    std::string fieldMode_;
    std::map<std::string, std::string> fieldValues_;
    int donateAmount_ = 500;

    // Downloads, one at a time, for this session, as the desktop bridge keeps them.
    struct DownloadJob {
        int id = 0;
        std::string playId;
        std::string title;
        // queued, resolving, downloading, complete, failed or cancelled.
        std::string state = "queued";
        unsigned long long bytes = 0;
        unsigned long long total = 0;
        std::string error;
        std::filesystem::path path;
        std::shared_ptr<std::atomic<bool>> cancel = std::make_shared<std::atomic<bool>>(false);
    };
    std::vector<DownloadJob> downloads_;
    int downloadSerial_ = 0;
    bool downloadRunning_ = false;
    std::string downloadLanguage_ = "en";
    bool downloadPrefsLoaded_ = false;
    int downloadQuality_ = 1080;
    std::string downloadScope_ = "episode";
    int downloadSeason_ = 1;
    std::string downloadEpisode_;
    std::vector<catalog::MediaItem> downloadEpisodes_;
    bool downloadEpisodesLoading_ = false;
    std::filesystem::path downloadFolder_;
    double downloadShownMs_ = 0.0;

    std::map<std::string, hubs::Hub> hubs_;
    std::set<std::string> hubsInFlight_;

    livecheck::Report liveReport_;
    bool liveReportReady_ = false;
    bool liveChecking_ = false;
    std::size_t liveCheckLimit_ = 25;
    int liveCheckGroup_ = -1;

    std::string accountsState_ = "all";
    std::string accountOpen_;
    std::vector<admin::Account> accounts_;
    admin::Summary accountsSummary_;
    std::optional<admin::MailSettings> mailSaved_;
    admin::MailSettings mailDraft_;

    // The search page as shown. `searchGeneration_` changes with each query, so a late answer is dropped.
    bool searchOpened_ = false;
    std::string searchQuery_;
    std::string searchStatus_;
    std::vector<catalog::MediaItem> searchResults_;
    bool searchPending_ = false;
    double searchTypedMs_ = 0.0;
    int searchGeneration_ = 0;

    // The playback session. `playerGeneration_` changes with each attempt, so a late answer from an
    // earlier one is dropped.
    std::unique_ptr<playback::Resolver> resolver_;
    std::unique_ptr<MpvPlayer> mpv_;
    std::unique_ptr<OverlayWindow> overlay_;
    ui::PlayerView playerView_;
    bool playerOpen_ = false;
    int playerGeneration_ = 0;
    std::string playerId_;
    bool playerLive_ = false;
    std::optional<double> playerRetryAt_;
    int playerRecoveries_ = 0;
    double playerVolume_ = 1.0;
    bool playerMuted_ = false;
    double lastProgressSaveMs_ = 0.0;
    // The streams the quality menu offers for this title, and the one playing.
    std::vector<playback::StreamChoice> streamChoices_;
    std::size_t streamChosen_ = 0;
    // The episode after the one playing, its show's name, and whether the viewer chose to watch the credits.
    std::optional<catalog::MediaItem> nextEpisode_;
    std::string showTitle_;
    bool nextDismissed_ = false;
    bool scrubbing_ = false;
    // Skip recap was used, or the viewer chose to watch the credits, for this title.
    bool recapDone_ = false;
    bool creditsWatched_ = false;
    // Go Live: how far behind a live channel has fallen from pauses, and when the current pause began.
    double liveBehindSeconds_ = 0.0;
    std::optional<double> livePausedAtMs_;
    // The remote hints show once, ever, as the web keeps the flag in local storage.
    bool hintsSeen_ = false;
    // The title My List was asked to save while its details were still loading.
    std::optional<std::string> pendingSave_;
    // The id My List saves for what plays: the series for an episode.
    std::string SaveId() const;
    void UpdateLiveBehind();
    // Hold-to-skip: when the held arrow went down, when it last stepped, and where the hold is heading.
    double holdStartMs_ = 0.0;
    double lastHoldStepMs_ = 0.0;
    double holdTarget_ = 0.0;
    // The stream playing, the thumbnails made from it by ten-second stretch, and the one being made.
    std::string playerUrl_;
    std::map<int, std::string> thumbnails_;
    bool thumbnailBusy_ = false;
    int thumbnailSession_ = 0;
    // The overlay draws on its own target, so its pictures are made in their own cache.
    std::unique_ptr<ImageCache> overlayImages_;
    ID2D1RenderTarget* overlayTarget_ = nullptr;
    bool fullscreen_ = false;
    WINDOWPLACEMENT windowedPlacement_{sizeof(WINDOWPLACEMENT)};
    // Where the mouse last was. Windows sends a move whenever a window changes under a still cursor,
    // and the overlay changes every frame, so only a real move brings the player's chrome back.
    POINT lastMouse_{-1, -1};

    // Declared last, so it is destroyed first: its threads finish before the
    // catalogue, the artwork and the shell they may still use go away.
    std::unique_ptr<Background> background_;
};

}  // namespace tvm::platform
