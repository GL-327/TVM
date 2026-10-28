#include "core/prefs.h"

#include <array>
#include <string_view>

#include <nlohmann/json.hpp>

namespace tvm::prefs {

namespace {

constexpr std::array<std::string_view, 9> kLanguages = {
    "en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh"};

}  // namespace

bool IsSupportedLanguage(const std::string& language) {
    for (std::string_view supported : kLanguages) {
        if (supported == language) return true;
    }
    return false;
}

CorePrefs ReadPrefs(const paths::fs::path& dataDir) {
    const std::optional<std::string> text = util::ReadTextFile(paths::PrefsPath(dataDir));
    if (!text) return {};

    const nlohmann::json raw = nlohmann::json::parse(util::StripBom(*text), nullptr, false);
    if (!raw.is_object()) return {};

    CorePrefs prefs;
    if (const auto language = raw.find("language");
        language != raw.end() && language->is_string() && IsSupportedLanguage(language->get<std::string>())) {
        prefs.language = language->get<std::string>();
    }
    // Only an explicit false turns updates off, matching the Node behaviour.
    if (const auto autoUpdate = raw.find("autoUpdate"); autoUpdate != raw.end() && autoUpdate->is_boolean()) {
        prefs.autoUpdate = autoUpdate->get<bool>();
    }
    return prefs;
}

CorePrefs WritePrefs(const paths::fs::path& dataDir, const CorePrefsPatch& patch) {
    const CorePrefs current = ReadPrefs(dataDir);

    CorePrefs next = current;
    if (patch.language && IsSupportedLanguage(*patch.language)) next.language = *patch.language;
    if (patch.autoUpdate) next.autoUpdate = *patch.autoUpdate;

    // Key order is fixed so the file reads the same as the Node version wrote it.
    nlohmann::ordered_json json;
    json["language"] = next.language;
    json["autoUpdate"] = next.autoUpdate;
    util::WriteFileAtomically(paths::PrefsPath(dataDir), json.dump());
    return next;
}

}  // namespace tvm::prefs
