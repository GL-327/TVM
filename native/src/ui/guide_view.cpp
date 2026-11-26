#include "ui/guide_view.h"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <utility>

namespace tvm::guide {
namespace {
using namespace std::chrono;
constexpr double kEdge = 36, kRow = 64;
constexpr auto kBackground = ui::Rgb(0x07080B);
constexpr auto kSurface = ui::Rgb(0x12141A);
constexpr auto kCell = ui::Rgb(0x1A1D25);
constexpr auto kWhite = ui::Rgb(0xF5F7FA);
constexpr auto kMuted = ui::Rgb(0xA9B0BC);
constexpr auto kRed = ui::Rgb(0xE5484D);

std::optional<int> Digits(const std::string& value, std::size_t start, std::size_t count) {
    if (start + count > value.size()) return std::nullopt;
    int result = 0;
    const auto* begin = value.data() + start;
    const auto parsed = std::from_chars(begin, begin + count, result);
    if (parsed.ptr != begin + count || parsed.ec != std::errc() || result < 0) return std::nullopt;
    return result;
}

std::string Text(const nlohmann::json& body, const char* key) {
    const auto value = body.find(key);
    return value != body.end() && value->is_string() ? value->get<std::string>() : "";
}

std::string Lower(std::string value) {
    for (char& c : value) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return value;
}

std::string Local(Time time, const char* format = "%H:%M") {
    const auto stamp = static_cast<std::time_t>(time);
    std::tm local{};
    char text[48]{};
    if (localtime_s(&local, &stamp) == 0) std::strftime(text, sizeof(text), format, &local);
    return text;
}
}

std::optional<Time> ParseTime(const std::string& iso) {
    if (iso.size() < 20 || iso[4] != '-' || iso[7] != '-' || iso[10] != 'T' || iso[13] != ':' || iso[16] != ':') return {};
    const auto y = Digits(iso, 0, 4), m = Digits(iso, 5, 2), d = Digits(iso, 8, 2);
    const auto h = Digits(iso, 11, 2), min = Digits(iso, 14, 2), sec = Digits(iso, 17, 2);
    if (!y || !m || !d || !h || !min || !sec || *h > 23 || *min > 59 || *sec > 59) return {};
    const year_month_day date{year{*y}, month{static_cast<unsigned>(*m)}, day{static_cast<unsigned>(*d)}};
    if (!date.ok()) return {};
    std::size_t zone = 19;
    if (iso[zone] == '.') zone = iso.find_first_not_of("0123456789", zone + 1);
    if (zone >= iso.size()) return {};
    int offset = 0;
    if (iso[zone] == '+' || iso[zone] == '-') {
        if (zone + 6 != iso.size() || iso[zone + 3] != ':') return {};
        const auto zh = Digits(iso, zone + 1, 2), zm = Digits(iso, zone + 4, 2);
        if (!zh || !zm || *zh > 23 || *zm > 59) return {};
        offset = (*zh * 60 + *zm) * (iso[zone] == '+' ? 1 : -1);
    } else if (iso[zone] != 'Z' || zone + 1 != iso.size()) return {};
    return (sys_days(date) + hours(*h) + minutes(*min - offset) + seconds(*sec)).time_since_epoch().count();
}

std::string IsoTime(Time time) {
    const auto stamp = static_cast<std::time_t>(time);
    std::tm date{};
    char iso[24]{};
    if (gmtime_s(&date, &stamp) == 0) std::strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &date);
    return iso;
}

Time FloorHalfHour(Time time) { return time - (time % kHalfHour + kHalfHour) % kHalfHour; }

Schedule ParseSchedule(const nlohmann::json& body, Time start, Time end) {
    Schedule data;
    data.start = ParseTime(Text(body, "start")).value_or(start);
    data.end = ParseTime(Text(body, "end")).value_or(end);
    if (const auto groups = body.find("groups"); groups != body.end() && groups->is_array()) {
        for (const auto& group : *groups) if (group.is_string()) data.groups.push_back(group.get<std::string>());
    }
    const auto channels = body.find("channels");
    if (channels == body.end() || !channels->is_array()) return data;
    for (const auto& row : *channels) {
        if (!row.is_object()) continue;
        Channel channel;
        channel.id = Text(row, "id");
        channel.name = Text(row, "name");
        if (channel.id.empty() || channel.name.empty()) continue;
        channel.number = Text(row, "number");
        if (const auto number = row.find("number"); number != row.end() && number->is_number_integer()) channel.number = number->dump();
        channel.logo = Text(row, "logo");
        channel.group = Text(row, "group");
        channel.source = Text(row, "source");
        if (const auto items = row.find("programmes"); items != row.end() && items->is_array()) {
            for (const auto& item : *items) {
                const auto from = ParseTime(Text(item, "start")), to = ParseTime(Text(item, "end"));
                if (!from || !to || *to <= *from) continue;
                auto title = Text(item, "title");
                if (title.empty()) continue;
                channel.programmes.push_back({*from, *to, std::move(title), Text(item, "subtitle"), Text(item, "description"),
                                              Text(item, "category"), Text(item, "image"), Text(item, "episode")});
            }
        }
        std::stable_sort(channel.programmes.begin(), channel.programmes.end(), [](const Programme& a, const Programme& b) { return a.start < b.start; });
        data.channels.push_back(std::move(channel));
    }
    return data;
}

