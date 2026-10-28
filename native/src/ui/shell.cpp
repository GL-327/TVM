#include "ui/shell.h"

#include <cmath>
#include <set>
#include <stdexcept>

#include "ui/details_screen.h"
#include "ui/pending_screen.h"
#include "ui/settings_screen.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

// Pixels one wheel notch moves, as Chrome reports it.
constexpr double kWheelNotchPx = 100.0;
// Win32 reports 120 units per notch.
constexpr double kWheelUnitsPerNotch = 120.0;
// A wheel step this small, in pixels, moves at once instead of easing.
constexpr double kWheelInstantPx = 80.0;

bool HasEntry(const nav::ViewStackState& stack, const std::string& key) {
    for (const nav::ViewEntry& entry : stack.entries) {
        if (entry.key == key) return true;
    }
    return false;
}

}  // namespace

Shell::Shell(std::unique_ptr<Screen> root, PreferenceStore& store) : store_(store) {
    if (!root) throw std::invalid_argument("a shell needs a root screen");
    stack_ = nav::CreateViewStack("home");
    motion_ = store_.Motion();
    stage_.SetMotion(motion_);
    root->SetMotion(motion_);
    screens_[stack_.entries.front().key] = std::move(root);
}

Screen& Shell::Top() {
    return *screens_.at(nav::ActiveEntry(stack_).key);
}

Screen& Shell::ActiveScreen() {
    return Top();
}

void Shell::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    for (auto& [key, screen] : screens_) screen->Layout(width, height);
}

bool Shell::Tick(double nowMs) {
    clock_ = nowMs;
    bool active = false;
    for (auto& [key, screen] : screens_) active = screen->Tick(nowMs) || active;
    ApplyMotionIfChanged();
    return active || Animating();
}

bool Shell::Animating() const {
    for (const auto& [key, screen] : screens_) {
        if (screen->Animating()) return true;
    }
    // The stage moves on its own clock, but only while a screen shows it.
    const Screen& visible = *screens_.at(nav::VisibleScreen(stack_).key);
    return visible.ShowsStage() && stage_.Moving();
}

void Shell::Paint(Painter& painter) const {
    // The screen under any modals is painted first, then each modal in order. A screen that shows the stage
    // lets the stage paint first, behind it.
    const nav::ViewEntry& visible = nav::VisibleScreen(stack_);
    if (screens_.at(visible.key)->ShowsStage()) {
        // The ground under the stage is the app's own background, `.app` in the dark theme, which is black.
        painter.Clear(tokens::kBackgroundDeep);
        stage_.Paint(painter, width_, height_, clock_);
    }
    screens_.at(visible.key)->Paint(painter);
    for (const nav::ViewEntry& modal : nav::OpenModals(stack_)) {
        screens_.at(modal.key)->Paint(painter);
    }
}

void Shell::SetTitleInfo(const std::string& id, const TitleInfo& info) {
    for (auto& [key, screen] : screens_) {
        auto* details = dynamic_cast<DetailsScreen*>(screen.get());
        if (details != nullptr && details->id() == id) details->SetInfo(info);
    }
}

std::optional<std::string> Shell::TopDetailsId() const {
    const nav::ViewEntry& top = nav::ActiveEntry(stack_);
    if (top.name != "details") return std::nullopt;
    const auto id = top.params.find("id");
    if (id == top.params.end()) return std::nullopt;
    return id->second;
}

std::string Shell::ActiveScreenName() const {
    return nav::ActiveEntry(stack_).name;
}

void Shell::SetRealDebridView(const RealDebridView& view) {
    for (auto& [key, screen] : screens_) {
        auto* realDebrid = dynamic_cast<RealDebridScreen*>(screen.get());
        if (realDebrid != nullptr) realDebrid->SetView(view);
    }
}

void Shell::SetLiveTvView(const SceneView& view, double nowMs) {
    for (const nav::ViewEntry& entry : stack_.entries) {
        if (entry.name != "live-tv") continue;
        const auto found = screens_.find(entry.key);
        auto* scene = found == screens_.end() ? nullptr : dynamic_cast<Scene*>(found->second.get());
        if (scene != nullptr) scene->SetView(view, nowMs);
    }
}

Scene* Shell::StreamScene() {
    return SceneNamed("tvm-stream");
}

Screen* Shell::ScreenNamed(const std::string& name) {
    for (const nav::ViewEntry& entry : stack_.entries) {
        if (entry.name != name) continue;
        const auto found = screens_.find(entry.key);
        if (found != screens_.end()) return found->second.get();
    }
    return nullptr;
}

