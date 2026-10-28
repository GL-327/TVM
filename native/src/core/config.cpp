#include "core/config.h"

#include <stdexcept>

namespace tvm::config {

namespace {

std::optional<std::string> RawValue(const util::EnvLookup& env, const wchar_t* name) {
    const std::optional<std::wstring> value = env(name);
    if (!value) return std::nullopt;
    return util::ToUtf8(*value);
}

}  // namespace

bool IsIPv4(const std::string& text) {
    // Four dot-separated parts, each one to three digits with a value of 255
    // or less. Leading zeros are allowed, as the Node pattern allowed them.
    std::size_t parts = 0;
    std::size_t start = 0;
    while (true) {
        const std::size_t dot = text.find('.', start);
        const std::string part = text.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
        if (part.empty() || part.size() > 3) return false;
        int value = 0;
        for (char c : part) {
            if (c < '0' || c > '9') return false;
            value = value * 10 + (c - '0');
        }
        if (value > 255) return false;
        ++parts;
        if (dot == std::string::npos) break;
        start = dot + 1;
    }
    return parts == 4;
}

std::uint16_t ResolvePort(const util::EnvLookup& env) {
    const std::optional<std::string> raw = RawValue(env, L"TVM_CORE_PORT");
    if (!raw) return kDefaultCorePort;
    const std::string trimmed = util::Trim(*raw);
    if (trimmed.empty()) return kDefaultCorePort;

    // Decimal digits only. A stray character or a fraction is rejected rather
    // than silently rounded, so a typo never moves Core to another port.
    std::size_t index = 0;
    if (trimmed[0] == '+') index = 1;
    bool valid = index < trimmed.size();
    long value = 0;
    for (std::size_t i = index; valid && i < trimmed.size(); ++i) {
        if (trimmed[i] < '0' || trimmed[i] > '9') {
            valid = false;
            break;
        }
        value = value * 10 + (trimmed[i] - '0');
        if (value > 65535) valid = false;
    }
    if (!valid) {
        throw std::runtime_error("TVM_CORE_PORT must be a port number between 0 and 65535, received: " + *raw);
    }
    return static_cast<std::uint16_t>(value);
}

std::string ResolveBindHost(const util::EnvLookup& env) {
    const std::optional<std::string> raw = RawValue(env, L"TVM_CORE_BIND");
    if (!raw) return kCoreHost;
    const std::string host = util::Trim(*raw);
    if (host.empty()) return kCoreHost;
    if (host == kCoreHost || host == "0.0.0.0" || IsIPv4(host)) return host;
    throw std::runtime_error("TVM_CORE_BIND must be 127.0.0.1, 0.0.0.0, or an IPv4 address, received: " + *raw);
}

}  // namespace tvm::config
