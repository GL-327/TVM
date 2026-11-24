// The slab model, Snell refraction, Fresnel environment and spectral rim below are ported from PyGlass
// (https://github.com/neomosh8/pyglass, pyglass/refract.py), used under its MIT licence:
//
//   MIT License
//
//   Copyright (c) 2026 neomosh8
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

#include "platform/glass_lens.h"

#include <d2d1effects.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <iterator>
#include <vector>

namespace tvm::platform {

namespace {

constexpr double kPi = 3.14159265358979323846;
// Surfaces larger than this on either side are not refracted; nothing in the UI is that large.
constexpr std::uint32_t kMaxSide = 2048;
constexpr std::size_t kMaxKernels = 48;

// The slab, scaled from PyGlass's tuned neutral material (bevel 56, strength 42, IOR 1.5 inside to 5 at the
// rim) to TVM's smaller controls: a pill is domed across its whole height, a panel keeps a flat centre.
constexpr double kMaxBevel = 28.0;
constexpr double kStrengthPerBevel = 0.85;
constexpr double kIorEdge = 5.0;
constexpr double kIorInner = 1.5;
// Red bends least and blue most, so colour separates into cyan/violet along curved rims.
constexpr double kChroma = 0.20;
constexpr double kReflect = 0.72;
constexpr double kF0 = 0.04;
constexpr double kGlow = 0.42;
constexpr double kGlowWidth = 2.6;
constexpr double kGlowSaturation = 0.65;
// Vibrancy boost on refracted pixels so underlying artwork blooms vividly through Clear & Frosted glass.
constexpr float kVibrancySaturation = 1.28f;
// Frosted glass: a rough face scatters light into a cone, seen as a blur of the picture behind (PyGlass's frost).
constexpr float kFrostSigma = 16.0f;
// How many surfaces may measure brightness in one frame, and how many frames a reading lasts. A surface seen
// for the first time always measures, so a still frame adapts at once.
constexpr int kMeasuresPerFrame = 3;
constexpr std::uint64_t kReadingFrames = 12;

struct Vec3 {
    double x, y, z;
};

Vec3 Normalize(Vec3 v) {
    const double length = std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return Vec3{v.x / length, v.y / length, v.z / length};
}

// A fully saturated colour for hue `h` in [0, 1).
std::array<double, 3> Hue(double h) {
    const double h6 = (h - std::floor(h)) * 6.0;
    const int i = static_cast<int>(std::floor(h6)) % 6;
    const double f = h6 - std::floor(h6);
    const double q = 1.0 - f;
    switch (i) {
    case 0: return {1.0, f, 0.0};
    case 1: return {q, 1.0, 0.0};
    case 2: return {0.0, 1.0, f};
    case 3: return {0.0, q, 1.0};
    case 4: return {f, 0.0, 1.0};
    default: return {1.0, 0.0, q};
    }
}

std::uint8_t Byte(double value) {
    return static_cast<std::uint8_t>(std::lround(std::clamp(value, 0.0, 1.0) * 255.0));
}

D2D1_MATRIX_5X4_F KeepChannel(int channel) {
    D2D1_MATRIX_5X4_F m{};
    m.m[channel][channel] = 1.0f;
    m.m[3][3] = 1.0f;
    return m;
}

D2D1_MATRIX_5X4_F SaturationMatrix(float s) {
    const float inv = 1.0f - s;
    const float lr = 0.2126f * inv;
    const float lg = 0.7152f * inv;
    const float lb = 0.0722f * inv;
    D2D1_MATRIX_5X4_F m{};
    m.m[0][0] = lr + s;
    m.m[1][0] = lg;
    m.m[2][0] = lb;
    m.m[0][1] = lr;
    m.m[1][1] = lg + s;
    m.m[2][1] = lb;
    m.m[0][2] = lr;
    m.m[1][2] = lg;
    m.m[2][2] = lb + s;
    m.m[3][3] = 1.0f;
    return m;
}

}  // namespace

GlassLens::GlassLens(ID2D1RenderTarget* target) : target_(target) {
    if (target_ == nullptr || FAILED(target_->QueryInterface(IID_PPV_ARGS(&dc_)))) {
        dc_.Reset();
        return;
    }
    bool made = true;
    for (int c = 0; c < 3 && made; ++c) {
        made = SUCCEEDED(dc_->CreateEffect(CLSID_D2D1DisplacementMap, &shift_[c])) &&
               SUCCEEDED(dc_->CreateEffect(CLSID_D2D1ColorMatrix, &channel_[c]));
        if (!made) break;
        shift_[c]->SetValue(D2D1_DISPLACEMENTMAP_PROP_X_CHANNEL_SELECT, D2D1_CHANNEL_SELECTOR_R);
        shift_[c]->SetValue(D2D1_DISPLACEMENTMAP_PROP_Y_CHANNEL_SELECT, D2D1_CHANNEL_SELECTOR_G);
        channel_[c]->SetInputEffect(0, shift_[c].Get());
        channel_[c]->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX, KeepChannel(c));
    }
    made = made && SUCCEEDED(dc_->CreateEffect(CLSID_D2D1Composite, &sum_)) &&
           SUCCEEDED(dc_->CreateEffect(CLSID_D2D1ColorMatrix, &vibrancy_)) &&
           SUCCEEDED(dc_->CreateEffect(CLSID_D2D1GaussianBlur, &frost_));
    if (!made) {
        dc_.Reset();
        return;
    }
    sum_->SetInputCount(3);
    for (int c = 0; c < 3; ++c) sum_->SetInputEffect(static_cast<UINT32>(c), channel_[c].Get());
    sum_->SetValue(D2D1_COMPOSITE_PROP_MODE, D2D1_COMPOSITE_MODE_PLUS);
    vibrancy_->SetInputEffect(0, sum_.Get());
    vibrancy_->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX, SaturationMatrix(kVibrancySaturation));
    frost_->SetValue(D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, kFrostSigma);
    // Hard edges: the blur never pulls in transparent black from outside the copied pixels.
    frost_->SetValue(D2D1_GAUSSIANBLUR_PROP_BORDER_MODE, D2D1_BORDER_MODE_HARD);
}

