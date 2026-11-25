#include "ui/settings_screen.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <utility>

#include "motion/camera.h"
#include "nav/wrap.h"
#include "ui/glass_styles.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;

// One column of slim rows at a comfortable desktop width: the name at the left (with a short second line only for
// the switches and choices that have one), and the value, switch or chevron at the right. Section headings stay.
constexpr double kRowWidthRem = 52.0;
constexpr double kRowHeightRem = 3.1;
constexpr double kTallRowHeightRem = 3.7;
constexpr double kRowGapRem = 0.45;
constexpr double kGroupGapRem = 1.6;
constexpr double kGroupTitleRem = 0.95;
constexpr double kHeaderRem = 8.0;
constexpr double kEnsureVisiblePadRem = 4.0;
constexpr double kRowRadiusRem = 0.85;
constexpr Color kDanger = Rgb(0xFF6B63);

Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}

// A toggle row's value ("On", "Dark") and the words after it, split at the first " · ".
std::pair<std::string, std::string> SplitDetail(const std::string& detail) {
    const std::string dot = " \xC2\xB7 ";
    const std::size_t at = detail.find(dot);
    if (at == std::string::npos) return {detail, ""};
    return {detail.substr(0, at), detail.substr(at + dot.size())};
}

struct LanguageOption {
    const char* id;
    const char* name;
};

// The same order and names as apps/ui/src/i18n/locale.ts.
constexpr std::array<LanguageOption, 9> kLanguages = {{
    {"en", "English"},
    {"es", "Español"},
    {"fr", "Français"},
    {"de", "Deutsch"},
    {"it", "Italiano"},
    {"pt", "Português"},
    {"ja", "日本語"},
    {"ko", "한국어"},
    {"zh", "中文"},
}};

std::string LanguageName(const std::string& id) {
    for (const LanguageOption& option : kLanguages) {
        if (id == option.id) return option.name;
    }
    return "English";
}

// The language after `id`, wrapping at the end, as nextLanguage does.
std::string NextLanguage(const std::string& id) {
    for (std::size_t i = 0; i < kLanguages.size(); ++i) {
        if (id == kLanguages[i].id) return kLanguages[(i + 1) % kLanguages.size()].id;
    }
    return kLanguages.front().id;
}

Command Open(std::string name, std::map<std::string, std::string> params = {}, bool modal = false) {
    Command command;
    command.modal = modal;
    command.name = std::move(name);
    command.params = std::move(params);
    return command;
}

Command Confirm(std::string title, std::string body, std::string confirmLabel, std::string action) {
    return Open("confirm",
                {{"title", std::move(title)},
                 {"body", std::move(body)},
                 {"confirmLabel", std::move(confirmLabel)},
                 {"action", std::move(action)}},
                true);
}

// The copy here is taken from Settings.tsx so the wording matches the web app.


}  // namespace

SettingsScreen::SettingsScreen(PreferenceStore& store, motion::MotionSettings motion)
    : store_(store), core_(store.CorePrefs()) {
    motion_ = motion;
    BuildRows();
}

