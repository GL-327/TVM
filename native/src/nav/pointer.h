#pragma once

// Mouse, wheel and touch input for a UI built remote-first. Ported from the
// rules in apps/ui/src/nav/pointerInput.ts. The window layer turns Win32
// messages into these calls, and these functions decide what they mean.
//
// The cursor stays hidden until the mouse actually moves, and goes away again
// as soon as the remote is used, so the ten-foot view stays clean. Hovering
// moves focus, so a click lands on the element the remote would have
// activated. The wheel scrolls the rail or page under the pointer.

#include <cstdint>
#include <limits>
#include <optional>
#include <string>

namespace tvm::nav {

// Drag distance beyond which a press is a drag, not a tap.
inline constexpr double kTapSlop = 8.0;
// Pointer moves smaller than this on both axes are jitter, and do not count.
inline constexpr double kMoveEpsilon = 2.0;

enum class Axis {
    X,
    Y,
};

// Returns true when the press stayed inside the slop, so it is a tap.
bool TapShouldActivate(bool moved, double distance, double slop = kTapSlop);

// The axis a drag has committed to, once it has left the slop. Nothing before that.
std::optional<Axis> PanAxis(double dx, double dy, double slop = kTapSlop);

// A horizontal drag moves the rail so it follows the finger.
double DragScroll(double startScroll, double startX, double x);

// A short coast after a swipe. The finger's velocity is clamped, and the camera
// clamps the result at the edge.
double MomentumTarget(double scroll, double fingerVelocity);

// True when content overflows its viewport by more than a pixel. A sub-pixel
// difference is rounding, not overflow.
bool CanScroll(double contentSize, double viewportSize);

// A trackpad sends a horizontal delta for a sideways swipe. A mouse wheel only
// sends a vertical one, so Shift says "sideways".
bool WheelWantsRail(double deltaX, double deltaY, bool shift);

// The DOM's WheelEvent.deltaMode values.
enum class WheelMode {
    Pixel = 0,
    Line = 1,
    Page = 2,
};

// Converts a wheel delta to pixels. A line is 16px and a page is the viewport.
double WheelPixels(double delta, WheelMode mode, double viewport);

// Where a wheel notch should send the camera. It accumulates on the pending
// target, but reverses at once if the direction changes.
double WheelTarget(double current, double pending, double delta);

// The mouse cursor and hover focus. A hover fires only for a real move, and
// never while a button is held.
class MouseState {
public:
    struct MoveResult {
        // The cursor was hidden and has just been shown.
        bool cursorShown = false;
        // The move was big enough to count, and the window should hover-focus
        // the item under the pointer.
        bool counted = false;
        // A button was held, so this is a drag and must not hover.
        bool dragging = false;
    };

    MoveResult OnMove(double x, double y, bool buttonDown);
    // Any remote or keyboard press hides the cursor.
    void OnKeyPress();
    void ShowCursor();

    bool cursorVisible() const { return visible_; }

private:
    bool visible_ = false;
    double lastX_ = std::numeric_limits<double>::quiet_NaN();
    double lastY_ = std::numeric_limits<double>::quiet_NaN();
};

// A press that becomes a click only if it stays inside the slop. Focus moves on
// release, not on press: focusing on press re-renders the item under the finger
// before the click can land.
class ClickTracker {
public:
    void Press(std::uint32_t pointerId, double x, double y, std::optional<std::string> hostKey);
    void Move(std::uint32_t pointerId, double x, double y);
    // Returns the host key to activate when the press was a tap.
    std::optional<std::string> Release(std::uint32_t pointerId, double x, double y);
    void Cancel();

    bool active() const { return press_.has_value(); }

private:
    struct PressState {
        std::uint32_t pointerId;
        double x;
        double y;
        std::optional<std::string> hostKey;
        bool moved;
    };
    std::optional<PressState> press_;
};

// A finger drag. It pans a rail or the page once the drag has locked an axis.
// The first finger owns the gesture, and a second one is ignored.
class TouchGesture {
public:
    struct MoveResult {
        // The new scroll position for the locked axis, when the gesture pans.
        std::optional<double> scroll;
        Axis axis = Axis::X;
    };

    // `railScroll` and `pageScroll` are the positions at the press. A missing
    // rail or page means the drag cannot pan that way.
    void Down(std::uint32_t pointerId, double x, double y, std::optional<std::string> hostKey,
              bool railCanPan, double railScroll, bool pageCanPan, double pageScroll, double nowMs);
    MoveResult Move(std::uint32_t pointerId, double x, double y, double nowMs);

    struct ReleaseResult {
        // A momentum target for the locked axis, if the release was fast enough.
        std::optional<double> momentum;
        Axis axis = Axis::X;
        // A tap activates this item.
        std::optional<std::string> tapKey;
    };
    // `railScroll` and `pageScroll` are the positions now, for the momentum target.
    ReleaseResult Release(std::uint32_t pointerId, double x, double y, double nowMs, double railScroll,
                          double pageScroll);
    void Cancel();

    bool active() const { return touch_.has_value(); }

private:
    struct Touch {
        std::uint32_t pointerId;
        double startX;
        double startY;
        double lastX;
        double lastY;
        double lastMs;
        double velocityX = 0.0;
        double velocityY = 0.0;
        std::optional<std::string> hostKey;
        bool moved = false;
        bool railCanPan = false;
        double railStart = 0.0;
        bool pageCanPan = false;
        double pageStart = 0.0;
        std::optional<Axis> axis;
    };
    std::optional<Touch> touch_;
};

}  // namespace tvm::nav
