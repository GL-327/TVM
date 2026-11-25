#include "ui/profile_editor.h"

#include <algorithm>
#include <cmath>
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
double ProfileEditor::AvatarTop() const { return Rem(32.0) + std::ceil(static_cast<double>(sets_.size()) / 4.0) * Rem(3.3); }
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
    buttons.push_back({"kids", profile_.kind == "kids" ? "Kids profile: On" : "Kids profile: Off", {left, Rem(15), Rem(16), Rem(2.8)}, 1});
    const int ages[]{7, 12, 15, 18};
    for (int i = 0; i < 4; ++i) buttons.push_back({"age:" + std::to_string(ages[i]), i == 3 ? "No limit" : "Up to " + std::to_string(ages[i]),
                                                {left + i * Rem(8.2), Rem(20), Rem(7.8), Rem(2.8)}, 2, profile_.maxAge == ages[i]});
    buttons.push_back({"pin", "", {left, Rem(26), Rem(16), Rem(3)}, 3, false, false, true});
    buttons.push_back({"remove-pin", "Remove PIN", {left + Rem(17), Rem(26), Rem(11), Rem(3)}, 3, false, !profile_.locked && !pinChanged_});
    for (std::size_t i = 0; i < sets_.size(); ++i) buttons.push_back({"set:" + std::to_string(i), sets_[i].value("title", "Avatars"),
        {left + (i % 4) * Rem(14.5), Rem(32) + static_cast<double>(i / 4) * Rem(3.3), Rem(14), Rem(2.8)}, 4 + static_cast<int>(i / 4), i == set_});
    const auto avatars = Avatars();
    buttons.push_back({"initial", "Colour + initial", {left, AvatarTop(), Rem(12), Rem(2.8)}, 10, profile_.avatar.empty()});
    for (std::size_t i = 0; i < avatars.size(); ++i) buttons.push_back({"avatar:" + std::to_string(i), "",
        {left + (i % 6) * Rem(9.5), AvatarTop() + Rem(4) + static_cast<double>(i / 6) * Rem(10), Rem(8.7), Rem(9)},
        11 + static_cast<int>(i / 6), false, false, true});
    const double foot = ContentHeight() - Rem(6);
    buttons.push_back({"save", "Save", {left, foot, Rem(10), Rem(3)}, 100, true});
    if (!profile_.id.empty()) buttons.push_back({"delete", confirmDelete_ ? "Delete now" : "Delete profile", {left + Rem(11), foot, Rem(12), Rem(3)}, 100});
    buttons.push_back({"cancel", "Cancel", {left + Rem(24), foot, Rem(10), Rem(3)}, 100});
    return buttons;
}
double ProfileEditor::ContentHeight() const {
    return challenge_ ? Rem(43) : AvatarTop() + Rem(4) + std::ceil(static_cast<double>(Avatars().size()) / 6) * Rem(10) + Rem(10);
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
    label(8.2, "Name"); label(18, "Age limit · Filters by genre"); label(23.8, "Profile lock · 4-digit PIN"); label(29.8, "Choose an avatar set");
}
void ProfileEditor::PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const {
    if (button.key == "name" || button.key == "pin") {
        painter.FillRoundRect({box.x, box.y + 1, box.width, box.height}, Rem(0.75), Rgb(0, 0.35));
        painter.FillRoundRect(box, Rem(0.75), Rgb(0xFFFFFF, 0.06));
        painter.StrokeRoundRect(box, Rem(0.75), focused ? 2 : 1, focused ? Rgb(0x2F6BFF) : Rgb(0xFFFFFF, 0.16));
        const std::string value = button.key == "name" ? name_ : pin_.empty() ? removePin_ ? "PIN removed" : profile_.locked ? "Keep current PIN" : "Optional PIN" : std::string(pin_.size(), '*');
        painter.Text({box.x + Rem(0.8), box.y, box.width - Rem(1.6), box.height}, value + (focused ? "|" : ""), {Rem(1.1), false}, tokens::kText);
        return;
    }
    const auto avatars = Avatars();
    const auto index = static_cast<std::size_t>(std::stoul(button.key.substr(7)));
    if (index >= avatars.size()) return;
    const auto& avatar = avatars[index];
    const std::string id = sets_[set_].value("id", "") + "/" + avatar.value("id", "");
    const Box art{box.x, box.y, box.width, Rem(7.2)};
    painter.FillRoundRect(art, Rem(1.1), AvatarColor(profile_.hue));
    if (!painter.Image(art, avatar.value("image", ""), Rem(1.1))) painter.Text({art.x + Rem(0.8), art.y, art.width - Rem(1.6), art.height}, name_.empty() ? "?" : name_.substr(0, 1), {Rem(2.5), true}, Rgb(0xFFFFFF));
    if (focused || profile_.avatar == id) painter.StrokeRoundRect(art, Rem(1.1), 3, Rgb(profile_.avatar == id ? 0x2F6BFF : 0xFFFFFF));
    painter.Text({box.x, art.Bottom() + Rem(0.2), box.width, Rem(1.5)}, avatar.value("name", ""), {Rem(0.85), false}, tokens::kText);
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
    else if (key.rfind("set:", 0) == 0) set_ = static_cast<std::size_t>(std::stoul(key.substr(4)));
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
