// View stack tests, ported from packages/nav/src/viewStack.test.ts. Each case
// keeps the web test's name and expectation.

#include <initializer_list>
#include <string>
#include <vector>

#include "harness.h"
#include "nav/view_stack.h"

namespace {

using tvm::nav::ActiveEntry;
using tvm::nav::CanGoBack;
using tvm::nav::CreateViewStack;
using tvm::nav::FocusToRestore;
using tvm::nav::IsModalOpen;
using tvm::nav::OpenModals;
using tvm::nav::PushOptions;
using tvm::nav::Reduce;
using tvm::nav::ViewKind;
using tvm::nav::ViewStackAction;
using tvm::nav::ViewStackState;
using tvm::nav::VisibleScreen;

ViewStackState Run(ViewStackState state, std::initializer_list<ViewStackAction> actions) {
    for (const ViewStackAction& action : actions) state = Reduce(state, action);
    return state;
}

ViewStackState Home() {
    return CreateViewStack("home");
}

std::vector<std::string> Names(const ViewStackState& state) {
    std::vector<std::string> names;
    for (const auto& entry : state.entries) names.push_back(entry.name);
    return names;
}

std::vector<std::string> ModalNames(const ViewStackState& state) {
    std::vector<std::string> names;
    for (const auto& entry : OpenModals(state)) names.push_back(entry.name);
    return names;
}

PushOptions Transient() {
    PushOptions options;
    options.transient = true;
    return options;
}

PushOptions WithParam(const std::string& key, const std::string& value) {
    PushOptions options;
    options.params[key] = value;
    return options;
}

// ------------------------------------------------------------ the root

TEST(view_stack_starts_at_the_root) {
    const ViewStackState state = Home();
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
    REQUIRE(!CanGoBack(state));
}

TEST(view_stack_refuses_to_pop_the_last_entry) {
    const ViewStackState state =
        Run(Home(), {tvm::nav::Pop(), tvm::nav::Pop(), tvm::nav::Pop()});
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
    REQUIRE(ActiveEntry(state).name == "home");
}

TEST(view_stack_keeps_the_root_when_replace_is_called_there) {
    const ViewStackState state = Run(Home(), {tvm::nav::Replace("setup")});
    REQUIRE(Names(state) == std::vector<std::string>{"setup"});
    REQUIRE_EQ(state.entries.size(), std::size_t{1});
}

TEST(view_stack_never_empties_from_any_sequence) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("library"),
        tvm::nav::PushModal("confirm"),
        tvm::nav::Pop(),
        tvm::nav::Pop(),
        tvm::nav::Pop(),
        tvm::nav::Home(),
        tvm::nav::Pop(),
    });
    REQUIRE(!state.entries.empty());
}

// ------------------------------------------------------ navigating screens

TEST(view_stack_pushes_and_pops_in_order) {
    ViewStackState state = Run(Home(), {tvm::nav::Push("library"), tvm::nav::Push("details")});
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "library", "details"}));

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "library"}));
    REQUIRE(CanGoBack(state));
}

TEST(view_stack_gives_every_push_a_distinct_key) {
    const ViewStackState state = Run(Home(), {tvm::nav::Push("details"), tvm::nav::Push("details")});
    REQUIRE(state.entries[1].key != state.entries[2].key);
}

TEST(view_stack_carries_params) {
    const ViewStackState state = Run(Home(), {tvm::nav::Push("details", WithParam("id", "local:42"))});
    REQUIRE(ActiveEntry(state).params.at("id") == "local:42");
    REQUIRE_EQ(ActiveEntry(state).params.size(), std::size_t{1});
}

TEST(view_stack_replace_swaps_the_top_without_growing) {
    const ViewStackState state = Run(Home(), {tvm::nav::Push("library"), tvm::nav::Replace("search")});
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "search"}));
}

TEST(view_stack_home_wipes_back_to_the_root) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("library"),
        tvm::nav::Push("details"),
        tvm::nav::PushModal("confirm"),
        tvm::nav::Home(),
    });
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
    REQUIRE(!IsModalOpen(state));
}

TEST(view_stack_reset_replaces_everything) {
    const ViewStackState state = Run(Home(), {tvm::nav::Push("library"), tvm::nav::Reset("recovery")});
    REQUIRE(Names(state) == std::vector<std::string>{"recovery"});
    REQUIRE(!CanGoBack(state));
}

// ------------------------------------------- modals close before the page

TEST(view_stack_back_closes_the_modal_and_leaves_the_screen) {
    ViewStackState state = Run(Home(), {tvm::nav::Push("details"), tvm::nav::PushModal("confirm")});
    REQUIRE(IsModalOpen(state));
    REQUIRE(VisibleScreen(state).name == "details");

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(!IsModalOpen(state));
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "details"}));
}

