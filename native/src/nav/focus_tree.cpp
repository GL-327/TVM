#include "nav/focus_tree.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace tvm::nav {

namespace {

// Constants from the Norigin core.
constexpr double kAdjacentSliceThreshold = 0.2;
constexpr double kAdjacentSliceWeight = 5.0;
constexpr double kDiagonalSliceWeight = 1.0;
constexpr double kMainCoordinateWeight = 5.0;

struct Point {
    double x;
    double y;
};

struct Corners {
    Point a;
    Point b;
};

double Coordinate(const Point& point, bool useX) {
    return useX ? point.x : point.y;
}

// The two corners along the edge a move in `direction` crosses. For the
// current node they lie on its leading edge. For a candidate they lie on its
// trailing edge.
Corners RefCorners(Direction direction, bool isSibling, const Rect& rect) {
    switch (direction) {
    case Direction::Up: {
        const double y = isSibling ? rect.bottom : rect.top;
        return {{rect.left, y}, {rect.right, y}};
    }
    case Direction::Down: {
        const double y = isSibling ? rect.top : rect.bottom;
        return {{rect.left, y}, {rect.right, y}};
    }
    case Direction::Left: {
        const double x = isSibling ? rect.right : rect.left;
        return {{x, rect.top}, {x, rect.bottom}};
    }
    case Direction::Right: {
        const double x = isSibling ? rect.left : rect.right;
        return {{x, rect.top}, {x, rect.bottom}};
    }
    }
    return {};
}

// A candidate is in the same row or column as the current node when its edge
// overlaps the current edge by at least 20% of that edge.
bool IsAdjacentSlice(const Corners& ref, const Corners& sibling, bool isVertical) {
    const bool useX = isVertical;
    const double refA = Coordinate(ref.a, useX);
    const double refB = Coordinate(ref.b, useX);
    const double sibA = Coordinate(sibling.a, useX);
    const double sibB = Coordinate(sibling.b, useX);

    const double threshold = (refB - refA) * kAdjacentSliceThreshold;
    const double intersection = std::max(0.0, std::min(refB, sibB) - std::max(refA, sibA));
    return intersection >= threshold;
}

double PrimaryAxisDistance(const Corners& ref, const Corners& sibling, bool isVertical) {
    const bool useX = !isVertical;
    return std::abs(Coordinate(sibling.a, useX) - Coordinate(ref.a, useX));
}

// 'center' mode: distance between the midpoints of the two edges.
double SecondaryAxisDistance(const Corners& ref, const Corners& sibling, bool isVertical) {
    const bool useX = isVertical;
    const double refCenter = (Coordinate(ref.a, useX) + Coordinate(ref.b, useX)) / 2.0;
    const double siblingCenter = (Coordinate(sibling.a, useX) + Coordinate(sibling.b, useX)) / 2.0;
    return std::abs(refCenter - siblingCenter);
}

// The coordinate that decides whether a node lies beyond the current one.
double CutoffCoordinate(bool isVertical, bool isIncremental, bool isSibling, const Rect& rect) {
    const double start = isVertical ? rect.top : rect.left;
    const double end = isVertical ? rect.bottom : rect.right;
    if (isIncremental) return isSibling ? start : end;
    return isSibling ? end : start;
}

// Lower is better. The adjacent slice is weighted five times, and the
// primary-axis distance five times again.
double Priority(const Rect& current, const Rect& candidate, Direction direction) {
    const bool isVertical = direction == Direction::Up || direction == Direction::Down;
    const Corners ref = RefCorners(direction, false, current);
    const Corners sibling = RefCorners(direction, true, candidate);
    const bool adjacent = IsAdjacentSlice(ref, sibling, isVertical);

    // Off the adjacent slice the two axis functions swap, as in the library.
    const double primary = adjacent ? PrimaryAxisDistance(ref, sibling, isVertical)
                                    : SecondaryAxisDistance(ref, sibling, isVertical);
    const double secondary = adjacent ? SecondaryAxisDistance(ref, sibling, isVertical)
                                      : PrimaryAxisDistance(ref, sibling, isVertical);

    const double totalDistancePoints = primary * kMainCoordinateWeight + secondary;
    return (totalDistancePoints + 1.0) / (adjacent ? kAdjacentSliceWeight : kDiagonalSliceWeight);
}

bool IsIncremental(Direction direction) {
    return direction == Direction::Down || direction == Direction::Right;
}

bool IsVertical(Direction direction) {
    return direction == Direction::Up || direction == Direction::Down;
}

double Centre(const Rect& rect) {
    return rect.left + (rect.right - rect.left) / 2.0;
}

}  // namespace

void FocusTree::Upsert(FocusNode node) {
    const std::string key = node.key;
    const auto existing = nodes_.find(key);
    if (existing != nodes_.end()) {
        // Keep the children's record of the focus path.
        node.lastFocusedChild = existing->second.lastFocusedChild;
        existing->second = std::move(node);
        return;
    }
    order_.push_back(key);
    nodes_.emplace(key, std::move(node));
}

