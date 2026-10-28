#pragma once

// Motion preferences and performance mode, ported from
// apps/ui/src/theme/motion.ts and motion.css.
//
// Reduced motion comes only from Settings (or Performance mode). The operating
// system's reduced-motion flag does not switch the UI's motion off, because on
// some GPUs it is set by default.

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

// True only for Reduced motion or Performance mode.
bool PrefersReducedMotion(const MotionSettings& settings);

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
