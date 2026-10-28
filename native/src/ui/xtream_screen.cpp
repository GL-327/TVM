#include "ui/xtream_screen.h"

#include <algorithm>
#include <utility>

#include "ui/widget.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;
constexpr double kReferenceRemsHeight = 67.5;

// The layout, in rems from the top of the screen's content.
constexpr double kLedeTopRem = 5.0;
constexpr double kLedeHeightRem = 4.0;
constexpr double kContentWidthRem = 64.0;
constexpr double kAccountTopRem = 9.0;
constexpr double kChannelsTopRem = 12.0;
constexpr double kServerTopRem = 15.0;
constexpr double kUsernameTopRem = 18.0;
constexpr double kPasswordTopRem = 21.0;
constexpr double kRowHeightRem = 2.5;
constexpr double kRowLabelWidthRem = 16.0;
constexpr double kRowHintWidthRem = 12.0;
constexpr double kMessageTopRem = 24.0;
constexpr double kMessageHeightRem = 1.5;
constexpr double kButtonsTopRem = 26.0;
constexpr double kButtonHeightRem = 3.5;
constexpr double kButtonGapRem = 1.5;
constexpr double kSaveWidthRem = 18.0;
constexpr double kDisconnectWidthRem = 16.0;
constexpr double kRowRadiusRem = 0.5;

constexpr char kServerKey[] = "server";
constexpr char kUsernameKey[] = "username";
constexpr char kPasswordKey[] = "password";
constexpr char kSaveKey[] = "save";
constexpr char kDisconnectKey[] = "disconnect";

constexpr char kPasteHint[] = "Paste";

constexpr char kLede[] =
    "Copy the server, username and password for a live TV panel you are allowed to use, then choose each "
    "row to paste it. TVM keeps them sealed on this machine and sends them only to that panel. The password "
    "is never shown.";

double RowTopRem(const std::string& key) {
    if (key == "account") return kAccountTopRem;
    if (key == "channels") return kChannelsTopRem;
    if (key == kServerKey) return kServerTopRem;
    if (key == kUsernameKey) return kUsernameTopRem;
    return kPasswordTopRem;
}

}  // namespace

XtreamScreen::XtreamScreen() = default;

void XtreamScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

bool XtreamScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    buttonFocus_.Track(focused_, nowMs, motion_);
    return Animating();
}

bool XtreamScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_);
}

void XtreamScreen::SetView(XtreamView view) {
    view_ = std::move(view);
    // Disconnect goes when nothing is saved, so focus moves back to the server row.
    if (!PositionOf(focused_).has_value()) focused_ = kServerKey;
}

std::vector<std::pair<std::string, std::string>> XtreamScreen::Facts() const {
    std::vector<std::pair<std::string, std::string>> facts;
    const std::string unknown = "...";

    if (!view_.loaded) {
        facts.emplace_back("Account", unknown);
    } else if (view_.configured) {
        facts.emplace_back("Account", view_.accountName.value_or("Configured"));
    } else {
        facts.emplace_back("Account", "Not configured");
    }

    if (!view_.loaded) {
        facts.emplace_back("Channels", unknown);
    } else if (!view_.configured) {
        facts.emplace_back("Channels", "0");
    } else if (!view_.error.empty()) {
        facts.emplace_back("Channels", "Unavailable");
    } else {
        facts.emplace_back("Channels", std::to_string(view_.channels.value_or(0)));
    }

    facts.emplace_back("Server", view_.serverField.empty() ? "Not pasted" : view_.serverField);
    facts.emplace_back("Username", view_.usernameField.empty() ? "Not pasted" : view_.usernameField);
    facts.emplace_back("Password", view_.passwordPasted ? "Pasted" : "Not pasted");
    return facts;
}

std::vector<std::vector<std::string>> XtreamScreen::Grid() const {
    std::vector<std::vector<std::string>> grid{{kServerKey}, {kUsernameKey}, {kPasswordKey}};
    std::vector<std::string> buttons{kSaveKey};
    if (view_.configured) buttons.push_back(kDisconnectKey);
    grid.push_back(buttons);
    return grid;
}

