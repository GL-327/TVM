#include "ui/live_playlist_screen.h"

#include <algorithm>
#include <utility>

#include "catalog/live.h"
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
constexpr double kPlaylistTopRem = 9.0;
constexpr double kChannelsTopRem = 12.0;
constexpr double kAddressTopRem = 15.0;
constexpr double kTextTopRem = 18.0;
constexpr double kRowHeightRem = 2.5;
constexpr double kRowLabelWidthRem = 16.0;
constexpr double kRowHintWidthRem = 12.0;
constexpr double kRowRadiusRem = 0.5;
constexpr double kMessageTopRem = 21.0;
constexpr double kMessageHeightRem = 1.5;
constexpr double kButtonsTopRem = 23.0;
constexpr double kButtonHeightRem = 3.5;
constexpr double kButtonGapRem = 1.5;
constexpr double kSaveWidthRem = 18.0;
constexpr double kClearWidthRem = 14.0;
constexpr double kOpenWidthRem = 18.0;

constexpr char kAddressKey[] = "address";
constexpr char kTextKey[] = "text";
constexpr char kSaveKey[] = "save";
constexpr char kClearKey[] = "clear";
constexpr char kOpenKey[] = "open";

constexpr char kPasteHint[] = "Paste";

constexpr char kLede[] =
    "Paste an M3U or M3U8 URL you are allowed to use, such as a tuner, Plex, Jellyfin or TVHeadend in your home, "
    "or a single .m3u8 stream. You can also paste the playlist text. TVM does not log into IPTV provider panels.";

double RowTopRem(const std::string& key) {
    if (key == "playlist") return kPlaylistTopRem;
    if (key == "channels") return kChannelsTopRem;
    if (key == kAddressKey) return kAddressTopRem;
    return kTextTopRem;
}

double ButtonWidthRem(const std::string& key) {
    if (key == kSaveKey) return kSaveWidthRem;
    if (key == kClearKey) return kClearWidthRem;
    return kOpenWidthRem;
}

}  // namespace

LivePlaylistScreen::LivePlaylistScreen() = default;

void LivePlaylistScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

void LivePlaylistScreen::SetView(LivePlaylistView view) {
    // Every control is always listed, so the focus stays where it is.
    view_ = std::move(view);
}

std::vector<std::pair<std::string, std::string>> LivePlaylistScreen::Facts() const {
    std::vector<std::pair<std::string, std::string>> facts;
    const std::string unknown = "...";

    if (!view_.loaded) {
        facts.emplace_back("Playlist", unknown);
    } else if (!view_.playlistUrl.has_value()) {
        facts.emplace_back("Playlist", "Not added");
    } else if (*view_.playlistUrl == live::kPastedPlaylist) {
        facts.emplace_back("Playlist", "Pasted on this machine");
    } else {
        facts.emplace_back("Playlist", *view_.playlistUrl);
    }

    facts.emplace_back("Channels", view_.loaded ? std::to_string(view_.channels) : unknown);
    facts.emplace_back("Address", view_.addressField.empty() ? "Not pasted" : view_.addressField);
    facts.emplace_back("Text", view_.textBytes.has_value()
                                   ? "Pasted, " + std::to_string(*view_.textBytes) + " bytes"
                                   : "Not pasted");
    return facts;
}

std::vector<std::vector<std::string>> LivePlaylistScreen::Grid() const {
    return {{kAddressKey}, {kTextKey}, {kSaveKey, kClearKey, kOpenKey}};
}

std::optional<std::pair<std::size_t, std::size_t>> LivePlaylistScreen::PositionOf(const std::string& key) const {
    const std::vector<std::vector<std::string>> grid = Grid();
    for (std::size_t row = 0; row < grid.size(); ++row) {
        for (std::size_t column = 0; column < grid[row].size(); ++column) {
            if (grid[row][column] == key) return std::make_pair(row, column);
        }
    }
    return std::nullopt;
}

std::optional<Box> LivePlaylistScreen::BoxOf(const std::string& key) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    const double x = metrics.Rem(kSafeXRem);
    const double contentWidth = std::min(width_ - 2.0 * x, metrics.Rem(kContentWidthRem));

    if (key == kSaveKey || key == kClearKey || key == kOpenKey) {
        const std::optional<std::pair<std::size_t, std::size_t>> position = PositionOf(key);
        if (!position.has_value()) return std::nullopt;
        double left = x;
        for (std::size_t column = 0; column < position->second; ++column) {
            left += metrics.Rem(ButtonWidthRem(Grid()[position->first][column])) + metrics.Rem(kButtonGapRem);
        }
        return Box{left, metrics.Rem(kSafeYRem) + metrics.Rem(kButtonsTopRem), metrics.Rem(ButtonWidthRem(key)),
                   metrics.Rem(kButtonHeightRem)};
    }

    if (key == kAddressKey || key == kTextKey) {
        return Box{x, metrics.Rem(kSafeYRem) + metrics.Rem(RowTopRem(key)), contentWidth, metrics.Rem(kRowHeightRem)};
    }
    return std::nullopt;
}