Scene* Shell::SceneNamed(const std::string& name) {
    for (const nav::ViewEntry& entry : stack_.entries) {
        if (entry.name != name) continue;
        const auto found = screens_.find(entry.key);
        if (found != screens_.end()) return dynamic_cast<Scene*>(found->second.get());
    }
    return nullptr;
}

void Shell::SetStreamView(const SceneView& view, const std::vector<HeroData>& heroes, double nowMs) {
    Scene* scene = StreamScene();
    if (scene == nullptr) return;
    const bool first = !scene->FocusedKey().has_value() || scene->HeroCount() == 0;
    // The billboard goes in first, so the rails are laid out below it.
    scene->SetHeroes(heroes, nowMs);
    scene->SetView(view, nowMs);
    if (first && !heroes.empty()) scene->FocusItem("hero-play", nowMs, true);
}

void Shell::SetPlayerView(const PlayerView& view, double nowMs) {
    for (auto& [key, screen] : screens_) {
        auto* player = dynamic_cast<PlayerScreen*>(screen.get());
        if (player != nullptr) player->SetView(view, nowMs);
    }
}

PlayerScreen* Shell::ActivePlayer() {
    return dynamic_cast<PlayerScreen*>(&Top());
}

void Shell::PopToRoot(double nowMs) {
    while (nav::CanGoBack(stack_)) Back(nowMs);
}

void Shell::SetXtreamView(const XtreamView& view) {
    for (auto& [key, screen] : screens_) {
        auto* xtream = dynamic_cast<XtreamScreen*>(screen.get());
        if (xtream != nullptr) xtream->SetView(view);
    }
}

void Shell::SetLivePlaylistView(const LivePlaylistView& view) {
    for (auto& [key, screen] : screens_) {
        auto* playlist = dynamic_cast<LivePlaylistScreen*>(screen.get());
        if (playlist != nullptr) playlist->SetView(view);
    }
}

void Shell::KeyPressed() {
    mouse_.OnKeyPress();
}

void Shell::Navigate(nav::Direction direction, double nowMs) {
    KeyPressed();
    Top().Navigate(direction, nowMs);
}

void Shell::Select(double nowMs) {
    KeyPressed();
    const std::optional<Command> command = Top().Select(nowMs);
    if (command.has_value()) Open(*command, nowMs);
    ApplyMotionIfChanged();
}

bool Shell::Back(double nowMs) {
    KeyPressed();
    if (!nav::CanGoBack(stack_)) return false;

    stack_ = nav::Reduce(stack_, nav::RememberFocus(Top().FocusedKey()));
    stack_ = nav::Reduce(stack_, nav::Pop());
    Reconcile();
    RestoreFocus(nowMs);
    return true;
}

void Shell::SetActionHandler(std::function<void(const Command&)> handler) {
    action_ = std::move(handler);
}

void Shell::SetOpenHandler(std::function<void(const std::string& name)> handler) {
    opened_ = std::move(handler);
}

void Shell::Open(const Command& command, double nowMs) {
    if (command.action) {
        // An action changes data, not the stack, so nothing is opened or remembered.
        if (action_) action_(command);
        return;
    }

    // Leaving a screen remembers its focus, so Back puts the highlight back.
    stack_ = nav::Reduce(stack_, nav::RememberFocus(Top().FocusedKey()));

    nav::PushOptions options;
    options.params = command.params;
    stack_ = nav::Reduce(stack_, command.modal ? nav::PushModal(command.name, options)
                                               : nav::Push(command.name, options));
    Reconcile();
    if (opened_) opened_(command.name);
    (void)nowMs;
}

void Shell::Reconcile() {
    for (auto it = screens_.begin(); it != screens_.end();) {
        if (HasEntry(stack_, it->first)) {
            ++it;
        } else {
            it = screens_.erase(it);
        }
    }

    for (const nav::ViewEntry& entry : stack_.entries) {
        if (screens_.contains(entry.key)) continue;
        std::unique_ptr<Screen> screen = MakeScreen(entry);
        screen->Layout(width_, height_);
        screen->SetMotion(motion_);
        screens_[entry.key] = std::move(screen);
    }
}

