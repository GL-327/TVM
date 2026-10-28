#include "platform/app.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>
#include <stdexcept>

#include "catalog/artwork.h"
#include "catalog/progress.h"
#include "catalog/rails.h"
#include "catalog/watchlist.h"
#include "core/config.h"
#include "core/mpv.h"
#include "core/prefs.h"
#include "core/paths.h"
#include "core/profiles.h"
#include "core/util.h"
#include "motion/preferences.h"
#include "nav/intents.h"
#include "nav/pointer.h"
#include "platform/d2d_painter.h"

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

// What the Real-Debrid screen says once a token is saved.
std::string SavedMessage(const realdebrid::Status& status) {
    if (status.error == "needs-auth") return "Real-Debrid rejected that token.";
    if (status.username.has_value()) return "Signed in as " + *status.username + ".";
    if (status.error == "unreachable") return "Token saved on this machine. Real-Debrid could not be reached to check it.";
    return "Token saved on this machine.";
}

constexpr char kClearedMessage[] = "Token cleared. TVM Stream will ask for it again.";
constexpr char kNotStoredMessage[] = "The token was not stored.";

// The Home hero turns to its next title this often, as the web Home does.
constexpr double kHeroTurnMs = 8000.0;
// The most titles the hero turns through.
constexpr std::size_t kHeroLimit = 4;