void View::SetSchedule(Schedule schedule, Time start) {
    const auto selected = SelectedId();
    schedule_ = std::move(schedule);
    if (start_ == 0) start_ = cursor_ = start;
    if (group_ > static_cast<int>(schedule_.groups.size()) + 1) group_ = 0;
    Refilter();
    for (std::size_t i = 0; i < rows_.size(); ++i) if (schedule_.channels[rows_[i]].id == selected) { row_ = static_cast<int>(i); break; }
    KeepRowVisible();
}

void View::Layout(double width, double height) {
    width_ = width;
    height_ = height;
    KeepRowVisible();
}

const Channel* View::Selected() const {
    return rows_.empty() ? nullptr : &schedule_.channels[rows_[static_cast<std::size_t>(row_)]];
}

const Programme* View::At(const Channel& channel, Time time) const {
    for (const auto& item : channel.programmes) if (item.start <= time && item.end > time) return &item;
    return nullptr;
}

std::string View::SelectedId() const { const auto channel = Selected(); return channel ? channel->id : ""; }

std::string View::GroupLabel() const {
    if (group_ == 0) return "All channels";
    if (group_ == 1) return "Favourites";
    return schedule_.groups[static_cast<std::size_t>(group_ - 2)];
}

void View::Refilter() {
    rows_.clear();
    const auto needle = Lower(query_);
    for (std::size_t i = 0; i < schedule_.channels.size(); ++i) {
        const auto& channel = schedule_.channels[i];
        if (group_ == 1 && std::find(favorites_.begin(), favorites_.end(), channel.id) == favorites_.end()) continue;
        if (group_ > 1 && GroupLabel() != channel.group) continue;
        if (!needle.empty() && Lower(channel.name).find(needle) == std::string::npos &&
            std::none_of(channel.programmes.begin(), channel.programmes.end(), [&](const auto& p) {
                return p.end > start_ && p.start < end() && Lower(p.title).find(needle) != std::string::npos;
            })) continue;
        rows_.push_back(i);
    }
    KeepRowVisible();
}

void View::SetFavorites(std::vector<std::string> favorites) { favorites_ = std::move(favorites); Refilter(); }
void View::Search(std::string text) { query_ = std::move(text); row_ = top_ = 0; Refilter(); }
void View::CycleGroup() { group_ = (group_ + 1) % (static_cast<int>(schedule_.groups.size()) + 2); row_ = top_ = 0; Refilter(); }

double View::ListBottom() const { return std::min(height_ - 160, ListTop() + RowsShown() * kRow); }
int View::RowsShown() const { return std::max(1, static_cast<int>((height_ - 160 - ListTop()) / kRow)); }
double View::ChannelWidth() const { return std::clamp(width_ * 0.18, 142.0, 220.0); }
double View::GridWidth() const { return std::max(1.0, width_ - 2 * kEdge - ChannelWidth()); }
double View::TimeX(Time time) const { return kEdge + ChannelWidth() + GridWidth() * static_cast<double>(time - start_) / kVisible; }
Time View::TimeAt(double x) const { return start_ + static_cast<Time>(kVisible * (x - kEdge - ChannelWidth()) / GridWidth()); }

void View::KeepRowVisible() {
    const int lastRow = std::max(0, static_cast<int>(rows_.size()) - 1);
    row_ = std::clamp(row_, 0, lastRow);
    top_ = std::clamp(top_, 0, std::max(0, lastRow - RowsShown() + 1));
    if (row_ < top_) top_ = row_;
    if (row_ >= top_ + RowsShown()) top_ = row_ - RowsShown() + 1;
}

void View::ScrollRows(int amount) { row_ += amount; KeepRowVisible(); selectedByClick_ = false; }
void View::ScrollTime(int ticks) {
    start_ += ticks * kHalfHour;
    cursor_ = std::clamp(cursor_, start_, end() - 1);
    Refilter();
    selectedByClick_ = false;
}

void View::SelectDay(int shift, Time now) {
    if (shift == 0) start_ = FloorHalfHour(now);
    else {
        const auto stamp = static_cast<std::time_t>(start_);
        std::tm local{};
        if (localtime_s(&local, &stamp) == 0) {
            local.tm_mday += shift;
            local.tm_isdst = -1;
            start_ = FloorHalfHour(std::mktime(&local));
        }
    }
    cursor_ = start_;
    Refilter();
    selectedByClick_ = false;
}

