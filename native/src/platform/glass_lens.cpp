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
#include "ui/theme.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <iterator>
#include <vector>

namespace tvm::platform {

namespace {

// Surfaces larger than this on either side are not refracted; nothing in the UI is that large.
constexpr std::uint32_t kMaxSide = 2048;
constexpr std::size_t kMaxKernels = 48;

// A convex bezel gives the silhouette a strong inward pull while the centre stays flat (tuned after PyGlass).
constexpr double kBevelFraction = 0.50;
constexpr double kMaxBevel = 24.0;
constexpr double kShiftPerBevel = 2.35;
// Dispersion: red bends slightly less and blue slightly more along high-contrast rims.
constexpr double kMaxDispersion = 2.40;
// Light falls from the upper left, steeper than 45 degrees, so top edges catch more of it than the sides.
constexpr double kLightX = -0.50;
constexpr double kLightY = -0.866;
// The specular glint: a crisp line at the silhouette with soft inner bleed and grazing Fresnel veil.
constexpr double kGlintWidth = 1.1;
constexpr double kGlintBleed = 0.11;
constexpr double kFarSide = 0.28;
constexpr double kRimVeil = 0.20;
constexpr double kRimVeilWidth = 4.2;
// Darker hairline contour outside the bright specular edge for separation over vivid bloom waves.
constexpr double kContourWidth = 1.0;
constexpr double kContourBleed = 0.24;
constexpr double kContourDirectionality = 0.85;
// Colour behind the glass is lifted dynamically as PyGlass vibrancy boosts saturated ripples.
constexpr float kVibrancySaturation = 1.82f;
// How many surfaces may measure brightness in one frame, and how many frames a reading lasts. A surface seen
// for the first time always measures, so a still frame adapts at once.
constexpr int kMeasuresPerFrame = 3;
constexpr std::uint64_t kReadingFrames = 12;

// Signed distance from (px, py), measured from the centre, to a rounded rectangle of half-sides hx, hy and corner
// radius r: negative inside. `nx`, `ny` receive the outward normal in the plane.
double RoundedBoxDistance(double px, double py, double hx, double hy, double r, double& nx, double& ny) {
    const double qx = std::fabs(px) - (hx - r);
    const double qy = std::fabs(py) - (hy - r);
    nx = 0.0;
    ny = 0.0;
    if (qx > 0.0 && qy > 0.0) {
        const double length = std::hypot(qx, qy);
        nx = std::copysign(qx / length, px);
        ny = std::copysign(qy / length, py);
    } else if (qx > qy) {
        nx = px < 0.0 ? -1.0 : 1.0;
    } else {
        ny = py < 0.0 ? -1.0 : 1.0;
    }
    const double outside = std::hypot(std::max(qx, 0.0), std::max(qy, 0.0));
    return outside + std::min(std::max(qx, qy), 0.0) - r;
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
    constexpr float brightness = 1.05f;
    const float lr = 0.2126f * inv * brightness;
    const float lg = 0.7152f * inv * brightness;
    const float lb = 0.0722f * inv * brightness;
    D2D1_MATRIX_5X4_F m{};
    m.m[0][0] = lr + s * brightness;
    m.m[1][0] = lg;
    m.m[2][0] = lb;
    m.m[0][1] = lr;
    m.m[1][1] = lg + s * brightness;
    m.m[2][1] = lb;
    m.m[0][2] = lr;
    m.m[1][2] = lg;
    m.m[2][2] = lb + s * brightness;
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
           SUCCEEDED(dc_->CreateEffect(CLSID_D2D1GaussianBlur, &frost_)) &&
           SUCCEEDED(dc_->CreateEffect(CLSID_D2D1GaussianBlur, &soften_));
    if (!made) {
        dc_.Reset();
        return;
    }
    sum_->SetInputCount(3);
    for (int c = 0; c < 3; ++c) sum_->SetInputEffect(static_cast<UINT32>(c), channel_[c].Get());
    sum_->SetValue(D2D1_COMPOSITE_PROP_MODE, D2D1_COMPOSITE_MODE_PLUS);
    vibrancy_->SetInputEffect(0, sum_.Get());
    vibrancy_->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX, SaturationMatrix(kVibrancySaturation));
    // Hard edges: the blur never pulls in transparent black from outside the copied pixels.
    frost_->SetValue(D2D1_GAUSSIANBLUR_PROP_BORDER_MODE, D2D1_BORDER_MODE_HARD);
    soften_->SetValue(D2D1_GAUSSIANBLUR_PROP_BORDER_MODE, D2D1_BORDER_MODE_HARD);
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
    const double half = std::min(hx, hy);
    const double bevel = std::min(kBevelFraction * half, kMaxBevel);
    const double amount = std::min(kShiftPerBevel * bevel, 0.9 * half);
    const double lightLength = std::hypot(kLightX, kLightY);
    const double lx = kLightX / lightLength;
    const double ly = kLightY / lightLength;

