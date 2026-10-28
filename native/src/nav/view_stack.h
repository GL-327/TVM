#pragma once

// The view stack: the single source of truth for where the user is. Ported
// from packages/nav/src/viewStack.ts with the same rules. Two promises:
//
//   1. Back never dead-ends. The root is permanent, and the stack can never
//      empty itself into a blank screen.
//   2. Focus is never lost. Each entry remembers where focus was, so returning
//      to a screen puts the highlight back where the user left it.
//
// The reducer is pure: it returns a new state and never changes its input.

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace tvm::nav {

enum class ViewKind {
    Screen,
    Modal,
};

struct ViewEntry {
    // Unique per push, so the same screen can stack and keep its own focus.
    std::string key;
    std::string name;
    // Parameters are text. The web version took any JSON value; every param a
    // screen needs fits in a string.
    std::map<std::string, std::string> params;
    ViewKind kind = ViewKind::Screen;
    // Transient entries exist only to support what sits above them. They are
    // dropped when the entry above them pops, so Back does not walk the user
    // back through scaffolding.
    bool transient = false;
    // Focus to restore when this entry is the top again.
    std::optional<std::string> focusKey;

    bool operator==(const ViewEntry&) const = default;
};

struct ViewStackState {
    std::vector<ViewEntry> entries;
    std::uint64_t nextKey = 1;

    bool operator==(const ViewStackState&) const = default;
};

struct PushOptions {
    std::map<std::string, std::string> params;
    bool transient = false;
};

enum class ViewStackActionType {
    Push,
    PushModal,
    Replace,
    Pop,
    Home,
    Reset,
    RememberFocus,
};

struct ViewStackAction {
    ViewStackActionType type;
    std::string name;
    PushOptions options;
    std::optional<std::string> focusKey;
};

// Action constructors, mirroring the `viewStack` object in the web code.
ViewStackAction Push(std::string name, PushOptions options = {});
ViewStackAction PushModal(std::string name, PushOptions options = {});
ViewStackAction Replace(std::string name, PushOptions options = {});
ViewStackAction Pop();
ViewStackAction Home();
ViewStackAction Reset(std::string name, PushOptions options = {});
ViewStackAction RememberFocus(std::optional<std::string> focusKey);

ViewStackState CreateViewStack(std::string rootName, PushOptions options = {});

// The entry the user is interacting with: a modal if one is open, else the screen.
const ViewEntry& ActiveEntry(const ViewStackState& state);

// The screen to draw beneath any modals.
const ViewEntry& VisibleScreen(const ViewStackState& state);

// Modals stacked above the visible screen, in the order they were opened.
std::vector<ViewEntry> OpenModals(const ViewStackState& state);

bool IsModalOpen(const ViewStackState& state);

// False only at the root. The UI must still answer Back there, with an exit
// confirmation or with nothing, rather than seem dead.
bool CanGoBack(const ViewStackState& state);

// Focus to apply after a transition, or nothing to use the screen's default.
std::optional<std::string> FocusToRestore(const ViewStackState& state);

ViewStackState Reduce(const ViewStackState& state, const ViewStackAction& action);

}  // namespace tvm::nav
