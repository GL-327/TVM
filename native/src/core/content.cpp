#include "core/content.h"

#include <windows.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include "core/util.h"

namespace tvm::content {
namespace {
constexpr std::array<const char*, 6> kNames{"changelog", "events", "free-channels", "services", "avatars", "parental"};
std::string Key(const std::string& name) {
    return name == "free-channels" ? "channels" : name == "changelog" ? "releases" : name == "avatars" ? "sets" : name == "parental" ? "levels" : name;
}
nlohmann::json ReadJson(const std::filesystem::path& path) {
    const auto text = util::ReadTextFile(path);
    return text ? nlohmann::json::parse(*text, nullptr, false) : nlohmann::json();
}
const nlohmann::json* Level(const nlohmann::json& data, int age) {
    if (!data.is_object() || !data.contains("levels") || !data["levels"].is_array()) return nullptr;
    for (const auto& level : data["levels"]) if (level.value("maxAge", 0) == age) return &level;
    return nullptr;
}
bool Contains(const nlohmann::json& list, const std::string& text) {
    if (!list.is_array()) return false;
    return std::any_of(list.begin(), list.end(), [&](const auto& entry) { return entry.is_string() && entry.get<std::string>() == text; });
}
}

Store::Store(std::filesystem::path dataDir, std::filesystem::path bundled) : dataDir_(std::move(dataDir)), bundled_(std::move(bundled)) {
    if (bundled_.empty()) {
        wchar_t exe[32768]{};
        GetModuleFileNameW(nullptr, exe, static_cast<DWORD>(std::size(exe)));
        bundled_ = std::filesystem::path(exe).parent_path() / "content";
    }
}
bool Store::Valid(const std::string& name, const nlohmann::json& data) {
    if (std::find(kNames.begin(), kNames.end(), name) == kNames.end() || !data.is_object() || !data.contains("schema") || data["schema"] != 1) return false;
    const std::string key = Key(name);
    if (!data.contains(key) || !data[key].is_array()) return false;
    for (const auto& row : data[key]) {
        if (!row.is_object()) return false;
        const auto string = [&](const char* field) { return row.contains(field) && row[field].is_string() && !row[field].get<std::string>().empty(); };
        if (name == "changelog") { if (!string("version") || !string("title") || !string("date") || !row.contains("highlights") || !row["highlights"].is_array() || !row.contains("changes") || !row["changes"].is_array()) return false; }
        else if (name == "parental") { if (!row.contains("maxAge") || !row["maxAge"].is_number_integer() || !row.contains("block") || !row["block"].is_array()) return false; }
        else {
            if (!string("id")) return false;
            if (name == "free-channels" && (!string("name") || !string("group") || !string("url") || !http::IsWebUrl(row["url"]))) return false;
            if (name == "services" && (!string("name") || !string("home") || !string("signin") || !http::IsWebUrl(row["home"]) || !http::IsWebUrl(row["signin"]))) return false;
            if (name == "events" && (!string("start") || !string("end") || !string("release") || !string("imdbId") || !row.contains("rail") || !row["rail"].is_object() || !row["rail"].contains("items") || !row["rail"]["items"].is_array())) return false;
            if (name == "avatars" && (!string("title") || !row.contains("avatars") || !row["avatars"].is_array())) return false;
        }
    }
    return true;
}
nlohmann::json Store::Read(const std::string& name) const {
    std::lock_guard lock(mutex_);
    auto data = ReadJson(dataDir_ / "cache" / "content" / (name + ".json"));
    if (name != "changelog" && name != "parental" && Valid(name, data)) return data;
    data = ReadJson(bundled_ / (name + ".json"));
    return Valid(name, data) ? data : nlohmann::json::object();
}
void Store::Refresh(const http::Transport& transport) {
    const auto folder = dataDir_ / "cache" / "content";
    const auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    for (const char* name : kNames) {
        if (std::string(name) == "changelog" || std::string(name) == "parental") continue;
        const auto stamp = folder / (std::string(name) + ".checked");
        const auto saved = util::ReadTextFile(stamp);
        try { if (saved && now >= std::stoll(*saved) && now - std::stoll(*saved) < 6 * 3600) continue; } catch (...) {}
        try {
            util::WriteFileAtomically(stamp, std::to_string(now));
            http::Options options;
            options.timeoutMs = 8000;
            options.maxBytes = 2 * 1024 * 1024;
            const auto response = transport("https://raw.githubusercontent.com/GL-327/TVM/main/packages/content/" + std::string(name) + ".json", options);
            if (!response || !response->ok()) continue;
            const auto data = nlohmann::json::parse(response->body, nullptr, false);
            if (!Valid(name, data)) continue;
            std::lock_guard lock(mutex_);
            util::WriteFileAtomically(folder / (std::string(name) + ".json"), data.dump());
        } catch (...) { /* Keep the last good copy, including when the cache folder is read-only. */ }
    }
}
bool Allows(const nlohmann::json& parental, int maxAge, const std::vector<std::string>& genres) {
    if (maxAge >= 18) return true;
    const auto* level = Level(parental, maxAge);
    if (!level || genres.empty()) return false;
    for (const auto& genre : genres) if (Contains((*level)["block"], genre)) return false;
    if (!level->contains("allow") || (*level)["allow"].is_null()) return true;
    return std::any_of(genres.begin(), genres.end(), [&](const auto& genre) { return Contains((*level)["allow"], genre); });
}
bool AllowsLive(const nlohmann::json& parental, int maxAge, const std::string& group) {
    if (maxAge >= 18) return true;
    const auto* level = Level(parental, maxAge);
    if (!level) return false;
    return level->contains("liveGroups") && ((*level)["liveGroups"].is_null() || Contains((*level)["liveGroups"], group));
}
std::string LocalDate() {
    const auto now = std::time(nullptr);
    std::tm local{};
    localtime_s(&local, &now);
    std::ostringstream out;
    out << std::put_time(&local, "%Y-%m-%d");
    return out.str();
}
bool EventLive(const nlohmann::json& event, const std::string& date) {
    return event.is_object() && event.value("start", "9999-99-99") <= date && date <= event.value("end", "0000-00-00");
}
std::string EventKicker(const nlohmann::json& event, const std::string& date) {
    const auto release = event.value("release", "");
    if (date >= release) return "In cinemas now";
    std::tm day{};
    std::istringstream in(release);
    in >> std::get_time(&day, "%Y-%m-%d");
    if (in.fail()) return "Coming to cinemas";
    std::ostringstream out;
    out << "In cinemas " << day.tm_mday << ' ' << std::put_time(&day, "%B");
    return out.str();
}
}  // namespace tvm::content
