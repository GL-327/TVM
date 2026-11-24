#include "ui/downloads_screen.h"

#include <algorithm>
#include <cmath>

#include "motion/preferences.h"
#include "ui/glass_styles.h"
#include "ui/layout.h"
#include "ui/theme.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

constexpr double kSheetMaxRem = 46.0;
constexpr double kPadRem = 1.6;
constexpr double kControlRem = 2.9;
constexpr double kFieldHeadRem = 1.35;
constexpr double kGapRem = 0.8;
constexpr double kCardRem = 4.7;
constexpr double kRadiusRem = 1.5;
constexpr Color kSheet = Rgb(0x0C121B, 0.97);
constexpr Color kGood = Rgb(0x34C77B);
constexpr Color kBad = Rgb(0xFF6B63);
constexpr Color kBrandStart = Rgb(0x5714FD);
constexpr Color kBrandEnd = Rgb(0x00DFFD);
constexpr char kCloseKey[] = "close";
constexpr char kFolderKey[] = "folder";
constexpr char kStartKey[] = "start";
constexpr char kChoicePrefix[] = "choice:";
constexpr char kPickPrefix[] = "pick:";
constexpr char kCancelPrefix[] = "cancel:";
constexpr char kShowPrefix[] = "show:";
constexpr char kDownloadGlyph[] = "M16 3v18m-7-7 7 7 7-7M5 23v6h22v-6";

Color Faded(Color color, double alpha) {
    color.a *= alpha;
    return color;
}

bool Inside(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

bool Starts(const std::string& text, const char* prefix) {
    return text.rfind(prefix, 0) == 0;
}

Command Action(std::string name) {
    Command command;
    command.name = std::move(name);
    command.action = true;
    return command;
}

// A long path keeps its end (the folder's own name), with an ellipsis at the start.
std::string ElideStart(const std::string& text, std::size_t keep) {
    if (text.size() <= keep) return text;
    std::size_t cut = text.size() - keep;
    while (cut < text.size() && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) ++cut;
    return "\xE2\x80\xA6" + text.substr(cut);
}

}  // namespace

void DownloadsScreen::SetView(DownloadsView view) {
    view_ = std::move(view);
    // A list whose field went away closes.
    if (list_.IsOpen() && std::none_of(view_.choices.begin(), view_.choices.end(),
                                       [&](const DownloadChoice& choice) { return choice.field == listField_; })) {
        list_.Close(clockMs_);
    }
    const std::vector<std::string> keys = Keys();
    if (std::find(keys.begin(), keys.end(), focused_) == keys.end()) {
        // The page opens on the Download button when there is something to download, else on Close.
        focused_ = std::find(keys.begin(), keys.end(), std::string(kStartKey)) != keys.end() ? kStartKey : kCloseKey;
    }
    scroll_ = std::clamp(scroll_, 0.0, MaxScroll());
}

void DownloadsScreen::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    scroll_ = std::clamp(scroll_, 0.0, MaxScroll());
}

double DownloadsScreen::Rem(double rems) const {
    return rems * ViewportRem(width_, height_);
}

Box DownloadsScreen::SheetBox() const {
    const double margin = CompactViewport(width_, height_) ? Rem(0.8) : Rem(2.2);
    const double width = std::min(Rem(kSheetMaxRem), width_ - 2.0 * Rem(1.2));
    return Box{width_ / 2.0 - width / 2.0, margin, width, std::max(1.0, height_ - 2.0 * margin)};
}

