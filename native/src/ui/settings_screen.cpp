#include "ui/settings_screen.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <utility>

#include "motion/camera.h"
#include "nav/wrap.h"
#include "ui/controls.h"
#include "ui/glass_styles.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;

// One column of slim rows at a comfortable desktop width: the name at the left (with a short second line only for
// the switches and choices that have one), and the value, switch or chevron at the right. Section headings stay.
constexpr double kRowWidthRem = 52.0;
constexpr double kRowHeightRem = 3.2;
constexpr double kTallRowHeightRem = 3.9;
constexpr double kRowGapRem = 0.45;
constexpr double kGroupGapRem = 1.6;
constexpr double kGroupTitleRem = 0.95;
constexpr double kHeaderRem = 8.0;
constexpr double kEnsureVisiblePadRem = 4.0;
constexpr double kRowRadiusRem = 0.75;
constexpr double kCardRadiusRem = 1.0;
constexpr double kCatRowHeightRem = 2.7;
constexpr double kCatRowStepRem = 3.0;
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


struct CategoryDef {
    const char* id;
    const char* title;
    const char* description;
};

// The left pane, in order. A category with no rows (Home screen has none yet) is left out of the list.
constexpr std::array<CategoryDef, 12> kCategories = {{
    {"account", "Account", "Sign in, your plan and your services."},
    {"profiles", "Profiles", "Who watches, and how TVM opens."},
    {"playback", "Playback", "Skipping, autoplay and your watch history."},
    {"audio", "Audio & subtitles", "Languages for sound and subtitles."},
    {"appearance", "Appearance", "Theme, font, motion and the app's language."},
    {"home", "Home screen", "What the Home screen shows."},
    {"livetv", "Live TV", "Your Live TV server and playlist."},
    {"realdebrid", "Real-Debrid", "The token TVM uses to find streams."},
    {"downloads", "Downloads", "Titles saved on this device."},
    {"updates", "Updates", "Keep TVM current and read what is new."},
    {"about", "About", "This device, diagnostics and maintenance."},
    {"developer", "Developer", "Tools for admin accounts."},
}};

enum Cat {
    kAccount,
    kProfiles,
    kPlayback,
    kAudio,
    kAppearance,
    kHome,
    kLiveTv,
    kRealDebrid,
    kDownloads,
    kUpdates,
    kAbout,
    kDeveloper
};

}  // namespace

SettingsScreen::SettingsScreen(PreferenceStore& store, motion::MotionSettings motion)
    : store_(store), core_(store.CorePrefs()) {
    motion_ = motion;
    BuildRows();
}

