#include "ui/pending_screen.h"

#include "ui/widget.h"

namespace tvm::ui {

namespace {

constexpr double kSafeXRem = 2.5;
constexpr double kSafeYRem = 1.5;
constexpr double kReferenceRemsHeight = 67.5;

// The heading of a screen that is not ported. Route names that are not titles read as their titles.
std::string DisplayName(const std::string& name) {
    return name == "tvm-stream" ? "TVM Stream" : name;
}

}  // namespace

PendingScreen::PendingScreen(std::string name, bool modal) : name_(std::move(name)), modal_(modal) {}

void PendingScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

void PendingScreen::Paint(Painter& painter) const {
    const Metrics metrics{height_ / kReferenceRemsHeight};
    painter.Clear(tokens::kBackground);

    const double x = metrics.Rem(kSafeXRem);
    const double y = metrics.Rem(kSafeYRem);
    const double width = width_ - 2.0 * x;

    painter.Text(Box{x, y, width, metrics.Rem(2.0)}, DisplayName(name_), TextStyle{metrics.Rem(1.75), true},
                 tokens::kText);
    painter.Text(Box{x, y + metrics.Rem(3.0), width, metrics.Rem(1.25)},
                 modal_ ? "This dialog is not ported to the native app yet."
                        : "This screen is not ported to the native app yet.",
                 TextStyle{metrics.Rem(1.0625), false}, tokens::kTextMuted);
    painter.Text(Box{x, y + metrics.Rem(4.5), width, metrics.Rem(1.25)}, "Press Back to return.",
                 TextStyle{metrics.Rem(0.8125), false}, tokens::kTextFaint);
}

}  // namespace tvm::ui