DownloadsScreen::Layout_ DownloadsScreen::Arrange() const {
    Layout_ layout;
    layout.sheet = SheetBox();
    const double pad = Rem(kPadRem);
    const double x = layout.sheet.x + pad;
    const double width = layout.sheet.width - 2.0 * pad;
    const double top = layout.sheet.y - scroll_;
    // Close stays at the sheet's top right while the content scrolls.
    const double close = Rem(2.4);
    layout.items.push_back({kCloseKey, Box{layout.sheet.Right() - Rem(0.9) - close, layout.sheet.y + Rem(0.9), close, close}});

    const bool titled = !view_.title.empty();
    layout.header = Box{layout.sheet.x, top, layout.sheet.width, titled ? Rem(10.0) : Rem(6.4)};
    double y = layout.header.Bottom() + Rem(0.6);

    if (titled) {
        // The choices, two to a row.
        layout.choicesTop = y;
        const double gap = Rem(kGapRem);
        const double column = (width - gap) / 2.0;
        const double block = Rem(kFieldHeadRem) + Rem(kControlRem);
        for (std::size_t i = 0; i < view_.choices.size(); ++i) {
            const double cx = x + static_cast<double>(i % 2) * (column + gap);
            const double cy = y + static_cast<double>(i / 2) * (block + gap);
            layout.items.push_back({kChoicePrefix + view_.choices[i].field,
                                    Box{cx, cy + Rem(kFieldHeadRem), column, Rem(kControlRem)}});
        }
        const std::size_t rows = (view_.choices.size() + 1) / 2;
        y += static_cast<double>(rows) * (block + gap);
        // The folder, then the button.
        layout.items.push_back({kFolderKey, Box{x, y + Rem(kFieldHeadRem), width, Rem(kControlRem)}});
        y += Rem(kFieldHeadRem) + Rem(kControlRem) + Rem(1.1);
        layout.items.push_back({kStartKey, Box{x, y, width, Rem(3.2)}});
        y += Rem(3.2) + Rem(0.7);
        if (!view_.status.empty()) {
            layout.statusTop = y;
            y += Rem(1.5);
        }
        if (!view_.message.empty()) {
            layout.messageTop = y;
            y += Rem(1.5);
        }
        if (!view_.note.empty()) {
            layout.noteTop = y;
            y += Rem(2.8);
        }
        y += Rem(0.6);
    } else if (!view_.message.empty()) {
        layout.messageTop = y;
        y += Rem(1.5);
    }

    // The downloads: a heading, then a card for each, or the empty state.
    layout.jobsTop = y;
    y += Rem(2.2);
    for (const DownloadJobView& job : view_.jobs) {
        const Box card{x, y, width, Rem(kCardRem)};
        const double buttonHeight = Rem(2.2);
        const double buttonY = card.y + Rem(0.7);
        double right = card.Right() - Rem(0.8);
        if (job.canShow) {
            const double w = Rem(6.4);
            layout.items.push_back({kShowPrefix + std::to_string(job.id), Box{right - w, buttonY, w, buttonHeight}});
            right -= w + Rem(0.5);
        }
        if (job.canCancel) {
            const double w = Rem(5.4);
            layout.items.push_back({kCancelPrefix + std::to_string(job.id), Box{right - w, buttonY, w, buttonHeight}});
        }
        y += Rem(kCardRem) + Rem(0.6);
    }
    if (view_.jobs.empty()) y += Rem(6.0);
    layout.contentHeight = y + scroll_ - layout.sheet.y + pad;
    return layout;
}

double DownloadsScreen::MaxScroll() const {
    if (width_ <= 0.0) return 0.0;
    const Layout_ layout = Arrange();
    return std::max(0.0, layout.contentHeight - layout.sheet.height);
}

std::vector<std::string> DownloadsScreen::Keys() const {
    if (list_.IsOpen()) {
        std::vector<std::string> keys;
        for (std::size_t i = 0; i < list_.Count(); ++i) keys.push_back(kPickPrefix + std::to_string(i));
        return keys;
    }
    std::vector<std::string> keys;
    for (const auto& [key, box] : Arrange().items) keys.push_back(key);
    return keys;
}

std::optional<Box> DownloadsScreen::BoxOf(const std::string& key) const {
    for (const auto& [name, box] : Arrange().items) {
        if (name == key) return box;
    }
    return std::nullopt;
}

bool DownloadsScreen::Tick(double nowMs) {
    clockMs_ = nowMs;
    focus_.Track(focused_, focusHidden_, nowMs, motion_);
    return Animating();
}

bool DownloadsScreen::Animating() const {
    return focus_.Animating(clockMs_) || list_.Animating(clockMs_);
}

void DownloadsScreen::FollowFocus() {
    const std::optional<Box> box = BoxOf(focused_);
    if (!box.has_value() || focused_ == kCloseKey) return;
    const Box sheet = SheetBox();
    double target = scroll_;
    if (box->y < sheet.y + Rem(1.0)) target -= sheet.y + Rem(1.0) - box->y;
    if (box->Bottom() > sheet.Bottom() - Rem(1.0)) target += box->Bottom() - (sheet.Bottom() - Rem(1.0));
    scroll_ = std::clamp(target, 0.0, MaxScroll());
}