void SettingsScreen::BuildRows() {
    rows_.clear();
    auto group = [this](std::string title) {
        rows_.push_back(Row{RowKind::Group, "", std::move(title), "", {}, 0.0, 0.0});
    };
    auto row = [this](RowKind kind, std::string key, std::string label, std::string detail = "", Command command = {}) {
        rows_.push_back(Row{kind, std::move(key), std::move(label), std::move(detail), std::move(command), 0.0, 0.0});
    };
    auto push = [&row](std::string key, std::string label, std::string detail, Command command) {
        row(RowKind::Push, std::move(key), std::move(label), std::move(detail), std::move(command));
    };

    group("Picture");
    row(RowKind::Motion, "motion", "Motion");
    row(RowKind::Performance, "performance", "Performance mode");

    group("Look");
    row(RowKind::Theme, "themes", "Theme");
    row(RowKind::Glass, "glass", "Liquid Glass");

    group("Language");
    row(RowKind::Language, "language", "App language");

    group("Playback");
    push("extras-settings", "TVM Extras", "Skipping, autoplay and subtitle languages", Open("extras-settings"));
    push("stats", "Your stats", "Watch time and history", Open("stats"));

    group("Account");
    push("account", "Your account", "Sign in, email verification and access", Open("account"));
    push("privacy", "Privacy & terms", "Terms, data export and deletion", Open("legal"));
    push("plan", "Plan", "Access and pricing", Open("plans"));
    push("profiles", "Profiles", "Switch, add, rename or remove", Open("chooser"));
    row(RowKind::ChooseProfile, "choose-profile", "Choose profile on launch");
    push("services", "Streaming services", "Sign in to your services", Open("services"));
    push("realdebrid", "Real-Debrid", "Your token", Open("realdebrid"));

    group("Device");
    push("network", "Network", "Connected or offline", Open("system-info", {{"section", "network"}}));
    push("display", "Display", "Panel, window and stream cap", Open("system-info", {{"section", "display"}}));
    push("livetv", "Live TV login", "Server, username and password", Open("live-xtream"));
    push("live-playlist", "Live TV playlist", "M3U / M3U8", Open("live-playlist"));
    push("updates", "Updates", "GLogic Studios", Open("updates"));
    row(RowKind::AutoUpdate, "auto-update", "Check for updates on launch");
    push("changelog", "What's new", "Release notes for TVM", Open("changelog", {}, true));
    push("diagnostics", "Diagnostics", "", Open("diagnostics", {}, true));
    if (diag_.active) push("accounts", "Accounts", "Manage member access", Open("accounts"));

    group("Maintenance");
    push("clear-cache", "Clear cache", "Artwork and catalogs",
         Confirm("Clear cache?",
                 "Artwork and catalog caches are deleted. Your Real-Debrid token, profiles and watch history stay.",
                 "Clear cache", "clear-cache"));
    push("factory-reset", "Fully reset", "Including the Real-Debrid token",
         Confirm("Fully reset TVM?",
                 "Profiles, watch history, My List, Live TV playlist, caches and the Real-Debrid token are removed. You will need to paste the token again.",
                 "Fully reset", "factory-reset"));
    push("restart", "Restart", "",
         Confirm("Restart TVM?", "The interface reloads. Nothing on disk is changed.", "Restart", "restart"));

    if (diag_.active) {
        group("Developer Diagnostics");
        row(RowKind::Info, "dev-build", "Build info", diag_.buildVersion);
        row(RowKind::Info, "dev-rd-source", "RD token source", diag_.rdTokenSource);
        row(RowKind::Info, "dev-glass", "Glass mode");
        push("dev-refresh-cache", "Quick cache refresh", "Reload catalog and artwork",
             Command{false, "dev-refresh-cache", {}, true});
    }

    RefreshDetails();

    // Focus starts on the first row that can take it.
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (Focusable(rows_[i])) {
            focus_ = i;
            break;
        }
    }
}

void SettingsScreen::SetDeveloperDiagnostics(DeveloperDiagnostics diag) {
    if (diag_ == diag) return;
    diag_ = std::move(diag);
    const std::optional<std::string> prevFocus = FocusedKey();
    BuildRows();
    if (width_ > 0.0 && height_ > 0.0) Arrange();
    if (prevFocus.has_value()) FocusItem(*prevFocus, clockMs_, false);
}

void SettingsScreen::RefreshDetails() {
    for (Row& row : rows_) {
        if (row.kind == RowKind::Group) continue;
        row.detail = DetailFor(row);
    }
}

std::string SettingsScreen::DetailFor(const Row& row) const {
    switch (row.kind) {
    case RowKind::Motion:
        return motion_.preference == motion::MotionPreference::Reduced ? "Reduced · freeze decorative loops"
                                                                       : "Auto · UI animates";
    case RowKind::Performance:
        return motion_.performanceMode ? "On · simpler effects and motion" : "Off · full UI motion";
    case RowKind::Theme:
        return store_.Look() == Theme::Light ? "Light" : "Dark";
    case RowKind::Glass:
        return store_.Glass() == GlassClarity::Tinted ? "Tinted - more contrast" : store_.Glass() == GlassClarity::Clear ? "Clear - less blur" : "Default - balanced glass";
    case RowKind::Language:
        return LanguageName(core_.language);
    case RowKind::AutoUpdate:
        return core_.autoUpdate ? "On · check when this app opens" : "Off · check from Updates";
    case RowKind::ChooseProfile:
        return store_.ChooseProfileOnLaunch() ? "On \xC2\xB7 ask who's watching when TVM opens"
                                              : "Off \xC2\xB7 open the last profile";
    case RowKind::Push:
    case RowKind::Info:
        if (row.key == "dev-glass") {
            return store_.Glass() == GlassClarity::Tinted ? "Tinted" : store_.Glass() == GlassClarity::Clear ? "Clear" : "Default";
        }
        return row.detail;
    case RowKind::Group:
        break;
    }
    return "";
}

