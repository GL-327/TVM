#pragma once

#include <mutex>
#include <string>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include "core/http.h"
#include "core/paths.h"

namespace tvm::coreapi {

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
    std::string reason = "no_account";
    std::string name, email, tier, termsVersion;
};

AccountState ParseAccount(const nlohmann::json& body);
bool AllowsRoute(const AccountState& state, const std::string& route);

// The native renderer shares the existing account/billing service. Requests
// carrying session credentials stay on the local Core and never follow redirects.
class Client {
public:
    Client(paths::fs::path dataDir, unsigned port = 7345, http::Transport transport = http::Send);
    nlohmann::json Call(const std::string& path, const std::string& method = "GET",
                        const nlohmann::json& body = nullptr) const;
    AccountState Status() const;
    AccountState SignIn(const std::string& email, const std::string& password);
    AccountState SignInDev(const std::string& code);
    void Register(const std::string& email, const std::string& password, const std::string& name);
    void SignOut();
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
