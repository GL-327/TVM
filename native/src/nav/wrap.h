#pragma once

// Wrap-around and rail rules for focus, ported from
// apps/ui/src/nav/railNav.ts, wrapFocus.ts and loopingRail.ts, together with
// the camera targets from revealFocused.ts. Indices are signed so the rules
// read as they do in the web code.

#include <optional>
#include <vector>

#include "nav/focus_tree.h"

namespace tvm::nav {

enum class WrapAxis {
    X,     // A horizontal row. Left and right wrap.
    Y,     // A vertical list. Up and down wrap.
    Grid,  // A two-dimensional grid.
};

// The index one step along a row, wrapping at both ends. Left/right only.
std::optional<int> RowWrapIndex(int index, Direction direction, int count);

// The index one step up or down a list, wrapping at the ends.
std::optional<int> NeighborRowIndex(int current, Direction direction, int count);

// Steps inside a grid. Left and right stay on the current row. Down from the
// last row wraps to the top. Up from the top row has nowhere to go.
std::optional<int> WrapGridIndex(Direction direction, int index, int total, int columns);

// Dispatches on the group's axis. Returns nothing when the direction does not
// apply, so the caller can pass the key on.
std::optional<int> WrapIndexInGroup(Direction direction, int index, int total, WrapAxis axis, int columns);

// True when the index sits on the edge a move would cross.
bool IsWrapAcross(int index, Direction direction, int count);

// Only the seam of a looping rail wraps. Mid-rail moves stay on the ordinary path.
std::optional<int> ConveyorWrapIndex(Direction direction, int index, int count);

// True when the group should consume the key for this axis.
bool ShouldConsumeAxis(WrapAxis axis, Direction direction);

// Counts the cards that share the first card's row. Cards whose tops differ by
// more than the threshold belong to the next row.
int CountColumns(const std::vector<double>& tops, double threshold = 8.0);

WrapAxis WrapGroupKind(int columns, int count);

// Index of the candidate whose centre is nearest the target.
int PickClosestIndex(const std::vector<double>& centers, double target);

// Hops around a looping rail, measured modulo the count.
int RailHopDistance(int from, int to, int count);

// Loop geometry. A rail is three copies of its catalogue, and the camera rides
// the middle copy.
inline constexpr int kLoopCopies = 3;
// If the wrap settle never fires, release the conveyor so the remote is not frozen.
inline constexpr double kWrapUnlockMs = 560.0;

double LoopSetWidth(double scrollWidth, int copies = kLoopCopies);
double LoopPitch(double setWidth, int count);

// Brings a scroll offset into the window where a middle-copy card can stay
// centred.
double NormalizeLoopScroll(double scrollLeft, double setWidth, double viewWidth);

// True when a hop spans a whole catalogue, not one title.
bool IsLoopSeamJump(double from, double to, double setWidth);

// The offset that centres a card in a looping rail. The seam is parked only
// when the hop itself crosses a catalogue.
double CameraXForCard(double currentScrollLeft, double target, double setWidth, double viewWidth);

// Offset that centres a card in its row.
double CenteredRowOffset(double scrollLeft, double cardLeft, double cardWidth, double rowLeft, double rowWidth);

// Camera for the ten-foot UI. The page parks the focused row just under the
// chrome, rather than snapping the whole page.
inline constexpr double kHomeRowCameraPad = 72.0;
inline constexpr double kPagePanSlop = 12.0;

double RowCameraTop(double scrollTop, double railTop, double viewTop, double ribbonHeight);
double PagePanTarget(double scrollTop, double itemTop, double viewTop, double padTop);

// Sidebar chrome that spans the height of the view is not a top pad.
double ChromeReserve(double height, double width, double viewHeight, double viewWidth);

bool ShouldNudgePageY(double current, double target, double slop = kPagePanSlop);

}  // namespace tvm::nav