bool DownloadsScreen::Navigate(nav::Direction direction, double nowMs) {
    if (list_.IsOpen()) return list_.Navigate(direction, nowMs);
    const std::optional<Box> from = BoxOf(focused_);
    if (!from.has_value()) {
        const std::vector<std::string> keys = Keys();
        if (keys.empty()) return false;
        focused_ = keys.front();
        return true;
    }
    // The nearest item in that direction, by the boxes on screen: rows for Up and Down, the same row for Left and
    // Right.
    const Layout_ layout = Arrange();
    std::optional<std::string> best;
    double bestScore = 0.0;
    for (const auto& [key, box] : layout.items) {
        if (key == focused_) continue;
        const double dx = box.CenterX() - from->CenterX();
        const double dy = box.CenterY() - from->CenterY();
        double score = 0.0;
        switch (direction) {
        case nav::Direction::Up:
            if (dy >= -1.0) continue;
            score = -dy * 4.0 + std::abs(dx);
            break;
        case nav::Direction::Down:
            if (dy <= 1.0) continue;
            score = dy * 4.0 + std::abs(dx);
            break;
        case nav::Direction::Left:
            if (dx >= -1.0 || std::abs(dy) > from->height) continue;
            score = -dx;
            break;
        case nav::Direction::Right:
            if (dx <= 1.0 || std::abs(dy) > from->height) continue;
            score = dx;
            break;
        }
        if (!best.has_value() || score < bestScore) {
            best = key;
            bestScore = score;
        }
    }
    if (!best.has_value()) return false;
    focused_ = *best;
    FollowFocus();
    return true;
}

std::optional<Command> DownloadsScreen::Select(double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (list_.IsOpen()) return Activate(kPickPrefix + std::to_string(list_.Highlighted()), nowMs);
    return Activate(focused_, nowMs);
}