void FocusTree::Remove(const std::string& key) {
    if (!nodes_.contains(key)) return;
    RemoveRecursive(key);
    if (focused_.has_value() && !nodes_.contains(*focused_)) focused_.reset();
}

void FocusTree::RemoveRecursive(const std::string& key) {
    for (const std::string& child : ChildrenOf(key)) RemoveRecursive(child);
    nodes_.erase(key);
    std::erase(order_, key);
}

bool FocusTree::Contains(const std::string& key) const {
    return nodes_.contains(key);
}

const FocusNode* FocusTree::Find(const std::string& key) const {
    const auto found = nodes_.find(key);
    return found == nodes_.end() ? nullptr : &found->second;
}

std::vector<std::string> FocusTree::ChildrenOf(const std::string& key) const {
    std::vector<std::string> children;
    for (const std::string& candidate : order_) {
        const FocusNode& node = nodes_.at(candidate);
        if (node.parent == key) children.push_back(candidate);
    }
    return children;
}

std::optional<std::string> FocusTree::ResolveLeaf(const std::string& key) const {
    const FocusNode* node = Find(key);
    if (node == nullptr || !node->focusable) return std::nullopt;
    if (!node->container) return key;

    // The child that held focus last wins if it can still take it.
    if (!node->lastFocusedChild.empty()) {
        if (auto remembered = ResolveLeaf(node->lastFocusedChild)) return remembered;
    }

    // Otherwise the leaf nearest this container's centre.
    const double cx = Centre(node->rect);
    const double cy = (node->rect.top + node->rect.bottom) / 2.0;
    std::optional<std::string> best;
    double bestDistance = std::numeric_limits<double>::infinity();
    for (const std::string& child : ChildrenOf(key)) {
        const auto leaf = ResolveLeaf(child);
        if (!leaf.has_value()) continue;
        const Rect& rect = nodes_.at(*leaf).rect;
        const double dx = Centre(rect) - cx;
        const double dy = (rect.top + rect.bottom) / 2.0 - cy;
        const double distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = leaf;
        }
    }
    return best;
}

bool FocusTree::SetFocus(const std::string& key) {
    const auto leaf = ResolveLeaf(key);
    if (!leaf.has_value()) return false;

    focused_ = leaf;

    // Each ancestor remembers the path that leads to the focused leaf.
    std::string child = *leaf;
    std::string parent = nodes_.at(child).parent;
    while (!parent.empty()) {
        const auto found = nodes_.find(parent);
        if (found == nodes_.end()) break;
        found->second.lastFocusedChild = child;
        child = parent;
        parent = found->second.parent;
    }
    return true;
}

bool FocusTree::Navigate(Direction direction) {
    if (!focused_.has_value()) return false;
    const auto next = SmartNavigate(direction, *focused_);
    if (!next.has_value()) return false;
    return SetFocus(*next);
}

std::optional<std::string> FocusTree::SmartNavigate(Direction direction, const std::string& fromKey) const {
    const FocusNode* current = Find(fromKey);
    if (current == nullptr) return std::nullopt;

    // The cutoff keeps only candidates that lie beyond the current node's
    // leading edge, in the direction of travel.
    const bool vertical = IsVertical(direction);
    const bool incremental = IsIncremental(direction);
    const double currentCutoff = CutoffCoordinate(vertical, incremental, false, current->rect);

    std::optional<std::string> best;
    double bestPriority = std::numeric_limits<double>::infinity();
    for (const std::string& key : order_) {
        if (key == fromKey) continue;
        const FocusNode& candidate = nodes_.at(key);
        if (candidate.parent != current->parent || !candidate.focusable) continue;

        const double candidateCutoff = CutoffCoordinate(vertical, incremental, true, candidate.rect);
        const bool beyond = incremental ? candidateCutoff >= currentCutoff : candidateCutoff <= currentCutoff;
        if (!beyond) continue;

        const double priority = Priority(current->rect, candidate.rect, direction);
        if (priority < bestPriority) {
            bestPriority = priority;
            best = key;
        }
    }
    if (best.has_value()) return best;

    // Nothing lies that way inside this container. Ask the container's own
    // siblings, unless it is a boundary that keeps focus for this direction.
    if (current->parent.empty()) return std::nullopt;
    const FocusNode* parent = Find(current->parent);
    if (parent == nullptr) return std::nullopt;
    if (parent->boundary) {
        const std::vector<Direction> directions = parent->boundaryDirections.value_or(std::vector<Direction>{direction});
        if (std::ranges::find(directions, direction) != directions.end()) return std::nullopt;
    }
    return SmartNavigate(direction, parent->key);
}

}  // namespace tvm::nav
