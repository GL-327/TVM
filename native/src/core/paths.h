#pragma once

// File layout under the TVM data directory. Names and locations match the
// Node core exactly, so an existing installation is read in place.

#include <filesystem>

#include "core/util.h"

namespace tvm::paths {

namespace fs = std::filesystem;

// TVM_DATA_DIR wins when set. Otherwise %LOCALAPPDATA%\TVM, falling back to
// %APPDATA%\TVM and then to the working directory.
fs::path ResolveDataDir(const util::EnvLookup& env);

fs::path SecretsDir(const fs::path& dataDir);
fs::path MasterKeyPath(const fs::path& dataDir);
fs::path GithubTokenPath(const fs::path& dataDir);
fs::path RdTokenPath(const fs::path& dataDir);
fs::path XtreamPath(const fs::path& dataDir);
fs::path EntitlementPath(const fs::path& dataDir);
fs::path BillingPath(const fs::path& dataDir);
fs::path UsagePath(const fs::path& dataDir);
fs::path DevUnlockPath(const fs::path& dataDir);
fs::path AccountsPath(const fs::path& dataDir);

fs::path PrefsPath(const fs::path& dataDir);
fs::path UiPrefsPath(const fs::path& dataDir);

// Caches live under cache and are safe to delete.
fs::path CacheDir(const fs::path& dataDir);
fs::path CatalogCachePath(const fs::path& dataDir);
fs::path ArtworkCacheDir(const fs::path& dataDir);
fs::path ProfilesPath(const fs::path& dataDir);
// A profile's own folder: its watchlist, progress and master key live here.
fs::path ProfileDir(const fs::path& dataDir, const std::string& profileId);
fs::path ProgressPath(const fs::path& dataDir);
fs::path WatchlistPath(const fs::path& dataDir);
fs::path PlanPath(const fs::path& dataDir);
// Live TV's saved playlist sealed, and its picks as plain JSON. Both sit in the data folder itself.
fs::path LivePlaylistPath(const fs::path& dataDir);
fs::path LivePicksPath(const fs::path& dataDir);

}  // namespace tvm::paths
