#pragma once

// One D-pad hop per frame. A lagged frame used to apply every queued key at
// once, so the camera skipped titles and whole rows. Ported from
// apps/ui/src/nav/hopQueue.ts. The web version used requestAnimationFrame; the
// native version is driven by Tick(), which the frame loop calls once a frame.

#include <optional>

#include "nav/focus_tree.h"

namespace tvm::nav {

inline constexpr int kAxisHopMaxPending = 1;

// Minimum spacing between hops from a held key. Auto-repeat is far faster than
// the camera can settle. Discrete presses are never paced.
inline constexpr double kHeldHopIntervalMs = 105.0;

// True when a repeat hop may run now, given when the previous hop ran.
bool AcceptHeldHop(bool repeat, double nowMs, double lastHopMs, double intervalMs = kHeldHopIntervalMs);

class AxisHopQueue {
public:
    explicit AxisHopQueue(int maxPending = kAxisHopMaxPending);

    void Push(Direction direction);

    // Returns the single hop to apply this frame, or nothing.
    std::optional<Direction> Tick();

    void Reset();

private:
    int maxPending_;
    std::optional<Direction> direction_;
    int pending_ = 0;
};

}  // namespace tvm::nav