std::optional<std::pair<std::size_t, std::size_t>> XtreamScreen::PositionOf(const std::string& key) const {
    const std::vector<std::vector<std::string>> grid = Grid();
    for (std::size_t row = 0; row < grid.size(); ++row) {
        for (std::size_t column = 0; column < grid[row].size(); ++column) {
            if (grid[row][column] == key) return std::make_pair(row, column);
        }
    }
    return std::nullopt;
}

std::optional<Box> XtreamScreen::BoxOf(const std::string& key) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    const double x = metrics.Rem(kSafeXRem);
    const double contentWidth = std::min(width_ - 2.0 * x, metrics.Rem(kContentWidthRem));

    if (key == kSaveKey || key == kDisconnectKey) {
        const std::optional<std::pair<std::size_t, std::size_t>> position = PositionOf(key);
        if (!position.has_value()) return std::nullopt;
        // Save login comes first in its row, and Disconnect follows it.
        double left = x;
        for (std::size_t column = 0; column < position->second; ++column) {
            left += metrics.Rem(kSaveWidthRem) + metrics.Rem(kButtonGapRem);
        }
        const double width = metrics.Rem(key == kSaveKey ? kSaveWidthRem : kDisconnectWidthRem);
        return Box{left, metrics.Rem(kSafeYRem) + metrics.Rem(kButtonsTopRem), width, metrics.Rem(kButtonHeightRem)};
    }

    if (key == kServerKey || key == kUsernameKey || key == kPasswordKey) {
        return Box{x, metrics.Rem(kSafeYRem) + metrics.Rem(RowTopRem(key)), contentWidth, metrics.Rem(kRowHeightRem)};
    }
    return std::nullopt;
}

std::string XtreamScreen::LabelOf(const std::string& key) const {
    if (key == kSaveKey) return view_.busy ? "Working..." : "Save login";
    return "Disconnect";
}

void XtreamScreen::Paint(Painter& painter) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    painter.Clear(tokens::kBackground);

    const double x = metrics.Rem(kSafeXRem);
    const double kickerY = metrics.Rem(kSafeYRem);
    const double contentWidth = std::min(width_ - 2.0 * x, metrics.Rem(kContentWidthRem));
    painter.Text(Box{x, kickerY, width_ - 2.0 * x, metrics.Rem(1.0)}, "Your source",
                 TextStyle{metrics.Rem(0.8125), false}, tokens::kTextFaint);
    // Tall enough for the descenders, which the text clip would otherwise cut.
    painter.Text(Box{x, kickerY + metrics.Rem(1.0), width_ - 2.0 * x, metrics.Rem(3.25)}, "Live TV login",
                 TextStyle{metrics.Rem(2.75), true}, tokens::kText);
    painter.Paragraph(Box{x, kickerY + metrics.Rem(kLedeTopRem), contentWidth, metrics.Rem(kLedeHeightRem)}, kLede,
                      TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);

    // The facts are in the order the rows are drawn: account, channels, then the three fields.
    const std::vector<std::pair<std::string, std::string>> facts = Facts();
    const std::vector<std::string> keys{"account", "channels", kServerKey, kUsernameKey, kPasswordKey};
    for (std::size_t i = 0; i < keys.size(); ++i) {
        const std::string& key = keys[i];
        const bool field = key == kServerKey || key == kUsernameKey || key == kPasswordKey;
        const Box row = field ? *BoxOf(key)
                              : Box{x, kickerY + metrics.Rem(RowTopRem(key)), contentWidth, metrics.Rem(kRowHeightRem)};
        const bool focused = field && focused_ == key;
        painter.FillRoundRect(row, metrics.Rem(kRowRadiusRem), focused ? tokens::kSurfaceHover : tokens::kSurface);
        if (focused) {
            const double ringWidth = metrics.Rem(kFocusRingWidthRem);
            const double outset = metrics.Rem(kFocusRingOffsetRem) + ringWidth / 2.0;
            const Box ring{row.x - outset, row.y - outset, row.width + 2.0 * outset, row.height + 2.0 * outset};
            painter.StrokeRoundRect(ring, metrics.Rem(kRowRadiusRem) + outset, ringWidth, tokens::kFocusRing);
        }

        painter.Text(Box{row.x + metrics.Rem(1.0), row.y, metrics.Rem(kRowLabelWidthRem), row.height}, facts[i].first,
                     TextStyle{metrics.Rem(1.0625), false}, focused ? tokens::kText : tokens::kTextMuted);
        painter.Text(Box{row.x + metrics.Rem(kRowLabelWidthRem), row.y,
                         row.width - metrics.Rem(kRowLabelWidthRem + kRowHintWidthRem + 1.0), row.height},
                     facts[i].second, TextStyle{metrics.Rem(1.0625), false}, tokens::kText);
        if (field) {
            painter.Text(Box{row.Right() - metrics.Rem(kRowHintWidthRem + 1.0), row.y, metrics.Rem(kRowHintWidthRem),
                             row.height},
                         kPasteHint, TextStyle{metrics.Rem(0.9375), false}, tokens::kTextFaint);
        }
    }

    if (!view_.message.empty()) {
        painter.Text(Box{x, kickerY + metrics.Rem(kMessageTopRem), contentWidth, metrics.Rem(kMessageHeightRem)},
                     view_.message, TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);
    }

    for (const std::vector<std::string>& row : Grid()) {
        for (const std::string& key : row) {
            if (key != kSaveKey && key != kDisconnectKey) continue;
            const std::optional<Box> box = BoxOf(key);
            const ButtonLook look{key == kSaveKey, focused_ == key, buttonFocus_.Amount(key, clockMs_)};
            if (box.has_value()) DrawButton(painter, metrics, *box, LabelOf(key), look);
        }
    }
}