void SettingsScreen::BuildRows() {
    rows_.clear();
    int cat = kAccount;
    auto group = [this, &cat](std::string title) {
        rows_.push_back(Row{RowKind::Group, "", std::move(title), "", {}, 0.0, 0.0, 0, 0.0, 0.0, cat});
    };
    auto row = [this, &cat](RowKind kind, std::string key, std::string label, std::string detail = "", Command command = {}) {
        rows_.push_back(
            Row{kind, std::move(key), std::move(label), std::move(detail), std::move(command), 0.0, 0.0, 0, 0.0, 0.0, cat});
    };
    auto push = [&row](std::string key, std::string label, std::string detail, Command command) {
        row(RowKind::Push, std::move(key), std::move(label), std::move(detail), std::move(command));
    };

    cat = kAccount;
    group("Sign in and access");
    push("account", "Your account", "Sign in, email verification and access", Open("account"));
    push("privacy", "Privacy & terms", "Terms, data export and deletion", Open("legal"));
    push("plan", "Plan", "Access and pricing", Open("plans"));
    group("Services");
    push("services", "Streaming services", "Sign in to your services", Open("services"));

    cat = kProfiles;
    group("Profiles");
    push("profiles", "Profiles", "Switch, add, rename or remove", Open("chooser"));
    row(RowKind::ChooseProfile, "choose-profile", "Choose profile on launch");

    cat = kPlayback;
    group("Playback");
    push("extras-settings", "TVM Extras", "Skipping, autoplay and subtitle languages", Open("extras-settings"));
    push("stats", "Your stats", "Watch time and history", Open("stats"));

    cat = kAudio;
    group("Languages");
    push("audio-subtitles", "Audio and subtitle languages", "Preferred languages and subtitle behaviour",
         Open("extras-settings"));

    cat = kAppearance;
    group("Picture");
    row(RowKind::Performance, "performance", "Performance mode");
    group("Look");
    row(RowKind::Theme, "themes", "Theme");
    row(RowKind::Glass, "font", "Font");
    row(RowKind::Glass, "reduce-transparency", "Reduce transparency");
    row(RowKind::Motion, "motion", "Reduce motion");
    group("Language");
    row(RowKind::Language, "language", "App language");

    cat = kLiveTv;
    group("Live TV");
    push("livetv", "Live TV login", "Server, username and password", Open("live-xtream"));
    push("live-playlist", "Live TV playlist", "M3U / M3U8", Open("live-playlist"));

    cat = kRealDebrid;
    group("Real-Debrid");
    push("realdebrid", "Real-Debrid", "Your token", Open("realdebrid"));

    cat = kDownloads;
    group("Downloads");
    push("downloads", "Downloads", "Saved titles and their progress", Open("downloads"));

    cat = kUpdates;
    group("Updates");
    push("updates", "Updates", "GLogic Studios", Open("updates"));
    row(RowKind::AutoUpdate, "auto-update", "Check for updates on launch");
    push("changelog", "What's new", "Release notes for TVM", Open("changelog", {}, true));

    cat = kAbout;
    group("This device");
    push("network", "Network", "Connected or offline", Open("system-info", {{"section", "network"}}));
    push("display", "Display", "Panel, window and stream cap", Open("system-info", {{"section", "display"}}));
    push("diagnostics", "Diagnostics", "", Open("diagnostics", {}, true));
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
        cat = kDeveloper;
        group("Accounts");
        push("accounts", "Accounts", "Manage member access", Open("accounts"));
        group("Developer Diagnostics");
        row(RowKind::Info, "dev-build", "Build info", diag_.buildVersion);
        row(RowKind::Info, "dev-rd-source", "RD token source", diag_.rdTokenSource);
        row(RowKind::Info, "dev-glass", "Glass mode");
        push("dev-refresh-cache", "Quick cache refresh", "Reload catalog and artwork",
             Command{false, "dev-refresh-cache", {}, true});
    }

    RefreshDetails();
    const std::vector<int> present = PresentCategories();
    if (std::find(present.begin(), present.end(), category_) == present.end()) category_ = kAccount;
    categoryFocus_ = category_;
    focus_ = FirstFocusable();
}

std::vector<int> SettingsScreen::PresentCategories() const {
    std::vector<int> present;
    for (int c = 0; c < static_cast<int>(kCategories.size()); ++c) {
        for (const Row& row : rows_) {
            if (row.category == c && row.kind != RowKind::Group) {
                present.push_back(c);
                break;
            }
        }
    }
    return present;
}

std::optional<std::size_t> SettingsScreen::FirstFocusable() const {
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        if (Focusable(rows_[i])) return i;
    }
    return std::nullopt;
}

void SettingsScreen::SelectCategory(int category, bool resetScroll) {
    category_ = category;
    categoryFocus_ = category;
    if (resetScroll) {
        camera_.Cancel();
        pageScroll_ = 0.0;
    }
    if (width_ > 0.0 && height_ > 0.0) Arrange();
    pageScroll_ = std::clamp(pageScroll_, 0.0, MaxPageScroll());
    focus_ = FirstFocusable();
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
        return motion::PrefersReducedMotion(motion_) ? "On · simpler animation" : "Off · full animation";
    case RowKind::Performance:
        return motion_.performanceMode ? "On · simpler effects and motion" : "Off · full UI motion";
    case RowKind::Theme:
        return store_.Look() == Theme::Light ? "Light" : "Dark";
    case RowKind::Glass:
        if (row.key == "font") return std::string(UiFontName(store_.Font()));
        return store_.ReduceTransparency() ? "On · solid surfaces" : "Off · Liquid Glass";
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
            return store_.ReduceTransparency() ? "Solid surfaces" : "Liquid Glass";
        }
        return row.detail;
    case RowKind::Group:
        break;
    }
    return "";
}

