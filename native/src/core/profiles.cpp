#include "core/profiles.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

namespace tvm::profiles {

namespace {

std::optional<std::string> StringField(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end() || !found->is_string()) return std::nullopt;
    return found->get<std::string>();
}

// The active profile's entry in the registry: the active one when it is still listed, otherwise the
// first one, as the Node core picks. Nothing when the registry cannot be read or lists no profile.
std::optional<nlohmann::json> ActiveEntry(const paths::fs::path& dataDir) {
    const std::optional<nlohmann::json> registry = secrets::ReadPrivateJson(dataDir, paths::ProfilesPath(dataDir));
    if (!registry.has_value() || !registry->is_object()) return std::nullopt;
    const auto profiles = registry->find("profiles");
    if (profiles == registry->end() || !profiles->is_array()) return std::nullopt;

    const std::optional<std::string> activeId = StringField(*registry, "activeId");
    std::optional<nlohmann::json> first;
    for (const nlohmann::json& profile : *profiles) {
        if (!profile.is_object() || !StringField(profile, "id").has_value()) continue;
        if (activeId.has_value() && StringField(profile, "id") == activeId) return profile;
        if (!first.has_value()) first = profile;
    }
    return first;
}

}  // namespace

std::optional<paths::fs::path> ActiveFolder(const paths::fs::path& dataDir) {
    std::error_code ignored;
    if (!paths::fs::exists(paths::ProfilesPath(dataDir), ignored)) return dataDir;
    const std::optional<nlohmann::json> profile = ActiveEntry(dataDir);
    if (!profile.has_value()) return std::nullopt;
    return paths::ProfileDir(dataDir, *StringField(*profile, "id"));
}

namespace {

// The hues new profiles take, starting on the brand's blue and leaving red out, as profiles.ts lists them.
constexpr int kHues[] = {221, 190, 145, 38, 315};

Profile DefaultProfile(std::size_t index) {
    Profile profile;
    profile.id = "profile-" + std::to_string(index + 1);
    profile.name = "Profile " + std::to_string(index + 1);
    profile.hue = kHues[index % std::size(kHues)];
    profile.created = util::IsoTimestamp();
    return profile;
}

nlohmann::json ToJson(const Registry& registry) {
    nlohmann::json profiles = nlohmann::json::array();
    for (const Profile& profile : registry.profiles) {
        profiles.push_back({{"id", profile.id}, {"name", profile.name}, {"hue", profile.hue}, {"created", profile.created}});
    }
    return {{"activeId", registry.activeId}, {"profiles", profiles}};
}

Registry Persist(const paths::fs::path& dataDir, const Registry& registry) {
    std::error_code ignored;
    paths::fs::create_directories(dataDir, ignored);
    vault::WriteSealed(dataDir, paths::ProfilesPath(dataDir), ToJson(registry));
    paths::fs::create_directories(paths::ProfileDir(dataDir, registry.activeId), ignored);
    return registry;
}

// The first profile takes over the watchlist and progress kept at the root before profiles existed.
void MigrateLegacy(const paths::fs::path& dataDir, const std::string& profileId) {
    const paths::fs::path dest = paths::ProfileDir(dataDir, profileId);
    std::error_code ignored;
    paths::fs::create_directories(dest, ignored);
    for (const auto& [from, to] : {std::pair{paths::ProgressPath(dataDir), paths::ProgressPath(dest)},
                                   std::pair{paths::WatchlistPath(dataDir), paths::WatchlistPath(dest)}}) {
        if (paths::fs::exists(from, ignored) && !paths::fs::exists(to, ignored)) paths::fs::rename(from, to, ignored);
    }
}

std::string NewProfileId() {
    // A random UUID, as randomUUID gives the Node core's new profiles.
    const util::Bytes bytes = util::RandomBytes(16);
    static const char kHex[] = "0123456789abcdef";
    std::string id = "profile-";
    for (std::size_t i = 0; i < bytes.size(); ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) id += '-';
        id += kHex[(bytes[i] >> 4) & 0xF];
        id += kHex[bytes[i] & 0xF];
    }
    return id;
}

}  // namespace