void GlassLens::BeginFrame() {
    ++frame_;
    measuresLeft_ = kMeasuresPerFrame;
    // Forget places no surface has been seen at for a while, so the map stays small.
    if (readings_.size() > 256) {
        for (auto it = readings_.begin(); it != readings_.end();) {
            it = frame_ - it->second.frame > 600 ? readings_.erase(it) : std::next(it);
        }
    }
}

double GlassLens::Measure(Kernel& kernel) {
    const D2D1_SIZE_U size = kernel.capture->GetPixelSize();
    if (!kernel.readback) {
        const D2D1_BITMAP_PROPERTIES1 props = D2D1::BitmapProperties1(
            D2D1_BITMAP_OPTIONS_CPU_READ | D2D1_BITMAP_OPTIONS_CANNOT_DRAW, kernel.capture->GetPixelFormat());
        if (FAILED(dc_->CreateBitmap(size, nullptr, 0, props, &kernel.readback))) return -1.0;
    }
    const D2D1_POINT_2U origin = D2D1::Point2U(0, 0);
    const D2D1_RECT_U all = D2D1::RectU(0, 0, size.width, size.height);
    if (FAILED(kernel.readback->CopyFromBitmap(&origin, kernel.capture.Get(), &all))) return -1.0;
    D2D1_MAPPED_RECT mapped{};
    if (FAILED(kernel.readback->Map(D2D1_MAP_OPTIONS_READ, &mapped))) return -1.0;
    // Every third pixel of the middle, where labels sit, in perceptual luma.
    double sum = 0.0;
    std::size_t count = 0;
    const std::uint32_t x0 = size.width / 6;
    const std::uint32_t x1 = size.width - x0;
    const std::uint32_t y0 = size.height / 5;
    const std::uint32_t y1 = size.height - y0;
    for (std::uint32_t y = y0; y < y1; y += 3) {
        const BYTE* row = mapped.bits + static_cast<std::size_t>(y) * mapped.pitch;
        for (std::uint32_t x = x0; x < x1; x += 3) {
            const BYTE* p = row + static_cast<std::size_t>(x) * 4;
            sum += (0.0722 * p[0] + 0.7152 * p[1] + 0.2126 * p[2]) / 255.0;
            ++count;
        }
    }
    kernel.readback->Unmap();
    return count > 0 ? sum / static_cast<double>(count) : -1.0;
}

bool GlassLens::Place(const ui::Box& box, Placement& placement) const {
    if (box.width < 4.0 || box.height < 4.0) return false;
    const double left = std::floor(box.x);
    const double top = std::floor(box.y);
    const double width = std::ceil(box.Right()) - left;
    const double height = std::ceil(box.Bottom()) - top;
    if (width > kMaxSide || height > kMaxSide) return false;
    const D2D1_SIZE_U size = dc_->GetPixelSize();
    if (left >= size.width || top >= size.height || left + width <= 0.0 || top + height <= 0.0) return false;
    placement = Placement{static_cast<std::int32_t>(left), static_cast<std::int32_t>(top),
                          static_cast<std::uint32_t>(width), static_cast<std::uint32_t>(height)};
    return true;
}

