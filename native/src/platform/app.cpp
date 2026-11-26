#include "platform/app.h"
#include "platform/core_host.h"
#include <shellapi.h>
#include <timeapi.h>

#include <algorithm>
#include <chrono>
#include <iterator>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <optional>
#include <stdexcept>

#include "catalog/artwork.h"
#include "catalog/cinemeta.h"
#include "catalog/progress.h"
#include "catalog/rails.h"
#include "catalog/watchlist.h"
#include "core/config.h"
#include "core/js.h"
#include "core/mpv.h"
#include "core/prefs.h"
#include "core/paths.h"
#include "core/profiles.h"
#include "core/update_policy.h"
#include "core/util.h"
#include "motion/preferences.h"
#include "nav/intents.h"
#include "nav/pointer.h"
#include "platform/d2d_painter.h"
#include "platform/video_texture.h"

namespace tvm::platform {

namespace {

constexpr wchar_t kWindowClass[] = L"TVM.Native.Window";
constexpr wchar_t kTitle[] = L"TVM";
// One frame at 60 Hz. Used as the sleep bound while something is animating.
constexpr DWORD kFrameMs = 16;
// Worker threads for the network and the artwork. Enough that one slow poster does not hold up the rest.
constexpr std::size_t kWorkers = 6;

// Win32 wheel units per notch, and the pixels a notch moves in Chrome.
constexpr double kWheelUnitsPerNotch = 120.0;
constexpr double kWheelNotchPx = 100.0;

// Touch and pen input also arrive as mouse messages. Windows marks them in the
// message's extra info, so they are skipped here and handled as pointers.
constexpr ULONG_PTR kTouchExtraInfoMask = 0xFFFFFF00;
constexpr ULONG_PTR kTouchExtraInfoSignature = 0xFF515700;

nav::Direction DirectionOf(nav::Intent intent) {
    switch (intent) {
    case nav::Intent::Up:
        return nav::Direction::Up;
    case nav::Intent::Down:
        return nav::Direction::Down;
    case nav::Intent::Left:
        return nav::Direction::Left;
    default:
        return nav::Direction::Right;
    }
}

bool KeyDown(int virtualKey) {
    return (GetKeyState(virtualKey) & 0x8000) != 0;
}

bool FromTouchOrPen() {
    return (GetMessageExtraInfo() & kTouchExtraInfoMask) == kTouchExtraInfoSignature;
}

int SignedLow(LPARAM value) {
    return static_cast<int>(static_cast<short>(LOWORD(value)));
}

int SignedHigh(LPARAM value) {
    return static_cast<int>(static_cast<short>(HIWORD(value)));
}

// The year on this PC's clock. "New" titles are scored against it.
int CurrentYear() {
    SYSTEMTIME now{};
    GetLocalTime(&now);
    return static_cast<int>(now.wYear);
}

// The longest text a token or an address is read as, in characters. A token is a few dozen
// characters, so anything much longer is not one. A playlist's text is read up to its size limit.
constexpr std::size_t kLongestClip = 4096;

// The clipboard's text, when it is no longer than `longest` characters. Read on the window
// thread, which owns the clipboard calls.
std::optional<std::string> ClipboardText(HWND window, std::size_t longest = kLongestClip) {
    if (!OpenClipboard(window)) return std::nullopt;

    std::optional<std::string> text;
    if (HANDLE handle = GetClipboardData(CF_UNICODETEXT)) {
        if (const auto* wide = static_cast<const wchar_t*>(GlobalLock(handle))) {
            const std::wstring value(wide);
            GlobalUnlock(handle);
            if (value.size() <= longest) text = util::ToUtf8(value);
        }
    }
    CloseClipboard();
    return text;
}

realdebrid::Status ToCatalogRdStatus(const coreapi::RealDebridStatus& status) {
    realdebrid::Status out;
    out.configured = status.configured;
    out.username = status.username;
    out.premium = status.premium;
    out.error = status.error;
    return out;
}

// What the Real-Debrid screen says once a token is saved.
std::string SavedMessage(const coreapi::RealDebridStatus& status) {
    if (status.error == "needs-auth") return "Real-Debrid rejected that token.";
    if (status.username.has_value()) return "Signed in as " + *status.username + ".";
    if (status.error == "unreachable") return "Token saved on this machine. Real-Debrid could not be reached to check it.";
    return "Token saved on this machine.";
}

constexpr char kClearedMessage[] = "Token cleared. TVM Stream will ask for it again.";
constexpr char kNotStoredMessage[] = "The token was not stored.";

// The Home hero turns to its next title this often, as the web Home does.
constexpr double kHeroTurnMs = 60000.0;
// A search starts once typing pauses for this long, or at once on Enter.
constexpr double kSearchDebounceMs = 250.0;
// The most titles the hero turns through.
constexpr std::size_t kHeroLimit = 4;

std::string HeroMetaLine(const catalog::MediaItem& item) {
    std::vector<std::string> parts;
    if (item.year) parts.push_back(std::to_string(*item.year));
    for (std::size_t i = 0; i < std::min<std::size_t>(2, item.genres.size()); ++i) parts.push_back(item.genres[i]);
    std::string line;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) line += " \xC2\xB7 ";
        line += parts[i];
    }
    return line;
}

// The titles the Home hero turns through: the titles in progress, then the catalogue titles that have a
// picture. A title is listed once, by its id and by its name, as the web Home lists them.
std::vector<ui::HeroData> HeroTitles(const std::vector<catalog::MediaItem>& watching,
                                     const std::vector<catalog::HomeRail>& rails) {
    std::vector<catalog::MediaItem> candidates;
    for (const auto& rail : rails) {
        if (rail.id == "for-you") candidates.insert(candidates.end(), rail.items.begin(), rail.items.end());
    }
    for (const catalog::HomeRail& rail : rails) {
        if (rail.id == "anime-adapted") continue;
        for (const catalog::MediaItem& item : rail.items) {
            if (!item.backdrop.empty()) candidates.push_back(item);
        }
    }

    candidates.insert(candidates.end(), watching.begin(), watching.end());
    std::set<std::string> seen;
    std::vector<ui::HeroData> heroes;
    for (const catalog::MediaItem& item : candidates) {
        if (heroes.size() >= kHeroLimit) break;
        if (seen.contains(item.id) || seen.contains(item.title)) continue;
        seen.insert(item.id);
        seen.insert(item.title);
        ui::HeroData hero;
        hero.itemId = item.id;
        hero.title = item.title;
        hero.meta = HeroMetaLine(item);
        hero.rating = item.rating;
        const auto imdb = catalog::ImdbIdFrom(item.id);
        if (!imdb.empty()) hero.logoUrl = "https://images.metahub.space/logo/medium/" + imdb + "/img";
        hero.backdropUrl = catalog::PreferBackdrop(item.id, item.backdrop, item.poster);
        if (hero.backdropUrl.empty()) hero.backdropUrl = "asset:lighthouse.jpg";
        hero.hue = item.hue;
        heroes.push_back(hero);
    }
    return heroes;
}

// What the Live TV login screen says when the panel refuses the login or cannot be reached.
std::string XtreamFailureMessage(const std::string& error) {
    if (error == "needs-auth") return "That login was rejected. Check the server, username and password.";
    return "TVM could not reach that server. Check the address and the network.";
}

void RefreshSystemMotion() {
    BOOL animations = TRUE;
    if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animations, 0))
        motion::SetSystemReducedMotion(animations == FALSE);
}

std::optional<std::chrono::sys_days> HeroDate(const std::string& value) {
    if (value.size() != 10 || value[4] != '-' || value[7] != '-') return std::nullopt;
    try {
        using namespace std::chrono;
        const year_month_day date{year(std::stoi(value.substr(0, 4))),
                                  month(static_cast<unsigned>(std::stoi(value.substr(5, 2)))),
                                  day(static_cast<unsigned>(std::stoi(value.substr(8, 2))))};
        if (date.ok()) return sys_days(date);
    } catch (const std::exception&) {}
    return std::nullopt;
}

void ApplyHeroEvent(ui::HeroData& hero, const nlohmann::json& events, const std::string& today,
                    const catalog::MediaItem* item) {
    if (!events.contains("events") || !events["events"].is_array()) return;
    for (const auto& event : events["events"]) {
        if (!event.is_object() || event.value("imdbId", std::string{}) != hero.itemId ||
            !content::EventLive(event, today)) continue;
        hero.eventKicker = "In cinemas now";
        const auto date = HeroDate(today);
        const auto release = HeroDate(event.value("release", std::string{}));
        if (date && release && *release > *date) {
            const auto days = (*release - *date).count();
            hero.eventKicker = "In cinemas in " + std::to_string(days) + (days == 1 ? " day" : " days");
        }
        const auto glow = event.value("glow", std::string{});
        if (glow.size() == 7 && glow.front() == '#') {
            try { hero.glow = ui::Rgb(static_cast<std::uint32_t>(std::stoul(glow.substr(1), nullptr, 16))); }
            catch (const std::exception&) {}
        }
        hero.effect = ui::ParseHeroEffect(event.value("effect", std::string{}));
        hero.meta = item ? HeroMetaLine(*item) : release ? std::to_string(static_cast<int>(std::chrono::year_month_day(*release).year())) : "";
        const auto rail = event.find("rail");
        if (rail != event.end() && rail->is_object() && rail->contains("items") && (*rail)["items"].is_array()) {
            if (!hero.meta.empty()) hero.meta += " · ";
            const auto count = (*rail)["items"].size();
            hero.meta += std::to_string(count) + (count == 1 ? " film" : " films");
        }
        return;
    }
}

// What the Live TV playlist screen says about the playlist it was given. The copy follows the web screen.
constexpr char kInvalidPlaylistMessage[] =
    "That is not a usable M3U or M3U8 playlist. Paste an http(s) URL, a single .m3u8 stream, or the playlist text itself.";
constexpr char kUnreachablePlaylistMessage[] = "TVM could not fetch that playlist. Check the address and the network.";
constexpr char kRemovedPlaylistMessage[] = "Playlist removed.";
constexpr char kNotStoredPlaylistMessage[] = "The playlist was not stored.";
constexpr char kNotRemovedPlaylistMessage[] = "The playlist was not removed.";

// Shows what a catalogue read says about the saved playlist. The address field follows the saved
// address, as the web screen does, unless the playlist is pasted text.
void ShowPlaylist(ui::LivePlaylistView& view, const live::Catalog& catalog) {
    view.loaded = true;
    view.playlistUrl = catalog.playlistUrl;
    view.channels = catalog.channels.size();
    if (catalog.playlistUrl.has_value() && *catalog.playlistUrl != live::kPastedPlaylist) {
        view.addressField = *catalog.playlistUrl;
    }
}

}  // namespace

void PrepareMpv(coreapi::Client& client) {
    if (!mpv::FindMpvExecutable(util::ProcessEnvironment())) {
        try { client.Call("/api/desktop/mpv", "POST", nlohmann::json::object()); }
        catch (...) { /* FinishResolve retains the manual setup option. */ }
    }
}

App::App(HINSTANCE instance, const AppOptions& options) : instance_(instance) {
    // Measure in device pixels, so text and cards stay sharp on scaled displays.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    QueryPerformanceFrequency(&frequency_);
    QueryPerformanceCounter(&start_);

    // The preferences are read before the window exists, so the first frame
    // already uses the viewer's motion setting.
    dataDir_ = paths::fs::path(options.dataDir);
    store_ = std::make_unique<ui::FilePreferenceStore>(options.dataDir);
    core_ = std::make_unique<coreapi::Client>(dataDir_, config::ResolvePort(util::ProcessEnvironment()));
    catalog_ = std::make_unique<catalog::CatalogService>(paths::fs::path(options.dataDir));
    xtream_ = std::make_unique<xtream::Client>(xtream::ClientOptions{dataDir_});
    content_ = std::make_unique<content::Store>(dataDir_);
    releaseNotice_ = std::make_unique<content::ReleaseNotice>(config::kCoreVersion, util::ReadTextFile(dataDir_ / "last-seen-version").value_or(""));
    parental_ = content_->Read("parental");
    RefreshProfilePolicy();
    LoadAudio();
    hintsSeen_ = std::filesystem::exists(dataDir_ / "player-hints-seen");
    artwork_ = std::make_unique<ArtworkStore>(paths::ArtworkCacheDir(paths::fs::path(options.dataDir)));
    images_ = std::make_unique<ImageCache>(graphics_);
    // A picture is read on a worker, and its pixels come back to the window thread, which makes the bitmap.
    images_->SetRequest([this](const std::wstring& file) {
        background_->Run([this, file] {
            auto picture = std::make_shared<DecodedPicture>();
            try {
                *picture = DecodePicture(graphics_, file);
            } catch (...) {
                // Delivered as a failure below, so the request is never left waiting.
            }
            background_->PostToUi([this, file, picture] {
                const bool decoded = picture->ok;
                images_->Deliver(file, std::move(*picture));
                if (!decoded) HandleUndecodable(file);
                dirty_ = true;
            });
        });
    });
    overlayImages_ = std::make_unique<ImageCache>(graphics_);
    overlayImages_->SetRequest([this](const std::wstring& file) {
        background_->Run([this, file] {
            auto picture = std::make_shared<DecodedPicture>(DecodePicture(graphics_, file));
            background_->PostToUi([this, file, picture] {
                overlayImages_->Deliver(file, std::move(*picture));
                dirty_ = true;
            });
        });
    });
    // Home starts empty and fills in when the catalogue answers.
    auto home = std::make_unique<ui::Scene>(std::vector<ui::RailSpec>{}, store_->Motion());
    home_ = home.get();
    // The glass navigation bar settles in once, the first time Home is seen after the opening sting.
    home_->PlayChromeEntrance();
    // The hero's picture crossfades in once its file has been fetched.
    home_->SetImageReady([this](const std::string& url) { return artwork_->Lookup(url).has_value(); });
    shell_ = std::make_unique<ui::Shell>(std::move(home), *store_);
    // Home wears the stream chrome from its first frame, while the catalogue loads.
    BuildBrowse(*home_, true);
    shell_->SetNavigationGuard([this](const ui::Command& command) {
        if (releaseNotice_ && releaseNotice_->Visible()) DismissReleaseNotice(NowMs() + (command.name == "changelog" ? 1200 : 0));
        if (kidsProfile_ && (command.name == "settings" || command.name == "account" || command.name == "developer" || command.name == "downloads")) return false;
        if (command.name == "live-tv" || command.name == "live-playlist" || command.name == "live-xtream") return true;
        const auto freeId = command.params.find("id");
        if (command.name == "player" && freeId != command.params.end() && freeId->second.rfind("live:free:", 0) == 0) return true;
        if (command.action && command.name.rfind("player-", 0) == 0 && playerId_.rfind("live:free:", 0) == 0) return true;
        if (command.action) {
            if (command.name == "back" || command.name == "stream-home") return true;
            if (command.name.rfind("updates-", 0) == 0) return true;
            if (command.name.rfind("account-", 0) == 0 || command.name == "plans-choose") return true;
            if (command.name.rfind("info:", 0) == 0) return coreapi::AllowsRoute(account_, pageName_);
            return account_.usable;
        }
        if (coreapi::AllowsRoute(account_, command.name)) return true;
        accountMessage_ = account_.usable ? "This screen is not available on your current plan." : "Sign in with an active account to continue.";
        accountMessageError_ = false;
        ui::Command door; door.name = "account";
        shell_->Execute(door, NowMs());
        return false;
    });
    shell_->SetActionHandler([this](const ui::Command& command) {
        const auto id = command.params.find("id");
        if (command.name == "watchlist" && id != command.params.end()) {
            ToggleWatchlist(id->second);
        } else if (command.name == "trailer-open" && id != command.params.end()) {
            const auto title = titles_.find(id->second);
            if (title != titles_.end()) OpenTrailer(title->second.trailerUrl, title->second.title);
        } else if (command.name == "event-rail") {
            for (const auto& rail : eventRails_) if (!rail.cards.empty()) { home_->FocusTitle(rail.cards.front().itemId, NowMs()); break; }
            dirty_ = true;
        } else if (command.name == "realdebrid-paste") {
            SaveRealDebridToken();
        } else if (command.name == "realdebrid-disconnect") {
            ClearRealDebridToken();
        } else if (command.name == "xtream-paste-server") {
            PasteXtreamField(XtreamField::Server);
        } else if (command.name == "xtream-paste-username") {
            PasteXtreamField(XtreamField::Username);
        } else if (command.name == "xtream-paste-password") {
            PasteXtreamField(XtreamField::Password);
        } else if (command.name == "xtream-save") {
            SaveXtream();
        } else if (command.name == "xtream-disconnect") {
            ForgetXtream();
        } else if (command.name == "show-guide") {
            guideVisible_ = true;
            guideRetryAt_ = 0;
            dirty_ = true;
        } else if (command.name == "live-toggle-pick" && id != command.params.end()) {
            ToggleLivePick(id->second);
        } else if (command.name == "live-choose") {
            SetLiveChoosing(true);
        } else if (command.name == "live-watch") {
            SetLiveChoosing(false);
        } else if (command.name == "live-reload") {
            RefreshLiveTv();
        } else if (command.name == "live-playlist-paste-address") {
            PasteLivePlaylistAddress();
        } else if (command.name == "live-playlist-paste-text") {
            PasteLivePlaylistText();
        } else if (command.name == "live-playlist-save") {
            SaveLivePlaylist();
        } else if (command.name == "live-playlist-clear") {
            ClearLivePlaylist();
        } else if (command.name.rfind("player-", 0) == 0) {
            ApplyPlayerAction(command);
        } else if (command.name == "stream-lane") {
            const auto lane = command.params.find("lane");
            if (lane != command.params.end()) SetStreamLane(lane->second);
        } else if (command.name == "stream-tab") {
            const auto lane = command.params.find("lane");
            if (lane != command.params.end()) OpenStreamTab(lane->second);
        } else if (command.name == "search-submit") {
            if (searchPending_ || !searchQuery_.empty()) RunSearch();
        } else if (command.name == "search-browse") {
            // A Browse tile opens its genre; the back chip (no genre) returns to Browse.
            const auto genre = command.params.find("genre");
            browseGenre_ = genre == command.params.end() ? std::string() : genre->second;
            ++searchResultsGeneration_;
            ApplySearch();
        } else if (command.name == "search-filter") {
            const auto kind = command.params.find("kind");
            if (kind != command.params.end()) searchFilter_ = kind->second;
            ApplySearch();
        } else if (command.name == "search-recent") {
            const auto query = command.params.find("query");
            if (query != command.params.end()) {
                searchQuery_ = query->second;
                RunSearch();
            }
        } else if (command.name == "search-clear") {
            ++searchGeneration_;
            searchQuery_.clear();
            searchResults_.clear();
            searchPending_ = false;
            searchFailed_ = false;
            searchStatus_.clear();
            ApplySearch();
        } else if (command.name == "stream-home") {
            shell_->PopToRoot(NowMs());
        } else if (command.name == "back") {
            shell_->Back(NowMs());
        } else if (command.name == "imdb-open") {
            const auto play = playback::ParsePlayId(id == command.params.end() ? "" : id->second);
            if (play) ShellExecuteW(window_, L"open", util::ToWide("https://www.imdb.com/title/" + play->imdb + "/").c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        } else if (command.name == "service-watch") {
            const auto title = command.params.find("title");
            if (id != command.params.end()) LaunchService(id->second, false, title == command.params.end() ? "" : title->second);
        } else if (command.name == "watchlist-filter") {
            const auto value = command.params.find("value");
            if (value != command.params.end()) watchlistFilter_ = value->second;
            BuildWatchlistPage();
        } else if (command.name == "watchlist-sort") {
            // Each press moves to the next order, as the web's Sort by button cycles.
            static const std::vector<std::string> kSorts = {"saved", "title", "year", "rating"};
            const auto at = std::find(kSorts.begin(), kSorts.end(), watchlistSort_);
            watchlistSort_ = at == kSorts.end() || at + 1 == kSorts.end() ? kSorts.front() : *(at + 1);
            BuildWatchlistPage();
        } else if (command.name.rfind("profile-", 0) == 0) {
            ApplyProfileAction(command);
        } else if (command.name.rfind("account-", 0) == 0) {
            HandleAccountCommand(command);
        } else if (command.name == "plans-choose") {
            ChoosePlan(command);
        } else if (command.name.rfind("info:", 0) == 0) {
            ApplyInfoAction(command);
        } else if (command.name == "updates-check") {
            CheckForUpdates();
        } else if (command.name == "updates-download") {
            InstallNativeUpdate();
        } else if (command.name == "updates-auto") {
            prefs::CorePrefsPatch patch;
            patch.autoUpdate = !store_->CorePrefs().autoUpdate;
            store_->SaveCorePrefs(patch);
            updatesView_.autoUpdate = store_->CorePrefs().autoUpdate;
            updatesView_.message = updatesView_.autoUpdate ? "Automatic updates on." : "Automatic updates off.";
            ShowUpdates();
        } else if (command.name == "dev-refresh-cache") {
            titles_.clear();
            hubs_.clear();
            background_->Run([this] {
                try { core_->Call("/api/maintenance/clear-cache", "POST"); }
                catch (...) {}
                background_->PostToUi([this] {
                    LoadCatalog();
                    if (account_.usable) RefreshRdStatus();
                    RebuildHome();
                    dirty_ = true;
                });
            });
        }
    });

    WNDCLASSEXW cls{};
    cls.cbSize = sizeof(cls);
    cls.style = CS_HREDRAW | CS_VREDRAW;
    cls.lpfnWndProc = &App::WindowProc;
    cls.hInstance = instance_;
    cls.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    // Resource 1 is tvm.ico (src/tvm.rc.in). Builds without it fall back to the default icon.
    cls.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(1));
    cls.hIconSm = static_cast<HICON>(LoadImageW(instance_, MAKEINTRESOURCEW(1), IMAGE_ICON,
                                                GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0));
    cls.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&cls)) throw std::runtime_error("RegisterClassExW failed");

    RECT frame{0, 0, static_cast<LONG>(options.width), static_cast<LONG>(options.height)};
    AdjustWindowRect(&frame, WS_OVERLAPPEDWINDOW, FALSE);
    window_ = CreateWindowExW(0, kWindowClass, kTitle, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              frame.right - frame.left, frame.bottom - frame.top, nullptr, nullptr, instance_,
                              this);
    if (window_ == nullptr) throw std::runtime_error("CreateWindowExW failed");

    // Made with the window, so worker results can be posted to it.
    background_ = std::make_unique<Background>(window_, kWorkers);

    overlay_ = std::make_unique<OverlayWindow>(instance_, window_);
    MpvPlayer::Events events;
    events.state = [this](const mpv::State& state) { OnPlayerState(state); };
    events.error = [this](const std::string& message) { OnPlayerError(message); };
    events.ended = [this] {
        // The title played to its end: it counts as watched, and the player closes, as Player.tsx does.
        if (!playerOpen_) return;
        // An episode with a next one goes straight on to it, as Next Up does when its time runs out.
        if (nextEpisode_.has_value() && !nextDismissed_ && !playerLive_ && !sleepAtEnd_ && playerPrefs_.autoplay) {
            playerView_.position = playerView_.duration;
            SavePlayerProgress(true);
            PlayNextEpisode();
            return;
        }
        if (playerLive_) {
            ShowPlayerError("Playback stopped", "This channel stopped broadcasting. Try it again, or choose another channel.");
            return;
        }
        playerView_.position = playerView_.duration;
        SavePlayerProgress(true);
        shell_->Back(NowMs());
        dirty_ = true;
    };
    mpv_ = std::make_unique<MpvPlayer>(
        instance_, window_, [this](std::function<void()> work) { background_->PostToUi(std::move(work)); },
        std::move(events));

    // The launch reveal, as the Android app builds its logo. It holds on the finished logo until the app is ready.
    intro_ = std::make_unique<ui::LogoReveal>(store_->Motion());
    intro_->SetPending(true);
    // TVM Stream's sting. It plays the first time that screen opens, and holds for nothing.
    streamIntro_ = std::make_unique<ui::Intro>(store_->Motion(), ui::Intro::Form::Stream);
    shell_->SetOpenHandler([this](const std::string& name) {
        if (name == "tvm-stream") streamIntro_->Start(NowMs());
    });
    // Three starts in a minute that never closed cleanly open safe mode over Home.
    if (CrashLooping()) {
        ui::Command recovery;
        recovery.name = "recovery";
        shell_->Execute(recovery, NowMs());
    }
}

