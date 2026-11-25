#pragma once

#include <algorithm>
#include <cmath>
#include "ui/painter.h"

namespace tvm::ui {
// Exact critically damped step, so a delayed frame cannot make the loader jump or overshoot.
class Orbit {
public:
    void Tick(double nowMs, double bytesPerSecond, double bufferGain, bool resolving) {
        const double dt = lastMs_ < 0.0 ? 0.0 : std::clamp((nowMs - lastMs_) / 1000.0, 0.0, 0.1);
        lastMs_ = nowMs;
        const double target = resolving ? 0.65 : std::clamp(std::max(bytesPerSecond / 1500000.0, bufferGain), 0.35, 2.4);
        const double delta = speed_ - target;
        const double step = velocity_ + 10.0 * delta;
        const double decay = std::exp(-10.0 * dt);
        speed_ = target + (delta + step * dt) * decay;
        velocity_ = (velocity_ - 10.0 * step * dt) * decay;
        phase_ = std::fmod(phase_ + dt * 0.45 * speed_, 1.0);
    }
    double Speed() const { return speed_; }
    double Phase() const { return phase_; }
    void Paint(Painter& painter, double cx, double cy, double radius, double progress, bool reduced, double nowMs) const {
        constexpr double tau = 6.283185307179586;
        GlassStyle rim;
        rim.kind = GlassKind::Orb;
        rim.rimOnly = true;
        painter.Glass(Box{cx - radius, cy - radius, 2 * radius, 2 * radius}, radius, rim);
        const auto arc = [&](double start, double length, double r, double width, Color color) {
            std::vector<Point> points;
            const int steps = std::max(2, static_cast<int>(std::ceil(std::abs(length) * 160)));
            for (int i = 0; i <= steps; ++i) {
                const double angle = (start + length * i / steps) * tau;
                points.push_back({cx + r * std::sin(angle), cy - r * std::cos(angle)});
            }
            painter.StrokePolyline(points, width, color);
        };
        arc(0, 1, radius, 5, Rgb(0xFFFFFF, 0.13));
        const double pulse = reduced ? 0.65 + 0.25 * std::sin(nowMs / 700) : 1;
        const double turn = reduced ? 0.16 : phase_;
        for (int i = 0; i < 32; ++i) arc(turn - 0.22 + i * 0.22 / 32, 0.22 / 32, radius, 5,
                                                    Rgb(0xFFFFFF, pulse * (0.08 + 0.92 * i / 31)));
        for (int i = 1; i <= 3; ++i) {
            const double angle = (turn - 0.24 - i * 0.035) * tau;
            const double size = radius * (0.085 - 0.015 * i);
            painter.FillRoundRect({cx + radius * std::sin(angle) - size / 2, cy - radius * std::cos(angle) - size / 2, size, size}, size / 2,
                                  Rgb(0xB8D4FF, pulse * (0.6 - 0.13 * i)));
        }
        if (progress > 0) arc(0, std::clamp(progress, 0.0, 1.0), radius - 9, 2, Rgb(0x6B9AFF, 0.9));
    }
private:
    double lastMs_ = -1, phase_ = 0, speed_ = 0.65, velocity_ = 0;
};
}  // namespace tvm::ui
