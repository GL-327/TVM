#include "ui/settings_screen.h"

#include <algorithm>
#include <cmath>
#include <array>
#include <utility>

#include "motion/camera.h"
#include "nav/wrap.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;

constexpr double kRowWidthRem = 64.0;
constexpr double kRowHeightRem = 3.25;
constexpr double kRowGapRem = 0.5;
constexpr double kGroupGapRem = 1.5;
constexpr double kGroupTitleRem = 1.25;
constexpr double kEnsureVisiblePadRem = 4.0;

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

    group("Account");
    push("account", "Your account", "Sign in, email verification and access", Open("account"));
    push("privacy", "Privacy & terms", "Terms, data export and deletion", Open("legal"));
    push("plan", "Plan", "Access and pricing", Open("plans"));
    push("profiles", "Profiles", "TVM Stream only", Open("profiles"));
    push("realdebrid", "Real-Debrid", "Your token", Open("realdebrid"));

    group("Device");
    push("network", "Network", "Connected or offline", Open("system-info", {{"section", "network"}}));
    push("display", "Display", "Panel, window and stream cap", Open("system-info", {{"section", "display"}}));
    push("livetv", "Live TV login", "Server, username and password", Open("live-xtream"));
    push("live-playlist", "Live TV playlist", "M3U / M3U8", Open("live-playlist"));
    push("updates", "Updates", "GLogic Studios", Open("updates"));
    row(RowKind::AutoUpdate, "auto-update", "Check for updates on launch");
    push("changelog", "What's new", "The latest changes on GitHub", Open("changelog", {}, true));
    push("diagnostics", "Diagnostics", "", Open("diagnostics", {}, true));
    push("developer", "Developer", "Accounts, email and channel check", Open("developer"));

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

    RefreshDetails();

    // Focus starts on the first row that can take it.
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (Focusable(rows_[i])) {
            focus_ = i;
            break;
        }
    }
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
        return store_.Glass() == GlassClarity::Frosted ? "Frosted \xC2\xB7 softer, easier to read over busy pictures"
                                                       : "Clear \xC2\xB7 see the picture through the glass";
    case RowKind::Language:
        return LanguageName(core_.language);
    case RowKind::AutoUpdate:
        return core_.autoUpdate ? "On · check when this app opens" : "Off · check from Updates";
    case RowKind::Push:
    case RowKind::Info:
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
    // The header sits above the list. Positions are in page coordinates.
    // The header takes the kicker, the title and a gap before the first group.
    double y = metrics_.Rem(kSafeYRem) + metrics_.Rem(6.0);
    bool first = true;
    for (Row& row : rows_) {
        if (row.kind == RowKind::Group) {
            if (!first) y += metrics_.Rem(kGroupGapRem);
            row.top = y;
            row.height = metrics_.Rem(kGroupTitleRem) * 1.4;
            y += row.height + metrics_.Rem(0.5);
        } else {
            row.top = y;
            row.height = CompactViewport(width_, height_) ? std::max(64.0, metrics_.Rem(kRowHeightRem)) : metrics_.Rem(kRowHeightRem);
            y += row.height + metrics_.Rem(kRowGapRem);
        }
        first = false;
    }
    contentBottom_ = y - metrics_.Rem(kRowGapRem);
}

double SettingsScreen::MaxPageScroll() const {
    return std::max(0.0, contentBottom_ + metrics_.Rem(kSafeYRem) - height_);
}

Box SettingsScreen::ScreenBox(const Row& row) const {
    const double rowWidth = std::min(width_ - 2.0 * metrics_.Rem(kSafeXRem), metrics_.Rem(kRowWidthRem));
    return Box{metrics_.Rem(kSafeXRem), row.top - pageScroll_, rowWidth, row.height};
}

std::optional<std::size_t> SettingsScreen::FocusedIndex() const {
    return focus_;
}

bool SettingsScreen::Tick(double nowMs) {
    const bool reduced = motion::PrefersReducedMotion(motion_);
    if (!camera_.active()) return false;
    const motion::CameraStep step = camera_.Step(nowMs, reduced);
    pageScroll_ = step.position;
    return true;
}

