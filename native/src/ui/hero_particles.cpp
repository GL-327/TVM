#include "ui/hero_particles.h"

#include <cmath>

namespace tvm::ui {

HeroEffect ParseHeroEffect(std::string_view name) {
    if (name == "none") return HeroEffect::None;
    if (name == "embers") return HeroEffect::Embers;
    if (name == "sparks") return HeroEffect::Sparks;
    if (name == "snow") return HeroEffect::Snow;
    if (name == "stars") return HeroEffect::Stars;
    return HeroEffect::Dust;
}

namespace {

double Fraction(double value) { return value - std::floor(value); }

double Seed(std::uint32_t value) {
    value ^= value >> 16;
    value *= 0x7feb352dU;
    value ^= value >> 15;
    value *= 0x846ca68bU;
    value ^= value >> 16;
    return static_cast<double>(value) / 4294967296.0;
}

struct Atmosphere {
    int count;
    double speed;
    double drift;
    double radius;
    double opacity;
};

Atmosphere EffectLook(HeroEffect effect) {
    switch (effect) {
    case HeroEffect::Embers: return {58, -0.082, 0.034, 2.5, 0.72};
    case HeroEffect::Sparks: return {48, -0.125, 0.082, 1.6, 0.77};
    case HeroEffect::Snow: return {62, 0.089, 0.040, 2.5, 0.62};
    case HeroEffect::Stars: return {48, -0.004, 0.012, 1.8, 0.60};
    case HeroEffect::Dust: return {46, -0.023, 0.026, 1.4, 0.40};
    case HeroEffect::None: return {};
    }
    return {};
}

}  // namespace

void PaintHeroParticles(Painter& painter, const Box& area, HeroEffect effect, Color accent, Color glow, double seconds,
                        double opacity) {
    const Atmosphere look = EffectLook(effect);
    if (look.count == 0 || opacity <= 0.0) return;
    painter.BeginLightParticles();
    for (int i = 0; i < look.count; ++i) {
        const auto seed = static_cast<std::uint32_t>(i + 1) * 7U;
        const double phase = Seed(seed);
        const double depth = Seed(seed + 1U);
        const double x0 = 0.04 + 0.89 * Seed(seed + 2U);
        const double travel = Fraction(phase + seconds * look.speed * (0.55 + depth));
        const double y = area.y + area.height * (0.12 + 0.81 * travel);
        const double x = area.x + area.width * (x0 + look.drift * std::sin(seconds * (0.45 + depth) + 15.0 * phase));
        const double flicker = 0.65 + 0.35 * std::sin(seconds * (1.6 + 4.1 * depth) + phase * 37.0);
        const double edgeFade = std::min(1.0, std::min(travel, 1.0 - travel) * 4.0);
        const double radius = look.radius * (0.35 + 0.85 * depth) * area.width / 1920.0;
        Color ink = effect == HeroEffect::Snow || effect == HeroEffect::Stars
                        ? Rgb(0xDFEEFF) : Mix(glow, accent, depth);
        ink.a = look.opacity * opacity * flicker * edgeFade * (0.4 + 0.6 * depth);
        if (radius < 0.3 || ink.a < 0.015) continue;
        if (effect == HeroEffect::Embers || effect == HeroEffect::Sparks || effect == HeroEffect::Stars) {
            Color halo = ink;
            halo.a *= 0.25;
            painter.FillRoundRect({x - radius * 2.0, y - radius * 2.0, radius * 4.0, radius * 4.0}, radius * 2.0, halo);
        }
        painter.FillRoundRect({x - radius, y - radius, radius * 2.0, radius * 2.0}, radius, ink);
    }
    painter.EndLightParticles();
}

}  // namespace tvm::ui
