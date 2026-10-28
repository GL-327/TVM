// Core tests. They port the behaviour pinned by apps/core/src/config.test.ts,
// prefs.test.ts and the vault and secret paths, and add interop checks against
// values produced by Node's own crypto, so the C++ core reads what the Node
// core wrote.

#include <windows.h>

#include <cstdint>
#include <exception>
#include <fstream>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/config.h"
#include "core/crypto.h"
#include "core/paths.h"
#include "core/prefs.h"
#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

#include "harness.h"

namespace {

namespace fs = std::filesystem;
using tvm::util::Bytes;

// A fresh folder per test, removed afterwards.
class TempDir {
public:
    TempDir() {
        static unsigned counter = 0;
        path_ = fs::temp_directory_path() /
                (L"tvm-core-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
        fs::create_directories(path_);
    }
    ~TempDir() {
        std::error_code ignored;
        fs::remove_all(path_, ignored);
    }
    const fs::path& path() const { return path_; }

private:
    fs::path path_;
};

tvm::util::EnvLookup Env(std::map<std::wstring, std::wstring> values) {
    return [values](const std::wstring& name) -> std::optional<std::wstring> {
        const auto found = values.find(name);
        if (found == values.end()) return std::nullopt;
        return found->second;
    };
}

std::string ToHex(const Bytes& bytes) {
    static constexpr char kDigits[] = "0123456789abcdef";
    std::string out;
    for (std::uint8_t byte : bytes) {
        out.push_back(kDigits[byte >> 4]);
        out.push_back(kDigits[byte & 0x0F]);
    }
    return out;
}

void WriteTestFile(const fs::path& path, const std::string& content) {
    tvm::util::WriteFileAtomically(path, content);
}

// Key 0x00..0x1f, IV 0x07 x 12. Produced by Node:
//   createCipheriv('aes-256-gcm', key, iv) over JSON '{"plan":"pro","n":3}'.
const Bytes kNodeKey = [] {
    Bytes key(32);
    for (std::size_t i = 0; i < key.size(); ++i) key[i] = static_cast<std::uint8_t>(i);
    return key;
}();
constexpr char kNodeObjectBlob[] = "BwcHBwcHBwcHBwcHZ7rwpFCD5mZZwY9NSwLOXXRI1jAOYfXO5O1h76J91vWDZr4O";
constexpr char kNodeSecretBlob[] = "BwcHBwcHBwcHBwcH6mq/NgfQCTjnBf5hgNaqCS0YwnEDZqGR6+l86+U/1g==";

// Writes the master key the way Node does: DPAPI-wrapped under the
// tvm-dpapi-v1 prefix.
void WriteWrappedMasterKey(const fs::path& dataDir, const Bytes& key) {
    const std::string wrapped =
        "tvm-dpapi-v1:" + tvm::util::Base64Encode(tvm::crypto::ProtectForUser(key));
    WriteTestFile(tvm::paths::MasterKeyPath(dataDir), wrapped);
}

// ---------------------------------------------------------------- config

TEST(port_defaults_and_overrides) {
    REQUIRE_EQ(tvm::config::ResolvePort(Env({})), std::uint16_t{7345});
    REQUIRE_EQ(tvm::config::ResolvePort(Env({{L"TVM_CORE_PORT", L"   "}})), std::uint16_t{7345});
    REQUIRE_EQ(tvm::config::ResolvePort(Env({{L"TVM_CORE_PORT", L"8123"}})), std::uint16_t{8123});
    REQUIRE_EQ(tvm::config::ResolvePort(Env({{L"TVM_CORE_PORT", L" 0 "}})), std::uint16_t{0});
    REQUIRE_EQ(tvm::config::ResolvePort(Env({{L"TVM_CORE_PORT", L"65535"}})), std::uint16_t{65535});
}

TEST(port_rejects_values_that_are_not_ports) {
    for (const wchar_t* bad : {L"banana", L"99999", L"-1", L"1.5", L"0x10", L"12ab"}) {
        REQUIRE_THROWS_CONTAINING(tvm::config::ResolvePort(Env({{L"TVM_CORE_PORT", bad}})),
                                  "between 0 and 65535");
    }
}

TEST(bind_host_rules) {
    REQUIRE_EQ(tvm::config::ResolveBindHost(Env({})), std::string("127.0.0.1"));
    REQUIRE_EQ(tvm::config::ResolveBindHost(Env({{L"TVM_CORE_BIND", L"0.0.0.0"}})), std::string("0.0.0.0"));
    REQUIRE_EQ(tvm::config::ResolveBindHost(Env({{L"TVM_CORE_BIND", L"192.168.1.20"}})),
               std::string("192.168.1.20"));
    REQUIRE_THROWS_CONTAINING(tvm::config::ResolveBindHost(Env({{L"TVM_CORE_BIND", L"10.0.0.256"}})),
                              "TVM_CORE_BIND must be");
    REQUIRE_THROWS_CONTAINING(tvm::config::ResolveBindHost(Env({{L"TVM_CORE_BIND", L"localhost"}})),
                              "TVM_CORE_BIND must be");
}

TEST(core_version_matches_package_json) {
    const fs::path manifest = fs::path(TVM_REPO_ROOT) / L"package.json";
    const auto text = tvm::util::ReadTextFile(manifest);
    REQUIRE(text.has_value());
    const nlohmann::json package = nlohmann::json::parse(*text);
    REQUIRE_EQ(package.at("version").get<std::string>(), std::string(tvm::config::kCoreVersion));
}

// ----------------------------------------------------------------- paths

TEST(data_dir_defaults_to_local_app_data) {
    const fs::path dir = tvm::paths::ResolveDataDir(Env({{L"LOCALAPPDATA", L"C:\\Users\\x\\AppData\\Local"}}));
    REQUIRE_EQ(tvm::util::ToUtf8(dir.wstring()), std::string("C:\\Users\\x\\AppData\\Local\\TVM"));
}

TEST(data_dir_falls_back_to_app_data) {
    const fs::path dir = tvm::paths::ResolveDataDir(Env({{L"APPDATA", L"C:\\Roaming"}}));
    REQUIRE_EQ(tvm::util::ToUtf8(dir.wstring()), std::string("C:\\Roaming\\TVM"));
}

TEST(data_dir_override_wins) {
    const fs::path dir = tvm::paths::ResolveDataDir(
        Env({{L"TVM_DATA_DIR", L"  D:\\TVMData  "}, {L"LOCALAPPDATA", L"C:\\Local"}}));
    REQUIRE_EQ(tvm::util::ToUtf8(dir.wstring()), std::string("D:\\TVMData"));
}

TEST(secret_files_use_the_node_layout) {
    const fs::path root = L"C:\\data";
    REQUIRE_EQ(tvm::util::ToUtf8(tvm::paths::MasterKeyPath(root).wstring()),
               std::string("C:\\data\\secrets\\master.key"));
    REQUIRE_EQ(tvm::util::ToUtf8(tvm::paths::RdTokenPath(root).wstring()),
               std::string("C:\\data\\secrets\\rd-token"));
    REQUIRE_EQ(tvm::util::ToUtf8(tvm::paths::PrefsPath(root).wstring()), std::string("C:\\data\\prefs.json"));
}

// ------------------------------------------------------------------ util

TEST(base64_known_vectors) {
    REQUIRE_EQ(tvm::util::Base64Encode(tvm::util::ToBytes("TVM")), std::string("VFZN"));
    REQUIRE_EQ(tvm::util::Base64Encode(tvm::util::ToBytes("f")), std::string("Zg=="));
    REQUIRE_EQ(tvm::util::Base64Encode(tvm::util::ToBytes("fo")), std::string("Zm8="));
    REQUIRE_EQ(tvm::util::Base64Encode({}), std::string(""));
    REQUIRE_EQ(tvm::util::ToString(tvm::util::Base64Decode("Zm9v")), std::string("foo"));
    // Whitespace and the URL-safe alphabet are accepted, as Node accepts them.
    REQUIRE_EQ(tvm::util::ToString(tvm::util::Base64Decode("Zm9v\n")), std::string("foo"));
    REQUIRE_EQ(tvm::util::ToString(tvm::util::Base64Decode("-_8=")), std::string("\xfb\xff"));
    // Decoding stops at the first padding character, as Node does.
    REQUIRE_EQ(tvm::util::ToString(tvm::util::Base64Decode("Zg==Zm9v")), std::string("f"));
}

TEST(base64_round_trips_every_byte) {
    Bytes all(256);
    for (std::size_t i = 0; i < all.size(); ++i) all[i] = static_cast<std::uint8_t>(i);
    REQUIRE(tvm::util::Base64Decode(tvm::util::Base64Encode(all)) == all);
}

TEST(trim_and_bom_handling) {
    REQUIRE_EQ(tvm::util::Trim("  x\r\n"), std::string("x"));
    REQUIRE_EQ(tvm::util::Trim(" \t "), std::string(""));
    REQUIRE_EQ(tvm::util::StripBom("\xEF\xBB\xBF" "abc"), std::string("abc"));
    REQUIRE_EQ(tvm::util::StripBom("abc"), std::string("abc"));
}

TEST(atomic_write_replaces_the_file_and_leaves_no_temporary) {
    TempDir dir;
    const fs::path file = dir.path() / L"secrets" / L"value.txt";
    WriteTestFile(file, "first");
    WriteTestFile(file, "second");
    REQUIRE_EQ(tvm::util::ReadTextFile(file).value_or("missing"), std::string("second"));

    int entries = 0;
    for (const auto& entry : fs::directory_iterator(file.parent_path())) {
        (void)entry;
        ++entries;
    }
    REQUIRE_EQ(entries, 1);
}

// ---------------------------------------------------------------- crypto

TEST(gcm_matches_the_standard_vector) {
    // AES-256-GCM, zero key, zero IV, zero plaintext. Also what Node produces.
    const Bytes key(32, 0);
    const Bytes iv(12, 0);
    const Bytes plain(16, 0);
    Bytes tag;
    const Bytes cipher = tvm::crypto::AesGcmEncrypt(key, iv, plain, tag);
    REQUIRE_EQ(ToHex(cipher), std::string("cea7403d4d606b6e074ec5d3baf39d18"));
    REQUIRE_EQ(ToHex(tag), std::string("d0d1c8a799996bf0265b98b5d48ab919"));
}

TEST(gcm_detects_a_tampered_tag) {
    const Bytes key(32, 0x11);
    const Bytes iv(12, 0x22);
    Bytes tag;
    const Bytes cipher = tvm::crypto::AesGcmEncrypt(key, iv, tvm::util::ToBytes("secret"), tag);
    REQUIRE(tvm::crypto::AesGcmDecrypt(key, iv, tag, cipher).has_value());
    tag[0] ^= 0x01;
    REQUIRE(!tvm::crypto::AesGcmDecrypt(key, iv, tag, cipher).has_value());
}

TEST(dpapi_round_trips_for_the_current_user) {
    const Bytes secret = tvm::util::ToBytes("master-key-material");
    const Bytes blob = tvm::crypto::ProtectForUser(secret);
    REQUIRE(blob != secret);
    const auto clear = tvm::crypto::UnprotectForUser(blob);
    REQUIRE(clear.has_value());
    REQUIRE(*clear == secret);
}

// ----------------------------------------------------------------- vault

TEST(vault_opens_a_blob_sealed_by_node) {
    TempDir dir;
    WriteWrappedMasterKey(dir.path(), kNodeKey);
    const auto value = tvm::vault::OpenJson(dir.path(), kNodeObjectBlob);
    REQUIRE(value.has_value());
    REQUIRE_EQ(value->at("plan").get<std::string>(), std::string("pro"));
    REQUIRE_EQ(value->at("n").get<int>(), 3);
}

TEST(vault_migrates_a_legacy_plain_master_key) {
    TempDir dir;
    // Older installs stored the raw key as base64 with no DPAPI wrapping.
    WriteTestFile(tvm::paths::MasterKeyPath(dir.path()), tvm::util::Base64Encode(kNodeKey));
    REQUIRE(tvm::vault::OpenJson(dir.path(), kNodeObjectBlob).has_value());
    const std::string migrated = tvm::util::ReadTextFile(tvm::paths::MasterKeyPath(dir.path())).value_or("");
    REQUIRE(migrated.rfind("tvm-dpapi-v1:", 0) == 0);
}

TEST(vault_seal_and_open_round_trip) {
    TempDir dir;
    const nlohmann::json value = {{"tier", "pro"}, {"seats", 2}};
    const std::string blob = tvm::vault::SealJson(dir.path(), value);
    const std::string stored = tvm::util::ReadTextFile(tvm::paths::MasterKeyPath(dir.path())).value_or("");
    REQUIRE(stored.rfind("tvm-dpapi-v1:", 0) == 0);
    REQUIRE(tvm::vault::OpenJson(dir.path(), blob) == value);
}

TEST(vault_rejects_tampered_blobs) {
    TempDir dir;
    WriteWrappedMasterKey(dir.path(), kNodeKey);
    std::string tampered = kNodeObjectBlob;
    tampered[20] = tampered[20] == 'A' ? 'B' : 'A';
    REQUIRE(!tvm::vault::OpenJson(dir.path(), tampered).has_value());
}

TEST(vault_never_creates_a_key_while_reading) {
    TempDir dir;
    REQUIRE(!tvm::vault::OpenJson(dir.path(), kNodeObjectBlob).has_value());
    REQUIRE(!fs::exists(tvm::paths::MasterKeyPath(dir.path())));
}

// --------------------------------------------------------------- secrets

TEST(secret_is_sealed_on_disk_and_reads_back) {
    TempDir dir;
    const fs::path path = tvm::paths::RdTokenPath(dir.path());
    tvm::secrets::WriteSecret(path, "tok-123-abc");

    const std::string onDisk = tvm::util::ReadTextFile(path).value_or("");
    REQUIRE(onDisk.rfind("tvm-secret-v1:", 0) == 0);
    REQUIRE(onDisk.find("tok-123") == std::string::npos);
    REQUIRE_EQ(tvm::secrets::ReadSecret(path).value_or("missing"), std::string("tok-123-abc"));
}

TEST(secret_written_by_node_reads_here) {
    TempDir dir;
    WriteWrappedMasterKey(dir.path(), kNodeKey);
    WriteTestFile(tvm::paths::RdTokenPath(dir.path()), std::string("tvm-secret-v1:") + kNodeSecretBlob);
    REQUIRE_EQ(tvm::secrets::ReadSecret(tvm::paths::RdTokenPath(dir.path())).value_or("missing"),
               std::string("rd-live-token"));
}

TEST(legacy_plain_secret_is_migrated_in_place) {
    TempDir dir;
    const fs::path path = tvm::paths::GithubTokenPath(dir.path());
    WriteTestFile(path, "\xEF\xBB\xBFlegacy-token\n");
    REQUIRE_EQ(tvm::secrets::ReadSecret(path).value_or("missing"), std::string("legacy-token"));
    const std::string after = tvm::util::ReadTextFile(path).value_or("");
    REQUIRE(after.rfind("tvm-secret-v1:", 0) == 0);
    REQUIRE_EQ(tvm::secrets::ReadSecret(path).value_or("missing"), std::string("legacy-token"));
}

TEST(missing_and_blank_secrets_read_as_nothing) {
    TempDir dir;
    REQUIRE(!tvm::secrets::ReadSecret(tvm::paths::RdTokenPath(dir.path())).has_value());
    WriteTestFile(tvm::paths::RdTokenPath(dir.path()), "   \n");
    REQUIRE(!tvm::secrets::ReadSecret(tvm::paths::RdTokenPath(dir.path())).has_value());
}

TEST(delete_secret_removes_the_file) {
    TempDir dir;
    const fs::path path = tvm::paths::RdTokenPath(dir.path());
    tvm::secrets::WriteSecret(path, "value");
    REQUIRE(tvm::secrets::HasSecretFile(path));
    tvm::secrets::DeleteSecret(path);
    REQUIRE(!tvm::secrets::HasSecretFile(path));
}

TEST(private_json_migrates_a_plain_document) {
    TempDir dir;
    const fs::path path = tvm::paths::XtreamPath(dir.path());
    WriteTestFile(path, R"({"host":"example.test","port":8080})");
    const auto value = tvm::secrets::ReadPrivateJson(dir.path(), path);
    REQUIRE(value.has_value());
    REQUIRE_EQ(value->at("port").get<int>(), 8080);

    const std::string after = tvm::util::ReadTextFile(path).value_or("");
    REQUIRE(after.find("example.test") == std::string::npos);
    REQUIRE(tvm::vault::ReadSealed(dir.path(), path) == value);
}

TEST(private_json_rejects_non_json_text) {
    TempDir dir;
    const fs::path path = tvm::paths::XtreamPath(dir.path());
    WriteTestFile(path, "hello there");
    REQUIRE(!tvm::secrets::ReadPrivateJson(dir.path(), path).has_value());
}

// ----------------------------------------------------------------- prefs

TEST(prefs_default_when_missing) {
    TempDir dir;
    REQUIRE(tvm::prefs::ReadPrefs(dir.path()) == tvm::prefs::CorePrefs{});
    REQUIRE_EQ(tvm::prefs::CorePrefs{}.language, std::string("en"));
    REQUIRE(tvm::prefs::CorePrefs{}.autoUpdate);
}

TEST(prefs_write_and_read_back_in_node_format) {
    TempDir dir;
    const auto written = tvm::prefs::WritePrefs(dir.path(), {"fr", false});
    REQUIRE_EQ(written.language, std::string("fr"));
    REQUIRE(!written.autoUpdate);

    const std::string onDisk = tvm::util::ReadTextFile(tvm::paths::PrefsPath(dir.path())).value_or("");
    REQUIRE_EQ(onDisk, std::string(R"({"language":"fr","autoUpdate":false})"));
    REQUIRE(tvm::prefs::ReadPrefs(dir.path()) == written);
}

TEST(prefs_keep_the_language_for_an_unsupported_value) {
    TempDir dir;
    tvm::prefs::WritePrefs(dir.path(), {"fr", std::nullopt});
    const auto after = tvm::prefs::WritePrefs(dir.path(), {"zz", std::nullopt});
    REQUIRE_EQ(after.language, std::string("fr"));
}

TEST(prefs_malformed_or_odd_files_fall_back_to_defaults) {
    TempDir dir;
    WriteTestFile(tvm::paths::PrefsPath(dir.path()), "{not json");
    REQUIRE(tvm::prefs::ReadPrefs(dir.path()) == tvm::prefs::CorePrefs{});

    // Only an explicit false turns updates off.
    WriteTestFile(tvm::paths::PrefsPath(dir.path()), R"({"language":"de","autoUpdate":"no"})");
    const auto prefs = tvm::prefs::ReadPrefs(dir.path());
    REQUIRE_EQ(prefs.language, std::string("de"));
    REQUIRE(prefs.autoUpdate);
}

TEST(prefs_accept_a_byte_order_mark) {
    TempDir dir;
    WriteTestFile(tvm::paths::PrefsPath(dir.path()), "\xEF\xBB\xBF" R"({"language":"ja","autoUpdate":false})");
    const auto prefs = tvm::prefs::ReadPrefs(dir.path());
    REQUIRE_EQ(prefs.language, std::string("ja"));
    REQUIRE(!prefs.autoUpdate);
}

}  // namespace
