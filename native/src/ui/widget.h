#pragma once

// The widget tree: the visual structure of a screen. Each widget measures its
// desired size, is arranged into a box, and paints itself. Layout follows the
// shape of the web UI: vertical stacks of headings and horizontal rails of
// cards, with the safe-area and spacing values from packages/design.

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ui/painter.h"

namespace tvm::ui {

// Sizes are pixels. `rem` is the design token root size, 16px at 1080p, and
// scales with the window height.
struct Metrics {
    double rem = 16.0;

    double Rem(double value) const { return value * rem; }
};

struct Size {
    double width = 0.0;
    double height = 0.0;
};

class Widget {
public:
    Widget() = default;
    virtual ~Widget() = default;

    Widget(const Widget&) = delete;
    Widget& operator=(const Widget&) = delete;

    // Desired size when laid out in `availableWidth`. Must run before Arrange.
    virtual Size Measure(double availableWidth, const Metrics& metrics) = 0;

    // Places this widget at `box`, and its children inside it.
    virtual void Arrange(const Box& box, const Metrics& metrics) = 0;

    virtual void Paint(Painter& painter, const Metrics& metrics) const = 0;

    const Box& box() const { return box_; }

protected:
    Box box_;
};

// A vertical list of children, separated by a spacing token.
class Stack : public Widget {
public:
    explicit Stack(double spacingRem) : spacingRem_(spacingRem) {}

    void Add(std::unique_ptr<Widget> child);
    const std::vector<std::unique_ptr<Widget>>& children() const { return children_; }

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    double spacingRem_;
    std::vector<std::unique_ptr<Widget>> children_;
    std::vector<Size> desired_;
};

// A horizontal row of cards that scrolls inside its own viewport. The scroll
// offset is set by the scene's camera, and Arrange clamps it to the content.
class Rail : public Widget {
public:
    Rail(double spacingRem, double insetRem) : spacingRem_(spacingRem), insetRem_(insetRem) {}

    void Add(std::unique_ptr<Widget> child);
    const std::vector<std::unique_ptr<Widget>>& children() const { return children_; }

    void SetScroll(double scrollX) { scrollX_ = scrollX; }
    double scroll() const { return scrollX_; }
    double ContentWidth() const { return contentWidth_; }
    double MaxScroll() const;
    // Left edge of a child inside the content, before scrolling.
    double ContentLeftOf(std::size_t index) const { return contentLeft_.at(index); }

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    double spacingRem_;
    double insetRem_;
    double scrollX_ = 0.0;
    double contentWidth_ = 0.0;
    std::vector<std::unique_ptr<Widget>> children_;
    std::vector<Size> desired_;
    std::vector<double> contentLeft_;
};

// One line of text in a fixed-height band.
class Heading : public Widget {
public:
    Heading(std::string text, double sizeRem) : text_(std::move(text)), sizeRem_(sizeRem) {}

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    std::string text_;
    double sizeRem_;
};

// A poster tile with a title beneath it. Focus is a 0..1 amount that the
// scene animates. It scales the poster and draws the focus ring.
class Card : public Widget {
public:
    // `itemId` is the catalogue id, which the details screen loads. `posterUrl` may be empty.
    // `progress` is the share watched, drawn as a bar along the foot of the poster.
    Card(std::string title, std::string focusKey, std::string itemId = "", std::string posterUrl = "",
         std::optional<double> progress = std::nullopt)
        : title_(std::move(title)), focusKey_(std::move(focusKey)), itemId_(std::move(itemId)),
          posterUrl_(std::move(posterUrl)), progress_(progress) {}

    const std::string& itemId() const { return itemId_; }
    const std::string& posterUrl() const { return posterUrl_; }
    std::optional<double> progress() const { return progress_; }

    const std::string& focusKey() const { return focusKey_; }
    const std::string& title() const { return title_; }

