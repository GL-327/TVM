#pragma once

// Default behaviour for a screen that does not use every input: nothing to
// focus, nothing to scroll, nothing animating. A screen overrides what it needs.

#include "ui/screen.h"

namespace tvm::ui {

class ScreenBase : public Screen {
public:
    bool Tick(double /*nowMs*/) override { return false; }
    bool Animating() const override { return false; }

    bool Navigate(nav::Direction /*direction*/, double /*nowMs*/) override { return false; }
    std::optional<Command> Select(double /*nowMs*/) override { return std::nullopt; }
    std::optional<std::string> FocusedKey() const override { return std::nullopt; }
    bool FocusItem(const std::string& /*key*/, double /*nowMs*/, bool /*withCamera*/) override { return false; }

    std::optional<std::string> ItemAt(double /*x*/, double /*y*/) const override { return std::nullopt; }
    std::optional<Command> ActivateItem(const std::string& /*key*/, double /*nowMs*/) override {
        return std::nullopt;
    }
    std::optional<ScrollSurface> SurfaceAt(double /*x*/, double /*y*/, nav::Axis /*axis*/) const override {
        return std::nullopt;
    }
    void SetScroll(const ScrollSurface& /*surface*/, double /*value*/, double /*nowMs*/) override {}
    void AnimateScroll(const ScrollSurface& /*surface*/, double /*target*/, double /*nowMs*/) override {}
    void SetMotion(const motion::MotionSettings& settings) override { motion_ = settings; }

protected:
    motion::MotionSettings motion_;
};

}  // namespace tvm::ui
