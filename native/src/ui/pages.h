#pragma once

// Pages of copy and buttons: Profiles (apps/ui/src/screens/Profiles.tsx), Plans (Plans.tsx) and Updates
// (Updates.tsx). They share PageScreen, which lays out the kicker, the heading and the lede, moves the
// focus between rows of buttons, and scrolls the page to keep the focused button in view.
//
// The app does the work each page asks for, and hands its answers over with SetView.

#include <optional>
#include <string>
#include <vector>

#include "motion/tween.h"
#include "ui/button_focus.h"
#include "ui/screen_base.h"

namespace tvm::ui {

// A button on a page, in page coordinates (before the scroll). Buttons in one row sit side by side.
struct PageButton {
    std::string key;
    std::string label;
    Box box;
    int row = 0;
    bool primary = false;
    bool disabled = false;
    // Drawn by the page itself, such as a profile's tile, rather than as a pill.
    bool custom = false;
};

class PageScreen : public ScreenBase {
public:
    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    void Paint(Painter& painter) const override;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focused_; }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const override;
    void SetScroll(const ScrollSurface& surface, double value, double nowMs) override;
    void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) override;

    // The button for a key, at the current scroll.
    std::optional<Box> BoxOf(const std::string& key) const;

protected:
    virtual std::vector<PageButton> Buttons() const = 0;
    // Paints the page's own content, offset by `scroll`, and returns nothing; the base paints the buttons.
    virtual void PaintContent(Painter& painter, double scroll) const = 0;
    // The page's full height, so the scroll stops at its foot.
    virtual double ContentHeight() const = 0;
    virtual std::optional<Command> Activate(const std::string& key) = 0;
    // Paints a custom button's own look at its scrolled box.
    virtual void PaintCustom(Painter& /*painter*/, const PageButton& /*button*/, const Box& /*box*/, bool /*focused*/) const {}

    double Rem(double rems) const { return rems * height_ / 67.5; }
    // The kicker, the heading and the lede, from the top of the page. Returns where the content below starts.
    double PaintHeader(Painter& painter, double top, const std::string& kicker, const std::string& heading,
                       const std::string& lede) const;
    // Keeps the focus on a button that still exists, starting on `fallback`.
    void KeepFocus(const std::string& fallback);

    std::string focused_;
    double width_ = 0.0;
    double height_ = 0.0;
    double clockMs_ = 0.0;

private:
    void FollowFocus(double nowMs);
    double MaxScroll() const;

    ButtonFocusSet buttonFocus_;
    double scroll_ = 0.0;
    std::optional<motion::Tween> scrollTween_;
};

// ------------------------------------------------------------------ Profiles

struct ProfileEntry {
    std::string id;
    std::string name;
    int hue = 221;

    bool operator==(const ProfileEntry&) const = default;
};

struct ProfilesView {
    std::vector<ProfileEntry> profiles;
    std::string activeId;
    std::size_t max = 10;
    std::string message;

    bool operator==(const ProfilesView&) const = default;
};

// "Who's watching?": a tile per profile with its coloured orb and its initial, Remove under each when
// there is more than one, and Add profile, which opens a name field that is typed into.
class ProfilesScreen final : public PageScreen {
public:
    ProfilesScreen();
    void SetView(ProfilesView view);
    const ProfilesView& view() const { return view_; }
    bool Creating() const { return creating_; }
    // Typing into the name field while it is open.
    void Type(const std::string& text);
    void Erase();

protected:
    std::vector<PageButton> Buttons() const override;
    void PaintContent(Painter& painter, double scroll) const override;
    double ContentHeight() const override;
    std::optional<Command> Activate(const std::string& key) override;
    void PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const override;

private:
    ProfilesView view_;
    bool creating_ = false;
    std::string name_;
};

// ------------------------------------------------------------------ Plans

// "What TVM costs": the two kinds of access with their prices, Live TV's terms, how access is arranged,
// and, fenced off below, Donate. The copy is the Node core's ACCESS_TIERS and LIVE_TV_CATALOG.
class PlansScreen final : public PageScreen {
public:
    PlansScreen();

protected:
    std::vector<PageButton> Buttons() const override;
    void PaintContent(Painter& painter, double scroll) const override;
    double ContentHeight() const override;
    std::optional<Command> Activate(const std::string& key) override;

private:
    double DonateTop() const;
};