bool SettingsScreen::Focusable(const Row& row) const {
    return row.kind != RowKind::Group && row.kind != RowKind::Info;
}

std::vector<std::string> SettingsScreen::RowLabels() const {
    std::vector<std::string> labels;
    for (const Row& row : rows_) labels.push_back(row.label);
    return labels;
}

std::string SettingsScreen::DetailOf(const std::string& key) const {
    for (const Row& row : rows_) {
        if (row.key == key) return row.detail;
    }
    return "";
}

void SettingsScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    metrics_.rem = ViewportRem(width, height);
    Arrange();
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
}

void SettingsScreen::Arrange() {
    // One column, centred at a comfortable width. Positions are in page coordinates.
    const double safe = metrics_.Rem(kSafeXRem);
    const double content = std::min(width_ - 2.0 * safe, metrics_.Rem(kRowWidthRem));
    const double left = std::max(safe, (width_ - content) / 2.0);
    const bool compact = CompactViewport(width_, height_);
    const double titleHeight = metrics_.Rem(kGroupTitleRem) * 1.6;
    double y = metrics_.Rem(kSafeYRem) + metrics_.Rem(kHeaderRem);
    bool first = true;
    for (Row& row : rows_) {
        if (row.kind == RowKind::Group) {
            if (!first) y += metrics_.Rem(kGroupGapRem);
            row.top = y;
            row.height = titleHeight;
            y += row.height + metrics_.Rem(0.35);
        } else {
            // A row with a second line (a switch's or a choice's explanation) is a little taller.
            const bool tall = !SplitDetail(row.detail).second.empty() && row.kind != RowKind::Push;
            const double height = metrics_.Rem(tall ? kTallRowHeightRem : kRowHeightRem);
            row.top = y;
            row.height = compact ? std::max(56.0, height) : height;
            y += row.height + metrics_.Rem(kRowGapRem);
        }
        row.column = 0;
        row.left = left;
        row.width = content;
        first = false;
    }
    contentBottom_ = y - metrics_.Rem(kRowGapRem);
}

double SettingsScreen::MaxPageScroll() const {
    return std::max(0.0, contentBottom_ + metrics_.Rem(kSafeYRem) - height_);
}

Box SettingsScreen::ScreenBox(const Row& row) const {
    return Box{row.left, row.top - pageScroll_, row.width, row.height};
}

std::optional<std::size_t> SettingsScreen::FocusedIndex() const {
    return focus_;
}

bool SettingsScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (!camera_.active()) return language_.Animating(nowMs);
    const motion::CameraStep step = camera_.Step(nowMs, reduced);
    pageScroll_ = step.position;
    return true;
}

bool SettingsScreen::Animating() const {
    return camera_.active() || language_.Animating(clockMs_);
}

void SettingsScreen::EnsureVisible(const Row& row, double nowMs) {
    const double pad = metrics_.Rem(kEnsureVisiblePadRem);
    double target = pageScroll_;
    if (row.top < pageScroll_ + pad) target = row.top - pad;
    else if (row.top + row.height > pageScroll_ + height_ - pad) target = row.top + row.height - (height_ - pad);
    target = std::clamp(target, 0.0, MaxPageScroll());
    if (std::abs(target - pageScroll_) < 1.0) return;
    camera_.Begin(pageScroll_, target, MaxPageScroll(), motion::PrefersReducedMotion(motion_));
    if (!camera_.active()) pageScroll_ = camera_.position();
    (void)nowMs;
}

bool SettingsScreen::Navigate(nav::Direction direction, double nowMs) {
    // An open list takes the arrows.
    if (language_.IsOpen()) return language_.Navigate(direction, nowMs);
    if (direction != nav::Direction::Up && direction != nav::Direction::Down) return false;
    if (!focus_.has_value()) return false;
    // The nearest focusable row above or below. Headings and info rows are skipped.
    std::optional<std::size_t> next;
    if (direction == nav::Direction::Down) {
        for (std::size_t i = *focus_ + 1; i < rows_.size() && !next.has_value(); ++i) {
            if (Focusable(rows_[i])) next = i;
        }
    } else {
        for (std::size_t i = *focus_; i > 0 && !next.has_value(); --i) {
            if (Focusable(rows_[i - 1])) next = i - 1;
        }
    }
    if (!next.has_value()) return false;
    focus_ = next;
    EnsureVisible(rows_[*next], nowMs);
    return true;
}

