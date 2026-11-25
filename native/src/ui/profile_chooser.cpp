#include "ui/profile_chooser.h"

#include <algorithm>
#include <cmath>

#include "motion/preferences.h"
#include "ui/glass_styles.h"
#include "ui/layout.h"
#include "ui/theme.h"
#include "ui/widget.h"

namespace tvm::ui {

namespace {

// tvm-android.css §22, at 1080p rems: 100 px avatars with a 26 px radius, 104 px columns, 22 / 18 px gaps.
constexpr double kAvatarRem = 6.25;
constexpr double kAvatarRadiusRem = 1.6;
constexpr double kTileWidthRem = 7.5;
constexpr double kNameRem = 1.6;
constexpr double kColumnGapRem = 1.8;
constexpr double kRowGapRem = 1.6;
constexpr double kGridMaxRem = 44.0;
constexpr double kTitleRem = 2.0;
constexpr double kManageWidthRem = 13.0;
constexpr double kManageHeightRem = 2.9;
constexpr Color kRing = Rgb(0x3B9CFF);
// `cubic-bezier(.2,.8,.2,1)`, the pick's curve.
constexpr motion::CubicBezier kPickEase{0.2, 0.8, 0.2, 1.0};
constexpr char kAddKey[] = "add";
constexpr char kManageKey[] = "manage";
constexpr char kPickPrefix[] = "pick:";
constexpr char kPencilPath[] = "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4";
constexpr char kPlusPath[] = "M12 5v14M5 12h14";

Color WithAlpha(Color color, double alpha) {
    color.a = alpha;
    return color;
}

std::string Initial(const std::string& name) {
    if (name.empty()) return "?";
    // The first character, whole, even when it takes several bytes.
    std::size_t length = 1;
    const auto lead = static_cast<unsigned char>(name[0]);
    if (lead >= 0xF0) length = 4;
    else if (lead >= 0xE0) length = 3;
    else if (lead >= 0xC0) length = 2;
    std::string initial = name.substr(0, length);
    if (initial.size() == 1 && initial[0] >= 'a' && initial[0] <= 'z') initial[0] = static_cast<char>(initial[0] - 32);
    return initial;
}

Box Inflate(const Box& box, double by) {
    return Box{box.x - by, box.y - by, box.width + 2.0 * by, box.height + 2.0 * by};
}

Box Scaled(const Box& box, double scale) {
    const double width = box.width * scale;
    const double height = box.height * scale;
    return Box{box.CenterX() - width / 2.0, box.CenterY() - height / 2.0, width, height};
}

bool Inside(const Box& box, double x, double y) {
    return x >= box.x && x < box.Right() && y >= box.y && y < box.Bottom();
}

}  // namespace

Color AvatarColor(int hue) {
    const double h = std::fmod(std::fmod(static_cast<double>(hue), 360.0) + 360.0, 360.0) / 60.0;
    const double s = 0.62;
    const double l = 0.46;
    const double chroma = (1.0 - std::abs(2.0 * l - 1.0)) * s;
    const double x = chroma * (1.0 - std::abs(std::fmod(h, 2.0) - 1.0));
    const double m = l - chroma / 2.0;
    double r = 0.0, g = 0.0, b = 0.0;
    if (h < 1.0) { r = chroma; g = x; }
    else if (h < 2.0) { r = x; g = chroma; }
    else if (h < 3.0) { g = chroma; b = x; }
    else if (h < 4.0) { g = x; b = chroma; }
    else if (h < 5.0) { r = x; b = chroma; }
    else { r = chroma; b = x; }
    return Color{r + m, g + m, b + m, 1.0};
}

void ProfileChooser::SetView(ChooserView view) {
    view_ = std::move(view);
    picked_.clear();
    // A sheet for a profile that has gone closes.
    if (sheet_.has_value() && !sheet_->id.empty() &&
        std::none_of(view_.profiles.begin(), view_.profiles.end(),
                     [&](const ProfileEntry& profile) { return profile.id == sheet_->id; })) {
        sheet_.reset();
    }
    const std::vector<std::string> keys = Keys();
    if (std::find(keys.begin(), keys.end(), focused_) == keys.end()) {
        // The chooser opens on the active profile, as the Android chooser does.
        focused_ = keys.empty() ? std::string() : keys.front();
        for (const ProfileEntry& profile : view_.profiles) {
            if (profile.id == view_.activeId) focused_ = kPickPrefix + profile.id;
        }
    }
}

void ProfileChooser::Type(const std::string& text) {
    if (!sheet_.has_value()) return;
    for (const char c : text) {
        // Whole characters only, up to the limit, counted as the core counts them (in characters, not bytes).
        std::size_t characters = 0;
        for (const char existing : name_) {
            if ((static_cast<unsigned char>(existing) & 0xC0) != 0x80) ++characters;
        }
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80 && characters >= kNameLimit) return;
        name_.push_back(c);
    }
    sheet_->confirmDelete = false;
}

