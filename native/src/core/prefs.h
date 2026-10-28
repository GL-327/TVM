#pragma once

// User preferences stored as plain JSON in the data directory (prefs.json).

#include <optional>
#include <string>

#include "core/paths.h"

namespace tvm::prefs {

struct CorePrefs {
    std::string language = "en";
    bool autoUpdate = true;

    bool operator==(const CorePrefs&) const = default;
};

// Changes to apply. Fields left unset keep their stored value.
struct CorePrefsPatch {
    std::optional<std::string> language;
    std::optional<bool> autoUpdate;
};

bool IsSupportedLanguage(const std::string& language);

// Missing, unreadable or malformed prefs fall back to the defaults.
CorePrefs ReadPrefs(const paths::fs::path& dataDir);

// Applies the patch on top of the stored prefs and writes the result. A patch
// with an unsupported language keeps the previous language.
CorePrefs WritePrefs(const paths::fs::path& dataDir, const CorePrefsPatch& patch);

}  // namespace tvm::prefs