void View::Navigate(Move move) {
    selectedByClick_ = false;
    if (move == Move::Up || move == Move::Down || move == Move::PageUp || move == Move::PageDown) {
        ScrollRows(move == Move::Up ? -1 : move == Move::Down ? 1 : move == Move::PageUp ? -8 : 8);
        return;
    }
    const auto channel = Selected();
    const auto programme = channel ? At(*channel, cursor_) : nullptr;
    if (move == Move::Left) {
        const Time candidate = programme ? programme->start - 1 : cursor_ - kHalfHour;
        if (candidate < start_) ScrollTime(-1);
        cursor_ = std::max(start_, candidate);
    } else {
        const Time candidate = programme ? programme->end : cursor_ + kHalfHour;
        if (candidate >= end()) ScrollTime(1);
        cursor_ = std::min(end() - 1, candidate);
    }
}

std::string View::Tune(const std::string& number) {
    for (const auto& channel : schedule_.channels) if (channel.number == number) return channel.id;
    return {};
}

std::string View::Click(double x, double y, Time now) {
    if (y >= 36 && y < 80) {
        if (x >= 144 && x < 188) SelectDay(-1, now);
        if (x >= 188 && x < 298) SelectDay(0, now);
        if (x >= 298 && x < 342) SelectDay(1, now);
        if (x >= 355 && x < 563) CycleGroup();
        if (x >= 576 && x < 730) return "@search";
        if (x >= 742 && x < 842) return "@channels";
        if (x >= 855 && x < 955) return "@back";
        return {};
    }
    if (y >= height_ - 72 && y < height_ - 24 && x >= width_ - 165 && x < width_ - kEdge) return SelectedId();
    if (x < kEdge || x >= width_ - kEdge || y < ListTop() || y >= ListBottom()) return {};
    const int target = top_ + static_cast<int>((y - ListTop()) / kRow);
    if (target >= static_cast<int>(rows_.size())) return {};
    const auto& channel = schedule_.channels[rows_[static_cast<std::size_t>(target)]];
    const auto time = std::max(start_, TimeAt(x));
    const auto item = At(channel, time);
    const bool same = target == row_ && At(channel, cursor_) == item;
    row_ = target;
    cursor_ = time;
    const bool watch = same && selectedByClick_;
    selectedByClick_ = true;
    return watch ? channel.id : "";
}

