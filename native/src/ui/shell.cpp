#include "ui/shell.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>

#include "ui/details_screen.h"
#include "ui/downloads_screen.h"
#include "ui/pending_screen.h"
#include "ui/profile_chooser.h"
#include "ui/profile_editor.h"
#include "ui/glass_styles.h"
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
// How long after a wheel spin, an arrow click or a drag the hover keeps re-picking what is under a still pointer,
// long enough for the glide that follows to finish.
constexpr double kRehoverMs = 1200.0;

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
    // Content that moved under a still pointer: what is under it now is what is hovered.
    if (nowMs < rehoverUntilMs_ && pointerIn_ && mouse_.cursorVisible() &&
        !(mouseDrag_.has_value() && mouseDrag_->dragging)) {
        HoverAt(pointerX_, pointerY_, nowMs);
    }
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
    const ThemeScope theme(ActiveScreenName() == "player" ? Theme::Dark : store_.Look(),
                           store_.ReduceTransparency() || motion_.performanceMode, motion::PrefersReducedMotion(motion_));
    const FontScope font(store_.Font());
    tokens::pointer = pointer_;
    struct ResetPointer {
        ~ResetPointer() { tokens::pointer.reset(); }
    } resetPointer;
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
    if (const auto back = BackBox()) {
        painter.Glass(*back, back->height / 2, backFocused_ ? glass::NavSelected() : glass::NavCapsule());
        const double inset = back->width * 0.24;
        const Color chevronInk = painter.GlassInk(Rgb(0xFFFFFF, 0.95));
        painter.Path({back->x + inset, back->y + inset, back->width - 2 * inset, back->height - 2 * inset}, 24,
                     "M15 5l-7 7 7 7", {{0, 0, 0, 0}, chevronInk, 2.3, false});
    }
    if (releaseCard_ && ActiveScreenName() == "home") {
        const Box card = ReleaseBox();
        const double rem = ViewportRem(width_, height_);
        painter.Glass(card, 18 * rem / 16, glass::MenuPanel());
        const double x = card.x + 1.3 * rem, width = card.width - 2.6 * rem;
        painter.Text({x, card.y + rem, width, 2 * rem}, "Updated to " + releaseCard_->version, {1.15 * rem, true, 650}, Rgb(0xFFFFFF, 0.95));
        painter.Paragraph({x, card.y + 3 * rem, width, 3.5 * rem}, releaseCard_->title, {1.05 * rem, true, 600}, Rgb(0xFFFFFF, 0.95));
        double y = card.y + 7 * rem;
        for (std::size_t i = 0; i < std::min<std::size_t>(4, releaseCard_->highlights.size()); ++i) {
            painter.Paragraph({x, y, width, 3.2 * rem}, releaseCard_->highlights[i], {0.88 * rem, false}, Rgb(0xFFFFFF, 0.66));
            y += 3.6 * rem;
        }
        painter.Text({x, card.Bottom() - 3.5 * rem, width, 2.5 * rem}, "All changes", {0.95 * rem, true, 600}, Rgb(0x9DBDFF));
    }
    if (patchNotes_) {
        const double rem = ViewportRem(width_, height_);
        painter.FillRoundRect({0, 0, width_, height_}, 0, Rgb(0x000000, 0.66));
        const double sheetW = std::min(width_ - 3 * rem, 720.0);
        const double sheetH = std::min(height_ - 3 * rem, 40 * rem);
        const Box sheet{(width_ - sheetW) / 2, (height_ - sheetH) / 2, sheetW, sheetH};
        painter.Glass(sheet, 22 * rem / 16, glass::MenuPanel());
        const double x = sheet.x + 1.8 * rem, w = sheet.width - 3.6 * rem;
        const Box button = PatchButtonBox();
        painter.FillRoundRect({x, sheet.y + 1.6 * rem, 9 * rem, 1.8 * rem}, 0.9 * rem, Rgb(0x2F6BFF, 0.35));
        painter.Text({x + 0.8 * rem, sheet.y + 1.6 * rem, 8 * rem, 1.8 * rem}, "TVM " + patchNotes_->version, {0.9 * rem, true, 650}, Rgb(0xFFFFFF, 0.95));
        painter.Paragraph({x, sheet.y + 3.8 * rem, w, 3.4 * rem}, patchNotes_->title, {1.7 * rem, true, 700}, Rgb(0xFFFFFF, 0.97));

        // The body: highlights, then the changes under their area, then the known issues. It scrolls inside its box.
        const Box body = PatchBodyBox();
        constexpr std::uint32_t kWarn = 0xFFC857;
        painter.PushClip(body);
        // Where the text runs on past an edge it fades out, so it is clear there is more. The fade is per item,
        // by how far its first lines are from the edge, since the sheet is glass and has no flat colour to fade to.
        const double fade = 2.6 * rem;
        const bool fadeTop = patchScroll_ > 1.0, fadeBottom = patchScroll_ < PatchMaxScroll() - 1.0;
        WalkPatch([&](PatchItem item, double top, double height, const PatchChange& change) {
            const double y = body.y + top - patchScroll_;
            if (y + height < body.y - 2 * rem || y > body.Bottom() + 2 * rem) return;
            const double lead = std::min(height, 1.5 * rem);
            double alpha = 1.0;
            if (fadeTop) alpha = std::min(alpha, std::clamp((y + height - lead - body.y + 0.5 * rem) / fade, 0.0, 1.0));
            if (fadeBottom) alpha = std::min(alpha, std::clamp((body.Bottom() - (y + lead * 0.5)) / fade, 0.0, 1.0));
            if (alpha <= 0.01) return;
            struct Layer {
                Painter& painter; bool on;
                Layer(Painter& p, double a) : painter(p), on(a < 0.995) { if (on) painter.PushOpacity(a); }
                ~Layer() { if (on) painter.PopOpacity(); }
            } layer(painter, alpha);
            const TextStyle small{0.88 * rem, false};
            switch (item) {
            case PatchItem::Highlight:
                painter.Paragraph({body.x, y, body.width, height}, change.text, {1.0 * rem, true, 650}, Rgb(0xFFFFFF, 0.95));
                break;
            case PatchItem::Area:
                painter.Text({body.x, y, body.width, height}, change.area, {0.78 * rem, true, 700, 0.06}, Rgb(0x9DBDFF, 0.9));
                break;
            case PatchItem::IssuesHeading:
                painter.Text({body.x, y, body.width, height}, "Known issues", {0.95 * rem, true, 700}, Rgb(kWarn));
                break;
            case PatchItem::Change:
            case PatchItem::Issue: {
                const bool issue = item == PatchItem::Issue;
                const Color ink = issue ? Rgb(kWarn, 0.9) : Rgb(0xFFFFFF, 0.72);
                const double dot = 0.34 * rem;
                painter.FillRoundRect({body.x + 0.15 * rem, y + 0.55 * rem, dot, dot}, dot / 2, issue ? Rgb(kWarn) : Rgb(0x9DBDFF, 0.8));
                const double tagsHeight = change.platforms.empty() ? 0.0 : 1.55 * rem;
                painter.Paragraph({body.x + 1.1 * rem, y, body.width - 1.1 * rem, height - tagsHeight}, change.text, small, ink);
                // The platforms the line is for, as small tags under it.
                double tagX = body.x + 1.1 * rem;
                for (const std::string& id : change.platforms) {
                    const std::string label = PlatformLabel(id);
                    const TextStyle tag{0.7 * rem, true, 650};
                    const double tagW = painter.MeasureText(label, tag) + 1.0 * rem;
                    const Box pill{tagX, y + height - tagsHeight + 0.2 * rem, tagW, 1.2 * rem};
                    painter.FillRoundRect(pill, pill.height / 2, Rgb(0xFFFFFF, 0.1));
                    painter.Text({pill.x + 0.5 * rem, pill.y, tagW, pill.height}, label, tag, Rgb(0xFFFFFF, 0.7));
                    tagX += tagW + 0.4 * rem;
                }
                break;
            }
            }
        });
        painter.PopClip();

        // A slim bar at the right edge shows where the body is.
        if (PatchMaxScroll() > 0.0) {
            const double content = PatchMaxScroll() + body.height;
            const double barH = std::max(2.0 * rem, body.height * body.height / content);
            const double barY = body.y + (body.height - barH) * (patchScroll_ / PatchMaxScroll());
            painter.FillRoundRect({sheet.Right() - 0.9 * rem, barY, 0.3 * rem, barH}, 0.15 * rem, Rgb(0xFFFFFF, 0.28));
        }

        painter.FillRoundRect(button, button.height / 2, Rgb(0xFFFFFF, 0.94));
        painter.StrokeRoundRect(button, button.height / 2, 2.0, Rgb(0x9DBDFF, 0.9));
        painter.Text({button.x + button.width / 2 - 1.5 * rem, button.y + button.height * 0.2, button.width, button.height * 0.6}, "Got it", {1.0 * rem, true, 700}, Rgb(0x0B0F17));
    }
}