bool XtreamScreen::Navigate(nav::Direction direction, double /*nowMs*/) {
    const std::vector<std::vector<std::string>> grid = Grid();
    const std::optional<std::pair<std::size_t, std::size_t>> position = PositionOf(focused_);
    if (!position.has_value()) return false;
    std::size_t row = position->first;
    std::size_t column = position->second;

    switch (direction) {
    case nav::Direction::Up:
        if (row == 0) return false;
        --row;
        column = std::min(column, grid[row].size() - 1);
        break;
    case nav::Direction::Down:
        if (row + 1 >= grid.size()) return false;
        ++row;
        column = std::min(column, grid[row].size() - 1);
        break;
    case nav::Direction::Left:
        if (column == 0) return false;
        --column;
        break;
    case nav::Direction::Right:
        if (column + 1 >= grid[row].size()) return false;
        ++column;
        break;
    }
    focused_ = grid[row][column];
    return true;
}

std::optional<Command> XtreamScreen::Select(double /*nowMs*/) {
    return Activate(focused_);
}

std::optional<std::string> XtreamScreen::FocusedKey() const {
    return focused_;
}

bool XtreamScreen::FocusItem(const std::string& key, double /*nowMs*/, bool /*withCamera*/) {
    // Focus only moves between the controls. None of them moves a camera.
    if (key == focused_ || !PositionOf(key).has_value()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> XtreamScreen::ItemAt(double x, double y) const {
    for (const std::vector<std::string>& row : Grid()) {
        for (const std::string& key : row) {
            const std::optional<Box> box = BoxOf(key);
            if (box.has_value() && x >= box->x && x < box->Right() && y >= box->y && y < box->Bottom()) return key;
        }
    }
    return std::nullopt;
}

std::optional<Command> XtreamScreen::ActivateItem(const std::string& key, double /*nowMs*/) {
    if (!PositionOf(key).has_value()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> XtreamScreen::Activate(const std::string& key) const {
    // While a request is in flight the controls wait for its answer.
    if (view_.busy) return std::nullopt;

    // Filling the fields, saving and disconnecting are the app's job. The shell hands
    // each of these over as an action and opens nothing.
    Command command;
    command.action = true;
    if (key == kServerKey) {
        command.name = "xtream-paste-server";
    } else if (key == kUsernameKey) {
        command.name = "xtream-paste-username";
    } else if (key == kPasswordKey) {
        command.name = "xtream-paste-password";
    } else if (key == kSaveKey) {
        command.name = "xtream-save";
    } else if (key == kDisconnectKey) {
        command.name = "xtream-disconnect";
    } else {
        return std::nullopt;
    }
    return command;
}

}  // namespace tvm::ui