GlassLens::Kernel* GlassLens::KernelFor(const Placement& placement, double radius) {
    const std::uint32_t w = placement.width;
    const std::uint32_t h = placement.height;
    const double r = std::clamp(radius, 0.0, std::min(w, h) * 0.5);
    const Key id{w, h, static_cast<std::uint32_t>(std::lround(r * 2.0))};
    if (auto found = kernels_.find(id); found != kernels_.end()) {
        found->second.used = ++clock_;
        return &found->second;
    }
    if (kernels_.size() >= kMaxKernels) {
        auto oldest = std::min_element(kernels_.begin(), kernels_.end(),
                                       [](const auto& a, const auto& b) { return a.second.used < b.second.used; });
        kernels_.erase(oldest);
    }

    const double hx = w / 2.0;
    const double hy = h / 2.0;
    const double bevel = std::min(kMaxBevel, std::min(hx, hy));
    const double strength = kStrengthPerBevel * bevel;
    // A pixel at the rim never samples past the middle of the surface.
    const double clampShift = 0.85 * std::min(hx, hy);
    const Vec3 key = Normalize(Vec3{-0.52, -0.78, 0.35});
    const Vec3 fill = Normalize(Vec3{0.58, 0.72, 0.38});

    std::vector<double> shiftX(static_cast<std::size_t>(w) * h, 0.0);
    std::vector<double> shiftY(shiftX.size(), 0.0);
    std::vector<std::uint8_t> rim(shiftX.size() * 4, 0);
    double maxShift = 0.5;
    for (std::uint32_t y = 0; y < h; ++y) {
        for (std::uint32_t x = 0; x < w; ++x) {
            const std::size_t i = static_cast<std::size_t>(y) * w + x;
            // Signed distance to the rounded rectangle, and the outward normal in the plane.
            const double px = x + 0.5 - hx;
            const double py = y + 0.5 - hy;
            const double qx = std::fabs(px) - (hx - r);
            const double qy = std::fabs(py) - (hy - r);
            const double outside = std::hypot(std::max(qx, 0.0), std::max(qy, 0.0));
            const double sdf = outside + std::min(std::max(qx, qy), 0.0) - r;
            const double d = -sdf;
            if (d <= 0.0) continue;
            double nx = 0.0;
            double ny = 0.0;
            if (qx > 0.0 && qy > 0.0) {
                const double length = std::hypot(qx, qy);
                nx = std::copysign(qx / length, px);
                ny = std::copysign(qy / length, py);
            } else if (qx > qy) {
                nx = px < 0.0 ? -1.0 : 1.0;
            } else {
                ny = py < 0.0 ? -1.0 : 1.0;
            }

            // Smooth squircle meniscus profile (p = 2.6): steep at the outer rim and C1-smooth into the flat interior.
            const double t = std::clamp(d / bevel, 0.0, 1.0);
            const double u = std::clamp(1.0 - t, 0.0, 0.988);
            const double uPow = std::pow(u, 2.6);
            const double denom = std::pow(std::max(1.0 - uPow, 1e-4), 1.0 - 1.0 / 2.6);
            const double slope = std::min(7.5, std::pow(u, 1.6) / denom);
            const double cosT = 1.0 / std::sqrt(1.0 + slope * slope);
            const double sinT = slope * cosT;

            // Snell's law for a vertical ray through the tilted surface, projected `strength` below.
            const double ior = kIorEdge + (kIorInner - kIorEdge) * t;
            const double eta = 1.0 / ior;
            const double cosR = std::sqrt(std::clamp(1.0 - eta * eta * sinT * sinT, 0.0, 1.0));
            const double coeff = eta * cosT - cosR;
            const double tz = eta - coeff * cosT;
            const double project = strength / std::max(tz, 1e-3);
            const double dx = std::clamp(coeff * nx * sinT * project, -clampShift, clampShift);
            const double dy = std::clamp(coeff * ny * sinT * project, -clampShift, clampShift);
            shiftX[i] = dx;
            shiftY[i] = dy;
            maxShift = std::max({maxShift, std::fabs(dx), std::fabs(dy)});

            // Dual-light Schlick Fresnel: crisp warm-white top-left key specular + cool sky-blue bottom-right bounce.
            const double fresnel = (kF0 + (1.0 - kF0) * std::pow(1.0 - std::clamp(cosT, 0.0, 1.0), 5.0)) * kReflect;
            const double rx = 2.0 * cosT * (nx * sinT);
            const double ry = 2.0 * cosT * (ny * sinT);
            const double rz = 2.0 * cosT * cosT - 1.0;
            const double dotKey = std::clamp(rx * key.x + ry * key.y + rz * key.z, 0.0, 1.0);
            const double dotFill = std::clamp(rx * fill.x + ry * fill.y + rz * fill.z, 0.0, 1.0);
            const double specKey = std::pow(dotKey, 42.0) + 0.30 * std::pow(dotKey, 10.0);
            const double specFill = std::pow(dotFill, 18.0);
            const double horizon = std::clamp(1.0 - std::clamp(rz, 0.0, 1.0), 0.0, 1.0);
            const double envR = std::min(1.0, (horizon * 118.0 + specKey * 255.0 + specFill * 145.0) / 255.0);
            const double envG = std::min(1.0, (horizon * 146.0 + specKey * 250.0 + specFill * 212.0) / 255.0);
            const double envB = std::min(1.0, (horizon * 190.0 + specKey * 238.0 + specFill * 255.0) / 255.0);

            // Spectral dispersion rim + deeper inner meniscus glow.
            const std::array<double, 3> spectral = Hue(std::atan2(ny, nx) / (2.0 * kPi) + 0.5);
            const double edgeLine = std::clamp(1.0 - d / kGlowWidth, 0.0, 1.0);
            const double innerGlow = std::pow(std::clamp(1.0 - d / std::max(4.0, bevel * 0.45), 0.0, 1.0), 2.2) * 0.16;
            const double line = edgeLine * kGlow + innerGlow;
            std::array<double, 3> glow{};
            for (int c = 0; c < 3; ++c) glow[c] = (spectral[c] * kGlowSaturation + (1.0 - kGlowSaturation)) * line;

            // Over the transmitted picture this gives picture * (1 - F) + environment * F + glow, premultiplied.
            const double alpha = std::clamp(fresnel + line, 0.0, 1.0);
            const double red = std::min(alpha, envR * fresnel + glow[0]);
            const double green = std::min(alpha, envG * fresnel + glow[1]);
            const double blue = std::min(alpha, envB * fresnel + glow[2]);
            rim[i * 4 + 0] = Byte(blue);
            rim[i * 4 + 1] = Byte(green);
            rim[i * 4 + 2] = Byte(red);
            rim[i * 4 + 3] = Byte(alpha);
        }
    }

    // The displacement map stores each shift around mid-grey, opaque so premultiplying leaves it alone.
    std::vector<std::uint8_t> map(shiftX.size() * 4, 0);
    for (std::size_t i = 0; i < shiftX.size(); ++i) {
        map[i * 4 + 0] = 0;
        map[i * 4 + 1] = Byte(0.5 + shiftY[i] / (2.0 * maxShift));
        map[i * 4 + 2] = Byte(0.5 + shiftX[i] / (2.0 * maxShift));
        map[i * 4 + 3] = 255;
    }

    Kernel kernel;
    kernel.maxShift = maxShift;
    kernel.used = ++clock_;
    const D2D1_BITMAP_PROPERTIES1 straight = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_NONE, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    const D2D1_BITMAP_PROPERTIES1 captured = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE, dc_->GetPixelFormat());
    const D2D1_SIZE_U size = D2D1::SizeU(w, h);
    if (FAILED(dc_->CreateBitmap(size, map.data(), w * 4, straight, &kernel.displacement)) ||
        FAILED(dc_->CreateBitmap(size, rim.data(), w * 4, straight, &kernel.rim)) ||
        FAILED(dc_->CreateBitmap(size, nullptr, 0, captured, &kernel.capture))) {
        return nullptr;
    }
    return &kernels_.emplace(id, std::move(kernel)).first->second;
}