void ProfileChooser::Erase() {
    if (!sheet_.has_value() || name_.empty()) return;
    std::size_t cut = name_.size() - 1;
    while (cut > 0 && (static_cast<unsigned char>(name_[cut]) & 0xC0) == 0x80) --cut;
    name_.erase(cut);
}

void ProfileChooser::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

double ProfileChooser::Rem(double rems) const {
    return rems * ViewportRem(width_, height_);
}

std::size_t ProfileChooser::TileCount() const {
    return view_.profiles.size() + (view_.profiles.size() < view_.max ? 1 : 0);
}

std::string ProfileChooser::TileKey(std::size_t index) const {
    return index < view_.profiles.size() ? kPickPrefix + view_.profiles[index].id : std::string(kAddKey);
}

std::size_t ProfileChooser::Columns() const {
    const double room = std::min(width_ - 2.0 * Rem(2.5), Rem(kGridMaxRem));
    const auto fits = static_cast<std::size_t>(std::max(1.0, std::floor((room + Rem(kColumnGapRem)) /
                                                                        (Rem(kTileWidthRem) + Rem(kColumnGapRem)))));
    return std::clamp<std::size_t>(fits, 1, std::max<std::size_t>(1, TileCount()));
}

Box ProfileChooser::TileBox(std::size_t index) const {
    const std::size_t columns = Columns();
    const std::size_t row = index / columns;
    const std::size_t column = index % columns;
    // Each row is centred on its own, so a short last row sits in the middle.
    const std::size_t inRow = std::min(columns, TileCount() - row * columns);
    const double rowWidth = static_cast<double>(inRow) * Rem(kTileWidthRem) +
                            static_cast<double>(inRow > 0 ? inRow - 1 : 0) * Rem(kColumnGapRem);
    const double tileHeight = Rem(kAvatarRem) + Rem(0.75) + Rem(kNameRem);
    const double top = height_ * 0.12 + Rem(kTitleRem) * 1.4 + Rem(2.4);
    return Box{width_ / 2.0 - rowWidth / 2.0 + static_cast<double>(column) * (Rem(kTileWidthRem) + Rem(kColumnGapRem)),
               top + static_cast<double>(row) * (tileHeight + Rem(kRowGapRem)), Rem(kTileWidthRem), tileHeight};
}

Box ProfileChooser::SheetBox() const {
    const double width = std::min(Rem(30.0), width_ - 2.0 * Rem(1.5));
    const double height = Rem(17.0);
    return Box{width_ / 2.0 - width / 2.0, height_ / 2.0 - height / 2.0, width, height};
}

std::vector<std::string> ProfileChooser::SheetKeys() const {
    std::vector<std::string> keys = {"sheet-save"};
    if (sheet_.has_value() && !sheet_->id.empty() && view_.profiles.size() > 1) keys.push_back("sheet-delete");
    keys.push_back("sheet-cancel");
    return keys;
}

std::vector<std::string> ProfileChooser::Keys() const {
    if (sheet_.has_value()) return SheetKeys();
    std::vector<std::string> keys;
    for (std::size_t i = 0; i < TileCount(); ++i) keys.push_back(TileKey(i));
    keys.push_back(kManageKey);
    return keys;
}

std::optional<Box> ProfileChooser::BoxOf(const std::string& key) const {
    if (sheet_.has_value()) {
        const std::vector<std::string> keys = SheetKeys();
        const auto at = std::find(keys.begin(), keys.end(), key);
        if (at == keys.end()) return std::nullopt;
        const Box sheet = SheetBox();
        const double gap = Rem(0.7);
        const double buttonWidth = (sheet.width - 2.0 * Rem(1.5) - gap * static_cast<double>(keys.size() - 1)) /
                                   static_cast<double>(keys.size());
        const auto index = static_cast<double>(at - keys.begin());
        return Box{sheet.x + Rem(1.5) + index * (buttonWidth + gap), sheet.Bottom() - Rem(1.5) - Rem(2.9), buttonWidth,
                   Rem(2.9)};
    }
    for (std::size_t i = 0; i < TileCount(); ++i) {
        if (TileKey(i) == key) return TileBox(i);
    }
    if (key == kManageKey) {
        const Box last = TileBox(TileCount() - 1);
        return Box{width_ / 2.0 - Rem(kManageWidthRem) / 2.0, last.Bottom() + Rem(2.6), Rem(kManageWidthRem),
                   Rem(kManageHeightRem)};
    }
    return std::nullopt;
}

