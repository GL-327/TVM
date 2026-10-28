#include "core/util.h"

#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <format>
#include <fstream>
#include <iterator>
#include <random>
#include <stdexcept>

namespace tvm::util {

namespace {

constexpr std::string_view kAsciiWhitespace = " \t\r\n\v\f";

constexpr std::string_view kBase64Alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int Base64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
}

std::wstring RandomHex(std::size_t digits) {
    static constexpr std::array<wchar_t, 16> kDigits = {
        L'0', L'1', L'2', L'3', L'4', L'5', L'6', L'7',
        L'8', L'9', L'a', L'b', L'c', L'd', L'e', L'f'};
    std::wstring out;
    out.reserve(digits);
    for (std::uint8_t byte : RandomBytes((digits + 1) / 2)) {
        out.push_back(kDigits[byte >> 4]);
        out.push_back(kDigits[byte & 0x0F]);
    }
    out.resize(digits);
    return out;
}

}  // namespace

EnvLookup ProcessEnvironment() {
    return [](const std::wstring& name) -> std::optional<std::wstring> {
        const DWORD needed = GetEnvironmentVariableW(name.c_str(), nullptr, 0);
        if (needed == 0) return std::nullopt;
        std::wstring value(needed, L'\0');
        const DWORD written = GetEnvironmentVariableW(name.c_str(), value.data(), needed);
        if (written == 0) return std::nullopt;
        value.resize(written);
        return value;
    };
}

std::wstring ToWide(const std::string& utf8) {
    if (utf8.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    if (size <= 0) throw std::runtime_error("invalid UTF-8 text");
    std::wstring wide(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), size);
    return wide;
}

std::string ToUtf8(const std::wstring& wide) {
    if (wide.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) throw std::runtime_error("invalid UTF-16 text");
    std::string utf8(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), size, nullptr, nullptr);
    return utf8;
}

std::string Trim(const std::string& text) {
    const auto first = text.find_first_not_of(kAsciiWhitespace);
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(kAsciiWhitespace);
    return text.substr(first, last - first + 1);
}

std::string StripBom(const std::string& text) {
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF) {
        return text.substr(3);
    }
    return text;
}

std::string FormEncode(const std::string& text) {
    std::string encoded;
    for (const char character : text) {
        const auto c = static_cast<unsigned char>(character);
        const bool alnum = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
        if (alnum || c == '*' || c == '-' || c == '.' || c == '_') {
            encoded += character;
        } else if (c == ' ') {
            encoded += '+';
        } else {
            encoded += std::format("%{:02X}", static_cast<unsigned>(c));
        }
    }
    return encoded;
}

std::string Base64Encode(const Bytes& bytes) {
    std::string out;
    out.reserve(((bytes.size() + 2) / 3) * 4);
    std::size_t i = 0;
    for (; i + 2 < bytes.size(); i += 3) {
        const std::uint32_t chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out.push_back(kBase64Alphabet[(chunk >> 18) & 0x3F]);
        out.push_back(kBase64Alphabet[(chunk >> 12) & 0x3F]);
        out.push_back(kBase64Alphabet[(chunk >> 6) & 0x3F]);
        out.push_back(kBase64Alphabet[chunk & 0x3F]);
    }
    const std::size_t remaining = bytes.size() - i;
    if (remaining == 1) {
        const std::uint32_t chunk = bytes[i] << 16;
        out.push_back(kBase64Alphabet[(chunk >> 18) & 0x3F]);
        out.push_back(kBase64Alphabet[(chunk >> 12) & 0x3F]);
        out += "==";
    } else if (remaining == 2) {
        const std::uint32_t chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out.push_back(kBase64Alphabet[(chunk >> 18) & 0x3F]);
        out.push_back(kBase64Alphabet[(chunk >> 12) & 0x3F]);
        out.push_back(kBase64Alphabet[(chunk >> 6) & 0x3F]);
        out.push_back('=');
    }
    return out;
}

Bytes Base64Decode(const std::string& text) {
    Bytes out;
    out.reserve((text.size() * 3) / 4);
    std::uint32_t buffer = 0;
    int bits = 0;
    for (char c : text) {
        if (c == '=') break;
        const int value = Base64Value(c);
        if (value < 0) continue;
        buffer = (buffer << 6) | static_cast<std::uint32_t>(value);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<std::uint8_t>((buffer >> bits) & 0xFF));
        }
    }
    return out;
}

Bytes Concat(std::initializer_list<const Bytes*> parts) {
    Bytes out;
    for (const Bytes* part : parts) {
        out.insert(out.end(), part->begin(), part->end());
    }
    return out;
}

Bytes ToBytes(const std::string& text) {
    return Bytes(text.begin(), text.end());
}

std::string ToString(const Bytes& bytes) {
    return std::string(bytes.begin(), bytes.end());
}

std::optional<std::string> ReadTextFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (in.bad()) return std::nullopt;
    return content;
}

void WriteFileAtomically(const std::filesystem::path& path, const std::string& content) {
    std::filesystem::create_directories(path.parent_path());

    const std::filesystem::path temporary = path.wstring() + L"." + RandomHex(16) + L".tmp";
    HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        throw std::runtime_error("could not create a temporary file next to " + ToUtf8(path.wstring()));
    }

    std::size_t offset = 0;
    while (offset < content.size()) {
        DWORD chunk = 0;
        const DWORD want = static_cast<DWORD>(std::min<std::size_t>(content.size() - offset, 1 << 20));
        if (!WriteFile(file, content.data() + offset, want, &chunk, nullptr) || chunk == 0) break;
        offset += chunk;
    }
    const bool written = offset == content.size() && FlushFileBuffers(file);
    CloseHandle(file);

    if (!written) {
        DeleteFileW(temporary.c_str());
        throw std::runtime_error("could not write " + ToUtf8(path.wstring()));
    }

    if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(temporary.c_str());
        throw std::runtime_error("could not replace " + ToUtf8(path.wstring()));
    }
}

Bytes RandomBytes(std::size_t count) {
    Bytes out(count);
    if (count == 0) return out;
    const NTSTATUS status = BCryptGenRandom(nullptr, out.data(), static_cast<ULONG>(count),
                                            BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (!BCRYPT_SUCCESS(status)) throw std::runtime_error("operating system random source failed");
    return out;
}

std::string IsoTimestamp() {
    SYSTEMTIME now{};
    GetSystemTime(&now);
    char text[32];
    std::snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", static_cast<unsigned>(now.wYear),
                  static_cast<unsigned>(now.wMonth), static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour),
                  static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond),
                  static_cast<unsigned>(now.wMilliseconds));
    return text;
}

}  // namespace tvm::util
