#include "core/paths.h"

namespace tvm::paths {

namespace {

// JavaScript's trim() on an environment value, returned as UTF-8 for the
// comparisons the Node code makes. Empty means unset.
std::string TrimmedValue(const std::optional<std::wstring>& raw) {
    if (!raw) return {};
    return util::Trim(util::ToUtf8(*raw));
}

}  // namespace

fs::path ResolveDataDir(const util::EnvLookup& env) {
    const std::string override = TrimmedValue(env(L"TVM_DATA_DIR"));
    if (!override.empty()) {
        const fs::path dir = util::ToWide(override);
        return dir.is_absolute() ? dir : fs::absolute(dir);
    }

    std::optional<std::wstring> root = env(L"LOCALAPPDATA");
    if (!root) root = env(L"APPDATA");
    const fs::path base = root ? fs::path(*root) : fs::current_path();
    return base / L"TVM";
}

fs::path SecretsDir(const fs::path& dataDir) {
    return dataDir / L"secrets";
}

fs::path MasterKeyPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"master.key";
}

fs::path GithubTokenPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"github-token";
}

fs::path RdTokenPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"rd-token";
}

fs::path XtreamPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"xtream.json";
}

fs::path EntitlementPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"entitlement.enc";
}

fs::path BillingPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"billing.enc";
}

fs::path UsagePath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"usage.enc";
}

fs::path DevUnlockPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"dev-unlock.enc";
}

fs::path AccountsPath(const fs::path& dataDir) {
    return SecretsDir(dataDir) / L"accounts.enc";
}

fs::path PrefsPath(const fs::path& dataDir) {
    return dataDir / L"prefs.json";
}

fs::path UiPrefsPath(const fs::path& dataDir) {
    return dataDir / L"ui-prefs.json";
}

fs::path CacheDir(const fs::path& dataDir) {
    return dataDir / L"cache";
}

fs::path CatalogCachePath(const fs::path& dataDir) {
    return CacheDir(dataDir) / L"catalog.json";
}

fs::path ArtworkCacheDir(const fs::path& dataDir) {
    return CacheDir(dataDir) / L"artwork";
}

fs::path ProfilesPath(const fs::path& dataDir) {
    return dataDir / L"profiles.json";
}

fs::path ProfileDir(const fs::path& dataDir, const std::string& profileId) {
    return dataDir / L"profiles" / util::ToWide(profileId);
}

fs::path ProgressPath(const fs::path& dataDir) {
    return dataDir / L"progress.json";
}

fs::path WatchlistPath(const fs::path& dataDir) {
    return dataDir / L"watchlist.json";
}

fs::path LivePlaylistPath(const fs::path& dataDir) {
    return dataDir / L"live-playlist.json";
}

fs::path LivePicksPath(const fs::path& dataDir) {
    return dataDir / L"live-picks.json";
}

fs::path PlanPath(const fs::path& dataDir) {
    return dataDir / L"plan.json";
}

}  // namespace tvm::paths