// ------------------------------------------------------------------ Updates

struct UpdatesView {
    std::string version;
    std::string lastCheck;
    std::string available;
    bool autoUpdate = true;
    bool busy = false;
    std::string message;
    // The latest changes on GitHub, newest first, one line each.
    std::vector<std::string> changes;

    bool operator==(const UpdatesView&) const = default;
};

// Updates: the build this is, when GitHub was last asked, what it offers, and what changed. Applying is
// not offered here: the native app is replaced by installing a new build, not by updating itself.
class UpdatesScreen final : public PageScreen {
public:
    UpdatesScreen();
    void SetView(UpdatesView view);
    const UpdatesView& view() const { return view_; }

protected:
    std::vector<PageButton> Buttons() const override;
    void PaintContent(Painter& painter, double scroll) const override;
    double ContentHeight() const override;
    std::optional<Command> Activate(const std::string& key) override;

private:
    UpdatesView view_;
};

// ------------------------------------------------------------------ info pages

// One part of an info page, laid out top to bottom.
struct InfoBlock {
    enum class Kind {
        Heading,
        Paragraph,
        // A label and its value in a panel row, as `.panel__row` shows them.
        Row,
        Bullet,
        // Fainter, smaller copy, such as fine print.
        Note,
        // A thin line that fences a section off.
        Rule,
    };
    Kind kind = Kind::Paragraph;
    std::string text;
    std::string value;
    // A row or bullet in the accent's colour, such as a channel that streams, or in red, for a fault.
    bool good = false;
    bool bad = false;

    bool operator==(const InfoBlock&) const = default;
};

// A button on an info page. Its key is the command it sends: "open:<screen>" opens a screen, "back" goes
// back, and any other key is an action the app carries out. A tile is a large coloured card, as the Apps
// grid's are, with the label as its wordmark.
struct InfoAction {
    std::string key;
    std::string label;
    bool primary = false;
    bool disabled = false;
    std::optional<Color> tile;
    // A line under a tile's wordmark.
    std::string detail;

    bool operator==(const InfoAction&) const = default;
};

struct InfoView {
    std::string kicker;
    std::string heading;
    std::string lede;
    std::string message;
    bool messageBad = false;
    // Buttons under the heading, such as Refresh and Back, then the page's own rows of them.
    std::vector<InfoAction> topActions;
    std::vector<std::vector<InfoAction>> filters;
    std::vector<InfoAction> tiles;
    std::vector<InfoBlock> blocks;
    // Rows of buttons after the blocks, each row its own line.
    std::vector<std::vector<InfoAction>> actions;
    // A field typed into from the keyboard. Its text goes with every action as the "field" param.
    bool field = false;
    std::string fieldLabel;
    std::string fieldPlaceholder;
    bool fieldSecret = false;

    bool operator==(const InfoView&) const = default;
};

// A page of copy, rows and buttons, made from an InfoView. Legal, Donate, Downloads, Setup, Recovery, Live
// check, the developer pages and the device pages are all this, each filled in by the app.
class InfoScreen final : public PageScreen {
public:
    InfoScreen() = default;
    void SetView(InfoView view);
    const InfoView& view() const { return view_; }
    void Layout(double width, double height) override;
    bool HasField() const { return view_.field; }
    const std::string& FieldText() const { return fieldText_; }
    void Type(const std::string& text);
    void Erase();
    void ClearField() { fieldText_.clear(); }
    // A page with several fields shows one at a time, so the app puts the chosen one's text back.
    void SetFieldText(std::string text) { fieldText_ = std::move(text); }

protected:
    std::vector<PageButton> Buttons() const override { return buttons_; }
    void PaintContent(Painter& painter, double scroll) const override;
    double ContentHeight() const override { return contentHeight_; }
    std::optional<Command> Activate(const std::string& key) override;
    void PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const override;

private:
    struct Placed {
        InfoBlock block;
        Box box;
    };
    // Places the header, the buttons, the field and the blocks, top to bottom.
    void Arrange();

    InfoView view_;
    std::string fieldText_;
    std::vector<PageButton> buttons_;
    std::vector<Placed> placed_;
    double ledeTop_ = 0.0;
    double ledeHeight_ = 0.0;
    double messageTop_ = 0.0;
    double fieldTop_ = 0.0;
    double contentHeight_ = 0.0;
};

}  // namespace tvm::ui
