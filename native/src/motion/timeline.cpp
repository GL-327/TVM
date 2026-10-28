#include "motion/timeline.h"

#include <algorithm>
#include <utility>

namespace tvm::motion {

Timeline::Id Timeline::Add(Update update) {
    const Id id = nextId_++;
    animations_.push_back(Entry{id, std::move(update)});
    return id;
}

void Timeline::Remove(Id id) {
    std::erase_if(animations_, [id](const Entry& entry) { return entry.id == id; });
}

double Timeline::Clock(double nowMs) const {
    // While paused the clock stands still at the moment it was paused.
    const double reference = paused_ ? pausedSinceMs_ : nowMs;
    return reference - pausedTotalMs_;
}

void Timeline::SetPaused(bool paused, double nowMs) {
    if (paused == paused_) return;
    if (paused) {
        pausedSinceMs_ = nowMs;
    } else {
        pausedTotalMs_ += nowMs - pausedSinceMs_;
    }
    paused_ = paused;
}

void Timeline::Advance(double nowMs) {
    const double clock = Clock(nowMs);

    // Iterate over a copy: an update may add or remove animations.
    const std::vector<Entry> frame = animations_;
    for (const Entry& entry : frame) {
        const bool finished = entry.update(clock);
        if (finished) Remove(entry.id);
    }
}

}  // namespace tvm::motion
