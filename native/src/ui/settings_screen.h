#pragma once

// Settings. The rows, labels and detail text follow apps/ui/src/screens/Settings.tsx.
// Motion, performance mode, language, theme and update checks are saved through
// the preference store. The other rows open their native pages.

#include <string>
#include <vector>

#include "motion/camera.h"
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

class SettingsScreen final : public ScreenBase {
public:
    SettingsScreen(PreferenceStore& store, motion::MotionSettings motion);

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    void Paint(Painter& painter) const override;

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
    // The App language list, while it is open. Exposed for tests.
    const Dropdown& LanguageList() const { return language_; }
    void SetDeveloperDiagnostics(DeveloperDiagnostics diag);

    // Exposed for tests.
    std::vector<std::string> RowLabels() const;
    std::string DetailOf(const std::string& key) const;

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
    };

    struct CardBox {
        double top = 0.0;
        double height = 0.0;
    };

    enum class Pane { Content, Categories };

    void BuildRows();
    std::vector<int> PresentCategories() const;
    void SelectCategory(int category, bool resetScroll);
    std::optional<std::size_t> FirstFocusable() const;
    bool SegmentedRow(const Row& row) const;
    bool SwitchRow(const Row& row) const;
    std::vector<std::string> SegmentLabels(const Row& row) const;
    std::size_t SegmentIndex(const Row& row) const;
    void SetSegment(const Row& row, std::size_t index);
    Box SegmentTrack(const Row& row) const;
    Box CategoryBox(std::size_t slot) const;
    std::string Caption(const Row& row) const;
    void RefreshDetails();
    std::string DetailFor(const Row& row) const;
    void Arrange();
    double MaxPageScroll() const;
    void EnsureVisible(const Row& row, double nowMs);
    std::optional<std::size_t> FocusedIndex() const;
    bool Focusable(const Row& row) const;
    std::optional<Command> ApplyRow(std::size_t index);
    Box ScreenBox(const Row& row) const;
    void PaintRow(Painter& painter, const Row& row, bool focused) const;

    PreferenceStore& store_;
    prefs::CorePrefs core_;
    DeveloperDiagnostics diag_;
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
    std::vector<CardBox> cards_;
    double paneLeft_ = 0.0;
    double paneWidth_ = 0.0;
    double contentLeft_ = 0.0;
    double contentWidth_ = 0.0;
    motion::CameraTween camera_;
    // App language's list, which opens over the page.
    Dropdown language_;
    double clockMs_ = 0.0;
    void PickLanguage(std::size_t index, double nowMs);
};

}  // namespace tvm::ui
