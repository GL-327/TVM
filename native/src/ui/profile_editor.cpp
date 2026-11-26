#include "ui/profile_editor.h"

#include <algorithm>
#include <cmath>
#include "ui/controls.h"
#include "ui/glass_styles.h"
#include "ui/profile_chooser.h"

namespace tvm::ui {
ProfileEditor::ProfileEditor() { focused_ = "name"; }
void ProfileEditor::SetProfile(ProfileEntry profile, nlohmann::json avatars, const std::string& featured) {
    profile_ = std::move(profile);
    name_ = profile_.name;
    sets_ = avatars.value("sets", nlohmann::json::array());
    std::stable_sort(sets_.begin(), sets_.end(), [&](const auto& a, const auto& b) { return a.value("id", "") == featured && b.value("id", "") != featured; });
    if (!featured.empty() && !sets_.empty() && sets_[0].value("id", "") == featured) sets_[0]["title"] = "Featured · " + sets_[0].value("title", "");
    // The tiles open on the set the profile's character comes from.
    set_ = 0;
    for (std::size_t i = 0; i < sets_.size(); ++i) {
        if (!profile_.avatar.empty() && profile_.avatar.rfind(sets_[i].value("id", "") + "/", 0) == 0) set_ = i;
    }
    setScroll_ = 0;
    ShowSet(set_);
    focused_ = "name";
}
void ProfileEditor::Challenge(const std::string& id, const std::string& name) {
    challenge_ = true; profile_.id = id; name_ = name; pin_.clear(); focused_ = "digit:1";
}
void ProfileEditor::Type(const std::string& text) {
    if (challenge_ || focused_ == "pin") {
        for (char c : text) if (c >= '0' && c <= '9' && pin_.size() < 4) { pin_ += c; pinChanged_ = true; removePin_ = false; }
    } else if (focused_ == "name") {
        for (char c : text) if (static_cast<unsigned char>(c) >= 32 && name_.size() < 96) name_ += c;
    }
}
void ProfileEditor::Erase() {
    auto& value = challenge_ || focused_ == "pin" ? pin_ : name_;
    if (value.empty()) return;
    std::size_t cut = value.size() - 1;
    while (cut > 0 && (static_cast<unsigned char>(value[cut]) & 0xC0) == 0x80) --cut;
    value.erase(cut);
}
void ProfileEditor::Fail(const std::string& message, double nowMs) { message_ = message; pin_.clear(); shakeUntil_ = nowMs + 480; }
bool ProfileEditor::Tick(double nowMs) { return PageScreen::Tick(nowMs) || Animating(); }
bool ProfileEditor::Animating() const { return PageScreen::Animating() || clockMs_ < shakeUntil_; }
std::vector<nlohmann::json> ProfileEditor::Avatars() const {
    std::vector<nlohmann::json> result;
    if (set_ >= sets_.size()) return result;
    for (const auto& avatar : sets_[set_]["avatars"]) if (avatar.is_object()) result.push_back(avatar);
    return result;
}
// The avatar sets are one row of tiles that scrolls sideways; the characters sit in a grid under it.
namespace {
constexpr double kSetsTopRem = 32.2;
constexpr double kSetTileRem = 9.2;
constexpr double kSetStepRem = 10.1;
constexpr double kSetsHeightRem = 8.0;
constexpr double kAvatarCircleRem = 6.0;
constexpr double kAvatarCellWidthRem = 7.8;
constexpr double kAvatarCellHeightRem = 9.6;
constexpr std::size_t kAvatarsPerRow = 7;
}  // namespace
double ProfileEditor::SetsLeft() const { return Rem(5.5); }
double ProfileEditor::SetsWidth() const { return std::min(width_ - SetsLeft() * 2, Rem(58)); }
double ProfileEditor::SetTileX(std::size_t index) const { return SetsLeft() + static_cast<double>(index) * Rem(kSetStepRem) - setScroll_; }
double ProfileEditor::SetsMaxScroll() const {
    return std::max(0.0, static_cast<double>(sets_.size()) * Rem(kSetStepRem) - (Rem(kSetStepRem) - Rem(kSetTileRem)) - SetsWidth());
}
void ProfileEditor::ShowSet(std::size_t index) {
    // Scrolls the row just far enough to show the whole tile.
    const double left = static_cast<double>(index) * Rem(kSetStepRem);
    const double right = left + Rem(kSetTileRem);
    if (left < setScroll_) setScroll_ = left;
    else if (right > setScroll_ + SetsWidth()) setScroll_ = right - SetsWidth();
    setScroll_ = std::clamp(setScroll_, 0.0, SetsMaxScroll());
}
bool ProfileEditor::Navigate(nav::Direction direction, double nowMs) {
    // Along the row of sets the focus moves tile by tile, and the row follows it.
    if (!challenge_ && focused_.rfind("set:", 0) == 0 &&
        (direction == nav::Direction::Left || direction == nav::Direction::Right)) {
        const std::size_t index = std::stoul(focused_.substr(4));
        if (direction == nav::Direction::Left && index == 0) return false;
        const std::size_t next = direction == nav::Direction::Left ? index - 1 : index + 1;
        if (next >= sets_.size()) return false;
        focused_ = "set:" + std::to_string(next);
        ShowSet(next);
        return true;
    }
    return PageScreen::Navigate(direction, nowMs);
}
std::vector<std::string> ProfileEditor::ButtonKeys() const {
    std::vector<std::string> keys;
    for (const PageButton& button : Buttons()) keys.push_back(button.key);
    return keys;
}
double ProfileEditor::AvatarTop() const { return Rem(kSetsTopRem + kSetsHeightRem + 3.2); }
std::vector<PageButton> ProfileEditor::Buttons() const {
    std::vector<PageButton> buttons;
    if (challenge_) {
        const double size = Rem(4), gap = Rem(0.7), left = width_ / 2 - (3 * size + 2 * gap) / 2;
        for (int i = 0; i < 12; ++i) {
            const std::string digit = i < 9 ? std::to_string(i + 1) : i == 9 ? "erase" : i == 10 ? "0" : "enter";
            buttons.push_back({"digit:" + digit, digit == "erase" ? "\xE2\x8C\xAB" : digit == "enter" ? "OK" : digit,
                               {left + (i % 3) * (size + gap), Rem(22) + (i / 3) * (size + gap), size, size}, i / 3, false, false});
        }
        return buttons;
    }
    const double left = Rem(5.5), width = std::min(width_ - left * 2, Rem(58));
    buttons.push_back({"name", "", {left, Rem(10.2), width, Rem(3.2)}, 0, false, false, true});
    // Kids profile is a switch on a row; the age limit is one segmented control (four buttons side by side).
    buttons.push_back({"kids", "", {left, Rem(14.4), Rem(20), Rem(3.2)}, 1, false, false, true});
    const int ages[]{7, 12, 15, 18};
    for (int i = 0; i < 4; ++i) buttons.push_back({"age:" + std::to_string(ages[i]), i == 3 ? "No limit" : "Up to " + std::to_string(ages[i]),
                                                {left + Rem(0.25) + i * Rem(7.2), Rem(20.25), Rem(7.2), Rem(2.5)}, 2, profile_.maxAge == ages[i], false, true});
    buttons.push_back({"pin", "", {left, Rem(26), Rem(16), Rem(3)}, 3, false, false, true});
    buttons.push_back({"remove-pin", "Remove PIN", {left + Rem(17), Rem(26), Rem(11), Rem(3)}, 3, false, !profile_.locked && !pinChanged_});
    {
        // Set tiles: only those on show, cut to the row so a click outside it does not land on one.
        const double viewLeft = SetsLeft(), viewRight = SetsLeft() + SetsWidth();
        for (std::size_t i = 0; i < sets_.size(); ++i) {
            const double x = SetTileX(i);
            const double cutLeft = std::max(x, viewLeft), cutRight = std::min(x + Rem(kSetTileRem), viewRight);
            if (cutRight - cutLeft < 1.0) continue;
            buttons.push_back({"set:" + std::to_string(i), sets_[i].value("title", "Avatars"),
                               {cutLeft, Rem(kSetsTopRem), cutRight - cutLeft, Rem(kSetsHeightRem)}, 4, i == set_, false, true});
        }
        if (setScroll_ > 0.5) buttons.push_back({"sets-prev", "", {viewLeft + Rem(0.5), Rem(kSetsTopRem + 1.3), Rem(2.4), Rem(2.4)}, 4, false, false, true});
        if (setScroll_ < SetsMaxScroll() - 0.5) buttons.push_back({"sets-next", "", {viewRight - Rem(2.9), Rem(kSetsTopRem + 1.3), Rem(2.4), Rem(2.4)}, 4, false, false, true});
    }
    // The characters: the profile's own colour and initial first, then the set's characters as 96 px circles.
    const auto avatars = Avatars();
    for (std::size_t i = 0; i <= avatars.size(); ++i) {
        const double x = SetsLeft() + static_cast<double>(i % kAvatarsPerRow) * Rem(kAvatarCellWidthRem + 0.4);
        const double y = AvatarTop() + static_cast<double>(i / kAvatarsPerRow) * Rem(kAvatarCellHeightRem);
        buttons.push_back({i == 0 ? "initial" : "avatar:" + std::to_string(i - 1), "", {x, y, Rem(kAvatarCellWidthRem), Rem(kAvatarCellHeightRem - 0.4)},
                           5 + static_cast<int>(i / kAvatarsPerRow), i == 0 && profile_.avatar.empty(), false, true});
    }
    const double foot = ContentHeight() - Rem(6);
    buttons.push_back({"save", "Save", {left, foot, Rem(10), Rem(3)}, 100, true});
    if (!profile_.id.empty()) buttons.push_back({"delete", confirmDelete_ ? "Delete now" : "Delete profile", {left + Rem(11), foot, Rem(12), Rem(3)}, 100});
    buttons.push_back({"cancel", "Cancel", {left + Rem(24), foot, Rem(10), Rem(3)}, 100});
    return buttons;
}
double ProfileEditor::ContentHeight() const {
    return challenge_ ? Rem(43)
                      : AvatarTop() + std::ceil(static_cast<double>(Avatars().size() + 1) / static_cast<double>(kAvatarsPerRow)) * Rem(kAvatarCellHeightRem) + Rem(10);
}
void ProfileEditor::PaintContent(Painter& painter, double scroll) const {
    const double left = Rem(5.5);
    if (challenge_) {
        const double shake = tokens::reduceMotion || clockMs_ >= shakeUntil_ ? 0 : std::sin(clockMs_ * 0.065) * Rem(0.4);
        const Box panel{width_ / 2 - Rem(14) + shake, Rem(6) - scroll, Rem(28), Rem(37)};
        painter.Glass(panel, Rem(1.75), glass::MenuPanel());
        const TextStyle title{Rem(1.8), true, 650};
        painter.Text({panel.x + Rem(2), panel.y + Rem(2), panel.width - Rem(4), Rem(3)}, "Enter PIN", title, tokens::kText);
        painter.Text({panel.x + Rem(2), panel.y + Rem(5), panel.width - Rem(4), Rem(2)}, name_, {Rem(1.1), false}, tokens::kTextMuted);
        for (int i = 0; i < 4; ++i) {
            const Box dot{width_ / 2 - Rem(4.5) + i * Rem(2.6) + shake, Rem(16) - scroll, Rem(1.1), Rem(1.1)};
            painter.FillRoundRect(dot, dot.height / 2, Rgb(0xFFFFFF, i < static_cast<int>(pin_.size()) ? 0.95 : 0.16));
        }
        painter.Text({panel.x + Rem(1), Rem(18) - scroll, panel.width - Rem(2), Rem(2)}, message_, {Rem(0.9), false}, Rgb(0xFF9E92));
        return;
    }
    PaintHeader(painter, Rem(2.5) - scroll, "Profiles", profile_.id.empty() ? "Add profile" : "Edit profile", message_);
    const auto label = [&](double y, const std::string& text) { painter.Text({left, Rem(y) - scroll, Rem(58), Rem(1.8)}, text, {Rem(1), false}, tokens::kTextMuted); };
    {
        // The segmented track under the four age buttons.
        const Box track{left, Rem(20), Rem(7.2) * 4 + Rem(0.5), Rem(3.0)};
        painter.FillRoundRect(track, Rem(0.75), Rgb(0xFFFFFF, 0.08));
    }
    label(8.2, "Name"); label(18, "Age limit · Filters by genre"); label(23.8, "Profile lock · 4-digit PIN"); label(29.8, "Choose an avatar set");
    label(kSetsTopRem + kSetsHeightRem + 0.6, "Pick a character");
}
void ProfileEditor::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    if (button.key == "kids") {
        // A row: the name and what it does at the left, an iOS-style switch at the right.
        painter.Text({box.x, box.y, box.width - Rem(4), box.height * 0.55}, "Kids profile", {Rem(1), true, 600}, tokens::kText);
        painter.Text({box.x, box.y + box.height * 0.5, box.width - Rem(4), box.height * 0.45}, "Limits what this profile can watch", {Rem(0.8), false}, tokens::kTextMuted);
        controls::PaintSwitch(painter, controls::SwitchBox(box.Right(), box.CenterY(), Rem(1)), profile_.kind == "kids", focused);
        return;
    }
    if (button.key.rfind("age:", 0) == 0) {
        if (button.primary) painter.FillRoundRect(box, Rem(0.6), tokens::kAccentStrong);
        const TextStyle style{Rem(0.875), true, 600};
        const double width = painter.MeasureText(button.label, style);
        painter.Text({box.CenterX() - width / 2 - 1, box.y, width + 4, box.height}, button.label, style, button.primary ? tokens::kAccentInk : tokens::kTextMuted);
        if (focused) painter.StrokeRoundRect(box, Rem(0.6), 2, tokens::kFocusRing);
        return;
    }
    if (button.key == "name" || button.key == "pin") {
        painter.FillRoundRect({box.x, box.y + 1, box.width, box.height}, Rem(0.75), Rgb(0, 0.35));
        painter.FillRoundRect(box, Rem(0.75), Rgb(0xFFFFFF, 0.06));
        painter.StrokeRoundRect(box, Rem(0.75), focused ? 2 : 1, focused ? Rgb(0x2F6BFF) : Rgb(0xFFFFFF, 0.16));
        const std::string value = button.key == "name" ? name_ : pin_.empty() ? removePin_ ? "PIN removed" : profile_.locked ? "Keep current PIN" : "Optional PIN" : std::string(pin_.size(), '*');
        painter.Text({box.x + Rem(0.8), box.y, box.width - Rem(1.6), box.height}, value + (focused ? "|" : ""), {Rem(1.1), false}, tokens::kText);
        return;
    }
    if (button.key.rfind("set:", 0) == 0) {
        // A set: the cover (its first character's picture), with the show's name under it.
        const std::size_t index = std::stoul(button.key.substr(4));
        if (index >= sets_.size()) return;
        const double x = SetTileX(index);
        painter.PushClip({SetsLeft() - 6, box.y - 6, SetsWidth() + 12, box.height + 12});
        const Box art{x, box.y, Rem(kSetTileRem), Rem(5.2)};
        painter.FillRoundRect(art, Rem(1.1), tokens::kSurfaceHover);
        std::string cover;
        for (const auto& avatar : sets_[index]["avatars"]) if (avatar.is_object() && cover.empty()) cover = avatar.value("image", "");
        if (!cover.empty()) painter.ImageFaded(art, cover, Rem(1.1), 1.0, 0.5, 0.2);
        const bool chosen = index == set_;
        if (chosen) painter.StrokeRoundRect({art.x - 2, art.y - 2, art.width + 4, art.height + 4}, Rem(1.1) + 2, 3, tokens::kAccentStrong);
        else if (focused) painter.StrokeRoundRect({art.x - 2, art.y - 2, art.width + 4, art.height + 4}, Rem(1.1) + 2, 2, tokens::kText);
        painter.Paragraph({x + 2, art.Bottom() + Rem(0.45), art.width - 4, Rem(2.5)}, button.label, {Rem(0.85), chosen, chosen ? 650 : 500},
                          chosen || focused ? tokens::kText : tokens::kTextMuted);
        painter.PopClip();
        return;
    }
    if (button.key == "sets-prev" || button.key == "sets-next") {
        painter.FillRoundRect(box, box.height / 2, Rgb(0x07080B, 0.78));
        painter.StrokeRoundRect(box, box.height / 2, focused ? 2 : 1, focused ? tokens::kText : Rgb(0xFFFFFF, 0.25));
        const double chev = box.height * 0.5;
        painter.Path({box.CenterX() - chev / 2, box.CenterY() - chev / 2, chev, chev}, 24.0,
                     button.key == "sets-prev" ? "M15 5L8 12L15 19" : "M9 5L16 12L9 19", PathStyle{Color{0, 0, 0, 0}, Rgb(0xFFFFFF), 2.4, false});
        return;
    }
    // A character: a 96 px circle with its name under it. The profile's own colour and initial come first.
    const double size = Rem(kAvatarCircleRem);
    const Box circle{box.x + (box.width - size) / 2, box.y + Rem(0.5), size, size};
    const bool initial = button.key == "initial";
    std::string name = "Initial", id;
    if (initial) {
        painter.FillRoundRect(circle, size / 2, AvatarColor(profile_.hue));
        const std::string letter = name_.empty() ? "?" : name_.substr(0, 1);
        const TextStyle big{size * 0.42, true, 700};
        const double letterWidth = painter.MeasureText(letter, big);
        painter.Text({circle.CenterX() - letterWidth / 2 - 1, circle.y, letterWidth + 4, circle.height}, letter, big, Rgb(0xFFFFFF));
    } else {
        const auto avatars = Avatars();
        const auto index = static_cast<std::size_t>(std::stoul(button.key.substr(7)));
        if (index >= avatars.size()) return;
        const auto& avatar = avatars[index];
        id = sets_[set_].value("id", "") + "/" + avatar.value("id", "");
        name = avatar.value("name", "");
        painter.FillRoundRect(circle, size / 2, AvatarColor(profile_.hue));
        if (!painter.Image(circle, avatar.value("image", ""), size / 2)) {
            const std::string letter = name.empty() ? "?" : name.substr(0, 1);
            const TextStyle big{size * 0.42, true, 700};
            const double letterWidth = painter.MeasureText(letter, big);
            painter.Text({circle.CenterX() - letterWidth / 2 - 1, circle.y, letterWidth + 4, circle.height}, letter, big, Rgb(0xFFFFFF));
        }
    }
    const bool chosen = initial ? profile_.avatar.empty() : profile_.avatar == id;
    const Box ring{circle.x - 5, circle.y - 5, circle.width + 10, circle.height + 10};
    if (chosen) painter.StrokeRoundRect(ring, ring.width / 2, 3, tokens::kAccentStrong);
    if (focused) painter.StrokeRoundRect(chosen ? Box{ring.x - 4, ring.y - 4, ring.width + 8, ring.height + 8} : ring,
                                         (chosen ? ring.width + 8 : ring.width) / 2, 2, tokens::kText);
    // The name is centred under the circle, on two lines when it is long.
    const TextStyle label{Rem(0.85), chosen, chosen ? 650 : 500};
    std::string first = name, second;
    if (painter.MeasureText(name, label) > box.width) {
        const std::size_t middle = name.size() / 2;
        std::size_t cut = name.rfind(' ', middle);
        if (cut == std::string::npos || cut == 0) cut = name.find(' ', middle);
        if (cut != std::string::npos) { first = name.substr(0, cut); second = name.substr(cut + 1); }
    }
    const double lineHeight = Rem(1.25);
    const auto centred = [&](const std::string& text, double y) {
        const double width = std::min(painter.MeasureText(text, label), box.width);
        painter.Text({box.CenterX() - width / 2 - 1, y, width + 4, lineHeight}, text, label, chosen || focused ? tokens::kText : tokens::kTextMuted);
    };
    centred(first, circle.Bottom() + Rem(0.5));
    if (!second.empty()) centred(second, circle.Bottom() + Rem(0.5) + lineHeight);
}
std::optional<Command> ProfileEditor::Submit() { return Activate(challenge_ ? "digit:enter" : "save"); }
std::optional<Command> ProfileEditor::Activate(const std::string& key) {
    Command command; command.action = true;
    if (challenge_) {
        if (key == "digit:erase") Erase();
        else if (key == "digit:enter") { if (pin_.size() != 4) return std::nullopt; command.name = "profile-unlock"; command.params = {{"id", profile_.id}, {"pin", pin_}}; return command; }
        else if (key.rfind("digit:", 0) == 0) Type(key.substr(6));
        return std::nullopt;
    }
    if (key == "kids") { profile_.kind = profile_.kind == "kids" ? "standard" : "kids"; profile_.maxAge = profile_.kind == "kids" ? 7 : 18; }
    else if (key.rfind("age:", 0) == 0) profile_.maxAge = std::stoi(key.substr(4));
    else if (key.rfind("set:", 0) == 0) { set_ = static_cast<std::size_t>(std::stoul(key.substr(4))); ShowSet(set_); }
    else if (key == "sets-prev") setScroll_ = std::clamp(setScroll_ - SetsWidth() * 0.8, 0.0, SetsMaxScroll());
    else if (key == "sets-next") setScroll_ = std::clamp(setScroll_ + SetsWidth() * 0.8, 0.0, SetsMaxScroll());
    else if (key.rfind("avatar:", 0) == 0) { const auto avatars = Avatars(); const auto i = std::stoul(key.substr(7)); if (i < avatars.size()) profile_.avatar = sets_[set_].value("id", "") + "/" + avatars[i].value("id", ""); }
    else if (key == "initial") profile_.avatar.clear();
    else if (key == "remove-pin") { removePin_ = true; pinChanged_ = true; pin_.clear(); }
    else if (key == "cancel") { command.name = "back"; return command; }
    else if (key == "delete") {
        if (!confirmDelete_) { confirmDelete_ = true; message_ = "Delete this profile and its list and progress?"; return std::nullopt; }
        command.name = "profile-delete-edited"; command.params["id"] = profile_.id; return command;
    } else if (key == "save") {
        if (name_.empty()) { message_ = "Enter a name."; return std::nullopt; }
        if (pinChanged_ && !removePin_ && pin_.size() != 4) { message_ = "Enter a 4-digit PIN."; return std::nullopt; }
        nlohmann::json patch{{"name", name_}, {"avatar", profile_.avatar}, {"kind", profile_.kind}, {"maxAge", profile_.maxAge}};
        if (pinChanged_) patch["pin"] = removePin_ ? nlohmann::json(nullptr) : nlohmann::json(pin_);
        command.name = "profile-save-edited"; command.params = {{"id", profile_.id}, {"patch", patch.dump()}}; return command;
    }
    return std::nullopt;
}
}  // namespace tvm::ui
