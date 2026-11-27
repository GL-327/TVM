#pragma once

// Settings. The rows, labels and detail text follow apps/ui/src/screens/Settings.tsx and settingsControls.tsx.
// Motion, performance mode, language, theme and update checks are saved through the preference store. The
// playback, subtitle, Home and Extras choices are Core preferences: the app hands the screen what GET /api/prefs
// answered (SetCoreSettings), and every change comes back out as a partial PUT /api/prefs body through the sink.
// The other rows open their native pages.

#include <array>
#include <functional>
#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "motion/camera.h"
#include "ui/catalog_view.h"
#include "ui/dropdown.h"
#include "ui/preferences_store.h"
#include "ui/screen_base.h"
#include "ui/widget.h"

namespace tvm::ui {

struct DeveloperDiagnostics {
    bool active = false;
    std::string buildVersion;
    std::string rdTokenSource;
    std::string glassMode;

    bool operator==(const DeveloperDiagnostics&) const = default;
};

struct VersionSummary {
    std::string windowVersion;
    std::string engineVersion;

    bool operator==(const VersionSummary&) const = default;
};

struct ManualUpdateState {
    bool busy = false;
    std::string status;

    bool operator==(const ManualUpdateState&) const = default;
};

// The Core preferences the Settings rows show. Each is addressed by the path it has in /api/prefs ("quality",
// "subtitleStyle.size", "extras.trailers"), and holds its value as text: "1" or "0" for a switch.
struct CoreSettings {
    std::map<std::string, std::string, std::less<>> values;
    std::vector<std::string> subtitleLanguages{"eng"};
    std::vector<HomeSection> homeSections;

    // Reads a GET /api/prefs body. Anything missing or of the wrong type keeps its default.
    static CoreSettings FromJson(const nlohmann::json& body);
    std::string Get(const std::string& pref) const;
    // What Core uses when nothing is saved, and whether the preference is a switch.
    static std::string Default(const std::string& pref);
    static bool IsSwitch(const std::string& pref);
    // The partial PUT /api/prefs body that sets one preference.
    static nlohmann::json Patch(const std::string& pref, const std::string& value);
};

// Receives the partial /api/prefs body for each change. It also receives the two native-only choices
// ("sleepTimerDefault", "spotlightEvents"), which the screen has already saved, so the app can react to them.
using PrefsSink = std::function<void(const nlohmann::json& patch)>;

class SettingsScreen final : public ScreenBase {
public:
    SettingsScreen(PreferenceStore& store, motion::MotionSettings motion);

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    void Paint(Painter& painter) const override;
    // The ribbon stage is only for the Hub and the profile chooser.
    bool ShowsStage() const override { return false; }

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override;
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;

    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const override;
    void SetScroll(const ScrollSurface& surface, double value, double nowMs) override;
    void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) override;
    bool CloseOverlay(double nowMs) override;
    void PressedElsewhere(const std::optional<std::string>& key, double nowMs) override;
    // The App language list, or the list of the Select row that is open. Exposed for tests.
    const Dropdown& LanguageList() const { return select_; }
    void SetDeveloperDiagnostics(DeveloperDiagnostics diag);
    void SetVersionSummary(VersionSummary summary);
    void SetManualUpdateState(ManualUpdateState state);
    // The answer of GET /api/prefs, for the playback, subtitle, Home and Extras rows.
    void SetCoreSettings(CoreSettings settings);
    void SetHomeSectionLabels(HomeSectionLabels labels);
    void SetPrefsSink(PrefsSink sink) { sink_ = std::move(sink); }

    // The search field takes typing while it has the focus.
    bool Typing() const { return pane_ == Pane::Search || webhookDraft_.has_value(); }
    bool EditingWebhook() const { return webhookDraft_.has_value(); }
    void SelectAll() { if (webhookDraft_) webhookSelected_ = true; }
    void Type(const std::string& text);
    void Erase();
    const std::string& Query() const { return query_; }

    // Exposed for tests.
    std::vector<std::string> RowLabels() const;
    std::string DetailOf(const std::string& key) const;
    // The labels of the rows on show: the open category's, or every match while a search is typed.
    std::vector<std::string> ShownLabels() const;
    // The keys of the rows on show that can take focus.
    std::vector<std::string> ShownKeys() const;
    // The value a preference row shows for the labels of its options, "" for a row that is not a preference.
    std::string ValueOf(const std::string& key) const;

private:
    enum class RowKind {
        Group,
        Motion,
        Performance,
        Theme,
        Glass,
        Language,
        AutoUpdate,
        ChooseProfile,
        Push,
        Info,
        // A Core preference (or one of the two native-only ones), drawn as the control in `ctl`.
        Pref,
        // The subtitle sample: it only shows the chosen style.
        Preview,
        HomeSection,
    };

    enum class Ctl { None, Switch, Segmented, Select, Slider, Text };

