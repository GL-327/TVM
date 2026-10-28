#include "platform/d2d_painter.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <stdexcept>

#include "core/util.h"
#include "platform/assets.h"

namespace tvm::platform {

namespace {

D2D1_RECT_F ToRect(const ui::Box& box) {
    return D2D1::RectF(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y), static_cast<FLOAT>(box.Right()),
                       static_cast<FLOAT>(box.Bottom()));
}

D2D1_COLOR_F ToColor(const ui::Color& color) {
    return D2D1::ColorF(static_cast<FLOAT>(color.r), static_cast<FLOAT>(color.g), static_cast<FLOAT>(color.b),
                        static_cast<FLOAT>(color.a));
}

D2D1_ROUNDED_RECT ToRounded(const ui::Box& box, double radius) {
    return D2D1::RoundedRect(ToRect(box), static_cast<FLOAT>(radius), static_cast<FLOAT>(radius));
}

// The weight a style draws at: the one it names, else SemiBold for bold and Normal otherwise.
int WeightOf(const ui::TextStyle& style) {
    if (style.weight != 0) return style.weight;
    return style.bold ? DWRITE_FONT_WEIGHT_SEMI_BOLD : DWRITE_FONT_WEIGHT_NORMAL;
}

}  // namespace

D2dPainter::D2dPainter(ID2D1RenderTarget* target, Graphics& graphics, ArtworkStore* artwork, ImageCache* images)
    : target_(target), graphics_(graphics), artwork_(artwork), images_(images) {}

ComPtr<ID2D1SolidColorBrush> D2dPainter::Brush(ui::Color color) {
    ComPtr<ID2D1SolidColorBrush> brush;
    if (FAILED(target_->CreateSolidColorBrush(ToColor(color), &brush))) {
        throw std::runtime_error("could not create a brush");
    }
    return brush;
}

void D2dPainter::Clear(ui::Color color) {
    target_->Clear(ToColor(color));
}

void D2dPainter::FillRoundRect(const ui::Box& box, double radius, ui::Color color) {
    const ComPtr<ID2D1SolidColorBrush> brush = Brush(color);
    target_->FillRoundedRectangle(ToRounded(box, radius), brush.Get());
}

void D2dPainter::StrokeRoundRect(const ui::Box& box, double radius, double width, ui::Color color) {
    const ComPtr<ID2D1SolidColorBrush> brush = Brush(color);
    target_->DrawRoundedRectangle(ToRounded(box, radius), brush.Get(), static_cast<FLOAT>(width));
}

bool D2dPainter::Image(const ui::Box& box, const std::string& url, double radius) {
    return ImageFaded(box, url, radius, 1.0, 0.5, 0.5);
}

bool D2dPainter::ImageFaded(const ui::Box& box, const std::string& url, double radius, double opacity, double focusX,
                            double focusY) {
    if (images_ == nullptr) return false;
    // A picture named "asset:" is a file shipped with the app. Any other is an address in the artwork cache.
    std::optional<paths::fs::path> file;
    if (url.rfind(kAssetPrefix, 0) == 0) {
        file = AssetFile(url.substr(sizeof(kAssetPrefix) - 1));
    } else if (url.rfind("file:", 0) == 0) {
        // A picture TVM made itself, such as a trickplay thumbnail, named by its path.
        file = paths::fs::path(util::ToWide(url.substr(5)));
    } else if (artwork_ != nullptr) {
        file = artwork_->Lookup(url);
    }
    if (!file.has_value()) return false;
    ID2D1Bitmap* bitmap = images_->Get(target_, file->wstring());
    if (bitmap == nullptr) return false;

    // Cover-fit: scale the picture until it fills the box, and place the overflow by the focal point.
    const D2D1_SIZE_F size = bitmap->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f || box.width <= 0.0 || box.height <= 0.0) return false;
    const double scale = std::max(box.width / size.width, box.height / size.height);
    const double offsetX = box.x + (box.width - size.width * scale) * focusX;
    const double offsetY = box.y + (box.height - size.height * scale) * focusY;

    D2D1_BITMAP_BRUSH_PROPERTIES properties = D2D1::BitmapBrushProperties(
        D2D1_EXTEND_MODE_CLAMP, D2D1_EXTEND_MODE_CLAMP, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
    ComPtr<ID2D1BitmapBrush> brush;
    if (FAILED(target_->CreateBitmapBrush(bitmap, properties, &brush))) return false;
    brush->SetTransform(D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(scale), static_cast<FLOAT>(scale)) *
                        D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(offsetX), static_cast<FLOAT>(offsetY)));
    brush->SetOpacity(static_cast<FLOAT>(std::clamp(opacity, 0.0, 1.0)));
    target_->FillRoundedRectangle(ToRounded(box, radius), brush.Get());
    return true;
}

