#pragma once

// The Live TV playlist, from Settings and from the Live TV screen. It shows where the
// playlist comes from and how many channels it has. Two rows fill the address and the
// playlist text from the clipboard, then Save playlist, Remove and Open Live TV. The app
// reads and saves the playlist and hands each answer over with SetView, so the screen
// makes no requests of its own. The text itself is never shown, only its size.

#include <cstddef>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ui/button_focus.h"
#include "ui/screen_base.h"

namespace tvm::ui {

// What the screen shows. The app fills it in from the saved playlist and the pasted fields.
struct LivePlaylistView {
    // False until the saved playlist has been read. The rows read "..." until then.
    bool loaded = false;
    // The playlist's label: nothing when none is saved, the pasted label for pasted text, or its address.
    std::optional<std::string> playlistUrl;
    // The channels the saved playlist has.
    std::size_t channels = 0;
    // The address as pasted, and the size of the pasted text when there is some.
    std::string addressField;
    std::optional<std::size_t> textBytes;
    // A request is in flight. The controls wait for its answer.
    bool busy = false;
    // One line of feedback about the last action.
    std::string message;

    bool operator==(const LivePlaylistView&) const = default;
};

class LivePlaylistScreen final : public ScreenBase {
public:
    LivePlaylistScreen();

    void Layout(double width, double height) override;
    void Paint(Painter& painter) const override;
    bool Tick(double nowMs) override;
    bool Animating() const override;

    // Replaces what the screen shows. The focus stays where it is.
    void SetView(LivePlaylistView view);
    const LivePlaylistView& view() const { return view_; }

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

    LivePlaylistView view_;
    std::string focused_ = "address";
    // The eased focus of each button, and the clock the screen last ticked on.
    ButtonFocusSet buttonFocus_;
    double clockMs_ = 0.0;
    double width_ = 0.0;
    double height_ = 0.0;
};

}  // namespace tvm::ui
