#include "ui/realdebrid_screen.h"

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
constexpr double kLedeHeightRem = 4.5;
constexpr double kContentWidthRem = 64.0;
constexpr double kRowsTopRem = 10.0;
constexpr double kRowPitchRem = 3.0;
constexpr double kRowHeightRem = 2.5;
constexpr double kRowLabelWidthRem = 16.0;
constexpr double kMessageHeightRem = 1.5;
constexpr double kButtonsTopRem = 25.0;
constexpr double kButtonHeightRem = 3.5;
constexpr double kButtonGapRem = 1.5;

constexpr char kPasteKey[] = "paste";
constexpr char kDisconnectKey[] = "disconnect";
constexpr char kTermsKey[] = "terms";

constexpr char kLede[] =
    "Copy an API token from real-debrid.com/apitoken, then choose Paste and save. The token is "
    "kept sealed on this machine and is sent only to Real-Debrid. Use only content you are "
    "authorised to watch.";

// The width of a button, in rems. The labels are short, so the widths are fixed.
double ButtonWidthRem(const std::string& key) {
    if (key == kDisconnectKey) return 16.0;
    return 18.0;
}

}  // namespace

RealDebridScreen::RealDebridScreen() = default;

void RealDebridScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

void RealDebridScreen::SetView(RealDebridView view) {
    view_ = std::move(view);
    // Disconnect goes when nothing is connected, so focus moves back to the first button.
    const std::vector<std::string> items = Items();
    if (std::find(items.begin(), items.end(), focused_) == items.end()) focused_ = kPasteKey;
}

std::vector<std::pair<std::string, std::string>> RealDebridScreen::Facts() const {
    std::vector<std::pair<std::string, std::string>> facts;
    const std::string unknown = "...";

    if (!view_.loaded) {
        facts.emplace_back("Account", unknown);
    } else if (view_.configured) {
        facts.emplace_back("Account", view_.username.value_or("Configured"));
    } else {
        facts.emplace_back("Account", "Not configured");
    }
    if (view_.loaded && view_.configured) facts.emplace_back("Token", "This machine\xE2\x80\x99s");
    facts.emplace_back("Premium", !view_.loaded ? unknown : view_.premium ? "Yes" : "No");

    std::string status = "Ready";
    if (!view_.loaded) {
        status = unknown;
    } else if (view_.error == "needs-auth") {
        status = "Token rejected";
    } else if (view_.error == "unreachable") {
        status = "Unavailable";
    } else if (!view_.configured) {
        status = "Not connected";
    }
    facts.emplace_back("Status", status);
    return facts;
}

std::vector<std::string> RealDebridScreen::Items() const {
    std::vector<std::string> items{kPasteKey};
    if (view_.configured) items.push_back(kDisconnectKey);
    items.push_back(kTermsKey);
    return items;
}

std::optional<Box> RealDebridScreen::BoxOf(const std::string& key) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    double x = metrics.Rem(kSafeXRem);
    const double y = metrics.Rem(kSafeYRem) + metrics.Rem(kButtonsTopRem);
    for (const std::string& item : Items()) {
        const double width = metrics.Rem(ButtonWidthRem(item));
        if (item == key) return Box{x, y, width, metrics.Rem(kButtonHeightRem)};
        x += width + metrics.Rem(kButtonGapRem);
    }
    return std::nullopt;
}

std::string RealDebridScreen::LabelOf(const std::string& key) const {
    if (key == kPasteKey) return view_.busy ? "Working..." : "Paste and save";
    if (key == kDisconnectKey) return "Disconnect";
    return "Privacy & terms";
}

bool RealDebridScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    buttonFocus_.Track(focused_, nowMs, motion_);
    return Animating();
}

bool RealDebridScreen::Animating() const {
    return buttonFocus_.Animating(clockMs_);
}

