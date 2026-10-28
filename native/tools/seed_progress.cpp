// tvm-seed-progress: writes watch progress into a scratch data folder, so the
// Continue watching shelf can be checked on screen before playback is ported.
// It refuses the viewer's own data folder, and writes nothing else.
//
// Usage: tvm-seed-progress <scratch-folder> <id> <position-seconds> <duration-seconds> [<id> <position> <duration> ...]

#include <windows.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <system_error>

#include "catalog/progress.h"
#include "core/paths.h"
#include "core/util.h"

namespace {

namespace fs = std::filesystem;

}  // namespace

int main(int argc, char** argv) {
    if (argc < 5 || (argc - 2) % 3 != 0) {
        std::fprintf(stderr, "usage: tvm-seed-progress <scratch-folder> <id> <position> <duration> [...]\n");
        return 2;
    }

    const fs::path folder = fs::path(tvm::util::ToWide(argv[1]));
    const fs::path viewer = tvm::paths::ResolveDataDir(tvm::util::ProcessEnvironment());
    std::error_code ignored;
    if (fs::exists(viewer, ignored) && fs::exists(folder, ignored) && fs::equivalent(folder, viewer, ignored)) {
        std::fprintf(stderr, "refusing to write to the viewer's own data folder\n");
        return 2;
    }
    fs::create_directories(folder);

    for (int i = 2; i + 2 < argc; i += 3) {
        const std::string id = argv[i];
        const double position = std::strtod(argv[i + 1], nullptr);
        const double duration = std::strtod(argv[i + 2], nullptr);
        tvm::catalog::WriteProgress(folder, id, position, duration);
        std::printf("seeded %s at %.0f of %.0f seconds\n", id.c_str(), position, duration);
    }
    return 0;
}
