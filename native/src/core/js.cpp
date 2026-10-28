#include "core/js.h"

#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>

#include "core/util.h"

namespace tvm::js {

namespace {

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

bool IsUnreserved(unsigned char c) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return true;
    switch (c) {
    case '-':
    case '_':
    case '.':
    case '!':
    case '~':
    case '*':
    case '\'':
    case '(':
    case ')':
        return true;
    default:
        return false;
    }
}

}  // namespace

double Number(const nlohmann::json* value) {
    if (value == nullptr || value->is_null()) return kNaN;
    if (value->is_number()) return value->get<double>();
    if (value->is_boolean()) return value->get<bool>() ? 1.0 : 0.0;
    if (!value->is_string()) return kNaN;

    const std::string text = Trim(value->get<std::string>());
    if (text.empty()) return 0.0;
    char* end = nullptr;
    const double parsed = std::strtod(text.c_str(), &end);
    if (end == nullptr || *end != '\0') return kNaN;
    return parsed;
}

std::string NumberToString(double value) {
    if (!std::isfinite(value)) return std::isnan(value) ? "NaN" : (value > 0 ? "Infinity" : "-Infinity");
    if (value == std::trunc(value) && std::fabs(value) < 1e21) {
        // Whole numbers print without a fraction, as JavaScript prints them.
        char buffer[32];
        const auto result = std::to_chars(buffer, buffer + sizeof(buffer), static_cast<long long>(value));
        return std::string(buffer, result.ptr);
    }
    char buffer[64];
    const auto result = std::to_chars(buffer, buffer + sizeof(buffer), value);
    return std::string(buffer, result.ptr);
}

std::string EncodeUriComponent(const std::string& text) {
    static constexpr char kHex[] = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : text) {
        if (IsUnreserved(c)) {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(kHex[c >> 4]);
            out.push_back(kHex[c & 0x0F]);
        }
    }
    return out;
}

std::string Trim(const std::string& text) {
    return util::Trim(text);
}

int HueFor(const std::string& text) {
    // JavaScript walks code points and reads charCodeAt(0) of each one. For a
    // character outside the Basic Multilingual Plane that is the high surrogate.
    std::uint32_t hash = 0;
    for (std::size_t i = 0; i < text.size();) {
        const auto lead = static_cast<unsigned char>(text[i]);
        std::uint32_t codePoint = 0;
        std::size_t length = 1;
        if (lead < 0x80) {
            codePoint = lead;
        } else if ((lead & 0xE0) == 0xC0 && i + 1 < text.size()) {
            codePoint = ((lead & 0x1Fu) << 6) | (static_cast<unsigned char>(text[i + 1]) & 0x3Fu);
            length = 2;
        } else if ((lead & 0xF0) == 0xE0 && i + 2 < text.size()) {
            codePoint = ((lead & 0x0Fu) << 12) | ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 6) |
                        (static_cast<unsigned char>(text[i + 2]) & 0x3Fu);
            length = 3;
        } else if ((lead & 0xF8) == 0xF0 && i + 3 < text.size()) {
            codePoint = ((lead & 0x07u) << 18) | ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 12) |
                        ((static_cast<unsigned char>(text[i + 2]) & 0x3Fu) << 6) |
                        (static_cast<unsigned char>(text[i + 3]) & 0x3Fu);
            length = 4;
        } else {
            codePoint = 0xFFFD;
        }
        i += length;

        std::uint32_t unit = codePoint;
        if (codePoint > 0xFFFF) unit = 0xD800 + ((codePoint - 0x10000) >> 10);
        hash = hash * 31u + unit;  // Unsigned wrap matches JavaScript's `>>> 0`.
    }
    return static_cast<int>(hash % 360u);
}

}  // namespace tvm::js