    double focusAmount() const { return focusAmount_; }
    void SetFocusAmount(double amount) { focusAmount_ = amount; }
    // Whether the card has focus. The outline follows this at once, and the scale follows the amount.
    bool focused() const { return focused_; }
    void SetFocused(bool focused) { focused_ = focused; }

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    std::string title_;
    std::string focusKey_;
    std::string itemId_;
    std::string posterUrl_;
    std::optional<double> progress_;
    double focusAmount_ = 0.0;
    bool focused_ = false;
};

// Colour tokens of the default look, the dark theme in apps/ui/src/theme/dark.css. Its
// values override the root tokens of packages/design/src/tokens.css, so they are used here.
namespace tokens {
inline constexpr Color kBackground = Rgb(0x071018);     // --tvm-bg
inline constexpr Color kSurface = Rgb(0x102238);        // --tvm-surface
inline constexpr Color kSurfaceHover = Rgb(0x163048);   // --tvm-surface-hover
inline constexpr Color kBorderSoft = Rgb(0x8CB4DC, 0.16);  // --tvm-border-soft
inline constexpr Color kText = Rgb(0xE8F0F8);           // --tvm-text
inline constexpr Color kTextMuted = Rgb(0x9BB0C8);      // --tvm-text-muted
inline constexpr Color kTextFaint = Rgb(0x6A8298);      // --tvm-text-faint
inline constexpr Color kFocusRing = Rgb(0x9EDCFF);      // --tvm-focus-ring-color
inline constexpr Color kBackgroundDeep = Rgb(0x000000);      // --tvm-bg-deep
inline constexpr Color kBackgroundElevated = Rgb(0x0C1A2C);  // --tvm-bg-elevated
inline constexpr Color kAccentStrong = Rgb(0x9EDCFF);        // --tvm-accent-strong
inline constexpr Color kAccentInk = Rgb(0x000000);           // --tvm-accent-ink
// The glass button of the hero, `.tvm-button--glass` in apps/ui/src/app.css: its fill, its
// border, and its fill when it has focus.
inline constexpr Color kGlassFill = Rgb(0x282828, 0.72);
inline constexpr Color kGlassBorder = Rgb(0xFFFFFF, 0.16);
inline constexpr Color kGlassFocus = Rgb(0xFFFFFF, 0.18);
// The primary button: `.tvm-button--primary` in apps/ui/src/app.css.
inline constexpr Color kPrimary = Rgb(0xFFFFFF);
inline constexpr Color kOnPrimary = Rgb(0x111111);
}  // namespace tokens

// Layout and motion values shared by the widgets.
inline constexpr double kFocusScale = 1.08;
inline constexpr double kFocusRingWidthRem = 0.18;
inline constexpr double kFocusRingOffsetRem = 0.14;
inline constexpr double kPosterWidthRem = 10.5;
inline constexpr double kPosterHeightRem = 15.75;
inline constexpr double kCardLabelGapRem = 0.75;
inline constexpr double kCardLabelHeightRem = 1.75;
// The button label is the body size, and it sits in the button's inline padding, as
// `.tvm-button` does (padding 0.55rem 1.2rem, font-size body, weight 680).
// A poster's own focus, from `.poster[data-focused='true'] .poster__art` in apps/ui/src/app.css:
// it grows 1.015 times from its bottom edge, lifts 0.12 rem, and has a white outline 0.16 rem
// wide, set 0.18 rem from the edge.
inline constexpr double kPosterFocusScale = 1.015;
inline constexpr double kPosterLiftRem = 0.12;
inline constexpr double kPosterRingWidthRem = 0.16;
inline constexpr double kPosterRingOffsetRem = 0.18;
inline constexpr Color kPosterRing = Rgb(0xFFFFFF);
inline constexpr double kButtonLabelRem = 1.0625;
inline constexpr double kButtonPadRem = 1.2;

// What a button looks like at a moment. `focusAmount` is the eased focus, 0 to 1: it scales the
// button, and the ring and the hover fill follow `focused` at once, as the web CSS does.
struct ButtonLook {
    bool primary = false;
    bool focused = false;
    double focusAmount = 0.0;
};

// A pill button with its label. The pill's radius is half its height, as `--tvm-radius-pill` gives.
void DrawButton(Painter& painter, const Metrics& metrics, const Box& box, const std::string& label, const ButtonLook& look);

}  // namespace tvm::ui