std::string Shell::PlatformLabel(const std::string& id) {
    if (id == "windows") return "Windows";
    if (id == "web") return "Web";
    if (id == "desktop") return "Desktop";
    if (id == "ios") return "iPhone";
    if (id == "android") return "Android";
    if (id == "roku") return "Roku";
    return id;
}

Box Shell::PatchBodyBox() const {
    const double rem = ViewportRem(width_, height_);
    const double sheetW = std::min(width_ - 3 * rem, 720.0);
    const double sheetH = std::min(height_ - 3 * rem, 40 * rem);
    const double left = (width_ - sheetW) / 2, top = (height_ - sheetH) / 2;
    const Box button = PatchButtonBox();
    const double y = top + 7.4 * rem;
    return {left + 1.8 * rem, y, sheetW - 3.6 * rem, std::max(0.0, button.y - 1.0 * rem - y)};
}

double Shell::WalkPatch(const std::function<void(PatchItem, double, double, const PatchChange&)>& emit) const {
    if (!patchNotes_) return 0.0;
    const double rem = ViewportRem(width_, height_);
    const double width = PatchBodyBox().width;
    // The painter wraps by words; this counts lines from the character count. Text in this face averages about
    // 0.45 em a character (a little more in bold), so 0.5 leaves room for words that wrap early.
    const auto lines = [](const std::string& text, double size, double room, double em = 0.5) {
        const double perLine = std::max(1.0, room / (size * em));
        return std::max(1.0, std::ceil(static_cast<double>(text.size()) / perLine));
    };
    double y = 0.0;
    for (const std::string& line : patchNotes_->highlights) {
        const double height = lines(line, 1.0 * rem, width, 0.54) * 1.42 * rem;
        emit(PatchItem::Highlight, y, height, PatchChange{"", line, {}});
        y += height + 0.55 * rem;
    }
    std::string area;
    bool first = true;
    for (const PatchChange& change : patchNotes_->changes) {
        if (first || change.area != area) {
            area = change.area;
            y += first ? 0.5 * rem : 0.3 * rem;
            if (!area.empty()) {
                emit(PatchItem::Area, y, 1.5 * rem, change);
                y += 1.7 * rem;
            }
            first = false;
        }
        const double tags = change.platforms.empty() ? 0.0 : 1.55 * rem;
        const double height = lines(change.text, 0.88 * rem, width - 1.1 * rem) * 1.42 * 0.88 * rem + tags;
        emit(PatchItem::Change, y, height, change);
        y += height + 0.55 * rem;
    }
    if (!patchNotes_->knownIssues.empty()) {
        y += 0.8 * rem;
        emit(PatchItem::IssuesHeading, y, 1.8 * rem, PatchChange{});
        y += 2.0 * rem;
        for (const std::string& issue : patchNotes_->knownIssues) {
            const double height = lines(issue, 0.88 * rem, width - 1.1 * rem) * 1.42 * 0.88 * rem;
            emit(PatchItem::Issue, y, height, PatchChange{"", issue, {}});
            y += height + 0.5 * rem;
        }
    }
    return y;
}

