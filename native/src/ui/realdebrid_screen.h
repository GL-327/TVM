#pragma once

// Real-Debrid, from Settings. It shows whether an account is connected, the
// account's name and whether it is premium, and it has buttons to save a token
// from the clipboard and to disconnect. The app does the network work and hands
// each answer over with SetView, so the screen makes no requests of its own.

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ui/button_focus.h"
#include "ui/screen_base.h"

namespace tvm::ui {

// What the screen shows. The app fills it in from the Real-Debrid client.
struct RealDebridView {
    // False until the first answer arrives. Until then the rows read "...".
    bool loaded = false;
    bool configured = false;
    std::optional<std::string> username;
    bool premium = false;
    // "", "needs-auth" or "unreachable", as the client reports them.
    std::string error;
    // A request is in flight. The buttons do nothing until it finishes.
    bool busy = false;
    // One line of feedback about the last action, such as "Signed in as ...".
    std::string message;

    bool operator==(const RealDebridView&) const = default;
};

class RealDebridScreen final : public ScreenBase {
public:
    RealDebridScreen();

    void Layout(double width, double height) override;
    void Paint(Painter& painter) const override;
    bool Tick(double nowMs) override;
    bool Animating() const override;

    // Replaces what the screen shows. The focus stays on a button that still exists.
    void SetView(RealDebridView view);
    const RealDebridView& view() const { return view_; }

    // The rows in the order they are drawn, as label and value.
    std::vector<std::pair<std::string, std::string>> Facts() const;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override;
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;

private:
    // The focusable buttons, left to right.
    std::vector<std::string> Items() const;
    std::optional<Box> BoxOf(const std::string& key) const;
    std::optional<Command> Activate(const std::string& key) const;
    std::string LabelOf(const std::string& key) const;

    RealDebridView view_;
    std::string focused_ = "paste";
    // The eased focus of each button, and the clock the screen last ticked on.
    ButtonFocusSet buttonFocus_;
    double clockMs_ = 0.0;
    double width_ = 0.0;
    double height_ = 0.0;
};

}  // namespace tvm::ui