bool ProfileChooser::Tick(double nowMs) {
    clockMs_ = nowMs;
    focus_.Track(focused_, focusHidden_, nowMs, motion_);
    return Animating();
}

bool ProfileChooser::Animating() const {
    return focus_.Animating(clockMs_) || (!picked_.empty() && !pick_.Done(clockMs_));
}

bool ProfileChooser::Navigate(nav::Direction direction, double /*nowMs*/) {
    const std::vector<std::string> keys = Keys();
    const auto at = std::find(keys.begin(), keys.end(), focused_);
    if (at == keys.end()) {
        if (keys.empty()) return false;
        focused_ = keys.front();
        return true;
    }
    if (sheet_.has_value()) {
        // The sheet's buttons sit in a row.
        if (direction == nav::Direction::Right && at + 1 != keys.end()) focused_ = *(at + 1);
        else if (direction == nav::Direction::Left && at != keys.begin()) focused_ = *(at - 1);
        else return false;
        return true;
    }
    const std::size_t count = TileCount();
    const std::size_t columns = Columns();
    if (focused_ == kManageKey) {
        if (direction != nav::Direction::Up || count == 0) return false;
        // Up returns to the last row, to the tile nearest the middle.
        const std::size_t lastRow = (count - 1) / columns;
        const std::size_t first = lastRow * columns;
        focused_ = TileKey(first + (count - first) / 2);
        return true;
    }
    const auto index = static_cast<std::size_t>(at - keys.begin());
    const std::size_t row = index / columns;
    switch (direction) {
    case nav::Direction::Right:
        if (index + 1 < count && (index + 1) / columns == row) focused_ = TileKey(index + 1);
        else return false;
        return true;
    case nav::Direction::Left:
        if (index > 0 && (index - 1) / columns == row) focused_ = TileKey(index - 1);
        else return false;
        return true;
    case nav::Direction::Down:
        if ((row + 1) * columns < count) focused_ = TileKey(std::min(index + columns, count - 1));
        else focused_ = kManageKey;
        return true;
    case nav::Direction::Up:
        if (row == 0) return false;
        focused_ = TileKey(index - columns);
        return true;
    }
    return false;
}

std::optional<Command> ProfileChooser::Select(double nowMs) {
    return Activate(focused_, nowMs);
}

bool ProfileChooser::FocusItem(const std::string& key, double /*nowMs*/, bool /*withCamera*/) {
    const std::vector<std::string> keys = Keys();
    if (key == focused_ || std::find(keys.begin(), keys.end(), key) == keys.end()) return false;
    focused_ = key;
    return true;
}

std::optional<std::string> ProfileChooser::ItemAt(double x, double y) const {
    for (const std::string& key : Keys()) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && Inside(*box, x, y)) return key;
    }
    return std::nullopt;
}

std::optional<Command> ProfileChooser::ActivateItem(const std::string& key, double nowMs) {
    const std::vector<std::string> keys = Keys();
    if (std::find(keys.begin(), keys.end(), key) == keys.end()) return std::nullopt;
    focused_ = key;
    return Activate(key, nowMs);
}

void ProfileChooser::SetPressed(const std::optional<std::string>& key, double /*nowMs*/) {
    pressed_ = key;
}