Registry Load(const paths::fs::path& dataDir) {
    const std::optional<nlohmann::json> stored = secrets::ReadPrivateJson(dataDir, paths::ProfilesPath(dataDir));
    if (stored.has_value() && stored->is_object() && stored->contains("profiles") && (*stored)["profiles"].is_array()) {
        Registry registry;
        for (const nlohmann::json& raw : (*stored)["profiles"]) {
            const std::optional<std::string> id = raw.is_object() ? StringField(raw, "id") : std::nullopt;
            if (!id.has_value() || registry.profiles.size() >= kMaxProfiles) continue;
            Profile profile;
            profile.id = *id;
            profile.name = StringField(raw, "name").value_or("Profile");
            profile.hue = raw.value("hue", 221);
            profile.created = StringField(raw, "created").value_or("");
            registry.profiles.push_back(std::move(profile));
        }
        if (!registry.profiles.empty()) {
            const std::optional<std::string> active = StringField(*stored, "activeId");
            const bool listed = active.has_value() && std::any_of(registry.profiles.begin(), registry.profiles.end(),
                                                                  [&](const Profile& p) { return p.id == *active; });
            registry.activeId = listed ? *active : registry.profiles.front().id;
            std::error_code ignored;
            paths::fs::create_directories(paths::ProfileDir(dataDir, registry.activeId), ignored);
            return registry;
        }
    }
    // The first run.
    const Profile first = DefaultProfile(0);
    MigrateLegacy(dataDir, first.id);
    return Persist(dataDir, Registry{first.id, {first}});
}

Registry Create(const paths::fs::path& dataDir, const std::string& name, std::size_t max) {
    Registry registry = Load(dataDir);
    const std::size_t cap = std::max<std::size_t>(1, std::min(kMaxProfiles, max));
    if (registry.profiles.size() >= cap) throw std::runtime_error("TVM holds " + std::to_string(cap) + " profiles.");
    const std::string trimmed = util::Trim(name);
    Profile profile = DefaultProfile(registry.profiles.size());
    profile.name = trimmed.empty() ? "Profile " + std::to_string(registry.profiles.size() + 1) : trimmed;
    profile.id = NewProfileId();
    std::error_code ignored;
    paths::fs::create_directories(paths::ProfileDir(dataDir, profile.id), ignored);
    registry.profiles.push_back(profile);
    registry.activeId = profile.id;
    return Persist(dataDir, registry);
}

Registry Remove(const paths::fs::path& dataDir, const std::string& id) {
    Registry registry = Load(dataDir);
    if (registry.profiles.size() <= 1) throw std::runtime_error("TVM needs at least one profile.");
    std::erase_if(registry.profiles, [&](const Profile& profile) { return profile.id == id; });
    if (registry.activeId == id) registry.activeId = registry.profiles.front().id;
    return Persist(dataDir, registry);
}

Registry SwitchTo(const paths::fs::path& dataDir, const std::string& id) {
    Registry registry = Load(dataDir);
    if (registry.activeId == id) return registry;
    if (std::none_of(registry.profiles.begin(), registry.profiles.end(), [&](const Profile& p) { return p.id == id; })) {
        throw std::runtime_error("Unknown profile.");
    }
    registry.activeId = id;
    return Persist(dataDir, registry);
}

std::optional<std::string> ActiveName(const paths::fs::path& dataDir) {
    std::error_code ignored;
    if (!paths::fs::exists(paths::ProfilesPath(dataDir), ignored)) return std::nullopt;
    const std::optional<nlohmann::json> profile = ActiveEntry(dataDir);
    if (!profile.has_value()) return std::nullopt;
    return StringField(*profile, "name");
}

}  // namespace tvm::profiles
