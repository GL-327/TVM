// tvm-probe: a read-only check that an existing TVM data directory opens with
// this build. It prints the shape of each sealed value (type and key names,
// or a length), never the values. It never writes, creates or migrates a
// file, so it is safe to run against a real installation.
//
// With --online it also asks Real-Debrid about the saved account, using the saved
// token, and prints counts only. Without it the probe makes no network request.
//
// Usage: tvm-probe [data-directory] [--online]

#include <windows.h>

#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "catalog/library.h"
#include "catalog/live.h"
#include "catalog/realdebrid.h"
#include "catalog/xtream.h"
#include "core/paths.h"
#include "core/profiles.h"
#include "core/util.h"
#include "core/vault.h"

namespace {

namespace fs = std::filesystem;
using tvm::util::ToUtf8;

constexpr std::string_view kSecretPrefix = "tvm-secret-v1:";

void PrintValue(const char* label, const std::optional<nlohmann::json>& value) {
    if (!value) {
        std::printf("%-14s NOT READABLE\n", label);
        return;
    }
    if (value->is_string()) {
        std::printf("%-14s ok, secret string of %zu characters (value not shown)\n", label,
                    value->get<std::string>().size());
    } else if (value->is_object()) {
        std::printf("%-14s ok, object with keys:", label);
        for (const auto& item : value->items()) std::printf(" %s", item.key().c_str());
        std::printf("\n");
    } else {
        std::printf("%-14s ok, JSON %s\n", label, value->type_name());
    }
}

// Sealed JSON values: base64 ciphertext with no prefix.
void ProbeSealed(const fs::path& dataDir, const char* label, const fs::path& path) {
    if (!fs::exists(path)) {
        std::printf("%-14s not present\n", label);
        return;
    }
    PrintValue(label, tvm::vault::ReadSealed(dataDir, path));
}

// Secret strings. A legacy plain value is only reported, never migrated.
void ProbeSecretString(const fs::path& dataDir, const char* label, const fs::path& path) {
    if (!fs::exists(path)) {
        std::printf("%-14s not present\n", label);
        return;
    }
    const auto text = tvm::util::ReadTextFile(path);
    const std::string value = tvm::util::Trim(tvm::util::StripBom(text.value_or("")));
    if (value.rfind(kSecretPrefix, 0) != 0) {
        std::printf("%-14s legacy plain value (%zu characters); not migrated by the probe\n", label,
                    value.size());
        return;
    }
    const auto clear = tvm::vault::OpenJson(dataDir, value.substr(kSecretPrefix.size()));
    if (clear && clear->is_string() && !clear->get<std::string>().empty()) {
        std::printf("%-14s ok, secret string of %zu characters (value not shown)\n", label,
                    clear->get<std::string>().size());
    } else {
        std::printf("%-14s NOT READABLE\n", label);
    }
}

// Xtream settings are sealed, or legacy plain JSON. Plain JSON is parsed only.
void ProbeXtream(const fs::path& dataDir, const fs::path& path) {
    if (!fs::exists(path)) {
        std::printf("%-14s not present\n", "xtream");
        return;
    }
    const std::string value = tvm::util::Trim(tvm::util::StripBom(tvm::util::ReadTextFile(path).value_or("")));
    if (!value.empty() && (value[0] == '{' || value[0] == '[')) {
        const nlohmann::json plain = nlohmann::json::parse(value, nullptr, false);
        if (plain.is_discarded()) {
            std::printf("%-14s NOT READABLE\n", "xtream");
        } else {
            std::printf("%-14s legacy plain JSON, not migrated by the probe\n", "xtream");
        }
        return;
    }
    PrintValue("xtream", tvm::vault::ReadSealed(dataDir, path));
}

// The Live TV login, read the way the app reads it. Its server, name and password are
// never printed, and no request is made to the panel.
void ProbeXtreamLogin(const fs::path& dataDir) {
    const fs::path path = tvm::paths::XtreamPath(dataDir);
    if (!fs::exists(path)) {
        std::printf("%-14s not saved\n", "live-login");
        return;
    }
    const std::string text = tvm::util::Trim(tvm::util::StripBom(tvm::util::ReadTextFile(path).value_or("")));
    if (!text.empty() && (text[0] == '{' || text[0] == '[')) {
        std::printf("%-14s legacy plain JSON, not migrated by the probe\n", "live-login");
        return;
    }
    const tvm::xtream::Client client(tvm::xtream::ClientOptions{dataDir});
    std::printf("%-14s %s (values not shown)\n", "live-login", client.Saved().has_value() ? "readable" : "NOT READABLE");
}

// The saved Live TV playlist and picks, read the way the screen reads them. Only the kind of
// playlist and the number of picks are shown. Nothing is fetched, and no channel is printed.
void ProbeLive(const fs::path& dataDir) {
    const fs::path playlistPath = tvm::paths::LivePlaylistPath(dataDir);
    const std::string stored = tvm::util::Trim(tvm::util::StripBom(tvm::util::ReadTextFile(playlistPath).value_or("")));
    if (!stored.empty() && (stored[0] == '{' || stored[0] == '[')) {
        std::printf("%-14s legacy plain JSON, not migrated by the probe\n", "live-playlist");
    } else {
        const tvm::live::Playlist playlist = tvm::live::ReadPlaylist(dataDir);
        const char* kind = playlist.text.has_value() ? "text" : playlist.url.has_value() ? "address" : "none";
        std::printf("%-14s %s (values not shown)\n", "live-playlist", kind);
    }

    const fs::path picks = tvm::paths::LivePicksPath(dataDir);
    if (!fs::exists(picks)) {
        std::printf("%-14s not present\n", "live-picks");
        return;
    }
    std::printf("%-14s %zu picks (ids not shown)\n", "live-picks", tvm::live::ReadPicks(dataDir).size());
}

// The watchlist and progress of the active profile, as counts. Titles are never printed.
void ProbeCount(const char* label, const fs::path& folder, const fs::path& path) {
    if (!fs::exists(path)) {
        std::printf("%-14s not present\n", label);
        return;
    }
    const std::string text = tvm::util::Trim(tvm::util::StripBom(tvm::util::ReadTextFile(path).value_or("")));
    if (!text.empty() && (text[0] == '{' || text[0] == '[')) {
        std::printf("%-14s legacy plain JSON, not migrated by the probe\n", label);
        return;
    }
    const auto value = tvm::vault::ReadSealed(folder, path);
    if (!value) {
        std::printf("%-14s NOT READABLE\n", label);
        return;
    }
    std::printf("%-14s ok, %zu entries (values not shown)\n", label, value->size());
}

void ProbeProfile(const fs::path& dataDir) {
    const std::optional<fs::path> folder = tvm::profiles::ActiveFolder(dataDir);
    if (!folder) {
        std::printf("%-14s registry unreadable; the watchlist and progress are not shown\n", "profile");
        return;
    }
    std::printf("%-14s %s\n", "profile", ToUtf8(folder->wstring()).c_str());
    ProbeCount("progress", *folder, tvm::paths::ProgressPath(*folder));
    ProbeCount("watchlist", *folder, tvm::paths::WatchlistPath(*folder));
}

// The account and library, read from Real-Debrid with the saved token. The token,
// the account name and every title stay unprinted. A legacy plain token is not
// migrated here, because that would write to the folder.
void ProbeRealDebrid(const fs::path& dataDir) {
    const fs::path path = tvm::paths::RdTokenPath(dataDir);
    if (fs::exists(path)) {
        const std::string value = tvm::util::Trim(tvm::util::StripBom(tvm::util::ReadTextFile(path).value_or("")));
        if (value.rfind(kSecretPrefix, 0) != 0) {
            std::printf("%-14s legacy plain token; not migrated by the probe\n", "real-debrid");
            return;
        }
    }

    const tvm::realdebrid::Client client(tvm::realdebrid::ClientOptions{dataDir});
    if (!client.Token().has_value()) {
        std::printf("%-14s not connected\n", "real-debrid");
        return;
    }
    const tvm::realdebrid::Status status = client.GetStatus();
    if (!status.error.empty()) {
        std::printf("%-14s account not read: %s\n", "real-debrid", status.error.c_str());
        return;
    }
    std::printf("%-14s account answered, premium %s (name not shown)\n", "real-debrid",
                status.premium ? "yes" : "no");

    try {
        const std::vector<tvm::realdebrid::Download> downloads = client.Downloads();
        const std::vector<tvm::realdebrid::Torrent> torrents = client.Torrents();
        const std::size_t playable = tvm::catalog::LibraryItems(downloads, torrents).size();
        std::printf("%-14s %zu downloads, %zu torrents, %zu playable items (titles not shown)\n", "library",
                    downloads.size(), torrents.size(), playable);
    } catch (const std::exception& error) {
        std::printf("%-14s not read: %s\n", "library", error.what());
    }
}

}  // namespace

