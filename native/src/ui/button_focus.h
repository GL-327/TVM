#pragma once

// The eased focus of a screen's buttons. Focus scales a button over the fast motion token, as the
// web buttons' transform transition does. A screen passes its focused key to Track on every frame,
// and reads each button's amount while it paints.

#include <map>
#include <string>

#include "motion/preferences.h"
#include "motion/tween.h"

namespace tvm::ui {

// One button's focus. It eases between unfocused (0) and focused (1).
class ButtonFocus {
public:
    // Eases toward focused or unfocused, from wherever the button is at `nowMs`.
    void Ease(bool focused, double nowMs, double durationMs);
    double Amount(double nowMs) const;
    bool Animating(double nowMs) const;

private:
    motion::Tween tween_;
};

// The focus of every button on a screen, by key.
class ButtonFocusSet {
public:
    // Moves the focus to `focused` when it has changed. The button that lost it eases out, and the
    // one that gained it eases in, over the fast motion token. The first focus is set at once, as
    // a button focused on entry does not animate.
    void Track(const std::string& focused, double nowMs, const motion::MotionSettings& settings);
    double Amount(const std::string& key, double nowMs) const;
    bool Animating(double nowMs) const;

private:
    std::string tracked_;
    std::map<std::string, ButtonFocus> buttons_;
};

}  // namespace tvm::ui
