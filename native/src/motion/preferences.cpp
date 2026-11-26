#include "motion/preferences.h"

namespace tvm::motion {

namespace {
bool systemReducedMotion = false;
}

void SetSystemReducedMotion(bool reduced) { systemReducedMotion = reduced; }

MotionPreference ParseMotionPreference(std::string_view value) {
    if (value == "full") return MotionPreference::Full;
    if (value == "reduced") return MotionPreference::Reduced;
    return MotionPreference::Auto;
}

std::string_view ToString(MotionPreference preference) {
    switch (preference) {
    case MotionPreference::Full:
        return "full";
    case MotionPreference::Reduced:
        return "reduced";
    case MotionPreference::Auto:
        break;
    }
    return "auto";
}

bool PrefersReducedMotion(const MotionSettings& settings) {
    return settings.performanceMode || settings.preference == MotionPreference::Reduced ||
           (settings.preference == MotionPreference::Auto && systemReducedMotion);
}

MotionTokens ResolveMotionTokens(const MotionSettings& settings) {
    if (PrefersReducedMotion(settings)) return {1.0, 1.0, 1.0};
    return {150.0, 220.0, 260.0};
}

double GlassSweepMs(const MotionSettings& settings) {
    return PrefersReducedMotion(settings) ? 0.0 : 520.0;
}

}  // namespace tvm::motion