std::unique_ptr<Screen> Shell::MakeScreen(const nav::ViewEntry& entry) {
    if (entry.name == "details") {
        const auto id = entry.params.find("id");
        const auto title = entry.params.find("title");
        return std::make_unique<DetailsScreen>(id == entry.params.end() ? "" : id->second,
                                               title == entry.params.end() ? "" : title->second);
    }
    if (entry.name == "settings") {
        return std::make_unique<SettingsScreen>(store_, motion_);
    }
    if (entry.name == "realdebrid") {
        return std::make_unique<RealDebridScreen>();
    }
    if (entry.name == "live-xtream") {
        return std::make_unique<XtreamScreen>();
    }
    if (entry.name == "live-playlist") {
        return std::make_unique<LivePlaylistScreen>();
    }
    if (entry.name == "live-tv") {
        // The channel screen is a scene: rails of channels, with its own top buttons.
        return std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
    }
    if (entry.name == "tvm-stream") {
        // TVM Stream is a scene too, dressed in the stream chrome. The app fills it in.
        auto scene = std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
        SceneView view;
        view.style = SceneStyle::Stream;
        view.status = "Loading library\xE2\x80\xA6";
        scene->SetView(view, 0.0);
        return scene;
    }
    if (entry.name == "player") {
        return std::make_unique<PlayerScreen>();
    }
    // The pages the app fills in from an InfoView.
    static const std::set<std::string> kInfoPages = {
        "legal", "donate", "downloads", "changelog", "diagnostics", "system-info", "setup", "recovery",
        "live-check", "mail-settings", "accounts", "developer", "apps", "confirm"};
    if (kInfoPages.contains(entry.name)) return std::make_unique<InfoScreen>();
    if (entry.name == "service") {
        // A service hub is a stream-style scene in the service's colours. The app fills it in.
        auto scene = std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
        SceneView view;
        view.style = SceneStyle::Stream;
        view.status = "Opening\xE2\x80\xA6";
        scene->SetView(view, 0.0);
        return scene;
    }
    if (entry.name == "profiles") return std::make_unique<ProfilesScreen>();
    if (entry.name == "plans") return std::make_unique<PlansScreen>();
    if (entry.name == "updates") return std::make_unique<UpdatesScreen>();
    if (entry.name == "watchlist") {
        // The watchlist is a page of posters: its heading and filters over a grid. The app fills it in.
        auto scene = std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
        SceneView view;
        view.style = SceneStyle::Page;
        view.kicker = "Saved for later";
        view.heading = "Watchlist";
        view.status = "Loading watchlist\xE2\x80\xA6";
        scene->SetView(view, 0.0);
        return scene;
    }
    if (entry.name == "search") {
        // Search is a scene too: the field across the top, and the results as rails. The app types into it.
        auto scene = std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
        SceneView view;
        view.style = SceneStyle::Search;
        view.status = "Search films and series, or paste a link.";
        scene->SetView(view, 0.0);
        return scene;
    }
    return std::make_unique<PendingScreen>(entry.name, entry.kind == nav::ViewKind::Modal);
}

void Shell::RestoreFocus(double nowMs) {
    const std::optional<std::string> key = nav::FocusToRestore(stack_);
    if (key.has_value()) Top().FocusItem(*key, nowMs, true);
}

void Shell::ApplyMotionIfChanged() {
    const motion::MotionSettings stored = store_.Motion();
    if (stored == motion_) return;
    motion_ = stored;
    stage_.SetMotion(motion_);
    for (auto& [key, screen] : screens_) screen->SetMotion(motion_);
}

void Shell::MouseMove(double x, double y, bool buttonDown, double nowMs) {
    const nav::MouseState::MoveResult result = mouse_.OnMove(x, y, buttonDown);
    clicks_.Move(0, x, y);
    if (!result.counted) return;

    // Hover moves focus without moving the camera, so content does not slide
    // out from under the pointer.
    const std::optional<std::string> item = Top().ItemAt(x, y);
    if (item.has_value() && Top().FocusedKey() != item) Top().FocusItem(*item, nowMs, false);
}

void Shell::MouseDown(double x, double y, double /*nowMs*/) {
    mouse_.ShowCursor();
    clicks_.Press(0, x, y, Top().ItemAt(x, y));
}

void Shell::MouseUp(double x, double y, double nowMs) {
    const std::optional<std::string> item = clicks_.Release(0, x, y);
    if (!item.has_value()) return;
    const std::optional<Command> command = Top().ActivateItem(*item, nowMs);
    if (command.has_value()) Open(*command, nowMs);
    ApplyMotionIfChanged();
}

