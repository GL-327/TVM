#pragma once

// Small controls for settings-style rows: an iOS-style switch, a segmented control for 2-5 exclusive choices, and
// a value-with-chevron for pickers that open a list. They paint only; the screen that owns one keeps its state and
// hit-tests with the same boxes, so what is drawn is what is clickable.

#include <optional>
#include <string>
#include <vector>

#include "ui/painter.h"
#include "ui/theme.h"

namespace tvm::ui::controls {

// Switch: a 46x28 track at the 16 px rem, right-aligned to `right`, centred on `centerY`.
Box SwitchBox(double right, double centerY, double rem);
void PaintSwitch(Painter& painter, const Box& box, bool on, bool focused);

// Segmented control: a rounded track with one indicator. Widths follow the labels.
double SegmentedWidth(const std::vector<std::string>& labels, double rem);
Box SegmentedBox(const std::vector<std::string>& labels, double right, double centerY, double rem);
Box SegmentBox(const Box& track, std::size_t count, std::size_t index);
std::optional<std::size_t> SegmentAt(const Box& track, std::size_t count, double x, double y);
void PaintSegmented(Painter& painter, const Box& track, const std::vector<std::string>& labels, std::size_t selected,
                    bool focused, double rem);

// Value then chevron (down for a list, `forward` for a row that opens a page), ending at `right`. Returns the x where the control starts, so the label can end before it.
double PaintValueChevron(Painter& painter, double right, const Box& row, const std::string& value, bool focused, double rem,
                         bool forward = false);

}  // namespace tvm::ui::controls
