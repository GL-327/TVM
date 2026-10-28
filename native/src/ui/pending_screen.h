#pragma once

// A placeholder for a screen that is not ported to the native app yet. It says
// so on screen, rather than doing nothing, and Back still works from it.

#include <string>

#include "ui/screen_base.h"

namespace tvm::ui {

class PendingScreen final : public ScreenBase {
public:
    PendingScreen(std::string name, bool modal);

    void Layout(double width, double height) override;
    void Paint(Painter& painter) const override;

private:
    std::string name_;
    bool modal_;
    double width_ = 0.0;
    double height_ = 0.0;
};

}  // namespace tvm::ui
