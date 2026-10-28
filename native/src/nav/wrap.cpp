#include "nav/wrap.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace tvm::nav {

std::optional<int> RowWrapIndex(int index, Direction direction, int count) {
    if (count < 1 || index < 0 || index >= count) return std::nullopt;
    if (direction == Direction::Right) return (index + 1) % count;
    if (direction == Direction::Left) return (index - 1 + count) % count;
    return std::nullopt;
}

std::optional<int> NeighborRowIndex(int current, Direction direction, int count) {
    if (count <= 0 || current < 0 || current >= count) return std::nullopt;
    if (direction == Direction::Up) return current > 0 ? std::optional<int>(current - 1) : std::nullopt;
    if (direction == Direction::Down) return current < count - 1 ? std::optional<int>(current + 1) : std::nullopt;
    return std::nullopt;
}

std::optional<int> WrapGridIndex(Direction direction, int index, int total, int columns) {
    if (total < 2 || columns < 1 || index < 0 || index >= total) return std::nullopt;
    const int row = index / columns;
    const int col = index % columns;
    const int rowStart = row * columns;
    const int rowEnd = std::min(rowStart + columns, total) - 1;

    switch (direction) {
    case Direction::Right:
        return index >= rowEnd ? rowStart : index + 1;
    case Direction::Left:
        return index <= rowStart ? rowEnd : index - 1;
    case Direction::Down: {
        const int next = index + columns;
        if (next < total) return next;
        return col < total ? col : 0;
    }
    case Direction::Up:
        if (row == 0) return std::nullopt;
        return index - columns;
    }
    return std::nullopt;
}

std::optional<int> WrapIndexInGroup(Direction direction, int index, int total, WrapAxis axis, int columns) {
    if (total < 2 || index < 0 || index >= total) return std::nullopt;

    if (axis == WrapAxis::Grid) return WrapGridIndex(direction, index, total, columns);

    if (axis == WrapAxis::Y) {
        if (direction == Direction::Down) return index == total - 1 ? 0 : index + 1;
        if (direction == Direction::Up) return index == 0 ? std::nullopt : std::optional<int>(index - 1);
        return std::nullopt;
    }

    if (direction == Direction::Right) return index == total - 1 ? 0 : index + 1;
    if (direction == Direction::Left) return index == 0 ? total - 1 : index - 1;
    return std::nullopt;
}

bool IsWrapAcross(int index, Direction direction, int count) {
    if (count < 2 || index < 0 || index >= count) return false;
    if (direction == Direction::Right) return index == count - 1;
    if (direction == Direction::Left) return index == 0;
    return false;
}

std::optional<int> ConveyorWrapIndex(Direction direction, int index, int count) {
    if (direction != Direction::Left && direction != Direction::Right) return std::nullopt;
    if (!IsWrapAcross(index, direction, count)) return std::nullopt;
    return RowWrapIndex(index, direction, count);
}

bool ShouldConsumeAxis(WrapAxis axis, Direction direction) {
    if (axis == WrapAxis::Y) return direction == Direction::Up || direction == Direction::Down;
    return direction == Direction::Left || direction == Direction::Right;
}

int CountColumns(const std::vector<double>& tops, double threshold) {
    if (tops.empty()) return 0;
    const double first = tops.front();
    int columns = 0;
    for (double top : tops) {
        if (std::abs(top - first) > threshold) break;
        ++columns;
    }
    return std::max(1, columns);
}

WrapAxis WrapGroupKind(int columns, int count) {
    if (count < 2) return WrapAxis::X;
    if (columns <= 1) return WrapAxis::Y;
    if (columns >= count) return WrapAxis::X;
    return WrapAxis::Grid;
}

int PickClosestIndex(const std::vector<double>& centers, double target) {
    if (centers.empty()) return -1;
    int best = 0;
    double bestDistance = std::numeric_limits<double>::infinity();
    for (std::size_t i = 0; i < centers.size(); ++i) {
        const double distance = std::abs(centers[i] - target);
        if (distance < bestDistance) {
            best = static_cast<int>(i);
            bestDistance = distance;
        }
    }
    return best;
}

int RailHopDistance(int from, int to, int count) {
    if (count < 1 || from < 0 || to < 0 || from >= count || to >= count) {
        return std::numeric_limits<int>::max();
    }
    const int right = (to - from + count) % count;
    const int left = (from - to + count) % count;
    return std::min(right, left);
}

double LoopSetWidth(double scrollWidth, int copies) {
    if (copies < 2 || scrollWidth <= 0.0) return 0.0;
    return scrollWidth / copies;
}

double LoopPitch(double setWidth, int count) {
    if (count < 1 || setWidth <= 0.0) return 0.0;
    return setWidth / count;
}

double NormalizeLoopScroll(double scrollLeft, double setWidth, double viewWidth) {
    if (setWidth <= 1.0) return scrollLeft;
    const double half = std::max(0.0, viewWidth) / 2.0;
    const double min = setWidth - half;
    const double max = setWidth * 2.0 - half;
    if (max <= min) return scrollLeft;

    double x = scrollLeft;
    while (x < min) x += setWidth;
    while (x >= max) x -= setWidth;
    return x;
}

bool IsLoopSeamJump(double from, double to, double setWidth) {
    return setWidth > 1.0 && std::abs(to - from) >= setWidth * 0.45;
}

double CameraXForCard(double currentScrollLeft, double target, double setWidth, double viewWidth) {
    if (!IsLoopSeamJump(currentScrollLeft, target, setWidth)) return target;
    const double parked = NormalizeLoopScroll(target, setWidth, viewWidth);
    return IsLoopSeamJump(target, parked, setWidth) ? parked : target;
}

double CenteredRowOffset(double scrollLeft, double cardLeft, double cardWidth, double rowLeft, double rowWidth) {
    return scrollLeft + cardLeft - rowLeft - (rowWidth - cardWidth) / 2.0;
}

double RowCameraTop(double scrollTop, double railTop, double viewTop, double ribbonHeight) {
    return scrollTop + (railTop - viewTop) - ribbonHeight;
}

double PagePanTarget(double scrollTop, double itemTop, double viewTop, double padTop) {
    return std::max(0.0, RowCameraTop(scrollTop, itemTop, viewTop, padTop));
}

double ChromeReserve(double height, double width, double viewHeight, double viewWidth) {
    if (height <= 0.0) return 0.0;
    if (height > viewHeight * 0.45 && width < viewWidth * 0.35) return 0.0;
    return std::min(height, viewHeight * 0.35);
}

bool ShouldNudgePageY(double current, double target, double slop) {
    return std::abs(target - current) >= slop;
}

}  // namespace tvm::nav