std::optional<Command> ProfileChooser::Activate(const std::string& key, double nowMs) {
    Command command;
    command.action = true;
    if (sheet_.has_value()) {
        if (key == "sheet-cancel") {
            const std::string id = sheet_->id;
            sheet_.reset();
            focused_ = id.empty() ? std::string(kAddKey) : kPickPrefix + id;
            return std::nullopt;
        }
        if (key == "sheet-delete") {
            // The first press asks; the second deletes.
            if (!sheet_->confirmDelete) {
                sheet_->confirmDelete = true;
                return std::nullopt;
            }
            command.name = "profile-remove";
            command.params["id"] = sheet_->id;
            sheet_.reset();
            focused_ = kManageKey;
            return command;
        }
        if (key == "sheet-save") {
            std::string name = name_;
            const std::size_t first = name.find_first_not_of(' ');
            name = first == std::string::npos ? std::string() : name.substr(first, name.find_last_not_of(' ') - first + 1);
            if (name.empty()) return std::nullopt;
            command.name = sheet_->id.empty() ? "profile-create" : "profile-rename";
            if (!sheet_->id.empty()) command.params["id"] = sheet_->id;
            command.params["name"] = name;
            command.params["from"] = "chooser";
            focused_ = sheet_->id.empty() ? std::string(kAddKey) : kPickPrefix + sheet_->id;
            sheet_.reset();
            return command;
        }
        return std::nullopt;
    }
    if (key == kManageKey) {
        editMode_ = !editMode_;
        return std::nullopt;
    }
    if (key == kAddKey) {
        command.name = "profile-edit"; command.action = true;
        command.params["from"] = "chooser";
        return command;
    }
    if (key.rfind(kPickPrefix, 0) == 0) {
        const std::string id = key.substr(sizeof(kPickPrefix) - 1);
        if (editMode_) {
            // Edit mode: the sheet to rename or delete this profile.
            const auto profile = std::find_if(view_.profiles.begin(), view_.profiles.end(),
                                              [&](const ProfileEntry& p) { return p.id == id; });
            if (profile == view_.profiles.end()) return std::nullopt;
            command.name = "profile-edit";
            command.params["id"] = id;
            return command;
        }
        // The avatar scales down as it is picked, then the app switches and closes the chooser.
        const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
        picked_ = key;
        pick_ = motion::Tween(1.0, 0.94, nowMs, reduced ? 0.0 : kPickMs, kPickEase);
        command.name = "profile-open";
        command.params["id"] = id;
        command.params["from"] = "chooser";
        return command;
    }
    return std::nullopt;
}

void ProfileChooser::Paint(Painter& painter) const {
    painter.Clear(tokens::kBackground);
    painter.SetBackdrop(Box{0.0, 0.0, 0.0, 0.0}, "", 0.5, 0.2);
    const Metrics metrics{ViewportRem(width_, height_)};

    // The title, centred, at 12% of the height.
    const std::string title = editMode_ ? "Manage profiles" : "Who's watching?";
    const TextStyle titleStyle{Rem(kTitleRem), true, 750};
    const double titleWidth = painter.MeasureText(title, titleStyle);
    painter.Text(Box{width_ / 2.0 - titleWidth / 2.0, height_ * 0.12, titleWidth + 4.0, Rem(kTitleRem) * 1.4}, title,
                 titleStyle, tokens::kText);

    for (std::size_t i = 0; i < TileCount(); ++i) PaintTile(painter, i);

    // Manage sits under the grid (its box is asked for while the sheet is closed, so it is worked out here).
    const Box last = TileBox(TileCount() - 1);
    const Box manage{width_ / 2.0 - Rem(kManageWidthRem) / 2.0, last.Bottom() + Rem(2.6), Rem(kManageWidthRem),
                     Rem(kManageHeightRem)};
    if (!sheet_.has_value()) {
        DrawButton(painter, metrics, manage, editMode_ ? "Done" : "Manage profiles",
                   ButtonLook{editMode_, ShowsFocus(focused_, kManageKey), focus_.Amount(kManageKey, clockMs_)});
    }
    if (!view_.message.empty()) {
        const TextStyle style{Rem(0.95), true, 600};
        const double width = std::min(painter.MeasureText(view_.message, style), width_ - 2.0 * Rem(2.5));
        painter.Text(Box{width_ / 2.0 - width / 2.0, manage.Bottom() + Rem(1.2), width + 2.0, Rem(1.5)}, view_.message,
                     style, tokens::kAccentStrong);
    }
    if (sheet_.has_value()) PaintSheet(painter);
}

