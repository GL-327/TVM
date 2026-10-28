#pragma once

// Live TV login, from Settings. It shows the saved panel login: the account it is for and
// how many channels the panel serves. Below are the server, username and password, each
// filled from the clipboard by its own row, then Save login and Disconnect. The app does
// the work and hands each answer over with SetView, so the screen makes no requests.
// The password is never shown, only whether one has been pasted.

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ui/button_focus.h"
#include "ui/screen_base.h"

namespace tvm::ui {

// What the screen shows. The app fills it in from the Xtream client and the pasted fields.
struct XtreamView {
    // False until the saved login has been read. The rows read "..." until then.
    bool loaded = false;
    // A login is saved on this machine.
    bool configured = false;
    // The account name the saved login is for.
    std::optional<std::string> accountName;
    // The channels the saved login serves. Nothing when they could not be read.
    std::optional<int> channels;
    // "", "needs-auth" or "unreachable" for the saved login.
    std::string error;
    // The fields as pasted so far. The password is only ever reported as pasted or not.
    std::string serverField;
    std::string usernameField;
    bool passwordPasted = false;
    // A request is in flight. The buttons do nothing until it finishes.
    bool busy = false;
    // One line of feedback about the last action.
    std::string message;

    bool operator==(const XtreamView&) const = default;
};

class XtreamScreen final : public ScreenBase {
public:
    XtreamScreen();

    void Layout(double width, double height) override;
    void Paint(Painter& painter) const override;
    bool Tick(double nowMs) override;
    bool Animating() const override;

    // Replaces what the screen shows. The focus stays on a control that still exists.
    void SetView(XtreamView view);
    const XtreamView& view() const { return view_; }

    // The rows in the order they are drawn, as label and value.
    std::vector<std::pair<std::string, std::string>> Facts() const;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override;
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;

private:
    // The focusable controls, one row each, top to bottom. Left and right move within a row.
    std::vector<std::vector<std::string>> Grid() const;
    std::optional<std::pair<std::size_t, std::size_t>> PositionOf(const std::string& key) const;
    std::optional<Box> BoxOf(const std::string& key) const;
    std::optional<Command> Activate(const std::string& key) const;
    std::string LabelOf(const std::string& key) const;

    XtreamView view_;
    std::string focused_ = "server";
    // The eased focus of each button, and the clock the screen last ticked on.
    ButtonFocusSet buttonFocus_;
    double clockMs_ = 0.0;
    double width_ = 0.0;
    double height_ = 0.0;
};

}  // namespace tvm::ui
