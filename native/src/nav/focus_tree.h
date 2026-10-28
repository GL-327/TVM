#pragma once

// Spatial focus navigation over a tree of focusable nodes. A port of the
// algorithm in @noriginmedia/norigin-spatial-navigation-core 4.1.0, which the
// web UI uses, with the same cutoff filter, adjacent-slice test, weights and
// tree recursion, and with the 'center' distance method the UI selects.
//
// Nodes are leaves (focusable items) or containers (rows, grids, rails). A
// container is never focused itself: landing on it focuses the child it held
// last, or the child nearest its centre. Right-to-left writing is not
// supported; no TVM locale is right-to-left.

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace tvm::nav {

enum class Direction {
    Up,
    Down,
    Left,
    Right,
};

struct Rect {
    double left;
    double top;
    double right;
    double bottom;
};

struct FocusNode {
    std::string key;
    // Empty for a top-level node.
    std::string parent;
    Rect rect{};
    bool focusable = true;
    bool container = false;
    // A boundary container keeps focus inside itself for the directions it
    // lists. Without a list it stops every direction.
    bool boundary = false;
    std::optional<std::vector<Direction>> boundaryDirections;
    // Maintained by the tree. Used to restore focus into a container.
    std::string lastFocusedChild;
};

class FocusTree {
public:
    // Adds the node, or replaces its geometry and flags if the key exists.
    void Upsert(FocusNode node);

    // Removes the node and everything under it. Clears focus if it was inside.
    void Remove(const std::string& key);

    bool Contains(const std::string& key) const;
    const FocusNode* Find(const std::string& key) const;

    // Focuses a leaf, or the leaf a container resolves to. False if nothing
    // focusable is found.
    bool SetFocus(const std::string& key);

    std::optional<std::string> Focused() const { return focused_; }

    // Moves focus in a direction. Returns false when nothing lies that way, and
    // focus stays where it was.
    bool Navigate(Direction direction);

private:
    std::optional<std::string> SmartNavigate(Direction direction, const std::string& fromKey) const;
    std::optional<std::string> ResolveLeaf(const std::string& key) const;
    void RemoveRecursive(const std::string& key);
    std::vector<std::string> ChildrenOf(const std::string& key) const;

    std::unordered_map<std::string, FocusNode> nodes_;
    // Insertion order. Ties in navigation resolve to the earliest node, as the
    // web library does.
    std::vector<std::string> order_;
    std::optional<std::string> focused_;
};

}  // namespace tvm::nav