    std::vector<double> shiftX(static_cast<std::size_t>(w) * h, 0.0);
    std::vector<double> shiftY(shiftX.size(), 0.0);
    std::vector<std::uint8_t> rim(shiftX.size() * 4, 0);
    std::vector<std::uint8_t> contour(shiftX.size() * 4, 0);
    double maxShift = 0.5;
    for (std::uint32_t y = 0; y < h; ++y) {
        for (std::uint32_t x = 0; x < w; ++x) {
            const std::size_t i = static_cast<std::size_t>(y) * w + x;
            double nx = 0.0;
            double ny = 0.0;
            const double d = -RoundedBoxDistance(x + 0.5 - hx, y + 0.5 - hy, hx, hy, r, nx, ny);
            if (d <= 0.0) continue;

            // Refraction through the convex bezel, in the closed form both fits use: the slope of a quarter circle,
            // nothing at the inner end of the bezel and the full shift at the rim, where the face is vertical. The
            // ray leans inward, so each rim pixel shows the picture a little further inside.
            const double rimward = std::clamp(1.0 - d / bevel, 0.0, 1.0);
            const double shift = amount * (1.0 - std::sqrt(std::max(0.0, 1.0 - rimward * rimward)));
            shiftX[i] = -shift * nx;
            shiftY[i] = -shift * ny;
            maxShift = std::max({maxShift, std::fabs(shiftX[i]), std::fabs(shiftY[i])});

            // How squarely this stretch of rim faces the light (1), faces away from it (-1) or runs across it (0).
            const double facing = nx * lx + ny * ly;
            const double lobe = 0.15 + (facing > 0.0 ? 0.60 * facing : kFarSide * -facing);
            const double coverage = std::clamp(1.0 + kGlintWidth * 0.5 - d, 0.0, 1.0);
            const double glint = lobe * coverage +
                                 kGlintBleed * std::clamp(1.0 - d / (4.0 * kGlintWidth), 0.0, 1.0);
            const double grazing = std::clamp(1.0 - d / kRimVeilWidth, 0.0, 1.0);
            const double veil = kRimVeil * grazing * grazing * (0.5 + 0.5 * lobe);
            const double white = std::clamp(glint + veil, 0.0, 0.96);
            rim[i * 4 + 0] = Byte(white);
            rim[i * 4 + 1] = Byte(white);
            rim[i * 4 + 2] = Byte(white);
            rim[i * 4 + 3] = Byte(white);

            const double across = 1.0 - kContourDirectionality * std::fabs(facing);
            const double shade = std::clamp(across * (std::clamp(1.0 - d / kContourWidth, 0.0, 1.0) +
                                                      kContourBleed * std::clamp(1.0 - d / (3.0 * kContourWidth), 0.0, 1.0)),
                                            0.0, 1.0);
            contour[i * 4 + 3] = Byte(shade);
        }
    }