ComPtr<ID2D1GradientStopCollection> D2dPainter::Stops(const std::vector<ui::GradientStop>& stops) {
    std::vector<D2D1_GRADIENT_STOP> raw;
    for (const ui::GradientStop& stop : stops) {
        raw.push_back(D2D1_GRADIENT_STOP{static_cast<FLOAT>(stop.position), ToColor(stop.color)});
    }
    // CSS blends the stops in the colour values as they are, which is the linear gamma D2D names 1.0.
    ComPtr<ID2D1GradientStopCollection> collection;
    if (raw.empty() ||
        FAILED(target_->CreateGradientStopCollection(raw.data(), static_cast<UINT32>(raw.size()), D2D1_GAMMA_1_0,
                                                     D2D1_EXTEND_MODE_CLAMP, &collection))) {
        throw std::runtime_error("could not create a gradient");
    }
    return collection;
}

ComPtr<ID2D1PathGeometry> D2dPainter::Polygon(const std::vector<ui::Point>& points) {
    ComPtr<ID2D1PathGeometry> geometry;
    if (points.size() < 3 || FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return nullptr;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return nullptr;
    sink->BeginFigure(D2D1::Point2F(static_cast<FLOAT>(points[0].x), static_cast<FLOAT>(points[0].y)),
                      D2D1_FIGURE_BEGIN_FILLED);
    for (std::size_t i = 1; i < points.size(); ++i) {
        sink->AddLine(D2D1::Point2F(static_cast<FLOAT>(points[i].x), static_cast<FLOAT>(points[i].y)));
    }
    sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    if (FAILED(sink->Close())) return nullptr;
    return geometry;
}

void D2dPainter::FillPolygon(const std::vector<ui::Point>& points, ui::Color color) {
    const ComPtr<ID2D1PathGeometry> geometry = Polygon(points);
    if (!geometry) return;
    const ComPtr<ID2D1SolidColorBrush> brush = Brush(color);
    target_->FillGeometry(geometry.Get(), brush.Get());
}

void D2dPainter::FillPolygonLinear(const std::vector<ui::Point>& points, double x0, double y0, double x1, double y1,
                                   const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1PathGeometry> geometry = Polygon(points);
    if (!geometry) return;
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties = D2D1::LinearGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(x0), static_cast<FLOAT>(y0)),
        D2D1::Point2F(static_cast<FLOAT>(x1), static_cast<FLOAT>(y1)));
    ComPtr<ID2D1LinearGradientBrush> brush;
    if (FAILED(target_->CreateLinearGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillGeometry(geometry.Get(), brush.Get());
}

void D2dPainter::FillLinearGradient(const ui::Box& box, double x0, double y0, double x1, double y1,
                                    const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties = D2D1::LinearGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(x0), static_cast<FLOAT>(y0)),
        D2D1::Point2F(static_cast<FLOAT>(x1), static_cast<FLOAT>(y1)));
    ComPtr<ID2D1LinearGradientBrush> brush;
    if (FAILED(target_->CreateLinearGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillRectangle(ToRect(box), brush.Get());
}

void D2dPainter::FillRadialGradient(const ui::Box& box, double cx, double cy, double rx, double ry,
                                    const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES properties = D2D1::RadialGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(cx), static_cast<FLOAT>(cy)), D2D1::Point2F(0.0f, 0.0f),
        static_cast<FLOAT>(rx), static_cast<FLOAT>(ry));
    ComPtr<ID2D1RadialGradientBrush> brush;
    if (FAILED(target_->CreateRadialGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillRectangle(ToRect(box), brush.Get());
}

void D2dPainter::Paragraph(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    const std::wstring wide = util::ToWide(std::string(text));
    const ComPtr<ID2D1SolidColorBrush> brush = Brush(color);
    IDWriteTextFormat* format = graphics_.ParagraphFormat(style.sizePx, WeightOf(style));
    target_->DrawTextW(wide.c_str(), static_cast<UINT32>(wide.size()), format, ToRect(box), brush.Get(),
                       D2D1_DRAW_TEXT_OPTIONS_CLIP, DWRITE_MEASURING_MODE_NATURAL);
}

void D2dPainter::Text(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    const std::wstring wide = util::ToWide(std::string(text));
    const ComPtr<ID2D1SolidColorBrush> brush = Brush(color);
    IDWriteTextFormat* format = graphics_.TextFormat(style.sizePx, WeightOf(style));
    target_->DrawTextW(wide.c_str(), static_cast<UINT32>(wide.size()), format, ToRect(box), brush.Get(),
                       D2D1_DRAW_TEXT_OPTIONS_CLIP, DWRITE_MEASURING_MODE_NATURAL);
}

double D2dPainter::MeasureText(std::string_view text, const ui::TextStyle& style) {
    const std::wstring wide = util::ToWide(std::string(text));
    IDWriteTextFormat* format = graphics_.TextFormat(style.sizePx, WeightOf(style));
    ComPtr<IDWriteTextLayout> layout;
    DWRITE_TEXT_METRICS metrics{};
    if (FAILED(graphics_.dwrite()->CreateTextLayout(wide.c_str(), static_cast<UINT32>(wide.size()), format, 100000.0f,
                                                    1000.0f, &layout)) ||
        FAILED(layout->GetMetrics(&metrics))) {
        return ui::Painter::MeasureText(text, style);
    }
    return metrics.widthIncludingTrailingWhitespace;
}

void D2dPainter::Path(const ui::Box& box, double viewBox, std::string_view data, const ui::PathStyle& style) {
    // The path is read into a geometry in its own units, then drawn through a transform that fits the box.
    ComPtr<ID2D1PathGeometry> geometry;
    if (viewBox <= 0.0 || FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return;

    std::size_t at = 0;
    const auto skip = [&] {
        while (at < data.size() && (data[at] == ' ' || data[at] == ',' || data[at] == '\n')) ++at;
    };
    // Numbers may run together as SVG allows, such as "1-3".
    const auto number = [&]() -> FLOAT {
        skip();
        const std::string rest(data.substr(at, 32));
        char* end = nullptr;
        const double value = std::strtod(rest.c_str(), &end);
        at += static_cast<std::size_t>(end - rest.c_str());
        return static_cast<FLOAT>(value);
    };
    // An arc flag is one digit, and may touch the next number.
    const auto flag = [&] {
        skip();
        return at < data.size() && data[at++] == '1';
    };
    const auto numberNext = [&] {
        skip();
        return at < data.size() && !std::isalpha(static_cast<unsigned char>(data[at]));
    };

    const D2D1_FIGURE_BEGIN fill = style.fill.a > 0.0 ? D2D1_FIGURE_BEGIN_FILLED : D2D1_FIGURE_BEGIN_HOLLOW;
    D2D1_POINT_2F current{0.0f, 0.0f};
    D2D1_POINT_2F start{0.0f, 0.0f};
    bool open = false;
    char command = 'M';
    while (true) {
        skip();
        if (at >= data.size()) break;
        if (std::isalpha(static_cast<unsigned char>(data[at]))) command = data[at++];
        const bool relative = std::islower(static_cast<unsigned char>(command)) != 0;
        const FLOAT ox = relative ? current.x : 0.0f;
        const FLOAT oy = relative ? current.y : 0.0f;
        switch (std::toupper(static_cast<unsigned char>(command))) {
        case 'M': {
            const FLOAT x = number();
            const FLOAT y = number();
            if (open) sink->EndFigure(D2D1_FIGURE_END_OPEN);
            current = start = D2D1::Point2F(ox + x, oy + y);
            sink->BeginFigure(current, fill);
            open = true;
            // Pairs after a move are lines, as SVG reads them.
            command = relative ? 'l' : 'L';
            break;
        }
        case 'L': {
            const FLOAT x = number();
            const FLOAT y = number();
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddLine(current);
            break;
        }
        case 'H':
            current.x = ox + number();
            sink->AddLine(current);
            break;
        case 'V':
            current.y = oy + number();
            sink->AddLine(current);
            break;
        case 'A': {
            const FLOAT rx = number();
            const FLOAT ry = number();
            const FLOAT rotation = number();
            const bool large = flag();
            const bool sweep = flag();
            const FLOAT x = number();
            const FLOAT y = number();
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddArc(D2D1::ArcSegment(current, D2D1::SizeF(rx, ry), rotation,
                                          sweep ? D2D1_SWEEP_DIRECTION_CLOCKWISE : D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
                                          large ? D2D1_ARC_SIZE_LARGE : D2D1_ARC_SIZE_SMALL));
            break;
        }
        case 'Z':
            if (open) sink->EndFigure(D2D1_FIGURE_END_CLOSED);
            open = false;
            current = start;
            // A move may follow at once, written as bare numbers after the close.
            if (numberNext()) command = relative ? 'm' : 'M';
            break;
        default:
            // A command this reader does not know ends the path there.
            at = data.size();
            break;
        }
    }
    if (open) sink->EndFigure(D2D1_FIGURE_END_OPEN);
    if (FAILED(sink->Close())) return;

    const auto scale = static_cast<FLOAT>(std::min(box.width, box.height) / viewBox);
    const D2D1_MATRIX_3X2_F fit =
        D2D1::Matrix3x2F::Scale(style.mirror ? -scale : scale, scale) *
        D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(style.mirror ? box.x + viewBox * scale : box.x),
                                      static_cast<FLOAT>(box.y));
    D2D1_MATRIX_3X2_F previous{};
    target_->GetTransform(&previous);
    target_->SetTransform(fit * previous);
    if (style.fill.a > 0.0) target_->FillGeometry(geometry.Get(), Brush(style.fill).Get());
    if (style.stroke.a > 0.0 && style.strokeWidth > 0.0) {
        ComPtr<ID2D1StrokeStyle> round;
        graphics_.d2d()->CreateStrokeStyle(D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND,
                                                                       D2D1_CAP_STYLE_ROUND, D2D1_LINE_JOIN_ROUND),
                                           nullptr, 0, &round);
        target_->DrawGeometry(geometry.Get(), Brush(style.stroke).Get(), static_cast<FLOAT>(style.strokeWidth),
                              round.Get());
    }
    target_->SetTransform(previous);
}

void D2dPainter::PushClip(const ui::Box& box) {
    target_->PushAxisAlignedClip(ToRect(box), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    ++clipDepth_;
}

void D2dPainter::PopClip() {
    if (clipDepth_ == 0) throw std::logic_error("PopClip without a matching PushClip");
    target_->PopAxisAlignedClip();
    --clipDepth_;
}

}  // namespace tvm::platform
