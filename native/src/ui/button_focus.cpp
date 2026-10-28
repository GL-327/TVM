#include "ui/button_focus.h"

namespace tvm::ui {

void ButtonFocus::Ease(bool focused, double nowMs, double durationMs) {
    const double target = focused ? 1.0 : 0.0;
    tween_ = motion::Tween(Amount(nowMs), target, nowMs, durationMs);
}

double ButtonFocus::Amount(double nowMs) const {
    return tween_.Value(nowMs);
}

bool ButtonFocus::Animating(double nowMs) const {
    return !tween_.Done(nowMs);
}

void ButtonFocusSet::Track(const std::string& focused, double nowMs, const motion::MotionSettings& settings) {
    if (focused == tracked_) return;
    const bool first = tracked_.empty();
    const double durationMs = first ? 0.0 : motion::ResolveMotionTokens(settings).fastMs;
    if (!first) buttons_[tracked_].Ease(false, nowMs, durationMs);
    buttons_[focused].Ease(true, nowMs, durationMs);
    tracked_ = focused;
}

double ButtonFocusSet::Amount(const std::string& key, double nowMs) const {
    const auto found = buttons_.find(key);
    return found == buttons_.end() ? 0.0 : found->second.Amount(nowMs);
}

bool ButtonFocusSet::Animating(double nowMs) const {
    for (const auto& [key, button] : buttons_) {
        if (button.Animating(nowMs)) return true;
    }
    return false;
}

}  // namespace tvm::ui