    // The soft shadow under the surface: the shape blurred (so half strength right at its edge), dropped a little,
    // and wider for larger surfaces. Nothing is drawn inside the shape, which the glass covers.
    const double sigma = std::clamp(0.375 * half, 5.0, 22.0);
    const std::uint32_t margin = static_cast<std::uint32_t>(std::ceil(3.0 * sigma));
    const double drop = std::clamp(0.19 * half, 2.0, 12.0);
    const std::uint32_t sw = w + 2 * margin;
    const std::uint32_t sh = h + 2 * margin;
    std::vector<std::uint8_t> shadow(static_cast<std::size_t>(sw) * sh * 4, 0);
    for (std::uint32_t y = 0; y < sh; ++y) {
        for (std::uint32_t x = 0; x < sw; ++x) {
            const double px = x + 0.5 - margin - hx;
            const double py = y + 0.5 - margin - hy;
            double nx = 0.0;
            double ny = 0.0;
            const double own = RoundedBoxDistance(px, py, hx, hy, r, nx, ny);
            if (own <= -0.5) continue;
            const double cast = RoundedBoxDistance(px, py - drop, hx, hy, r, nx, ny);
            const double outside = std::clamp(own + 0.5, 0.0, 1.0);
            const double a = outside * 0.5 * std::erfc(cast / (sigma * std::sqrt(2.0)));
            shadow[(static_cast<std::size_t>(y) * sw + x) * 4 + 3] = Byte(a);
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
    kernel.shadowMargin = margin;
    kernel.half = half;
    kernel.used = ++clock_;
    const D2D1_BITMAP_PROPERTIES1 straight = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_NONE, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    const D2D1_BITMAP_PROPERTIES1 captured = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE, dc_->GetPixelFormat());
    const D2D1_SIZE_U size = D2D1::SizeU(w, h);
    if (FAILED(dc_->CreateBitmap(size, map.data(), w * 4, straight, &kernel.displacement)) ||
        FAILED(dc_->CreateBitmap(size, rim.data(), w * 4, straight, &kernel.rim)) ||
        FAILED(dc_->CreateBitmap(size, contour.data(), w * 4, straight, &kernel.contour)) ||
        FAILED(dc_->CreateBitmap(D2D1::SizeU(sw, sh), shadow.data(), sw * 4, straight, &kernel.shadow)) ||
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
    const float dispersion = static_cast<float>(std::min(kMaxDispersion, 0.042 * kernel->maxShift));
    const float channelScale[3] = {scale - 2.0f * dispersion, scale, scale + 2.0f * dispersion};
    ID2D1Effect* scatter = frosted ? frost_.Get() : soften_.Get();
    const double sigma = frosted ? std::clamp(kernel->half * 0.10, 6.0, 8.0)
                                 : std::clamp(kernel->half * 0.12, 2.0, 4.0);
    scatter->SetValue(D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, static_cast<FLOAT>(sigma));
    scatter->SetInput(0, kernel->capture.Get());
    for (int c = 0; c < 3; ++c) {
        shift_[c]->SetInputEffect(0, scatter);
        shift_[c]->SetInput(1, kernel->displacement.Get());
        shift_[c]->SetValue(D2D1_DISPLACEMENTMAP_PROP_SCALE, channelScale[c]);
    }

    PushShape(box, radius, opacity);
    dc_->DrawImage(vibrancy_.Get(), D2D1::Point2F(static_cast<FLOAT>(placement.x), static_cast<FLOAT>(placement.y)),
                   D2D1_INTERPOLATION_MODE_LINEAR, D2D1_COMPOSITE_MODE_SOURCE_OVER);
    dc_->PopLayer();
    return true;
}

bool GlassLens::DrawShadow(const ui::Box& box, double radius, double opacity, double drop) {
    if (!ok() || opacity <= 0.0) return false;
    Placement placement{};
    if (!Place(box, placement)) return false;
    Kernel* kernel = KernelFor(placement, radius);
    if (kernel == nullptr || !kernel->shadow) return false;
    const D2D1_SIZE_U size = kernel->shadow->GetPixelSize();
    const FLOAT left = static_cast<FLOAT>(placement.x) - static_cast<FLOAT>(kernel->shadowMargin);
    const FLOAT top = static_cast<FLOAT>(placement.y) - static_cast<FLOAT>(kernel->shadowMargin) + static_cast<FLOAT>(drop);
    const D2D1_RECT_F destination =
        D2D1::RectF(left, top, left + static_cast<FLOAT>(size.width), top + static_cast<FLOAT>(size.height));
    dc_->DrawBitmap(kernel->shadow.Get(), destination, static_cast<FLOAT>(std::clamp(opacity, 0.0, 1.0)),
                    D2D1_INTERPOLATION_MODE_LINEAR, nullptr, nullptr);
    return true;
}

void GlassLens::DrawRim(const ui::Box& box, double radius, double opacity, double contour) {
    if (!ok() || (opacity <= 0.0 && contour <= 0.0)) return;
    Placement placement{};
    if (!Place(box, placement)) return;
    Kernel* kernel = KernelFor(placement, radius);
    if (kernel == nullptr) return;
    PushShape(box, radius, 1.0);
    const D2D1_RECT_F destination = D2D1::RectF(
        static_cast<FLOAT>(placement.x), static_cast<FLOAT>(placement.y),
        static_cast<FLOAT>(placement.x + static_cast<std::int32_t>(placement.width)),
        static_cast<FLOAT>(placement.y + static_cast<std::int32_t>(placement.height)));
    if (contour > 0.0) {
        dc_->DrawBitmap(kernel->contour.Get(), destination, static_cast<FLOAT>(std::min(contour, 1.0)),
                        D2D1_INTERPOLATION_MODE_LINEAR, nullptr, nullptr);
    }
    if (opacity > 0.0) {
        dc_->DrawBitmap(kernel->rim.Get(), destination, static_cast<FLOAT>(std::min(opacity, 1.0)),
                        D2D1_INTERPOLATION_MODE_LINEAR, nullptr, nullptr);
    }
    dc_->PopLayer();
}

}  // namespace tvm::platform