    struct Option {
        std::string id;
        std::string label;
    };

    struct Row {
        RowKind kind;
        std::string key;
        std::string label;
        std::string detail;
        Command command;
        // Position in the page, before scrolling: its column (0 or 1 on a wide window), left edge and width.
        double top = 0.0;
        double height = 0.0;
        int column = 0;
        double left = 0.0;
        double width = 0.0;
        // The category it belongs to, an index into the fixed list in the .cpp.
        int category = 0;
        // A preference row: the control, the preference's path and its choices (a segmented or select row).
        Ctl ctl = Ctl::None;
        std::string pref;
        std::vector<Option> options;
        // The line under the label for a preference row, and for a push row that also shows a value.
        std::string desc;
        // Lower-case text a search looks in.
        std::string haystack;
    };

    struct CardBox {
        double top = 0.0;
        double height = 0.0;
    };

    // The category name above the rows of one category while a search is shown.
    struct Heading {
        double top = 0.0;
        std::string title;
    };

    enum class Pane { Content, Categories, Search };

    void BuildRows();
    std::vector<int> PresentCategories() const;
    void SelectCategory(int category, bool resetScroll);
    std::optional<std::size_t> FirstFocusable() const;
    bool Shown(const Row& row) const;
    bool SegmentedRow(const Row& row) const;
    bool SwitchRow(const Row& row) const;
    bool SelectRow(const Row& row) const;
    std::vector<std::string> SegmentLabels(const Row& row) const;
    std::size_t SegmentIndex(const Row& row) const;
    void SetSegment(const Row& row, std::size_t index);
    Box SegmentTrack(const Row& row) const;
    Box CategoryBox(std::size_t slot) const;
    Box SearchBox() const;
    std::string Caption(const Row& row) const;
    void RefreshDetails();
    std::string DetailFor(const Row& row) const;
    std::string PrefValue(const std::string& pref) const;
    void SetPref(const std::string& pref, const std::string& value);
    std::string OptionLabel(const Row& row, const std::string& id) const;
    void Arrange();
    double MaxPageScroll() const;
    void EnsureVisible(const Row& row, double nowMs);
    std::optional<std::size_t> FocusedIndex() const;
    bool Focusable(const Row& row) const;
    std::optional<Command> ApplyRow(std::size_t index);
    void OpenSelect(std::size_t index);
    void ChangeQuery(double nowMs);
    Box ScreenBox(const Row& row) const;
    void PaintRow(Painter& painter, const Row& row, bool focused) const;
    void PaintSearch(Painter& painter, bool focused) const;
    void PaintPreview(Painter& painter, const Row& row) const;
    Box WebhookField(const Row& row) const;
    std::array<Box, 3> HomeControls(const Row& row) const;
    bool HomeControlEnabled(const Row& row, int control) const;
    void EditHomeSection(const std::string& id, int control);
    void RebuildRowsKeepingFocus();
    void SaveWebhook();

    PreferenceStore& store_;
    prefs::CorePrefs core_;
    CoreSettings settings_;
    PrefsSink sink_;
    HomeSectionLabels homeLabels_ = HomeSections();
    std::vector<HomeSection> homeRows_;
    int homeControl_ = 2;
    DeveloperDiagnostics diag_;
    VersionSummary versionSummary_;
    ManualUpdateState manualUpdate_;
    Metrics metrics_;
    double width_ = 0.0;
    double height_ = 0.0;
    std::vector<Row> rows_;
    std::optional<std::size_t> focus_;
    double pageScroll_ = 0.0;
    double contentBottom_ = 0.0;
    int category_ = 0;
    int categoryFocus_ = 0;
    Pane pane_ = Pane::Content;
    // Back leaves the content for the category list only once the viewer has used the content: the first Back
    // after opening Settings, or after only hovering, leaves Settings.
    bool contentUsed_ = false;
    std::string query_;
    std::optional<std::string> webhookDraft_;
    bool webhookSelected_ = false;
    bool webhookInvalid_ = false;
    // The query trimmed and lower-cased, what the rows are matched against. Empty when nothing is being searched.
    std::string term_;
    std::vector<CardBox> cards_;
    std::vector<Heading> headings_;
    double paneLeft_ = 0.0;
    double paneWidth_ = 0.0;
    double contentLeft_ = 0.0;
    double contentWidth_ = 0.0;
    double categoryStep_ = 0.0;
    motion::CameraTween camera_;
    // The list that opens over the page: App language's, or a Select row's choices.
    Dropdown select_;
    std::optional<std::size_t> selectRow_;
    double clockMs_ = 0.0;
    std::string changedSegment_;
    std::size_t previousSegment_ = 0;
    double segmentChangedAt_ = 0.0;
    void PickOption(std::size_t index, double nowMs);
};

}  // namespace tvm::ui
