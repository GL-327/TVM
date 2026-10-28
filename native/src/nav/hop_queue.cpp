#include "nav/hop_queue.h"

#include <algorithm>

namespace tvm::nav {

bool AcceptHeldHop(bool repeat, double nowMs, double lastHopMs, double intervalMs) {
    if (!repeat) return true;
    return nowMs - lastHopMs >= intervalMs;
}

AxisHopQueue::AxisHopQueue(int maxPending) : maxPending_(std::max(1, maxPending)) {}

void AxisHopQueue::Push(Direction direction) {
    // Changing direction discards hops queued for the old one.
    if (direction_.has_value() && *direction_ != direction) pending_ = 0;
    direction_ = direction;
    pending_ = std::min(pending_ + 1, maxPending_);
}

std::optional<Direction> AxisHopQueue::Tick() {
    if (!direction_.has_value() || pending_ < 1) {
        pending_ = 0;
        direction_.reset();
        return std::nullopt;
    }

    const Direction hop = *direction_;
    pending_ -= 1;
    if (pending_ == 0) direction_.reset();
    return hop;
}

void AxisHopQueue::Reset() {
    pending_ = 0;
    direction_.reset();
}

}  // namespace tvm::nav
