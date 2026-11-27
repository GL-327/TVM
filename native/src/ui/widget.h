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
#include "ui/layout.h"
#include "ui/theme.h"

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

class Card;

// A horizontal row of cards that scrolls inside its own viewport. The scroll
// offset is set by the scene's camera, and Arrange clamps it to the content.
class Rail : public Widget {
public:
    Rail(double spacingRem, double insetRem) : spacingRem_(spacingRem), insetRem_(insetRem) {}

    void Add(std::unique_ptr<Card> child);
    const std::vector<std::unique_ptr<Card>>& children() const { return children_; }

    static constexpr double kRingOrigin = 10000000.0;
    void SetLoop(bool loop) { loop_ = loop; if (loop_) scrollX_ = kRingOrigin; }
    bool Loop() const { return loop_; }
    double Period() const;
    struct Slot {
        std::size_t index;
        std::int64_t turn;
        bool operator==(const Slot&) const = default;
    };
    std::optional<Slot> SlotAt(double x) const;
    std::optional<std::size_t> IndexAt(double x) const;
    Slot NearestSlot(std::size_t index, std::optional<double> anchor = std::nullopt) const;
    double ContentLeftOf(Slot slot) const;
    void SetFocusSlot(std::optional<Slot> slot) {
        if (focusSlot_ != slot) {
            if (focusSlot_) fadingSlot_ = focusSlot_;
            focusSlot_ = slot;
        }
    }
    void SetScroll(double scrollX) { scrollX_ = scrollX; }
    double scroll() const { return scrollX_; }
    double ContentWidth() const { return loop_ ? box_.width + Period() : contentWidth_; }
    double MaxScroll() const;
    // Left edge of a child inside the content, before scrolling.
    double ContentLeftOf(std::size_t index) const;

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    bool loop_ = false;
    double spacingRem_;
    double insetRem_;
    double scrollX_ = 0.0;
    double contentWidth_ = 0.0;
    std::vector<std::unique_ptr<Card>> children_;
    std::optional<Slot> focusSlot_;
    std::optional<Slot> fadingSlot_;
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

    // A channel tile: 16:9, the logo fitted whole on a dark plate, the name and `subtitle` under it.
    void SetLogo(std::string subtitle) {
        logo_ = true;
        subtitle_ = std::move(subtitle);
    }
    bool logo() const { return logo_; }
    // A second line under a poster's title, such as a search result's year.
    void SetSubtitle(std::string subtitle) { subtitle_ = std::move(subtitle); }
    // A large feature card, as Search's Top Result: a wide picture with the title and `meta` over its foot. It grows
    // and lifts on focus exactly as the other cards do.
    void SetFeature(std::string meta) {
        feature_ = true;
        subtitle_ = std::move(meta);
    }
    bool feature() const { return feature_; }
    // A Featured card: 16:9 landscape artwork with bottom scrim and title overlay, without a progress bar.
    void SetLandscape() { landscape_ = true; }
    bool landscape() const { return landscape_; }
    // A Browse tile on Search: a tall picture with the category's name over its foot, as the Apple TV app's Browse
    // tiles are. It grows and lifts on focus as the other cards do.
    void SetCategory() { category_ = true; }
    // A coloured brand/app tile on Hub: 16:9 gradient plate with centred wordmark and optional subtitle.
    void SetTile(Color fill, std::string subtitle = "") {
        tile_ = fill;
        subtitle_ = std::move(subtitle);
    }
    bool hasTile() const { return tile_.has_value(); }

    const std::string& itemId() const { return itemId_; }
    const std::string& posterUrl() const { return posterUrl_; }
    void SetDetailsArtwork(std::string backdrop, std::string poster) {
        backdropUrl_ = std::move(backdrop);
        detailsPosterUrl_ = std::move(poster);
    }
    const std::string& backdropUrl() const { return backdropUrl_.empty() ? posterUrl_ : backdropUrl_; }
    const std::string& detailsPosterUrl() const { return detailsPosterUrl_.empty() ? posterUrl_ : detailsPosterUrl_; }
    std::optional<double> progress() const { return progress_; }

    const std::string& focusKey() const { return focusKey_; }
    const std::string& title() const { return title_; }

    double focusAmount() const { return focusAmount_; }
    void SetFocusAmount(double amount) { focusAmount_ = amount; }
    // Whether the card has focus. The outline follows this at once, and the scale follows the amount.
    bool focused() const { return focused_; }
    void SetFocused(bool focused) { focused_ = focused; }
    void PaintCopy(Painter& painter, const Metrics& metrics, bool ownsFocus) const;

    Size Measure(double availableWidth, const Metrics& metrics) override;
    void Arrange(const Box& box, const Metrics& metrics) override;
    void Paint(Painter& painter, const Metrics& metrics) const override;

private:
    bool logo_ = false;
    bool feature_ = false;
    bool category_ = false;
    bool landscape_ = false;
    std::optional<Color> tile_;
    std::string subtitle_;
    std::string title_;
    std::string focusKey_;
    std::string itemId_;
    std::string posterUrl_;
    std::string backdropUrl_;
    std::string detailsPosterUrl_;
    std::optional<double> progress_;
    double focusAmount_ = 0.0;
    bool focused_ = false;
};

// Layout and motion values shared by the widgets.
inline constexpr double kFocusScale = 1.05;
inline constexpr double kFocusRingWidthRem = 0.18;
inline constexpr double kFocusRingOffsetRem = 0.14;
inline constexpr double kPosterWidthRem = 10.5;
// Search's Browse tiles: tall, larger than a poster, as the Apple TV app's.
inline constexpr double kCategoryWidthRem = 15.5;
inline constexpr double kCategoryHeightRem = 23.0;
inline constexpr double kPosterHeightRem = 15.75;
inline constexpr double kLandscapeWidthRem = 26.25;
inline constexpr double kLandscapeHeightRem = 14.75;
// A Live TV channel tile, 16:9.
inline constexpr double kChannelWidthRem = 15.0;
inline constexpr double kChannelHeightRem = 8.4375;
inline constexpr double kCardLabelGapRem = 0.75;
inline constexpr double kCardLabelHeightRem = 1.75;
// Poster and card focus tokens from DECISIONS.md and WINDOWS-VISUAL-SPEC.md:
// scale 1.04, lift 6px (0.375rem at 1080p), directional glass rim and outer focus glow.
inline constexpr double kPosterFocusScale = 1.06;
inline constexpr double kPosterLiftRem = 0.375;
inline constexpr double kPosterRingWidthRem = 0.125;
inline constexpr double kPosterRingOffsetRem = 0.18;
inline constexpr Color kPosterRing = Rgb(0xFFFFFF);
inline constexpr double kButtonLabelRem = 0.875;
inline constexpr double kButtonPadRem = 1.2;

// What a button looks like at a moment. `focusAmount` is the eased focus, 0 to 1: it scales the
// button, and the ring and the hover fill follow `focused` at once, as the web CSS does.
struct ButtonLook {
    bool primary = false;
    bool focused = false;
    double focusAmount = 0.0;
    double pressAmount = 0.0;
    double opacity = 1.0;
    std::string_view glyph;
    std::optional<Color> fill;
};

// A rectangular button with its label. The pill's radius is half its height, as `--tvm-radius-pill` gives.
void DrawButton(Painter& painter, const Metrics& metrics, const Box& box, const std::string& label, const ButtonLook& look);

}  // namespace tvm::ui
