#include "core/extras.h"
#include <algorithm>
#include <cmath>
#include <ctime>
#include <cstdio>
#include <regex>

namespace tvm::extras {
Segments ParseSegments(const nlohmann::json& body) {
    Segments result{};
    if (!body.is_object()) return result;
    const char* keys[] = {"intro", "recap", "credits"};
    for (std::size_t i = 0; i < result.size(); ++i) {
        const auto it = body.find(keys[i]);
        if (it == body.end() || !it->is_object() || !it->contains("start") || !(*it)["start"].is_number()) continue;
        Segment segment; segment.start = (*it)["start"].get<double>();
        segment.openEnd = i == 2 && (!it->contains("end") || (*it)["end"].is_null());
        if (!segment.openEnd) {
            if (!it->contains("end") || !(*it)["end"].is_number()) continue;
            segment.end = (*it)["end"].get<double>();
            if (!std::isfinite(segment.end) || segment.end <= segment.start) continue;
        }
        if (std::isfinite(segment.start) && segment.start >= 0) result[i] = segment;
    }
    return result;
}
Preferences ParsePreferences(const nlohmann::json& body) {
    Preferences prefs;
    if (!body.is_object()) return prefs;
    if (body.contains("skipSegments") && body["skipSegments"].is_string()) {
        const auto skip = body["skipSegments"].get<std::string>();
        if (skip == "off" || skip == "button" || skip == "auto") prefs.skip = skip;
    }
    if (body.contains("autoplayNext") && body["autoplayNext"].is_boolean()) prefs.autoplay = body["autoplayNext"].get<bool>();
    if (body.contains("subtitleLanguages") && body["subtitleLanguages"].is_array()) {
        std::vector<std::string> languages;
        for (const auto& value : body["subtitleLanguages"]) {
            if (!value.is_string()) continue;
            const auto language = value.get<std::string>();
            if (std::regex_match(language, std::regex("[a-z]{2,3}")) &&
                std::find(languages.begin(), languages.end(), language) == languages.end()) languages.push_back(language);
        }
        if (!languages.empty()) prefs.languages = std::move(languages);
    }
    return prefs;
}
Skip SegmentSession::Update(const Segments& segments, double position, double duration, double nowMs, const std::string& mode) {
    const char* labels[] = {"Skip intro", "Skip recap", "Skip credits"};
    Skip result;
    for (std::size_t i = 0; i < segments.size(); ++i) {
        if (!segments[i]) continue;
        const auto& segment = *segments[i];
        const double end = segment.openEnd ? duration : segment.end;
        const bool active = end > segment.start && position >= segment.start && position < end - 0.1;
        if (!active) { entered_[i] = -1; continue; }
        if (entered_[i] < 0) entered_[i] = nowMs;
        if (mode == "off" || skipped_[i]) continue;
        result = {labels[i], duration > 0 ? std::min(end, duration - 0.08) : end,
                  mode == "button" && nowMs - entered_[i] < 8000, mode == "auto"};
        if (result.automatic) skipped_[i] = true;
        return result;
    }
    return result;
}
double NextCountdown::Update(bool visible, bool playing, double nowMs) {
    if (!visible) remaining_ = 10;
    else if (visible_ && playing && playing_) remaining_ = std::max(0.0, remaining_ - std::clamp((nowMs - lastMs_) / 1000.0, 0.0, 1.0));
    lastMs_ = nowMs; visible_ = visible; playing_ = playing;
    return remaining_;
}
std::string UpcomingLabel(const nlohmann::json& next) {
    if (!next.is_object() || !next.contains("airstamp") || !next["airstamp"].is_string()) return "";
    const auto stamp = next["airstamp"].get<std::string>();
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    if (sscanf_s(stamp.c_str(), "%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) < 3 ||
        month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 9999) return "";
    std::tm date{}; date.tm_year = year - 1900; date.tm_mon = month - 1; date.tm_mday = day;
    date.tm_hour = hour; date.tm_min = minute; date.tm_sec = second;
    auto utc = _mkgmtime(&date);
    const auto offset = stamp.find_first_of("+-", 19);
    if (offset != std::string::npos) {
        int zoneHour = 0, zoneMinute = 0;
        if (sscanf_s(stamp.c_str() + offset + 1, "%d:%d", &zoneHour, &zoneMinute) != 2 || zoneHour > 23 || zoneMinute > 59) return "";
        const int secondsOffset = (zoneHour * 60 + zoneMinute) * 60;
        utc += stamp[offset] == '+' ? -secondsOffset : secondsOffset;
    }
    if (utc < 0) return "";
    std::tm local{}; localtime_s(&local, &utc);
    char formatted[80]{}; std::strftime(formatted, sizeof(formatted), "%A, %d %B", &local);
    return std::string("New episode ") + formatted;
}
std::string YoutubeUrl(const nlohmann::json& body) {
    if (!body.is_object() || !body.contains("trailers") || !body["trailers"].is_array()) return "";
    for (const auto& trailer : body["trailers"]) {
        if (!trailer.is_object() || !trailer.contains("youtubeId") || !trailer["youtubeId"].is_string()) continue;
        const auto id = trailer["youtubeId"].get<std::string>();
        if (std::regex_match(id, std::regex("[A-Za-z0-9_-]{11}"))) return "https://www.youtube.com/watch?v=" + id;
    }
    return "";
}
} // namespace tvm::extras