std::optional<Command> SettingsScreen::Select(double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (language_.IsOpen()) {
        PickLanguage(language_.Highlighted(), nowMs);
        return std::nullopt;
    }
    const std::optional<std::size_t> index = FocusedIndex();
    if (!index.has_value()) return std::nullopt;
    return ApplyRow(*index);
}

std::optional<Command> SettingsScreen::ApplyRow(std::size_t index) {
    Row& row = rows_[index];
    switch (row.kind) {
    case RowKind::Motion:
        // Auto and Reduced toggle, as the web row does. Full is set elsewhere.
        motion_.preference = motion_.preference == motion::MotionPreference::Reduced
                                 ? motion::MotionPreference::Auto
                                 : motion::MotionPreference::Reduced;
        store_.SaveMotion(motion_);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Performance:
        motion_.performanceMode = !motion_.performanceMode;
        store_.SaveMotion(motion_);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Language: {
        // A list of the supported languages opens under the row's value, as Android's picker does.
        std::vector<DropdownOption> options;
        std::size_t selected = 0;
        for (std::size_t i = 0; i < kLanguages.size(); ++i) {
            options.push_back(DropdownOption{kLanguages[i].name, ""});
            if (core_.language == kLanguages[i].id) selected = i;
        }
        const Box box = ScreenBox(row);
        const double width = metrics_.Rem(15.0);
        language_.Open(Box{box.Right() - width, box.y, width, box.height}, std::move(options), selected, width_, height_,
                       metrics_.rem, clockMs_, motion_);
        return std::nullopt;
    }

    case RowKind::Theme:
        store_.SaveLook(store_.Look() == Theme::Dark ? Theme::Light : Theme::Dark);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Glass:
        store_.SaveGlass(store_.Glass() == GlassClarity::Clear ? GlassClarity::Default : store_.Glass() == GlassClarity::Default ? GlassClarity::Tinted : GlassClarity::Clear);
        RefreshDetails();
        return std::nullopt;

    case RowKind::AutoUpdate:
        core_.autoUpdate = !core_.autoUpdate;
        store_.SaveCorePrefs(prefs::CorePrefsPatch{std::nullopt, core_.autoUpdate});
        RefreshDetails();
        return std::nullopt;

    case RowKind::ChooseProfile:
        store_.SaveChooseProfileOnLaunch(!store_.ChooseProfileOnLaunch());
        RefreshDetails();
        return std::nullopt;

    case RowKind::Push:
        return row.command;

    case RowKind::Group:
    case RowKind::Info:
        break;
    }
    return std::nullopt;
}

std::optional<std::string> SettingsScreen::FocusedKey() const {
    if (!focus_.has_value()) return std::nullopt;
    return rows_[*focus_].key;
}

void SettingsScreen::PickLanguage(std::size_t index, double nowMs) {
    if (index < kLanguages.size()) {
        core_.language = kLanguages[index].id;
        store_.SaveCorePrefs(prefs::CorePrefsPatch{core_.language, std::nullopt});
        RefreshDetails();
    }
    language_.Close(nowMs);
}

bool SettingsScreen::CloseOverlay(double nowMs) {
    if (!language_.IsOpen()) return false;
    language_.Close(nowMs);
    return true;
}

bool SettingsScreen::FocusItem(const std::string& key, double nowMs, bool withCamera) {
    if (key.rfind("lang:", 0) == 0) {
        language_.Hover(std::stoul(key.substr(5)), nowMs);
        return true;
    }
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (!Focusable(rows_[i]) || rows_[i].key != key) continue;
        if (focus_ == std::optional<std::size_t>(i)) return false;
        focus_ = i;
        if (withCamera) EnsureVisible(rows_[i], nowMs);
        return true;
    }
    return false;
}

std::optional<std::string> SettingsScreen::ItemAt(double x, double y) const {
    if (language_.IsOpen()) {
        // While the list is open it is the only thing to pick; a click anywhere else closes it.
        if (const std::optional<std::size_t> row = language_.RowAt(x, y)) return "lang:" + std::to_string(*row);
        if (language_.Contains(x, y)) return std::nullopt;
        return std::string("lang-dismiss");
    }
    for (const Row& row : rows_) {
        if (!Focusable(row)) continue;
        const Box box = ScreenBox(row);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) return row.key;
    }
    return std::nullopt;
}