void Shell::Wheel(double x, double y, double deltaX, double deltaY, bool shift, nav::WheelMode mode, double nowMs) {
    mouse_.ShowCursor();

    // A sideways wheel, or Shift with the wheel, over a rail moves the rail.
    // Anything else moves the page.
    const bool horizontal = std::fabs(deltaX) > std::fabs(deltaY);
    const std::optional<ScrollSurface> rail = Top().SurfaceAt(x, y, nav::Axis::X);
    if (rail.has_value() && rail->kind == ScrollSurface::Kind::Rail && rail->canPan &&
        nav::WheelWantsRail(deltaX, deltaY, shift)) {
        const double delta = nav::WheelPixels(horizontal ? deltaX : deltaY, mode, rail->viewport);
        if (delta != 0.0) Pan(*rail, delta, mode, nowMs);
        return;
    }

    const std::optional<ScrollSurface> page = Top().SurfaceAt(x, y, nav::Axis::Y);
    if (!page.has_value() || !page->canPan) return;
    const double step = nav::WheelPixels(deltaY, mode, page->viewport);
    if (step != 0.0) Pan(*page, step, mode, nowMs);
}

void Shell::Pan(const ScrollSurface& surface, double delta, nav::WheelMode mode, double nowMs) {
    // Pixel deltas from a trackpad already carry momentum, so they move at once.
    // Notches ease, and each one adds to the target a spin is heading for.
    if (mode == nav::WheelMode::Pixel && std::fabs(delta) < kWheelInstantPx) {
        Top().SetScroll(surface, surface.scroll + delta, nowMs);
    } else {
        Top().AnimateScroll(surface, nav::WheelTarget(surface.scroll, surface.target, delta), nowMs);
    }
}

void Shell::TouchDown(std::uint32_t pointerId, double x, double y, double nowMs) {
    touchRail_.reset();
    touchPage_.reset();

    const std::optional<std::string> item = Top().ItemAt(x, y);
    std::optional<ScrollSurface> rail = Top().SurfaceAt(x, y, nav::Axis::X);
    if (rail.has_value() && !(rail->kind == ScrollSurface::Kind::Rail && rail->canPan)) rail.reset();
    std::optional<ScrollSurface> page = Top().SurfaceAt(x, y, nav::Axis::Y);
    if (page.has_value() && !page->canPan) page.reset();

    touch_.Down(pointerId, x, y, item, rail.has_value(), rail.has_value() ? rail->scroll : 0.0, page.has_value(),
                page.has_value() ? page->scroll : 0.0, nowMs);
    touchRail_ = rail;
    touchPage_ = page;
}

void Shell::TouchMove(std::uint32_t pointerId, double x, double y, double nowMs) {
    const nav::TouchGesture::MoveResult move = touch_.Move(pointerId, x, y, nowMs);
    if (!move.scroll.has_value()) return;

    if (move.axis == nav::Axis::X && touchRail_.has_value()) {
        touchRail_->scroll = *move.scroll;
        Top().SetScroll(*touchRail_, *move.scroll, nowMs);
    } else if (move.axis == nav::Axis::Y && touchPage_.has_value()) {
        touchPage_->scroll = *move.scroll;
        Top().SetScroll(*touchPage_, *move.scroll, nowMs);
    }
}

void Shell::TouchUp(std::uint32_t pointerId, double x, double y, double nowMs) {
    const nav::TouchGesture::ReleaseResult release = touch_.Release(
        pointerId, x, y, nowMs, touchRail_.has_value() ? touchRail_->scroll : 0.0,
        touchPage_.has_value() ? touchPage_->scroll : 0.0);

    if (release.momentum.has_value()) {
        if (release.axis == nav::Axis::X && touchRail_.has_value()) {
            Top().AnimateScroll(*touchRail_, *release.momentum, nowMs);
        } else if (release.axis == nav::Axis::Y && touchPage_.has_value()) {
            Top().AnimateScroll(*touchPage_, *release.momentum, nowMs);
        }
    }
    touchRail_.reset();
    touchPage_.reset();

    if (release.tapKey.has_value()) {
        const std::optional<Command> command = Top().ActivateItem(*release.tapKey, nowMs);
        if (command.has_value()) Open(*command, nowMs);
    }
    ApplyMotionIfChanged();
}

void Shell::TouchCancel() {
    touch_.Cancel();
    touchRail_.reset();
    touchPage_.reset();
}

}  // namespace tvm::ui