bool SettingsScreen::Focusable(const Row& row) const {
    return row.kind != RowKind::Group && row.kind != RowKind::Info && row.category == category_;
}

bool SettingsScreen::SwitchRow(const Row& row) const {
    return row.kind == RowKind::Motion || row.kind == RowKind::Performance || row.kind == RowKind::AutoUpdate ||
           row.kind == RowKind::ChooseProfile || (row.kind == RowKind::Glass && row.key == "reduce-transparency");
}

bool SettingsScreen::SegmentedRow(const Row& row) const {
    return row.kind == RowKind::Theme || (row.kind == RowKind::Glass && row.key == "font");
}

std::vector<std::string> SettingsScreen::SegmentLabels(const Row& row) const {
    if (row.kind == RowKind::Theme) return {"Dark", "Light"};
    return {"Geist", "Inter", "System"};
}

std::size_t SettingsScreen::SegmentIndex(const Row& row) const {
    if (row.kind == RowKind::Theme) return store_.Look() == Theme::Light ? 1 : 0;
    const UiFont font = store_.Font();
    return font == UiFont::Geist ? 0 : font == UiFont::Inter ? 1 : 2;
}

void SettingsScreen::SetSegment(const Row& row, std::size_t index) {
    if (row.kind == RowKind::Theme) {
        store_.SaveLook(index == 1 ? Theme::Light : Theme::Dark);
    } else {
        store_.SetFont(index == 0 ? UiFont::Geist : index == 1 ? UiFont::Inter : UiFont::System);
    }
    RefreshDetails();
}

std::string SettingsScreen::Caption(const Row& row) const {
    if (row.kind == RowKind::Push) return row.detail;
    if (row.kind == RowKind::Info) return "";
    std::string words = SplitDetail(row.detail).second;
    if (!words.empty()) {
        words[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(words[0])));
        return words;
    }
    if (row.kind == RowKind::Theme) return "Dark or light colours across the app";
    if (row.kind == RowKind::Language) return "Language of menus and labels";
    if (row.key == "font") return "The typeface used across TVM";
    return "";
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
    // Two panes. The left one (categories) stays put; the right one scrolls. Row positions are in page coordinates.
    const bool compact = CompactViewport(width_, height_);
    const double safe = metrics_.Rem(compact ? 1.0 : kSafeXRem);
    paneLeft_ = safe;
    paneWidth_ = metrics_.Rem(compact ? 8.0 : 17.0);
    contentLeft_ = paneLeft_ + paneWidth_ + metrics_.Rem(compact ? 1.0 : 2.5);
    contentWidth_ = std::max(metrics_.Rem(12.0), std::min(width_ - contentLeft_ - safe, metrics_.Rem(46.0)));
    const double titleHeight = metrics_.Rem(kGroupTitleRem) * 1.6;
    double y = metrics_.Rem(kSafeYRem) + metrics_.Rem(5.6);
    cards_.clear();
    bool first = true;
    for (Row& row : rows_) {
        row.column = 0;
        row.left = contentLeft_;
        row.width = contentWidth_;
        if (row.category != category_) continue;
        if (row.kind == RowKind::Group) {
            if (!first) y += metrics_.Rem(kGroupGapRem);
            row.top = y;
            row.height = titleHeight;
            y += row.height + metrics_.Rem(0.3);
            cards_.push_back(CardBox{y, 0.0});
        } else {
            // A row with a description under its name is a little taller.
            const bool tall = !Caption(row).empty();
            const double height = metrics_.Rem(tall ? kTallRowHeightRem : kRowHeightRem);
            row.top = y;
            row.height = compact ? std::max(56.0, height) : height;
            y += row.height;
            if (!cards_.empty()) cards_.back().height += row.height;
        }
        first = false;
    }
    contentBottom_ = y;
}