void ProfileChooser::PaintTile(Painter& painter, std::size_t index) const {
    const std::string key = TileKey(index);
    const Box tile = TileBox(index);
    const bool add = key == kAddKey;
    const double amount = sheet_.has_value() ? 0.0 : focus_.Amount(key, clockMs_);
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    // Hover or focus grows the avatar 4%; a press presses it to 96%; a pick scales it to 94%.
    double scale = reduced ? 1.0 : 1.0 + 0.04 * amount;
    if (pressed_ == std::optional<std::string>(key) && !reduced) scale = 0.96;
    if (key == picked_) scale = pick_.Value(clockMs_);
    const Box rest{tile.CenterX() - Rem(kAvatarRem) / 2.0, tile.y, Rem(kAvatarRem), Rem(kAvatarRem)};
    const Box avatar = Scaled(rest, scale);
    const double radius = Rem(kAvatarRadiusRem) * scale;

    const ProfileEntry* profile = add ? nullptr : &view_.profiles[index];
    const Color fill = add ? WithAlpha(tokens::kText, 0.08) : AvatarColor(profile->hue);
    if (amount > 0.01 && !add) {
        // A soft glow of the profile's colour behind it.
        const double glow = avatar.width * 0.95;
        painter.FillRadialGradient(Inflate(avatar, glow / 2.0), avatar.CenterX(), avatar.CenterY(), glow, glow,
                                   {GradientStop{0.0, WithAlpha(fill, 0.45 * amount)}, GradientStop{1.0, WithAlpha(fill, 0.0)}});
    }
    // A soft shadow under the tile.
    painter.FillRoundRect(Box{avatar.x, avatar.y + Rem(0.35), avatar.width, avatar.height}, radius, Rgb(0x000000, 0.28));
    painter.FillRoundRect(avatar, radius, fill);
    if (add) {
        painter.StrokeRoundRect(avatar, radius, 2.0, WithAlpha(tokens::kText, 0.28 + 0.4 * amount));
        const double plus = avatar.width * 0.38;
        painter.Path(Box{avatar.CenterX() - plus / 2.0, avatar.CenterY() - plus / 2.0, plus, plus}, 24.0, kPlusPath,
                     PathStyle{Color{0, 0, 0, 0}, WithAlpha(tokens::kText, 0.75 + 0.25 * amount), 2.2, false});
    } else {
        const std::string initial = Initial(profile->name);
        const TextStyle initialStyle{Rem(2.5) * scale, true, 750};
        const double initialWidth = painter.MeasureText(initial, initialStyle);
        if (profile->avatarUrl.empty() || !painter.Image(avatar, profile->avatarUrl, radius)) {
        painter.Text(Box{avatar.CenterX() - initialWidth / 2.0, avatar.y, initialWidth + 2.0, avatar.height}, initial,
                     initialStyle, Rgb(0xFFFFFF));
        }
        if (profile->locked) {
            const Box lock{avatar.Right() - Rem(1.7), avatar.Bottom() - Rem(1.7), Rem(1.35), Rem(1.35)};
            painter.Glass(lock, Rem(0.4), glass::MenuPanel());
            painter.Path(lock, 24, "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z", {{0,0,0,0}, Rgb(0xFFFFFF), 2, false});
        }
        // The active profile: a 3 px gap of the ground, then a 5 px blue ring.
        if (profile->id == view_.activeId && !editMode_) {
            painter.StrokeRoundRect(Inflate(avatar, 3.0 + 2.5), radius + 5.5, 5.0, kRing);
        }
        if (editMode_) {
            // Edit mode: a pencil on a white badge at the corner.
            const double badge = Rem(1.9);
            const Box disc{avatar.Right() - badge * 0.75, avatar.Bottom() - badge * 0.75, badge, badge};
            painter.FillRoundRect(disc, badge / 2.0, Rgb(0xFFFFFF));
            const double pen = badge * 0.56;
            painter.Path(Box{disc.CenterX() - pen / 2.0, disc.CenterY() - pen / 2.0, pen, pen}, 24.0, kPencilPath,
                         PathStyle{Color{0, 0, 0, 0}, Rgb(0x0B0F1A), 2.2, false});
        }
    }
    // The remote's focus ring, outside everything else.
    if (ShowsFocus(focused_, key) && !sheet_.has_value()) {
        painter.StrokeRoundRect(Inflate(avatar, 10.0), radius + 10.0, 3.0, tokens::kFocusRing);
    }
    const std::string name = add ? "Add Profile" : profile->name;
    const TextStyle nameStyle{Rem(0.95), true, 650};
    const double nameWidth = std::min(painter.MeasureText(name, nameStyle), tile.width + Rem(1.0));
    painter.Text(Box{tile.CenterX() - nameWidth / 2.0, rest.Bottom() + Rem(0.75), nameWidth + 2.0, Rem(kNameRem)}, name,
                 nameStyle, amount > 0.01 ? tokens::kText : tokens::kTextMuted);
}

