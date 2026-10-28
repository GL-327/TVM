#include "platform/assets.h"

#include <windows.h>

#include <system_error>
#include <vector>

#include "core/util.h"

namespace tvm::platform {

std::optional<paths::fs::path> AssetFile(const std::string& name) {
    wchar_t buffer[MAX_PATH] = {};
    const DWORD length = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return std::nullopt;

    const paths::fs::path exe(buffer);
    const paths::fs::path wide(util::ToWide(name));
    const std::vector<paths::fs::path> candidates{
        exe.parent_path() / L"assets" / wide,
        exe.parent_path().parent_path() / L"assets" / wide,
    };
    for (const paths::fs::path& candidate : candidates) {
        std::error_code ignored;
        if (paths::fs::is_regular_file(candidate, ignored)) return candidate;
    }
    return std::nullopt;
}

}  // namespace tvm::platform
