#include "platform/assets.h"

#include <windows.h>

#include <mutex>
#include <system_error>
#include <unordered_map>
#include <vector>

#include "core/util.h"

namespace tvm::platform {

std::optional<paths::fs::path> AssetFile(const std::string& name) {
    static std::mutex mutex;
    static std::unordered_map<std::string, std::optional<paths::fs::path>> cache;
    {
        std::lock_guard<std::mutex> lock(mutex);
        const auto found = cache.find(name);
        if (found != cache.end()) return found->second;
    }

    wchar_t buffer[MAX_PATH] = {};
    const DWORD length = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
    std::optional<paths::fs::path> result;
    if (length > 0 && length < MAX_PATH) {
        const paths::fs::path exe(buffer);
        const paths::fs::path wide(util::ToWide(name));
        const std::vector<paths::fs::path> candidates{
            exe.parent_path() / L"assets" / wide,
            exe.parent_path().parent_path() / L"assets" / wide,
        };
        for (const paths::fs::path& candidate : candidates) {
            std::error_code ignored;
            if (paths::fs::is_regular_file(candidate, ignored)) {
                result = candidate;
                break;
            }
        }
    }

    std::lock_guard<std::mutex> lock(mutex);
    cache[name] = result;
    return result;
}

}  // namespace tvm::platform