void RealDebridScreen::Paint(Painter& painter) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    painter.Clear(tokens::kBackground);

    const double x = metrics.Rem(kSafeXRem);
    const double kickerY = metrics.Rem(kSafeYRem);
    const double contentWidth = std::min(width_ - 2.0 * x, metrics.Rem(kContentWidthRem));
    painter.Text(Box{x, kickerY, width_ - 2.0 * x, metrics.Rem(1.0)}, "Account and cloud",
                 TextStyle{metrics.Rem(0.8125), false}, tokens::kTextFaint);
    // Tall enough for the descenders, which the text clip would otherwise cut.
    painter.Text(Box{x, kickerY + metrics.Rem(1.0), width_ - 2.0 * x, metrics.Rem(3.25)}, "Real-Debrid",
                 TextStyle{metrics.Rem(2.75), true}, tokens::kText);
    painter.Paragraph(Box{x, kickerY + metrics.Rem(kLedeTopRem), contentWidth, metrics.Rem(kLedeHeightRem)}, kLede,
                      TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);

    double top = kickerY + metrics.Rem(kRowsTopRem);
    for (const auto& [label, value] : Facts()) {
        const Box row{x, top, contentWidth, metrics.Rem(kRowHeightRem)};
        painter.FillRoundRect(row, metrics.Rem(0.5), tokens::kSurface);
        painter.Text(Box{row.x + metrics.Rem(1.0), row.y, metrics.Rem(kRowLabelWidthRem), row.height}, label,
                     TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);
        painter.Text(Box{row.x + metrics.Rem(kRowLabelWidthRem), row.y,
                         row.width - metrics.Rem(kRowLabelWidthRem + 1.0), row.height},
                     value, TextStyle{metrics.Rem(1.0625), false}, tokens::kText);
        top += metrics.Rem(kRowPitchRem);
    }

    if (!view_.message.empty()) {
        painter.Text(Box{x, top + metrics.Rem(0.25), contentWidth, metrics.Rem(kMessageHeightRem)}, view_.message,
                     TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);
    }

    for (const std::string& key : Items()) {
        const std::optional<Box> box = BoxOf(key);
        // Paste and save is the primary button: it saves the token on the clipboard.
        const ButtonLook look{key == kPasteKey, focused_ == key, buttonFocus_.Amount(key, clockMs_)};
        if (box.has_value()) DrawButton(painter, metrics, *box, LabelOf(key), look);
    }
}

bool RealDebridScreen::Navigate(nav::Direction direction, double /*nowMs*/) {
    const std::vector<std::string> items = Items();
    const auto current = std::find(items.begin(), items.end(), focused_);
    if (current == items.end()) return false;
    if (direction == nav::Direction::Right && current + 1 != items.end()) {
        focused_ = *(current + 1);
        return true;
    }
    if (direction == nav::Direction::Left && current != items.begin()) {
        focused_ = *(current - 1);
        return true;
    }
    return false;
}

std::optional<Command> RealDebridScreen::Select(double /*nowMs*/) {
    return Activate(focused_);
}

std::optional<std::string> RealDebridScreen::FocusedKey() const {
    return focused_;
}

bool RealDebridScreen::FocusItem(const std::string& key, double /*nowMs*/, bool /*withCamera*/) {
    // Focus only moves between the buttons. Neither button moves a camera.
    const std::vector<std::string> items = Items();
    if (key == focused_ || std::find(items.begin(), items.end(), key) == items.end()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> RealDebridScreen::ItemAt(double x, double y) const {
    for (const std::string& key : Items()) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && x >= box->x && x < box->Right() && y >= box->y && y < box->Bottom()) return key;
    }
    return std::nullopt;
}

std::optional<Command> RealDebridScreen::ActivateItem(const std::string& key, double /*nowMs*/) {
    const std::vector<std::string> items = Items();
    if (std::find(items.begin(), items.end(), key) == items.end()) return std::nullopt;
    focused_ = key;
    return Activate(key);
}

std::optional<Command> RealDebridScreen::Activate(const std::string& key) const {
    // While a request is in flight the buttons wait for its answer.
    if (view_.busy) return std::nullopt;

    Command command;
    if (key == kPasteKey) {
        // Saving is the app's job, and it reads the clipboard. The shell opens nothing.
        command.name = "realdebrid-paste";
        command.action = true;
        return command;
    }
    if (key == kDisconnectKey) {
        command.name = "realdebrid-disconnect";
        command.action = true;
        return command;
    }
    if (key == kTermsKey) {
        command.name = "legal";
        return command;
    }
    return std::nullopt;
}

}  // namespace tvm::ui
