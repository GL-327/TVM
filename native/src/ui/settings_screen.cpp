#include "ui/settings_screen.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <utility>

#include "motion/camera.h"
#include "nav/wrap.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;

// Each setting is its own floating row, with an icon, its name over a short description, and its value or a
// chevron at the right. Sections flow into two columns on a wide window.
constexpr double kRowWidthRem = 60.0;
constexpr double kTwoColumnWidthRem = 116.0;
constexpr double kColumnGapRem = 2.5;
constexpr double kTwoColumnMinPx = 1600.0;
constexpr double kRowHeightRem = 4.0;
constexpr double kRowGapRem = 0.6;
constexpr double kGroupGapRem = 1.75;
constexpr double kGroupTitleRem = 0.95;
constexpr double kHeaderRem = 8.0;
constexpr double kEnsureVisiblePadRem = 4.0;
constexpr Color kDanger = Rgb(0xFF5A52);

Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}

// A 24-unit line icon for each row.
const char* IconFor(const std::string& key) {
    if (key == "motion") return "M3 12h4l2.5-6 5 12 2.5-6h4";
    if (key == "performance") return "M13 3 5 13.5h6L10 21l8-10.5h-6z";
    if (key == "themes") return "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z";
    if (key == "glass") return "M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z";
    if (key == "language") {
        return "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.4 2.6 3.5 5.6 3.5 9s-1.1 6.4-3.5 9"
               "M12 3c-2.4 2.6-3.5 5.6-3.5 9s1.1 6.4 3.5 9";
    }
    if (key == "account") return "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5";
    if (key == "privacy") return "M12 3 5 6v5.5c0 4.4 2.9 7.8 7 9.5 4.1-1.7 7-5.1 7-9.5V6z";
    if (key == "plan") return "M3.5 7.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 10.5h17";
    if (key == "profiles" || key == "choose-profile") {
        return "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.3 3.1-5.3 6.5-5.3s6 2 6.5 5.3"
               "M15.5 4.3a3.5 3.5 0 0 1 0 6.4M18 14.9c1.9.7 3.2 2.4 3.5 5.1";
    }
    if (key == "realdebrid") return "M8 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h9M18 12v3M21 12v2";
    if (key == "network") return "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01";
    if (key == "display") return "M3.5 5h17v11h-17zM8 20h8M12 16v4";
    if (key == "livetv") return "M3.5 8h17v12h-17zM8 3.5l4 4.5 4-4.5";
    if (key == "live-playlist") return "M4 6.5h16M4 12h16M4 17.5h10";
    if (key == "updates") return "M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5";
    if (key == "auto-update") return "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2";
    if (key == "changelog") return "M12 3.5l2 5 5 2-5 2-2 5-2-5-5-2 5-2z";
    if (key == "diagnostics") return "M3 12h4l2-5 4 10 2-5h6";
    if (key == "developer") return "M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5";
    if (key == "clear-cache") return "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
    if (key == "factory-reset") return "M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5";
    if (key == "restart") return "M12 3v8M6.5 6.5a8 8 0 1 0 11 0";
    return "M12 12h.01";
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
    push("profiles", "Profiles", "Switch, add, rename or remove", Open("chooser"));
    row(RowKind::ChooseProfile, "choose-profile", "Choose profile on launch");
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
    case RowKind::ChooseProfile:
        return store_.ChooseProfileOnLaunch() ? "On \xC2\xB7 ask who's watching when TVM opens"
                                              : "Off \xC2\xB7 open the last profile";
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

bool SettingsScreen::TwoColumns() const {
    return width_ >= kTwoColumnMinPx && !CompactViewport(width_, height_);
}

void SettingsScreen::Arrange() {
    // The content is centred: one column of rows, or two on a wide window. Positions are in page coordinates.
    const bool two = TwoColumns();
    const double safe = metrics_.Rem(kSafeXRem);
    const double content = std::min(width_ - 2.0 * safe, metrics_.Rem(two ? kTwoColumnWidthRem : kRowWidthRem));
    const double left = std::max(safe, (width_ - content) / 2.0);
    const double gap = metrics_.Rem(kColumnGapRem);
    const double columnWidth = two ? (content - gap) / 2.0 : content;
    const double rowHeight = CompactViewport(width_, height_) ? std::max(64.0, metrics_.Rem(kRowHeightRem))
                                                              : metrics_.Rem(kRowHeightRem);
    const double titleHeight = metrics_.Rem(kGroupTitleRem) * 1.6;

    // Each section's height, so the sections can be shared between the columns in their order: the first column
    // takes sections until it holds about half.
    std::vector<std::size_t> starts;
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (rows_[i].kind == RowKind::Group) starts.push_back(i);
    }
    std::vector<double> heights;
    double total = 0.0;
    for (std::size_t g = 0; g < starts.size(); ++g) {
        const std::size_t end = g + 1 < starts.size() ? starts[g + 1] : rows_.size();
        const double count = static_cast<double>(end - starts[g] - 1);
        const double height = titleHeight + metrics_.Rem(0.5) + count * rowHeight + std::max(0.0, count - 1.0) * metrics_.Rem(kRowGapRem);
        heights.push_back(height);
        total += height;
    }
    std::size_t split = starts.size();
    if (two) {
        double running = 0.0;
        for (std::size_t g = 0; g < heights.size(); ++g) {
            // A section goes to the second column once the first already holds half, or would overshoot by more.
            if (running >= total / 2.0 || running + heights[g] / 2.0 > total / 2.0) {
                split = std::max<std::size_t>(g, 1);
                break;
            }
            running += heights[g];
        }
    }

    const double top = metrics_.Rem(kSafeYRem) + metrics_.Rem(kHeaderRem);
    double y[2] = {top, top};
    bool firstInColumn[2] = {true, true};
    contentBottom_ = top;
    std::size_t group = 0;
    int column = 0;
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        Row& row = rows_[i];
        if (row.kind == RowKind::Group) {
            column = two && group >= split ? 1 : 0;
            ++group;
            if (!firstInColumn[column]) y[column] += metrics_.Rem(kGroupGapRem);
            firstInColumn[column] = false;
            row.top = y[column];
            row.height = titleHeight;
            y[column] += row.height + metrics_.Rem(0.5);
        } else {
            row.top = y[column];
            row.height = rowHeight;
            y[column] += row.height + metrics_.Rem(kRowGapRem);
        }
        row.column = column;
        row.left = left + (column == 1 ? columnWidth + gap : 0.0);
        row.width = columnWidth;
        contentBottom_ = std::max(contentBottom_, row.top + row.height);
    }
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
    if (!focus_.has_value()) return false;
    const Row& current = rows_[*focus_];
    std::optional<std::size_t> next;
    if (direction == nav::Direction::Up || direction == nav::Direction::Down) {
        // The nearest focusable row above or below in the same column. Headings and info rows are skipped.
        if (direction == nav::Direction::Down) {
            for (std::size_t i = *focus_ + 1; i < rows_.size() && !next.has_value(); ++i) {
                if (Focusable(rows_[i]) && rows_[i].column == current.column) next = i;
            }
        } else {
            for (std::size_t i = *focus_; i > 0 && !next.has_value(); --i) {
                if (Focusable(rows_[i - 1]) && rows_[i - 1].column == current.column) next = i - 1;
            }
        }
    } else if (TwoColumns()) {
        // Left and right cross to the row level with this one in the other column.
        const int other = direction == nav::Direction::Right ? 1 : 0;
        if (current.column == other) return false;
        const double middle = current.top + current.height / 2.0;
        double best = 0.0;
        for (std::size_t i = 0; i < rows_.size(); ++i) {
            if (!Focusable(rows_[i]) || rows_[i].column != other) continue;
            const double distance = std::abs(rows_[i].top + rows_[i].height / 2.0 - middle);
            if (!next.has_value() || distance < best) {
                next = i;
                best = distance;
            }
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
            painter.Text(Box{box.x + metrics_.Rem(1.2), box.y, box.width, box.height}, title,
                         TextStyle{metrics_.Rem(kGroupTitleRem) * 0.82, true, 750}, tokens::kTextFaint);
            continue;
        }
        PaintRow(painter, row, !focusHidden_ && focus_ == std::optional<std::size_t>(i));
    }
}

