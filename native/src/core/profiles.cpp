#include "core/profiles.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/secrets.h"
#include "core/crypto.h"
#include <chrono>
#include <mutex>
#include <map>
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
        auto row = profile.extra;
        row.update({{"id", profile.id}, {"name", profile.name}, {"hue", profile.hue}, {"created", profile.created},
                    {"avatar", profile.avatar.empty() ? nlohmann::json(nullptr) : nlohmann::json(profile.avatar)},
                    {"kind", profile.kind}, {"maxAge", profile.maxAge}, {"pin", profile.pin}});
        profiles.push_back(row);
    }
    auto result = registry.extra;
    result.update({{"activeId", registry.activeId}, {"profiles", profiles}});
    return result;
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
        registry.extra = *stored;
        for (const nlohmann::json& raw : (*stored)["profiles"]) {
            const std::optional<std::string> id = raw.is_object() ? StringField(raw, "id") : std::nullopt;
            if (!id.has_value() || registry.profiles.size() >= kMaxProfiles) continue;
            Profile profile;
            profile.extra = raw;
            profile.id = *id;
            profile.avatar = StringField(raw, "avatar").value_or("");
            profile.kind = StringField(raw, "kind").value_or("standard");
            profile.maxAge = raw.value("maxAge", profile.kind == "kids" ? 7 : 18);
            if (raw.contains("pin") && raw["pin"].is_object()) profile.pin = raw["pin"];
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

Registry Remove(const paths::fs::path& dataDir, const std::string& id, const std::string& pin) {
    Registry registry = Load(dataDir);
    Verify(dataDir, id, pin);
    if (registry.profiles.size() <= 1) throw std::runtime_error("TVM needs at least one profile.");
    std::erase_if(registry.profiles, [&](const Profile& profile) { return profile.id == id; });
    if (registry.activeId == id) registry.activeId = registry.profiles.front().id;
    return Persist(dataDir, registry);
}

Registry SwitchTo(const paths::fs::path& dataDir, const std::string& id, const std::string& pin) {
    Registry registry = Load(dataDir);
    Verify(dataDir, id, pin);
    if (registry.activeId == id) return registry;
    if (std::none_of(registry.profiles.begin(), registry.profiles.end(), [&](const Profile& p) { return p.id == id; })) {
        throw std::runtime_error("Unknown profile.");
    }
    registry.activeId = id;
    return Persist(dataDir, registry);
}

namespace {
std::string Hex(const util::Bytes& bytes) {
    constexpr char digits[] = "0123456789abcdef";
    std::string out;
    for (const auto b : bytes) { out += digits[b >> 4]; out += digits[b & 15]; }
    return out;
}
util::Bytes Unhex(const std::string& text) {
    util::Bytes out;
    if (text.size() % 2) return out;
    const auto digit = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; };
    for (std::size_t i = 0; i < text.size(); i += 2) {
        if (digit(text[i]) < 0 || digit(text[i + 1]) < 0) return {};
        out.push_back(static_cast<std::uint8_t>(digit(text[i]) * 16 + digit(text[i + 1])));
    }
    return out;
}
}
nlohmann::json HashPin(const std::string& pin) {
    if (pin.size() != 4 || pin.find_first_not_of("0123456789") != std::string::npos) throw std::runtime_error("Enter a 4-digit PIN.");
    const auto salt = util::RandomBytes(16);
    return {{"salt", Hex(salt)}, {"hash", Hex(crypto::Pbkdf2Sha256(pin, salt, 20000, 32))}, {"iter", 20000}};
}
bool CheckPin(const nlohmann::json& stored, const std::string& pin) {
    if (stored.is_null()) return true;
    try {
        const auto salt = Unhex(stored.value("salt", ""));
        const auto hash = Unhex(stored.value("hash", ""));
        if (salt.size() != 16 || hash.size() != 32 || stored.value("iter", 0) != 20000) return false;
        return crypto::ConstantTimeEqual(hash, crypto::Pbkdf2Sha256(pin, salt, 20000, 32));
    } catch (...) { return false; }
}
void Verify(const paths::fs::path& dataDir, const std::string& id, const std::string& pin) {
    const auto registry = Load(dataDir);
    const auto found = std::find_if(registry.profiles.begin(), registry.profiles.end(), [&](const auto& p) { return p.id == id; });
    if (found == registry.profiles.end()) throw std::runtime_error("Unknown profile.");
    if (found->pin.is_null()) return;
    // Persist the retry state separately from the shared registry, so closing TVM cannot reset the cooldown.
    static std::mutex mutex;
    std::lock_guard lock(mutex);
    const auto file = dataDir / "profiles-pin-attempts.json";
    const auto text = util::ReadTextFile(file);
    auto attempts = text ? nlohmann::json::parse(*text, nullptr, false) : nlohmann::json::object();
    if (!attempts.is_object()) attempts = nlohmann::json::object();
    auto state = attempts.value(id, nlohmann::json::object());
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    if (state.value("until", 0LL) > now) throw std::runtime_error("Try again in " + std::to_string(state.value("until", 0LL) - now) + " seconds.");
    if (pin.empty()) throw std::runtime_error("Enter this profile's PIN.");
    if (!CheckPin(found->pin, pin)) {
        const int tries = state.value("tries", 0) + 1;
        attempts[id] = {{"tries", tries >= 5 ? 0 : tries}, {"until", tries >= 5 ? now + 60 : 0}};
        util::WriteFileAtomically(file, attempts.dump());
        throw std::runtime_error(tries >= 5 ? "Too many attempts. Try again in 60 seconds." : "Wrong PIN. Try again.");
    }
    attempts.erase(id);
    util::WriteFileAtomically(file, attempts.dump());
}
Registry Update(const paths::fs::path& dataDir, const std::string& id, const nlohmann::json& patch,
                const std::string& currentPin, const std::string& adultId, const std::string& adultPin) {
    auto registry = Load(dataDir);
    Verify(dataDir, id, currentPin);
    auto found = std::find_if(registry.profiles.begin(), registry.profiles.end(), [&](const auto& p) { return p.id == id; });
    if (found == registry.profiles.end()) throw std::runtime_error("Unknown profile.");
    if (found->kind == "kids" && patch.value("kind", found->kind) != "kids") {
        const bool lockedAdult = std::any_of(registry.profiles.begin(), registry.profiles.end(), [](const auto& p) { return p.kind != "kids" && !p.pin.is_null(); });
        if (lockedAdult) {
            const auto adult = std::find_if(registry.profiles.begin(), registry.profiles.end(), [&](const auto& p) { return p.id == adultId && p.kind != "kids" && !p.pin.is_null(); });
            if (adult == registry.profiles.end()) throw std::runtime_error("An adult profile's PIN is needed.");
            Verify(dataDir, adultId, adultPin);
        }
    }
    if (patch.contains("name")) {
        const auto name = util::Trim(patch.at("name").get<std::string>());
        if (name.empty() || name.size() > 96) throw std::runtime_error("Enter a profile name.");
        found->name = name;
    }
    if (patch.contains("avatar")) found->avatar = patch["avatar"].is_string() ? patch["avatar"].get<std::string>() : "";
    if (patch.contains("kind")) {
        found->kind = patch.at("kind").get<std::string>() == "kids" ? "kids" : "standard";
        if (found->kind == "kids" && !patch.contains("maxAge")) found->maxAge = 7;
    }
    if (patch.contains("maxAge")) {
        const int age = patch.at("maxAge").get<int>();
        if (age != 7 && age != 12 && age != 15 && age != 18) throw std::runtime_error("Choose an age limit.");
        found->maxAge = age;
    }
    if (patch.contains("pin")) found->pin = patch["pin"].is_null() ? nlohmann::json(nullptr) : HashPin(patch["pin"].get<std::string>());
    return Persist(dataDir, registry);
}
std::optional<Profile> Active(const paths::fs::path& dataDir) {
    try {
        const auto registry = Load(dataDir);
        for (const auto& profile : registry.profiles) if (profile.id == registry.activeId) return profile;
    } catch (...) {}
    return std::nullopt;
}

std::optional<std::string> ActiveName(const paths::fs::path& dataDir) {
    std::error_code ignored;
    if (!paths::fs::exists(paths::ProfilesPath(dataDir), ignored)) return std::nullopt;
    const std::optional<nlohmann::json> profile = ActiveEntry(dataDir);
    if (!profile.has_value()) return std::nullopt;
    return StringField(*profile, "name");
}

}  // namespace tvm::profiles
