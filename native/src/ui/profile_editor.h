#pragma once

#include <nlohmann/json.hpp>
#include "ui/pages.h"

namespace tvm::ui {
class ProfileEditor final : public PageScreen {
public:
    ProfileEditor();
    void SetProfile(ProfileEntry profile, nlohmann::json avatars, const std::string& featured);
    void Challenge(const std::string& id, const std::string& name);
    bool IsChallenge() const { return challenge_; }
    bool Typing() const { return challenge_ || focused_ == "name" || focused_ == "pin"; }
    void Type(const std::string& text);
    void Erase();
    void Fail(const std::string& message, double nowMs);
    std::optional<Command> Submit();
    bool Tick(double nowMs) override;
    bool Animating() const override;
protected:
    std::vector<PageButton> Buttons() const override;
    void PaintContent(Painter& painter, double scroll) const override;
    double ContentHeight() const override;
    std::optional<Command> Activate(const std::string& key) override;
    void PaintCustom(Painter& painter, const PageButton& button, const Box& box, bool focused) const override;
private:
    double AvatarTop() const;
    std::vector<nlohmann::json> Avatars() const;
    ProfileEntry profile_;
    nlohmann::json sets_ = nlohmann::json::array();
    std::size_t set_ = 0;
    bool challenge_ = false, removePin_ = false, pinChanged_ = false, confirmDelete_ = false;
    std::string name_, pin_, message_;
    double shakeUntil_ = 0;
};
}  // namespace tvm::ui