void GlassLens::PushShape(const ui::Box& box, double radius, double opacity) {
    ComPtr<ID2D1Factory> factory;
    dc_->GetFactory(&factory);
    ComPtr<ID2D1RoundedRectangleGeometry> shape;
    const D2D1_ROUNDED_RECT rounded = D2D1::RoundedRect(
        D2D1::RectF(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y), static_cast<FLOAT>(box.Right()),
                    static_cast<FLOAT>(box.Bottom())),
        static_cast<FLOAT>(radius), static_cast<FLOAT>(radius));
    factory->CreateRoundedRectangleGeometry(rounded, &shape);
    dc_->PushLayer(D2D1::LayerParameters1(D2D1::InfiniteRect(), shape.Get(), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                                          D2D1::IdentityMatrix(), static_cast<FLOAT>(opacity)),
                   nullptr);
}

bool GlassLens::DrawRefraction(const ui::Box& box, double radius, double opacity, bool frosted,
                               double* brightness) {
    if (brightness != nullptr) *brightness = -1.0;
    if (!ok() || opacity <= 0.0) return false;
    Placement placement{};
    if (!Place(box, placement)) return false;
    Kernel* kernel = KernelFor(placement, radius);
    if (kernel == nullptr) return false;

    // Copy what is drawn under the surface so far. Only the part on the target is copied.
    const D2D1_SIZE_U size = dc_->GetPixelSize();
    const std::int32_t left = std::max(placement.x, 0);
    const std::int32_t top = std::max(placement.y, 0);
    const std::int32_t right = std::min(placement.x + static_cast<std::int32_t>(placement.width),
                                        static_cast<std::int32_t>(size.width));
    const std::int32_t bottom = std::min(placement.y + static_cast<std::int32_t>(placement.height),
                                         static_cast<std::int32_t>(size.height));
    if (right <= left || bottom <= top) return false;
    const D2D1_POINT_2U at = D2D1::Point2U(static_cast<UINT32>(left - placement.x),
                                          static_cast<UINT32>(top - placement.y));
    const D2D1_RECT_U from = D2D1::RectU(static_cast<UINT32>(left), static_cast<UINT32>(top),
                                         static_cast<UINT32>(right), static_cast<UINT32>(bottom));
    if (FAILED(kernel->capture->CopyFromRenderTarget(&at, target_, &from))) return false;

    if (brightness != nullptr) {
        // Surfaces that move a few pixels (a hover lift) keep their reading.
        const Spot spot{placement.x / 8, placement.y / 8, placement.width / 8, placement.height / 8};
        Reading& reading = readings_[spot];
        const bool fresh = reading.value < 0.0;
        if (fresh || (frame_ - reading.frame >= kReadingFrames && measuresLeft_ > 0)) {
            if (!fresh) --measuresLeft_;
            const double measured = Measure(*kernel);
            if (measured >= 0.0) {
                reading.value = fresh ? measured : 0.6 * reading.value + 0.4 * measured;
                reading.frame = frame_;
            }
        }
        *brightness = reading.value;
    }

    const float scale = static_cast<float>(2.0 * kernel->maxShift);
    const float channelScale[3] = {scale * static_cast<float>(1.0 - kChroma), scale,
                                   scale * static_cast<float>(1.0 + kChroma)};
    if (frosted) frost_->SetInput(0, kernel->capture.Get());
    for (int c = 0; c < 3; ++c) {
        if (frosted) {
            shift_[c]->SetInputEffect(0, frost_.Get());
        } else {
            shift_[c]->SetInput(0, kernel->capture.Get());
        }
        shift_[c]->SetInput(1, kernel->displacement.Get());
        shift_[c]->SetValue(D2D1_DISPLACEMENTMAP_PROP_SCALE, channelScale[c]);
    }

    PushShape(box, radius, opacity);
    dc_->DrawImage(vibrancy_.Get(), D2D1::Point2F(static_cast<FLOAT>(placement.x), static_cast<FLOAT>(placement.y)),
                   D2D1_INTERPOLATION_MODE_LINEAR, D2D1_COMPOSITE_MODE_SOURCE_OVER);
    dc_->PopLayer();
    return true;
}

void GlassLens::DrawRim(const ui::Box& box, double radius, double opacity) {
    if (!ok() || opacity <= 0.0) return;
    Placement placement{};
    if (!Place(box, placement)) return;
    Kernel* kernel = KernelFor(placement, radius);
    if (kernel == nullptr) return;
    PushShape(box, radius, 1.0);
    const D2D1_RECT_F destination = D2D1::RectF(
        static_cast<FLOAT>(placement.x), static_cast<FLOAT>(placement.y),
        static_cast<FLOAT>(placement.x + static_cast<std::int32_t>(placement.width)),
        static_cast<FLOAT>(placement.y + static_cast<std::int32_t>(placement.height)));
    dc_->DrawBitmap(kernel->rim.Get(), destination, static_cast<FLOAT>(opacity), D2D1_INTERPOLATION_MODE_LINEAR,
                    nullptr, nullptr);
    dc_->PopLayer();
}

}  // namespace tvm::platform
