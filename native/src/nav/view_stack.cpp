#include "nav/view_stack.h"

#include <cstddef>
#include <utility>

namespace tvm::nav {

namespace {

ViewEntry MakeEntry(std::uint64_t key, std::string name, ViewKind kind, const PushOptions& options) {
    ViewEntry entry;
    entry.key = name + "#" + std::to_string(key);
    entry.name = std::move(name);
    entry.params = options.params;
    entry.kind = kind;
    entry.transient = options.transient;
    return entry;
}

std::vector<ViewEntry> DropTrailingModals(const std::vector<ViewEntry>& entries) {
    std::size_t end = entries.size();
    while (end > 1 && entries[end - 1].kind == ViewKind::Modal) --end;
    return std::vector<ViewEntry>(entries.begin(), entries.begin() + static_cast<std::ptrdiff_t>(end));
}

}  // namespace

ViewStackAction Push(std::string name, PushOptions options) {
    return ViewStackAction{ViewStackActionType::Push, std::move(name), std::move(options), std::nullopt};
}

ViewStackAction PushModal(std::string name, PushOptions options) {
    return ViewStackAction{ViewStackActionType::PushModal, std::move(name), std::move(options), std::nullopt};
}

ViewStackAction Replace(std::string name, PushOptions options) {
    return ViewStackAction{ViewStackActionType::Replace, std::move(name), std::move(options), std::nullopt};
}

ViewStackAction Pop() {
    return ViewStackAction{ViewStackActionType::Pop, {}, {}, std::nullopt};
}

ViewStackAction Home() {
    return ViewStackAction{ViewStackActionType::Home, {}, {}, std::nullopt};
}

ViewStackAction Reset(std::string name, PushOptions options) {
    return ViewStackAction{ViewStackActionType::Reset, std::move(name), std::move(options), std::nullopt};
}

ViewStackAction RememberFocus(std::optional<std::string> focusKey) {
    return ViewStackAction{ViewStackActionType::RememberFocus, {}, {}, std::move(focusKey)};
}

ViewStackState CreateViewStack(std::string rootName, PushOptions options) {
    ViewStackState state;
    state.entries.push_back(MakeEntry(0, std::move(rootName), ViewKind::Screen, options));
    state.nextKey = 1;
    return state;
}

const ViewEntry& ActiveEntry(const ViewStackState& state) {
    // The root guarantees the stack is never empty.
    return state.entries.back();
}

const ViewEntry& VisibleScreen(const ViewStackState& state) {
    for (auto it = state.entries.rbegin(); it != state.entries.rend(); ++it) {
        if (it->kind == ViewKind::Screen) return *it;
    }
    return state.entries.front();
}

std::vector<ViewEntry> OpenModals(const ViewStackState& state) {
    const ViewEntry& screen = VisibleScreen(state);
    std::size_t index = 0;
    for (std::size_t i = 0; i < state.entries.size(); ++i) {
        if (&state.entries[i] == &screen) {
            index = i;
            break;
        }
    }
    return std::vector<ViewEntry>(state.entries.begin() + static_cast<std::ptrdiff_t>(index) + 1,
                                  state.entries.end());
}

bool IsModalOpen(const ViewStackState& state) {
    return ActiveEntry(state).kind == ViewKind::Modal;
}

bool CanGoBack(const ViewStackState& state) {
    return state.entries.size() > 1;
}

std::optional<std::string> FocusToRestore(const ViewStackState& state) {
    return ActiveEntry(state).focusKey;
}

ViewStackState Reduce(const ViewStackState& state, const ViewStackAction& action) {
    switch (action.type) {
    case ViewStackActionType::RememberFocus: {
        ViewStackState next = state;
        if (!next.entries.empty()) next.entries.back().focusKey = action.focusKey;
        return next;
    }

    case ViewStackActionType::Push: {
        // Navigating to a screen ends the modal conversation that was on top of
        // the old one. A modal is never stranded underneath.
        ViewStackState next;
        next.entries = DropTrailingModals(state.entries);
        next.entries.push_back(MakeEntry(state.nextKey, action.name, ViewKind::Screen, action.options));
        next.nextKey = state.nextKey + 1;
        return next;
    }

    case ViewStackActionType::PushModal: {
        ViewStackState next = state;
        next.entries.push_back(MakeEntry(state.nextKey, action.name, ViewKind::Modal, action.options));
        next.nextKey = state.nextKey + 1;
        return next;
    }

    case ViewStackActionType::Replace: {
        ViewStackState next;
        std::vector<ViewEntry> base = DropTrailingModals(state.entries);
        if (base.size() > 1) base.pop_back();
        else base.clear();
        next.entries = std::move(base);
        next.entries.push_back(MakeEntry(state.nextKey, action.name, ViewKind::Screen, action.options));
        next.nextKey = state.nextKey + 1;
        return next;
    }

    case ViewStackActionType::Pop: {
        // The root is permanent. Back at the root is for the UI to answer.
        if (state.entries.size() <= 1) return state;

        ViewStackState next = state;
        next.entries.pop_back();
        // Scaffolding that only existed to support what just closed goes too.
        while (next.entries.size() > 1 && next.entries.back().transient) next.entries.pop_back();
        return next;
    }

    case ViewStackActionType::Home: {
        // Home keeps the root's remembered focus. Returning to the row you were
        // last on is what a television is expected to do.
        ViewStackState next = state;
        next.entries.resize(1);
        return next;
    }

    case ViewStackActionType::Reset: {
        ViewStackState next;
        next.entries.push_back(MakeEntry(state.nextKey, action.name, ViewKind::Screen, action.options));
        next.nextKey = state.nextKey + 1;
        return next;
    }
    }
    return state;
}

}  // namespace tvm::nav