void ProfileChooser::PaintSheet(Painter& painter) const {
    const Metrics metrics{ViewportRem(width_, height_)};
    painter.FillRoundRect(Box{0.0, 0.0, width_, height_}, 0.0, Rgb(0x000000, 0.55));
    const Box sheet = SheetBox();
    GlassStyle glass;
    glass.kind = GlassKind::Panel;
    glass.reduceTransparency = tokens::reduceTransparency;
    glass.tint = tokens::kBackgroundElevated;
    painter.Glass(sheet, Rem(1.4), glass);
    const bool adding = sheet_->id.empty();
    painter.Text(Box{sheet.x + Rem(1.5), sheet.y + Rem(1.3), sheet.width - Rem(3.0), Rem(2.0)},
                 adding ? "Add profile" : "Edit profile", TextStyle{Rem(1.4), true, 750}, tokens::kText);
    painter.Text(Box{sheet.x + Rem(1.5), sheet.y + Rem(3.7), sheet.width - Rem(3.0), Rem(1.3)}, "Name",
                 TextStyle{Rem(0.85), true, 600}, tokens::kTextMuted);
    const Box field{sheet.x + Rem(1.5), sheet.y + Rem(5.2), sheet.width - Rem(3.0), Rem(3.0)};
    painter.FillRoundRect(field, Rem(0.75), WithAlpha(tokens::kText, 0.08));
    painter.StrokeRoundRect(field, Rem(0.75), Rem(kFocusRingWidthRem), tokens::kFocusRing);
    const TextStyle style{Rem(1.15), false, 500};
    if (name_.empty()) {
        painter.Text(Box{field.x + Rem(1.0), field.y, field.width - Rem(2.0), field.height}, "Type a name",
                     style, tokens::kTextFaint);
    } else {
        painter.Text(Box{field.x + Rem(1.0), field.y, field.width - Rem(2.0), field.height}, name_, style, tokens::kText);
    }
    const double caretX = field.x + Rem(1.0) + std::min(painter.MeasureText(name_, style) + 2.0, field.width - Rem(2.0));
    painter.FillRoundRect(Box{caretX, field.y + field.height * 0.25, 2.0, field.height * 0.5}, 0.0, tokens::kText);
    if (sheet_->confirmDelete) {
        painter.Text(Box{sheet.x + Rem(1.5), field.Bottom() + Rem(0.5), sheet.width - Rem(3.0), Rem(1.4)},
                     "Delete this profile and its list and progress? Press Delete again.", TextStyle{Rem(0.85), true, 600},
                     Rgb(0xFF6B63));
    }
    for (const std::string& key : SheetKeys()) {
        const std::string label = key == "sheet-save"     ? "Save"
                                  : key == "sheet-delete" ? (sheet_->confirmDelete ? "Delete now" : "Delete")
                                                          : "Cancel";
        DrawButton(painter, metrics, *BoxOf(key), label,
                   ButtonLook{key == "sheet-save", ShowsFocus(focused_, key), focus_.Amount(key, clockMs_)});
    }
}

// ------------------------------------------------------------------ the orb's menu

namespace {

constexpr double kMenuWidthRem = 17.0;
constexpr double kMenuRowRem = 2.75;
constexpr double kMenuPadRem = 0.45;
constexpr double kMenuGapRem = 0.5;  // the rule between the profiles and the two links
// `--tvma-ease`, the Android popup's curve.
constexpr motion::CubicBezier kPopEase{0.22, 1.0, 0.36, 1.0};
constexpr char kSwitchPrefix[] = "switch:";
constexpr char kMenuManage[] = "menu-manage";
constexpr char kMenuSettings[] = "menu-settings";
constexpr char kMenuDismiss[] = "menu-dismiss";

}  // namespace

void ProfileMenu::SetView(ChooserView view) {
    view_ = std::move(view);
    const std::vector<std::string> keys = Keys();
    if (std::find(keys.begin(), keys.end(), focused_) == keys.end()) {
        focused_ = keys.empty() ? std::string() : keys.front();
        for (const ProfileEntry& profile : view_.profiles) {
            if (profile.id == view_.activeId) focused_ = kSwitchPrefix + profile.id;
        }
    }
    // The highlight rests on the focused row.
    const auto at = std::find(keys.begin(), keys.end(), focused_);
    const double index = at == keys.end() ? 0.0 : static_cast<double>(at - keys.begin());
    row_ = motion::Tween(index, index, 0.0, 0.0);
}

void ProfileMenu::Layout(double width, double height) {
    width_ = width;
    height_ = height;
}

double ProfileMenu::Rem(double rems) const {
    return rems * ViewportRem(width_, height_);
}

std::vector<std::string> ProfileMenu::Keys() const {
    std::vector<std::string> keys;
    for (const ProfileEntry& profile : view_.profiles) keys.push_back(kSwitchPrefix + profile.id);
    keys.push_back(kMenuManage);
    const bool kids = std::any_of(view_.profiles.begin(), view_.profiles.end(), [this](const auto& p) { return p.id == view_.activeId && p.kind == "kids"; });
    if (!kids) keys.push_back(kMenuSettings);
    return keys;
}