std::optional<Command> SettingsScreen::ActivateItem(const std::string& key, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (key == "lang-dismiss") {
        language_.Close(nowMs);
        return std::nullopt;
    }
    if (key.rfind("lang:", 0) == 0) {
        PickLanguage(std::stoul(key.substr(5)), nowMs);
        return std::nullopt;
    }
    if (!FocusItem(key, nowMs, true) && FocusedKey() != std::optional<std::string>(key)) return std::nullopt;
    return Select(nowMs);
}

std::optional<ScrollSurface> SettingsScreen::SurfaceAt(double x, double y, nav::Axis axis) const {
    if (axis != nav::Axis::Y) return std::nullopt;
    if (x < 0.0 || x >= width_ || y < 0.0 || y >= height_) return std::nullopt;
    ScrollSurface surface;
    surface.kind = ScrollSurface::Kind::Page;
    surface.scroll = pageScroll_;
    surface.target = camera_.active() ? camera_.target() : pageScroll_;
    surface.maxScroll = MaxPageScroll();
    surface.viewport = height_;
    surface.canPan = MaxPageScroll() > 0.0;
    return surface;
}

void SettingsScreen::SetScroll(const ScrollSurface& surface, double value, double /*nowMs*/) {
    if (surface.kind != ScrollSurface::Kind::Page) return;
    camera_.Cancel();
    pageScroll_ = std::clamp(value, 0.0, MaxPageScroll());
}

void SettingsScreen::AnimateScroll(const ScrollSurface& surface, double target, double /*nowMs*/) {
    if (surface.kind != ScrollSurface::Kind::Page) return;
    const motion::CameraStart start =
        camera_.Begin(pageScroll_, target, MaxPageScroll(), motion::PrefersReducedMotion(motion_));
    if (start == motion::CameraStart::Landed) pageScroll_ = camera_.position();
}

void SettingsScreen::Paint(Painter& painter) const {
    painter.Clear(tokens::kBackground);
    // A plain page: no picture behind it. The glass is told there is no backdrop, so nothing faint shows through.
    painter.SetBackdrop(Box{0.0, 0.0, 0.0, 0.0}, "", 0.5, 0.2);

    const double left = rows_.empty() ? metrics_.Rem(kSafeXRem) : rows_.front().left;
    const double textWidth = width_ - left - metrics_.Rem(kSafeXRem);
    const double headerY = metrics_.Rem(kSafeYRem) - pageScroll_;
    if (headerY + metrics_.Rem(kHeaderRem) > 0.0) {
        painter.Text(Box{left, headerY, textWidth, metrics_.Rem(1.1)}, "Device and services",
                     TextStyle{metrics_.Rem(0.875), true, 600}, tokens::kTextFaint);
        // 48px Bold Screen Title at 1080p (3.0rem).
        painter.Text(Box{left, headerY + metrics_.Rem(1.1), textWidth, metrics_.Rem(3.5)}, "Settings",
                     TextStyle{metrics_.Rem(3.0), true, 700}, tokens::kText);
        painter.Text(Box{left, headerY + metrics_.Rem(4.7), textWidth, metrics_.Rem(1.5)},
                     "Picture, appearance, account and this device", TextStyle{metrics_.Rem(1.05), false, 450},
                     tokens::kTextMuted);
    }

    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& row = rows_[i];
        const Box box = ScreenBox(row);
        // Rows off the page are not drawn.
        if (box.Bottom() < -20.0 || box.y > height_ + 20.0) continue;
        if (row.kind == RowKind::Group) {
            std::string title = row.label;
            for (char& c : title) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
            painter.Text(Box{box.x + metrics_.Rem(1.1), box.y, box.width, box.height}, title,
                         TextStyle{metrics_.Rem(kGroupTitleRem) * 0.82, true, 750}, tokens::kTextFaint);
            continue;
        }
        PaintRow(painter, row, !focusHidden_ && focus_ == std::optional<std::size_t>(i));
    }
    language_.Paint(painter, clockMs_);
}

