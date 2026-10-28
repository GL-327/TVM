// Navigation tests: remote intents, hop pacing, the focus engine, wrap and
// loop rules, and camera targets. The focus-engine and camera vectors are
// generated from the web UI's own code by tests/fixtures/generate-nav-vectors.cjs.

#include <fstream>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "harness.h"
#include "nav/focus_tree.h"
#include "nav/hop_queue.h"
#include "nav/intents.h"
#include "nav/wrap.h"
#include "motion/camera.h"

namespace {

using tvm::nav::AxisHopQueue;
using tvm::nav::Direction;
using tvm::nav::FocusNode;
using tvm::nav::FocusTree;
using tvm::nav::Intent;
using tvm::nav::KeyInput;
using tvm::nav::Rect;
using tvm::nav::WrapAxis;

Rect R(double left, double top, double right, double bottom) {
    return Rect{left, top, right, bottom};
}

FocusNode Leaf(const std::string& key, const std::string& parent, Rect rect) {
    FocusNode node;
    node.key = key;
    node.parent = parent;
    node.rect = rect;
    return node;
}

FocusNode Container(const std::string& key, const std::string& parent, Rect rect) {
    FocusNode node = Leaf(key, parent, rect);
    node.container = true;
    return node;
}

// ------------------------------------------------------------------ intents

TEST(intents_map_the_dpad_and_select) {
    REQUIRE(tvm::nav::IntentFromKey({0x26}) == Intent::Up);
    REQUIRE(tvm::nav::IntentFromKey({0x28}) == Intent::Down);
    REQUIRE(tvm::nav::IntentFromKey({0x25}) == Intent::Left);
    REQUIRE(tvm::nav::IntentFromKey({0x27}) == Intent::Right);
    REQUIRE(tvm::nav::IntentFromKey({0x0D}) == Intent::Select);
    REQUIRE(tvm::nav::IntentFromKey({0x20}) == Intent::Select);
}

TEST(intents_map_back_home_and_media_keys) {
    REQUIRE(tvm::nav::IntentFromKey({0x1B}) == Intent::Back);
    REQUIRE(tvm::nav::IntentFromKey({0x08}) == Intent::Back);
    REQUIRE(tvm::nav::IntentFromKey({0xA6}) == Intent::Back);
    REQUIRE(tvm::nav::IntentFromKey({0x24}) == Intent::Home);
    REQUIRE(tvm::nav::IntentFromKey({0xB3}) == Intent::PlayPause);
    REQUIRE(tvm::nav::IntentFromKey({0xB0}) == Intent::Next);
    REQUIRE(tvm::nav::IntentFromKey({0xB1}) == Intent::Previous);
    REQUIRE(tvm::nav::IntentFromKey({0xAF}) == Intent::VolumeUp);
    REQUIRE(tvm::nav::IntentFromKey({0xAD}) == Intent::Mute);
}

TEST(intents_ignore_unknown_keys_and_modified_keys) {
    REQUIRE(!tvm::nav::IntentFromKey({0x51}).has_value());  // Q
    REQUIRE(!tvm::nav::IntentFromKey({0x74}).has_value());  // F5
    REQUIRE(!tvm::nav::IntentFromKey({0x26, true, false, false}).has_value());  // Ctrl+Up
    REQUIRE(!tvm::nav::IntentFromKey({0x0D, false, true, false}).has_value());  // Alt+Enter
    REQUIRE(tvm::nav::IsDirectional(Intent::Left));
    REQUIRE(!tvm::nav::IsDirectional(Intent::Select));
}

// --------------------------------------------------------------- hop pacing

TEST(held_hops_are_paced_and_discrete_presses_are_not) {
    REQUIRE(tvm::nav::AcceptHeldHop(false, 10.0, 9.0));
    REQUIRE(!tvm::nav::AcceptHeldHop(true, 100.0, 0.0));
    REQUIRE(tvm::nav::AcceptHeldHop(true, 105.0, 0.0));
}

TEST(hop_queue_runs_one_hop_per_tick) {
    AxisHopQueue queue;
    queue.Push(Direction::Right);
    queue.Push(Direction::Right);  // Pending is capped at one.
    REQUIRE(queue.Tick() == std::optional<Direction>(Direction::Right));
    REQUIRE(!queue.Tick().has_value());
}

TEST(hop_queue_drops_hops_for_an_old_direction) {
    AxisHopQueue queue;
    queue.Push(Direction::Right);
    queue.Push(Direction::Left);
    REQUIRE(queue.Tick() == std::optional<Direction>(Direction::Left));
}

// --------------------------------------------------------------- focus tree

TEST(focus_moves_between_neighbours_in_a_grid) {
    FocusTree tree;
    tree.Upsert(Leaf("a", "", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("b", "", R(110, 0, 210, 50)));
    tree.Upsert(Leaf("c", "", R(0, 60, 100, 110)));
    tree.Upsert(Leaf("d", "", R(110, 60, 210, 110)));
    REQUIRE(tree.SetFocus("a"));

    REQUIRE(tree.Navigate(Direction::Right));
    REQUIRE(tree.Focused() == std::optional<std::string>("b"));
    REQUIRE(tree.Navigate(Direction::Down));
    REQUIRE(tree.Focused() == std::optional<std::string>("d"));
    REQUIRE(tree.Navigate(Direction::Left));
    REQUIRE(tree.Focused() == std::optional<std::string>("c"));
    REQUIRE(tree.Navigate(Direction::Up));
    REQUIRE(tree.Focused() == std::optional<std::string>("a"));
}

TEST(focus_stays_put_at_the_edge) {
    FocusTree tree;
    tree.Upsert(Leaf("a", "", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("b", "", R(110, 0, 210, 50)));
    REQUIRE(tree.SetFocus("a"));
    REQUIRE(!tree.Navigate(Direction::Left));
    REQUIRE(tree.Focused() == std::optional<std::string>("a"));
}

TEST(focus_prefers_the_same_row_over_a_nearer_diagonal) {
    FocusTree tree;
    tree.Upsert(Leaf("current", "", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("diagonal", "", R(110, 60, 210, 110)));
    tree.Upsert(Leaf("sameRow", "", R(140, 0, 240, 50)));
    REQUIRE(tree.SetFocus("current"));
    REQUIRE(tree.Navigate(Direction::Right));
    REQUIRE(tree.Focused() == std::optional<std::string>("sameRow"));
}

TEST(focus_climbs_out_of_a_container_and_remembers_the_child) {
    FocusTree tree;
    tree.Upsert(Container("row1", "", R(0, 0, 300, 50)));
    tree.Upsert(Leaf("x1", "row1", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("x2", "row1", R(110, 0, 210, 50)));
    tree.Upsert(Container("row2", "", R(0, 200, 300, 250)));
    tree.Upsert(Leaf("y1", "row2", R(0, 200, 100, 250)));

    REQUIRE(tree.SetFocus("x2"));
    REQUIRE(tree.Navigate(Direction::Down));
    REQUIRE(tree.Focused() == std::optional<std::string>("y1"));

    // Going back up lands on the child that held focus last, not the nearest one.
    REQUIRE(tree.Navigate(Direction::Up));
    REQUIRE(tree.Focused() == std::optional<std::string>("x2"));
}

TEST(setting_focus_on_a_container_picks_the_nearest_leaf) {
    FocusTree tree;
    // The container's centre is x=200. "left" is 150 away and "right" is 165 away.
    tree.Upsert(Container("row", "", R(0, 0, 400, 50)));
    tree.Upsert(Leaf("left", "row", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("right", "row", R(330, 0, 400, 50)));
    REQUIRE(tree.SetFocus("row"));
    REQUIRE(tree.Focused() == std::optional<std::string>("left"));
}

TEST(a_boundary_keeps_focus_inside_for_its_directions) {
    FocusTree tree;
    tree.Upsert(Container("row1", "", R(0, 0, 300, 50)));
    tree.Upsert(Leaf("x1", "row1", R(0, 0, 100, 50)));
    tree.Upsert(Leaf("x2", "row1", R(110, 0, 210, 50)));
    tree.Upsert(Container("row2", "", R(0, 200, 300, 250)));
    tree.Upsert(Leaf("y1", "row2", R(0, 200, 100, 250)));

    FocusNode boundary = Container("row1", "", R(0, 0, 300, 50));
    boundary.boundary = true;
    boundary.boundaryDirections = std::vector<Direction>{Direction::Down};
    tree.Upsert(boundary);

    REQUIRE(tree.SetFocus("x1"));
    REQUIRE(!tree.Navigate(Direction::Down));  // Held inside the boundary.
    REQUIRE(tree.Focused() == std::optional<std::string>("x1"));
}

TEST(unfocusable_leaves_are_skipped) {
    FocusTree tree;
    tree.Upsert(Leaf("a", "", R(0, 0, 100, 50)));
    FocusNode disabled = Leaf("b", "", R(110, 0, 210, 50));
    disabled.focusable = false;
    tree.Upsert(disabled);
    tree.Upsert(Leaf("c", "", R(220, 0, 320, 50)));
    REQUIRE(tree.SetFocus("a"));
    REQUIRE(tree.Navigate(Direction::Right));
    REQUIRE(tree.Focused() == std::optional<std::string>("c"));
}

TEST(removing_the_focused_subtree_clears_focus) {
    FocusTree tree;
    tree.Upsert(Container("row", "", R(0, 0, 300, 50)));
    tree.Upsert(Leaf("x", "row", R(0, 0, 100, 50)));
    REQUIRE(tree.SetFocus("x"));
    tree.Remove("row");
    REQUIRE(!tree.Focused().has_value());
    REQUIRE(!tree.Contains("x"));
}

// -------------------------------------------------------------- wrap rules

TEST(row_wrap_loops_at_both_ends) {
    REQUIRE(tvm::nav::RowWrapIndex(2, Direction::Right, 3) == std::optional<int>(0));
    REQUIRE(tvm::nav::RowWrapIndex(0, Direction::Left, 3) == std::optional<int>(2));
    REQUIRE(tvm::nav::RowWrapIndex(1, Direction::Right, 3) == std::optional<int>(2));
    REQUIRE(!tvm::nav::RowWrapIndex(5, Direction::Right, 3).has_value());
    REQUIRE(!tvm::nav::RowWrapIndex(0, Direction::Up, 3).has_value());
}

TEST(neighbour_rows_stop_at_the_ends) {
    REQUIRE(!tvm::nav::NeighborRowIndex(0, Direction::Up, 4).has_value());
    REQUIRE(!tvm::nav::NeighborRowIndex(3, Direction::Down, 4).has_value());
    REQUIRE(tvm::nav::NeighborRowIndex(1, Direction::Down, 4) == std::optional<int>(2));
}

TEST(grid_wrap_stays_on_the_row_and_wraps_down_to_the_top) {
    // Three columns, seven items:
    //   0 1 2
    //   3 4 5
    //   6
    REQUIRE(tvm::nav::WrapGridIndex(Direction::Right, 2, 7, 3) == std::optional<int>(0));
    REQUIRE(tvm::nav::WrapGridIndex(Direction::Left, 0, 7, 3) == std::optional<int>(2));
    REQUIRE(tvm::nav::WrapGridIndex(Direction::Down, 6, 7, 3) == std::optional<int>(0));
    REQUIRE(tvm::nav::WrapGridIndex(Direction::Down, 4, 7, 3) == std::optional<int>(1));
    REQUIRE(!tvm::nav::WrapGridIndex(Direction::Up, 0, 7, 3).has_value());
    REQUIRE(tvm::nav::WrapGridIndex(Direction::Up, 4, 7, 3) == std::optional<int>(1));
}

TEST(conveyor_wraps_only_at_the_seam) {
    REQUIRE(tvm::nav::ConveyorWrapIndex(Direction::Right, 4, 5) == std::optional<int>(0));
    REQUIRE(tvm::nav::ConveyorWrapIndex(Direction::Left, 0, 5) == std::optional<int>(4));
    REQUIRE(!tvm::nav::ConveyorWrapIndex(Direction::Right, 2, 5).has_value());
}

TEST(group_kind_follows_the_layout) {
    REQUIRE(tvm::nav::CountColumns({0, 0, 0, 100, 100}) == 3);
    REQUIRE(tvm::nav::WrapGroupKind(3, 5) == WrapAxis::Grid);
    REQUIRE(tvm::nav::WrapGroupKind(1, 5) == WrapAxis::Y);
    REQUIRE(tvm::nav::WrapGroupKind(5, 5) == WrapAxis::X);
    REQUIRE(tvm::nav::WrapGroupKind(1, 1) == WrapAxis::X);
    REQUIRE(tvm::nav::ShouldConsumeAxis(WrapAxis::Y, Direction::Down));
    REQUIRE(!tvm::nav::ShouldConsumeAxis(WrapAxis::Y, Direction::Left));
}

TEST(rail_distance_takes_the_short_way_round) {
    REQUIRE(tvm::nav::RailHopDistance(0, 4, 5) == 1);
    REQUIRE(tvm::nav::RailHopDistance(0, 2, 5) == 2);
    REQUIRE(tvm::nav::PickClosestIndex({10, 50, 90}, 60) == 1);
}

// --------------------------------------------------------------- loop maths

TEST(loop_set_and_scroll_normalisation) {
    REQUIRE_NEAR(tvm::nav::LoopSetWidth(3000), 1000, 1e-9);
    REQUIRE_NEAR(tvm::nav::NormalizeLoopScroll(100, 1000, 400), 1100, 1e-9);
    REQUIRE_NEAR(tvm::nav::NormalizeLoopScroll(2500, 1000, 400), 1500, 1e-9);
    REQUIRE(tvm::nav::IsLoopSeamJump(0, 500, 1000));
    REQUIRE(!tvm::nav::IsLoopSeamJump(0, 400, 1000));
}

TEST(camera_parks_a_seam_jump_back_into_the_window) {
    REQUIRE_NEAR(tvm::nav::CameraXForCard(0, 500, 1000, 400), 1500, 1e-9);
    REQUIRE_NEAR(tvm::nav::CameraXForCard(100, 1900, 1000, 400), 900, 1e-9);
    REQUIRE_NEAR(tvm::nav::CameraXForCard(100, 120, 1000, 400), 120, 1e-9);
}

TEST(row_centring_and_page_pan_targets) {
    REQUIRE_NEAR(tvm::nav::CenteredRowOffset(0, 300, 100, 0, 400), 150, 1e-9);
    REQUIRE_NEAR(tvm::nav::RowCameraTop(0, 500, 100, 72), 328, 1e-9);
    REQUIRE_NEAR(tvm::nav::PagePanTarget(0, 50, 100, 72), 0, 1e-9);
    REQUIRE_NEAR(tvm::nav::ChromeReserve(60, 1920, 1080, 1920), 60, 1e-9);
    REQUIRE_NEAR(tvm::nav::ChromeReserve(1000, 200, 1080, 1920), 0, 1e-9);
    REQUIRE(!tvm::nav::ShouldNudgePageY(0, 11));
    REQUIRE(tvm::nav::ShouldNudgePageY(0, 12));
}

// --------------------------------------------- differential vectors (web UI)

std::string FixturePath() {
    return std::string(TVM_TEST_DIR) + "/fixtures/nav-vectors.json";
}

nlohmann::json LoadVectors() {
    std::ifstream in(FixturePath());
    REQUIRE(in.good());
    return nlohmann::json::parse(in);
}

Rect RectOf(const nlohmann::json& value) {
    return R(value.at("left").get<double>(), value.at("top").get<double>(), value.at("right").get<double>(),
             value.at("bottom").get<double>());
}

Direction DirectionOf(const std::string& name) {
    if (name == "up") return Direction::Up;
    if (name == "down") return Direction::Down;
    if (name == "left") return Direction::Left;
    return Direction::Right;
}

TEST(focus_matches_the_norigin_engine_on_recorded_layouts) {
    const nlohmann::json vectors = LoadVectors();
    const auto& scenarios = vectors.at("scenarios");
    REQUIRE(scenarios.size() >= 200);

    int checked = 0;
    for (const auto& scenario : scenarios) {
        FocusTree tree;
        tree.Upsert(Leaf("current", "", RectOf(scenario.at("current"))));
        const auto& siblings = scenario.at("siblings");
        for (std::size_t i = 0; i < siblings.size(); ++i) {
            tree.Upsert(Leaf("s" + std::to_string(i), "", RectOf(siblings[i])));
        }
        REQUIRE(tree.SetFocus("current"));

        const int expected = scenario.at("expected").get<int>();
        const bool moved = tree.Navigate(DirectionOf(scenario.at("direction").get<std::string>()));
        if (expected < 0) {
            REQUIRE(!moved);
        } else {
            REQUIRE(moved);
            REQUIRE(tree.Focused() == std::optional<std::string>("s" + std::to_string(expected)));
            ++checked;
        }
    }
    REQUIRE(checked >= 150);
}

TEST(camera_matches_the_web_tween_frame_for_frame) {
    const nlohmann::json vectors = LoadVectors();
    for (const auto& scenario : vectors.at("camera")) {
        const double current = scenario.at("current").get<double>();
        const double target = scenario.at("target").get<double>();
        const double max = scenario.at("max").get<double>();
        const auto& expected = scenario.at("expected");
        const auto& expectedPositions = expected.at("positions");

        tvm::motion::CameraTween tween;
        const tvm::motion::CameraStart start = tween.Begin(current, target, max, false);
        if (start == tvm::motion::CameraStart::Landed) {
            REQUIRE(expected.at("landed").get<bool>());
            REQUIRE_NEAR(tween.position(), expectedPositions.at(0).get<double>(), 1e-9);
            continue;
        }
        REQUIRE(start == tvm::motion::CameraStart::Animating);

        std::size_t index = 0;
        bool settled = false;
        for (const auto& frame : scenario.at("frames")) {
            const tvm::motion::CameraStep step = tween.Step(frame.get<double>(), false);
            REQUIRE(index < expectedPositions.size());
            REQUIRE_NEAR(step.position, expectedPositions.at(index).get<double>(), 1e-9);
            ++index;
            if (step.settled) {
                settled = true;
                break;
            }
        }
        REQUIRE_EQ(index, expectedPositions.size());
        REQUIRE_EQ(settled, expected.at("settled").get<bool>());
    }
}

TEST(camera_retargets_without_jumping) {
    tvm::motion::CameraTween tween;
    REQUIRE(tween.Begin(0, 1000, 4000, false) == tvm::motion::CameraStart::Animating);
    tween.Step(0, false);
    tween.Step(17, false);
    const double inFlight = tween.position();
    REQUIRE(tween.Begin(inFlight, 300, 4000, false) == tvm::motion::CameraStart::Animating);
    REQUIRE_NEAR(tween.position(), inFlight, 1e-9);
    REQUIRE_NEAR(tween.target(), 300, 1e-9);
}

}  // namespace