int main(int argc, char** argv) {
    bool online = false;
    std::vector<std::string> positional;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--online") {
            online = true;
        } else {
            positional.emplace_back(argv[i]);
        }
    }
    const fs::path dataDir = !positional.empty() ? fs::path(tvm::util::ToWide(positional[0]))
                                                 : tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment());
    std::printf("data directory: %s\n", ToUtf8(dataDir.wstring()).c_str());

    // The probe never creates a master key. Without a DPAPI-wrapped one, no
    // sealed value can be opened, so there is nothing to check.
    const auto masterKey = tvm::util::ReadTextFile(tvm::paths::MasterKeyPath(dataDir));
    if (!masterKey || masterKey->rfind("tvm-dpapi-v1:", 0) != 0) {
        std::printf("master key: missing or not DPAPI-wrapped; the probe stops here\n");
        return 2;
    }
    std::printf("master key: present, DPAPI-wrapped\n");

    ProbeSealed(dataDir, "entitlement", tvm::paths::EntitlementPath(dataDir));
    ProbeSealed(dataDir, "accounts", tvm::paths::AccountsPath(dataDir));
    ProbeSealed(dataDir, "billing", tvm::paths::BillingPath(dataDir));
    ProbeSealed(dataDir, "usage", tvm::paths::UsagePath(dataDir));
    ProbeSealed(dataDir, "dev-unlock", tvm::paths::DevUnlockPath(dataDir));
    ProbeSecretString(dataDir, "rd-token", tvm::paths::RdTokenPath(dataDir));
    ProbeSecretString(dataDir, "github-token", tvm::paths::GithubTokenPath(dataDir));
    ProbeXtream(dataDir, tvm::paths::XtreamPath(dataDir));
    ProbeXtreamLogin(dataDir);
    ProbeLive(dataDir);
    ProbeProfile(dataDir);
    if (online) ProbeRealDebrid(dataDir);
    return 0;
}