App::~App() {
    MarkCleanExit();
    // mpv is closed while its window still exists, and its last answers are dropped.
    if (mpv_) mpv_->Stop();
    // The trickplay thumbnails were for this run only.
    std::error_code ignored;
    std::filesystem::remove_all(std::filesystem::temp_directory_path(ignored) / "tvm-trickplay" /
                                    std::to_string(GetCurrentProcessId()),
                                ignored);
    overlay_.reset();
    if (window_ != nullptr) DestroyWindow(window_);
    UnregisterClassW(kWindowClass, instance_);
}

double App::NowMs() const {
    LARGE_INTEGER now{};
    QueryPerformanceCounter(&now);
    return static_cast<double>(now.QuadPart - start_.QuadPart) * 1000.0 / static_cast<double>(frequency_.QuadPart);
}

int App::Run(int showCommand) {
    RefreshSystemMotion();
    VideoTexture preview(core_->origin());
    ShowWindow(window_, showCommand);
    UpdateWindow(window_);
    Resize();
    intro_->Start(NowMs());
    RefreshContent();
    LoadCatalog();
    RefreshAccount();
    if (store_->CorePrefs().autoUpdate) CheckForUpdates();

    // Waits between frames are timed to the millisecond rather than the default ~15.6 ms system tick, so an
    // animation that has to wait for its next frame does not overshoot it by a whole tick.
    timeBeginPeriod(1);
    struct TimerPeriod {
        ~TimerPeriod() { timeEndPeriod(1); }
    } period;
    // TVM_FRAME_LOG=1 writes frame-time statistics while anything animates, to frame-times.log in the data folder.
    const bool frameLog = util::ProcessEnvironment()(L"TVM_FRAME_LOG").has_value();
    std::vector<double> frameGaps;
    double lastFrameMs = 0.0;
    double frameLogSinceMs = NowMs();

    bool running = true;
    while (running) {
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            if (message.message == WM_QUIT) {
                running = false;
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if (!running) break;

        // A select may have opened a title, so its details are requested here.
        // A select may have opened a title, so its details are requested here.
        SyncDetails();
        SyncRealDebrid();
        SyncXtream();
        SyncLiveTv();
        SyncLivePlaylist();
        SyncStream();
        SyncSearch();
        SyncPages();
        SyncPlayer();
        UpdateLiveBehind();
        const double now = NowMs();
        TickPlaybackTools(now);
        TickGuide(now);
        const bool homeShown = shell_->ActiveScreenName() == "home" && streamLane_ == "all";
        if ((homeShown && !rdHomeShown_) || extras::RdRefreshDue(account_.usable, rdStatus_.configured, rdStatusChecking_, now, rdCheckedMs_)) {
            RefreshAccount();
            RefreshRdStatus();
        }
        rdHomeShown_ = homeShown;
        const bool onAccountScreen = shell_->ActiveScreenName() == "account";
        const bool waitingAutoRecheck = onAccountScreen && account_.signedIn && !account_.usable && account_.reason == "awaiting_activation";
        if (!accountBusy_ &&
            ((waitingAutoRecheck && now - accountCheckedMs_ > 60000.0) ||
             (!onAccountScreen && now - accountCheckedMs_ > 30000.0) ||
             (onAccountScreen && account_.usable && now - accountCheckedMs_ > 30000.0))) {
            RefreshAccount();
        }
        if (usageTickMs_ > 0 && playerOpen_ && playerView_.started && !playerView_.paused && !playerView_.buffering && playerView_.phase == ui::PlayerView::Phase::Playing && !playerLive_) usageSeconds_ += std::clamp((now - usageTickMs_) / 1000.0, 0.0, 2.0);
        usageTickMs_ = now;
        if (usageSeconds_ >= 10 && account_.usable) {
            const double seconds = usageSeconds_; usageSeconds_ = 0;
            background_->Run([this, seconds] {
                try {
                    const auto plan = core_->Call("/api/usage/tick", "POST", {{"seconds", seconds}, {"billable", true}});
                    if (plan.contains("weeklyRemainingSeconds") && plan["weeklyRemainingSeconds"].is_number() && plan["weeklyRemainingSeconds"].get<double>() <= 0)
                        background_->PostToUi([this] { if (playerOpen_) ShowPlayerError("Viewing allowance reached", "Your viewing allowance has been reached. Review your plan or try again after it resets."); });
                } catch (...) {}
            });
        }
        TurnHero(now);
        const bool showingHome = shell_->ActiveScreenName() == "home" && streamLane_ == "all" &&
                                 IsWindowVisible(window_) && !IsIconic(window_) && !playerOpen_ &&
                                 !intro_->Covers() && !streamIntro_->Covers();
        const bool supportedMotion = !motion::PrefersReducedMotion(store_->Motion());
        home_->SetSpotlightRunning(showingHome);
        const std::string clipId = streamLane_ == "all" ? catalog::ImdbIdFrom(home_->HeroClipId()) : "";
        const bool wasPlaying = home_->HeroClipPlaying();
        preview.Update(clipId, showingHome && home_->HeroOnscreen() && supportedMotion, home_->HeroMuted());
        home_->SetHeroClip(preview.Ready(), preview.HasAudio(), now);
        dirty_ = dirty_ || wasPlaying != home_->HeroClipPlaying();
        SyncReleaseNotice(now);
        if (now - updatesCheckedMs_ >= 21600000.0 && store_->CorePrefs().autoUpdate) CheckForUpdates();
        PageRails();
        if (now - contentCheckedMs_ >= 21600000.0 || contentDate_ != content::LocalDate()) RefreshContent();
        SyncArtwork(now);
        if (const std::optional<nav::Direction> hop = hops_.Tick()) {
            shell_->Navigate(*hop, now);
            dirty_ = true;
        }
        if (chooserCloseAtMs_.has_value() && now >= *chooserCloseAtMs_) {
            chooserCloseAtMs_.reset();
            if (shell_->ActiveScreenName() == "chooser") shell_->Back(now);
            dirty_ = true;
        }
        MaybePromptRealDebrid();
        intro_->Tick(now);
        streamIntro_->Tick(now);
        // Pictures still being read keep the frames coming, so each one appears as soon as it is ready.
        const bool animating = shell_->Tick(now) || intro_->Animating() || streamIntro_->Animating() || images_->Busy();
        const double frameStartMs = NowMs();
        if (dirty_ || animating) {
            Render();
            dirty_ = false;
            if (frameLog) {
                if (lastFrameMs > 0.0 && animating) frameGaps.push_back(frameStartMs - lastFrameMs);
                lastFrameMs = animating ? frameStartMs : 0.0;
                if (frameStartMs - frameLogSinceMs > 5000.0 && frameGaps.size() > 30) {
                    WriteFrameLog(frameGaps);
                    frameGaps.clear();
                    frameLogSinceMs = frameStartMs;
                }
            }
        }

        if (animating) {
            // The window's Present waits for the display's vertical blank, so a drawn frame already lasts one refresh;
            // sleeping a whole frame on top of it would halve the rate. Only the part of a frame not yet used is
            // waited for (as when the frame was not presented), and input still wakes the loop at once.
            const double used = NowMs() - frameStartMs;
            const double rest = std::max(0.0, static_cast<double>(kFrameMs) - used);
            MsgWaitForMultipleObjects(0, nullptr, FALSE, static_cast<DWORD>(rest), QS_ALLINPUT);
        } else {
            // Nothing is moving. The wait ends early for whatever is due next: the hero's turn, or a picture retry.
            double due = 1000.0;
            if (home_->HeroCount() > 1) due = std::max(0.0, lastHeroTurnMs_ + kHeroTurnMs - now);
            if (artworkRetryDueMs_ > 0.0) due = std::min(due, std::max(0.0, artworkRetryDueMs_ - now));
            // A search waits for a short pause in typing; the loop wakes when the pause is over.
            if (searchPending_) due = std::min(due, std::max(0.0, searchTypedMs_ + kSearchDebounceMs - now));
            due = videoClicks_.Wait(now, due);
            MsgWaitForMultipleObjects(0, nullptr, FALSE, static_cast<DWORD>(std::ceil(due)), QS_ALLINPUT);
        }
    }
    return 0;
}

LRESULT CALLBACK App::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    App* self = nullptr;
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        self = static_cast<App*>(create->lpCreateParams);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        self->window_ = window;
    } else {
        self = reinterpret_cast<App*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    }
    if (self != nullptr) return self->HandleMessage(message, wParam, lParam);
    return DefWindowProcW(window, message, wParam, lParam);
}