void SettingsScreen::PaintRow(Painter& painter, const Row& row, bool focused) const {
    const Box box = ScreenBox(row);
    const double lift = (focused && !tokens::reduceMotion) ? metrics_.Rem(0.12) : 0.0;
    const Box drawn{box.x, box.y - lift, box.width, box.height};
    const double ringWidth = metrics_.Rem(kFocusRingWidthRem);

    // Its own floating glass row, rounded as a pill.
    GlassStyle rowGlass;
    rowGlass.kind = GlassKind::Panel;
    rowGlass.focused = focused;
    rowGlass.focusAmount = focused ? 1.0 : 0.0;
    rowGlass.reduceTransparency = tokens::reduceTransparency;
    rowGlass.tint = focused ? tokens::kSurfaceHover : tokens::kSurface;
    rowGlass.ringWidth = ringWidth;
    rowGlass.ringOutset = metrics_.Rem(kFocusRingOffsetRem) + ringWidth / 2.0;
    rowGlass.ringColor = tokens::kFocusRing;
    painter.Glass(drawn, drawn.height / 2.0, rowGlass);

    // The icon on a tinted disc; the reset and cache rows read red.
    const bool danger = row.key == "factory-reset" || row.key == "clear-cache";
    const Color accent = danger ? kDanger : tokens::kAccentStrong;
    const double disc = metrics_.Rem(2.4);
    const Box discBox{drawn.x + metrics_.Rem(0.8), drawn.CenterY() - disc / 2.0, disc, disc};
    painter.FillRoundRect(discBox, disc / 2.0, WithAlpha(accent, focused ? 0.24 : 0.16));
    const double icon = metrics_.Rem(1.3);
    painter.Path(Box{discBox.CenterX() - icon / 2.0, discBox.CenterY() - icon / 2.0, icon, icon}, 24.0, IconFor(row.key),
                 PathStyle{Color{0, 0, 0, 0}, accent, 2.0, false});

    // The value or the way in, at the right.
    const bool toggle = row.kind != RowKind::Push && row.kind != RowKind::Info;
    const auto [value, words] = toggle ? SplitDetail(row.detail) : std::pair<std::string, std::string>{"", row.detail};
    double right = drawn.Right() - metrics_.Rem(1.3);
    const Color muted = tokens::kTextMuted;
    if (row.kind == RowKind::Push) {
        const double chev = metrics_.Rem(0.95);
        painter.Path(Box{right - chev, drawn.CenterY() - chev / 2.0, chev, chev}, 32.0, "m12 7 9 9-9 9",
                     PathStyle{Color{0, 0, 0, 0}, focused ? tokens::kText : muted, 2.8, false});
        right -= chev + metrics_.Rem(0.6);
    } else if (toggle && (value == "On" || value == "Off")) {
        // A switch for the rows that are on or off.
        const bool on = value == "On";
        const double trackWidth = metrics_.Rem(2.75);
        const double trackHeight = metrics_.Rem(1.6);
        const Box track{right - trackWidth, drawn.CenterY() - trackHeight / 2.0, trackWidth, trackHeight};
        painter.FillRoundRect(track, trackHeight / 2.0, on ? tokens::kAccentStrong : WithAlpha(tokens::kText, 0.18));
        const double knob = trackHeight - metrics_.Rem(0.3);
        const double knobX = on ? track.Right() - metrics_.Rem(0.15) - knob : track.x + metrics_.Rem(0.15);
        painter.FillRoundRect(Box{knobX, track.CenterY() - knob / 2.0, knob, knob}, knob / 2.0, Rgb(0xFFFFFF));
        right = track.x - metrics_.Rem(0.8);
    } else if (toggle && !value.empty()) {
        // A value chip for the rows that cycle: Theme, Liquid Glass, Motion, App language.
        const TextStyle chipStyle{metrics_.Rem(0.88), true, 650};
        const double chipWidth = painter.MeasureText(value, chipStyle) + metrics_.Rem(1.6);
        const double chipHeight = metrics_.Rem(1.9);
        const Box chip{right - chipWidth, drawn.CenterY() - chipHeight / 2.0, chipWidth, chipHeight};
        painter.FillRoundRect(chip, chipHeight / 2.0, WithAlpha(tokens::kText, focused ? 0.16 : 0.10));
        painter.Text(Box{chip.x + metrics_.Rem(0.8), chip.y, chipWidth, chip.height}, value, chipStyle, tokens::kText);
        right = chip.x - metrics_.Rem(0.8);
    }

    // The name over a short description.
    const double textX = discBox.Right() + metrics_.Rem(0.9);
    const double textWidth = std::max(0.0, right - textX);
    const Color labelColor = focused ? tokens::kText : Mix(tokens::kTextMuted, tokens::kText, 0.7);
    if (words.empty()) {
        painter.Text(Box{textX, drawn.y, textWidth, drawn.height}, row.label,
                     TextStyle{metrics_.Rem(1.05), true, focused ? 650 : 550}, labelColor);
        return;
    }
    painter.Text(Box{textX, drawn.y + drawn.height * 0.16, textWidth, drawn.height * 0.4}, row.label,
                 TextStyle{metrics_.Rem(1.05), true, focused ? 650 : 550}, labelColor);
    painter.Text(Box{textX, drawn.y + drawn.height * 0.52, textWidth, drawn.height * 0.32}, words,
                 TextStyle{metrics_.Rem(0.85), false, 450}, muted);
}

}  // namespace tvm::ui
