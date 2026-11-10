#pragma once

#include <algorithm>
#include "ui/painter.h"

namespace tvm::ui {

// Preserve the TV layout at 720p and above; keep text readable in short and
// portrait windows instead of shrinking the entire TV interface to fit.
inline double ViewportRem(double width, double height) {
    if (width <= 0.0 || height <= 0.0) return 16.0;
    const double floor = width < height ? 14.0 : 10.666666666666666;
    return std::clamp(height / 67.5, floor, 32.0);
}

inline bool CompactViewport(double width, double height) {
    return width < 64.0 * ViewportRem(width, height);
}

// Shared by navigation, settings actions and profile grids. Hit boxes and
// painted boxes come from the same flow, including after a live resize.
class FlowLayout {
public:
    FlowLayout(double x, double y, double width, double gap)
        : left_(x), right_(x + std::max(1.0, width)), x_(x), y_(y), gap_(gap) {}
    Box Place(double width, double height) {
        width = std::clamp(width, 1.0, right_ - left_);
        if (x_ > left_ && x_ + width > right_ + 0.01) {
            x_ = left_;
            y_ += rowHeight_ + gap_;
            rowHeight_ = 0.0;
            ++row_;
        }
        const Box box{x_, y_, width, height};
        x_ += width + gap_;
        rowHeight_ = std::max(rowHeight_, height);
        return box;
    }
    double Bottom() const { return y_ + rowHeight_; }
    int Row() const { return row_; }
private:
    double left_, right_, x_, y_, gap_, rowHeight_ = 0.0;
    int row_ = 0;
};

}  // namespace tvm::ui
