#pragma once

// The animated background of the old app's scene: six layers of radial gradients that drift against each
// other over the window, as apps/ui/src/theme/scene.css draws them. Each layer moves, scales and fades on
// its own keyframes, and the layers sit in a box inset 12% beyond the window, as `.tvm-scene__css` does.
//
// The stage is not shown by any screen today. The old page backgrounds in the light and dark themes are
// opaque, and they outrank the transparent backgrounds that scene.css gives them, so the old app does not
// show the stage either. A screen that wants the stage declares it with ScreenBase::ShowsStage.
//
// Blend modes are approximated by normal blending: screen by normal blending at these low opacities, and
// soft-light by half its layer strength. The grain layer is left out: it is an overlay on a dark ground,
// where it changes the colour by less than one level.

#include "motion/preferences.h"
#include "ui/painter.h"

namespace tvm::ui {

class Stage {
public:
    explicit Stage(motion::MotionSettings motion = {});

    void SetMotion(const motion::MotionSettings& settings) { motion_ = settings; }

    // Whether the stage is drawn at all. Performance mode hides it, as `.tvm-scene` is display none there.
    bool Shown() const;
    // Whether the layers are moving. They stand still when motion is reduced.
    bool Moving() const;

    // Paints the layers over the window at `clockMs`, the time since the app started.
    void Paint(Painter& painter, double width, double height, double clockMs) const;

private:
    motion::MotionSettings motion_;
};

}  // namespace tvm::ui