LRESULT App::HandleMessage(UINT message, WPARAM wParam, LPARAM lParam) {
    if (shell_ && shell_->HasPatchNotes()) {
        // The patch notes pop-up takes every key and click until it is closed.
        if (message == WM_KEYDOWN) {
            if (wParam == VK_RETURN || wParam == VK_SPACE || wParam == VK_ESCAPE || wParam == VK_BROWSER_BACK) { DismissReleaseNotice(NowMs() + 1200); }
            return 0;
        }
        if (message == WM_LBUTTONUP) {
            const POINT point = ClientPoint(lParam);
            const ui::Box button = shell_->PatchButtonBox();
            if (point.x >= button.x && point.x < button.Right() && point.y >= button.y && point.y < button.Bottom()) DismissReleaseNotice(NowMs() + 1200);
            return 0;
        }
        if (message == WM_XBUTTONUP) { DismissReleaseNotice(NowMs() + 1200); return TRUE; }
        if (message == WM_CHAR || message == WM_LBUTTONDOWN || message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL ||
            message == WM_RBUTTONDOWN || message == WM_RBUTTONUP || message == WM_XBUTTONDOWN || message == WM_MOUSEMOVE) return 0;
    }
    if (shell_ && releaseNotice_ && !shell_->HasPatchNotes()) {
        bool input = message == WM_KEYDOWN || message == WM_CHAR || message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL ||
                     message == WM_SETFOCUS || message == WM_KILLFOCUS || message == WM_SIZE || message == WM_POINTERDOWN ||
                     message == WM_XBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN;
        if (message == WM_MOUSEMOVE || message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) {
            const double rem = ui::ViewportRem(home_->metrics().rem * 120.0, home_->ViewportHeight());
            RECT client{}; GetClientRect(window_, &client);
            const double cardWidth = std::min(static_cast<double>(client.right) - 3 * rem, 31 * rem);
            const POINT point = ClientPoint(lParam);
            const bool inCard = releaseNotice_->Visible() && point.x >= client.right - cardWidth - 1.5 * rem && point.y >= client.bottom - 28.5 * rem;
            input = !inCard;
        }
        if (input) DismissReleaseNotice(NowMs());
    }
    switch (message) {
    case WM_XBUTTONUP:
        if (GET_XBUTTON_WPARAM(wParam) == XBUTTON1) { shell_->Back(NowMs()); dirty_ = true; return TRUE; }
        break;
    case WM_APPCOMMAND:
        if (GET_APPCOMMAND_LPARAM(lParam) == APPCOMMAND_BROWSER_BACKWARD) { shell_->Back(NowMs()); dirty_ = true; return TRUE; }
        break;
    case WM_DPICHANGED: {
        RECT bounds = *reinterpret_cast<const RECT*>(lParam);
        MONITORINFO monitor{sizeof(MONITORINFO)};
        if (fullscreen_ && GetMonitorInfoW(MonitorFromRect(&bounds, MONITOR_DEFAULTTONEAREST), &monitor))
            bounds = monitor.rcMonitor;
        const RECT* suggested = &bounds;
        SetWindowPos(window_, nullptr, suggested->left, suggested->top,
                     suggested->right - suggested->left, suggested->bottom - suggested->top,
                     SWP_NOACTIVATE | SWP_NOZORDER);
        if (overlay_) overlay_->ResetZOrder();
        dirty_ = true;
        return 0;
    }
    case WM_MOVE:
        // The player's chrome is a window of its own, so it follows this one.
        if (overlay_ && overlay_->Visible()) overlay_->ResetZOrder();
        dirty_ = true;
        return 0;
    case WM_DISPLAYCHANGE: {
        MONITORINFO monitor{sizeof(MONITORINFO)};
        if (fullscreen_ && GetMonitorInfoW(MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST), &monitor)) {
            const RECT& area = monitor.rcMonitor;
            SetWindowPos(window_, HWND_TOP, area.left, area.top, area.right - area.left, area.bottom - area.top,
                         SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        }
        if (overlay_) { overlay_->ResetZOrder(); dirty_ = true; }
        break;
    }
    case WM_MOUSELEAVE:
        trackingLeave_ = false;
        // The next move is a real one, whatever point it lands on.
        lastMouse_ = POINT{-1, -1};
        if (shell_) shell_->MouseLeave(NowMs());
        dirty_ = true;
        return 0;
    case WM_ACTIVATE:
        // Switching to another window ends any hover: the pointer is no longer ours to track.
        if (LOWORD(wParam) == WA_INACTIVE && shell_) {
            shell_->MouseLeave(NowMs());
            videoPressed_ = false;
            videoClicks_.Cancel();
            dirty_ = true;
            if (overlay_) overlay_->SetForeground(false);
        } else if (shell_) {
            RefreshAccount();
            RefreshRdStatus();
            dirty_ = true;
        }
        break;
    case WM_SETTINGCHANGE:
        RefreshSystemMotion();
        dirty_ = true;
        break;
    case WM_SIZE:
        if (mpv_ && mpv_->Active()) {
            if (wParam == SIZE_MINIMIZED && playerPrefs_.Enabled("pauseOnMinimize") && !playerView_.paused) {
                minimizePaused_ = true;
                mpv_->SetPaused(true);
            } else if (wParam != SIZE_MINIMIZED && minimizePaused_) {
                minimizePaused_ = false;
                if (!sleepDeadline_ || NowMs() < *sleepDeadline_) mpv_->SetPaused(false);
            }
        }
        Resize();
        if (mpv_) mpv_->Resize();
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        BeginPaint(window_, &paint);
        EndPaint(window_, &paint);
        dirty_ = true;
        return 0;
    }
    case WM_ERASEBKGND:
        // The screens paint the whole window, so the system background is not needed.
        return 1;
    case WM_KEYDOWN:
        if (HandleKey(wParam, lParam)) return 0;
        break;
    case WM_CHAR:
        if (GuideActive()) {
            if (guideSearch_ && wParam >= 32 && wParam != 127) {
                guide_.Search(guide_.query() + util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
                dirty_ = true;
            }
            return 0;
        }
        if (auto* editor = dynamic_cast<ui::ProfileEditor*>(&shell_->ActiveScreen()); editor && editor->Typing() && wParam >= 0x20 && wParam != 0x7F) {
            editor->Type(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            dirty_ = true;
            return 0;
        }
        // Letters typed on the search page go into the query. Control characters are keys, handled above.
        if (SearchTyping() && wParam >= 0x20 && wParam != 0x7F &&
            (wParam < 0xD800 || wParam > 0xDFFF)) {
            TypeSearch(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            return 0;
        }
        // A profile's name in the chooser's sheet.
        if (auto* chooser = dynamic_cast<ui::ProfileChooser*>(&shell_->ActiveScreen());
            chooser != nullptr && chooser->SheetOpen() && wParam >= 0x20 && wParam != 0x7F &&
            (wParam < 0xD800 || wParam > 0xDFFF)) {
            chooser->Type(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            dirty_ = true;
            return 0;
        }
        // The new profile's name is typed the same way, while its field is open.
        if (auto* profiles = dynamic_cast<ui::ProfilesScreen*>(&shell_->ActiveScreen());
            profiles != nullptr && profiles->Creating() && wParam >= 0x20 && wParam != 0x7F &&
            (wParam < 0xD800 || wParam > 0xDFFF)) {
            profiles->Type(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            dirty_ = true;
            return 0;
        }
        if (ui::AccountScreen* accountScreen = ActiveAccountScreen();
            accountScreen != nullptr && accountScreen->IsEditing() && wParam >= 0x20 && wParam != 0x7F &&
            (wParam < 0xD800 || wParam > 0xDFFF)) {
            accountScreen->Type(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            dirty_ = true;
            return 0;
        }
        // And into an info page's field, such as Setup's token.
        if (ui::InfoScreen* page = TypingPage(); page != nullptr && wParam >= 0x20 && wParam != 0x7F &&
                                                 (wParam < 0xD800 || wParam > 0xDFFF)) {
            page->Type(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
            TypedIntoPage(*page);
            return 0;
        }
        break;
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
        // A handled sideways wheel answers TRUE: several touchpad and mouse drivers stop sending WM_MOUSEHWHEEL to a
        // window that answers 0, which left the rails moving one notch and then no further.
        if (!FromTouchOrPen() && HandleMouse(message, wParam, lParam)) return message == WM_MOUSEHWHEEL ? TRUE : 0;
        break;
    case WM_CAPTURECHANGED:
        // Another window took the mouse mid-drag (Alt+Tab, a dialog): the volume drag ends where it was.
        if (volumeDragging_ && reinterpret_cast<HWND>(lParam) != window_) {
            volumeDragging_ = false;
            if (ui::PlayerScreen* player = shell_->ActivePlayer()) player->SetVolumeDragging(false);
            SaveAudio();
            dirty_ = true;
        }
        break;
    case WM_POINTERDOWN:
    case WM_POINTERUPDATE:
    case WM_POINTERUP:
    case WM_POINTERCAPTURECHANGED:
        if (HandlePointer(message, wParam)) return 0;
        break;
    case WM_SETCURSOR:
        // The cursor stays hidden until the mouse moves, so the ten-foot view is clean.
        // Over the playing picture the cursor goes with the chrome, as the web player hides it.
        if (ui::PlayerScreen* player = shell_->ActivePlayer();
            LOWORD(lParam) == HTCLIENT && player != nullptr && player->OverVideo() && player->ChromeHidden(NowMs())) {
            SetCursor(nullptr);
            return TRUE;
        }
        if (LOWORD(lParam) == HTCLIENT && !shell_->CursorVisible()) {
            SetCursor(nullptr);
            return TRUE;
        }
        // Over the search field the pointer is a text cursor, as over any text box.
        if (LOWORD(lParam) == HTCLIENT && SearchScene() != nullptr) {
            POINT point{};
            GetCursorPos(&point);
            ScreenToClient(window_, &point);
            if (SearchScene()->ItemAt(point.x, point.y) == std::optional<std::string>("search-field")) {
                SetCursor(LoadCursorW(nullptr, IDC_IBEAM));
                return TRUE;
            }
        }
        break;
    case Background::kMessage:
        // A worker's result, applied on this thread.
        Background::RunPosted(lParam);
        dirty_ = true;
        return 0;
    case WM_DESTROY:
        window_ = nullptr;
        PostQuitMessage(0);
        return 0;
    default:
        break;
    }
    return DefWindowProcW(window_, message, wParam, lParam);
}

bool App::HandleKey(WPARAM virtualKey, LPARAM flags) {
    const double now = NowMs();
    // Any remote press hides the cursor, as it does in the web app.
    shell_->KeyPressed();
    if (ui::PlayerScreen* player = shell_->ActivePlayer()) { player->ShowChrome(now); dirty_ = true; }

    // While the open sting is on screen, OK, Enter, Escape and Space end it and do nothing else.
    if ((virtualKey == VK_RETURN || virtualKey == VK_ESCAPE || virtualKey == VK_SPACE) && SkipIntro()) return true;
    if (GuideActive() && HandleGuideKey(virtualKey)) return true;
    if (virtualKey == VK_BACK) {
        if (IsEditingText()) HandleSearchKey(virtualKey);
        else shell_->Back(now);
        dirty_ = true;
        return true;
    }
    if (HandlePlayerKey(virtualKey, flags)) return true;
    if (HandleSearchKey(virtualKey)) return true;
    if (ui::PlayerScreen* player = shell_->ActivePlayer()) player->ShowChrome(now);

    if (!IsEditingText() && !playerOpen_) {
        if ((virtualKey == 'K' && KeyDown(VK_CONTROL)) ||
            (virtualKey == VK_OEM_2 && !KeyDown(VK_CONTROL) && !KeyDown(VK_MENU) && !KeyDown(VK_SHIFT))) {
            if (account_.usable) {
                OpenStreamTab("search");
                home_->FocusItem("search-field", now, false);
                dirty_ = true;
            }
            return true;
        }
        if (virtualKey == VK_F5 || (virtualKey == 'R' && KeyDown(VK_CONTROL))) {
            LoadCatalog();
            RefreshAccount();
            if (account_.usable) RefreshRdStatus();
            dirty_ = true;
            return true;
        }
    }

    const nav::KeyInput key{static_cast<unsigned>(virtualKey), KeyDown(VK_CONTROL), KeyDown(VK_MENU),
                            KeyDown(VK_LWIN) || KeyDown(VK_RWIN)};
    const std::optional<nav::Intent> intent = nav::IntentFromKey(key);
    if (!intent.has_value()) return false;

    if (nav::IsDirectional(*intent)) {
        // Bit 30 of lParam is set when the key was already down: auto-repeat.
        const bool repeat = (flags & (1 << 30)) != 0;
        if (!nav::AcceptHeldHop(repeat, now, lastHopMs_)) return true;
        lastHopMs_ = now;
        hops_.Push(DirectionOf(*intent));
        return true;
    }

    if (*intent == nav::Intent::Select) {
        shell_->Select(now);
        dirty_ = true;
    } else if (*intent == nav::Intent::Back) {
        // Back in the chooser's sheet closes the sheet, not the chooser.
        if (auto* chooser = dynamic_cast<ui::ProfileChooser*>(&shell_->ActiveScreen()); chooser != nullptr && chooser->SheetOpen()) {
            if (const std::optional<ui::Command> command = chooser->ActivateItem("sheet-cancel", now)) shell_->Execute(*command, now);
            dirty_ = true;
            return true;
        }
        // Back at Home asks before closing TVM, rather than quitting on one press of Esc or the remote's Back.
        if (!shell_->Back(now)) ConfirmQuit();
        dirty_ = true;
    }
    return true;
}

void App::ConfirmQuit() {
    if (shell_->ActiveScreenName() == "confirm") return;
    ui::Command confirm;
    confirm.name = "confirm";
    confirm.modal = true;
    confirm.params = {{"title", "Quit TVM?"},
                      {"body", "TVM closes. Your profiles, My List and watch history stay on this PC."},
                      {"confirmLabel", "Quit"},
                      {"action", "shutdown"}};
    shell_->Execute(confirm, NowMs());
}

bool App::SkipIntro() {
    // The press goes to whichever sting is on screen. Otherwise it reaches the shell.
    if (intro_->Visible()) {
        intro_->Skip(NowMs());
        dirty_ = true;
        return true;
    }
    if (streamIntro_->Visible()) {
        streamIntro_->Skip(NowMs());
        dirty_ = true;
        return true;
    }
    return false;
}

POINT App::ClientPoint(LPARAM lParam) const {
    POINT point{SignedLow(lParam), SignedHigh(lParam)};
    return point;
}

bool App::HandleMouse(UINT message, WPARAM wParam, LPARAM lParam) {
    if (GuideActive()) return HandleGuideMouse(message, wParam, lParam);
    const double now = NowMs();
    ui::PlayerScreen* player = shell_->ActivePlayer();
    switch (message) {
    case WM_MOUSEMOVE: {
        const POINT point = ClientPoint(lParam);
        // Windows repeats a move whenever a window changes under a still cursor, and the overlay changes
        // every frame. Only a real move counts, or the player's chrome would never fade.
        if (point.x == lastMouse_.x && point.y == lastMouse_.y) return true;
        lastMouse_ = point;
        if (!trackingLeave_) {
            // Ask Windows to say when the pointer leaves the window, so a hovered control does not stay lit.
            TRACKMOUSEEVENT track{};
            track.cbSize = sizeof(track);
            track.dwFlags = TME_LEAVE;
            track.hwndTrack = window_;
            trackingLeave_ = TrackMouseEvent(&track) != FALSE;
        }
        if (player != nullptr) player->ShowChrome(now);
        if (HandleScrub(message, point)) return true;
        const bool buttonDown = (wParam & (MK_LBUTTON | MK_RBUTTON | MK_MBUTTON)) != 0;
        shell_->MouseMove(point.x, point.y, buttonDown, now);
        dirty_ = true;
        return true;
    }
    case WM_LBUTTONDOWN: {
        const POINT point = ClientPoint(lParam);
        if (player != nullptr) player->ShowChrome(now);
        if (HandleScrub(message, point)) return true;
        videoPressed_ = player && playerView_.started && !player->MenuOpen() && !player->ItemAt(point.x, point.y);
        if (videoPressed_) return true;
        videoClicks_.Cancel();
        shell_->MouseDown(point.x, point.y, now);
        dirty_ = true;
        return true;
    }
    case WM_LBUTTONUP: {
        // A click ends the open sting and goes no further.
        if (SkipIntro()) return true;
        const POINT point = ClientPoint(lParam);
        if (HandleScrub(message, point)) return true;
        if (std::exchange(videoPressed_, false) && player && !player->ItemAt(point.x, point.y)) {
            VideoClickAction(videoClicks_.Click(now, point.x, point.y, GetSystemMetrics(SM_CXDOUBLECLK) / 2,
                                               GetSystemMetrics(SM_CYDOUBLECLK) / 2));
            dirty_ = true;
            return true;
        }
        shell_->MouseUp(point.x, point.y, now);
        dirty_ = true;
        return true;
    }
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL: {
        // Over the playing picture the wheel sets the sound, 5% a notch, as VolumeControl's wheel does.
        if (player != nullptr && player->view().phase == ui::PlayerView::Phase::Playing) {
            player->ShowChrome(now);
            const double notches = static_cast<double>(GET_WHEEL_DELTA_WPARAM(wParam)) / kWheelUnitsPerNotch;
            // Over an open menu the wheel scrolls its rows instead of setting the sound.
            POINT over{SignedLow(lParam), SignedHigh(lParam)};
            ScreenToClient(window_, &over);
            if (const std::optional<ui::Box> menu = player->MenuBox();
                menu.has_value() && message == WM_MOUSEWHEEL && over.x >= menu->x && over.x <= menu->Right() &&
                over.y >= menu->y && over.y <= menu->Bottom()) {
                if (player->ScrollMenu(notches > 0.0 ? -1 : 1)) dirty_ = true;
                return true;
            }
            ChangeVolume(0.05 * notches);
            return true;
        }

        // Wheel coordinates are screen coordinates, and the shell wants the window's.
        POINT point{SignedLow(lParam), SignedHigh(lParam)};
        ScreenToClient(window_, &point);

        const double notches = static_cast<double>(GET_WHEEL_DELTA_WPARAM(wParam)) / kWheelUnitsPerNotch;
        const double pixels = notches * kWheelNotchPx;
        // Win32 reports positive for forward and right. The web convention is
        // positive for down and right, so the vertical sign flips.
        const bool vertical = message == WM_MOUSEWHEEL;
        const double deltaX = vertical ? 0.0 : pixels;
        const double deltaY = vertical ? -pixels : 0.0;
        // Ctrl, like Shift, turns the wheel sideways, so it scrolls along the rail under the cursor.
        const bool shift = (wParam & (MK_SHIFT | MK_CONTROL)) != 0;
        shell_->Wheel(point.x, point.y, deltaX, deltaY, shift, nav::WheelMode::Pixel, now);
        dirty_ = true;
        return true;
    }
    default:
        break;
    }
    return false;
}

bool App::HandlePointer(UINT message, WPARAM wParam) {
    const double now = NowMs();
    const UINT32 pointerId = GET_POINTERID_WPARAM(wParam);

    if (message == WM_POINTERCAPTURECHANGED) {
        shell_->TouchCancel();
        return false;
    }

    // Only touch is handled here. A pen acts as the mouse does, so it is left
    // to the mouse messages.
    POINTER_INPUT_TYPE type{};
    if (!GetPointerType(pointerId, &type) || type != PT_TOUCH) return false;

    POINTER_INFO info{};
    if (!GetPointerInfo(pointerId, &info)) return false;
    POINT point = info.ptPixelLocation;
    ScreenToClient(window_, &point);

    switch (message) {
    case WM_POINTERDOWN:
        shell_->TouchDown(pointerId, point.x, point.y, now);
        break;
    case WM_POINTERUPDATE:
        shell_->TouchMove(pointerId, point.x, point.y, now);
        break;
    case WM_POINTERUP:
        // A tap ends the open sting, as a click does, and the touch is cancelled so the screen below sees nothing.
        if (SkipIntro()) {
            shell_->TouchCancel();
            break;
        }
        shell_->TouchUp(pointerId, point.x, point.y, now);
        break;
    default:
        return false;
    }
    dirty_ = true;
    return true;
}

void App::Resize() {
    RECT client{};
    GetClientRect(window_, &client);
    const auto width = static_cast<UINT>(client.right - client.left);
    const auto height = static_cast<UINT>(client.bottom - client.top);
    if (width == 0 || height == 0) return;

    shell_->Layout(width, height);
    guide_.Layout(width, height);
    if (target_) {
        target_->Resize(D2D1::SizeU(width, height));
    }
    dirty_ = true;
}

void App::Render() {
    RECT client{};
    GetClientRect(window_, &client);
    const auto width = static_cast<UINT>(client.right - client.left);
    const auto height = static_cast<UINT>(client.bottom - client.top);
    if (width == 0 || height == 0) return;

    // Over the picture, the player is drawn in the overlay window. mpv's window covers this one, so it is not drawn.
    ui::PlayerScreen* player = shell_->ActivePlayer();
    if (player != nullptr && player->OverVideo() && mpv_->Active()) {
        SyncThumbnail();
        overlay_->Paint(graphics_, [&](ID2D1RenderTarget* target) {
            // Bitmaps belong to the target that made them, so a new overlay surface starts its cache again.
            if (target != overlayTarget_) {
                overlayImages_->Clear();
                overlayTarget_ = target;
            }
            overlayImages_->BeginFrame();
            D2dPainter painter(target, graphics_, artwork_.get(), overlayImages_.get());
            player->Paint(painter);
        });
        return;
    }

    if (!target_) target_ = graphics_.CreateHwndTarget(window_, width, height);

    images_->BeginFrame();
    target_->BeginDraw();
    if (!lens_) lens_ = std::make_unique<GlassLens>(target_.Get());
    D2dPainter painter(target_.Get(), graphics_, artwork_.get(), images_.get(), lens_.get());
    // A sting that covers the window hides the screen under it, so that screen is not drawn while it lasts.
    if (!intro_->Covers() && !streamIntro_->Covers()) {
        if (GuideActive()) guide_.Paint(painter, guideClock_);
        else shell_->Paint(painter);
    }
    intro_->Paint(painter, static_cast<double>(width), static_cast<double>(height));
    streamIntro_->Paint(painter, static_cast<double>(width), static_cast<double>(height));
    const HRESULT result = target_->EndDraw();
    if (result == D2DERR_RECREATE_TARGET) {
        // The device was lost. Rebuild the target and draw again next frame. The
        // bitmaps belong to the old target, so they are decoded again.
        if (auto* preview = VideoTexture::Current()) preview->ClearBitmap();
        lens_.reset();
        target_.Reset();
        images_->Clear();
        dirty_ = true;
    } else if (FAILED(result)) {
        throw std::runtime_error("Direct2D drawing failed");
    }
}

void App::LoadCatalog() {
    home_->SetStatus("Loading the catalogue...");
    background_->Run([this] {
        // Home is set once, with the genre rails in place. A second set would
        // move the focus back to the first card.
        catalog::CatalogBundle bundle;
        std::vector<catalog::GenreShelf> shelves;
        bool available = true;
        try {
            bundle = catalog_->Bundle();
            shelves = catalog::FetchGenreShelves(*catalog_);
        } catch (const std::exception&) {
            available = false;
        }
        background_->PostToUi([this, bundle = std::move(bundle), shelves = std::move(shelves), available] {
            catalogSettled_ = true;
            intro_->SetPending(!accountSettled_);
            if (!available) {
                home_->SetStatus("The catalogue is unavailable. Check the connection.");
            } else {
                bundle_ = bundle;
                shelves_ = shelves;
                catalogReady_ = true;
                home_->SetStatus("");
                RebuildHome();
            }
            dirty_ = true;
        });
    });
}

namespace {
// Pictures downloading at once. The rest wait their turn, so catalogue calls on the shared workers are not starved.
constexpr int kArtworkConcurrency = 4;
// A failed picture is tried again after these waits; after the last it keeps its placeholder for the session.
constexpr double kArtworkBackoffMs[] = {2000.0, 8000.0, 30000.0, 120000.0};
}  // namespace

void App::WriteFrameLog(std::vector<double> gaps) const {
    // Rolling frame statistics: the mean gap between animated frames, its frame rate, the 1% and 0.1% slowest
    // frames, and how many frames took longer than 25 ms (a visible hitch at 60 Hz).
    std::sort(gaps.begin(), gaps.end());
    double total = 0.0;
    for (double gap : gaps) total += gap;
    const double mean = total / static_cast<double>(gaps.size());
    const auto at = [&](double share) {
        const std::size_t index = std::min(gaps.size() - 1, static_cast<std::size_t>(share * static_cast<double>(gaps.size())));
        return gaps[index];
    };
    const std::size_t hitches = static_cast<std::size_t>(std::count_if(gaps.begin(), gaps.end(), [](double gap) { return gap > 25.0; }));
    char line[256];
    std::snprintf(line, sizeof(line), "%s frames=%zu mean=%.2fms fps=%.1f p99=%.2fms p99.9=%.2fms worst=%.2fms over25ms=%zu\n",
                  util::IsoTimestamp().c_str(), gaps.size(), mean, 1000.0 / mean, at(0.99), at(0.999), gaps.back(), hitches);
    try {
        const paths::fs::path path = dataDir_ / "frame-times.log";
        std::string text = util::ReadTextFile(path).value_or("");
        if (text.size() > 256 * 1024) text.erase(0, text.size() - 128 * 1024);
        util::WriteFileAtomically(path, text + line);
    } catch (...) {
        // A log is a convenience; failing to write it changes nothing on screen.
    }
}

void App::QueueArtwork(const std::string& url, bool onScreen) {
    if (url.empty() || artwork_->Lookup(url).has_value()) return;
    const auto tried = artworkTries_.find(url);
    if (tried != artworkTries_.end() && (tried->second.givenUp || NowMs() < tried->second.retryAtMs)) return;
    if (!queuedArtwork_.insert(url).second) {
        // Already waiting: a picture now on screen moves to the front of the queue.
        if (onScreen) {
            const auto waiting = std::find(artworkQueue_.begin(), artworkQueue_.end(), url);
            if (waiting != artworkQueue_.end() && waiting != artworkQueue_.begin()) {
                artworkQueue_.erase(waiting);
                artworkQueue_.push_front(url);
            }
        }
        return;
    }
    if (onScreen) {
        artworkQueue_.push_front(url);
    } else {
        artworkQueue_.push_back(url);
    }
    PumpArtwork();
}

void App::PumpArtwork() {
    while (artworkInFlight_ < kArtworkConcurrency && !artworkQueue_.empty()) {
        const std::string url = artworkQueue_.front();
        artworkQueue_.pop_front();
        // A picture that arrived while it waited needs no download.
        if (artwork_->Lookup(url).has_value()) {
            queuedArtwork_.erase(url);
            continue;
        }
        ++artworkInFlight_;
        background_->Run([this, url] {
            FetchResult result = FetchResult::Failed;
            try {
                result = artwork_->Fetch(url);
            } catch (...) {
                // Counted as a failure below, so the picture is retried rather than left queued for ever.
            }
            background_->PostToUi([this, url, result] {
                --artworkInFlight_;
                queuedArtwork_.erase(url);
                if (result == FetchResult::Stored) {
                    dirty_ = true;
                } else {
                    ArtworkTry& tried = artworkTries_[url];
                    if (result == FetchResult::Missing) {
                        tried.givenUp = true;
                    } else {
                        ++tried.failures;
                        constexpr int kTries = static_cast<int>(std::size(kArtworkBackoffMs));
                        if (tried.failures > kTries) {
                            tried.givenUp = true;
                        } else {
                            tried.retryAtMs = NowMs() + kArtworkBackoffMs[tried.failures - 1];
                            if (artworkRetryDueMs_ <= 0.0 || tried.retryAtMs < artworkRetryDueMs_) {
                                artworkRetryDueMs_ = tried.retryAtMs;
                            }
                        }
                    }
                }
                PumpArtwork();
            });
        });
    }
}

void App::SyncArtwork(double nowMs) {
    // Whatever was painted without its picture last frame is fetched, on-screen pictures first.
    for (const std::string& url : artwork_->TakeWanted()) QueueArtwork(url, true);
    // A retry has fallen due: draw a frame, so the cards still waiting ask for their pictures again.
    if (artworkRetryDueMs_ > 0.0 && nowMs >= artworkRetryDueMs_) {
        artworkRetryDueMs_ = 0.0;
        for (const auto& [url, tried] : artworkTries_) {
            if (!tried.givenUp && tried.retryAtMs > nowMs &&
                (artworkRetryDueMs_ <= 0.0 || tried.retryAtMs < artworkRetryDueMs_)) {
                artworkRetryDueMs_ = tried.retryAtMs;
            }
        }
        dirty_ = true;
    }
}

void App::HandleUndecodable(const std::wstring& file) {
    const std::optional<std::string> url = artwork_->Forget(file);
    if (!url.has_value()) return;  // A bundled asset or a local file: nothing to download again.
    ArtworkTry& tried = artworkTries_[*url];
    if (tried.refetches >= 1) {
        tried.givenUp = true;
        return;
    }
    ++tried.refetches;
    images_->ForgetFailure(file);
    QueueArtwork(*url, true);
}

void App::QueueRailArtwork(const std::vector<ui::RailData>& rails) {
    for (const ui::RailData& rail : rails) {
        // The painter requests pictures lazily for tiles approaching the viewport.
        for (std::size_t i = 0; i < std::min<std::size_t>(12, rail.cards.size()); ++i) QueueArtwork(rail.cards[i].posterUrl);
    }
}

void App::SyncDetails() {
    const std::optional<std::string> top = shell_->TopDetailsId();
    // Saving a title changes the Watchlist shelf, so Home is rebuilt once the details are left.
    if (!top.has_value() && homeStale_) RebuildHome();
    if (top == shownTitle_) return;
    shownTitle_ = top;
    if (top.has_value()) ShowTitle(*top);
}

void App::ShowTitle(const std::string& id) {
    const auto cached = titles_.find(id);
    if (cached != titles_.end()) {
        ui::TitleInfo info = cached->second;
        info.saved = SavedOnWatchlist(id);
        shell_->SetTitleInfo(id, info);
        QueueTitleArtwork(info);
        return;
    }
    // The details screen shows its loading state until the answer comes back.
    if (!titlesInFlight_.insert(id).second) return;

    const auto epoch = extrasEpoch_;
    const auto profile = profiles::ActiveFolder(dataDir_);
    background_->Run([this, id, epoch, prefs = extrasPrefs_, profile]() mutable {
        try { prefs = extras::ParsePreferences(core_->Call("/api/prefs")); } catch (...) {}
        ui::TitleInfo info;
        try { info = ui::InfoFromMeta(id, catalog_->Meta(id)); }
        catch (...) { info = ui::InfoFromMeta(id, std::nullopt); }
        const auto publish = [this, id, epoch](const ui::TitleInfo& value) {
            background_->PostToUi([this, id, epoch, value] { if (epoch == extrasEpoch_) FinishTitle(id, value); });
        };
        info.showRatings = prefs.Enabled("ratings");
        info.spoilerBlur = prefs.Enabled("spoilerBlur");
        if (profile && info.spoilerBlur) {
            const auto progress = catalog::ReadProgress(*profile);
            if (progress.is_object()) for (const auto& [key, value] : progress.items()) {
                if (value.is_object() && value.value("completed", false)) info.watchedEpisodes.push_back(key);
                else if (value.is_object() && value.value("duration", 0.0) > 0 &&
                         value.value("position", 0.0) >= value.value("duration", 0.0) * 0.9) info.watchedEpisodes.push_back(key);
            }
        }
        publish(info);
        if (info.state != ui::TitleInfo::State::Ready) return;
        if (prefs.Enabled("trailers")) try { info.trailerUrl = extras::YoutubeUrl(core_->Call("/api/extras/trailers?id=" + js::EncodeUriComponent(id))); } catch (...) {}
        publish(info);
        if (info.kind == "series") {
            if (prefs.Enabled("comingUp")) try { info.upcoming = extras::UpcomingLabel(core_->Call("/api/extras/upcoming?id=" + js::EncodeUriComponent(id)).value("next", nlohmann::json())); } catch (...) {}
        } else if (prefs.Enabled("collections")) {
            try {
                const auto collection = core_->Call("/api/extras/collection?id=" + js::EncodeUriComponent(id));
                if (collection.contains("name") && collection["name"].is_string()) info.collectionName = collection["name"].get<std::string>();
                if (collection.contains("items") && collection["items"].is_array() && collection["items"].size() >= 2)
                    for (const auto& raw : collection["items"]) if (const auto item = catalog::FromJson(raw); item && item->id != id) info.collection.push_back(*item);
            } catch (...) {}
        }
        publish(info);
        bool anime = false;
        for (const auto& genre : info.genres) if (genre == "Anime" || genre == "anime" || genre == "Animation" || genre == "animation") anime = true;
        if (anime && prefs.Enabled("animeTitles")) {
            try {
                const auto title = core_->Call("/api/extras/anime-title?title=" + js::EncodeUriComponent(info.title));
                if (title.contains("english") && title["english"].is_string()) info.englishTitle = title["english"].get<std::string>();
                if (info.englishTitle == info.title) info.englishTitle.clear();
            } catch (...) {}
            publish(info);
        }
        if (prefs.Enabled("versionPicker") || prefs.Enabled("qualityBadges")) {
            std::string query = "?id=" + js::EncodeUriComponent(id);
            info.versionTarget = id;
            if (info.kind == "series" && !info.children.empty()) {
                const auto& first = info.children.front();
                const auto season = std::to_string(first.season.value_or(1)), episode = std::to_string(first.episode.value_or(1));
                query += "&season=" + season + "&episode=" + episode;
                info.versionTarget = id + ":" + season + ":" + episode;
            }
            try {
                const auto result = core_->Call("/api/playback/versions" + query);
                if (result.contains("versions") && result["versions"].is_array()) for (const auto& version : result["versions"]) {
                    if (!version.is_object() || !version.contains("id") || !version["id"].is_string()) continue;
                    if (info.qualityBadges.empty() && prefs.Enabled("qualityBadges")) {
                        if (version.value("height", 0) >= 2000) info.qualityBadges.push_back("4K");
                        if (version.contains("hdr") && version["hdr"].is_string())
                            info.qualityBadges.push_back(version["hdr"] == "dv" ? "Dolby Vision" : "HDR");
                        if (version.contains("audio") && version["audio"].is_object() && version["audio"].value("atmos", false))
                            info.qualityBadges.push_back("Atmos");
                    }
                    if (prefs.Enabled("versionPicker")) info.versions.emplace_back(version["id"].get<std::string>(), playback::VersionLabel(version));
                }
            } catch (...) {}
            publish(info);
        }
        if (info.kind != "series" && prefs.Enabled("ratings")) {
            try { info.reviews = core_->Call("/api/reviews?id=" + js::EncodeUriComponent(id)); } catch (...) {}
            publish(info);
        }
    });
}

void App::FinishTitle(const std::string& id, const ui::TitleInfo& info) {
    titlesInFlight_.erase(id);
    ui::TitleInfo shown = info;
    shown.hideDownloads = kidsProfile_;
    if (shown.state == ui::TitleInfo::State::Ready && !Allowed(shown.media)) {
        shown.state = ui::TitleInfo::State::Unavailable;
        shown.synopsis = "This title is outside this profile's age limit. Filters by genre.";
        shown.children.clear();
    }
    std::erase_if(shown.collection, [this](const auto& item) { return !Allowed(item); });
    if (shown.state != ui::TitleInfo::State::Ready) { shown.collection.clear(); shown.trailerUrl.clear(); shown.upcoming.clear(); shown.englishTitle.clear(); shown.versions.clear(); shown.qualityBadges.clear(); }
    shown.services.clear();
    const auto connected = ConnectedServices();
    const auto services = content_->Read("services");
    if (services.contains("services")) for (const auto& service : services["services"]) if (connected.value(service.value("id", ""), false)) shown.services.push_back({service.value("id", ""), service.value("name", "")});
    shown.saved = SavedOnWatchlist(id);
    // Only a real answer is kept. An unavailable title is asked for again when it is opened.
    if (shown.state == ui::TitleInfo::State::Ready) titles_[id] = shown;
    shell_->SetTitleInfo(id, shown);
    QueueTitleArtwork(shown);
    for (const auto& item : shown.collection) QueueArtwork(item.poster);
    // My List in the player asked for this title before it had loaded.
    if (pendingSave_ == id) {
        pendingSave_.reset();
        if (shown.state == ui::TitleInfo::State::Ready) ToggleWatchlist(id);
        if (playerOpen_ && SaveId() == id) {
            playerView_.saved = SavedOnWatchlist(id);
            shell_->SetPlayerView(playerView_, NowMs());
        }
    }
    dirty_ = true;
}

std::string App::SaveId() const {
    // An episode's id is the series' with its season and number; the list keeps the series, as showIdFromPlayId does.
    if (const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_)) return play->imdb;
    return playerId_;
}

void App::UpdateLiveBehind() {
    // While a channel is paused no state arrives, so the gap is counted on the window clock, a second at a time.
    if (!playerOpen_ || !playerLive_ || !livePausedAtMs_.has_value()) return;
    const double behind = liveBehindSeconds_ + (NowMs() - *livePausedAtMs_) / 1000.0;
    if (std::floor(behind) == std::floor(playerView_.liveBehind)) return;
    playerView_.liveBehind = behind;
    shell_->SetPlayerView(playerView_, NowMs());
    dirty_ = true;
}

void App::QueueTitleArtwork(const ui::TitleInfo& info) {
    // The poster, the backdrop behind the page, and the stills of the episodes.
    QueueArtwork(info.posterUrl);
    QueueArtwork(info.backdropUrl);
    for (const catalog::MediaItem& episode : info.children) QueueArtwork(episode.poster);
}

void App::RebuildHome() {
    RefreshExtrasHome();
    // A page lane needs no catalogue: Live TV, Library and Search have their own sources.
    if (account_.usable && IsPageLane(streamLane_)) {
        homeStale_ = false;
        BuildPageLane();
        return;
    }
    if (!catalogReady_) return;
    homeStale_ = false;
    // Home is the TVM Stream page: the stream chrome, the turning billboard, and the rails by lane.
    BuildBrowse(*home_, true);
}

void App::TurnHero(double now) {
    if (home_->HeroCount() < 2 || now - lastHeroTurnMs_ < kHeroTurnMs) return;
    lastHeroTurnMs_ = now;

    // The hero turns only while Home is on screen, the window is not minimised, the page is near the top
    // and motion is not reduced. Otherwise the turn is skipped, as the web Home skips it.
    if (IsIconic(window_) != 0) return;
    if (shell_->ActiveScreenName() != "home") return;
    if (home_->PageScroll() > home_->ViewportHeight() * 0.35) return;
    if (motion::PrefersReducedMotion(store_->Motion())) return;
    home_->ShowHero(home_->HeroIndex() + 1, now);
    dirty_ = true;
}

void App::ToggleWatchlist(const std::string& id) {
    const auto cached = titles_.find(id);
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    // A title can be saved once its details have loaded, into a profile that can be read.
    if (cached == titles_.end() || !folder.has_value()) return;

    const bool wasSaved = catalog::IsSaved(catalog::ReadWatchlist(*folder), id);
    std::vector<catalog::WatchlistEntry> after;
    try {
        after = wasSaved ? catalog::RemoveWatchlist(*folder, id) : catalog::AddWatchlist(*folder, cached->second.media);
    } catch (const std::exception&) {
        return;  // Nothing was written, so the button keeps the state it showed.
    }
    // The list may refuse a change, so the button follows what was actually stored.
    const bool nowSaved = catalog::IsSaved(after, id);
    if (nowSaved == wasSaved) return;
    extrasHomeCheckedMs_ = -600000;

    ui::TitleInfo info = cached->second;
    info.saved = nowSaved;
    cached->second = info;
    shell_->SetTitleInfo(id, info);
    homeStale_ = true;
    dirty_ = true;
}

bool App::SavedOnWatchlist(const std::string& id) const {
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    return folder.has_value() && catalog::IsSaved(catalog::ReadWatchlist(*folder), id);
}

void App::SyncRealDebrid() {
    if (shell_->ActiveScreenName() != "realdebrid") {
        realDebridOpened_ = false;
        return;
    }
    if (realDebridOpened_) return;
    realDebridOpened_ = true;
    // Each visit starts without the message the last visit left.
    realDebridView_.message.clear();
    RefreshAccount();
    RefreshRealDebrid();
}

void App::RefreshRealDebrid() {
    realDebridView_.busy = true;
    shell_->SetRealDebridView(realDebridView_);
    dirty_ = true;

    RefreshRdStatus();
    if (!rdStatusChecking_) FinishRealDebrid(rdStatus_, "");

}

void App::SaveRealDebridToken() {
    if (realDebridView_.busy) return;
    const std::string token = util::Trim(ClipboardText(window_).value_or(""));
    if (token.empty()) {
        realDebridView_.message = "Copy a token from real-debrid.com/apitoken, then choose Paste and save.";
        shell_->SetRealDebridView(realDebridView_);
        dirty_ = true;
        return;
    }
    if (token.find_first_of("\r\n") != std::string::npos) {
        realDebridView_.message = "A token cannot contain line breaks.";
        shell_->SetRealDebridView(realDebridView_);
        dirty_ = true;
        return;
    }
    ChangeRealDebridToken(token, false);
}

void App::ClearRealDebridToken() {
    if (realDebridView_.busy) return;
    ChangeRealDebridToken("", true);
}

void App::ChangeRealDebridToken(std::string token, bool clearing) {
    realDebridChanging_ = true;
    realDebridView_.busy = true;
    realDebridView_.message.clear();
    shell_->SetRealDebridView(realDebridView_);
    dirty_ = true;

    background_->Run([this, token = std::move(token), clearing] {
        // The token itself is never logged or shown. Only the outcome reaches the screen.
        bool stored = true;
        try {
            core_->Call("/api/rd/token", "PUT", {{"token", token}});
        } catch (const std::exception&) {
            stored = false;
        }
        const coreapi::RealDebridStatus status = CoreRealDebrid();
        std::string message = kNotStoredMessage;
        if (stored) message = clearing ? kClearedMessage : SavedMessage(status);
        background_->PostToUi([this, status, message] { realDebridChanging_ = false; FinishRealDebrid(status, message); });
    });
}

void App::FinishRealDebrid(const coreapi::RealDebridStatus& status, const std::string& message) {
    rdStatus_ = status;
    rdStatusLoaded_ = true;
    streamStatus_ = ToCatalogRdStatus(status);
    streamStatusLoaded_ = true;
    realDebridView_.loaded = true;
    realDebridView_.configured = status.configured;
    realDebridView_.username = status.username;
    realDebridView_.premium = status.premium;
    realDebridView_.source = status.source;
    realDebridView_.error = status.error;
    realDebridView_.busy = false;
    realDebridView_.message = message;
    shell_->SetRealDebridView(realDebridView_);
    UpdateSettingsDiagnostics();
    dirty_ = true;
}

void App::RefreshRdStatus() {
    if (rdStatusChecking_ || !account_.usable) return;
    rdStatusChecking_ = true;
    rdCheckedMs_ = NowMs();
    const auto epoch = extrasEpoch_;
    background_->Run([this, epoch] {
        coreapi::RealDebridStatus status;
        bool ok = false;
        try {
            EnsureCore(*core_);
            status = coreapi::ParseRealDebridStatus(core_->Call("/api/rd/status"));
            ok = true;
        } catch (...) {}
        background_->PostToUi([this, status, ok, epoch] {
            if (epoch != extrasEpoch_) return;
            rdStatusChecking_ = false;
            if (ok) {
                if (!realDebridChanging_) FinishRealDebrid(status, realDebridView_.message);
                MaybePromptRealDebrid();
            } else if (!realDebridChanging_ && realDebridView_.busy) {
                realDebridView_.busy = false;
                realDebridView_.message = "Could not check Real-Debrid. TVM will try again.";
                shell_->SetRealDebridView(realDebridView_);
            }
            dirty_ = true;
        });
    });
}

void App::MaybePromptRealDebrid() {
    if (!account_.usable || !rdStatusLoaded_) return;
    if (!coreapi::ShouldPromptForRealDebrid(account_, rdStatus_, rdOnboardingDismissed_ || rdOnboardingPrompted_)) return;
    if (shell_->ActiveScreenName() != "home") return;
    if (intro_->Covers()) return;
    rdOnboardingPrompted_ = true;
    ui::Command setup;
    setup.name = "setup";
    shell_->Execute(setup, NowMs());
    dirty_ = true;
}

void App::UpdateSettingsDiagnostics() {
    ui::DeveloperDiagnostics diag;
    diag.active = account_.usable && account_.developer;
    if (diag.active) {
        diag.buildVersion = std::string("v") + config::kCoreVersion + " \xC2\xB7 Native Windows";
        if (rdStatusLoaded_) {
            diag.rdTokenSource = rdStatus_.source.empty()
                                     ? (rdStatus_.configured ? "device" : "Not configured")
                                     : rdStatus_.source;
        } else {
            diag.rdTokenSource = account_.rdKey ? "account" : "Checking\xE2\x80\xA6";
        }
        diag.glassMode = store_->ReduceTransparency() ? "Solid surfaces" : "Liquid Glass";
    }
    shell_->SetDeveloperDiagnostics(diag);
}

void App::SyncXtream() {
    if (shell_->ActiveScreenName() != "live-xtream") {
        xtreamOpened_ = false;
        return;
    }
    if (xtreamOpened_) return;
    xtreamOpened_ = true;
    // Each visit starts with empty fields, and then shows the saved login, as the web screen does.
    xtreamPassword_.clear();
    xtreamView_ = ui::XtreamView{};
    RefreshXtream();
}

void App::RefreshXtream() {
    xtreamView_.busy = true;
    shell_->SetXtreamView(xtreamView_);
    dirty_ = true;

    background_->Run([this] {
        ui::XtreamView next;
        next.loaded = true;
        if (const std::optional<xtream::Account> saved = xtream_->Saved()) {
            const xtream::Load load = xtream_->LoadChannels(*saved);
            next.configured = true;
            next.serverField = saved->host;
            next.usernameField = saved->username;
            next.accountName = load.username.value_or(saved->username);
            next.error = load.error;
            if (load.error.empty()) next.channels = static_cast<int>(load.channels.size());
        }
        background_->PostToUi([this, next] { FinishXtream(next); });
    });
}

void App::PasteXtreamField(XtreamField field) {
    if (xtreamView_.busy) return;
    const std::string text = util::Trim(ClipboardText(window_).value_or(""));
    if (text.empty()) {
        xtreamView_.message = "Nothing to paste. Copy the value first, then choose its row.";
    } else {
        xtreamView_.message.clear();
        switch (field) {
        case XtreamField::Server:
            xtreamView_.serverField = text;
            break;
        case XtreamField::Username:
            xtreamView_.usernameField = text;
            break;
        case XtreamField::Password:
            // The password is kept here only. The screen learns that one is pasted.
            xtreamPassword_ = text;
            xtreamView_.passwordPasted = true;
            break;
        }
    }
    shell_->SetXtreamView(xtreamView_);
    dirty_ = true;
}

void App::SaveXtream() {
    if (xtreamView_.busy) return;
    if (xtreamView_.serverField.empty() || xtreamView_.usernameField.empty() || xtreamPassword_.empty()) {
        xtreamView_.message = "Paste the server, username and password, then choose Save login.";
        shell_->SetXtreamView(xtreamView_);
        dirty_ = true;
        return;
    }
    const std::optional<std::string> host = xtream::NormalizeHost(xtreamView_.serverField);
    if (!host.has_value()) {
        xtreamView_.message = "Enter a server URL, username and password.";
        shell_->SetXtreamView(xtreamView_);
        dirty_ = true;
        return;
    }
    ChangeXtream(xtream::Account{*host, xtreamView_.usernameField, xtreamPassword_});
}

void App::ChangeXtream(const xtream::Account& account) {
    xtreamView_.busy = true;
    xtreamView_.message.clear();
    shell_->SetXtreamView(xtreamView_);
    dirty_ = true;

    background_->Run([this, account, view = xtreamView_] {
        ui::XtreamView next = view;
        next.busy = false;
        // The password is cleared once the panel has answered, whatever the answer, as the web screen does.
        next.passwordPasted = false;

        const xtream::Authentication auth = xtream_->Authenticate(account);
        if (!auth.ok) {
            next.message = XtreamFailureMessage(auth.error);
        } else {
            // The panel's own name for the account is kept, as the Node core keeps it.
            const xtream::Account saved{account.host, auth.username.value_or(account.username), account.password};
            try {
                xtream_->Save(saved);
                const xtream::Load load = xtream_->LoadChannels(saved);
                next.configured = true;
                next.serverField = saved.host;
                next.usernameField = saved.username;
                next.accountName = load.username.value_or(saved.username);
                next.error = load.error;
                if (load.error.empty()) {
                    next.channels = static_cast<int>(load.channels.size());
                    next.message = std::to_string(load.channels.size()) + " channels ready.";
                } else {
                    next.channels.reset();
                    next.message = XtreamFailureMessage(load.error);
                }
            } catch (const std::exception&) {
                next.message = "The login was not stored.";
            }
        }
        background_->PostToUi([this, next] { FinishXtream(next); });
    });
}

void App::ForgetXtream() {
    if (xtreamView_.busy) return;
    xtreamView_.busy = true;
    xtreamView_.message.clear();
    shell_->SetXtreamView(xtreamView_);
    dirty_ = true;

    background_->Run([this, view = xtreamView_] {
        ui::XtreamView next = view;
        next.busy = false;
        next.passwordPasted = false;
        try {
            xtream_->Forget();
            next.configured = false;
            next.accountName.reset();
            next.channels.reset();
            next.error.clear();
            next.message = "Login cleared. Live TV will ask for it again.";
        } catch (const std::exception&) {
            next.message = "The login was not cleared.";
        }
        background_->PostToUi([this, next] { FinishXtream(next); });
    });
}

void App::FinishXtream(const ui::XtreamView& view) {
    xtreamView_ = view;
    xtreamView_.busy = false;
    // The password is only kept while it is pasted and not yet saved.
    if (!xtreamView_.passwordPasted) xtreamPassword_.clear();
    shell_->SetXtreamView(xtreamView_);
    dirty_ = true;
}

void App::SyncLiveTv() {
    // The Live TV screen (opened from the playlist screen) or the Live TV lane. A channel playing over it is part of
    // the same visit, so coming back from the player keeps the channels, the focus and the choosing mode.
    const auto& entries = shell_->stack().entries;
    const bool inStack = std::any_of(entries.begin(), entries.end(), [](const nav::ViewEntry& entry) {
        return entry.name == "live-tv";
    });
    if (!inStack && streamLane_ != "live") {
        liveOpened_ = false;
        return;
    }
    if (shell_->ActiveScreenName() != "live-tv") return;
    if (liveOpened_) return;
    liveOpened_ = true;
    // Each visit starts by watching, and reads the catalogue again, so a login saved in between shows.
    liveChoosing_ = false;
    RefreshLiveTv();
}

void App::RefreshLiveTv() {
    liveLoaded_ = false;
    guideLoadedEnd_ = 0; guideRetryAt_ = 0;
    liveMessage_.clear();
    ApplyLiveTv();

    background_->Run([this] {
        live::Catalog catalog = live::LoadCatalog(dataDir_, *xtream_, http::Send);
        std::vector<std::string> picks = live::AllowedPicks(catalog.channels, live::ReadPicks(dataDir_));
        background_->PostToUi([this, catalog = std::move(catalog), picks = std::move(picks)] {
            liveCatalog_ = catalog;
            livePicks_ = picks;
            liveLoaded_ = true;
            ApplyLiveTv();
        });
    });
}

void App::ApplyLiveTv() {
    std::erase_if(liveCatalog_.channels, [](const auto& channel) { return channel.id.rfind("live:free:", 0) == 0; });
    std::vector<catalog::LiveChannel> free;
    const auto data = content_->Read("free-channels");
    if (data.contains("channels")) for (const auto& row : data["channels"]) {
        const auto group = row.value("group", "Live");
        if (!content::AllowsLive(parental_, profileMaxAge_, group)) continue;
        catalog::LiveChannel channel;
        channel.id = "live:free:" + row.value("id", "");
        channel.name = row.value("name", "");
        channel.url = row.value("url", "");
        channel.group = group;
        channel.logo = row.value("logo", "");
        channel.source = "free";
        if (row.contains("geo") && row["geo"].is_string()) channel.geo = row["geo"].get<std::string>();
        free.push_back(channel);
    }
    ui::LiveTvState state;
    state.freeChannels = free;
    state.loaded = liveLoaded_;
    state.choosing = liveChoosing_;
    state.catalog = liveCatalog_;
    std::erase_if(state.catalog.channels, [this](const auto& channel) { return !content::AllowsLive(parental_, profileMaxAge_, live::GroupOf(channel)); });
    liveCatalog_.channels.insert(liveCatalog_.channels.begin(), free.begin(), free.end());
    state.picks = livePicks_;
    state.message = liveMessage_;
    ui::SceneView view = ui::LiveTvView(state);
    view.topButtons.insert(view.topButtons.begin(), ui::TopButton{"Guide", ui::Command{false, "show-guide", {}, true}, false});
    guide_.SetFavorites(livePicks_);
    // "Check channels" is a developer tool; other accounts would only be turned back at the door.
    if (!coreapi::AllowsRoute(account_, "live-check")) {
        std::erase_if(view.topButtons, [](const ui::TopButton& button) { return button.command.name == "live-check"; });
    }
    // A saved login the panel refused reads as such, not as "nothing connected".
    if (state.loaded && liveCatalog_.error == "needs-auth") {
        view.status = "The Live TV panel refused the saved login. Choose Login to check the username and password.";
    }
    // Channel logos are pictures like posters: fetch them, or every channel stays a plain tile.
    QueueRailArtwork(view.rails);
    shell_->SetLiveTvView(view, NowMs());
    if (streamLane_ == "live") {
        ui::SceneView lane = view;
        lane.kicker = "Channels";
        lane.heading = "Live TV";
        ShowPageLane(std::move(lane));
    }
    // The channel check lists the same channels' groups.
    if (pageName_ == "live-check") ShowInfoPage();
    dirty_ = true;
}

void App::SetLiveChoosing(bool choosing) {
    liveChoosing_ = choosing;
    liveMessage_.clear();
    ApplyLiveTv();
}

void App::ToggleLivePick(const std::string& id) {
    if (!liveLoaded_ || !liveChoosing_) return;
    const bool picked = std::find(livePicks_.begin(), livePicks_.end(), id) != livePicks_.end();
    if (!picked && livePicks_.size() >= live::kPickLimit) {
        liveMessage_ = "Live TV holds " + std::to_string(live::kPickLimit) + " channels. Remove one to add another.";
        ApplyLiveTv();
        return;
    }

    std::vector<std::string> next = live::WithPick(liveCatalog_.channels, livePicks_, id, !picked);
    try {
        live::WritePicks(dataDir_, next);
    } catch (const std::exception&) {
        liveMessage_ = "That channel could not be updated.";
        ApplyLiveTv();
        return;
    }
    livePicks_ = std::move(next);
    liveMessage_.clear();
    ApplyLiveTv();
}

void App::SyncLivePlaylist() {
    if (shell_->ActiveScreenName() != "live-playlist") {
        livePlaylistOpened_ = false;
        return;
    }
    if (livePlaylistOpened_) return;
    livePlaylistOpened_ = true;
    // Each visit starts with empty fields, then shows the saved playlist, as the web screen does.
    livePlaylistText_.clear();
    livePlaylistView_ = ui::LivePlaylistView{};
    RefreshLivePlaylist();
}

void App::RefreshLivePlaylist() {
    livePlaylistView_.busy = true;
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;

    background_->Run([this, view = livePlaylistView_] {
        ui::LivePlaylistView next = view;
        next.busy = false;
        ShowPlaylist(next, live::LoadCatalog(dataDir_, *xtream_, http::Send));
        background_->PostToUi([this, next] { FinishLivePlaylist(next); });
    });
}

void App::PasteLivePlaylistAddress() {
    if (livePlaylistView_.busy) return;
    const std::string text = util::Trim(ClipboardText(window_).value_or(""));
    if (text.empty()) {
        livePlaylistView_.message = "Nothing to paste. Copy the address first, then choose its row.";
    } else {
        livePlaylistView_.message.clear();
        livePlaylistView_.addressField = text;
    }
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;
}

void App::PasteLivePlaylistText() {
    if (livePlaylistView_.busy) return;
    const std::string text = util::Trim(ClipboardText(window_, live::kMaxPlaylistBytes).value_or(""));
    if (text.empty()) {
        livePlaylistView_.message = "Nothing to paste. Copy the playlist first, then choose its row.";
    } else {
        livePlaylistView_.message.clear();
        livePlaylistText_ = text;
        livePlaylistView_.textBytes = text.size();
    }
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;
}

void App::SaveLivePlaylist() {
    if (livePlaylistView_.busy) return;
    // Pasted text is saved when it reads as a playlist. Otherwise the address field is saved, as the web screen does.
    const std::string value = live::LooksLikePlaylistText(livePlaylistText_) ? livePlaylistText_
                                                                             : livePlaylistView_.addressField;
    livePlaylistView_.busy = true;
    livePlaylistView_.message.clear();
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;

    background_->Run([this, value, view = livePlaylistView_] {
        ui::LivePlaylistView next = view;
        next.busy = false;
        try {
            const live::PlaylistChange change = live::SetPlaylist(dataDir_, value);
            if (change == live::PlaylistChange::Invalid) {
                next.message = kInvalidPlaylistMessage;
            } else {
                const live::Catalog catalog = live::LoadCatalog(dataDir_, *xtream_, http::Send);
                ShowPlaylist(next, catalog);
                if (catalog.error == "invalid") {
                    next.message = kInvalidPlaylistMessage;
                } else if (catalog.error == "unreachable") {
                    next.message = kUnreachablePlaylistMessage;
                } else if (change == live::PlaylistChange::Cleared) {
                    next.message = kRemovedPlaylistMessage;
                } else {
                    next.message = std::to_string(catalog.channels.size()) + " channels ready. Choose the ones you watch.";
                }
            }
        } catch (const std::exception&) {
            next.message = kNotStoredPlaylistMessage;
        }
        background_->PostToUi([this, next] { FinishLivePlaylist(next); });
    });
}

void App::ClearLivePlaylist() {
    if (livePlaylistView_.busy) return;
    // Removing the playlist empties both fields too, as the web screen does.
    livePlaylistText_.clear();
    livePlaylistView_.addressField.clear();
    livePlaylistView_.textBytes.reset();
    livePlaylistView_.busy = true;
    livePlaylistView_.message.clear();
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;

    background_->Run([this, view = livePlaylistView_] {
        ui::LivePlaylistView next = view;
        next.busy = false;
        try {
            live::SetPlaylist(dataDir_, "");
            ShowPlaylist(next, live::LoadCatalog(dataDir_, *xtream_, http::Send));
            next.message = kRemovedPlaylistMessage;
        } catch (const std::exception&) {
            next.message = kNotRemovedPlaylistMessage;
        }
        background_->PostToUi([this, next] { FinishLivePlaylist(next); });
    });
}

void App::FinishLivePlaylist(const ui::LivePlaylistView& view) {
    livePlaylistView_ = view;
    livePlaylistView_.busy = false;
    shell_->SetLivePlaylistView(livePlaylistView_);
    dirty_ = true;
}

void App::SyncStream() {
    // The page is rebuilt each time it comes back on top, so a title saved on its details shows on My List.
    if (shell_->ActiveScreenName() != "tvm-stream") {
        streamOpened_ = false;
        return;
    }
    if (streamOpened_) return;
    streamOpened_ = true;
    RebuildStream();
    RefreshStreamStatus();
}

void App::RefreshStreamStatus() {
    background_->Run([this] {
        const coreapi::RealDebridStatus status = CoreRealDebrid();
        background_->PostToUi([this, status] {
            rdStatus_ = status;
            rdStatusLoaded_ = true;
            streamStatus_ = ToCatalogRdStatus(status);
            streamStatusLoaded_ = true;
            UpdateSettingsDiagnostics();
            RebuildStream();
        });
    });
}

void App::SetStreamLane(const std::string& lane) {
    const std::string previous = streamLane_;
    streamLane_ = lane == "movies" || lane == "shows" || IsPageLane(lane) ? lane : "all";
    // Live TV reads its source again on each visit, so a login saved in between shows; the player opening over it
    // is not a new visit.
    if (previous == "live" && streamLane_ != "live") liveOpened_ = false;
    if (!IsPageLane(streamLane_)) RebuildStream();
    RebuildHome();
    // Home, Movies and Series keep their own transition: the hero dissolve and the sliding tab glass. A page with no
    // hero fades its content in from the ground behind the chrome, with the same timing and easing.
    if (previous != streamLane_ && (IsPageLane(previous) || IsPageLane(streamLane_))) home_->FadeContentIn(NowMs());
}

void App::OpenStreamTab(const std::string& lane) {
    if (lane == "live" && streamLane_ != "live") guideVisible_ = true;
    if (lane == "live" && !coreapi::AllowsRoute(account_, "live-tv")) {
        accountMessage_ = account_.usable ? "This screen requires the appropriate account tier or admin role."
                                          : "Sign in with an active account to continue.";
        ui::Command door;
        door.name = "account";
        shell_->Execute(door, NowMs());
        return;
    }
    // A tab chosen on another screen comes back to Home first, so there is one chrome and one stack.
    if (shell_->ActiveScreenName() != "home") shell_->PopToRoot(NowMs());
    SetStreamLane(lane);
}

std::vector<ui::TopButton> App::StreamNav(bool root) const {
    const auto tab = [](const std::string& lane) {
        ui::Command command;
        command.name = "stream-tab";
        command.action = true;
        command.params["lane"] = lane;
        return command;
    };
    // The orb opens the profile menu: switch profile, manage profiles, or Settings.
    ui::Command settings;
    settings.name = "profile-menu";
    settings.modal = true;
    // The profile's name, or "Profile" without one, as StreamChrome labels its orb.
    const std::string profileName = profiles::ActiveName(dataDir_).value_or("Profile");
    const auto on = [&](const std::string& lane) { return root && streamLane_ == lane; };
    return {
        ui::TopButton{"Home", tab("all"), on("all")},
        ui::TopButton{"Movies", tab("movies"), on("movies")},
        ui::TopButton{"Series", tab("shows"), on("shows")},
        ui::TopButton{"Live TV", tab("live"), on("live")},
        ui::TopButton{"Library", tab("library"), on("library")},
        ui::TopButton{"Search", tab("search"), on("search")},
        ui::TopButton{profileName, settings, false, false, true},
    };
}

void App::BuildPageLane() {
    if (streamLane_ == "live") {
        if (!liveOpened_) {
            liveOpened_ = true;
            liveChoosing_ = false;
            RefreshLiveTv();
        } else {
            ApplyLiveTv();
        }
    } else if (streamLane_ == "library") {
        BuildWatchlistPage();
    } else if (streamLane_ == "search") {
        ApplySearch();
    }
}

void App::ShowPageLane(ui::SceneView view) {
    const double now = NowMs();
    view.style = ui::SceneStyle::Stream;
    if (view.pageKey.empty()) view.pageKey = "lane:" + streamLane_;
    view.pageButtons = std::move(view.topButtons);
    view.topButtons = StreamNav(true);
    home_->SetHeroes({}, now);
    home_->SetView(view, now);
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

bool App::SearchTyping() const {
    // Letters go into the search field only while it has the caret: after a click on it (or OK on it, Ctrl+F or /).
    // Hover alone never starts or stops typing.
    const std::string active = shell_->ActiveScreenName();
    if (active == "search") {
        const ui::Scene* scene = shell_->SceneNamed("search");
        return scene != nullptr && scene->SearchEditing();
    }
    return active == "home" && streamLane_ == "search" && home_->SearchEditing();
}

ui::Scene* App::SearchScene() {
    const std::string active = shell_->ActiveScreenName();
    if (active == "search") return shell_->SceneNamed("search");
    if (active == "home" && streamLane_ == "search") return home_;
    return nullptr;
}

bool App::IsEditingText() const {
    if (const auto* editor = dynamic_cast<const ui::ProfileEditor*>(&shell_->ActiveScreen())) return editor->Typing();
    if (SearchTyping()) return true;
    if (const auto* accountScreen = dynamic_cast<const ui::AccountScreen*>(&shell_->ActiveScreen());
        accountScreen != nullptr && accountScreen->IsEditing()) {
        return true;
    }
    if (const auto* page = dynamic_cast<const ui::InfoScreen*>(&shell_->ActiveScreen());
        page != nullptr && page->HasField()) {
        return true;
    }
    if (const auto* chooser = dynamic_cast<const ui::ProfileChooser*>(&shell_->ActiveScreen());
        chooser != nullptr && chooser->SheetOpen()) {
        return true;
    }
    if (const auto* profiles = dynamic_cast<const ui::ProfilesScreen*>(&shell_->ActiveScreen());
        profiles != nullptr && profiles->Creating()) {
        return true;
    }
    return false;
}

void App::RebuildStream() {
    if (ui::Scene* scene = shell_->StreamScene()) BuildBrowse(*scene, false);
}

void App::BuildBrowse(ui::Scene& scene, bool root) {
    const auto inLane = [this](const catalog::MediaItem& item) {
        if (!Allowed(item)) return false;
        if (streamLane_ == "shows") return item.kind == "series";
        if (streamLane_ == "movies") return item.kind != "series";
        return true;
    };

    // The chrome: centred glass capsule (Home Â· Movies Â· Series Â· Live TV Â· Library Â· Search) + profile orb.
    const auto open = [](const std::string& name, bool modal) {
        ui::Command command;
        command.name = name;
        command.modal = modal;
        return command;
    };
    const auto act = [](const std::string& name, const std::string& lane = "") {
        ui::Command command;
        command.name = name;
        command.action = true;
        if (!lane.empty()) command.params["lane"] = lane;
        return command;
    };
    ui::SceneView view;
    // Each lane is its own page: a rebuild of the same lane keeps the viewer's place, a new lane starts at the top.
    view.pageKey = std::string(root ? "home:" : "stream:") + streamLane_;
    view.style = ui::SceneStyle::Stream;
    if (!account_.usable) {
        view.topButtons = {
            ui::TopButton{"Account", open("account", false)},
            ui::TopButton{"Settings", open("settings", false)},
            ui::TopButton{"Live TV", open("live-tv", false)},
            ui::TopButton{"Updates", open("updates", false)},
        };
        ui::HeroData door;
        door.itemId = "account-gate";
        door.title = "Welcome to TVM";
        door.backdropUrl = "asset:lighthouse.jpg";
        door.body = accountMessage_.empty()
                        ? (accountBusy_ ? "Connecting to your TVM account service\xE2\x80\xA6"
                                        : "Sign in to unlock your personal library, 4K streams, and continue watching across devices.")
                        : accountMessage_;
        door.playLabel = "Sign in";
        door.playCommand = open("account", false);
        door.infoLabel = "Plans";
        door.infoCommand = open("plans", false);
        const double now = NowMs();
        scene.SetView(view, now);
        scene.SetHeroes({door}, now);
        scene.SetRails({});
        if (!scene.FocusedKey().has_value()) scene.FocusItem("hero-play", now, false);
        return;
    }
    // Live TV, Library and Search are pages under the same chrome, on the same scene.
    if (root && IsPageLane(streamLane_)) {
        BuildPageLane();
        return;
    }
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    view.topButtons = StreamNav(root);
    if (!root) {
        // A TVM Stream page pushed over Home marks its own lane.
        for (ui::TopButton& button : view.topButtons) {
            const auto lane = button.command.params.find("lane");
            if (lane != button.command.params.end()) button.on = lane->second == streamLane_;
        }
    }

    std::vector<ui::HeroData> heroes;
    const bool rdReady = streamStatus_.configured && streamStatus_.error != "needs-auth";
    if (!catalogReady_ || (!root && !streamStatusLoaded_)) {
        view.status = root ? "Loading the catalogue..." : "Loading library\xE2\x80\xA6";
    } else if (!rdReady && !root) {
        // Library.tsx asks for a token before anything else. The token is pasted on the Real-Debrid screen.
        ui::HeroData notice;
        notice.itemId = "stream-connect";
        notice.title = "Connect Real-Debrid to watch";
        notice.backdropUrl = "asset:lighthouse.jpg";
        notice.body =
            "Home and the other apps stay open without this. Paste the API token from real-debrid.com/apitoken, then "
            "press OK. TVM encrypts it on this machine and sends it to Real-Debrid and the Torrentio resolver for "
            "catalogue playback. Connect only sources you are authorised to use. Review Privacy & terms in Settings.";
        notice.hue = 210;
        notice.playLabel = "Continue";
        notice.infoLabel = "Back to Home";
        notice.playCommand = open("realdebrid", false);
        notice.infoCommand = act("stream-home");
        heroes.push_back(notice);
    } else {
        const catalog::ProgressMap progress = folder.has_value() ? catalog::ReadProgress(*folder) : nlohmann::json::object();
        const std::vector<catalog::WatchlistEntry> watchlist =
            folder.has_value() ? catalog::ReadWatchlist(*folder) : std::vector<catalog::WatchlistEntry>{};
        const std::vector<catalog::ProgressItem> watching =
            catalog::PickContinueWatching(catalog::ApplyProgress(bundle_.catalog, progress), progress);
        std::vector<catalog::MediaItem> watchingTitles;
        for (const catalog::ProgressItem& entry : watching) watchingTitles.push_back(entry.item);
        std::vector<catalog::MediaItem> watchlistTitles;
        for (const catalog::WatchlistEntry& entry : watchlist) watchlistTitles.push_back(entry.item);
        std::vector<catalog::HomeRail> catalogRails =
            catalog::BuildHomeRails(bundle_, shelves_, watchingTitles, watchlistTitles, CurrentYear());

        // Continue watching is left out on the Movies lane, as Library.tsx leaves it out.
        std::vector<catalog::ProgressItem> watchingLane;
        if (streamLane_ != "movies") {
            for (const catalog::ProgressItem& entry : watching) {
                if (inLane(entry.item)) watchingLane.push_back(entry);
            }
        }
        std::vector<catalog::WatchlistEntry> listLane;
        for (const catalog::WatchlistEntry& entry : watchlist) {
            if (inLane(entry.item)) listLane.push_back(entry);
        }
        for (catalog::HomeRail& rail : catalogRails) {
            std::erase_if(rail.items, [&](const catalog::MediaItem& item) { return !inLane(item); });
        }
        std::erase_if(catalogRails, [](const catalog::HomeRail& rail) { return rail.items.empty(); });

        if (!watchingLane.empty()) {
            ui::RailData rail = ui::ContinueWatchingRail(watchingLane);
            rail.title = "Continue Watching";
            view.rails.push_back(std::move(rail));
        }
        if (root && streamLane_ != "movies" && !upcomingRail_.cards.empty()) view.rails.push_back(upcomingRail_);
        if (root && streamLane_ == "all") {
            for (const auto& eventRail : eventRails_) view.rails.push_back(eventRail);
        }
        if (!listLane.empty()) {
            ui::RailData rail = ui::WatchlistRail(listLane);
            rail.title = "My List";
            view.rails.push_back(std::move(rail));
        }
        for (ui::RailData& rail : ui::RailsFromCatalog(catalogRails)) {
            auto& page = railPages_[rail.id];
            // Start the first prefetch at zero to retain titles trimmed from the initial 40-card view.
            if (rail.id == "for-you" || rail.id == "because") page.more = false;
            std::set<std::string> ids;
            for (const auto& card : rail.cards) ids.insert(card.itemId);
            for (const auto& item : page.items) if (inLane(item) && ids.insert(item.id).second)
                rail.cards.push_back(ui::CardData{item.id, item.title, item.poster, std::nullopt});
            rail.more = page.more;
            rail.loop = !page.more;
            view.rails.push_back(std::move(rail));
        }

        // The billboard: the title in progress, else the newest film, as the core's `featured` picks it.
        std::vector<catalog::MediaItem> laneWatching;
        for (const catalog::ProgressItem& entry : watchingLane) laneWatching.push_back(entry.item);
        std::vector<ui::HeroData> candidates = HeroTitles(laneWatching, catalogRails);
        // Home turns through its titles. The stream page shows one billboard.
        if (root && streamLane_ == "all" && !eventHeroes_.empty()) {
            heroes.push_back(eventHeroes_.front());
            auto& hero = heroes.front();
            const auto cached = titles_.find(hero.itemId);
            ApplyHeroEvent(hero, content_->Read("events"), contentDate_, cached == titles_.end() ? nullptr : &cached->second.media);
        } else if (root && streamLane_ != "all") heroes = candidates;
        else if (!candidates.empty()) heroes.push_back(candidates.front());
        if (view.rails.empty() && heroes.empty()) view.status = "Nothing on this lane yet.";
    }

    // The first view puts the focus on the billboard's first button, as the web page opens. Later ones
    // keep the viewer's place.
    const double now = NowMs();
    const bool first = !scene.FocusedKey().has_value() || scene.HeroCount() == 0;
    scene.SetHeroes(heroes, now);
    scene.SetView(view, now);
    if (first && !heroes.empty()) scene.FocusItem("hero-play", now, true);
    scene.SetImageReady([this](const std::string& url) { return artwork_->Lookup(url).has_value(); });
    for (const ui::HeroData& hero : heroes) { QueueArtwork(hero.backdropUrl); QueueArtwork(hero.logoUrl); }
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

void App::SyncPages() {
    // Each visit is filled in once, by the entry's key, so a second hub or a return to a page starts afresh.
    const nav::ViewEntry& entry = nav::ActiveEntry(shell_->stack());
    if (entry.key == pageOpened_) return;
    fieldValues_.clear();
    if (auto* previous = dynamic_cast<ui::InfoScreen*>(shell_->ScreenNamed(pageName_))) previous->ClearField();
    pageOpened_ = entry.key;
    const std::string& name = entry.name;
    if (name != "profile-editor" && name != "pin-pad") {
        profileEditId_.clear(); profileEditPin_.clear(); adultApprovalId_.clear(); adultApprovalPin_.clear();
    }
    if (dynamic_cast<ui::InfoScreen*>(&shell_->ActiveScreen()) != nullptr || name == "downloads") OpenInfoPage(entry);
    if (name == "account") {
        SyncAccountScreen();
        if (!termsLoaded_ && !termsBusy_) RefreshTerms();
        if (account_.usable && !rdStatusLoaded_ && !rdStatusChecking_) RefreshRdStatus();
    }
    if (name == "plans") {
        SyncPlansScreen();
        if (!tiersLoaded_ && !tiersBusy_) RefreshTiers();
    }
    if (name == "service") {
        const auto id = entry.params.find("id");
        OpenServiceHub(id == entry.params.end() ? "" : id->second);
    }
    if (name == "watchlist") BuildWatchlistPage();
    if (name == "profiles") ShowProfiles("");
    if (name == "chooser" || name == "profile-menu") ShowChooser("");
    if (name == "updates") {
        updatesView_.version = config::kCoreVersion;
        updatesView_.autoUpdate = store_->CorePrefs().autoUpdate;
        updatesView_.message.clear();
        ShowUpdates();
    }
    if (name == "settings") {
        UpdateSettingsDiagnostics();
        if (account_.usable && !rdStatusLoaded_ && !rdStatusChecking_) RefreshRdStatus();
    }
}

void App::BuildWatchlistPage() {
    ui::Scene* scene = shell_->SceneNamed("watchlist");
    if (scene == nullptr && streamLane_ != "library") return;
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    const std::vector<catalog::WatchlistEntry> saved =
        folder.has_value() ? catalog::ReadWatchlist(*folder) : std::vector<catalog::WatchlistEntry>{};

    // watchlistView: the filter, then the order. The list is kept newest first, which is "Recently saved".
    std::vector<catalog::MediaItem> items;
    for (const catalog::WatchlistEntry& entry : saved) {
        if (!Allowed(entry.item)) continue;
        const bool series = entry.item.kind == "series";
        if (watchlistFilter_ == "movie" && series) continue;
        if (watchlistFilter_ == "series" && !series) continue;
        items.push_back(entry.item);
    }
    const auto lower = [](std::string text) {
        for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return text;
    };
    const auto score = [](const catalog::MediaItem& item) {
        try {
            return item.rating.empty() ? -1.0 : std::stod(item.rating);
        } catch (const std::exception&) {
            return -1.0;
        }
    };
    if (watchlistSort_ == "title") {
        std::stable_sort(items.begin(), items.end(), [&](const auto& a, const auto& b) { return lower(a.title) < lower(b.title); });
    } else if (watchlistSort_ == "year") {
        std::stable_sort(items.begin(), items.end(), [](const auto& a, const auto& b) { return a.year.value_or(0) > b.year.value_or(0); });
    } else if (watchlistSort_ == "rating") {
        std::stable_sort(items.begin(), items.end(), [&](const auto& a, const auto& b) { return score(a) > score(b); });
    }

    const auto act = [](const std::string& name, const std::string& value = "") {
        ui::Command command;
        command.name = name;
        command.action = true;
        if (!value.empty()) command.params["value"] = value;
        return command;
    };
    const std::string sortLabel = watchlistSort_ == "title"    ? "Title A\xE2\x80\x93Z"
                                  : watchlistSort_ == "year"   ? "Newest release"
                                  : watchlistSort_ == "rating" ? "Highest rated"
                                                               : "Recently saved";
    ui::SceneView view;
    view.style = ui::SceneStyle::Page;
    view.kicker = "Saved for later";
    view.heading = "Watchlist";
    if (!saved.empty()) {
        view.topButtons = {
            ui::TopButton{"All titles", act("watchlist-filter", "all"), watchlistFilter_ == "all"},
            ui::TopButton{"Movies", act("watchlist-filter", "movie"), watchlistFilter_ == "movie"},
            ui::TopButton{"Series", act("watchlist-filter", "series"), watchlistFilter_ == "series"},
            ui::TopButton{"Sort by: " + sortLabel, act("watchlist-sort")},
        };
    }
    if (saved.empty()) {
        view.status = "Nothing saved yet. Add a title from its details page. Watchlist stays on this device.";
    } else if (items.empty()) {
        view.status = watchlistFilter_ == "series" ? "No series saved yet. Your other saved titles are still here."
                                                   : "No movies saved yet. Your other saved titles are still here.";
    } else {
        view.status = std::to_string(items.size()) + (items.size() == 1 ? " title" : " titles");
    }
    const auto card = [](const catalog::MediaItem& item) {
        return ui::CardData{item.id, item.title, catalog::PreferPoster(item.id, item.poster, item.backdrop), std::nullopt};
    };
    // Eight posters a row, as the web grid wraps them.
    for (std::size_t i = 0; i < items.size(); i += 8) {
        ui::RailData rail;
        rail.id = "saved-" + std::to_string(i / 8);
        for (std::size_t j = i; j < std::min(i + 8, items.size()); ++j) rail.cards.push_back(card(items[j]));
        view.rails.push_back(std::move(rail));
    }
    if (scene != nullptr) {
        scene->SetView(view, NowMs());
        QueueRailArtwork(view.rails);
    }
    if (streamLane_ == "library") {
        // The Library tab: a heading with the count, the filters and the order always to hand, then films and series
        // in their own titled grids, or a plain way back to browsing when nothing is saved yet.
        ui::SceneView lane;
        lane.heading = "Library";
        const std::size_t movies = static_cast<std::size_t>(std::count_if(
            saved.begin(), saved.end(), [](const catalog::WatchlistEntry& entry) { return entry.item.kind != "series"; }));
        lane.kicker = saved.empty() ? "Saved for later"
                                    : std::to_string(saved.size()) + " saved \xC2\xB7 " + std::to_string(movies) +
                                          (movies == 1 ? " film" : " films") + " \xC2\xB7 " +
                                          std::to_string(saved.size() - movies) +
                                          (saved.size() - movies == 1 ? " series" : " series");
        lane.topButtons = {
            ui::TopButton{"All", act("watchlist-filter", "all"), watchlistFilter_ == "all"},
            ui::TopButton{"Movies", act("watchlist-filter", "movie"), watchlistFilter_ == "movie"},
            ui::TopButton{"Series", act("watchlist-filter", "series"), watchlistFilter_ == "series"},
            ui::TopButton{"Sort: " + sortLabel, act("watchlist-sort")},
        };
        if (saved.empty()) {
            lane.status = "Nothing saved yet. Open any film or series and choose Add to My List \xE2\x80\x94 it appears "
                          "here, on this device.";
            ui::Command home;
            home.name = "stream-tab";
            home.action = true;
            home.params["lane"] = "all";
            lane.topButtons = {ui::TopButton{"Browse Home", home, true}};
        } else if (items.empty()) {
            lane.status = view.status;
        }
        for (const bool series : {false, true}) {
            std::vector<const catalog::MediaItem*> group;
            for (const catalog::MediaItem& item : items) {
                if ((item.kind == "series") == series) group.push_back(&item);
            }
            for (std::size_t i = 0; i < group.size(); i += 8) {
                ui::RailData rail;
                rail.id = std::string(series ? "series-" : "movies-") + std::to_string(i / 8);
                rail.title = i == 0 ? (series ? "Series" : "Movies") : "";
                for (std::size_t j = i; j < std::min(i + 8, group.size()); ++j) rail.cards.push_back(card(*group[j]));
                lane.rails.push_back(std::move(rail));
            }
        }
        ShowPageLane(std::move(lane));
    }
    dirty_ = true;
}

ui::ChooserView App::ChooserFromRegistry(const std::string& message) {
    ui::ChooserView view;
    view.message = message;
    try {
        const profiles::Registry registry = profiles::Load(dataDir_);
        view.activeId = registry.activeId;
        for (const profiles::Profile& profile : registry.profiles) {
            ui::ProfileEntry entry{profile.id, profile.name, profile.hue};
            entry.avatar = profile.avatar;
            entry.kind = profile.kind;
            entry.maxAge = profile.maxAge;
            entry.locked = !profile.pin.is_null();
            const auto avatars = content_->Read("avatars");
            if (avatars.contains("sets")) for (const auto& set : avatars["sets"]) for (const auto& avatar : set["avatars"]) {
                if (set.value("id", "") + "/" + avatar.value("id", "") == profile.avatar) entry.avatarUrl = avatar.value("image", "");
            }
            view.profiles.push_back(entry);
        }
    } catch (const std::exception&) {
        view.message = "Profiles could not be read on this device.";
    }
    try {
        view.max = core_->Call("/api/plan").value("profilesMax", std::size_t(10));
    } catch (const std::exception&) {
        // Without the plan, the core's own cap.
    }
    return view;
}

void App::ShowChooser(const std::string& message) {
    const ui::ChooserView view = ChooserFromRegistry(message);
    if (auto* chooser = dynamic_cast<ui::ProfileChooser*>(shell_->ScreenNamed("chooser"))) chooser->SetView(view);
    if (auto* menu = dynamic_cast<ui::ProfileMenu*>(shell_->ScreenNamed("profile-menu"))) menu->SetView(view);
    dirty_ = true;
}

void App::OpenChooser() {
    ui::Command chooser;
    chooser.name = "chooser";
    shell_->Execute(chooser, NowMs());
    ShowChooser("");
    dirty_ = true;
}

void App::ShowProfiles(const std::string& message) {
    auto* screen = dynamic_cast<ui::ProfilesScreen*>(shell_->ScreenNamed("profiles"));
    if (screen == nullptr) return;
    ui::ProfilesView view;
    view.message = message;
    try {
        const profiles::Registry registry = profiles::Load(dataDir_);
        view.max = core_->Call("/api/plan").value("profilesMax", std::size_t(10));
        view.activeId = registry.activeId;
        for (const profiles::Profile& profile : registry.profiles) {
            ui::ProfileEntry entry{profile.id, profile.name, profile.hue};
            entry.avatar = profile.avatar;
            entry.kind = profile.kind;
            entry.maxAge = profile.maxAge;
            entry.locked = !profile.pin.is_null();
            const auto avatars = content_->Read("avatars");
            if (avatars.contains("sets")) for (const auto& set : avatars["sets"]) for (const auto& avatar : set["avatars"]) {
                if (set.value("id", "") + "/" + avatar.value("id", "") == profile.avatar) entry.avatarUrl = avatar.value("image", "");
            }
            view.profiles.push_back(entry);
        }
    } catch (const std::exception&) {
        view.message = "Profiles could not be read on this device.";
    }
    screen->SetView(view);
    dirty_ = true;
}

void App::ApplyProfileAction(const ui::Command& command) {
    const auto param = [&](const char* key) {
        const auto found = command.params.find(key);
        return found == command.params.end() ? std::string() : found->second;
    };
    const std::string from = param("from");
    const double now = NowMs();
    if (command.name == "profile-manage") {
        // From the orb's menu: close it, then open the chooser in its place.
        shell_->Back(now);
        OpenChooser();
        return;
    }
    if (command.name == "profile-settings") {
        shell_->Back(now);
        ui::Command settings;
        settings.name = "settings";
        shell_->Execute(settings, now);
        dirty_ = true;
        return;
    }
    try {
        if (command.name == "profile-edit") {
            const auto registry = profiles::Load(dataDir_);
            for (const auto& profile : registry.profiles) if (profile.id == param("id") && !profile.pin.is_null() && profileEditId_ != profile.id) {
                AskProfilePin(command, profile.id); return;
            }
            OpenProfileEditor(param("id")); return;
        }
        if (command.name == "profile-unlock") {
            if (!core_->Call("/api/profiles/verify-pin", "POST", {{"id", param("id")}, {"pin", param("pin")}}).value("ok", false)) throw std::runtime_error("Incorrect PIN.");
            const auto pending = pendingProfileAction_;
            pendingProfileAction_.reset();
            shell_->Back(now);
            if (!pending) return;
            if (pending->name == "profile-save-edited") { adultApprovalId_ = param("id"); adultApprovalPin_ = param("pin"); }
            else { profileEditId_ = param("id"); profileEditPin_ = param("pin"); }
            ApplyProfileAction(*pending); return;
        }
        if (command.name == "profile-save-edited") {
            const auto id = param("id");
            auto patch = nlohmann::json::parse(param("patch"));
            if (id.empty()) core_->Call("/api/profiles", "POST", patch);
            else {
                const auto registry = profiles::Load(dataDir_);
                for (const auto& profile : registry.profiles) if (profile.id == id && profile.kind == "kids" &&
                    (patch.value("kind", "kids") != "kids" || patch.value("maxAge", profile.maxAge) > profile.maxAge) && adultApprovalId_.empty()) {
                    for (const auto& adult : registry.profiles) if (adult.kind != "kids" && !adult.pin.is_null()) { AskProfilePin(command, adult.id); return; }
                }
                patch["id"] = id;
                patch["currentPin"] = !adultApprovalPin_.empty() ? adultApprovalPin_ : profileEditId_ == id ? profileEditPin_ : "";
                core_->Call("/api/profiles", "PUT", patch);
            }
            profileEditPin_.clear(); profileEditId_.clear(); adultApprovalId_.clear(); adultApprovalPin_.clear();
            shell_->Back(now);
            RefreshProfilePolicy();
            ShowChooser(""); RebuildHome(); RefreshContent(); return;
        }
        if (command.name == "profile-delete-edited") {
            core_->Call("/api/profiles/remove", "POST", {{"id", param("id")}, {"pin", profileEditId_ == param("id") ? profileEditPin_ : ""}});
            profileEditPin_.clear(); profileEditId_.clear();
            shell_->Back(now); RefreshProfilePolicy(); ShowChooser(""); RebuildHome(); return;
        }
        if (command.name == "profile-remove") {
            core_->Call("/api/profiles/remove", "POST", {{"id", param("id")}});
            ShowProfiles("");
            ShowChooser("");
            RebuildHome();
            return;
        }
        if (command.name == "profile-rename") {
            // Renamed through the core, as the Android app renames, so both apps keep the same registry.
            core_->Call("/api/profiles", "PUT", {{"id", param("id")}, {"name", param("name")}});
            ShowChooser("");
            RebuildHome();
            RebuildStream();
            return;
        }
        if (from == "chooser" && command.name == "profile-create") {
            // A profile added from the chooser joins the grid; the viewer then picks who is watching.
            core_->Call("/api/profiles", "POST", {{"name", param("name")}});
            ShowChooser("");
            return;
        }
        // Choosing or making a profile switches to it, and Home follows that person's list and progress.
        if (command.name == "profile-open") {
            const auto registry = profiles::Load(dataDir_);
            for (const auto& profile : registry.profiles) if (profile.id == param("id") && !profile.pin.is_null() && profileEditId_ != profile.id) { AskProfilePin(command, profile.id); return; }
            core_->Call("/api/profiles/active", "POST", {{"id", param("id")}, {"pin", profileEditId_ == param("id") ? profileEditPin_ : ""}});
            profileEditPin_.clear(); profileEditId_.clear();
        }
        if (command.name == "profile-create") core_->Call("/api/profiles", "POST", {{"name", param("name")}});
        RefreshProfilePolicy();
        RefreshContent();
        titles_.clear();
        // Each profile has its own searches.
        recentSearches_.clear();
        RebuildHome();
        RebuildStream();
        if (from == "chooser") {
            // The picked avatar settles first; the chooser then closes onto that person's Home.
            chooserCloseAtMs_ = now + ui::ProfileChooser::kPickMs + 80.0;
        } else {
            shell_->Back(now);
        }
    } catch (const std::exception& error) {
        if (auto* editor = dynamic_cast<ui::ProfileEditor*>(&shell_->ActiveScreen())) editor->Fail(error.what(), now);
        ShowProfiles(error.what());
        ShowChooser(error.what());
    }
}

void App::ShowUpdates() {
    if (auto* screen = dynamic_cast<ui::UpdatesScreen*>(shell_->ScreenNamed("updates"))) screen->SetView(updatesView_);
    // What's new lists the same changes, so it follows the same answer.
    if (pageName_ == "changelog") ShowInfoPage();
    dirty_ = true;
}

void App::TypedIntoPage(ui::InfoScreen& page) {
    if (!fieldMode_.empty()) fieldValues_[pageName_ + "." + fieldMode_] = page.FieldText();
    // Accounts filter as the search is typed, as the web field does.
    if (pageName_ == "accounts" && fieldMode_ == "search") {
        LoadAccounts();
        ShowInfoPage();
    }
    dirty_ = true;
}

void App::CheckForUpdates() {
    updatesCheckedMs_ = NowMs();
    if (updatesView_.busy) return;
    updatesView_.busy = true;
    updatesView_.message.clear();
    ShowUpdates();
    background_->Run([this] {
        // GitHub's own API: the latest release's tag, and the latest changes on the main line.
        http::Options options;
        options.accept = "application/vnd.github+json";
        options.timeoutMs = 12000;
        const std::optional<http::Response> release =
            http::Get("https://api.github.com/repos/GL-327/TVM/releases/tags/native-windows", options);
        const std::optional<http::Response> commits =
            http::Get("https://api.github.com/repos/GL-327/TVM/commits?per_page=8", options);
        std::string available;
        bool updateNeeded = false;
        wchar_t executable[32768]{};
        GetModuleFileNameW(nullptr, executable, 32768);
        const auto installedPath = std::filesystem::path(executable).parent_path() / L"native-build.json";
        const auto installed = nlohmann::json::parse(util::StripBom(util::ReadTextFile(installedPath).value_or("{}")), nullptr, false);
        const std::string installedCommit = installed.is_object() ? installed.value("commit", std::string()) : std::string();
        const std::string installedBuiltAt = installed.is_object() ? installed.value("builtAt", std::string()) : std::string();
        bool olderPublished = false;
        if (release.has_value() && release->ok()) {
            const nlohmann::json body = nlohmann::json::parse(release->body, nullptr, false);
            if (body.is_object() && body.contains("assets") && body["assets"].is_array()) {
                for (const auto& asset : body["assets"]) {
                    if (asset.value("name", std::string()) != "TVM-native-windows.zip" || !asset.contains("label") || !asset["label"].is_string()) continue;
                    const auto commit = asset["label"].get<std::string>();
                    const std::string publishedAt = asset.value("updated_at", std::string());
                    if (commit.size() == 40 && commit != installedCommit) {
                        // Only a newer build replaces this copy. A copy built here, or from a commit not yet published,
                        // is never "updated" back to an older release (which closed TVM and reopened an older one).
                        if (update::ShouldInstall(installedCommit, installedBuiltAt, commit, publishedAt)) {
                            available = "Build " + commit.substr(0, 7);
                            updateNeeded = true;
                        } else {
                            olderPublished = !installedCommit.empty();
                        }
                    }
                }
            }
        }
        std::vector<std::string> changes;
        bool reached = commits.has_value() && commits->ok();
        if (reached) {
            const nlohmann::json body = nlohmann::json::parse(commits->body, nullptr, false);
            for (const nlohmann::json& item : body.is_array() ? body : nlohmann::json::array()) {
                const std::string message =
                    item.contains("commit") && item["commit"].is_object() ? item["commit"].value("message", std::string()) : std::string();
                const std::string title = message.substr(0, message.find('\n'));
                // Merges say nothing about what changed, as entriesFromGithubCommits leaves them out.
                if (title.empty() || title.rfind("Merge ", 0) == 0) continue;
                changes.push_back(title);
            }
        }
        background_->PostToUi([this, available, changes, reached, updateNeeded, olderPublished] {
            updatesView_.busy = false;
            SYSTEMTIME now{};
            GetLocalTime(&now);
            char stamp[32];
            std::snprintf(stamp, sizeof(stamp), "%02u/%02u/%04u %02u:%02u", now.wDay, now.wMonth, now.wYear, now.wHour,
                          now.wMinute);
            updatesView_.lastCheck = stamp;
            updatesView_.available = available;
            if (reached) updatesView_.changes = changes;
            updatesView_.message = !reached            ? "Check failed. Confirm this PC can reach GitHub."
                                   : olderPublished    ? "This copy is newer than the published build, so it is kept."
                                   : available.empty() ? "No newer native package is published. The changes below are the latest."
                                                       : available + " is published. Install it to update this copy.";
            ShowUpdates();
            if (updateNeeded && updatesView_.autoUpdate && !playerOpen_ && !downloadRunning_) InstallNativeUpdate();
        });
    });
}

void App::SyncSearch() {
    const std::string active = shell_->ActiveScreenName();
    // The Search lane keeps its query and results while a title is opened from them and closed again.
    const bool lane = active == "home" && streamLane_ == "search";
    if (active != "search") {
        searchOpened_ = false;
        if (lane && searchPending_ && NowMs() - searchTypedMs_ >= kSearchDebounceMs) RunSearch();
        return;
    }
    if (!searchOpened_) {
        // Each visit starts with an empty field, as the web modal opens.
        searchOpened_ = true;
        ++searchGeneration_;
        searchQuery_.clear();
        searchResults_.clear();
        searchPending_ = false;
        searchStatus_ = "Search films and series.";
        ApplySearch();
    }
    if (searchPending_ && NowMs() - searchTypedMs_ >= kSearchDebounceMs) RunSearch();
}

bool App::HandleSearchKey(WPARAM virtualKey) {
    if (auto* editor = dynamic_cast<ui::ProfileEditor*>(&shell_->ActiveScreen())) {
        if (virtualKey == VK_BACK && editor->Typing()) { editor->Erase(); dirty_ = true; return true; }
        if (virtualKey == VK_RETURN && editor->Typing()) {
            const auto command = editor->Submit();
            if (command) shell_->Execute(*command, NowMs());
            dirty_ = true; return true;
        }
        return false;
    }
    if (auto* chooser = dynamic_cast<ui::ProfileChooser*>(&shell_->ActiveScreen()); chooser != nullptr && chooser->SheetOpen()) {
        // The sheet's name field: Backspace edits it (never Back), Enter saves, and letters arrive as characters.
        if (virtualKey == VK_BACK) {
            chooser->Erase();
            dirty_ = true;
            return true;
        }
        return virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z');
    }
    if (auto* profiles = dynamic_cast<ui::ProfilesScreen*>(&shell_->ActiveScreen()); profiles != nullptr && profiles->Creating()) {
        // While the name field is open, Backspace edits it and letters arrive as characters.
        if (virtualKey == VK_BACK) {
            profiles->Erase();
            dirty_ = true;
            return true;
        }
        return virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z');
    }
    if (ui::AccountScreen* accountScreen = ActiveAccountScreen()) {
        if (virtualKey == VK_TAB && accountScreen->CycleField(KeyDown(VK_SHIFT), NowMs())) {
            dirty_ = true;
            return true;
        }
        if (accountScreen->IsEditing()) {
            if (virtualKey == VK_BACK) {
                accountScreen->Erase(KeyDown(VK_CONTROL));
                dirty_ = true;
                return true;
            }
            if (virtualKey == 'V' && KeyDown(VK_CONTROL)) {
                accountScreen->Paste(util::Trim(ClipboardText(window_).value_or("")));
                dirty_ = true;
                return true;
            }
            if (virtualKey == VK_RETURN &&
                accountScreen->FocusedKey().value_or("").rfind("field:", 0) == 0) {
                if (const auto cmd = accountScreen->SubmitActiveField(NowMs())) shell_->Execute(*cmd, NowMs());
                dirty_ = true;
                return true;
            }
            if (accountScreen->FocusedKey().value_or("").rfind("field:", 0) == 0 &&
                (virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z'))) {
                return true;
            }
        }
    }
    if (ui::InfoScreen* page = TypingPage()) {
        // A page's field takes Backspace and a paste; letters arrive as characters.
        if (virtualKey == VK_BACK) {
            // An empty field keeps Backspace too: it never falls through to Back.
            if (page->FieldText().empty()) return true;
            if (KeyDown(VK_CONTROL)) {
                // Erase a character at a time until the field is down to the text before the last word.
                const std::size_t keep = util::ErasePreviousWord(page->FieldText()).size();
                while (page->FieldText().size() > keep) {
                    const std::size_t before = page->FieldText().size();
                    page->Erase();
                    if (page->FieldText().size() >= before) break;
                }
            } else {
                page->Erase();
            }
            TypedIntoPage(*page);
            return true;
        }
        if (virtualKey == 'V' && KeyDown(VK_CONTROL)) {
            page->Type(util::Trim(ClipboardText(window_).value_or("")));
            TypedIntoPage(*page);
            return true;
        }
        return virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z');
    }
    if (!SearchTyping()) {
        // Ctrl+F or / on the Search page puts the caret in the field.
        ui::Scene* scene = SearchScene();
        if (scene != nullptr && ((virtualKey == 'F' && KeyDown(VK_CONTROL)) || (virtualKey == VK_OEM_2 && !KeyDown(VK_SHIFT)))) {
            scene->FocusItem("search-field", NowMs(), true);
            scene->SetSearchEditing(true, NowMs());
            dirty_ = true;
            return true;
        }
        return false;
    }
    const bool lane = shell_->ActiveScreenName() == "home";
    if (virtualKey == VK_RETURN) {
        // Enter searches at once, without waiting for the pause after typing.
        if (searchPending_ || (searchResults_.empty() && util::Trim(searchQuery_).size() >= 2)) {
            RunSearch();
            return true;
        }
        // With the results already showing, Enter steps down into them.
        if (lane && !searchResults_.empty()) {
            home_->FocusItem("card:0:0", NowMs(), true);
            dirty_ = true;
            return true;
        }
        return false;
    }
    if (virtualKey == VK_ESCAPE) {
        // Esc takes the caret out of the field; the next Esc goes back as usual.
        if (ui::Scene* scene = SearchScene()) scene->SetSearchEditing(false, NowMs());
        dirty_ = true;
        return true;
    }
    if (virtualKey == VK_BACK) {
        // Backspace removes the last letter (Ctrl+Backspace the last word). With the field empty it does nothing;
        // it never leaves Search.
        if (searchQuery_.empty()) return true;
        if (KeyDown(VK_CONTROL)) {
            searchQuery_ = util::ErasePreviousWord(searchQuery_);
        } else {
            std::size_t cut = searchQuery_.size() - 1;
            while (cut > 0 && (static_cast<unsigned char>(searchQuery_[cut]) & 0xC0) == 0x80) --cut;
            searchQuery_.erase(cut);
        }
        TypeSearch("");
        return true;
    }
    if (virtualKey == 'V' && KeyDown(VK_CONTROL)) {
        TypeSearch(util::Trim(ClipboardText(window_).value_or("")));
        return true;
    }
    // A space and the letters arrive as characters. Only the keys that move or open go on to the shell.
    if (virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z')) return true;
    return false;
}

void App::TypeSearch(const std::string& text) {
    // Typing leaves a genre page for the search.
    browseGenre_.clear();
    const bool wasIdle = util::Trim(searchQuery_).empty();
    const bool wasRunning = searchRunning_;
    const bool wasFailed = searchFailed_;
    searchQuery_ += text;
    searchTypedMs_ = NowMs();
    searchPending_ = true;
    searchFailed_ = false;
    // Any answer still on its way is for an older query, so it must not land over what is typed now.
    ++searchGeneration_;
    searchRunning_ = false;
    if (!wasIdle && !wasRunning && !wasFailed) {
        // Only the field's text changed: the page keeps its rails and is not rebuilt on every key.
        home_->SetQuery(searchQuery_);
        if (ui::Scene* scene = shell_->SceneNamed("search")) scene->SetQuery(searchQuery_);
        dirty_ = true;
        return;
    }
    ApplySearch();
}

void App::RunSearch() {
    searchPending_ = false;
    searchFailed_ = false;
    const int generation = ++searchGeneration_;
    const std::string query = util::Trim(searchQuery_);
    if (query.size() < 2) {
        searchResults_.clear();
        searchRunning_ = false;
        searchStatus_ = query.empty() ? "Search films and series." : "Type at least two letters to search.";
        ApplySearch();
        return;
    }
    searchRunning_ = true;
    searchStatus_ = "Searching for \xE2\x80\x9C" + query + "\xE2\x80\x9D\xE2\x80\xA6";
    ApplySearch();
    background_->Run([this, generation, query] {
        std::vector<catalog::MediaItem> results;
        bool failed = false;
        try {
            results = catalog_->Search(query);
        } catch (const std::exception&) {
            failed = true;
        }
        background_->PostToUi([this, generation, query, results, failed] {
            if (generation != searchGeneration_) return;
            // The title that is the query comes first, then titles that start with it, then the rest in the
            // catalogue's order, so "breaking bad" leads with Breaking Bad rather than a film about it.
            const auto lower = [](std::string text) {
                for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                return text;
            };
            const std::string wanted = lower(query);
            const auto rank = [&](const catalog::MediaItem& item) {
                const std::string title = lower(item.title);
                if (title == wanted) return 0;
                if (title.rfind(wanted, 0) == 0) return 1;
                return title.find(wanted) != std::string::npos ? 2 : 3;
            };
            searchRunning_ = false;
            searchFailed_ = failed;
            searchResults_ = results;
            std::erase_if(searchResults_, [this](const auto& item) { return !Allowed(item); });
            ++searchResultsGeneration_;
            // A new search shows everything again.
            searchFilter_ = "all";
            if (!failed && !results.empty()) {
                // Remembered for this session, newest first, without repeats.
                std::erase_if(recentSearches_, [&](const std::string& old) { return lower(old) == wanted; });
                recentSearches_.insert(recentSearches_.begin(), query);
                if (recentSearches_.size() > 6) recentSearches_.resize(6);
            }
            std::stable_sort(searchResults_.begin(), searchResults_.end(),
                             [&](const catalog::MediaItem& a, const catalog::MediaItem& b) { return rank(a) < rank(b); });
            if (failed) {
                searchStatus_ = "Search is unavailable. Check your connection and try again.";
            } else if (results.empty()) {
                searchStatus_ = "Nothing matched \xE2\x80\x9C" + query + "\xE2\x80\x9D. Try another title.";
            } else {
                searchStatus_ = std::to_string(results.size()) + (results.size() == 1 ? " match" : " matches");
            }
            ApplySearch();
        });
    });
}

void App::ApplySearch() {
    if (streamLane_ == "search" && account_.usable) {
        // The Search lane: the field under the chrome, then films and series in their own grids.
        ui::SceneView lane;
        // No heading: the field is the page's title, as on a television's search page.
        lane.searchField = true;
        lane.query = searchQuery_;
        lane.status = searchStatus_.empty() ? "Find films and series by title." : searchStatus_;
        lane.loading = searchRunning_;
        // New results start at the top; the same results (status, typing) keep the place.
        lane.pageKey = "lane:search";
        if (searchFailed_) {
            ui::Command retry;
            retry.name = "search-submit";
            retry.action = true;
            lane.topButtons = {ui::TopButton{"Try again", retry, true}};
        }
        // As many posters a row as the window fits, so the grid fills the width.
        RECT client{};
        GetClientRect(window_, &client);
        const double windowWidth = std::max<LONG>(1, client.right - client.left);
        const double rem = ui::ViewportRem(windowWidth, std::max<LONG>(1, client.bottom - client.top));
        const double usable = windowWidth - 2.0 * rem * (2.5 + 1.0);
        // Search's grid has more space between posters (1.6rem) than the browse rails.
        const std::size_t perRow =
            std::clamp<std::size_t>(static_cast<std::size_t>((usable + rem * 1.6) / (rem * (10.5 + 1.6))), 3, 12);
        const auto card = [](const catalog::MediaItem& item) {
            ui::CardData data{item.id, item.title, item.poster, std::nullopt};
            if (item.year.has_value()) data.subtitle = std::to_string(*item.year);
            return data;
        };
        const bool idle = util::Trim(searchQuery_).empty() && searchResults_.empty() && !searchRunning_;
        // Nothing matched: the same suggestions as the empty page, so the page is never a dead end.
        const bool nothing = !idle && searchResults_.empty() && !searchRunning_ && !searchFailed_ &&
                             util::Trim(searchQuery_).size() >= 2 && !searchPending_;
        // A Browse tile was chosen: that genre's films and series, from the catalogue already loaded.
        const catalog::GenreShelf* browsing = nullptr;
        if (idle && !browseGenre_.empty()) {
            for (const catalog::GenreShelf& shelf : shelves_) {
                if (shelf.genre == browseGenre_) browsing = &shelf;
            }
        }
        if (browsing != nullptr) {
            lane.status = browsing->genre;
            ui::Command back;
            back.name = "search-browse";
            back.action = true;
            lane.topButtons.push_back(ui::TopButton{"\xE2\x80\xB9 Browse", back, false});
            for (const bool series : {false, true}) {
                std::vector<catalog::MediaItem> items = series ? browsing->shows : browsing->movies;
                std::erase_if(items, [this](const auto& item) { return !Allowed(item); });
                for (std::size_t i = 0; i < items.size(); i += perRow) {
                    ui::RailData rail;
                    rail.id = std::string(series ? "browse-series-" : "browse-movies-") + std::to_string(i / perRow);
                    if (i == 0) rail.title = std::string(series ? "Series" : "Movies") + " \xC2\xB7 " + std::to_string(items.size());
                    for (std::size_t j = i; j < std::min(i + perRow, items.size()); ++j) rail.cards.push_back(card(items[j]));
                    lane.rails.push_back(std::move(rail));
                }
            }
        } else if (idle || nothing) {
            // An empty Search: what was searched before, as chips, then Browse, a tile for each genre with a picture
            // from that genre, as the Apple TV app shows under its search line. Nothing here is made up.
            if (idle) {
                lane.status.clear();
                const std::size_t tilesPerRow = std::clamp<std::size_t>(
                    static_cast<std::size_t>((usable + rem * 1.6) / (rem * (ui::kCategoryWidthRem + 1.6))), 2, 8);
                std::vector<ui::CardData> tiles;
                for (const catalog::GenreShelf& shelf : shelves_) {
                    if (shelf.genre.empty() || (shelf.movies.empty() && shelf.shows.empty())) continue;
                    // The genre's picture: the first of its titles with a poster.
                    std::string picture;
                    for (const std::vector<catalog::MediaItem>* list : {&shelf.movies, &shelf.shows}) {
                        for (const catalog::MediaItem& item : *list) {
                            if (Allowed(item) && picture.empty() && !item.poster.empty()) picture = item.poster;
                        }
                    }
                    if (profileMaxAge_ < 18 && picture.empty()) continue;
                    ui::CardData tile{"browse:" + shelf.genre, shelf.genre, picture, std::nullopt};
                    tile.category = true;
                    tiles.push_back(tile);
                }
                for (std::size_t i = 0; i < tiles.size(); i += tilesPerRow) {
                    ui::RailData rail;
                    rail.id = "search-browse-" + std::to_string(i / tilesPerRow);
                    if (i == 0) rail.title = "Browse";
                    for (std::size_t j = i; j < std::min(i + tilesPerRow, tiles.size()); ++j) rail.cards.push_back(tiles[j]);
                    lane.rails.push_back(std::move(rail));
                }
            }
            for (const std::string& recent : idle ? recentSearches_ : std::vector<std::string>{}) {
                ui::Command again;
                again.name = "search-recent";
                again.action = true;
                again.params["query"] = recent;
                lane.topButtons.push_back(ui::TopButton{recent, again, false});
            }
            const std::vector<catalog::HomeRail> rails =
                catalog::BuildHomeRails(bundle_, shelves_, {}, {}, CurrentYear());
            const catalog::HomeRail* popular = nullptr;
            for (const catalog::HomeRail& rail : rails) {
                std::string title = rail.title;
                for (char& c : title) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                if (!rail.items.empty() && (title.find("popular") != std::string::npos ||
                                            title.find("trending") != std::string::npos)) {
                    popular = &rail;
                    break;
                }
            }
            if (popular == nullptr) {
                for (const catalog::HomeRail& rail : rails) {
                    if (!rail.items.empty()) {
                        popular = &rail;
                        break;
                    }
                }
            }
            // Popular now when nothing matched, or when there are no genres to browse yet.
            if (popular != nullptr && (nothing || lane.rails.empty())) {
                ui::RailData rail;
                rail.id = "search-popular";
                rail.title = idle ? "Popular now" : "Popular now \xC2\xB7 try one of these";
                for (std::size_t i = 0; i < popular->items.size() && i < perRow * 2; ++i) {
                    if (Allowed(popular->items[i])) rail.cards.push_back(card(popular->items[i]));
                }
                lane.rails.push_back(std::move(rail));
            }
        }
        const auto passes = [this](const catalog::MediaItem& item) {
            if (!Allowed(item)) return false;
            if (searchFilter_ == "movies") return item.kind != "series";
            if (searchFilter_ == "series") return item.kind == "series";
            return true;
        };
        // The Top Result: the best match, when it is the title typed or starts with it, as a large card first.
        std::string topId;
        if (!searchResults_.empty() && passes(searchResults_.front())) {
            const catalog::MediaItem& best = searchResults_.front();
            std::string wanted = util::Trim(searchQuery_);
            std::string title = best.title;
            for (char& c : wanted) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            for (char& c : title) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            if (!wanted.empty() && title.rfind(wanted, 0) == 0) {
                topId = best.id;
                ui::RailData rail;
                rail.id = "search-top";
                rail.title = "Top Result";
                ui::CardData feature{best.id, best.title, best.backdrop.empty() ? best.poster : best.backdrop, std::nullopt};
                feature.feature = true;
                feature.subtitle = std::string(best.kind == "series" ? "Series" : "Movie") +
                                   (best.year.has_value() ? " \xC2\xB7 " + std::to_string(*best.year) : std::string());
                rail.cards.push_back(feature);
                lane.rails.push_back(std::move(rail));
            }
        }
        for (const bool series : {false, true}) {
            std::vector<const catalog::MediaItem*> group;
            for (const catalog::MediaItem& item : searchResults_) {
                if ((item.kind == "series") == series && passes(item) && item.id != topId) group.push_back(&item);
            }
            for (std::size_t i = 0; i < group.size(); i += perRow) {
                ui::RailData rail;
                rail.id = std::string(series ? "series-" : "movies-") + std::to_string(i / perRow);
                // Each section says how many it holds.
                if (i == 0) rail.title = std::string(series ? "Series" : "Movies") + " \xC2\xB7 " + std::to_string(group.size());
                for (std::size_t j = i; j < std::min(i + perRow, group.size()); ++j) rail.cards.push_back(card(*group[j]));
                lane.rails.push_back(std::move(rail));
            }
        }
        ShowPageLane(std::move(lane));
    }
    ui::Scene* scene = shell_->SceneNamed("search");
    if (scene == nullptr) return;
    ui::SceneView view;
    view.style = ui::SceneStyle::Search;
    view.query = searchQuery_;
    view.status = searchStatus_;
    // Eight posters a row, the first row titled, as the web grid wraps its results.
    constexpr std::size_t kPerRow = 8;
    for (std::size_t i = 0; i < searchResults_.size(); i += kPerRow) {
        ui::RailData rail;
        rail.id = "results-" + std::to_string(i / kPerRow);
        rail.title = i == 0 ? "Results" : "";
        for (std::size_t j = i; j < std::min(i + kPerRow, searchResults_.size()); ++j) {
            const catalog::MediaItem& item = searchResults_[j];
            rail.cards.push_back(ui::CardData{item.id, item.title, item.poster, std::nullopt});
        }
        view.rails.push_back(std::move(rail));
    }
    scene->SetView(view, NowMs());
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

void App::SyncPlayer() {
    const bool onPlayer = shell_->ActiveScreenName() == "player";
    if (!onPlayer) {
        if (playerOpen_) StopPlayback();
        return;
    }
    if (playerOpen_) return;
    playerOpen_ = true;
    const nav::ViewEntry& entry = nav::ActiveEntry(shell_->stack());
    const auto id = entry.params.find("id");
    playerId_ = id == entry.params.end() ? "" : id->second;
    // The title Details sent along with the play command, a catalogue title.
    const auto titleParam = entry.params.find("title");
    playerTitleHint_ = titleParam == entry.params.end() ? "" : titleParam->second;
    playerRetryAt_.reset();
    playerVersionId_ = entry.params.contains("versionId") ? entry.params.at("versionId") : "";
    playerTrailerUrl_ = entry.params.contains("trailer") ? entry.params.at("trailer") : "";
    playerYtdlpPath_ = entry.params.contains("ytdlp") ? entry.params.at("ytdlp") : "";
    playerPrefs_ = extrasPrefs_;
    sleepDeadline_.reset();
    sleepAtEnd_ = false;
    playerRecoveries_ = 0;
    streamChoices_.clear();
    playerManualHeight_ = 0;
    playerHlsSource_.clear(); playerHlsHeights_.clear(); playerHlsHeight_ = 0; playerHlsSwitching_ = false;
    playerStallSince_ = 0; playerHealthySince_ = 0;
    nextEpisode_.reset();
    nextDismissed_ = false;
    recapDone_ = false;
    creditsWatched_ = false;
    StartPlayback();
    LookUpNextEpisode();
}

void App::StartPlayback() {
    if (!account_.usable && playerId_.rfind("live:free:", 0) != 0) return;
    MONITORINFOEXW monitor{};
    monitor.cbSize = sizeof(monitor);
    DEVMODEW display{};
    display.dmSize = sizeof(display);
    if (GetMonitorInfoW(MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST), &monitor) &&
        EnumDisplaySettingsW(monitor.szDevice, ENUM_CURRENT_SETTINGS, &display))
        playerScreenHeight_ = static_cast<int>(display.dmPelsHeight);
    playerHlsSwitching_ = false; playerStallSince_ = 0; playerHealthySince_ = 0;
    const int generation = ++playerGeneration_;
    playerSegments_ = {}; segmentSession_ = {}; pendingSubtitles_.clear(); externalSubtitles_.clear();
    subtitlePreferenceApplied_ = false; pendingAudioTrackId_.reset(); pendingAudioWaitTicks_ = 0;
    subtitleChoice_.clear(); nextCountdown_ = {};
    audioPreferenceApplied_ = false; playerStyleApplied_ = false; playerNightInitialized_ = false;
    videoClicks_.Cancel(); videoPressed_ = false; minimizePaused_ = false;
    mpv_->Stop();
    overlay_->Show(false);

    // A live channel plays from its own address. A title is looked up through Real-Debrid.
    const auto channel = std::find_if(liveCatalog_.channels.begin(), liveCatalog_.channels.end(),
                                      [this](const catalog::LiveChannel& entry) { return entry.id == playerId_; });
    playerLive_ = playerId_.starts_with("live:");
    if (playerLive_) playerPlanHeight_ = 2160;
    if (playerLive_ && playerId_.rfind("live:free:", 0) != 0 && !account_.liveTv) { ShowPlayerError("Live TV access", "Live TV requires the appropriate account tier."); return; }
    std::string title = channel != liveCatalog_.channels.end() ? channel->name : "";
    // The catalogue's own title, never a file name: the title's details if they were opened, the series for an
    // episode, the title Details passed along, or the show found for a previous episode.
    if (const auto known = titles_.find(playerId_); known != titles_.end() && title.empty()) title = known->second.title;
    const std::optional<playback::PlayId> playId = playback::ParsePlayId(playerId_);
    if (title.empty() && playId.has_value()) {
        if (const auto series = titles_.find(playId->imdb); series != titles_.end()) title = series->second.title;
    }
    if (title.empty()) title = playerTitleHint_;
    if (title.empty() && playId.has_value() && playId->season.has_value()) title = showTitle_;

    playerView_ = ui::PlayerView{};
    playerView_.title = title.empty() ? "Loading" : title;
    playerView_.live = playerLive_;
    playerView_.hideDownloads = kidsProfile_;
    if (channel != liveCatalog_.channels.end() && !content::AllowsLive(parental_, profileMaxAge_, live::GroupOf(*channel))) { ShowPlayerError("Channel unavailable", "This channel is outside this profile's age limit."); return; }
    playerView_.fullscreen = fullscreen_;
    // My List saves the title, or the series for an episode. A Real-Debrid file or a channel is not on it.
    const std::string saveId = SaveId();
    playerView_.canSave = !playerLive_ && !saveId.empty() && saveId.rfind("rd:", 0) != 0;
    playerView_.saved = playerView_.canSave && SavedOnWatchlist(saveId);
    liveBehindSeconds_ = 0.0;
    livePausedAtMs_.reset();
    // A retry or a stream switch keeps the next episode it already found.
    if (nextEpisode_.has_value()) {
        playerView_.nextShow = showTitle_;
        playerView_.nextEpisode = "S" + std::to_string(nextEpisode_->season.value_or(0)) + " E" +
                                  std::to_string(nextEpisode_->episode.value_or(0)) + " \xC2\xB7 " +
                                  nextEpisode_->episodeName.value_or(nextEpisode_->title);
        playerView_.nextStill = nextEpisode_->poster;
    }
    // An episode shows "S1 Â· E2" beside its title, as CinemaControls writes it.
    if (const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_); play && play->season) {
        playerView_.episode = "S" + std::to_string(*play->season) + " \xC2\xB7 E" + std::to_string(*play->episode);
    }
    playerView_.volume = playerVolume_;
    playerView_.muted = playerMuted_;
    shell_->SetPlayerView(playerView_, NowMs());
    dirty_ = true;

    if (!playerTrailerUrl_.empty()) {
        playback::Resolution trailer;
        trailer.url = playerTrailerUrl_;
        trailer.transport = "Trailer";
        trailer.ytdlpPath = playerYtdlpPath_;
        FinishResolve(generation, trailer);
        return;
    }

    if (playerLive_ && channel == liveCatalog_.channels.end()) {
        background_->Run([this, generation, id = playerId_, title] {
            PrepareMpv(*core_);
            auto resolved = CorePlayback(id, title, 0);
            background_->PostToUi([this, generation, resolved] { FinishResolve(generation, resolved); });
        });
        return;
    }

    if (playerLive_) {
        playback::Resolution resolution;
        resolution.title = channel->name;
        resolution.url = channel->url;
        if (resolution.url.empty()) {
            if (const std::optional<xtream::Account> account = xtream_->Saved()) {
                // The channel id carries the "live:xtream:" prefix; the panel's address wants only its stream id.
                resolution.url = xtream_->StreamUrl(*account, xtream::StreamIdOf(channel->id));
            }
        }
        if (resolution.url.empty()) resolution.reason = "unsupported";
        background_->Run([this, generation, resolution, height = playerManualHeight_ > 0 ? playerManualHeight_ : playerScreenHeight_]() mutable {
            PrepareMpv(*core_);
            PrepareHls(resolution, height);
            background_->PostToUi([this, generation, resolution] { FinishResolve(generation, resolution); });
        });
        return;
    }

    background_->Run([this, generation, id = playerId_, title, height = playerManualHeight_ > 0 ? playerManualHeight_ : playerScreenHeight_, version = playerVersionId_] {
        PrepareMpv(*core_);
        playback::Resolution resolution = CorePlayback(id, title, height, version, true);
        background_->PostToUi([this, generation, resolution] { FinishResolve(generation, resolution); });
    });
}

void App::FinishResolve(int generation, const playback::Resolution& resolution) {
    // The viewer may have left, or pressed Retry, while the stream was being found.
    if (generation != playerGeneration_ || !playerOpen_) return;
    if (!resolution.ok()) {
        const std::string& reason = resolution.reason;
        // A failed search is tried twice more before the viewer is told, as Player.tsx retries it.
        if (!playerLive_ && playerRecoveries_ < 2 && (reason == "empty" || reason == "unsupported")) {
            ++playerRecoveries_;
            StartPlayback();
            return;
        }
        std::string title = "Playback stopped";
        if (reason == "empty") title = "No streams found";
        if (reason == "not-in-library") title = "No stream yet";
        if (reason == "unsupported") title = "Can\xE2\x80\x99t open this file";
        if (reason == "needs-auth" || reason == "not-configured") title = "Real-Debrid token";
        ShowPlayerError(title, playback::ErrorMessage(reason));
        return;
    }

    const std::optional<std::filesystem::path> executable = mpv::FindMpvExecutable(util::ProcessEnvironment());
    if (!executable.has_value()) {
        ShowPlayerError("Playback stopped",
                        "Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.");
        return;
    }

    // A part-watched title starts where the viewer left it, unless a retry asked for its own place.
    std::optional<double> startAt = playerRetryAt_;
    if (!startAt.has_value() && !playerLive_ && playerTrailerUrl_.empty()) {
        if (const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_)) {
            const catalog::ProgressMap progress = catalog::ReadProgress(*folder);
            if (progress.is_object() && progress.contains(playerId_)) startAt = catalog::ResumePosition(progress[playerId_]);
        }
    }

    if (!resolution.preferences.is_null()) playerPrefs_ = extras::ParsePreferences(resolution.preferences);
    playerView_.canShowShortcuts = playerPrefs_.Enabled("shortcutsOverlay");
    playerView_.sleepTimer = playerPrefs_.Enabled("sleepTimer");
    playerView_.sleepAtEnd = sleepAtEnd_;
    playerView_.nightAvailable = true;
    playerView_.nightMode = playerPrefs_.Enabled("nightMode");
    playerAudioLanguage_ = playerPrefs_.audioLanguage == "original" ? resolution.originalLanguage : playerPrefs_.audioLanguage;
    playerTransport_ = resolution.transport.empty() ? playback::PlaybackTransport(resolution.url, "", "") : resolution.transport;
    playerVersionLabel_ = playback::VersionLabel(resolution.version);
    const auto current = resolution.version.is_object() ? resolution.version.value("id", playerVersionId_) : playerVersionId_;
    playerView_.versions.clear();
    if (playerPrefs_.Enabled("versionPicker")) for (const auto& version : resolution.versions) {
        if (!version.is_object() || !version.contains("id") || !version["id"].is_string()) continue;
        const auto id = version["id"].get<std::string>();
        if (!id.empty()) playerView_.versions.push_back({id, playback::VersionLabel(version), "", id == current});
    }
    if (resolution.bestHeight > 0) playerPlanHeight_ = resolution.bestHeight;
    playerBestHeight_ = std::min(playerScreenHeight_, playerPlanHeight_);
    if (!resolution.hlsSource.empty()) {
        playerHlsSource_ = resolution.hlsSource; playerHlsHeight_ = resolution.hlsHeight;
        playerHlsHeights_ = resolution.hlsHeights;
    }
    // A fresh search brings the quality menu's streams. A switch from that menu keeps them.
    if (!resolution.choices.empty()) {
        streamChoices_ = resolution.choices;
        streamChosen_ = resolution.chosen;
    }
    ShowStreamChoices();
    // The stream's title only fills in when the catalogue had none; it never replaces a catalogue title.
    if (!resolution.title.empty() && playerView_.title == "Loading") playerView_.title = resolution.title;
    playerView_.phase = ui::PlayerView::Phase::Playing;
    playerView_.position = startAt.value_or(0.0);
    // The remote hints show the first time anything plays, and never again.
    if (!hintsSeen_) {
        hintsSeen_ = true;
        playerView_.hints = true;
        try {
            util::WriteFileAtomically(dataDir_ / "player-hints-seen", "1");
        } catch (const std::exception&) {
            // Without the file the hints show once more, next run.
        }
    }
    shell_->SetPlayerView(playerView_, NowMs());
    lastProgressSaveMs_ = NowMs();
    // Thumbnails are made from the stream that plays, so a new stream starts their set again.
    if (playerUrl_ != resolution.url) {
        playerUrl_ = resolution.url;
        thumbnails_.clear();
        ++thumbnailSession_;
    }
    pendingSubtitles_.clear(); externalSubtitles_.clear(); subtitlePreferenceApplied_ = false;
    if (mpv_->Start(*executable, resolution.url, startAt, playerVolume_, playerMuted_, resolution.ytdlpPath, playerAudioLanguage_)) {
        overlay_->Show(true);
        LoadPlayerExtras(generation, resolution);
    }
    dirty_ = true;
}

void App::OnPlayerState(const mpv::State& state) {
    if (!playerOpen_) return;
    playerView_.position = state.position;
    UpdatePlaybackTools(state);
    if (state.duration > 0.0) playerView_.duration = state.duration;
    playerView_.paused = state.paused;
    playerView_.started = state.started;
    playerView_.buffering = mpv::Buffering(state);
    playerView_.speed = state.speed;
    if (playerLive_ && !playerHlsSource_.empty() && !playerHlsSwitching_ && playerManualHeight_ == 0 && state.started && !state.paused) {
        const double now = NowMs();
        if (state.pausedForCache) {
            playerHealthySince_ = 0;
            if (playerStallSince_ == 0) playerStallSince_ = now;
            if (now - playerStallSince_ >= 4000) {
                int lower = playerHlsHeight_;
                for (int height : playerHlsHeights_) if (height < playerHlsHeight_) lower = height;
                if (lower < playerHlsHeight_) SwitchHls(lower);
            }
        } else {
            playerStallSince_ = 0;
            if (playerHealthySince_ == 0) playerHealthySince_ = now;
            const int best = playerBestHeight_;
            if (now - playerHealthySince_ >= 15000 && playerHlsHeight_ < best && state.cacheSeconds >= 5) {
                int higher = playerHlsHeight_;
                for (int height : playerHlsHeights_) if (height <= best) higher = height;
                if (higher > playerHlsHeight_) SwitchHls(higher);
            }
        }
    }
    playerView_.cacheSpeed = state.cacheSpeed;
    playerView_.cacheSeconds = state.cacheSeconds;
    playerView_.bufferPercent = state.bufferPercent;
    // A paused channel keeps broadcasting, so the pause is how far behind it falls.
    if (playerLive_ && state.paused && !livePausedAtMs_.has_value()) livePausedAtMs_ = NowMs();
    if (playerLive_ && !state.paused && livePausedAtMs_.has_value()) {
        liveBehindSeconds_ += (NowMs() - *livePausedAtMs_) / 1000.0;
        livePausedAtMs_.reset();
    }
    playerView_.liveBehind = liveBehindSeconds_;

    // The tracks become the subtitle and audio menus, and the picture's height the quality button's word.
    playerView_.subtitles.clear();
    playerView_.audios.clear();
    bool subtitleOn = false;
    for (const mpv::Track& track : state.tracks) {
        if (track.type == "sub") {
            playerView_.subtitles.push_back(
                ui::PlayerOption{std::to_string(track.id), mpv::TrackLabel(track), track.lang, track.selected});
            subtitleOn = subtitleOn || track.selected;
        } else if (track.type == "audio") {
            playerView_.audios.push_back(
                ui::PlayerOption{std::to_string(track.id), mpv::TrackLabel(track), mpv::AudioDetail(track), track.selected});
        } else if (track.type == "video" && track.selected && track.height > 0) {
            playerView_.qualityLabel = track.height >= 2000 ? "4K" : std::to_string(track.height) + "p";
            std::string hdrHint = state.hdr + " " + playerVersionLabel_;
            if (streamChosen_ < streamChoices_.size()) hdrHint += " " + streamChoices_[streamChosen_].detail;
            if (hdrHint.find("Dolby Vision") != std::string::npos || hdrHint.find(" DV") != std::string::npos) {
                playerView_.qualityLabel += " DV";
            } else if (hdrHint.find("HDR") != std::string::npos) {
                playerView_.qualityLabel += " HDR";
            }
        }
    }
    for (std::size_t i = 0; i < externalSubtitles_.size(); ++i) {
        const auto& track = externalSubtitles_[i];
        if (!track.loaded) playerView_.subtitles.push_back({"external:" + std::to_string(i), track.label, track.loading ? "Loading..." : "OpenSubtitles", false});
    }
    if (!playerView_.subtitles.empty()) {
        playerView_.subtitles.insert(playerView_.subtitles.begin(), ui::PlayerOption{"no", "Off", "", !subtitleOn});
    }

    ApplyExtrasState(state);
    if (!sleepAtEnd_ && playerView_.nextUp && playerPrefs_.autoplay && playerView_.nextRemaining <= 0 && !state.paused && !mpv::Buffering(state)) {
        PlayNextEpisode(); return;
    }
    // A picture means the stream works, so the retries start again from nothing.
    if (state.started) playerRecoveries_ = 0;
    shell_->SetPlayerView(playerView_, NowMs());
    SavePlayerProgress(false);
    dirty_ = true;
}

void App::OnPlayerError(const std::string& message) {
    if (!playerOpen_) return;
    if (playerLive_ && playerId_.rfind("live:free:", 0) == 0) {
        const auto channel = std::find_if(liveCatalog_.channels.begin(), liveCatalog_.channels.end(),
            [this](const auto& entry) { return entry.id == playerId_; });
        const bool bbc = channel != liveCatalog_.channels.end() && channel->geo == "GB" && channel->name.rfind("BBC", 0) == 0;
        playerView_.errorNextChannel = true;
        ShowPlayerError("Channel unavailable", bbc ? "BBC channels play in the UK only" : "This channel isn't available right now");
        return;
    }
    // A stream that fails is found again at the same place, twice, before the viewer is told.
    const bool missing = message.find("not installed") != std::string::npos;
    if (!playerLive_ && playerTrailerUrl_.empty() && !missing && playerRecoveries_ < 2) {
        ++playerRecoveries_;
        playerRetryAt_ = playerView_.position > 0.0 ? std::optional<double>(playerView_.position) : playerRetryAt_;
        StartPlayback();
        return;
    }
    ShowPlayerError("Playback stopped", message);
}

void App::ShowPlayerError(const std::string& title, const std::string& body) {
    SavePlayerProgress(true);
    mpv_->Stop();
    overlay_->Show(false);
    playerView_.phase = ui::PlayerView::Phase::Error;
    playerView_.errorTitle = title;
    playerView_.errorBody = body;
    shell_->SetPlayerView(playerView_, NowMs());
    dirty_ = true;
}

void App::SavePlayerProgress(bool force) {
    // Progress is saved every ten seconds while the title plays, and whenever it stops, as Player.tsx saves it.
    if (playerLive_ || !playerTrailerUrl_.empty() || playerId_.empty() || playerView_.duration <= 0.0 || !playerView_.started) return;
    const double now = NowMs();
    if (!force && now - lastProgressSaveMs_ < 10000.0) return;
    lastProgressSaveMs_ = now;
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    if (!folder.has_value()) return;
    homeStale_ = true;
    // Core records watched time before saving the new position. Writing the shared file first would lose that delta.
    const auto id = playerId_; const auto position = playerView_.position; const auto duration = playerView_.duration;
    background_->Run([this, folder = *folder, id, position, duration] {
        if (profiles::ActiveFolder(dataDir_) != std::optional<paths::fs::path>(folder)) return;
        try { core_->Call("/api/progress", "POST", {{"id", id}, {"position", position}, {"duration", duration}}); }
        catch (...) { try { catalog::WriteProgress(folder, id, position, duration); } catch (...) {} }
        background_->PostToUi([this, folder] {
            if (profiles::ActiveFolder(dataDir_) != std::optional<paths::fs::path>(folder)) return;
            homeStale_ = true;
            if (!playerOpen_) RebuildHome();
        });
    });
}

void App::StopPlayback() {
    SavePlayerProgress(true);
    ++playerGeneration_;
    mpv_->Stop();
    overlay_->Show(false);
    playerOpen_ = false;
    videoClicks_.Cancel();
    videoPressed_ = false;
    if (fullscreen_) ToggleFullscreen();
    playerView_ = ui::PlayerView{};
    // Continue watching follows what was just watched.
    if (homeStale_) RebuildHome();
    streamOpened_ = false;
    dirty_ = true;
}

void App::ChangeVolume(double delta) {
    SetVolume(playerVolume_ + delta);
}

void App::SetVolume(double level, bool save) {
    // Steps land on whole percents, so ten presses up from 100% read 200%, not 199.99%.
    playerVolume_ = std::clamp(std::round(level * 100.0) / 100.0, 0.0, ui::kMaxVolume);
    if (playerVolume_ > 0.0) playerMuted_ = false;
    mpv_->SetAudio(playerVolume_, playerMuted_);
    playerView_.volume = playerVolume_;
    playerView_.muted = playerMuted_;
    shell_->SetPlayerView(playerView_, NowMs());
    if (save) SaveAudio();
    dirty_ = true;
}

void App::LoadAudio() {
    const std::optional<std::string> text = util::ReadTextFile(dataDir_ / "player-audio.json");
    if (!text.has_value()) return;
    const nlohmann::json stored = nlohmann::json::parse(*text, nullptr, false);
    if (!stored.is_object()) return;
    if (stored.contains("volume") && stored["volume"].is_number()) {
        playerVolume_ = std::clamp(stored["volume"].get<double>(), 0.0, ui::kMaxVolume);
    }
    if (stored.contains("muted") && stored["muted"].is_boolean()) playerMuted_ = stored["muted"].get<bool>();
}

void App::SaveAudio() const {
    try {
        util::WriteFileAtomically(dataDir_ / "player-audio.json",
                                  nlohmann::json{{"volume", playerVolume_}, {"muted", playerMuted_}}.dump());
    } catch (const std::exception&) {
        // The level is kept for this run. The next change tries the file again.
    }
}

void App::ToggleFullscreen() {
    const LONG_PTR style = GetWindowLongPtrW(window_, GWL_STYLE);
    if (!fullscreen_) {
        MONITORINFO monitor{sizeof(MONITORINFO)};
        if (!GetWindowPlacement(window_, &windowedPlacement_) ||
            !GetMonitorInfoW(MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST), &monitor)) {
            return;
        }
        SetWindowLongPtrW(window_, GWL_STYLE, style & ~static_cast<LONG_PTR>(WS_OVERLAPPEDWINDOW));
        const RECT& area = monitor.rcMonitor;
        SetWindowPos(window_, HWND_TOP, area.left, area.top, area.right - area.left, area.bottom - area.top,
                     SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        fullscreen_ = true;
    } else {
        SetWindowLongPtrW(window_, GWL_STYLE, style | WS_OVERLAPPEDWINDOW);
        SetWindowPlacement(window_, &windowedPlacement_);
        SetWindowPos(window_, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        fullscreen_ = false;
    }
    playerView_.fullscreen = fullscreen_;
    shell_->SetPlayerView(playerView_, NowMs());
    if (ui::PlayerScreen* player = shell_->ActivePlayer()) player->ShowChrome(NowMs());
    if (overlay_) overlay_->ResetZOrder();
    dirty_ = true;
}

void App::ApplyPlayerAction(const ui::Command& command) {
    const double now = NowMs();
    if (command.name == "player-close") {
        shell_->Back(now);
    } else if (command.name == "player-retry") {
        if (playerView_.errorNextChannel) {
            const auto current = std::find_if(liveCatalog_.channels.begin(), liveCatalog_.channels.end(),
                [this](const auto& channel) { return channel.id == playerId_; });
            const std::size_t start = current == liveCatalog_.channels.end() ? 0 : static_cast<std::size_t>(current - liveCatalog_.channels.begin()) + 1;
            for (std::size_t n = 0; n < liveCatalog_.channels.size(); ++n) {
                const auto& channel = liveCatalog_.channels[(start + n) % liveCatalog_.channels.size()];
                if (channel.id.rfind("live:free:", 0) != 0 || !content::AllowsLive(parental_, profileMaxAge_, live::GroupOf(channel))) continue;
                playerId_ = channel.id;
                StartPlayback();
                return;
            }
        }
        playerRecoveries_ = 0;
        playerRetryAt_ = playerView_.position > 0.0 ? std::optional<double>(playerView_.position) : std::nullopt;
        StartPlayback();
    } else if (playerView_.phase != ui::PlayerView::Phase::Playing) {
        return;
    } else if (command.name == "player-toggle") {
        // The new state shows at once, before mpv confirms it, as the web engine flips it first.
        playerView_.paused = !playerView_.paused;
        mpv_->SetPaused(playerView_.paused);
        if (auto* player = shell_->ActivePlayer()) player->FlashPlayback(playerView_.paused, now);
        SavePlayerProgress(true);
    } else if (command.name == "player-seek") {
        const auto delta = command.params.find("delta");
        if (delta != command.params.end() && !playerLive_) mpv_->SeekBy(std::stod(delta->second));
    } else if (command.name == "player-seek-to") {
        const auto seconds = command.params.find("seconds");
        if (seconds != command.params.end() && !playerLive_) {
            playerView_.position = std::stod(seconds->second);
            mpv_->SeekTo(playerView_.position);
        }
    } else if (command.name == "player-mute") {
        // Unmuting a silent player brings the sound back at half volume rather than to silence.
        if (playerMuted_ && playerVolume_ <= 0.0) {
            playerMuted_ = false;
            SetVolume(0.5);
            return;
        }
        playerMuted_ = !playerMuted_;
        mpv_->SetAudio(playerVolume_, playerMuted_);
        playerView_.muted = playerMuted_;
        SaveAudio();
    } else if (command.name == "player-volume") {
        const auto level = command.params.find("level");
        if (level != command.params.end()) SetVolume(std::stod(level->second));
    } else if (command.name == "player-fullscreen") {
        ToggleFullscreen();
    } else if (command.name == "player-pick") {
        const auto kind = command.params.find("kind");
        const auto id = command.params.find("id");
        if (kind != command.params.end() && id != command.params.end()) PickPlayerOption(kind->second, id->second);
    } else if (command.name == "player-next") {
        PlayNextEpisode();
        return;
    } else if (command.name == "player-next-dismiss") {
        nextDismissed_ = true;
        playerView_.nextUp = false;
    } else if (command.name == "player-go-live") {
        // The channel is opened again, which lands at its live edge, as catching up does on the web.
        liveBehindSeconds_ = 0.0;
        livePausedAtMs_.reset();
        StartPlayback();
        return;
    } else if (command.name == "player-watchlist") {
        const std::string id = SaveId();
        if (titles_.contains(id)) {
            ToggleWatchlist(id);
            playerView_.saved = SavedOnWatchlist(id);
        } else {
            // The list saves the catalogue's record, so the title is read first and saved when it arrives.
            pendingSave_ = id;
            ShowTitle(id);
        }
    } else if (command.name == "player-skip-recap") {
        playerView_.recap = false;
        mpv_->SeekTo(playerView_.recapEnd);
    } else if (command.name == "player-skip-credits") {
        // To the very end, so the title finishes as it would have, and counts as watched.
        playerView_.credits = false;
        mpv_->SeekTo(std::max(0.0, playerView_.duration - 0.08));
    } else if (command.name == "player-watch-credits") {
        creditsWatched_ = true;
        playerView_.credits = false;
    }
    shell_->SetPlayerView(playerView_, now);
    if (ui::PlayerScreen* player = shell_->ActivePlayer()) player->ShowChrome(now);
    dirty_ = true;
}

void App::PickPlayerOption(const std::string& kind, const std::string& id) {
    if (kind == "versions") {
        playerVersionId_ = id;
        playerManualHeight_ = 0;
        playerRetryAt_ = playerView_.position;
        playerRecoveries_ = 0;
        StartPlayback();
    } else if (kind == "sleep") {
        sleepAtEnd_ = id == "end";
        const int minutes = sleepAtEnd_ ? 0 : std::stoi(id);
        sleepDeadline_ = minutes > 0 ? std::optional(NowMs() + minutes * 60000.0) : std::nullopt;
        playerView_.sleepAtEnd = sleepAtEnd_;
        playerView_.sleepMinutes = minutes;
    } else if (kind == "more") {
        if (id == "stats") { playerView_.showStats = !playerView_.showStats; playerView_.showShortcuts = false; }
        else if (id == "shortcuts") { playerView_.showShortcuts = !playerView_.showShortcuts; playerView_.showStats = false; }
        else if (id == "night") {
            playerView_.nightMode = !playerView_.nightMode;
            mpv_->SetNightMode(playerView_.nightMode);
        } else if (id.starts_with("chapter-")) {
            if (const auto time = mpv::AdjacentChapter(playerView_.chapters, playerView_.position, id == "chapter-next" ? 1 : -1))
                mpv_->SeekTo(*time);
        }
    } else if (kind == "cc") {
        if (id.starts_with("external:")) {
            const auto index = std::stoul(id.substr(9));
            if (index < externalSubtitles_.size()) {
                subtitleChoice_ = externalSubtitles_[index].language;
                subtitlePreferenceApplied_ = false;
                if (const auto folder = profiles::ActiveFolder(dataDir_)) try { util::WriteFileAtomically(*folder / "native-subtitle-language", subtitleChoice_); } catch (...) {}
                RequestSubtitle(index);
            }
            return;
        }
        subtitlePreferenceApplied_ = true;
        mpv_->SetProperty("sid", id == "no" ? nlohmann::json("no") : nlohmann::json(std::stoi(id)));
        std::string language = id == "no" ? "off" : "";
        for (const auto& option : playerView_.subtitles) if (option.id == id && id != "no") language = option.detail;
        if (!language.empty()) {
            subtitleChoice_ = language;
            if (const auto folder = profiles::ActiveFolder(dataDir_)) try { util::WriteFileAtomically(*folder / "native-subtitle-language", language); } catch (...) {}
        }
    } else if (kind == "audio") {
        audioPreferenceApplied_ = true;
        subtitlePreferenceApplied_ = false;
        const int trackId = std::stoi(id);
        pendingAudioTrackId_ = trackId;
        pendingAudioWaitTicks_ = 12;
        mpv_->SetProperty("aid", trackId);
    } else if (kind == "speed") {
        playerView_.speed = std::stod(id);
        mpv_->SetProperty("speed", playerView_.speed);
    } else if (kind == "quality") {
        if (id == "auto") {
            playerManualHeight_ = 0;
            if (!playerHlsSource_.empty()) { SwitchHls(playerBestHeight_); return; }
            playerRetryAt_ = playerView_.position;
            StartPlayback();
        } else {
            const auto choice = std::stoul(id);
            if (choice < streamChoices_.size()) {
                playerManualHeight_ = streamChoices_[choice].height;
                if (!playerHlsSource_.empty()) SwitchHls(playerManualHeight_);
                else SwitchStream(choice);
                ShowStreamChoices();
                shell_->SetPlayerView(playerView_, NowMs());
            }
        }
    }
}

void App::ShowStreamChoices() {
    playerView_.qualities.clear();
    if (!playerLive_ || !playerHlsSource_.empty()) playerView_.qualities.push_back({"auto", "Auto (best: " + std::to_string(playerBestHeight_) + "p)", "", playerManualHeight_ == 0});
    for (std::size_t i = 0; i < streamChoices_.size(); ++i) {
        const playback::StreamChoice& choice = streamChoices_[i];
        playerView_.qualities.push_back(ui::PlayerOption{std::to_string(i), choice.label, choice.detail, playerManualHeight_ > 0 && (playerHlsSource_.empty() ? i == streamChosen_ : choice.height == playerHlsHeight_)});
    }
}

void App::SwitchStream(std::size_t choice) {
    if (choice >= streamChoices_.size() || choice == streamChosen_) return;
    // The other stream starts where this one is, as a retry does.
    const playback::StreamChoice wanted = streamChoices_[choice];
    const double at = playerView_.position;
    const int generation = ++playerGeneration_;
    const std::string title = playerView_.title;
    mpv_->Stop();
    overlay_->Show(false);
    playerRetryAt_ = at > 0.0 ? std::optional<double>(at) : std::nullopt;
    playerView_.phase = ui::PlayerView::Phase::Resolving;
    playerView_.started = false;
    shell_->SetPlayerView(playerView_, NowMs());
    background_->Run([this, generation, wanted, choice, title, id = playerId_] {
        playback::Resolution resolution = CorePlayback(id, title, wanted.height);
        background_->PostToUi([this, generation, resolution, choice] {
            if (generation != playerGeneration_ || !playerOpen_) return;
            if (resolution.ok()) streamChosen_ = choice;
            FinishResolve(generation, resolution);
        });
    });
    dirty_ = true;
}

void App::SyncThumbnail() {
    ui::PlayerScreen* player = shell_->ActivePlayer();
    if (player == nullptr || playerUrl_.empty() || !playerPrefs_.Enabled("seekPreviews") || !playerTrailerUrl_.empty()) return;
    const std::optional<double> seconds = player->PreviewSeconds();
    if (!seconds.has_value()) return;
    // One picture per ten-second stretch, taken from its middle.
    const int bucket = static_cast<int>(*seconds / 10.0) * 10;
    if (const auto found = thumbnails_.find(bucket); found != thumbnails_.end()) {
        if (playerView_.thumbnail != found->second) {
            playerView_.thumbnail = found->second;
            playerView_.thumbnailTime = bucket + 5.0;
            shell_->SetPlayerView(playerView_, NowMs());
        }
        return;
    }
    if (thumbnailBusy_) return;
    const std::optional<std::filesystem::path> executable = mpv::FindMpvExecutable(util::ProcessEnvironment());
    if (!executable.has_value()) return;

    thumbnailBusy_ = true;
    const int session = thumbnailSession_;
    std::error_code ignored;
    const std::filesystem::path folder = std::filesystem::temp_directory_path(ignored) / "tvm-trickplay" /
                                         std::to_string(GetCurrentProcessId()) / std::to_string(session) /
                                         std::to_string(bucket);
    background_->Run([this, executable = *executable, folder, session, bucket, url = playerUrl_] {
        std::error_code error;
        std::filesystem::create_directories(folder, error);
        const bool ran = !error && MpvPlayer::RunOnce(executable, mpv::BuildThumbnailArgs(url, bucket + 5.0, util::ToUtf8(folder.wstring())), 20000);
        // mpv names the frame 00000001.jpg in the folder it was given.
        const std::filesystem::path picture = folder / "00000001.jpg";
        const bool made = ran && std::filesystem::exists(picture, error);
        background_->PostToUi([this, session, bucket, made, picture] {
            thumbnailBusy_ = false;
            if (session != thumbnailSession_) return;
            // A stretch that could not be pictured is not asked for again, so a hover there stays cheap.
            thumbnails_[bucket] = made ? util::ToUtf8(picture.wstring()) : std::string();
            dirty_ = true;
        });
    });
}

void App::LookUpNextEpisode() {
    const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_);
    if (!play.has_value() || !play->season.has_value() || playerLive_) return;
    const std::string current = playerId_;
    background_->Run([this, current, play = *play] {
        std::optional<catalog::TitleMeta> meta;
        try {
            meta = catalog_->Meta(play.imdb);
        } catch (const std::exception&) {
            return;
        }
        if (!meta.has_value()) return;
        // The next episode in Cinemeta's order, which runs by season then number, specials last, and this one's name.
        std::optional<catalog::MediaItem> next;
        std::string episodeName;
        for (std::size_t i = 0; i < meta->children.size(); ++i) {
            const catalog::MediaItem& item = meta->children[i];
            if (item.season == play.season && item.episode == play.episode) {
                episodeName = item.episodeName.value_or("");
                if (i + 1 < meta->children.size()) {
                    const catalog::MediaItem& after = meta->children[i + 1];
                    if (after.season.value_or(0) > 0 && (!after.aired || *after.aired <= util::IsoTimestamp())) next = after;
                }
                break;
            }
        }
        const std::string show = meta->item.title;
        background_->PostToUi([this, current, next, show, episodeName] {
            if (playerId_ != current) return;
            nextEpisode_ = next;
            showTitle_ = show;
            // An episode reads as its show, with "S1 Â· E2 Â· Episode name" under it.
            bool changed = false;
            if (!show.empty() && playerView_.title != show) {
                playerView_.title = show;
                changed = true;
            }
            if (!episodeName.empty() && playerView_.episodeTitle != episodeName) {
                playerView_.episodeTitle = episodeName;
                changed = true;
            }
            if (changed && !next.has_value()) shell_->SetPlayerView(playerView_, NowMs());
            if (next.has_value()) {
                playerView_.nextShow = show;
                playerView_.nextEpisode = "S" + std::to_string(next->season.value_or(0)) + " E" +
                                          std::to_string(next->episode.value_or(0)) + " \xC2\xB7 " +
                                          next->episodeName.value_or(next->title);
                playerView_.nextStill = next->poster;
                QueueArtwork(next->poster);
                shell_->SetPlayerView(playerView_, NowMs());
            }
        });
    });
}

void App::PlayNextEpisode() {
    if (!nextEpisode_.has_value()) return;
    const catalog::MediaItem next = *nextEpisode_;
    const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_);
    SavePlayerProgress(true);
    playerId_ = next.id.find(':') != std::string::npos
                    ? next.id
                    : (play.has_value() ? play->imdb : playerId_) + ":" + std::to_string(next.season.value_or(1)) + ":" +
                          std::to_string(next.episode.value_or(1));
    playerRetryAt_.reset();
    playerRecoveries_ = 0;
    streamChoices_.clear();
    playerManualHeight_ = 0;
    playerHlsSource_.clear(); playerHlsHeights_.clear(); playerHlsHeight_ = 0; playerHlsSwitching_ = false;
    playerStallSince_ = 0; playerHealthySince_ = 0;
    nextEpisode_.reset();
    nextDismissed_ = false;
    recapDone_ = false;
    creditsWatched_ = false;
    StartPlayback();
    LookUpNextEpisode();
}

bool App::HandleScrub(UINT message, POINT point) {
    ui::PlayerScreen* player = shell_->ActivePlayer();
    if (player == nullptr || player->view().phase != ui::PlayerView::Phase::Playing) return false;
    // The volume bar: a press sets the level at once, a drag holds the mouse and follows it, and the release lets go.
    // Every step reaches mpv straight away.
    switch (message) {
    case WM_LBUTTONDOWN:
        if (!player->MenuOpen()) {
            if (const std::optional<double> level = player->VolumeAt(point.x, point.y)) {
                volumeDragging_ = true;
                SetCapture(window_);
                player->SetVolumeDragging(true);
                SetVolume(*level, false);
                return true;
            }
        }
        break;
    case WM_MOUSEMOVE:
        if (volumeDragging_) {
            SetVolume(player->VolumeAtX(point.x), false);
            return true;
        }
        break;
    case WM_LBUTTONUP:
        if (volumeDragging_) {
            volumeDragging_ = false;
            player->SetVolumeDragging(false);
            ReleaseCapture();
            SetVolume(player->VolumeAtX(point.x));
            return true;
        }
        break;
    default:
        break;
    }
    if (player->view().live) return false;
    const ui::Box track = player->TrackBox();
    const bool onTrack = point.x >= track.x && point.x < track.Right() && point.y >= track.y && point.y < track.Bottom();
    switch (message) {
    case WM_LBUTTONDOWN:
        if (!onTrack || player->MenuOpen()) return false;
        // The drag holds the mouse, so it keeps following the bar past its ends.
        scrubbing_ = true;
        SetCapture(window_);
        player->Scrub(player->ShareAt(point.x).value_or(0.0));
        dirty_ = true;
        return true;
    case WM_MOUSEMOVE:
        if (scrubbing_) {
            player->Scrub(player->ShareAt(point.x).value_or(0.0));
        } else {
            player->Hover(onTrack ? player->ShareAt(point.x) : std::nullopt);
        }
        dirty_ = true;
        return scrubbing_;
    case WM_LBUTTONUP: {
        if (!scrubbing_) return false;
        scrubbing_ = false;
        ReleaseCapture();
        if (const std::optional<double> seconds = player->EndScrub()) {
            ui::Command command;
            command.name = "player-seek-to";
            command.action = true;
            command.params["seconds"] = std::to_string(*seconds);
            ApplyPlayerAction(command);
        }
        dirty_ = true;
        return true;
    }
    default:
        return false;
    }
}

bool App::HandlePlayerKey(WPARAM virtualKey, LPARAM flags) {
    ui::PlayerScreen* player = shell_->ActivePlayer();
    if (player == nullptr || player->view().phase != ui::PlayerView::Phase::Playing) return false;
    const double now = NowMs();
    const char* tool = nullptr;
    if (virtualKey == 'I') tool = "stats";
    else if (virtualKey == VK_OEM_2 && KeyDown(VK_SHIFT) && playerView_.canShowShortcuts) tool = "shortcuts";
    else if (virtualKey == VK_OEM_4 && !playerView_.chapters.empty()) tool = "chapter-previous";
    else if (virtualKey == VK_OEM_6 && !playerView_.chapters.empty()) tool = "chapter-next";
    if (tool) {
        if (!(flags & (1 << 30))) {
            player->CloseMenu();
            ApplyPlayerAction(ui::Command{false, "player-pick", {{"kind", "more"}, {"id", tool}}, true});
        }
        return true;
    }
    if (virtualKey == VK_ESCAPE && (playerView_.showShortcuts || playerView_.showStats)) {
        playerView_.showShortcuts = false;
        playerView_.showStats = false;
        shell_->SetPlayerView(playerView_, now);
        return true;
    }
    if (player->MenuOpen()) {
        // Back closes an open menu rather than the player. Every other key is the menu's, through the shell.
        if (virtualKey == VK_ESCAPE || virtualKey == VK_BROWSER_BACK) {
            player->CloseMenu();
            player->ShowChrome(now);
            dirty_ = true;
            return true;
        }
        return false;
    }
    // Esc leaves full screen first, as a desktop player does; a second Esc closes the player.
    if (virtualKey == VK_ESCAPE && fullscreen_) {
        ToggleFullscreen();
        player->ShowChrome(now);
        dirty_ = true;
        return true;
    }
    ui::Command command;
    command.action = true;
    switch (virtualKey) {
    case VK_LEFT:
    case VK_RIGHT: {
        // A press seeks ten seconds. Held, the arrow steps 10, then 30, then 60 seconds at a time, and the
        // trickplay preview follows where it is heading, as Trickplay.tsx's hold-to-skip does.
        if (playerLive_) return true;
        const double sign = virtualKey == VK_LEFT ? -1.0 : 1.0;
        const bool repeat = (flags & (1 << 30)) != 0;
        if (!repeat) {
            holdStartMs_ = now;
            lastHoldStepMs_ = now;
            holdTarget_ = playerView_.position + sign * 10.0;
        } else {
            const double held = now - holdStartMs_;
            if (held < ui::kHoldArmMs || now - lastHoldStepMs_ < ui::kHoldTickMs) return true;
            lastHoldStepMs_ = now;
            holdTarget_ += sign * ui::HoldSkipStep(held);
        }
        holdTarget_ = std::clamp(holdTarget_, 0.0, playerView_.duration > 0.0 ? playerView_.duration - 1.0 : holdTarget_);
        mpv_->SeekTo(holdTarget_);
        player->HoldPreview(holdTarget_, now);
        dirty_ = true;
        return true;
    }
    case VK_SPACE:
    case VK_MEDIA_PLAY_PAUSE:
        command.name = "player-toggle";
        break;
    case 'M':
    case VK_VOLUME_MUTE:
        command.name = "player-mute";
        break;
    case 'F':
    case VK_F11:
        command.name = "player-fullscreen";
        break;
    case VK_UP:
        ChangeVolume(0.1);
        player->ShowChrome(now);
        dirty_ = true;
        return true;
    case VK_DOWN:
        ChangeVolume(-0.1);
        player->ShowChrome(now);
        dirty_ = true;
        return true;
    default:
        return false;
    }
    ApplyPlayerAction(command);
    return true;
}

}  // namespace tvm::platform
