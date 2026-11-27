#pragma once

// Motion preferences and performance mode, ported from
// apps/ui/src/theme/motion.ts and motion.css.
//
// Auto follows the window system's animation preference. Reduced motion and performance mode always reduce it.

#include <string_view>

namespace tvm::motion {

enum class MotionPreference {
    Auto,
    Full,
    Reduced,
};

// Anything other than "full" or "reduced" is Auto, as in the web UI.
MotionPreference ParseMotionPreference(std::string_view value);
std::string_view ToString(MotionPreference preference);

struct MotionSettings {
    MotionPreference preference = MotionPreference::Auto;
    // Turns off decorative motion, blur and glow. It also reduces motion.
    bool performanceMode = false;

    bool operator==(const MotionSettings&) const = default;
};

void SetSystemReducedMotion(bool reduced);

// Includes the operating system setting when the viewer uses Auto.
bool PrefersReducedMotion(const MotionSettings& settings);

// Only what the viewer chose in TVM (Reduced motion or Performance mode). The window system's animation switch is
// left out, because many machines have it off without anyone asking for less motion. The launch reveal uses this.
bool SettingsReduceMotion(const MotionSettings& settings);

// The --tvm-motion-* durations in milliseconds. Reduced motion resolves them
// to 1 ms, as motion.css does.
struct MotionTokens {
    double fastMs;
    double baseMs;
    double slowMs;
};
MotionTokens ResolveMotionTokens(const MotionSettings& settings);

// Duration of the liquid-glass specular sweep (--tvm-glass-sweep-ms).
double GlassSweepMs(const MotionSettings& settings);

}  // namespace tvm::motion
