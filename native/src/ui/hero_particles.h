#pragma once

#include "ui/painter.h"

namespace tvm::ui {

enum class HeroEffect { None, Embers, Sparks, Snow, Dust, Stars };

HeroEffect ParseHeroEffect(std::string_view name);
void PaintHeroParticles(Painter& painter, const Box& area, HeroEffect effect, Color accent, Color glow, double seconds,
                        double opacity);

}  // namespace tvm::ui
