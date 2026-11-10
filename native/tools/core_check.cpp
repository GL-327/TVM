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
        const auto runtime = client.Call("/api/desktop/runtime");
        if (runtime.value("protocol", 0) != 1) throw std::runtime_error("Unexpected Core protocol.");
        std::puts("Native Core startup and signed-out account gate passed.");
        return 0;
    } catch (const std::exception& e) { std::fprintf(stderr, "%s\n", e.what()); return 1; }
}
