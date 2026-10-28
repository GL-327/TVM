#pragma once

// Settings. The rows, labels and detail text follow apps/ui/src/screens/Settings.tsx.
// Motion, performance mode, language and automatic updates are real: they are
// saved through the preference store. The other rows open the screens that
// are not ported yet, so they show a placeholder instead of doing nothing.
//
// Not included: the Look group (light and dark themes need the theme port),
// and the Linux desktop row, which only applies to the TVM USB stick.

#include <string>
#include <vector>

#include "motion/camera.h"
#include "ui/preferences_store.h"
#include "ui/screen_base.h"
#include "ui/widget.h"

namespace tvm::ui {

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

    // Exposed for tests.
    std::vector<std::string> RowLabels() const;
    std::string DetailOf(const std::string& key) const;

private:
    enum class RowKind {
        Group,
        Motion,
        Performance,
        Language,
        AutoUpdate,
        Push,
        Info,
    };

    struct Row {
        RowKind kind;
        std::string key;
        std::string label;
        std::string detail;
        Command command;
        // Position in the page, before scrolling.
        double top = 0.0;
        double height = 0.0;
    };

    void BuildRows();
    void RefreshDetails();
    std::string DetailFor(const Row& row) const;
    void Arrange();
    double MaxPageScroll() const;
    void EnsureVisible(const Row& row, double nowMs);
    std::optional<std::size_t> FocusedIndex() const;
    bool Focusable(const Row& row) const;
    std::optional<Command> ApplyRow(std::size_t index);
    Box ScreenBox(const Row& row) const;

    PreferenceStore& store_;
    prefs::CorePrefs core_;
    Metrics metrics_;
    double width_ = 0.0;
    double height_ = 0.0;
    std::vector<Row> rows_;
    std::optional<std::size_t> focus_;
    double pageScroll_ = 0.0;
    double contentBottom_ = 0.0;
    motion::CameraTween camera_;
};

}  // namespace tvm::ui
