#include "core/secrets.h"

#include <string_view>
#include <system_error>

#include "core/util.h"
#include "core/vault.h"

namespace tvm::secrets {

namespace {

constexpr std::string_view kSecretPrefix = "tvm-secret-v1:";

// The master key lives beside the secrets folder, so the vault root is the
// data directory itself. A secret placed anywhere else uses its own folder.
paths::fs::path SecretRoot(const paths::fs::path& path) {
    const paths::fs::path parent = path.parent_path();
    if (parent.filename() == L"secrets") return parent.parent_path();
    return parent;
}

}  // namespace

std::optional<std::string> ReadSecret(const paths::fs::path& path) {
    const std::optional<std::string> text = util::ReadTextFile(path);
    if (!text) return std::nullopt;
    const std::string value = util::Trim(util::StripBom(*text));
    if (value.empty()) return std::nullopt;

    try {
        if (value.rfind(kSecretPrefix, 0) == 0) {
            const std::optional<nlohmann::json> clear =
                vault::OpenJson(SecretRoot(path), value.substr(kSecretPrefix.size()));
            if (clear && clear->is_string() && !clear->get<std::string>().empty()) {
                return clear->get<std::string>();
            }
            return std::nullopt;
        }

        // A legacy plain secret: seal it in place so it is never left readable.
        WriteSecret(path, value);
        return value;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

bool HasSecretFile(const paths::fs::path& path) {
    std::error_code ignored;
    return paths::fs::exists(path, ignored);
}

void WriteSecret(const paths::fs::path& path, const std::string& value) {
    const std::string sealed = vault::SealJson(SecretRoot(path), nlohmann::json(value));
    util::WriteFileAtomically(path, std::string(kSecretPrefix) + sealed);
}

void DeleteSecret(const paths::fs::path& path) {
    std::error_code ignored;
    paths::fs::remove(path, ignored);
}

std::optional<nlohmann::json> ReadPrivateJson(const paths::fs::path& dataDir, const paths::fs::path& path) {
    const std::optional<nlohmann::json> sealed = vault::ReadSealed(dataDir, path);
    if (sealed && !sealed->is_null()) return sealed;

    try {
        const std::optional<std::string> text = util::ReadTextFile(path);
        if (!text) return std::nullopt;
        const std::string trimmed = util::Trim(util::StripBom(*text));
        if (trimmed.empty() || (trimmed[0] != '{' && trimmed[0] != '[')) return std::nullopt;

        nlohmann::json value = nlohmann::json::parse(trimmed, nullptr, false);
        if (value.is_discarded()) return std::nullopt;

        vault::WriteSealed(dataDir, path, value);
        return value;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

}  // namespace tvm::secrets