void SettingsScreen::PaintRow(Painter& painter, const Row& row, bool focused) const {
    const Box box = ScreenBox(row);
    const double radius = metrics_.Rem(kRowRadiusRem);
    // The nav pill's glass: the resting capsule material for every row, and its hover plate softly under the
    // focused one. No outer rings, no metallic rim.
    painter.Glass(box, radius, glass::NavCapsule());
    if (focused) {
        painter.FillRoundRect(box, radius, WithAlpha(tokens::kText, 0.06));
        GlassStyle hover = glass::NavHover(0.32);
        painter.Glass(box, radius, hover);
    }

    const bool danger = row.key == "factory-reset" || row.key == "clear-cache";
    const Color labelColor = danger ? kDanger : (focused ? tokens::kText : Mix(tokens::kTextMuted, tokens::kText, 0.75));
    const Color muted = tokens::kTextMuted;
    const bool toggle = row.kind != RowKind::Push && row.kind != RowKind::Info;
    const auto [value, words] = toggle ? SplitDetail(row.detail) : std::pair<std::string, std::string>{"", row.detail};

    // At the right: a switch, a value (with a chevron for a list), or the way in.
    double right = box.Right() - metrics_.Rem(1.1);
    if (row.kind == RowKind::Push) {
        const double chev = metrics_.Rem(0.85);
        painter.Path(Box{right - chev, box.CenterY() - chev / 2.0, chev, chev}, 32.0, "m12 7 9 9-9 9",
                     PathStyle{Color{0, 0, 0, 0}, focused ? tokens::kText : muted, 2.8, false});
        right -= chev + metrics_.Rem(0.7);
        if (!words.empty()) {
            // The row's short description reads as its value, quietly, before the chevron.
            const TextStyle style{metrics_.Rem(0.88), false, 450};
            const double width = std::min(painter.MeasureText(words, style), box.width * 0.45);
            painter.Text(Box{right - width, box.y, width + 2.0, box.height}, words, style, tokens::kTextFaint);
            right -= width + metrics_.Rem(0.8);
        }
    } else if (toggle && (value == "On" || value == "Off")) {
        const bool on = value == "On";
        const double trackWidth = metrics_.Rem(2.6);
        const double trackHeight = metrics_.Rem(1.5);
        const Box track{right - trackWidth, box.CenterY() - trackHeight / 2.0, trackWidth, trackHeight};
        painter.FillRoundRect(track, trackHeight / 2.0, on ? tokens::kAccentStrong : WithAlpha(tokens::kText, 0.18));
        const double knob = trackHeight - metrics_.Rem(0.3);
        const double knobX = on ? track.Right() - metrics_.Rem(0.15) - knob : track.x + metrics_.Rem(0.15);
        painter.FillRoundRect(Box{knobX, track.CenterY() - knob / 2.0, knob, knob}, knob / 2.0, Rgb(0xFFFFFF));
        right = track.x - metrics_.Rem(0.8);
    } else if (toggle && !value.empty()) {
        const bool list = row.kind == RowKind::Language;
        if (list) {
            // App language opens a list: a small chevron after its value.
            const double chev = metrics_.Rem(0.8);
            painter.Path(Box{right - chev, box.CenterY() - chev / 2.0, chev, chev}, 24.0, "M6 9l6 6 6-6",
                         PathStyle{Color{0, 0, 0, 0}, focused ? tokens::kText : muted, 2.4, false});
            right -= chev + metrics_.Rem(0.5);
        }
        const TextStyle style{metrics_.Rem(0.95), true, 600};
        const double width = painter.MeasureText(value, style);
        painter.Text(Box{right - width, box.y, width + 2.0, box.height}, value, style,
                     focused ? tokens::kText : tokens::kTextMuted);
        right -= width + metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Info && !row.detail.empty()) {
        const TextStyle style{metrics_.Rem(0.95), true, 600};
        const double width = std::min(painter.MeasureText(row.detail, style), box.width * 0.52);
        painter.Text(Box{right - width, box.y, width + 2.0, box.height}, row.detail, style, tokens::kAccentStrong);
        right -= width + metrics_.Rem(0.8);
    }

    // The name, with a short second line for the switches and choices that explain themselves.
    const double textX = box.x + metrics_.Rem(1.2);
    const double textWidth = std::max(0.0, right - textX);
    const TextStyle labelStyle{metrics_.Rem(1.0), true, focused ? 620 : 540};
    if (words.empty() || row.kind == RowKind::Push || row.kind == RowKind::Info) {
        painter.Text(Box{textX, box.y, textWidth, box.height}, row.label, labelStyle, labelColor);
        return;
    }
    painter.Text(Box{textX, box.y + box.height * 0.12, textWidth, box.height * 0.44}, row.label, labelStyle, labelColor);
    painter.Text(Box{textX, box.y + box.height * 0.52, textWidth, box.height * 0.34}, words,
                 TextStyle{metrics_.Rem(0.8), false, 450}, tokens::kTextFaint);
}

}  // namespace tvm::ui