Box ProfileMenu::PanelBox() const {
    const double rows = static_cast<double>(Keys().size());
    const double height = 2.0 * Rem(kMenuPadRem) + rows * Rem(kMenuRowRem) + Rem(kMenuGapRem);
    const double width = std::min(Rem(kMenuWidthRem), width_ - 2.0 * Rem(1.0));
    // Under the orb at the top right of the stream chrome.
    return Box{width_ - Rem(2.5) - width, Rem(2.0) + Rem(3.25) + Rem(0.7), width, height};
}

std::optional<Box> ProfileMenu::BoxOf(const std::string& key) const {
    const Box panel = PanelBox();
    const std::vector<std::string> keys = Keys();
    const auto at = std::find(keys.begin(), keys.end(), key);
    if (at == keys.end()) return std::nullopt;
    const auto index = static_cast<std::size_t>(at - keys.begin());
    double y = panel.y + Rem(kMenuPadRem) + static_cast<double>(index) * Rem(kMenuRowRem);
    if (index >= view_.profiles.size()) y += Rem(kMenuGapRem);
    return Box{panel.x + Rem(kMenuPadRem), y, panel.width - 2.0 * Rem(kMenuPadRem), Rem(kMenuRowRem)};
}

double ProfileMenu::OpenAmount() const {
    if (openedMs_ < 0.0 || motion::PrefersReducedMotion(motion_) || tokens::reduceMotion) return 1.0;
    return kPopEase.Ease(std::clamp((clockMs_ - openedMs_) / kOpenMs, 0.0, 1.0));
}

bool ProfileMenu::Tick(double nowMs) {
    clockMs_ = nowMs;
    if (openedMs_ < 0.0) openedMs_ = nowMs;
    return Animating();
}

bool ProfileMenu::Animating() const {
    return OpenAmount() < 1.0 || !row_.Done(clockMs_);
}

bool ProfileMenu::Navigate(nav::Direction direction, double nowMs) {
    const std::vector<std::string> keys = Keys();
    auto at = std::find(keys.begin(), keys.end(), focused_);
    if (at == keys.end()) return false;
    const double from = row_.Value(nowMs);
    if (direction == nav::Direction::Down && at + 1 != keys.end()) ++at;
    else if (direction == nav::Direction::Up && at != keys.begin()) --at;
    else return true;  // The menu holds the remote while it is open.
    focused_ = *at;
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    row_ = motion::Tween(from, static_cast<double>(at - keys.begin()), nowMs, reduced ? 0.0 : 160.0, kPopEase);
    return true;
}

std::optional<Command> ProfileMenu::Select(double /*nowMs*/) {
    return Activate(focused_);
}

bool ProfileMenu::FocusItem(const std::string& key, double nowMs, bool /*withCamera*/) {
    const std::vector<std::string> keys = Keys();
    const auto at = std::find(keys.begin(), keys.end(), key);
    if (at == keys.end() || key == focused_) return false;
    const bool reduced = motion::PrefersReducedMotion(motion_) || tokens::reduceMotion;
    focused_ = key;
    row_ = motion::Tween(row_.Value(nowMs), static_cast<double>(at - keys.begin()), nowMs, reduced ? 0.0 : 160.0,
                         kPopEase);
    return true;
}

std::optional<std::string> ProfileMenu::ItemAt(double x, double y) const {
    for (const std::string& key : Keys()) {
        const std::optional<Box> box = BoxOf(key);
        if (box.has_value() && Inside(*box, x, y)) return key;
    }
    // A click anywhere off the panel closes the menu.
    if (!Inside(PanelBox(), x, y)) return std::string(kMenuDismiss);
    return std::nullopt;
}

std::optional<Command> ProfileMenu::ActivateItem(const std::string& key, double /*nowMs*/) {
    if (key != kMenuDismiss) {
        const std::vector<std::string> keys = Keys();
        if (std::find(keys.begin(), keys.end(), key) == keys.end()) return std::nullopt;
        focused_ = key;
    }
    return Activate(key);
}

std::optional<Command> ProfileMenu::Activate(const std::string& key) const {
    Command command;
    command.action = true;
    if (key.rfind(kSwitchPrefix, 0) == 0) {
        command.name = "profile-open";
        command.params["id"] = key.substr(sizeof(kSwitchPrefix) - 1);
        command.params["from"] = "menu";
    } else if (key == kMenuManage) {
        command.name = "profile-manage";
    } else if (key == kMenuSettings) {
        command.name = "profile-settings";
    } else if (key == kMenuDismiss) {
        command.name = "back";
    } else {
        return std::nullopt;
    }
    return command;
}

