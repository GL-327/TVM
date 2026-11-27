#pragma once

// "Who's watching?", after the Android app's profile chooser (tvm-android.css §22, tvm-android.js §14): a centred grid
// of rounded-square avatars in each profile's colour with its initial, the name under it, a blue ring on the
// active profile, and an Add Profile tile while there is room. "Manage profiles" turns on edit mode: each avatar
// gets a pencil, and choosing one opens a sheet to rename it (up to 24 characters) or delete it (with a second
// press to confirm, and never the last one).
//
// It opens when TVM starts (unless Settings turns that off), and from the profile orb and Settings > Profiles.
// Picking a profile scales its avatar down briefly; the app switches to that profile and closes the chooser.

#include <optional>
#include <string>
#include <vector>

#include "motion/tween.h"
#include "ui/button_focus.h"
#include "ui/pages.h"
#include "ui/screen_base.h"

namespace tvm::ui {

struct ChooserView {
    std::vector<ProfileEntry> profiles;
    std::string activeId;
    std::size_t max = 10;
    std::string message;

    bool operator==(const ChooserView&) const = default;
};

// `hsl(hue 62% 46%)`, an avatar's colour.
Color AvatarColor(int hue);

class ProfileChooser final : public ScreenBase {
public:
    static constexpr std::size_t kNameLimit = 24;
    static constexpr double kPickMs = 220.0;

    ProfileChooser() = default;

    void SetView(ChooserView view);
    const ChooserView& view() const { return view_; }
    bool Editing() const { return editMode_; }
    // The rename or add sheet is open, so typing goes into its name.
    bool SheetOpen() const { return sheet_.has_value(); }
    const std::string& SheetName() const { return name_; }
    void Type(const std::string& text);
    void Erase();

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    bool ShowsStage() const override { return true; }
    void Paint(Painter& painter) const override;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focused_; }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    void SetPressed(const std::optional<std::string>& key, double nowMs) override;

    // Exposed for tests: the keys in focus order, and each one's box.
    std::vector<std::string> Keys() const;
    std::optional<Box> BoxOf(const std::string& key) const;

private:
    struct Sheet {
        // Empty for a new profile.
        std::string id;
        bool confirmDelete = false;
    };

    std::optional<Command> Activate(const std::string& key, double nowMs);
    double Rem(double rems) const;
    std::size_t Columns() const;
    std::size_t TileCount() const;
    std::string TileKey(std::size_t index) const;
    Box TileBox(std::size_t index) const;
    Box SheetBox() const;
    std::vector<std::string> SheetKeys() const;
    void PaintTile(Painter& painter, std::size_t index) const;
    void PaintSheet(Painter& painter) const;

    ChooserView view_;
    double width_ = 0.0;
    double height_ = 0.0;
    double clockMs_ = 0.0;
    std::string focused_;
    bool editMode_ = false;
    std::optional<Sheet> sheet_;
    std::string name_;
    ButtonFocusSet focus_;
    std::optional<std::string> pressed_;
    // The avatar picked, which scales down while the app switches.
    std::string picked_;
    motion::Tween pick_;
};

// The menu under the profile orb, after the Android app's "You" popup: the profiles (the active one ticked),
// then Manage profiles and Settings, in a compact floating panel at the top right. A click outside closes it.
class ProfileMenu final : public ScreenBase {
public:
    static constexpr double kOpenMs = 170.0;

    void SetView(ChooserView view);
    const ChooserView& view() const { return view_; }

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    bool ShowsStage() const override { return true; }
    void Paint(Painter& painter) const override;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focused_; }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;

    std::vector<std::string> Keys() const;
    std::optional<Box> BoxOf(const std::string& key) const;
    Box PanelBox() const;

private:
    std::optional<Command> Activate(const std::string& key) const;
    double Rem(double rems) const;
    double OpenAmount() const;

    ChooserView view_;
    double width_ = 0.0;
    double height_ = 0.0;
    double clockMs_ = 0.0;
    double openedMs_ = -1.0;
    std::string focused_;
    // The highlight slides between rows.
    motion::Tween row_;
};

}  // namespace tvm::ui
