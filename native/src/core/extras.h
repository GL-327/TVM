#pragma once
#include <array>
#include <optional>
#include <map>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace tvm::extras {
struct Segment { double start = 0, end = 0; bool openEnd = false; };
using Segments = std::array<std::optional<Segment>, 3>; // intro, recap, credits
Segments ParseSegments(const nlohmann::json& body);
struct Preferences {
    std::string skip = "button";
    bool autoplay = true;
    std::vector<std::string> languages{"eng"};
    std::string language = "en";
    std::string audioLanguage = "original";
    std::string subtitleMode = "foreign";
    std::string subtitleSize = "m", subtitleColor = "white", subtitleBackground = "shadow";
    std::map<std::string, bool, std::less<>> switches;
    bool Enabled(std::string_view id) const;
};
inline constexpr double kRdRetryMs = 60000;
inline bool RdRefreshDue(bool usable, bool configured, bool busy, double now, double checked) {
    return usable && !configured && !busy && now - checked >= kRdRetryMs;
}
Preferences ParsePreferences(const nlohmann::json& body);
struct Skip { std::string label; double target = 0; bool visible = false, automatic = false; };
class SegmentSession {
public:
    Skip Update(const Segments& segments, double position, double duration, double nowMs, const std::string& mode);
private:
    std::array<double, 3> entered_{{-1, -1, -1}};
    std::array<bool, 3> skipped_{};
};
class NextCountdown {
public:
    double Update(bool visible, bool playing, double nowMs);
private:
    bool visible_ = false, playing_ = false;
    double remaining_ = 10, lastMs_ = 0;
};
std::string UpcomingLabel(const nlohmann::json& next);
std::string YoutubeUrl(const nlohmann::json& trailers);
} // namespace tvm::extras