double Shell::PatchMaxScroll() const {
    const double content = WalkPatch([](PatchItem, double, double, const PatchChange&) {});
    return std::max(0.0, content - PatchBodyBox().height);
}

bool Shell::ScrollPatchNotes(double deltaPx) {
    if (!patchNotes_) return false;
    const double next = std::clamp(patchScroll_ + deltaPx, 0.0, PatchMaxScroll());
    if (next == patchScroll_) return false;
    patchScroll_ = next;
    return true;
}

Box Shell::PatchButtonBox() const {
    const double rem = ViewportRem(width_, height_);
    const double sheetW = std::min(width_ - 3 * rem, 720.0);
    const double sheetH = std::min(height_ - 3 * rem, 40 * rem);
    const double left = (width_ - sheetW) / 2, top = (height_ - sheetH) / 2;
    return {left + sheetW - 1.8 * rem - 9 * rem, top + sheetH - 1.6 * rem - 2.8 * rem, 9 * rem, 2.8 * rem};
}

std::optional<Box> Shell::BackBox() const {
    const auto name = ActiveScreenName();
    if (!nav::CanGoBack(stack_) || name == "player" || name == "details" || name == "profile-menu") return std::nullopt;
    const double rem = ViewportRem(width_, height_);
    const double side = std::max(44.0, 2.75 * rem);
    return Box{1.0 * rem, 0.5 * rem, side, side};
}
Box Shell::ReleaseBox() const {
    const double rem = ViewportRem(width_, height_);
    const double width = std::min(width_ - 3 * rem, 31 * rem);
    return {width_ - width - 1.5 * rem, height_ - 28.5 * rem, width, 27 * rem};
}
std::optional<std::string> Shell::Hit(double x, double y) {
    const auto inside = [&](const Box& box) { return x >= box.x && y >= box.y && x < box.Right() && y < box.Bottom(); };
    if (patchNotes_) return inside(PatchButtonBox()) ? std::optional<std::string>("shell-patch-ok") : std::optional<std::string>("shell-patch-sink");
    if (const auto back = BackBox(); back && inside(*back)) return "shell-back";
    if (releaseCard_ && ActiveScreenName() == "home" && inside(ReleaseBox())) return "shell-changelog";
    return Top().ItemAt(x, y);
}
bool Shell::ActivateChrome(const std::string& key, double nowMs) {
    if (key.rfind("shell-patch", 0) == 0) return true;
    if (key == "shell-back") { backFocused_ = false; Back(nowMs); return true; }
    if (key == "shell-changelog") { Command command; command.name = "changelog"; Open(command, nowMs); return true; }
    return false;
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

void Shell::SetDeveloperDiagnostics(const DeveloperDiagnostics& diag) {
    for (auto& [key, screen] : screens_) {
        auto* settings = dynamic_cast<SettingsScreen*>(screen.get());
        if (settings != nullptr) settings->SetDeveloperDiagnostics(diag);
    }
}

void Shell::SetCoreSettings(const CoreSettings& settings) {
    coreSettings_ = settings;
    for (auto& [key, screen] : screens_) {
        auto* page = dynamic_cast<SettingsScreen*>(screen.get());
        if (page != nullptr) page->SetCoreSettings(settings);
    }
}

void Shell::SetPrefsSink(PrefsSink sink) {
    prefsSink_ = std::move(sink);
    for (auto& [key, screen] : screens_) {
        auto* page = dynamic_cast<SettingsScreen*>(screen.get());
        if (page != nullptr) page->SetPrefsSink(prefsSink_);
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
    // A key brings the focus back into view, so the remote and the keyboard always see where they are.
    Top().ShowFocus(clock_);
}

void Shell::Navigate(nav::Direction direction, double nowMs) {
    rehoverUntilMs_ = 0.0;
    KeyPressed();
    if (backFocused_) { if (direction == nav::Direction::Down || direction == nav::Direction::Right) backFocused_ = false; return; }
    if (!Top().Navigate(direction, nowMs) && direction == nav::Direction::Up && BackBox()) backFocused_ = true;
}

void Shell::Select(double nowMs) {
    KeyPressed();
    if (backFocused_) { ActivateChrome("shell-back", nowMs); return; }
    const std::optional<Command> command = Top().Select(nowMs);
    if (command.has_value()) Open(*command, nowMs);
    ApplyMotionIfChanged();
}

bool Shell::Back(double nowMs) {
    KeyPressed();
    backFocused_ = false;
    if (Top().CloseOverlay(nowMs)) return true;
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
    if (guard_ && !guard_(command)) return;
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
        auto settings = std::make_unique<SettingsScreen>(store_, motion_);
        settings->SetCoreSettings(coreSettings_);
        settings->SetPrefsSink(prefsSink_);
        return settings;
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
        "legal", "donate", "changelog", "diagnostics", "system-info", "setup", "recovery",
        "live-check", "mail-settings", "accounts", "developer", "apps", "confirm", "services", "stats", "extras-settings"};
    if (kInfoPages.contains(entry.name)) return std::make_unique<InfoScreen>();
    if (entry.name == "account") return std::make_unique<AccountScreen>();
    if (entry.name == "service") {
        // A service hub is a stream-style scene in the service's colours. The app fills it in.
        auto scene = std::make_unique<Scene>(std::vector<RailSpec>{}, motion_);
        SceneView view;
        view.style = SceneStyle::Stream;
        view.status = "Opening\xE2\x80\xA6";
        scene->SetView(view, 0.0);
        return scene;
    }
    if (entry.name == "profile-editor" || entry.name == "pin-pad") return std::make_unique<ProfileEditor>();
    if (entry.name == "profiles") return std::make_unique<ProfilesScreen>();
    if (entry.name == "downloads") return std::make_unique<DownloadsScreen>();
    if (entry.name == "chooser") return std::make_unique<ProfileChooser>();
    if (entry.name == "profile-menu") return std::make_unique<ProfileMenu>();
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
    pointer_ = Point{x, y};
    const nav::MouseState::MoveResult result = mouse_.OnMove(x, y, buttonDown);
    clicks_.Move(0, x, y);
    if (mouseDrag_.has_value() && buttonDown) {
        MouseDrag& drag = *mouseDrag_;
        if (!drag.dragging && nav::PanAxis(x - drag.startX, y - drag.startY) == std::optional<nav::Axis>(nav::Axis::X)) {
            drag.dragging = true;
            Top().SetPressed(std::nullopt, nowMs);
        }
        if (drag.dragging) {
            const double dt = std::max(1.0, nowMs - drag.lastMs);
            drag.velocity = (x - drag.lastX) / dt;
            drag.lastX = x;
            drag.lastMs = nowMs;
            const double scroll = std::clamp(nav::DragScroll(drag.rail.scroll, drag.startX, x), 0.0, drag.rail.maxScroll);
            Top().SetScroll(drag.rail, scroll, nowMs);
            return;
        }
    } else if (!buttonDown) {
        mouseDrag_.reset();
    }
    if (!result.counted) return;

    pointerIn_ = true;
    pointerX_ = x;
    pointerY_ = y;
    HoverAt(x, y, nowMs);
}

void Shell::HoverAt(double x, double y, double nowMs) {
    // Hover moves focus without moving the camera, so content does not slide
    // out from under the pointer. Over empty space the focus stays put for the remote, but its hover look eases
    // away, so nothing stays lit after the pointer has left it.
    Top().PointerAt(x, y, nowMs);
    const std::optional<std::string> item = Hit(x, y);
    // Chrome and rail arrows must not light or focus the poster beneath them.
    if (!item.has_value() || item->rfind("rail-", 0) == 0 || *item == "shell-back" || *item == "shell-changelog") {
        Top().PointerLeft(nowMs);
        return;
    }
    Top().ShowFocus(nowMs);
    if (Top().FocusedKey() != item) Top().FocusItem(*item, nowMs, false);
}

void Shell::MouseLeave(double nowMs) {
    pointer_.reset();
    pointerIn_ = false;
    Top().PointerAt(-1.0, -1.0, nowMs);
    Top().PointerLeft(nowMs);
}

void Shell::MouseDown(double x, double y, double nowMs) {
    mouse_.ShowCursor();
    const std::optional<std::string> item = Hit(x, y);
    clicks_.Press(0, x, y, item);
    Top().PressedElsewhere(item, nowMs);
    // The pressed look shows at once; the action still waits for the release, as before.
    Top().SetPressed(item, nowMs);
    mouseDrag_.reset();
    const std::optional<ScrollSurface> rail = Top().SurfaceAt(x, y, nav::Axis::X);
    // A press on a rail's arrow is always a click: were it to become a drag, the rail would be pulled back to where
    // it was at the press while the arrow's glide is still under way.
    const bool arrow = item.has_value() && item->rfind("rail-", 0) == 0;
    if (!arrow && rail.has_value() && rail->kind == ScrollSurface::Kind::Rail && rail->canPan) {
        mouseDrag_ = MouseDrag{*rail, x, y, x, nowMs, 0.0, false};
    }
}

void Shell::MouseUp(double x, double y, double nowMs) {
    Top().SetPressed(std::nullopt, nowMs);
    if (mouseDrag_.has_value() && mouseDrag_->dragging) {
        // A drag is never a click. It coasts on a little in the direction it was going.
        const MouseDrag drag = *mouseDrag_;
        mouseDrag_.reset();
        clicks_.Release(0, x, y);
        rehoverUntilMs_ = nowMs + kRehoverMs;
        const double scroll = std::clamp(nav::DragScroll(drag.rail.scroll, drag.startX, x), 0.0, drag.rail.maxScroll);
        ScrollSurface rail = drag.rail;
        rail.scroll = scroll;
        if (std::fabs(drag.velocity) > 0.05) {
            Top().AnimateScroll(rail, std::clamp(nav::MomentumTarget(scroll, drag.velocity), 0.0, rail.maxScroll), nowMs);
        }
        return;
    }
    mouseDrag_.reset();
    const std::optional<std::string> item = clicks_.Release(0, x, y);
    if (!item.has_value()) return;
    if (item->rfind("rail-", 0) == 0) rehoverUntilMs_ = nowMs + kRehoverMs;
    if (ActivateChrome(*item, nowMs)) return;
    const std::optional<Command> command = Top().ActivateItem(*item, nowMs);
    if (command.has_value()) Open(*command, nowMs);
    ApplyMotionIfChanged();
}

void Shell::Wheel(double x, double y, double deltaX, double deltaY, bool shift, nav::WheelMode mode, double nowMs) {
    mouse_.ShowCursor();
    rehoverUntilMs_ = nowMs + kRehoverMs;

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

    const std::optional<std::string> item = Hit(x, y);
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
        if (ActivateChrome(*release.tapKey, nowMs)) return;
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