bool DownloadsScreen::FocusItem(const std::string& key, double nowMs, bool /*withCamera*/) {
    if (Starts(key, kPickPrefix)) {
        list_.Hover(std::stoul(key.substr(sizeof(kPickPrefix) - 1)), nowMs);
        return true;
    }
    if (key == focused_ || !BoxOf(key).has_value()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> DownloadsScreen::ItemAt(double x, double y) const {
    if (list_.IsOpen()) {
        if (const std::optional<std::size_t> row = list_.RowAt(x, y)) return kPickPrefix + std::to_string(*row);
        if (list_.Contains(x, y)) return std::nullopt;
        return std::string("list-dismiss");
    }
    const Layout_ layout = Arrange();
    for (const auto& [key, box] : layout.items) {
        // Only what shows inside the sheet can be picked.
        if (key != kCloseKey && (box.Bottom() < layout.sheet.y || box.y > layout.sheet.Bottom())) continue;
        if (Inside(box, x, y)) return key;
    }
    return std::nullopt;
}

std::optional<Command> DownloadsScreen::ActivateItem(const std::string& key, double nowMs) {
    clockMs_ = std::max(clockMs_, nowMs);
    if (key == "list-dismiss") {
        list_.Close(nowMs);
        return std::nullopt;
    }
    if (!Starts(key, kPickPrefix)) {
        if (!BoxOf(key).has_value()) return std::nullopt;
        focused_ = key;
    }
    return Activate(key, nowMs);
}

bool DownloadsScreen::CloseOverlay(double nowMs) {
    if (!list_.IsOpen()) return false;
    list_.Close(nowMs);
    return true;
}

std::optional<Command> DownloadsScreen::Activate(const std::string& key, double nowMs) {
    if (Starts(key, kPickPrefix)) {
        // A row of the open list: the app saves the choice by its index.
        Command command = Action("info:dl-set-" + listField_);
        command.params["index"] = key.substr(sizeof(kPickPrefix) - 1);
        list_.Close(nowMs);
        focused_ = kChoicePrefix + listField_;
        return command;
    }
    if (key == kCloseKey) return Action("back");
    if (key == kFolderKey) return Action("info:dl-folder");
    if (key == kStartKey) {
        if (!view_.startEnabled) return std::nullopt;
        return Action("info:dl-start");
    }
    if (Starts(key, kCancelPrefix)) return Action("info:dl-cancel-" + key.substr(sizeof(kCancelPrefix) - 1));
    if (Starts(key, kShowPrefix)) return Action("info:dl-show-" + key.substr(sizeof(kShowPrefix) - 1));
    if (Starts(key, kChoicePrefix)) {
        const std::string field = key.substr(sizeof(kChoicePrefix) - 1);
        const auto choice = std::find_if(view_.choices.begin(), view_.choices.end(),
                                         [&](const DownloadChoice& c) { return c.field == field; });
        const std::optional<Box> box = BoxOf(key);
        if (choice == view_.choices.end() || !box.has_value() || choice->options.empty()) return std::nullopt;
        std::vector<DropdownOption> options;
        for (const std::string& option : choice->options) options.push_back(DropdownOption{option, ""});
        listField_ = field;
        list_.Open(*box, std::move(options), choice->chosen, width_, height_, ViewportRem(width_, height_), clockMs_,
                   motion_);
        return std::nullopt;
    }
    return std::nullopt;
}

std::optional<ScrollSurface> DownloadsScreen::SurfaceAt(double x, double y, nav::Axis axis) const {
    if (axis != nav::Axis::Y || list_.IsOpen()) return std::nullopt;
    const Box sheet = SheetBox();
    if (!Inside(sheet, x, y)) return std::nullopt;
    ScrollSurface surface;
    surface.kind = ScrollSurface::Kind::Page;
    surface.scroll = scroll_;
    surface.target = scroll_;
    surface.maxScroll = MaxScroll();
    surface.viewport = sheet.height;
    surface.canPan = surface.maxScroll > 0.0;
    return surface;
}

void DownloadsScreen::SetScroll(const ScrollSurface& /*surface*/, double value, double /*nowMs*/) {
    scroll_ = std::clamp(value, 0.0, MaxScroll());
}

void DownloadsScreen::AnimateScroll(const ScrollSurface& /*surface*/, double target, double /*nowMs*/) {
    scroll_ = std::clamp(target, 0.0, MaxScroll());
}

void DownloadsScreen::PaintHeader(Painter& painter, const Layout_& layout) const {
    const Box& header = layout.header;
    const double pad = Rem(kPadRem);
    if (view_.title.empty()) {
        painter.Text(Box{header.x + pad, header.y + Rem(1.5), header.width - 2.0 * pad, Rem(1.2)}, "YOUR OFFLINE LIBRARY",
                     TextStyle{Rem(0.75), true, 750}, tokens::kAccentStrong);
        painter.Text(Box{header.x + pad, header.y + Rem(2.7), header.width - 2.0 * pad, Rem(2.6)}, "Downloads",
                     TextStyle{Rem(2.1), true, 750}, tokens::kText);
        painter.Text(Box{header.x + pad, header.y + Rem(5.0), header.width - 2.0 * pad, Rem(1.4)},
                     "Your downloads keep going while you browse.", TextStyle{Rem(0.95), false, 450}, tokens::kTextMuted);
        return;
    }
    // The title's backdrop across the top of the sheet, fading into it.
    const double radius = Rem(kRadiusRem);
    if (!view_.backdropUrl.empty()) painter.ImageFaded(header, view_.backdropUrl, radius, 0.85, 0.5, 0.3);
    painter.FillRoundRectLinear(header, radius, header.x, header.y, header.x, header.Bottom(),
                                {GradientStop{0.0, Faded(kSheet, 0.35)}, GradientStop{0.55, Faded(kSheet, 0.75)},
                                 GradientStop{1.0, kSheet}});
    const Box poster{header.x + pad, header.y + Rem(1.6), Rem(4.6), Rem(6.9)};
    const bool hasPoster = !view_.posterUrl.empty() && painter.Image(poster, view_.posterUrl, Rem(0.6));
    if (!hasPoster) painter.FillRoundRect(poster, Rem(0.6), Faded(tokens::kText, 0.08));
    painter.Glass(poster, Rem(0.6), [] {
        GlassStyle rim = glass::NavCapsule();
        rim.kind = GlassKind::Card;
        rim.rimOnly = true;
        return rim;
    }());
    const double textX = poster.Right() + Rem(1.2);
    const double textWidth = header.Right() - pad - textX - Rem(2.6);
    painter.Text(Box{textX, poster.y + Rem(1.4), textWidth, Rem(1.2)}, "DOWNLOAD", TextStyle{Rem(0.75), true, 750},
                 tokens::kAccentStrong);
    painter.Text(Box{textX, poster.y + Rem(2.5), textWidth, Rem(2.4)}, view_.title, TextStyle{Rem(1.75), true, 750},
                 tokens::kText);
    if (!view_.subtitle.empty()) {
        painter.Text(Box{textX, poster.y + Rem(4.7), textWidth, Rem(1.4)}, view_.subtitle,
                     TextStyle{Rem(0.95), false, 450}, tokens::kTextMuted);
    }
}

void DownloadsScreen::PaintChoice(Painter& painter, const DownloadChoice& choice, const Box& box) const {
    const std::string key = kChoicePrefix + choice.field;
    painter.Text(Box{box.x + Rem(0.2), box.y - Rem(kFieldHeadRem), box.width, Rem(kFieldHeadRem) * 0.85}, choice.heading,
                 TextStyle{Rem(0.78), true, 650}, tokens::kTextFaint);
    // The nav pill's resting glass, with its hover plate under the pointer or the remote (and while its list is open).
    const double radius = Rem(0.75);
    const bool open = list_.IsOpen() && listField_ == choice.field;
    const double amount = open ? 1.0 : focus_.Amount(key, clockMs_);
    painter.FillRoundRect(box, radius, Faded(tokens::kText, 0.05));
    painter.Glass(box, radius, glass::NavCapsule());
    if (amount > 0.01) painter.Glass(box, radius, glass::NavHover(amount));
    const Color ink = glass::InkOnPlate(amount);
    const std::string value = choice.chosen < choice.options.size() ? choice.options[choice.chosen] : "";
    painter.Text(Box{box.x + Rem(1.0), box.y, box.width - Rem(3.2), box.height}, value, TextStyle{Rem(0.98), true, 620},
                 ink);
    const double chev = Rem(0.85);
    painter.Path(Box{box.Right() - Rem(1.0) - chev, box.CenterY() - chev / 2.0, chev, chev}, 24.0,
                 open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6", PathStyle{Color{0, 0, 0, 0}, ink, 2.4, false});
}

void DownloadsScreen::PaintJob(Painter& painter, const DownloadJobView& job, const Box& card) const {
    const double radius = Rem(1.0);
    painter.FillRoundRect(card, radius, Faded(tokens::kText, 0.04));
    painter.Glass(card, radius, glass::NavCapsule());
    // A status chip at the left, then the title and the status line.
    std::string chip = "Queued";
    Color chipColor = tokens::kTextMuted;
    if (job.state == "resolving") chip = "Finding";
    if (job.state == "downloading") {
        chip = job.progress >= 0.0 ? std::to_string(static_cast<int>(std::floor(job.progress * 100.0))) + "%" : "Downloading";
        chipColor = tokens::kAccentStrong;
    }
    if (job.state == "complete") {
        chip = "Done";
        chipColor = kGood;
    }
    if (job.state == "failed") {
        chip = "Failed";
        chipColor = kBad;
    }
    if (job.state == "cancelled") chip = "Cancelled";
    const TextStyle chipStyle{Rem(0.72), true, 750};
    const double chipWidth = painter.MeasureText(chip, chipStyle) + Rem(1.2);
    const Box chipBox{card.x + Rem(1.0), card.y + Rem(0.85), chipWidth, Rem(1.5)};
    painter.FillRoundRect(chipBox, chipBox.height / 2.0, Faded(chipColor, 0.16));
    painter.Text(Box{chipBox.x + Rem(0.6), chipBox.y, chipWidth, chipBox.height}, chip, chipStyle, chipColor);
    double right = card.Right() - Rem(0.8);
    for (const char* prefix : {kShowPrefix, kCancelPrefix}) {
        const std::optional<Box> box = BoxOf(prefix + std::to_string(job.id));
        if (box.has_value()) right = std::min(right, box->x - Rem(0.5));
    }
    const double textX = chipBox.Right() + Rem(0.8);
    painter.Text(Box{textX, card.y + Rem(0.55), right - textX, Rem(2.0)}, job.title, TextStyle{Rem(0.98), true, 650},
                 tokens::kText);
    painter.Text(Box{card.x + Rem(1.0), card.y + Rem(2.5), card.width - Rem(2.0), Rem(1.2)}, job.status,
                 TextStyle{Rem(0.8), false, 450}, job.state == "failed" ? kBad : tokens::kTextMuted);
    // The progress bar along the foot of the card, in the brand's gradient.
    const Box track{card.x + Rem(1.0), card.Bottom() - Rem(0.85), card.width - Rem(2.0), Rem(0.28)};
    painter.FillRoundRect(track, track.height / 2.0, Faded(tokens::kText, 0.12));
    double share = job.progress;
    if (job.state == "complete") share = 1.0;
    if (share > 0.0) {
        const Box fill{track.x, track.y, track.width * std::clamp(share, 0.0, 1.0), track.height};
        painter.FillRoundRectLinear(fill, track.height / 2.0, track.x, 0.0, track.Right(), 0.0,
                                    {GradientStop{0.0, kBrandStart}, GradientStop{1.0, job.state == "complete" ? kGood : kBrandEnd}});
    }
    // Cancel or Show file: small glass buttons.
    const auto small = [&](const std::string& key, const std::string& label) {
        const std::optional<Box> box = BoxOf(key);
        if (!box.has_value()) return;
        const double amount = focus_.Amount(key, clockMs_);
        painter.Glass(*box, box->height / 2.0, glass::NavCapsule());
        if (amount > 0.01) painter.Glass(*box, box->height / 2.0, glass::NavHover(amount));
        const TextStyle style{Rem(0.8), true, 650};
        const double w = painter.MeasureText(label, style);
        painter.Text(Box{box->CenterX() - w / 2.0, box->y, w + 2.0, box->height}, label, style, glass::InkOnPlate(amount));
    };
    if (job.canCancel) small(kCancelPrefix + std::to_string(job.id), "Cancel");
    if (job.canShow) small(kShowPrefix + std::to_string(job.id), "Show file");
}

void DownloadsScreen::Paint(Painter& painter) const {
    if (width_ <= 0.0 || height_ <= 0.0) return;
    const Metrics metrics{ViewportRem(width_, height_)};
    // The page it was opened over dims; the sheet floats over it.
    painter.FillRoundRect(Box{0.0, 0.0, width_, height_}, 0.0, Rgb(0x000000, 0.62));
    const Layout_ layout = Arrange();
    const Box& sheet = layout.sheet;
    const double radius = Rem(kRadiusRem);
    for (int layer = 3; layer >= 1; --layer) {
        const double spread = Rem(0.3) * layer;
        painter.FillRoundRect(Box{sheet.x - spread, sheet.y - spread + Rem(0.5), sheet.width + 2.0 * spread,
                                  sheet.height + 2.0 * spread},
                              radius + spread, Rgb(0x000000, 0.12));
    }
    painter.FillRoundRect(sheet, radius, kSheet);
    painter.Glass(sheet, radius, glass::NavCapsule());

    painter.PushClip(sheet);
    PaintHeader(painter, layout);
    const double pad = Rem(kPadRem);
    const double x = sheet.x + pad;
    const double width = sheet.width - 2.0 * pad;
    for (const DownloadChoice& choice : view_.choices) {
        if (const std::optional<Box> box = BoxOf(kChoicePrefix + choice.field)) PaintChoice(painter, choice, *box);
    }
    if (const std::optional<Box> folder = BoxOf(kFolderKey)) {
        painter.Text(Box{folder->x + Rem(0.2), folder->y - Rem(kFieldHeadRem), folder->width, Rem(kFieldHeadRem) * 0.85},
                     "Save to", TextStyle{Rem(0.78), true, 650}, tokens::kTextFaint);
        const double amount = focus_.Amount(kFolderKey, clockMs_);
        const double r = Rem(0.75);
        painter.FillRoundRect(*folder, r, Faded(tokens::kText, 0.05));
        painter.Glass(*folder, r, glass::NavCapsule());
        if (amount > 0.01) painter.Glass(*folder, r, glass::NavHover(amount));
        const Color ink = glass::InkOnPlate(amount);
        const double icon = Rem(1.15);
        painter.Path(Box{folder->x + Rem(0.9), folder->CenterY() - icon / 2.0, icon, icon}, 24.0,
                     "M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5"
                     "a1.5 1.5 0 0 1-1.5-1.5z",
                     PathStyle{Color{0, 0, 0, 0}, ink, 1.8, false});
        const TextStyle changeStyle{Rem(0.88), true, 650};
        const double changeWidth = painter.MeasureText("Change", changeStyle);
        painter.Text(Box{folder->Right() - Rem(1.0) - changeWidth, folder->y, changeWidth + 2.0, folder->height}, "Change",
                     changeStyle, amount > 0.5 ? ink : tokens::kAccentStrong);
        const double pathX = folder->x + Rem(2.6);
        const double pathWidth = folder->Right() - Rem(2.0) - changeWidth - pathX;
        const std::string path = view_.folder.empty() ? "Choose a folder on this device"
                                                      : ElideStart(view_.folder, static_cast<std::size_t>(std::max(
                                                                                     12.0, pathWidth / (Rem(0.9) * 0.52))));
        painter.Text(Box{pathX, folder->y, pathWidth, folder->height}, path, TextStyle{Rem(0.9), false, 500},
                     view_.folder.empty() ? tokens::kTextFaint : ink);
    }
    if (const std::optional<Box> start = BoxOf(kStartKey)) {
        const double amount = focus_.Amount(kStartKey, clockMs_);
        if (view_.startEnabled) {
            DrawButton(painter, metrics, *start, view_.startLabel, ButtonLook{true, ShowsFocus(focused_, kStartKey), amount});
        } else {
            painter.Glass(*start, start->height / 2.0, glass::NavCapsule(0.7));
            const TextStyle style{Rem(1.0), true, 650};
            const double w = painter.MeasureText(view_.startLabel, style);
            painter.Text(Box{start->CenterX() - w / 2.0, start->y, w + 2.0, start->height}, view_.startLabel, style,
                         tokens::kTextFaint);
        }
    }
    if (layout.statusTop > 0.0) {
        painter.Text(Box{x, layout.statusTop, width, Rem(1.4)}, view_.status, TextStyle{Rem(0.88), false, 500},
                     tokens::kTextMuted);
    }
    if (layout.messageTop > 0.0) {
        painter.Text(Box{x, layout.messageTop, width, Rem(1.4)}, view_.message, TextStyle{Rem(0.9), true, 600},
                     view_.messageBad ? kBad : tokens::kAccentStrong);
    }
    if (layout.noteTop > 0.0) {
        painter.Paragraph(Box{x, layout.noteTop, width, Rem(2.8)}, view_.note, TextStyle{Rem(0.8), false, 450},
                          tokens::kTextFaint);
    }

    // The downloads.
    std::size_t active = 0;
    for (const DownloadJobView& job : view_.jobs) {
        if (job.state == "queued" || job.state == "resolving" || job.state == "downloading") ++active;
    }
    const std::string heading = active > 0 ? "Downloads \xC2\xB7 " + std::to_string(active) + " active" : "Downloads";
    painter.Text(Box{x, layout.jobsTop, width, Rem(1.9)}, view_.title.empty() ? (active > 0 ? heading : "") : heading,
                 TextStyle{Rem(1.15), true, 700}, tokens::kText);
    double y = layout.jobsTop + Rem(2.2);
    for (const DownloadJobView& job : view_.jobs) {
        PaintJob(painter, job, Box{x, y, width, Rem(kCardRem)});
        y += Rem(kCardRem) + Rem(0.6);
    }
    if (view_.jobs.empty()) {
        // The empty state: a quiet download mark and a line of what to do.
        const double icon = Rem(2.4);
        painter.Path(Box{sheet.CenterX() - icon / 2.0, y + Rem(0.4), icon, icon}, 32.0, kDownloadGlyph,
                     PathStyle{Color{0, 0, 0, 0}, Faded(tokens::kText, 0.35), 2.2, false});
        const std::string line = view_.title.empty() ? "Nothing downloading yet. Open a film or series and choose Download."
                                                     : "Nothing downloading yet.";
        const TextStyle style{Rem(0.92), false, 500};
        const double w = std::min(painter.MeasureText(line, style), width);
        painter.Text(Box{sheet.CenterX() - w / 2.0, y + Rem(3.2), w + 2.0, Rem(1.4)}, line, style, tokens::kTextMuted);
    }
    painter.PopClip();

    // Close, at the top right, over the backdrop.
    if (const std::optional<Box> close = BoxOf(kCloseKey)) {
        const double amount = focus_.Amount(kCloseKey, clockMs_);
        painter.Glass(*close, close->height / 2.0, glass::NavCapsule());
        if (amount > 0.01) painter.Glass(*close, close->height / 2.0, glass::NavHover(amount));
        const double mark = close->width * 0.36;
        painter.Path(Box{close->CenterX() - mark / 2.0, close->CenterY() - mark / 2.0, mark, mark}, 24.0,
                     "M5 5l14 14M19 5L5 19", PathStyle{Color{0, 0, 0, 0}, glass::InkOnPlate(amount), 2.6, false});
    }
    list_.Paint(painter, clockMs_);
}

}  // namespace tvm::ui
