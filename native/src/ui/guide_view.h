#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "ui/painter.h"

namespace tvm::guide {

using Time = std::int64_t;
inline constexpr Time kHalfHour = 1800;
inline constexpr Time kVisible = 3 * 3600;
std::optional<Time> ParseTime(const std::string& iso);
std::string IsoTime(Time time);
Time FloorHalfHour(Time time);

struct Programme {
    Time start = 0, end = 0;
    std::string title, subtitle, description, category, image, episode;
};
struct Channel {
    std::string id, number, name, logo, group, source;
    std::vector<Programme> programmes;
};
struct Schedule {
    Time start = 0, end = 0;
    std::vector<Channel> channels;
    std::vector<std::string> groups;
    // Core is still downloading a feed, so channels and programmes may be missing for now.
    bool refreshing = false;
};

// While Core says it is still downloading a guide feed, the app asks again every few seconds, at most this many
// times, so the first visit does not stay on empty "No guide information" blocks.
inline constexpr int kMaxRepolls = 30;
inline constexpr double kRepollMs = 4000.0;
inline bool ShouldRepoll(bool refreshing, int repollsSoFar) { return refreshing && repollsSoFar < kMaxRepolls; }

Schedule ParseSchedule(const nlohmann::json& body, Time start, Time end);

class View {
public:
    enum class Move { Left, Right, Up, Down, PageUp, PageDown };
    void SetSchedule(Schedule schedule, Time start);
    void Layout(double width, double height);
    void Paint(ui::Painter& painter, Time now) const;
    void Navigate(Move move);
    void ScrollTime(int ticks);
    void ScrollRows(int rows);
    void SelectDay(int shift, Time now);
    void CycleGroup();
    void Search(std::string text);
    const std::string& query() const { return query_; }
    void SetFavorites(std::vector<std::string> favorites);
    std::string Click(double x, double y, Time now);
    bool Hover(double x, double y);
    std::string Tune(const std::string& number);
    std::string SelectedId() const;
    std::string GroupLabel() const;
    Time start() const { return start_; }
    Time end() const { return start_ + kVisible; }
    Time cursor() const { return cursor_; }
    int selectedRow() const { return row_; }

private:
    const Channel* Selected() const;
    const Programme* At(const Channel& channel, Time time) const;
    void Refilter();
    void KeepRowVisible();
    int RowsShown() const;
    double ListTop() const { return 126; }
    double ListBottom() const;
    double ChannelWidth() const;
    double GridWidth() const;
    std::array<ui::Box, 6> Toolbar() const;
    double TimeX(Time time) const;
    Time TimeAt(double x) const;

    Schedule schedule_;
    std::vector<std::size_t> rows_;
    std::vector<std::string> favorites_;
    Time start_ = 0, cursor_ = 0;
    int row_ = 0, top_ = 0, group_ = 0;
    std::string query_;
    bool selectedByClick_ = false;
    bool backHovered_ = false;
    double width_ = 1280, height_ = 720;
};

} // namespace tvm::guide
