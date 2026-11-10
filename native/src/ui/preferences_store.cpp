#include "ui/preferences_store.h"

#include <nlohmann/json.hpp>

#include "core/util.h"

namespace tvm::ui {

namespace {

nlohmann::ordered_json ReadUiJson(const paths::fs::path& path) {
    const auto text = util::ReadTextFile(path);
    if (!text) return nlohmann::ordered_json::object();
    auto json = nlohmann::ordered_json::parse(util::StripBom(*text), nullptr, false);
    return json.is_object() ? json : nlohmann::ordered_json::object();
}

motion::MotionSettings ReadUiPrefs(const paths::fs::path& path) {
    motion::MotionSettings settings;
    const std::optional<std::string> text = util::ReadTextFile(path);
    if (!text) return settings;

    const nlohmann::json raw = nlohmann::json::parse(util::StripBom(*text), nullptr, false);
    if (!raw.is_object()) return settings;

    if (const auto motion = raw.find("motion"); motion != raw.end() && motion->is_string()) {
        settings.preference = motion::ParseMotionPreference(motion->get<std::string>());
    }
    if (const auto performance = raw.find("performance"); performance != raw.end() && performance->is_boolean()) {
        settings.performanceMode = performance->get<bool>();
    }
    return settings;
}

}  // namespace

FilePreferenceStore::FilePreferenceStore(paths::fs::path dataDir) : dataDir_(std::move(dataDir)) {}

motion::MotionSettings FilePreferenceStore::Motion() const {
    return ReadUiPrefs(paths::UiPrefsPath(dataDir_));
}

void FilePreferenceStore::SaveMotion(const motion::MotionSettings& settings) {
    auto json = ReadUiJson(paths::UiPrefsPath(dataDir_));
    json["motion"] = std::string(motion::ToString(settings.preference));
    json["performance"] = settings.performanceMode;
    util::WriteFileAtomically(paths::UiPrefsPath(dataDir_), json.dump());
}

prefs::CorePrefs FilePreferenceStore::CorePrefs() const {
    return prefs::ReadPrefs(dataDir_);
}

void FilePreferenceStore::SaveCorePrefs(const prefs::CorePrefsPatch& patch) {
    prefs::WritePrefs(dataDir_, patch);
}

Theme FilePreferenceStore::Look() const {
    const auto json = ReadUiJson(paths::UiPrefsPath(dataDir_));
    const auto value = json.find("theme");
    return value != json.end() && value->is_string() ? ParseTheme(value->get<std::string>()) : Theme::Dark;
}

void FilePreferenceStore::SaveLook(Theme theme) {
    auto json = ReadUiJson(paths::UiPrefsPath(dataDir_));
    json["theme"] = ThemeId(theme);
    util::WriteFileAtomically(paths::UiPrefsPath(dataDir_), json.dump());
}

}  // namespace tvm::ui
