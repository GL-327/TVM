#pragma once

// A frame timeline that drives every running animation. Animations receive a
// clock value in milliseconds. A paused timeline holds its clock, so resuming
// continues from where it stopped instead of jumping, which matches how CSS
// animations behave when the app is hidden.

#include <cstdint>
#include <functional>
#include <vector>

namespace tvm::motion {

class Timeline {
public:
    // Called once per frame with the timeline clock. Returns true when the
    // animation has finished and should be removed.
    using Update = std::function<bool(double clockMs)>;
    using Id = std::uint64_t;

    Id Add(Update update);
    void Remove(Id id);

    // Runs every live animation for this frame. `nowMs` is the host's
    // monotonic clock.
    void Advance(double nowMs);

    // Pauses or resumes the clock. `nowMs` is the host clock at the change.
    void SetPaused(bool paused, double nowMs);

    // The timeline clock at host time `nowMs`. Tweens start from this value.
    double Clock(double nowMs) const;

    bool paused() const { return paused_; }
    std::size_t size() const { return animations_.size(); }

private:
    struct Entry {
        Id id;
        Update update;
    };

    std::vector<Entry> animations_;
    Id nextId_ = 1;
    bool paused_ = false;
    double pausedSinceMs_ = 0.0;
    double pausedTotalMs_ = 0.0;
};

}  // namespace tvm::motion
