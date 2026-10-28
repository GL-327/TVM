#pragma once

// Profiles. Each profile keeps its own watchlist and progress, with its own
// master key, in its own folder under profiles\<id>. Ported from the reading
// side of apps/core/src/providers/profiles.ts. The Node core creates the
// registry and moves the old root files into the first profile. The native app
// only reads the registry, so it never changes how the viewer's profiles are laid out.

#include <filesystem>
#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "core/paths.h"

namespace tvm::profiles {

// The folder for the active profile's watchlist and progress. Without a
// registry it is the data folder itself, where the files lived before profiles
// existed. Nothing when the registry is there but cannot be read, so the
// watchlist and progress are neither shown nor written.
std::optional<paths::fs::path> ActiveFolder(const paths::fs::path& dataDir);

// The active profile's name. Nothing without a registry, or when the profile has none.
std::optional<std::string> ActiveName(const paths::fs::path& dataDir);

// The writing side, ported from createProfileService in profiles.ts, for the Profiles screen. The registry
// is sealed in the vault, as the Node core seals it, so either app reads what the other wrote.
inline constexpr std::size_t kMaxProfiles = 10;

struct Profile {
    std::string id;
    std::string name;
    int hue = 221;
    std::string created;

    bool operator==(const Profile&) const = default;
};

struct Registry {
    std::string activeId;
    std::vector<Profile> profiles;

    bool operator==(const Registry&) const = default;
};

// The registry. On the first run it makes "Profile 1" and moves the old root watchlist and progress into
// it, as loadProfiles does. Throws when the registry cannot be written.
Registry Load(const paths::fs::path& dataDir);
// A new profile, which becomes the active one. Throws std::runtime_error "TVM holds N profiles." at the cap.
Registry Create(const paths::fs::path& dataDir, const std::string& name, std::size_t max = kMaxProfiles);
// Throws "TVM needs at least one profile." for the last one.
Registry Remove(const paths::fs::path& dataDir, const std::string& id);
// Throws "Unknown profile." for an id the registry does not list.
Registry SwitchTo(const paths::fs::path& dataDir, const std::string& id);

}  // namespace tvm::profiles
