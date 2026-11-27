#pragma once

#include <cstddef>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/http.h"
#include "core/admin.h"
#include "core/paths.h"

namespace tvm::coreapi {

inline constexpr std::size_t kMinPasswordLength = 10;
inline constexpr std::size_t kMaxPasswordLength = 200;

class RequestError : public std::runtime_error {
public:
    RequestError(const std::string& message, std::string reason) : std::runtime_error(message), reason(std::move(reason)) {}
    std::string reason;
};

struct AccountState {
    bool signedIn = false;
    bool usable = false;
    bool developer = false;
    bool liveTv = false;
    bool canSendEmail = false;
    bool rdKey = false;
    bool activated = false;
    bool suspended = false;
    bool emailCodeSent = false;
    std::string reason = "no_account";
    std::string name, email, tier, termsVersion, createdAt;
};

struct TermsSection {
    std::string title;
    std::string body;
    bool operator==(const TermsSection&) const = default;
};

struct TermsDocument {
    std::string version = "1.0";
    std::string updated;
    std::string intro;
    std::vector<TermsSection> sections;
    bool operator==(const TermsDocument&) const = default;
};

struct AccessTier {
    std::string id;
    std::string name;
    std::string tag;
    int monthlyPence = 0;
    int yearlyPence = 0;
    int liveAddOnMonthlyPence = 0;
    int liveAddOnYearlyPence = 0;
    bool orderable = true;
    bool liveIncluded = false;
    std::vector<std::string> bullets;
    std::string finePrint;
    bool operator==(const AccessTier&) const = default;
};

struct TiersDocument {
    std::string route = "/pricing";
    int streamMonthlyPence = 1000;
    std::vector<AccessTier> tiers;
    bool operator==(const TiersDocument&) const = default;
};

struct RealDebridStatus {
    bool configured = false;
    std::optional<std::string> username;
    bool premium = false;
    std::string error;
    std::string source;  // "account", "device", or ""

    bool operator==(const RealDebridStatus&) const = default;
};

AccountState ParseAccount(const nlohmann::json& body);
TermsDocument DefaultTermsDocument();
TermsDocument ParseTermsDocument(const nlohmann::json& body);
TiersDocument DefaultTiersDocument();
TiersDocument ParseTiersDocument(const nlohmann::json& body);
std::optional<std::string> ValidateEmailInput(const std::string& raw);
std::optional<std::string> ValidatePasswordInput(const std::string& password, bool forSignup);
std::string AccountStatusLabel(const AccountState& account);
std::string FriendlyPlanName(const std::string& tier);
std::string FriendlyAccountError(const std::string& raw);
std::string ShortDateLabel(const std::string& iso);
RealDebridStatus ParseRealDebridStatus(const nlohmann::json& body);
bool ShouldPromptForRealDebrid(const AccountState& account, const RealDebridStatus& rdStatus, bool dismissed);
admin::Account ParseAdminAccount(const nlohmann::json& body);
std::optional<admin::MailSettings> ParseMailStatus(const nlohmann::json& body);
bool AllowsRoute(const AccountState& state, const std::string& route);

// The native renderer shares the existing account/billing service. Requests
// carrying session credentials stay on the local Core and never follow redirects.
class Client {
public:
    Client(paths::fs::path dataDir, unsigned port = 7345, http::Transport transport = http::Send);
    nlohmann::json Call(const std::string& path, const std::string& method = "GET",
                        const nlohmann::json& body = nullptr) const;
    std::string Subtitle(const std::string& url) const;
    AccountState Status() const;
    AccountState SignIn(const std::string& email, const std::string& password);
    void Register(const std::string& email, const std::string& password, const std::string& name,
                  const std::string& inviteCode = "");
    void SignOut();
    TermsDocument Terms() const;
    TiersDocument Tiers() const;
    AccountState AcceptTerms();
    void SendVerificationEmail();
    AccountState VerifyEmailCode(const std::string& code);
    std::string RecordPlanChoice(const std::string& tierId, const std::string& cadence) const;
    const std::string& origin() const { return origin_; }
    unsigned port() const { return port_; }
    const paths::fs::path& dataDir() const { return dataDir_; }
private:
    void SaveToken(const std::string& token);
    paths::fs::path dataDir_;
    std::string origin_;
    unsigned port_;
    http::Transport transport_;
    mutable std::mutex mutex_;
    std::string token_;
};

}  // namespace tvm::coreapi