double SettingsScreen::MaxPageScroll() const {
    return std::max(0.0, contentBottom_ + metrics_.Rem(kSafeYRem) - height_);
}

Box SettingsScreen::ScreenBox(const Row& row) const {
    return Box{row.left, row.top - pageScroll_, row.width, row.height};
}

Box SettingsScreen::CategoryBox(std::size_t slot) const {
    return Box{paneLeft_,
               metrics_.Rem(kSafeYRem) + metrics_.Rem(3.6) + static_cast<double>(slot) * metrics_.Rem(kCatRowStepRem),
               paneWidth_, metrics_.Rem(kCatRowHeightRem)};
}

Box SettingsScreen::SegmentTrack(const Row& row) const {
    const Box box = ScreenBox(row);
    return controls::SegmentedBox(SegmentLabels(row), box.Right() - metrics_.Rem(1.2), box.CenterY(), metrics_.rem);
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

    if (pane_ == Pane::Categories) {
        const std::vector<int> present = PresentCategories();
        const auto at = std::find(present.begin(), present.end(), categoryFocus_);
        if (at == present.end()) return false;
        if (direction == nav::Direction::Down && at + 1 != present.end()) {
            SelectCategory(*(at + 1), true);
            return true;
        }
        if (direction == nav::Direction::Up && at != present.begin()) {
            SelectCategory(*(at - 1), true);
            return true;
        }
        if (direction == nav::Direction::Right && focus_.has_value()) {
            pane_ = Pane::Content;
            return true;
        }
        return false;
    }

    if (!focus_.has_value()) return false;
    const Row& current = rows_[*focus_];
    if (direction == nav::Direction::Left || direction == nav::Direction::Right) {
        if (SegmentedRow(current)) {
            const std::size_t count = SegmentLabels(current).size();
            const std::size_t index = SegmentIndex(current);
            if (direction == nav::Direction::Right && index + 1 < count) {
                SetSegment(current, index + 1);
                return true;
            }
            if (direction == nav::Direction::Left && index > 0) {
                SetSegment(current, index - 1);
                return true;
            }
        }
        if (direction == nav::Direction::Left) {
            // Back to the list of categories, on the one being shown.
            pane_ = Pane::Categories;
            categoryFocus_ = category_;
            return true;
        }
        return false;
    }
    if (direction != nav::Direction::Up && direction != nav::Direction::Down) return false;
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
    if (pane_ == Pane::Categories) {
        if (focus_.has_value()) pane_ = Pane::Content;
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
        if (row.key == "font") {
            const UiFont current = store_.Font();
            store_.SetFont(current == UiFont::Geist ? UiFont::Inter : current == UiFont::Inter ? UiFont::System : UiFont::Geist);
        } else {
            store_.SetReduceTransparency(!store_.ReduceTransparency());
        }
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
    if (pane_ == Pane::Categories) return std::string("cat:") + kCategories[static_cast<std::size_t>(categoryFocus_)].id;
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
    if (key.rfind("cat:", 0) == 0) {
        const std::string id = key.substr(4);
        for (std::size_t c = 0; c < kCategories.size(); ++c) {
            if (id != kCategories[c].id) continue;
            if (pane_ == Pane::Categories && categoryFocus_ == static_cast<int>(c)) return false;
            pane_ = Pane::Categories;
            categoryFocus_ = static_cast<int>(c);
            return true;
        }
        return false;
    }
    const std::string base = key.substr(0, key.find('#'));
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& candidate = rows_[i];
        if (candidate.kind == RowKind::Group || candidate.kind == RowKind::Info || candidate.key != base) continue;
        const bool sameCategory = candidate.category == category_;
        if (sameCategory && pane_ == Pane::Content && focus_ == std::optional<std::size_t>(i)) return false;
        if (!sameCategory) SelectCategory(candidate.category, true);
        pane_ = Pane::Content;
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
    const std::vector<int> present = PresentCategories();
    for (std::size_t slot = 0; slot < present.size(); ++slot) {
        const Box box = CategoryBox(slot);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) {
            return std::string("cat:") + kCategories[static_cast<std::size_t>(present[slot])].id;
        }
    }
    if (x < contentLeft_ - metrics_.Rem(0.5)) return std::nullopt;
    for (const Row& row : rows_) {
        if (!Focusable(row)) continue;
        const Box box = ScreenBox(row);
        if (x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom()) {
            if (SegmentedRow(row)) {
                const Box track = SegmentTrack(row);
                if (const std::optional<std::size_t> segment =
                        controls::SegmentAt(track, SegmentLabels(row).size(), x, y)) {
                    return row.key + "#" + std::to_string(*segment);
                }
            }
            return row.key;
        }
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
    if (key.rfind("cat:", 0) == 0) {
        const std::string id = key.substr(4);
        for (std::size_t c = 0; c < kCategories.size(); ++c) {
            if (id == kCategories[c].id) {
                SelectCategory(static_cast<int>(c), true);
                pane_ = Pane::Categories;
            }
        }
        return std::nullopt;
    }
    if (const std::size_t hash = key.find('#'); hash != std::string::npos) {
        // A click on one segment of a choice sets it directly.
        const std::string base = key.substr(0, hash);
        FocusItem(base, nowMs, true);
        for (const Row& row : rows_) {
            if (row.key != base || !SegmentedRow(row)) continue;
            const std::size_t index = std::stoul(key.substr(hash + 1));
            if (index < SegmentLabels(row).size()) SetSegment(row, index);
        }
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

    const double rem = metrics_.rem;
    const bool showFocus = !focusHidden_;

    // Left pane: the title and the categories. It does not scroll.
    painter.Text(Box{paneLeft_, metrics_.Rem(kSafeYRem), paneWidth_, metrics_.Rem(2.4)}, "Settings", type::H2(rem),
                 tokens::kText);
    const std::vector<int> present = PresentCategories();
    for (std::size_t slot = 0; slot < present.size(); ++slot) {
        const int c = present[slot];
        const Box box = CategoryBox(slot);
        const bool selected = c == category_;
        const bool focused = showFocus && pane_ == Pane::Categories && categoryFocus_ == c;
        if (selected) painter.FillRoundRect(box, metrics_.Rem(kRowRadiusRem), tokens::kSurfaceHover);
        if (focused) painter.StrokeRoundRect(box, metrics_.Rem(kRowRadiusRem), 2.0, tokens::kFocusRing);
        painter.Text(Box{box.x + metrics_.Rem(1.0), box.y, box.width - metrics_.Rem(1.2), box.height},
                     kCategories[static_cast<std::size_t>(c)].title, TextStyle{0.9375 * rem, true, selected ? 650 : 520},
                     selected || focused ? tokens::kText : tokens::kTextMuted);
    }

    // Right pane: title, one line about it, then the cards.
    const CategoryDef& def = kCategories[static_cast<std::size_t>(category_)];
    const double headY = metrics_.Rem(kSafeYRem) - pageScroll_;
    painter.Text(Box{contentLeft_, headY, contentWidth_, metrics_.Rem(3.2)}, def.title, type::H1(rem), tokens::kText);
    painter.Text(Box{contentLeft_, headY + metrics_.Rem(3.3), contentWidth_, metrics_.Rem(1.6)}, def.description,
                 type::Body(rem), tokens::kTextMuted);

    for (const CardBox& card : cards_) {
        const Box box{contentLeft_, card.top - pageScroll_, contentWidth_, card.height};
        if (box.Bottom() < -20.0 || box.y > height_ + 20.0) continue;
        painter.FillRoundRect(box, metrics_.Rem(kCardRadiusRem), tokens::kSurface);
        painter.StrokeRoundRect(box, metrics_.Rem(kCardRadiusRem), 1.0, tokens::kBorderSoft);
    }

    bool afterRow = false;
    for (std::size_t i = 0; i < rows_.size(); ++i) {
        const Row& row = rows_[i];
        if (row.category != category_) continue;
        const Box box = ScreenBox(row);
        if (row.kind == RowKind::Group) {
            afterRow = false;
            if (box.Bottom() < -20.0 || box.y > height_ + 20.0) continue;
            std::string title = row.label;
            for (char& c : title) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
            painter.Text(Box{box.x + metrics_.Rem(0.4), box.y, box.width, box.height}, title,
                         TextStyle{metrics_.Rem(kGroupTitleRem) * 0.8, true, 700, 0.06}, tokens::kTextFaint);
            continue;
        }
        const bool visible = !(box.Bottom() < -20.0 || box.y > height_ + 20.0);
        if (visible) {
            if (afterRow) {
                painter.FillRoundRect(Box{box.x + metrics_.Rem(1.2), box.y, box.width - metrics_.Rem(2.4), 1.0}, 0.0,
                                      tokens::kBorderSoft);
            }
            PaintRow(painter, row, showFocus && pane_ == Pane::Content && focus_ == std::optional<std::size_t>(i));
        }
        afterRow = true;
    }
    language_.Paint(painter, clockMs_);
}

void SettingsScreen::PaintRow(Painter& painter, const Row& row, bool focused) const {
    const Box box = ScreenBox(row);
    const double rem = metrics_.rem;
    if (focused) {
        const Box inset{box.x + 4.0, box.y + 3.0, box.width - 8.0, box.height - 6.0};
        painter.FillRoundRect(inset, metrics_.Rem(kRowRadiusRem), WithAlpha(tokens::kText, 0.06));
        painter.StrokeRoundRect(inset, metrics_.Rem(kRowRadiusRem), 2.0, tokens::kFocusRing);
    }

    const bool danger = row.key == "factory-reset" || row.key == "clear-cache";
    const Color labelColor = danger ? kDanger : tokens::kText;
    double right = box.Right() - metrics_.Rem(1.2);

    // At the right: a switch, a segmented choice, a value with a chevron, or the way in.
    if (SwitchRow(row)) {
        const Box track = controls::SwitchBox(right, box.CenterY(), rem);
        controls::PaintSwitch(painter, track, SplitDetail(row.detail).first == "On", false);
        right = track.x - metrics_.Rem(0.8);
    } else if (SegmentedRow(row)) {
        const Box track = SegmentTrack(row);
        controls::PaintSegmented(painter, track, SegmentLabels(row), SegmentIndex(row), false, rem);
        right = track.x - metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Language) {
        right = controls::PaintValueChevron(painter, right, box, row.detail, focused, rem) - metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Push) {
        right = controls::PaintValueChevron(painter, right, box, "", focused, rem, true) - metrics_.Rem(0.8);
    } else if (row.kind == RowKind::Info && !row.detail.empty()) {
        const TextStyle style{0.9375 * rem, true, 600};
        const double width = std::min(painter.MeasureText(row.detail, style), box.width * 0.52);
        painter.Text(Box{right - width, box.y, width + 2.0, box.height}, row.detail, style, tokens::kAccentStrong);
        right -= width + metrics_.Rem(0.8);
    }

    // The name, with its description under it in caption size.
    const double textX = box.x + metrics_.Rem(1.2);
    const double textWidth = std::max(0.0, right - textX);
    const std::string caption = Caption(row);
    const TextStyle labelStyle{0.9375 * rem, true, 600};
    if (caption.empty()) {
        painter.Text(Box{textX, box.y, textWidth, box.height}, row.label, labelStyle, labelColor);
        return;
    }
    painter.Text(Box{textX, box.y + box.height * 0.12, textWidth, box.height * 0.42}, row.label, labelStyle, labelColor);
    painter.Text(Box{textX, box.y + box.height * 0.52, textWidth, box.height * 0.34}, caption, type::Caption(rem),
                 tokens::kTextMuted);
}

}  // namespace tvm::ui
