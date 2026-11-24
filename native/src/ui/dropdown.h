#pragma once

// A compact dropdown list, shared by the season picker on Details, App language in Settings, and the choices on the
// Downloads page. It is the player's menu, generalised: a dark floating panel for legibility, the Home navigation
// pill's hover plate sliding between rows (glass_styles.h), a blue tick on the chosen row, and an internal scroll for
// long lists. It opens under its control, or over it when there is no room, with a short fade and scale.
//
// The owning screen keeps one, routes its keys and pointer to it while it is open, and paints it last.

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "motion/preferences.h"
#include "motion/tween.h"
#include "nav/focus_tree.h"
#include "ui/painter.h"

namespace tvm::ui {

struct DropdownOption {
    std::string label;
    // A fainter second part after the label.
    std::string detail;
};

class Dropdown {
public:
    static constexpr double kOpenMs = 170.0;
    static constexpr double kCloseMs = 130.0;
    static constexpr std::size_t kRowsMost = 8;

    // Opens under (or over) `anchor`, highlighting and ticking `selected`. `rem` is the screen's rem in pixels, and
    // the panel stays inside `viewportWidth` by `viewportHeight`.
    void Open(const Box& anchor, std::vector<DropdownOption> options, std::size_t selected, double viewportWidth,
              double viewportHeight, double rem, double nowMs, const motion::MotionSettings& motion);
    void Close(double nowMs);
    bool IsOpen() const { return open_; }
    // Still on screen: open, or fading out after closing.
    bool Visible(double nowMs) const;
    bool Animating(double nowMs) const;

    // Up and Down move the highlight, keeping it in view. True when the list took the key.
    bool Navigate(nav::Direction direction, double nowMs);
    std::size_t Highlighted() const { return highlighted_; }
    std::size_t Selected() const { return selected_; }
    std::size_t Count() const { return options_.size(); }
    // The row under a point, if the point is on one.
    std::optional<std::size_t> RowAt(double x, double y) const;
    // Whether a point is on the panel at all (a click elsewhere closes it).
    bool Contains(double x, double y) const;
    // A hover moves the highlight to a row, sliding there.
    void Hover(std::size_t row, double nowMs);
    // The wheel scrolls a long list by whole rows. True when it moved.
    bool Scroll(int rows);

    Box PanelBox() const { return panel_; }
    std::optional<Box> RowBox(std::size_t row) const;

    void Paint(Painter& painter, double nowMs) const;

private:
    double Fade(double nowMs) const;
    std::size_t RowsShown() const;
    void KeepInView();
    void MoveHighlight(std::size_t row, double nowMs);

    std::vector<DropdownOption> options_;
    std::size_t selected_ = 0;
    std::size_t highlighted_ = 0;
    std::size_t first_ = 0;
    bool open_ = false;
    bool upward_ = false;
    double rem_ = 16.0;
    Box panel_{};
    motion::MotionSettings motion_;
    motion::Tween fade_;
    motion::Tween row_;
    bool everOpened_ = false;
};

}  // namespace tvm::ui