// The titles the Home hero turns through: the titles in progress, then the catalogue titles that have a
// picture. A title is listed once, by its id and by its name, as the web Home lists them.
std::vector<ui::HeroData> HeroTitles(const std::vector<catalog::MediaItem>& watching,
                                     const std::vector<catalog::HomeRail>& rails) {
    std::vector<catalog::MediaItem> candidates = watching;
    for (const catalog::HomeRail& rail : rails) {
        if (rail.id == "anime-adapted") continue;
        for (const catalog::MediaItem& item : rail.items) {
            if (!item.backdrop.empty()) candidates.push_back(item);
        }
    }

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
        hero.backdropUrl = catalog::PreferBackdrop(item.id, item.backdrop, item.poster);
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

App::App(HINSTANCE instance, const AppOptions& options) : instance_(instance) {
    // Measure in device pixels, so text and cards stay sharp on scaled displays.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    QueryPerformanceFrequency(&frequency_);
    QueryPerformanceCounter(&start_);

    // The preferences are read before the window exists, so the first frame
    // already uses the viewer's motion setting.
    dataDir_ = paths::fs::path(options.dataDir);
    store_ = std::make_unique<ui::FilePreferenceStore>(options.dataDir);
    catalog_ = std::make_unique<catalog::CatalogService>(paths::fs::path(options.dataDir));
    realDebrid_ = std::make_unique<realdebrid::Client>(realdebrid::ClientOptions{dataDir_});
    xtream_ = std::make_unique<xtream::Client>(xtream::ClientOptions{dataDir_});
    LoadAudio();
    hintsSeen_ = std::filesystem::exists(dataDir_ / "player-hints-seen");
    artwork_ = std::make_unique<ArtworkStore>(paths::ArtworkCacheDir(paths::fs::path(options.dataDir)));
    images_ = std::make_unique<ImageCache>(graphics_);
    // A picture is read on a worker, and its pixels come back to the window thread, which makes the bitmap.
    images_->SetRequest([this](const std::wstring& file) {
        background_->Run([this, file] {
            auto picture = std::make_shared<DecodedPicture>(DecodePicture(graphics_, file));
            background_->PostToUi([this, file, picture] {
                images_->Deliver(file, std::move(*picture));
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
    // The hero's picture crossfades in once its file has been fetched.
    home_->SetImageReady([this](const std::string& url) { return artwork_->Lookup(url).has_value(); });
    shell_ = std::make_unique<ui::Shell>(std::move(home), *store_);
    // Home wears the stream chrome from its first frame, while the catalogue loads.
    BuildBrowse(*home_, true);
    shell_->SetActionHandler([this](const ui::Command& command) {
        const auto id = command.params.find("id");
        if (command.name == "watchlist" && id != command.params.end()) {
            ToggleWatchlist(id->second);
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
        } else if (command.name == "stream-home") {
            shell_->PopToRoot(NowMs());
        } else if (command.name == "back") {
            shell_->Back(NowMs());
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
        } else if (command.name.rfind("info:", 0) == 0) {
            ApplyInfoAction(command);
        } else if (command.name == "updates-check") {
            CheckForUpdates();
        } else if (command.name == "updates-auto") {
            prefs::CorePrefsPatch patch;
            patch.autoUpdate = !store_->CorePrefs().autoUpdate;
            store_->SaveCorePrefs(patch);
            updatesView_.autoUpdate = store_->CorePrefs().autoUpdate;
            updatesView_.message = updatesView_.autoUpdate ? "Automatic updates on." : "Automatic updates off.";
            ShowUpdates();
        }
    });

    WNDCLASSEXW cls{};
    cls.cbSize = sizeof(cls);
    cls.style = CS_HREDRAW | CS_VREDRAW;
    cls.lpfnWndProc = &App::WindowProc;
    cls.hInstance = instance_;
    cls.hCursor = LoadCursorW(nullptr, IDC_ARROW);
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

    resolver_ = std::make_unique<playback::Resolver>(*realDebrid_, *catalog_);
    overlay_ = std::make_unique<OverlayWindow>(instance_, window_);
    MpvPlayer::Events events;
    events.state = [this](const mpv::State& state) { OnPlayerState(state); };
    events.error = [this](const std::string& message) { OnPlayerError(message); };
    events.ended = [this] {
        // The title played to its end: it counts as watched, and the player closes, as Player.tsx does.
        if (!playerOpen_) return;
        // An episode with a next one goes straight on to it, as Next Up does when its time runs out.
        if (nextEpisode_.has_value() && !nextDismissed_ && !playerLive_) {
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

    // The open sting. It holds on the mark until the catalogue has loaded.
    intro_ = std::make_unique<ui::Intro>(store_->Motion());
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
    ShowWindow(window_, showCommand);
    UpdateWindow(window_);
    Resize();
    intro_->Start(NowMs());
    LoadCatalog();

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
        TurnHero(now);
        if (const std::optional<nav::Direction> hop = hops_.Tick()) {
            shell_->Navigate(*hop, now);
            dirty_ = true;
        }
        intro_->Tick(now);
        streamIntro_->Tick(now);
        // Pictures still being read keep the frames coming, so each one appears as soon as it is ready.
        const bool animating = shell_->Tick(now) || intro_->Animating() || streamIntro_->Animating() || images_->Busy();
        if (dirty_ || animating) {
            Render();
            dirty_ = false;
        }

        if (animating) {
            // Sleep one frame, waking early for input.
            MsgWaitForMultipleObjects(0, nullptr, FALSE, kFrameMs, QS_ALLINPUT);
        } else if (home_->HeroCount() > 1) {
            // Nothing is moving, but the hero turns on a timer, so the wait ends when the next turn is due.
            const double due = std::max(0.0, lastHeroTurnMs_ + kHeroTurnMs - now);
            MsgWaitForMultipleObjects(0, nullptr, FALSE, static_cast<DWORD>(std::ceil(due)), QS_ALLINPUT);
        } else {
            WaitMessage();
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
    switch (message) {
    case WM_SIZE:
        Resize();
        if (mpv_) mpv_->Resize();
        return 0;
    case WM_MOVE:
        // The player's chrome is a window of its own, so it follows this one.
        dirty_ = true;
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
        // Letters typed on the search page go into the query. Control characters are keys, handled above.
        if (shell_->ActiveScreenName() == "search" && wParam >= 0x20 && wParam != 0x7F &&
            (wParam < 0xD800 || wParam > 0xDFFF)) {
            TypeSearch(util::ToUtf8(std::wstring(1, static_cast<wchar_t>(wParam))));
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
        // And into an info page's field, such as Setup's token or the dev code.
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
        if (!FromTouchOrPen() && HandleMouse(message, wParam, lParam)) return 0;
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

    // While the open sting is on screen, OK, Enter, Escape and Space end it and do nothing else.
    if ((virtualKey == VK_RETURN || virtualKey == VK_ESCAPE || virtualKey == VK_SPACE) && SkipIntro()) return true;
    if (HandlePlayerKey(virtualKey, flags)) return true;
    if (HandleSearchKey(virtualKey)) return true;
    if (ui::PlayerScreen* player = shell_->ActivePlayer()) player->ShowChrome(now);

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
        if (!shell_->Back(now)) PostQuitMessage(0);
        dirty_ = true;
    }
    return true;
}

bool App::SkipIntro() {
    // The press goes to whichever sting is on screen. Otherwise it reaches the shell.
    for (ui::Intro* intro : {intro_.get(), streamIntro_.get()}) {
        if (!intro->Visible()) continue;
        intro->Skip(NowMs());
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
    const double now = NowMs();
    ui::PlayerScreen* player = shell_->ActivePlayer();
    switch (message) {
    case WM_MOUSEMOVE: {
        const POINT point = ClientPoint(lParam);
        // Windows repeats a move whenever a window changes under a still cursor, and the overlay changes
        // every frame. Only a real move counts, or the player's chrome would never fade.
        if (point.x == lastMouse_.x && point.y == lastMouse_.y) return true;
        lastMouse_ = point;
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
        shell_->MouseDown(point.x, point.y, now);
        dirty_ = true;
        return true;
    }
    case WM_LBUTTONUP: {
        // A click ends the open sting and goes no further.
        if (SkipIntro()) return true;
        const POINT point = ClientPoint(lParam);
        if (HandleScrub(message, point)) return true;
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
    D2dPainter painter(target_.Get(), graphics_, artwork_.get(), images_.get());
    // A sting that covers the window hides the screen under it, so that screen is not drawn while it lasts.
    if (!intro_->Covers() && !streamIntro_->Covers()) shell_->Paint(painter);
    intro_->Paint(painter, static_cast<double>(width), static_cast<double>(height));
    streamIntro_->Paint(painter, static_cast<double>(width), static_cast<double>(height));
    const HRESULT result = target_->EndDraw();
    if (result == D2DERR_RECREATE_TARGET) {
        // The device was lost. Rebuild the target and draw again next frame. The
        // bitmaps belong to the old target, so they are decoded again.
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
            intro_->SetPending(false);
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

void App::QueueArtwork(const std::string& url) {
    if (url.empty() || artwork_->Lookup(url).has_value()) return;
    if (!queuedArtwork_.insert(url).second) return;

    background_->Run([this, url] {
        const bool fetched = artwork_->Fetch(url);
        background_->PostToUi([this, url, fetched] {
            if (fetched) {
                dirty_ = true;
            } else {
                // A later screen may ask for this picture again.
                queuedArtwork_.erase(url);
            }
        });
    });
}

void App::QueueRailArtwork(const std::vector<ui::RailData>& rails) {
    for (const ui::RailData& rail : rails) {
        for (const ui::CardData& card : rail.cards) QueueArtwork(card.posterUrl);
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

    background_->Run([this, id] {
        ui::TitleInfo info;
        try {
            info = ui::InfoFromMeta(id, catalog_->Meta(id));
        } catch (const std::exception&) {
            info = ui::InfoFromMeta(id, std::nullopt);
        }
        background_->PostToUi([this, id, info] { FinishTitle(id, info); });
    });
}

void App::FinishTitle(const std::string& id, const ui::TitleInfo& info) {
    titlesInFlight_.erase(id);
    ui::TitleInfo shown = info;
    shown.saved = SavedOnWatchlist(id);
    // Only a real answer is kept. An unavailable title is asked for again when it is opened.
    if (shown.state == ui::TitleInfo::State::Ready) titles_[id] = shown;
    shell_->SetTitleInfo(id, shown);
    QueueTitleArtwork(shown);
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
    RefreshRealDebrid();
}

void App::RefreshRealDebrid() {
    realDebridView_.busy = true;
    shell_->SetRealDebridView(realDebridView_);
    dirty_ = true;

    background_->Run([this] {
        const realdebrid::Status status = realDebrid_->GetStatus();
        background_->PostToUi([this, status] { FinishRealDebrid(status, ""); });
    });
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
    realDebridView_.busy = true;
    realDebridView_.message.clear();
    shell_->SetRealDebridView(realDebridView_);
    dirty_ = true;

    background_->Run([this, token = std::move(token), clearing] {
        // The token itself is never logged or shown. Only the outcome reaches the screen.
        bool stored = true;
        try {
            realDebrid_->SetToken(token);
        } catch (const std::exception&) {
            stored = false;
        }
        const realdebrid::Status status = realDebrid_->GetStatus();
        std::string message = kNotStoredMessage;
        if (stored) message = clearing ? kClearedMessage : SavedMessage(status);
        background_->PostToUi([this, status, message] { FinishRealDebrid(status, message); });
    });
}

void App::FinishRealDebrid(const realdebrid::Status& status, const std::string& message) {
    realDebridView_.loaded = true;
    realDebridView_.configured = status.configured;
    realDebridView_.username = status.username;
    realDebridView_.premium = status.premium;
    realDebridView_.error = status.error;
    realDebridView_.busy = false;
    realDebridView_.message = message;
    shell_->SetRealDebridView(realDebridView_);
    dirty_ = true;
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
    if (shell_->ActiveScreenName() != "live-tv") {
        liveOpened_ = false;
        return;
    }
    if (liveOpened_) return;
    liveOpened_ = true;
    // Each visit starts by watching, and reads the catalogue again, so a login saved in between shows.
    liveChoosing_ = false;
    RefreshLiveTv();
}

void App::RefreshLiveTv() {
    liveLoaded_ = false;
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
    ui::LiveTvState state;
    state.loaded = liveLoaded_;
    state.choosing = liveChoosing_;
    state.catalog = liveCatalog_;
    state.picks = livePicks_;
    state.message = liveMessage_;
    shell_->SetLiveTvView(ui::LiveTvView(state), NowMs());
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
        const realdebrid::Status status = realDebrid_->GetStatus();
        background_->PostToUi([this, status] {
            streamStatus_ = status;
            streamStatusLoaded_ = true;
            RebuildStream();
        });
    });
}

void App::SetStreamLane(const std::string& lane) {
    // Choosing the lane that is on goes back to everything, as the web links toggle.
    streamLane_ = streamLane_ == lane ? "all" : lane;
    RebuildStream();
    RebuildHome();
}

void App::RebuildStream() {
    if (ui::Scene* scene = shell_->StreamScene()) BuildBrowse(*scene, false);
}

void App::BuildBrowse(ui::Scene& scene, bool root) {
    const auto inLane = [this](const catalog::MediaItem& item) {
        if (streamLane_ == "shows") return item.kind == "series";
        if (streamLane_ == "movies") return item.kind != "series";
        return true;
    };

    // The chrome: StreamChrome.tsx, left to right.
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
    view.style = ui::SceneStyle::Stream;
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    // The profile's name, or "Profile" without one, as StreamChrome labels its orb.
    const std::string profileName = profiles::ActiveName(dataDir_).value_or("Profile");
    view.topButtons = {
        ui::TopButton{profileName, open("profiles", false)},
        ui::TopButton{"Search", open("search", true)},
        ui::TopButton{"Home", act("stream-home")},
        ui::TopButton{"Shows", act("stream-lane", "shows"), streamLane_ == "shows"},
        ui::TopButton{"Movies", act("stream-lane", "movies"), streamLane_ == "movies"},
        ui::TopButton{"TVM", act("stream-mark"), false, true},
        ui::TopButton{"Downloads", open("downloads", true)},
    };
    if (root) {
        // Home is TVM Stream's page, so Home's own way out to Live TV and Settings join the chrome there.
        view.topButtons.erase(view.topButtons.begin() + 2);
        view.topButtons.insert(view.topButtons.begin() + 4, ui::TopButton{"My List", open("watchlist", false)});
        view.topButtons.insert(view.topButtons.begin() + 6, ui::TopButton{"Live TV", open("live-tv", false)});
        // The launcher's Apps tile: the service hubs.
        view.topButtons.insert(view.topButtons.begin() + 7, ui::TopButton{"Apps", open("apps", false)});
        view.topButtons.push_back(ui::TopButton{"Settings", open("settings", false)});
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
        if (!listLane.empty()) {
            ui::RailData rail = ui::WatchlistRail(listLane);
            rail.title = "My List";
            view.rails.push_back(std::move(rail));
        }
        for (ui::RailData& rail : ui::RailsFromCatalog(catalogRails)) view.rails.push_back(std::move(rail));

        // The billboard: the title in progress, else the newest film, as the core's `featured` picks it.
        std::vector<catalog::MediaItem> laneWatching;
        for (const catalog::ProgressItem& entry : watchingLane) laneWatching.push_back(entry.item);
        std::vector<ui::HeroData> candidates = HeroTitles(laneWatching, catalogRails);
        // Home turns through its titles. The stream page shows one billboard.
        if (root) heroes = candidates;
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
    for (const ui::HeroData& hero : heroes) QueueArtwork(hero.backdropUrl);
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

void App::SyncPages() {
    // Each visit is filled in once, by the entry's key, so a second hub or a return to a page starts afresh.
    const nav::ViewEntry& entry = nav::ActiveEntry(shell_->stack());
    if (entry.key == pageOpened_) return;
    pageOpened_ = entry.key;
    const std::string& name = entry.name;
    if (dynamic_cast<ui::InfoScreen*>(&shell_->ActiveScreen()) != nullptr) OpenInfoPage(entry);
    if (name == "service") {
        const auto id = entry.params.find("id");
        OpenServiceHub(id == entry.params.end() ? "" : id->second);
    }
    if (name == "watchlist") BuildWatchlistPage();
    if (name == "profiles") ShowProfiles("");
    if (name == "updates") {
        updatesView_.version = config::kCoreVersion;
        updatesView_.autoUpdate = store_->CorePrefs().autoUpdate;
        updatesView_.message.clear();
        ShowUpdates();
    }
}

void App::BuildWatchlistPage() {
    ui::Scene* scene = shell_->SceneNamed("watchlist");
    if (scene == nullptr) return;
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    const std::vector<catalog::WatchlistEntry> saved =
        folder.has_value() ? catalog::ReadWatchlist(*folder) : std::vector<catalog::WatchlistEntry>{};

    // watchlistView: the filter, then the order. The list is kept newest first, which is "Recently saved".
    std::vector<catalog::MediaItem> items;
    for (const catalog::WatchlistEntry& entry : saved) {
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
    // Eight posters a row, as the web grid wraps them.
    for (std::size_t i = 0; i < items.size(); i += 8) {
        ui::RailData rail;
        rail.id = "saved-" + std::to_string(i / 8);
        for (std::size_t j = i; j < std::min(i + 8, items.size()); ++j) {
            rail.cards.push_back(ui::CardData{items[j].id, items[j].title, items[j].poster, std::nullopt});
        }
        view.rails.push_back(std::move(rail));
    }
    scene->SetView(view, NowMs());
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

void App::ShowProfiles(const std::string& message) {
    auto* screen = dynamic_cast<ui::ProfilesScreen*>(shell_->ScreenNamed("profiles"));
    if (screen == nullptr) return;
    ui::ProfilesView view;
    view.message = message;
    try {
        const profiles::Registry registry = profiles::Load(dataDir_);
        view.activeId = registry.activeId;
        for (const profiles::Profile& profile : registry.profiles) {
            view.profiles.push_back(ui::ProfileEntry{profile.id, profile.name, profile.hue});
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
    try {
        if (command.name == "profile-remove") {
            profiles::Remove(dataDir_, param("id"));
            ShowProfiles("");
            RebuildHome();
            return;
        }
        // Choosing or making a profile switches to it, and Home follows that person's list and progress.
        if (command.name == "profile-open") profiles::SwitchTo(dataDir_, param("id"));
        if (command.name == "profile-create") profiles::Create(dataDir_, param("name"));
        titles_.clear();
        RebuildHome();
        RebuildStream();
        shell_->Back(NowMs());
    } catch (const std::exception& error) {
        ShowProfiles(error.what());
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
            http::Get("https://api.github.com/repos/GL-327/TVM/releases/latest", options);
        const std::optional<http::Response> commits =
            http::Get("https://api.github.com/repos/GL-327/TVM/commits?per_page=8", options);
        std::string available;
        if (release.has_value() && release->ok()) {
            const nlohmann::json body = nlohmann::json::parse(release->body, nullptr, false);
            if (body.is_object()) available = "Build " + body.value("tag_name", std::string("latest"));
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
        background_->PostToUi([this, available, changes, reached] {
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
                                   : available.empty() ? "GitHub has no published build yet. The changes below are the latest."
                                                       : available + " is published. Install it to update this copy.";
            ShowUpdates();
        });
    });
}

void App::SyncSearch() {
    if (shell_->ActiveScreenName() != "search") {
        searchOpened_ = false;
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
    if (searchPending_ && NowMs() - searchTypedMs_ >= 180.0) RunSearch();
}

bool App::HandleSearchKey(WPARAM virtualKey) {
    if (auto* profiles = dynamic_cast<ui::ProfilesScreen*>(&shell_->ActiveScreen()); profiles != nullptr && profiles->Creating()) {
        // While the name field is open, Backspace edits it and letters arrive as characters.
        if (virtualKey == VK_BACK) {
            profiles->Erase();
            dirty_ = true;
            return true;
        }
        return virtualKey == VK_SPACE || (virtualKey >= '0' && virtualKey <= 'Z');
    }
    if (ui::InfoScreen* page = TypingPage()) {
        // A page's field takes Backspace and a paste; letters arrive as characters.
        if (virtualKey == VK_BACK) {
            if (page->FieldText().empty()) return false;
            page->Erase();
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
    if (shell_->ActiveScreenName() != "search") return false;
    if (virtualKey == VK_BACK) {
        // Backspace removes the last letter, and leaves search once the field is empty.
        if (searchQuery_.empty()) return false;
        std::size_t cut = searchQuery_.size() - 1;
        while (cut > 0 && (static_cast<unsigned char>(searchQuery_[cut]) & 0xC0) == 0x80) --cut;
        searchQuery_.erase(cut);
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
    searchQuery_ += text;
    searchTypedMs_ = NowMs();
    searchPending_ = true;
    ApplySearch();
}

void App::RunSearch() {
    searchPending_ = false;
    const int generation = ++searchGeneration_;
    const std::string query = util::Trim(searchQuery_);
    if (query.size() < 2) {
        searchResults_.clear();
        searchStatus_ = "Search films and series.";
        ApplySearch();
        return;
    }
    searchStatus_ = "Searching\xE2\x80\xA6";
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
            searchResults_ = results;
            std::stable_sort(searchResults_.begin(), searchResults_.end(),
                             [&](const catalog::MediaItem& a, const catalog::MediaItem& b) { return rank(a) < rank(b); });
            if (failed) {
                searchStatus_ = "Search is unavailable. Check your connection and try again.";
            } else if (results.empty()) {
                searchStatus_ = "Nothing matched that search.";
            } else {
                searchStatus_ = std::to_string(results.size()) + (results.size() == 1 ? " match" : " matches");
            }
            ApplySearch();
        });
    });
}

void App::ApplySearch() {
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
    playerRetryAt_.reset();
    playerRecoveries_ = 0;
    streamChoices_.clear();
    nextEpisode_.reset();
    nextDismissed_ = false;
    recapDone_ = false;
    creditsWatched_ = false;
    StartPlayback();
    LookUpNextEpisode();
}

void App::StartPlayback() {
    const int generation = ++playerGeneration_;
    mpv_->Stop();
    overlay_->Show(false);

    // A live channel plays from its own address. A title is looked up through Real-Debrid.
    const auto channel = std::find_if(liveCatalog_.channels.begin(), liveCatalog_.channels.end(),
                                      [this](const catalog::LiveChannel& entry) { return entry.id == playerId_; });
    playerLive_ = channel != liveCatalog_.channels.end();
    std::string title = playerLive_ ? channel->name : "";
    if (const auto known = titles_.find(playerId_); known != titles_.end() && title.empty()) title = known->second.title;

    playerView_ = ui::PlayerView{};
    playerView_.title = title.empty() ? "Loading" : title;
    playerView_.live = playerLive_;
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
    // An episode shows "S1 · E2" beside its title, as CinemaControls writes it.
    if (const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_); play && play->season) {
        playerView_.episode = "S" + std::to_string(*play->season) + " \xC2\xB7 E" + std::to_string(*play->episode);
    }
    playerView_.volume = playerVolume_;
    playerView_.muted = playerMuted_;
    shell_->SetPlayerView(playerView_, NowMs());
    dirty_ = true;

    if (playerLive_) {
        playback::Resolution resolution;
        resolution.title = channel->name;
        resolution.url = channel->url;
        if (resolution.url.empty()) {
            if (const std::optional<xtream::Account> account = xtream_->Saved()) {
                resolution.url = xtream_->StreamUrl(*account, channel->id);
            }
        }
        if (resolution.url.empty()) resolution.reason = "unsupported";
        FinishResolve(generation, resolution);
        return;
    }

    background_->Run([this, generation, id = playerId_, title] {
        const playback::Resolution resolution = resolver_->Resolve(playback::ResolveInput{id, title, 2160});
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

    const std::optional<std::filesystem::path> executable = mpv::FindExecutable(util::ProcessEnvironment());
    if (!executable.has_value()) {
        ShowPlayerError("Playback stopped",
                        "Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.");
        return;
    }

    // A part-watched title starts where the viewer left it, unless a retry asked for its own place.
    std::optional<double> startAt = playerRetryAt_;
    if (!startAt.has_value() && !playerLive_) {
        if (const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_)) {
            const catalog::ProgressMap progress = catalog::ReadProgress(*folder);
            if (progress.is_object() && progress.contains(playerId_)) startAt = catalog::ResumePosition(progress[playerId_]);
        }
    }

    // A fresh search brings the quality menu's streams. A switch from that menu keeps them.
    if (!resolution.choices.empty()) {
        streamChoices_ = resolution.choices;
        streamChosen_ = resolution.chosen;
    }
    ShowStreamChoices();
    if (!resolution.title.empty() && playerView_.title == "Loading") playerView_.title = resolution.title;
    if (!resolution.title.empty() && !playerLive_) playerView_.title = resolution.title;
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
    if (mpv_->Start(*executable, resolution.url, startAt, playerVolume_, playerMuted_)) overlay_->Show(true);
    dirty_ = true;
}

void App::OnPlayerState(const mpv::State& state) {
    if (!playerOpen_) return;
    playerView_.position = state.position;
    if (state.duration > 0.0) playerView_.duration = state.duration;
    playerView_.paused = state.paused;
    playerView_.started = state.started;
    playerView_.buffering = mpv::Buffering(state);
    playerView_.speed = state.speed;
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
                ui::PlayerOption{std::to_string(track.id), mpv::TrackLabel(track), track.codec, track.selected});
            subtitleOn = subtitleOn || track.selected;
        } else if (track.type == "audio") {
            std::string detail = track.codec;
            if (track.channels > 0) detail += (detail.empty() ? "" : " \xC2\xB7 ") + std::to_string(track.channels) + "ch";
            playerView_.audios.push_back(
                ui::PlayerOption{std::to_string(track.id), mpv::TrackLabel(track), detail, track.selected});
        } else if (track.type == "video" && track.selected && track.height > 0) {
            playerView_.qualityLabel = track.height >= 2000 ? "4K" : std::to_string(track.height) + "p";
        }
    }
    if (!playerView_.subtitles.empty()) {
        playerView_.subtitles.insert(playerView_.subtitles.begin(), ui::PlayerOption{"no", "Off", "", !subtitleOn});
    }

    // Next Up shows over the last seconds of an episode that has a next one.
    const double remaining = playerView_.duration - playerView_.position;
    playerView_.nextWindow = ui::NextUpWindowSeconds(playerView_.duration);
    playerView_.nextRemaining = std::max(0.0, remaining);
    playerView_.nextUp = nextEpisode_.has_value() && !nextDismissed_ && !playerLive_ && playerView_.duration > 0.0 &&
                         remaining <= playerView_.nextWindow && remaining >= -0.25;

    // Skip recap over an episode's opening 90 seconds, past the first episode, which has nothing to recap.
    const std::optional<playback::PlayId> play = playback::ParsePlayId(playerId_);
    const bool laterEpisode = play.has_value() && play->season.has_value() && !(play->season == 1 && play->episode == 1);
    playerView_.recap = laterEpisode && !recapDone_ && state.started && playerView_.position >= 0.0 &&
                        playerView_.position < playerView_.recapEnd - 0.35;

    // Skip credits over the last seconds of a title with no next episode; Next Up covers the rest.
    const double creditsWindow = ui::CreditsWindowSeconds(playerView_.duration);
    playerView_.creditsRemaining = std::max(0.0, remaining);
    playerView_.credits = !playerLive_ && !nextEpisode_.has_value() && !creditsWatched_ && creditsWindow > 0.0 &&
                          remaining > 0.0 && remaining <= creditsWindow;
    // A picture means the stream works, so the retries start again from nothing.
    if (state.started) playerRecoveries_ = 0;
    shell_->SetPlayerView(playerView_, NowMs());
    SavePlayerProgress(false);
    dirty_ = true;
}

void App::OnPlayerError(const std::string& message) {
    if (!playerOpen_) return;
    // A stream that fails is found again at the same place, twice, before the viewer is told.
    const bool missing = message.find("not installed") != std::string::npos;
    if (!playerLive_ && !missing && playerRecoveries_ < 2) {
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
    if (playerLive_ || playerId_.empty() || playerView_.duration <= 0.0 || !playerView_.started) return;
    const double now = NowMs();
    if (!force && now - lastProgressSaveMs_ < 10000.0) return;
    lastProgressSaveMs_ = now;
    const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_);
    if (!folder.has_value()) return;
    try {
        catalog::WriteProgress(*folder, playerId_, playerView_.position, playerView_.duration);
        homeStale_ = true;
    } catch (const std::exception&) {
        // The file could not be written. Playback goes on, and the next save tries again.
    }
}

void App::StopPlayback() {
    SavePlayerProgress(true);
    ++playerGeneration_;
    mpv_->Stop();
    overlay_->Show(false);
    playerOpen_ = false;
    playerView_ = ui::PlayerView{};
    // Continue watching follows what was just watched.
    if (homeStale_) RebuildHome();
    streamOpened_ = false;
    dirty_ = true;
}

void App::ChangeVolume(double delta) {
    SetVolume(playerVolume_ + delta);
}

void App::SetVolume(double level) {
    // Steps land on whole percents, so ten presses up from 100% read 200%, not 199.99%.
    playerVolume_ = std::clamp(std::round(level * 100.0) / 100.0, 0.0, ui::kMaxVolume);
    if (playerVolume_ > 0.0) playerMuted_ = false;
    mpv_->SetAudio(playerVolume_, playerMuted_);
    playerView_.volume = playerVolume_;
    playerView_.muted = playerMuted_;
    shell_->SetPlayerView(playerView_, NowMs());
    SaveAudio();
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
    dirty_ = true;
}

void App::ApplyPlayerAction(const ui::Command& command) {
    const double now = NowMs();
    if (command.name == "player-close") {
        shell_->Back(now);
    } else if (command.name == "player-retry") {
        playerRecoveries_ = 0;
        playerRetryAt_ = playerView_.position > 0.0 ? std::optional<double>(playerView_.position) : std::nullopt;
        StartPlayback();
    } else if (playerView_.phase != ui::PlayerView::Phase::Playing) {
        return;
    } else if (command.name == "player-toggle") {
        // The new state shows at once, before mpv confirms it, as the web engine flips it first.
        playerView_.paused = !playerView_.paused;
        mpv_->SetPaused(playerView_.paused);
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
        recapDone_ = true;
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
    if (kind == "cc") {
        mpv_->SetProperty("sid", id == "no" ? nlohmann::json("no") : nlohmann::json(std::stoi(id)));
    } else if (kind == "audio") {
        mpv_->SetProperty("aid", std::stoi(id));
    } else if (kind == "speed") {
        playerView_.speed = std::stod(id);
        mpv_->SetProperty("speed", playerView_.speed);
    } else if (kind == "quality") {
        SwitchStream(std::stoul(id));
    }
}

void App::ShowStreamChoices() {
    playerView_.qualities.clear();
    for (std::size_t i = 0; i < streamChoices_.size(); ++i) {
        const playback::StreamChoice& choice = streamChoices_[i];
        playerView_.qualities.push_back(ui::PlayerOption{std::to_string(i), choice.label, choice.detail, i == streamChosen_});
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
    background_->Run([this, generation, wanted, choice, title] {
        playback::Resolution resolution = resolver_->ResolveChoice(wanted, title);
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
    if (player == nullptr || playerUrl_.empty()) return;
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
    const std::optional<std::filesystem::path> executable = mpv::FindExecutable(util::ProcessEnvironment());
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
        // The next episode in Cinemeta's order, which runs by season then number, specials last.
        std::optional<catalog::MediaItem> next;
        for (std::size_t i = 0; i + 1 < meta->children.size(); ++i) {
            const catalog::MediaItem& item = meta->children[i];
            if (item.season == play.season && item.episode == play.episode) {
                const catalog::MediaItem& after = meta->children[i + 1];
                if (after.season.value_or(0) > 0) next = after;
                break;
            }
        }
        const std::string show = meta->item.title;
        background_->PostToUi([this, current, next, show] {
            if (playerId_ != current) return;
            nextEpisode_ = next;
            showTitle_ = show;
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
    nextEpisode_.reset();
    nextDismissed_ = false;
    recapDone_ = false;
    creditsWatched_ = false;
    StartPlayback();
    LookUpNextEpisode();
}

bool App::HandleScrub(UINT message, POINT point) {
    ui::PlayerScreen* player = shell_->ActivePlayer();
    if (player == nullptr || player->view().phase != ui::PlayerView::Phase::Playing || player->view().live) return false;
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
    if (player->MenuOpen()) {
        // Back closes an open menu rather than the player. Every other key is the menu's, through the shell.
        if (virtualKey == VK_ESCAPE || virtualKey == VK_BACK || virtualKey == VK_BROWSER_BACK) {
            player->CloseMenu();
            player->ShowChrome(now);
            dirty_ = true;
            return true;
        }
        return false;
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