void View::Paint(ui::Painter& p, Time now) const {
    using ui::Box;
    const double right = width_ - kEdge, xGrid = kEdge + ChannelWidth();
    const double bottom = ListBottom();
    p.Clear(kBackground);
    p.Text({kEdge, 30, 105, 54}, "Guide", {34, true}, kWhite);
    const auto button = [&](const Box& box, std::string text, bool primary = false) {
        p.FillRoundRect(box, 12, primary ? kWhite : kCell);
        const double offset = std::max(10.0, (box.width - p.MeasureText(text, {15, true})) / 2);
        p.Text({box.x + offset, box.y, box.width - offset - 8, box.height}, text, {15, true}, primary ? kBackground : kWhite);
    };
    button({144, 36, 44, 44}, "‹");
    button({190, 36, 106, 44}, Local(start_, "%Y-%m-%d") == Local(now, "%Y-%m-%d") ? "Today" : Local(start_, "%a %d %b"));
    button({298, 36, 44, 44}, "›");
    button({355, 36, 208, 44}, GroupLabel() + "  ▾");
    button({576, 36, 154, 44}, query_.empty() ? "Search" : query_);
    button({742, 36, 100, 44}, "Channels");
    button({855, 36, 100, 44}, "Back");
    p.Text({right - 65, 36, 65, 44}, Local(now), {21, true}, kWhite);

    p.FillRoundRect({kEdge, 91, right - kEdge, 34}, 8, kSurface);
    p.Text({kEdge + 12, 91, ChannelWidth() - 24, 34}, "Channel", {14, true}, kMuted);
    for (Time tick = start_; tick < end(); tick += kHalfHour) {
        const double x = TimeX(tick);
        p.Text({x + 8, 91, TimeX(tick + kHalfHour) - x - 8, 34}, Local(tick), {14, true}, kMuted);
        p.FillRoundRect({x, 122, 1, std::max(0.0, bottom - 122)}, 0, ui::Rgb(0xFFFFFF, 0.07));
    }
    p.PushClip({kEdge, ListTop(), right - kEdge, std::max(0.0, bottom - ListTop())});
    for (int index = top_; index < std::min(top_ + RowsShown(), static_cast<int>(rows_.size())); ++index) {
        const auto& channel = schedule_.channels[rows_[static_cast<std::size_t>(index)]];
        const double y = ListTop() + (index - top_) * kRow;
        const auto selected = index == row_ ? At(channel, cursor_) : nullptr;
        p.FillRoundRect({kEdge, y + 1, ChannelWidth() - 2, kRow - 2}, 8, kSurface);
        p.Text({kEdge + 12, y, 33, kRow}, channel.number, {14, false}, kMuted);
        if (!channel.logo.empty()) p.ImageContain({kEdge + 44, y + 14, 43, 36}, channel.logo);
        p.Text({kEdge + 97, y, ChannelWidth() - 105, kRow}, channel.name, {15, true}, kWhite);
        const auto cell = [&](Time from, Time until, const Programme* item) {
            if (until <= from) return;
            const double x = std::max(xGrid, TimeX(from)), to = std::min(right, TimeX(until));
            if (to - x < 2) return;
            const Box box{x + 1, y + 1, to - x - 2, kRow - 2};
            const bool focused = index == row_ && selected == item && cursor_ >= from && cursor_ < until;
            const bool live = item && item->start <= now && item->end > now;
            p.FillRoundRect(box, 8, focused ? kWhite : kCell);
            if (live && !focused) {
                p.FillRoundRect({box.x + 2, box.y + 7, 3, box.height - 14}, 1.5, kRed);
                p.FillRoundRect({box.x + 6, box.y + 2, std::max(0.0, std::min(box.Right() - 4, TimeX(now)) - box.x - 6), box.height - 4},
                                6, ui::Rgb(0xE5484D, 0.10));
            }
            const auto ink = focused ? kBackground : (until <= now || !item) ? kMuted : kWhite;
            if (box.width > 22) {
                const auto caption = item ? item->subtitle : std::string();
                p.Text({box.x + 11, box.y + (caption.empty() ? 0 : 9), box.width - 20, caption.empty() ? box.height : 24},
                       item ? item->title : "No guide information", {15, item != nullptr}, ink);
                if (!caption.empty()) p.Text({box.x + 11, box.y + 34, box.width - 20, 20}, caption, {12, false}, focused ? kBackground : kMuted);
            }
        };
        Time position = start_;
        for (const auto& item : channel.programmes) {
            if (item.end <= position || item.start >= end()) continue;
            cell(position, item.start, nullptr);
            const Time from = std::max(position, item.start);
            position = std::min(end(), item.end);
            cell(from, position, &item);
        }
        cell(position, end(), nullptr);
    }
    if (rows_.empty()) p.Text({xGrid + 16, ListTop() + 20, GridWidth() - 32, 55},
                            query_.empty() ? "No channels to show" : "No channels or programmes found", {19, true}, kMuted);
    p.PopClip();
    if (now >= start_ && now < end()) {
        const double x = TimeX(now);
        p.FillRoundRect({x - 1, 120, 2, std::max(0.0, bottom - 120)}, 1, kRed);
        p.FillRoundRect({x - 4, 117, 8, 8}, 4, kRed);
    }
    const Box info{kEdge, height_ - 150, right - kEdge, 126};
    p.FillRoundRect(info, 16, kSurface);
    const auto channel = Selected();
    if (!channel) {
        p.Text({kEdge + 20, info.y + 20, info.width - 40, 34}, "Programme information", {20, true}, kMuted);
        return;
    }
    const auto programme = At(*channel, cursor_);
    const auto picture = programme && !programme->image.empty() ? programme->image : channel->logo;
    if (!picture.empty()) p.ImageContain({info.x + 16, info.y + 18, 104, 90}, picture);
    const double x = info.x + 136, w = std::max(0.0, info.Right() - x - 150);
    p.Text({x, info.y + 10, w, 34}, programme ? programme->title : channel->name, {24, true}, kWhite);
    const bool live = programme && programme->start <= now && now < programme->end;
    if (live) {
        p.FillRoundRect({x, info.y + 48, 40, 20}, 6, kRed);
        p.Text({x + 5, info.y + 48, 34, 20}, "NOW", {11, true}, kWhite);
    }
    const std::string meta = programme ? Local(programme->start) + " – " + Local(programme->end) +
        (programme->category.empty() ? "" : "  ·  " + programme->category) +
        (programme->episode.empty() ? "" : "  ·  " + programme->episode) : "No guide information";
    p.Text({x + (live ? 52 : 0), info.y + 46, w - (live ? 52 : 0), 24}, meta, {14, true}, kMuted);
    if (programme) p.Paragraph({x, info.y + 77, w, 42}, programme->description, {15, false}, kWhite);
    button({right - 129, height_ - 72, 129, 44}, "Watch", true);
}

} // namespace tvm::guide
