#pragma once

// Procedural franchise intros drawn with the UI Painter over the player's loading phase, mirroring
// packages/content/intros.json and apps/ui/src/intros (Hunger Games embers/Mockingjay and Avengers: Doomsday
// green mystic mask/runes). Offline, zero image dependencies, skippable with any key or click.

#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "motion/preferences.h"
#include "ui/painter.h"

namespace tvm::ui {

struct FranchiseIntroSpec {
    std::string id;
    std::string event;
    std::string style;
    std::vector<std::string> imdbIds;
    std::string titlePattern;
    std::string accent;
    std::string glow;
    double durationMs = 3800.0;
    std::map<std::string, std::string> titles;
};

struct FranchiseIntroPlan {
    std::string id;
    std::string event;
    std::string style;
    std::string accentHex;
    std::string glowHex;
    std::string title;
    double durationMs = 3800.0;

    bool operator==(const FranchiseIntroPlan&) const = default;
};

// Parses `packages/content/intros.json` into typed intro definitions.
std::vector<FranchiseIntroSpec> ParseFranchiseIntros(const nlohmann::json& data);

// Extracts the base IMDb id from an episode or film id (`tt1234567:1:2` -> `tt1234567`).
std::string BaseImdbId(const std::string& id);

// Matches by IMDb id first, then case-insensitive titlePattern regex.
std::optional<FranchiseIntroPlan> MatchFranchiseIntro(const std::vector<FranchiseIntroSpec>& specs,
                                                      const std::string& itemId, const std::string& title);

// Returns a plan if `itemId`/`title` matches an intro that has not yet played in `played`.
std::optional<FranchiseIntroPlan> PlanFranchiseIntro(const nlohmann::json& data, const std::string& itemId,
                                                     const std::string& title,
                                                     const std::set<std::string>& played);

class FranchiseIntro {
public:
    explicit FranchiseIntro(motion::MotionSettings motion = {});

    void SetMotion(const motion::MotionSettings& motion) { motion_ = motion; }

    void Start(const FranchiseIntroPlan& plan, double nowMs);
    void SetPlaybackReady(bool ready, double nowMs);
    void Skip(double nowMs);
    void Reset();

    void Tick(double nowMs);
    bool Active() const;
    bool Animating() const { return Active(); }
    bool Released() const { return released_; }
    bool Covers() const;
    double Opacity(double nowMs) const;
    const FranchiseIntroPlan& plan() const { return plan_; }

    void Paint(Painter& painter, double width, double height) const;

private:
    motion::MotionSettings motion_;
    FranchiseIntroPlan plan_;
    bool active_ = false;
    bool released_ = false;
    bool ready_ = false;
    bool skipped_ = false;
    bool leaving_ = false;
    bool finished_ = false;
    double startMs_ = 0.0;
    double clockMs_ = 0.0;
    double leaveMs_ = 0.0;
};

}  // namespace tvm::ui
