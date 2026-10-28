#pragma once

// The screen interface. Home, Details, Settings and the placeholder screens
// all implement it, so the shell can route remote presses, mouse and touch
// input, and drawing, without knowing which screen is on top.

#include <cstddef>
#include <map>
#include <optional>
#include <string>

#include "nav/focus_tree.h"
#include "motion/preferences.h"
#include "nav/pointer.h"
#include "ui/painter.h"

namespace tvm::ui {

// Something a screen asks the shell to open, usually in reply to OK.
struct Command {
    // A modal sits on top of the screen. A screen opens on top of the stack.
    bool modal = false;
    std::string name;
    std::map<std::string, std::string> params;
    // An action does its work without opening a screen, such as saving a title. The
    // shell hands it to the app instead.
    bool action = false;
};

// A region that scrolls: a horizontal rail, or the vertical page.
struct ScrollSurface {
    enum class Kind {
        Rail,
        Page,
    };

    Kind kind = Kind::Page;
    std::size_t index = 0;
    // Where the content is now, and where it is heading. Wheel notches add onto
    // the target, so a fast spin keeps accumulating instead of re-measuring.
    double scroll = 0.0;
    double target = 0.0;
    double maxScroll = 0.0;
    double viewport = 0.0;
    bool canPan = false;

    bool operator==(const ScrollSurface&) const = default;
};

class Screen {
public:
    virtual ~Screen() = default;

    virtual void Layout(double width, double height) = 0;
    // Advances motion to host time `nowMs`. Returns true while work remains.
    virtual bool Tick(double nowMs) = 0;
    virtual bool Animating() const = 0;
    // Whether the animated stage shows behind this screen. Its page must then be transparent, so the stage
    // is painted first. No screen says so yet: the light and dark themes give every page an opaque ground,
    // as the old app does, so the stage stays hidden (see stage.h).
    virtual bool ShowsStage() const { return false; }
    virtual void Paint(Painter& painter) const = 0;

    // Remote: moves focus. Returns true when focus or the camera changed.
    virtual bool Navigate(nav::Direction direction, double nowMs) = 0;
    // Remote: OK on the focused item.
    virtual std::optional<Command> Select(double nowMs) = 0;
    virtual std::optional<std::string> FocusedKey() const = 0;
    // Focuses an item by key. With `withCamera` the layout moves to show it. A
    // hover does not move the camera.
    virtual bool FocusItem(const std::string& key, double nowMs, bool withCamera) = 0;

    // Pointer: the focusable item under a point, if any.
    virtual std::optional<std::string> ItemAt(double x, double y) const = 0;
    // Pointer: focuses an item with its camera, then selects it, as a click does.
    virtual std::optional<Command> ActivateItem(const std::string& key, double nowMs) = 0;
    // Pointer: the scroll surface under a point for a given axis.
    virtual std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const = 0;
    // Moves a surface at once, as a drag does.
    virtual void SetScroll(const ScrollSurface& surface, double value, double nowMs) = 0;
    // Eases a surface toward a target, as a wheel notch or a momentum coast does.
    virtual void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) = 0;

    // Applies a changed motion or performance setting at once.
    virtual void SetMotion(const motion::MotionSettings& settings) = 0;
};

}  // namespace tvm::ui
