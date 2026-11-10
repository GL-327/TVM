// Checks the actual packaged sidecar without opening the desktop window.
#include "core/core_client.h"
#include "platform/core_host.h"
#include <cstdio>
#include <stdexcept>
#include <cstdlib>

int main(int argc, char** argv) {
    if (argc != 3) { std::fprintf(stderr, "Usage: tvm_core_check DATA_DIR PORT\n"); return 2; }
    try {
        tvm::coreapi::Client client(std::filesystem::path(argv[1]), static_cast<unsigned>(std::strtoul(argv[2], nullptr, 10)));
        tvm::platform::EnsureCore(client);
        const auto account = client.Status();
        if (account.signedIn || account.usable) throw std::runtime_error("Smoke check requires a fresh data directory.");
        if (account.canSendEmail) throw std::runtime_error("Smoke check requires an unconfigured mail service.");
        const auto runtime = client.Call("/api/desktop/runtime");
        if (runtime.value("protocol", 0) != 1) throw std::runtime_error("Unexpected Core protocol.");
        const auto update = client.Call("/api/update/status");
        if (update.value("install", std::string()) != "package" || !update.contains("currentCommit") || !update["currentCommit"].is_string())
            throw std::runtime_error("Packaged Core is missing its verified update build identity.");
        client.Register("native-fixture@example.invalid", "native fixture password", "Native fixture");
        const auto member = client.SignIn("native-fixture@example.invalid", "native fixture password");
        if (!member.signedIn || member.usable || member.developer || member.liveTv)
            throw std::runtime_error("New native accounts must remain gated until activated.");
        client.Call("/api/account/terms", "POST", nlohmann::json::object());
        if (client.Status().usable) throw std::runtime_error("Terms must not activate a new account.");
        client.SignOut();
        if (client.Status().signedIn) throw std::runtime_error("Native sign-out did not revoke its session.");
        std::puts("Native Core startup, account registration/sign-in/terms/sign-out and access gate passed.");
        return 0;
    } catch (const std::exception& e) { std::fprintf(stderr, "%s\n", e.what()); return 1; }
}
