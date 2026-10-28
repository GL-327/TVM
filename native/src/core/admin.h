#pragma once

// The developer's side of TVM: developer mode, the accounts people sign up with, and the mail server the
// sign-up codes are sent from. Ported from apps/core/src/providers/devUnlock.ts, the dev-only part of
// accounts.ts, and the settings part of mail.ts. Each is sealed in the vault in the same file the Node core
// uses, so either app reads what the other wrote.

#include <optional>
#include <string>
#include <vector>

#include "core/paths.h"

namespace tvm::admin {

// ------------------------------------------------------------------ developer mode

// Whether developer mode is on for this data folder: a sealed record that says so.
bool DevUnlocked(const paths::fs::path& dataDir);
// Checks the developer code against its PBKDF2 digest, the same one the Node, iPhone and Android apps hold,
// and turns developer mode on when it matches. Surrounding space is ignored. Slow on purpose.
bool UnlockDev(const paths::fs::path& dataDir, const std::string& code);
void LockDev(const paths::fs::path& dataDir);

// ------------------------------------------------------------------ accounts

struct Account {
    std::string id;
    std::string email;
    std::string displayName;
    std::string createdAt;
    bool activated = false;
    std::string activatedAt;
    // "stream", "stream-live", or empty before the account is switched on.
    std::string tier;
    std::string note;
    bool suspended = false;
    std::string termsVersion;
    std::string termsAcceptedAt;
    std::string emailVerifiedAt;
    bool emailCodeSent = false;
    bool hasRdKey = false;
    std::string lastSeenAt;
    int signIns = 0;
    std::string lastClient;
    int sessions = 0;
};

struct Summary {
    int total = 0;
    int waiting = 0;
    int active = 0;
    int suspended = 0;
};

// Every member account, newest first. `state` is "all", "waiting", "active" or "suspended". The dev
// account is never listed. Search is a plain substring over the address and the name.
std::vector<Account> ListAccounts(const paths::fs::path& dataDir, const std::string& search = "",
                                  const std::string& state = "all");
Summary Summarise(const paths::fs::path& dataDir);

// The dev's changes, each written at once. Each throws std::runtime_error with the Node core's message
// when the account is unknown or the change is refused.
void Activate(const paths::fs::path& dataDir, const std::string& id, const std::string& tier);
void SetLiveTv(const paths::fs::path& dataDir, const std::string& id, bool enabled);
void SetEmailVerified(const paths::fs::path& dataDir, const std::string& id, bool verified);
void SetSuspended(const paths::fs::path& dataDir, const std::string& id, bool suspended);
void SetNote(const paths::fs::path& dataDir, const std::string& id, const std::string& note);
void SetRdToken(const paths::fs::path& dataDir, const std::string& id, const std::string& token);
void Erase(const paths::fs::path& dataDir, const std::string& id);

// ------------------------------------------------------------------ mail

struct MailSettings {
    std::string host;
    int port = 587;
    // "starttls" or "tls".
    std::string security = "starttls";
    std::string username;
    std::string password;
    std::string from;
};

paths::fs::path MailPath(const paths::fs::path& dataDir);
// The saved settings, or nothing when mail is not set up.
std::optional<MailSettings> ReadMail(const paths::fs::path& dataDir);
// Checks the settings as readMailSettings does, keeping the saved password when none is given for the same
// server and username, and seals them. Throws std::runtime_error with the Node core's message.
void SaveMail(const paths::fs::path& dataDir, MailSettings settings);
void ClearMail(const paths::fs::path& dataDir);

}  // namespace tvm::admin
