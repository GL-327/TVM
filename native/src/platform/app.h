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
#include <deque>
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
#include "core/content.h"
#include "core/extras.h"
#include "core/core_client.h"
#include "core/paths.h"
#include "nav/hop_queue.h"
#include "platform/artwork_store.h"
#include "platform/background.h"
#include "platform/glass_lens.h"
#include "platform/graphics.h"
#include "platform/image_cache.h"
#include "platform/mpv_player.h"
#include "platform/overlay_window.h"
#include "ui/catalog_view.h"
#include "ui/details_screen.h"
#include "ui/intro.h"
#include "ui/downloads_screen.h"
#include "ui/logo_reveal.h"
#include "ui/profile_chooser.h"
#include "ui/profile_editor.h"
#include "ui/preferences_store.h"
#include "ui/realdebrid_screen.h"
#include "ui/scene.h"
#include "ui/shell.h"
#include "ui/live_playlist_screen.h"
#include "ui/live_tv_view.h"
#include "ui/guide_view.h"
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
    double meterFrameMs_ = 0.0;
    double meterLastFrame_ = -1.0;
    POINT ClientPoint(LPARAM lParam) const;

    // The catalogue. Fetching runs on workers; the results are applied here.
    void LoadCatalog();
    // Builds Home's shelves from the stored catalogue and the viewer's watchlist and progress.
    void RebuildHome();
    void RefreshContent();
    void RefreshExtrasHome();
    void LoadPlayerExtras(int generation, const playback::Resolution& resolution);
    void ApplyExtrasState(const mpv::State& state);
    void RequestSubtitle(std::size_t index);
    void LoadPreferredSubtitle();
    void LoadExtrasPage();
    void ExtrasAction(const std::string& verb);
    ui::InfoView ExtrasView() const;
    ui::InfoView StatsView() const;
    extras::Preferences extrasPrefs_;
    nlohmann::json extrasStats_ = nlohmann::json::object();
    extras::Segments playerSegments_{};
    extras::SegmentSession segmentSession_;
    extras::NextCountdown nextCountdown_;
    ui::RailData upcomingRail_;
    unsigned extrasEpoch_ = 0;
    bool extrasHomeBusy_ = false;
    double extrasHomeCheckedMs_ = -600000;
    struct ExternalSubtitle { std::string file, label, language, url; bool loading = false, loaded = false; };
    std::vector<ExternalSubtitle> pendingSubtitles_;
    std::vector<ExternalSubtitle> externalSubtitles_;
    bool subtitlePreferenceApplied_ = false;
    std::optional<int> pendingAudioTrackId_;
    int pendingAudioWaitTicks_ = 0;
    std::string subtitleChoice_;

    void RefreshProfilePolicy();
    bool Allowed(const catalog::MediaItem& item) const;
    void PageRails();
    void FilterView(ui::SceneView& view) const;
    void SyncReleaseNotice(double nowMs);
    void DismissReleaseNotice(double nowMs);
    std::atomic<int> patchPopupFlag_{-1};  // -1 unknown, 0 off, 1 on: flags.patchNotesPopup from Core
    bool patchPopupAsked_ = false;
    std::unique_ptr<content::ReleaseNotice> releaseNotice_;
    double updatesCheckedMs_ = 0;
    // Turns the Home hero to its next title every eight seconds, while Home is on screen and not reduced.
    void TurnHero(double now);
    // Queues a download. `onScreen` puts it ahead of pictures fetched in advance.
    void QueueArtwork(const std::string& url, bool onScreen = false);
    void PumpArtwork();
    // Takes the pictures painting asked for and queues them, and wakes a frame when a retry falls due.
    void SyncArtwork(double nowMs);
    // A cached picture that would not decode is downloaded once more before its placeholder is accepted.
    void HandleUndecodable(const std::wstring& file);
    // Esc or the remote's Back at Home: ask before closing TVM.
    void ConfirmQuit();
    // "Who's watching?" and the orb's profile menu, filled in from the profile registry.
    ui::ChooserView ChooserFromRegistry(const std::string& message);
    void ShowChooser(const std::string& message);
    void OpenChooser();
    // Opens TVM again, then closes this window (Settings > Restart).
    void RestartApp();
    // Appends frame-time statistics to frame-times.log (TVM_FRAME_LOG=1).
    void WriteFrameLog(std::vector<double> gaps) const;
    void QueueRailArtwork(const std::vector<ui::RailData>& rails);
    // Keeps the details for the title on top in step with the shell, and prefetches hovered or focused cards.
    void SyncDetails();
    void SyncDetailsPrefetch(double nowMs);
    void ShowTitle(const std::string& id);
    void PrefetchTitle(const std::string& id, const std::string& posterUrl, const std::string& backdropUrl);
    void FetchTitle(const std::string& id);
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
    void FinishRealDebrid(const coreapi::RealDebridStatus& status, const std::string& message);
    void RefreshRdStatus();
    void MaybePromptRealDebrid();
    void UpdateSettingsDiagnostics();
    // Settings' playback, subtitle, Home and Extras rows: read from Core when Settings opens, and written back to it
    // one partial PUT /api/prefs per change.
    void LoadSettingsPrefs();
    void SavePrefsPatch(const nlohmann::json& patch);
    bool ApplySettingsPrefs(const nlohmann::json& data);
    void FlushSettingsPrefs();
    void ApplyVolumeCap();
    unsigned prefsSaveSeq_ = 0;
    nlohmann::json pendingPrefs_ = nlohmann::json::object();
    bool prefsSaving_ = false;
    std::vector<ui::HomeSection> homeSections_;

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
    void RefreshGuide();
    void TickGuide(double now);
    bool GuideActive() const;
    bool HandleGuideKey(WPARAM key);
    bool HandleGuideMouse(UINT message, WPARAM buttons, LPARAM point);
    void WatchGuideChannel(const std::string& id);
    guide::View guide_;
    guide::Time guideLoadedStart_ = 0, guideLoadedEnd_ = 0, guideClock_ = 0;
    double guideTuneAt_ = 0, guideRetryAt_ = 0;
    // Core was still downloading a feed at the last answer, so the guide asks again (see guide::ShouldRepoll).
    bool guideRepoll_ = false;
    int guideRepolls_ = 0;
    bool guideVisible_ = true, guideFetching_ = false, guideSearch_ = false;
    std::string guideDigits_;
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
    // The six tabs of the stream chrome. Home, Movies and Series are browse lanes; Live TV, Library and Search
    // are page lanes, shown on the same root scene so the chrome never leaves the screen.
    std::vector<ui::TopButton> StreamNav(bool root) const;
    static bool IsPageLane(const std::string& lane) { return lane == "live" || lane == "library" || lane == "search"; }
    // Builds the page lane that is on into Home.
    void BuildPageLane();
    // Shows a page's view on Home under the stream chrome: its own buttons move under the chrome.
    void ShowPageLane(ui::SceneView view);
    // Opens a tab from anywhere: back to Home, then that lane.
    void OpenStreamTab(const std::string& lane);
    // Whether typing goes into a search field: the Search modal, or the Search lane with its field focused.
    bool SearchTyping() const;
    // True whenever the user is currently typing into any text input (Search, InfoScreen field, Profile sheet).
    bool IsEditingText() const;

    // Watchlist, Profiles and Updates, each filled in as it comes on top.
    void SyncPages();
    void BuildWatchlistPage();
    void ShowProfiles(const std::string& message);
    void ApplyProfileAction(const ui::Command& command);
    void OpenProfileEditor(const std::string& id);
    void AskProfilePin(const ui::Command& pending, const std::string& id);
    std::optional<ui::Command> pendingProfileAction_;
    std::string profileEditPin_, profileEditId_, adultApprovalId_, adultApprovalPin_;
    void CheckForUpdates();
    void InstallNativeUpdate();
    void ShowUpdates();

    // The info pages: Legal, Donate, Downloads, What's new, Diagnostics, System info, Setup, Recovery, the
    // channel check, the developer pages, Apps and Confirm (app_pages.cpp). Each is filled in from an InfoView
    // when it comes on top and whenever its state changes; its buttons arrive as "info:" actions.
    void OpenInfoPage(const nav::ViewEntry& entry);
    void ShowInfoPage();
    void ApplyInfoAction(const ui::Command& command);
    ui::AccountScreen* ActiveAccountScreen();
    void SyncAccountScreen();
    void SyncPlansScreen();
    void HandleAccountCommand(const ui::Command& command);
    void ChoosePlan(const ui::Command& command);
    void RefreshAccount();
    void RefreshTerms();
    void RefreshTiers();
    void FinishAccount(const coreapi::AccountState& state, const std::string& message = "",
                       bool isError = false, std::string errorField = "");
    coreapi::RealDebridStatus CoreRealDebrid() const;
    std::optional<admin::MailSettings> CoreMail() const;
    playback::Resolution CorePlayback(const std::string& id, const std::string& title, int maxHeight = 0, const std::string& versionId = {}, bool versions = false) const;
    // The info page on top when it has a field to type into.
    ui::InfoScreen* TypingPage();
    // Keeps what was typed into a page's field, and filters Accounts as its search is typed.
    void TypedIntoPage(ui::InfoScreen& page);
    ui::InfoView LegalView() const;
    ui::InfoView DonateView() const;
    ui::DownloadsView DownloadsScreenView() const;
    std::vector<int> DownloadSeasons() const;
    std::vector<const catalog::MediaItem*> DownloadSeasonEpisodes() const;
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
    ui::InfoView ServicesView() const;
    nlohmann::json ConnectedServices() const;
    void ConnectService(const std::string& id, bool connected);
    void LaunchService(const std::string& id, bool signin, const std::string& title = "");
    std::string pendingService_;
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
    // The scene showing the Search page now (the lane on Home or the Search screen), if any.
    ui::Scene* SearchScene();
    void RunSearch();
    void ApplySearch();

    // Playback. The stream is found on a worker, then mpv plays it in a child window, and the player's
    // chrome is drawn over it in the overlay window. Leaving the player ends the session.
    void SyncPlayer();
    void TickPlaybackTools(double now);
    void VideoClickAction(mpv::VideoClicks::Action action);
    void UpdatePlaybackTools(const mpv::State& state);
    void OpenTrailer(const std::string& url, const std::string& title);
    mpv::VideoClicks videoClicks_;
    bool videoPressed_ = false, audioPreferenceApplied_ = false, playerStyleApplied_ = false;
    bool minimizePaused_ = false, playerNightInitialized_ = false;
    std::optional<double> sleepDeadline_;
    bool sleepAtEnd_ = false;
    std::string playerVersionId_, playerTransport_, playerVersionLabel_, playerAudioLanguage_;
    std::string playerTrailerUrl_, playerYtdlpPath_;
    extras::Preferences playerPrefs_;
    void StartPlayback();
    void PrepareHls(playback::Resolution& resolution, int height) const;
    void SwitchHls(int height);
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
    // `save` is false while the volume bar is dragged, so each step does not write the settings file.
    void SetVolume(double level, bool save = true);
    // The sound level and mute, kept between runs as the web keeps them in audioPrefs.
    void LoadAudio();
    void SaveAudio() const;
    // Borderless over the whole monitor, and back to the window as it was.
    void ToggleFullscreen();

    HINSTANCE instance_;
    HWND window_ = nullptr;
    paths::fs::path dataDir_;
    std::unique_ptr<coreapi::Client> core_;
    coreapi::AccountState account_;
    bool accountBusy_ = false;
    double accountCheckedMs_ = 0;
    std::string accountMessage_;
    bool accountMessageError_ = false;
    std::string accountErrorField_;
    coreapi::TermsDocument termsDoc_ = coreapi::DefaultTermsDocument();
    bool termsLoaded_ = false;
    bool termsBusy_ = false;
    ui::PlansView plansView_;
    bool tiersLoaded_ = false;
    bool tiersBusy_ = false;
    coreapi::RealDebridStatus rdStatus_;
    bool rdStatusLoaded_ = false;
    bool rdStatusChecking_ = false;
    double rdCheckedMs_ = -60000;
    bool rdHomeShown_ = false, realDebridChanging_ = false;
    bool rdOnboardingDismissed_ = false;
    bool rdOnboardingPrompted_ = false;
    Graphics graphics_;
    ComPtr<ID2D1HwndRenderTarget> target_;
    std::unique_ptr<ui::FilePreferenceStore> store_;
    std::unique_ptr<catalog::CatalogService> catalog_;
    std::unique_ptr<xtream::Client> xtream_;
    std::unique_ptr<ArtworkStore> artwork_;
    std::unique_ptr<ImageCache> images_;
    // Clear refracting glass for the window target; rebuilt with it.
    std::unique_ptr<GlassLens> lens_;
    std::unique_ptr<ui::Shell> shell_;
    // The open sting, drawn over the shell until it has played or been skipped.
    // The launch reveal, ported from the Android app.
    std::unique_ptr<ui::LogoReveal> intro_;
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
    std::unique_ptr<content::Store> content_;
    nlohmann::json parental_;
    int profileMaxAge_ = 18;
    bool kidsProfile_ = false;
    double contentCheckedMs_ = -21600000;
    std::string contentDate_;
    std::vector<ui::HeroData> eventHeroes_;
    std::vector<ui::RailData> eventRails_;
    struct RailPage { std::vector<catalog::MediaItem> items; std::size_t skip = 0; bool more = true; bool busy = false; };
    std::map<std::string, RailPage> railPages_;
    catalog::CatalogBundle bundle_;
    std::vector<catalog::GenreShelf> shelves_;
    bool catalogReady_ = false;
    // Set when the watchlist changed, so Home is rebuilt once the details are left.
    bool homeStale_ = false;
    // When the Home hero last turned, on the window clock.
    double lastHeroTurnMs_ = 0.0;

    // Window-thread state. Workers never touch these.
    std::set<std::string> queuedArtwork_;
    // The player's volume bar is being dragged (the mouse is captured).
    bool volumeDragging_ = false;
    // Whether Windows has been asked for WM_MOUSELEAVE since the last one arrived.
    bool trackingLeave_ = false;
    // Downloads waiting for a worker, on-screen pictures at the front. Only a few run at once, so pictures never
    // crowd out catalogue calls on the shared workers.
    std::deque<std::string> artworkQueue_;
    int artworkInFlight_ = 0;
    struct ArtworkTry {
        int failures = 0;
        double retryAtMs = 0.0;
        // The server has no such picture, or every retry failed: its placeholder stays for this session.
        bool givenUp = false;
        int refetches = 0;
    };
    std::map<std::string, ArtworkTry> artworkTries_;
    // The earliest moment a failed picture may be tried again, or 0.
    double artworkRetryDueMs_ = 0.0;
    std::map<std::string, ui::TitleInfo> titles_;
    std::set<std::string> titlesInFlight_;
    std::optional<std::string> shownTitle_;
    ui::DetailsPrefetchTracker detailsPrefetch_;
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
    // The last search failed (network or server), so the page offers Retry rather than "nothing matched".
    bool searchFailed_ = false;
    // A search on its way, for the page's loading state.
    bool searchRunning_ = false;
    // Counts each new set of search results, so a new set opens at the top of the page.
    int searchResultsGeneration_ = 0;
    // Search's filter tab: all, movies or series.
    std::string searchFilter_ = "all";
    // The genre a Browse tile opened on Search, while nothing is typed.
    std::string browseGenre_;
    // The chooser closes a moment after a pick, so its avatar's pick animation is seen.
    std::optional<double> chooserCloseAtMs_;
    // The launch chooser has been considered once this run.
    bool launchChooserDone_ = false;
    // The launch reveal holds on the finished logo until both of these have answered (or its hold runs out).
    bool catalogSettled_ = false;
    bool accountSettled_ = false;
    // What was searched this session, newest first, offered as chips on an empty Search page.
    std::vector<std::string> recentSearches_;
    double searchTypedMs_ = 0.0;
    int searchGeneration_ = 0;

    // The playback session. `playerGeneration_` changes with each attempt, so a late answer from an
    // earlier one is dropped.
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
    double usageTickMs_ = 0.0;
    double usageSeconds_ = 0.0;
    // The streams the quality menu offers for this title, and the one playing.
    std::vector<playback::StreamChoice> streamChoices_;
    std::size_t streamChosen_ = 0;
    int playerScreenHeight_ = 1080;
    int playerBestHeight_ = 1080;
    int playerPlanHeight_ = 2160;
    int playerManualHeight_ = 0;
    std::string playerHlsSource_;
    std::vector<int> playerHlsHeights_;
    int playerHlsHeight_ = 0;
    bool playerHlsSwitching_ = false;
    double playerStallSince_ = 0, playerHealthySince_ = 0;
    // The episode after the one playing, its show's name, and whether the viewer chose to watch the credits.
    std::optional<catalog::MediaItem> nextEpisode_;
    std::string showTitle_;
    // The catalogue title sent with the play command, used before the stream or its details answer.
    std::string playerTitleHint_;
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

void PrepareMpv(coreapi::Client& client);

}  // namespace tvm::platform