bool SettingsScreen::Animating() const {
    return camera_.active();
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
    if (direction != nav::Direction::Up && direction != nav::Direction::Down) return false;
    if (!focus_.has_value()) return false;

    // The nearest focusable row in that direction. Groups and info rows are skipped.
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

std::optional<Command> SettingsScreen::Select(double /*nowMs*/) {
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

    case RowKind::Language:
        core_.language = NextLanguage(core_.language);
        store_.SaveCorePrefs(prefs::CorePrefsPatch{core_.language, std::nullopt});
        RefreshDetails();
        return std::nullopt;

    case RowKind::Theme:
        store_.SaveLook(store_.Look() == Theme::Dark ? Theme::Light : Theme::Dark);
        RefreshDetails();
        return std::nullopt;

    case RowKind::Glass:
        store_.SaveGlass(store_.Glass() == GlassClarity::Clear ? GlassClarity::Frosted : GlassClarity::Clear);
        RefreshDetails();
        return std::nullopt;

    case RowKind::AutoUpdate:
        core_.autoUpdate = !core_.autoUpdate;
        store_.SaveCorePrefs(prefs::CorePrefsPatch{std::nullopt, core_.autoUpdate});
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

bool SettingsScreen::FocusItem(const std::string& key, double nowMs, bool withCamera) {
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
    for (const Row& row : rows_) {
        if (!Focusable(row)) continue;
        const Box box = ScreenBox(row);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) return row.key;
    }
    return std::nullopt;
}

std::optional<Command> SettingsScreen::ActivateItem(const std::string& key, double nowMs) {
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

    const Box viewport{0.0, 0.0, width_, height_};
    painter.SetBackdrop(viewport, "asset:lighthouse.jpg", 0.5, 0.2);
    const bool isLight = (tokens::kBackground.r + tokens::kBackground.g + tokens::kBackground.b) > 1.5;
    if (!isLight && !tokens::reduceTransparency) {
        painter.ImageFaded(viewport, "asset:lighthouse.jpg", 0.0, 0.14, 0.5, 0.2);
        painter.FillLinearGradient(viewport, 0.0, 0.0, 0.0, height_,
                                   {GradientStop{0.0, Rgb(0x071018, 0.86)},
                                    GradientStop{0.5, Rgb(0x071018, 0.91)},
                                    GradientStop{1.0, Rgb(0x071018, 0.95)}});
    }

    const double x = metrics_.Rem(kSafeXRem);
    const double headerY = metrics_.Rem(kSafeYRem) - pageScroll_;
    painter.Text(Box{x, headerY, width_ - 2.0 * x, metrics_.Rem(1.1)}, "Device and services",
                 TextStyle{metrics_.Rem(0.875), true, 600}, tokens::kTextFaint);
    // 48px Bold Screen Title at 1080p (3.0rem).
    painter.Text(Box{x, headerY + metrics_.Rem(1.1), width_ - 2.0 * x, metrics_.Rem(3.5)}, "Settings",
                 TextStyle{metrics_.Rem(3.0), true, 700}, tokens::kText);

    const double ringWidth = metrics_.Rem(kFocusRingWidthRem);
    const double radius = metrics_.Rem(0.875);
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& row = rows_[i];
        if (row.kind == RowKind::Group) {
            const double groupY = row.top - pageScroll_;
            if (groupY + row.height < 0.0 || groupY > height_) continue;
            painter.Text(Box{x, groupY, width_ - 2.0 * x, row.height}, row.label,
                         TextStyle{metrics_.Rem(kGroupTitleRem), true, 650}, tokens::kTextMuted);
            continue;
        }

        const Box box = ScreenBox(row);
        if (box.Bottom() < -20.0 || box.y > height_ + 20.0) continue;
        const bool focused = !focusHidden_ && focus_ == std::optional<std::size_t>(i);
        const double lift = (focused && !tokens::reduceMotion) ? metrics_.Rem(0.15) : 0.0;
        const Box drawnBox{box.x, box.y - lift, box.width, box.height};

        GlassStyle rowGlass;
        rowGlass.kind = GlassKind::Panel;
        rowGlass.focused = focused;
        rowGlass.focusAmount = focused ? 1.0 : 0.0;
        rowGlass.reduceTransparency = tokens::reduceTransparency;
        rowGlass.tint = focused ? tokens::kSurfaceHover : tokens::kSurface;
        rowGlass.ringWidth = ringWidth;
        rowGlass.ringOutset = metrics_.Rem(kFocusRingOffsetRem) + ringWidth / 2.0;
        rowGlass.ringColor = tokens::kFocusRing;
        painter.Glass(drawnBox, radius, rowGlass);

        // High-contrast label and value colours so every setting reads clearly over the dark glass rows.
        const Color labelColor = focused ? tokens::kText : Mix(tokens::kTextMuted, tokens::kText, 0.55);
        const Color detailColor = focused ? tokens::kText : tokens::kTextMuted;
        if (CompactViewport(width_, height_)) {
            const double inset = metrics_.Rem(1.1);
            painter.Text(Box{drawnBox.x + inset, drawnBox.y, drawnBox.width - 2.0 * inset, drawnBox.height * 0.5},
                         row.label, TextStyle{metrics_.Rem(1.125), focused, focused ? 600 : 450}, labelColor);
            painter.Text(Box{drawnBox.x + inset, drawnBox.y + drawnBox.height * 0.5,
                             drawnBox.width - 2.0 * inset, drawnBox.height * 0.5},
                         row.detail, TextStyle{metrics_.Rem(0.95), false}, detailColor);
            continue;
        }
        const double labelWidth = drawnBox.width * 0.52;
        painter.Text(Box{drawnBox.x + metrics_.Rem(1.25), drawnBox.y, labelWidth, drawnBox.height}, row.label,
                     TextStyle{metrics_.Rem(1.1875), focused, focused ? 600 : 450}, labelColor);
        painter.Text(Box{drawnBox.x + labelWidth, drawnBox.y,
                         drawnBox.width - labelWidth - metrics_.Rem(2.5), drawnBox.height},
                     row.detail, TextStyle{metrics_.Rem(1.0), false}, detailColor);
        if (row.kind == RowKind::Push) {
            const double chev = metrics_.Rem(0.95);
            painter.Path(Box{drawnBox.Right() - metrics_.Rem(1.8), drawnBox.CenterY() - chev / 2.0, chev, chev}, 32.0,
                         "m12 7 9 9-9 9", PathStyle{Color{0, 0, 0, 0}, detailColor, 2.6, false});
        }
    }
}

}  // namespace tvm::ui