TEST(view_stack_unwinds_nested_modals_one_at_a_time) {
    ViewStackState state = Run(Home(), {
        tvm::nav::Push("settings"),
        tvm::nav::PushModal("accounts"),
        tvm::nav::PushModal("confirmRemove"),
    });
    REQUIRE(ModalNames(state) == (std::vector<std::string>{"accounts", "confirmRemove"}));

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(ModalNames(state) == std::vector<std::string>{"accounts"});

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(ModalNames(state).empty());
    REQUIRE(ActiveEntry(state).name == "settings");
}

TEST(view_stack_renders_the_screen_beneath_an_open_modal) {
    const ViewStackState state = Run(Home(), {tvm::nav::Push("details"), tvm::nav::PushModal("confirm")});
    REQUIRE(VisibleScreen(state).name == "details");
    REQUIRE(ActiveEntry(state).name == "confirm");
    REQUIRE(ActiveEntry(state).kind == ViewKind::Modal);
}

TEST(view_stack_never_strands_a_modal_under_a_new_screen) {
    const ViewStackState state = Run(Home(), {tvm::nav::PushModal("confirm"), tvm::nav::Push("library")});
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "library"}));
    REQUIRE(!IsModalOpen(state));
}

TEST(view_stack_drops_the_modal_when_replacing_the_screen_under_it) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("details"),
        tvm::nav::PushModal("confirm"),
        tvm::nav::Replace("search"),
    });
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "search"}));
}

// --------------------------------------------------------- transient entries

TEST(view_stack_drops_the_preview_a_player_was_launched_from) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("preview", Transient()),
        tvm::nav::Push("player"),
        tvm::nav::Pop(),
    });
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
}

TEST(view_stack_keeps_a_deliberate_screen_underneath_the_player) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("details"),
        tvm::nav::Push("player"),
        tvm::nav::Pop(),
    });
    REQUIRE(Names(state) == (std::vector<std::string>{"home", "details"}));
}

TEST(view_stack_collapses_a_run_of_transient_entries_at_once) {
    const ViewStackState state = Run(Home(), {
        tvm::nav::Push("rail", Transient()),
        tvm::nav::Push("preview", Transient()),
        tvm::nav::Push("player"),
        tvm::nav::Pop(),
    });
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
}

TEST(view_stack_will_not_eat_the_root_even_if_the_root_is_transient) {
    PushOptions options;
    options.transient = true;
    const ViewStackState state = Run(CreateViewStack("home", options), {
        tvm::nav::Push("player"),
        tvm::nav::Pop(),
    });
    REQUIRE(Names(state) == std::vector<std::string>{"home"});
}

// ------------------------------------------------------------- focus memory

TEST(view_stack_restores_focus_to_where_the_user_left_a_screen) {
    ViewStackState state = Run(Home(), {tvm::nav::RememberFocus("rail-continue-3")});
    state = Run(state, {tvm::nav::Push("details")});
    REQUIRE(!FocusToRestore(state).has_value());

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(FocusToRestore(state) == std::optional<std::string>("rail-continue-3"));
}

TEST(view_stack_remembers_focus_per_entry_not_globally) {
    ViewStackState state = Run(Home(), {tvm::nav::RememberFocus("home-hero")});
    state = Run(state, {tvm::nav::Push("library"), tvm::nav::RememberFocus("library-item-9"),
                        tvm::nav::Push("details")});

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(FocusToRestore(state) == std::optional<std::string>("library-item-9"));

    state = Run(state, {tvm::nav::Pop()});
    REQUIRE(FocusToRestore(state) == std::optional<std::string>("home-hero"));
}

TEST(view_stack_restores_the_screen_focus_after_a_modal_closes) {
    ViewStackState state = Run(Home(), {tvm::nav::Push("settings"), tvm::nav::RememberFocus("settings-audio")});
    state = Run(state, {tvm::nav::PushModal("confirm"), tvm::nav::Pop()});
    REQUIRE(FocusToRestore(state) == std::optional<std::string>("settings-audio"));
}

TEST(view_stack_focus_survives_returning_home) {
    ViewStackState state = Run(Home(), {tvm::nav::RememberFocus("home-hero"), tvm::nav::Push("library")});
    state = Run(state, {tvm::nav::Home()});
    REQUIRE(FocusToRestore(state) == std::optional<std::string>("home-hero"));
}

// ------------------------------------------------------------ the reducer

TEST(view_stack_reducer_does_not_mutate_its_input) {
    const ViewStackState before = Run(Home(), {tvm::nav::Push("library")});
    const ViewStackState snapshot = before;

    (void)Run(before, {tvm::nav::Push("details"), tvm::nav::Pop(), tvm::nav::RememberFocus("x")});

    REQUIRE(before == snapshot);
}

TEST(view_stack_returns_the_same_state_when_back_does_nothing) {
    const ViewStackState state = Home();
    REQUIRE(Reduce(state, tvm::nav::Pop()) == state);
}

}  // namespace