std::string LivePlaylistScreen::LabelOf(const std::string& key) const {
    if (key == kSaveKey) return view_.busy ? "Saving..." : "Save playlist";
    if (key == kClearKey) return "Remove";
    return "Open Live TV";
}

bool LivePlaylistScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    buttonFocus_.Track(focused_, nowMs, motion_);
    return Animating();
}

bool LivePlaylistScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_);
}

void LivePlaylistScreen::Paint(Painter& painter) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    painter.Clear(tokens::kBackground);

    const double x = metrics.Rem(kSafeXRem);
    const double kickerY = metrics.Rem(kSafeYRem);
    const double contentWidth = std::min(width_ - 2.0 * x, metrics.Rem(kContentWidthRem));
    painter.Text(Box{x, kickerY, width_ - 2.0 * x, metrics.Rem(1.0)}, "Your source",
                 TextStyle{metrics.Rem(0.8125), false}, tokens::kTextFaint);
    // Tall enough for the descenders, which the text clip would otherwise cut.
    painter.Text(Box{x, kickerY + metrics.Rem(1.0), width_ - 2.0 * x, metrics.Rem(3.25)}, "Add a playlist",
                 TextStyle{metrics.Rem(2.75), true}, tokens::kText);
    painter.Paragraph(Box{x, kickerY + metrics.Rem(kLedeTopRem), contentWidth, metrics.Rem(kLedeHeightRem)}, kLede,
                      TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);

    // The facts are in the order the rows are drawn: playlist, channels, address, text.
    const std::vector<std::pair<std::string, std::string>> facts = Facts();
    const std::vector<std::string> keys{"playlist", "channels", kAddressKey, kTextKey};
    for (std::size_t i = 0; i < keys.size(); ++i) {
        const std::string& key = keys[i];
        const bool field = key == kAddressKey || key == kTextKey;
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
        const double valueWidth = field ? row.width - metrics.Rem(kRowLabelWidthRem + kRowHintWidthRem + 1.0)
                                        : row.width - metrics.Rem(kRowLabelWidthRem + 1.0);
        painter.Text(Box{row.x + metrics.Rem(kRowLabelWidthRem), row.y, valueWidth, row.height}, facts[i].second,
                     TextStyle{metrics.Rem(1.0625), false}, tokens::kText);
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
            if (key != kSaveKey && key != kClearKey && key != kOpenKey) continue;
            const std::optional<Box> box = BoxOf(key);
            const ButtonLook look{key == kSaveKey, focused_ == key, buttonFocus_.Amount(key, clockMs_)};
            if (box.has_value()) DrawButton(painter, metrics, *box, LabelOf(key), look);
        }
    }
}

bool LivePlaylistScreen::Navigate(nav::Direction direction, double /*nowMs*/) {
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

std::optional<Command> LivePlaylistScreen::Select(double /*nowMs*/) {
    return Activate(focused_);
}

std::optional<std::string> LivePlaylistScreen::FocusedKey() const {
    return focused_;
}

bool LivePlaylistScreen::FocusItem(const std::string& key, double /*nowMs*/, bool /*withCamera*/) {
    // Focus only moves between the controls. None of them moves a camera.
    if (key == focused_ || !PositionOf(key).has_value()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> LivePlaylistScreen::ItemAt(double x, double y) const {
    for (const std::vector<std::string>& row : Grid()) {
        for (const std::string& key : row) {
            const std::optional<Box> box = BoxOf(key);
            if (box.has_value() && x >= box->x && x < box->Right() && y >= box->y && y < box->Bottom()) return key;
        }
    }
    return std::nullopt;
}

std::optional<Command> LivePlaylistScreen::ActivateItem(const std::string& key, double /*nowMs*/) {
    if (!PositionOf(key).has_value()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> LivePlaylistScreen::Activate(const std::string& key) const {
    // While a request is in flight the controls wait for its answer.
    if (view_.busy) return std::nullopt;

    Command command;
    if (key == kAddressKey) {
        command.name = "live-playlist-paste-address";
        command.action = true;
        return command;
    }
    if (key == kTextKey) {
        command.name = "live-playlist-paste-text";
        command.action = true;
        return command;
    }
    if (key == kSaveKey) {
        command.name = "live-playlist-save";
        command.action = true;
        return command;
    }
    if (key == kClearKey) {
        command.name = "live-playlist-clear";
        command.action = true;
        return command;
    }
    if (key == kOpenKey) {
        // Opening Live TV is a screen, so the shell pushes it.
        command.name = "live-tv";
        return command;
    }
    return std::nullopt;
}

}  // namespace tvm::ui