void ProfileMenu::Paint(Painter& painter) const {
    const double open = OpenAmount();
    const Box rest = PanelBox();
    // It pops from the orb: a short fade with a slight scale from the top right.
    const double scale = 0.96 + 0.04 * open;
    const Box panel{rest.Right() - rest.width * scale, rest.y - Rem(0.3) * (1.0 - open), rest.width * scale,
                    rest.height * scale};
    const double radius = Rem(1.375);
    // A frosted Liquid Glass menu, as Apple's are: its own soft shadow, the artwork diffused behind the rows.
    painter.Glass(panel, radius, glass::MenuPanel(open));

    const std::vector<std::string> keys = Keys();
    const auto at = std::find(keys.begin(), keys.end(), focused_);
    if (at != keys.end() && !focusHidden_) {
        // The highlight: the glass pill, sliding between rows.
        const double index = std::clamp(row_.Value(clockMs_), 0.0, static_cast<double>(keys.size() - 1));
        const double whole = std::floor(index);
        Box row = *BoxOf(keys[static_cast<std::size_t>(std::clamp(whole, 0.0, static_cast<double>(keys.size() - 1)))]);
        if (whole + 1.0 < static_cast<double>(keys.size())) {
            const Box next = *BoxOf(keys[static_cast<std::size_t>(whole) + 1]);
            row.y += (next.y - row.y) * (index - whole);
        }
        const Box pill{row.x, row.y + Rem(0.1), row.width, row.height - Rem(0.2)};
        painter.FillRoundRect(pill, pill.height / 2.0, Rgb(0xFFFFFF, 0.10 * open));
        GlassStyle glass;
        glass.kind = GlassKind::Pill;
        glass.focused = true;
        glass.focusAmount = 1.0;
        glass.opacity = open;
        glass.reduceTransparency = tokens::reduceTransparency;
        painter.Glass(pill, pill.height / 2.0, glass);
    }

    for (std::size_t i = 0; i < keys.size(); ++i) {
        const Box row = *BoxOf(keys[i]);
        const Color ink = Rgb(0xFFFFFF, (keys[i] == focused_ ? 1.0 : 0.86) * open);
        const double x = row.x + Rem(0.7);
        if (i < view_.profiles.size()) {
            const ProfileEntry& profile = view_.profiles[i];
            const double avatar = Rem(1.7);
            const Box plate{x, row.CenterY() - avatar / 2.0, avatar, avatar};
            painter.FillRoundRect(plate, Rem(0.45), WithAlpha(AvatarColor(profile.hue), open));
            const std::string initial = Initial(profile.name);
            const TextStyle initialStyle{Rem(0.85), true, 750};
            const double w = painter.MeasureText(initial, initialStyle);
            painter.Text(Box{plate.CenterX() - w / 2.0, plate.y, w + 2.0, plate.height}, initial, initialStyle,
                         Rgb(0xFFFFFF, open));
            const bool active = profile.id == view_.activeId;
            painter.Text(Box{plate.Right() + Rem(0.7), row.y, row.Right() - plate.Right() - Rem(3.0), row.height},
                         profile.name, TextStyle{Rem(0.92), true, active ? 700 : 550}, ink);
            if (active) {
                const double tick = Rem(1.0);
                painter.Path(Box{row.Right() - Rem(0.8) - tick, row.CenterY() - tick / 2.0, tick, tick}, 32.0,
                             "M6 16.5l6.5 6.5L26 9.5", PathStyle{Color{0, 0, 0, 0}, Rgb(0x3B9CFF, open), 3.2, false});
            }
        } else {
            if (i == view_.profiles.size()) {
                painter.FillRoundRect(Box{row.x + Rem(0.6), row.y - Rem(kMenuGapRem) / 2.0 - 0.5, row.width - Rem(1.2), 1.0},
                                      0.0, Rgb(0xFFFFFF, 0.10 * open));
            }
            const bool manage = keys[i] == kMenuManage;
            const double icon = Rem(1.15);
            painter.Path(Box{x + Rem(0.28), row.CenterY() - icon / 2.0, icon, icon}, 24.0,
                         manage ? "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"
                                : "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z",
                         PathStyle{Color{0, 0, 0, 0}, ink, 1.9, false});
            painter.Text(Box{x + Rem(2.4), row.y, row.width - Rem(3.2), row.height}, manage ? "Manage profiles" : "Settings",
                         TextStyle{Rem(0.92), true, 600}, ink);
        }
    }
}

}  // namespace tvm::ui
