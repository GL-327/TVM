#include "core/admin.h"

#include <algorithm>
#include <regex>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include "core/crypto.h"
#include "core/secrets.h"
#include "core/util.h"
#include "core/vault.h"

namespace tvm::admin {

namespace {

// devUnlock.ts: the salt and digest are public by design; the code itself is in no repository.
constexpr char kPbkdf2Salt[] = "7318f8167254137fe74ca4b6682c1aaa";
constexpr char kPbkdf2Hash[] = "8e144ed529289b3b617e50ee6c4f0ffb3e9890a1bbd224fb2a339cac7aaabca2";
constexpr unsigned long kPbkdf2Iterations = 600000;
constexpr char kDevAccountId[] = "acc_dev";

util::Bytes FromHex(const std::string& hex) {
    util::Bytes bytes;
    for (std::size_t i = 0; i + 1 < hex.size(); i += 2) {
        bytes.push_back(static_cast<std::uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    }
    return bytes;
}

std::string Text(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    return found != object.end() && found->is_string() ? found->get<std::string>() : std::string();
}

nlohmann::json ReadLedger(const paths::fs::path& dataDir) {
    std::optional<nlohmann::json> stored;
    try {
        stored = vault::ReadSealed(dataDir, paths::AccountsPath(dataDir));
    } catch (const std::exception&) {
        stored.reset();
    }
    nlohmann::json ledger = stored.has_value() && stored->is_object() ? *stored : nlohmann::json::object();
    if (!ledger.contains("accounts") || !ledger["accounts"].is_array()) ledger["accounts"] = nlohmann::json::array();
    if (!ledger.contains("sessions") || !ledger["sessions"].is_object()) ledger["sessions"] = nlohmann::json::object();
    ledger["version"] = 1;
    return ledger;
}

void WriteLedger(const paths::fs::path& dataDir, const nlohmann::json& ledger) {
    vault::WriteSealed(dataDir, paths::AccountsPath(dataDir), ledger);
}

// The member account with this id. The dev account is not a member, as member() in accounts.ts has it.
nlohmann::json& Member(nlohmann::json& ledger, const std::string& id) {
    for (nlohmann::json& account : ledger["accounts"]) {
        if (Text(account, "id") == id && Text(account, "role") != "dev") return account;
    }
    throw std::runtime_error("No account with that id.");
}

void DropSessions(nlohmann::json& ledger, const std::string& id) {
    nlohmann::json kept = nlohmann::json::object();
    for (auto& [key, session] : ledger["sessions"].items()) {
        if (!session.is_object() || Text(session, "accountId") != id) kept[key] = session;
    }
    ledger["sessions"] = kept;
}

nlohmann::json NullOr(const std::string& value) {
    return value.empty() ? nlohmann::json(nullptr) : nlohmann::json(value);
}

}  // namespace

// ------------------------------------------------------------------ developer mode

bool DevUnlocked(const paths::fs::path& dataDir) {
    try {
        const std::optional<nlohmann::json> record = vault::ReadSealed(dataDir, paths::DevUnlockPath(dataDir));
        return record.has_value() && record->is_object() && record->value("unlocked", false);
    } catch (const std::exception&) {
        // A damaged vault must not grant developer access.
        return false;
    }
}

bool UnlockDev(const paths::fs::path& dataDir, const std::string& code) {
    const std::string trimmed = util::Trim(code);
    if (trimmed.empty() || trimmed.size() > 128) return false;
    const util::Bytes expected = FromHex(kPbkdf2Hash);
    const util::Bytes derived = crypto::Pbkdf2Sha256(trimmed, FromHex(kPbkdf2Salt), kPbkdf2Iterations, expected.size());
    if (!crypto::ConstantTimeEqual(derived, expected)) return false;
    vault::WriteSealed(dataDir, paths::DevUnlockPath(dataDir), {{"unlocked", true}, {"at", util::IsoTimestamp()}});
    return true;
}

void LockDev(const paths::fs::path& dataDir) {
    secrets::DeleteSecret(paths::DevUnlockPath(dataDir));
}

// ------------------------------------------------------------------ accounts

std::vector<Account> ListAccounts(const paths::fs::path& dataDir, const std::string& search, const std::string& state) {
    const nlohmann::json ledger = ReadLedger(dataDir);
    std::string needle = util::Trim(search);
    std::transform(needle.begin(), needle.end(), needle.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::vector<Account> accounts;
    for (const nlohmann::json& raw : ledger["accounts"]) {
        if (!raw.is_object() || Text(raw, "role") == "dev") continue;
        Account account;
        account.id = Text(raw, "id");
        account.email = Text(raw, "email");
        account.displayName = Text(raw, "displayName");
        account.createdAt = Text(raw, "createdAt");
        account.activated = raw.value("activated", false);
        account.activatedAt = Text(raw, "activatedAt");
        account.tier = Text(raw, "tier");
        account.note = Text(raw, "note");
        account.suspended = raw.value("suspended", false);
        account.termsVersion = Text(raw, "termsVersion");
        account.termsAcceptedAt = Text(raw, "termsAcceptedAt");
        account.emailVerifiedAt = Text(raw, "emailVerifiedAt");
        account.emailCodeSent = raw.contains("emailCode") && raw["emailCode"].is_object();
        account.hasRdKey = !Text(raw, "rdToken").empty();
        account.lastSeenAt = Text(raw, "lastSeenAt");
        account.signIns = raw.value("signIns", 0);
        account.lastClient = Text(raw, "lastClient");
        for (const auto& [key, session] : ledger["sessions"].items()) {
            if (session.is_object() && Text(session, "accountId") == account.id) ++account.sessions;
        }
        std::string name = account.displayName;
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (!needle.empty() && account.email.find(needle) == std::string::npos && name.find(needle) == std::string::npos) continue;
        if (state == "waiting" && (account.activated || account.suspended)) continue;
        if (state == "active" && (!account.activated || account.suspended)) continue;
        if (state == "suspended" && !account.suspended) continue;
        accounts.push_back(std::move(account));
    }
    std::stable_sort(accounts.begin(), accounts.end(),
                     [](const Account& a, const Account& b) { return a.createdAt > b.createdAt; });
    return accounts;
}

Summary Summarise(const paths::fs::path& dataDir) {
    Summary summary;
    for (const Account& account : ListAccounts(dataDir)) {
        ++summary.total;
        if (account.suspended) ++summary.suspended;
        else if (account.activated) ++summary.active;
        else ++summary.waiting;
    }
    return summary;
}

void Activate(const paths::fs::path& dataDir, const std::string& id, const std::string& tier) {
    if (tier != "stream" && tier != "stream-live") throw std::runtime_error("Choose a valid tier.");
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    record["activated"] = true;
    if (Text(record, "activatedAt").empty()) record["activatedAt"] = util::IsoTimestamp();
    record["tier"] = tier;
    record["suspended"] = false;
    WriteLedger(dataDir, ledger);
}

void SetLiveTv(const paths::fs::path& dataDir, const std::string& id, bool enabled) {
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    if (!record.value("activated", false) || Text(record, "tier").empty()) throw std::runtime_error("Switch the account on first.");
    record["tier"] = enabled ? "stream-live" : "stream";
    WriteLedger(dataDir, ledger);
}

void SetEmailVerified(const paths::fs::path& dataDir, const std::string& id, bool verified) {
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    record["emailVerifiedAt"] = verified ? NullOr(Text(record, "emailVerifiedAt").empty() ? util::IsoTimestamp()
                                                                                           : Text(record, "emailVerifiedAt"))
                                         : nlohmann::json(nullptr);
    record["emailCode"] = nullptr;
    WriteLedger(dataDir, ledger);
}

void SetSuspended(const paths::fs::path& dataDir, const std::string& id, bool suspended) {
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    record["suspended"] = suspended;
    // A suspended account is switched off, and its sessions end straight away.
    if (suspended) {
        record["activated"] = false;
        DropSessions(ledger, id);
    }
    WriteLedger(dataDir, ledger);
}

void SetNote(const paths::fs::path& dataDir, const std::string& id, const std::string& note) {
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    record["note"] = NullOr(note.substr(0, 500));
    WriteLedger(dataDir, ledger);
}

void SetRdToken(const paths::fs::path& dataDir, const std::string& id, const std::string& token) {
    const std::string trimmed = util::Trim(token);
    if (trimmed.size() > 200 || trimmed.find_first_of(" \t\r\n") != std::string::npos) {
        throw std::runtime_error("That does not look like a Real-Debrid key.");
    }
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json& record = Member(ledger, id);
    record["rdToken"] = NullOr(trimmed);
    WriteLedger(dataDir, ledger);
}

void Erase(const paths::fs::path& dataDir, const std::string& id) {
    if (id == kDevAccountId) throw std::runtime_error("The dev account cannot be erased.");
    nlohmann::json ledger = ReadLedger(dataDir);
    nlohmann::json kept = nlohmann::json::array();
    for (const nlohmann::json& account : ledger["accounts"]) {
        if (Text(account, "id") != id) kept.push_back(account);
    }
    ledger["accounts"] = kept;
    DropSessions(ledger, id);
    WriteLedger(dataDir, ledger);
}

// ------------------------------------------------------------------ mail

paths::fs::path MailPath(const paths::fs::path& dataDir) {
    return paths::AccountsPath(dataDir).parent_path() / L"mail.enc";
}

std::optional<MailSettings> ReadMail(const paths::fs::path& dataDir) {
    std::optional<nlohmann::json> stored;
    try {
        stored = vault::ReadSealed(dataDir, MailPath(dataDir));
    } catch (const std::exception&) {
        return std::nullopt;
    }
    if (!stored.has_value() || !stored->is_object() || Text(*stored, "host").empty()) return std::nullopt;
    MailSettings settings;
    settings.host = Text(*stored, "host");
    settings.port = stored->value("port", 587);
    settings.security = Text(*stored, "security") == "tls" ? "tls" : "starttls";
    settings.username = Text(*stored, "username");
    settings.password = Text(*stored, "password");
    settings.from = Text(*stored, "from");
    return settings;
}

void SaveMail(const paths::fs::path& dataDir, MailSettings settings) {
    static const std::regex kHost(R"(^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$)");
    static const std::regex kEmail(R"(^[^\s@]+@[^\s@]+\.[^\s@]+$)");
    const auto lower = [](std::string text) {
        std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return util::Trim(text);
    };
    settings.host = lower(settings.host);
    settings.from = lower(settings.from);
    settings.username = util::Trim(settings.username);
    if (!std::regex_match(settings.host, kHost)) throw std::runtime_error("Enter the mail server, for example smtp.mail.me.com.");
    if (settings.port < 1 || settings.port > 65535) throw std::runtime_error("Enter the port, usually 587 or 465.");
    if (settings.username.size() > 254 || settings.username.find_first_of("\r\n") != std::string::npos) {
        throw std::runtime_error("That username is not valid.");
    }
    if (settings.password.find_first_of("\r\n") != std::string::npos || settings.password.size() > 500) {
        throw std::runtime_error("That password is not valid.");
    }
    // An empty password keeps the saved one, for the same server and username.
    if (settings.password.empty()) {
        const std::optional<MailSettings> previous = ReadMail(dataDir);
        if (previous.has_value() && previous->host == settings.host && previous->username == settings.username) {
            settings.password = previous->password;
        }
    }
    if (!settings.username.empty() && settings.password.empty()) throw std::runtime_error("Enter the password for that username.");
    if (!std::regex_match(settings.from, kEmail)) throw std::runtime_error("Enter the address the codes should come from.");
    vault::WriteSealed(dataDir, MailPath(dataDir),
                       {{"host", settings.host}, {"port", settings.port}, {"security", settings.security},
                        {"username", settings.username}, {"password", settings.password}, {"from", settings.from}});
}

void ClearMail(const paths::fs::path& dataDir) {
    secrets::DeleteSecret(MailPath(dataDir));
}

}  // namespace tvm::admin
