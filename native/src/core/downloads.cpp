#include "core/downloads.h"

#include <windows.h>

#include <cwctype>
#include <stdexcept>
#include <string_view>

#include "core/util.h"

namespace tvm::downloads {

std::wstring SafeName(const std::string& title) {
    std::wstring name = util::ToWide(title);
    for (wchar_t& c : name) {
        if (c < 0x20 || std::wstring_view(L"<>:\"/\\|?*").find(c) != std::wstring_view::npos) c = L'_';
    }
    while (!name.empty() && (name.back() == L' ' || name.back() == L'.')) name.pop_back();
    if (name.size() > 150) {
        name.resize(150);
        // Do not cut a UTF-16 surrogate pair in half.
        if (name.back() >= 0xD800 && name.back() <= 0xDBFF) name.pop_back();
    }
    std::wstring base = name.substr(0, name.find(L'.'));
    for (wchar_t& c : base) c = static_cast<wchar_t>(std::towlower(c));
    const bool numbered = base.size() == 4 && (base.substr(0, 3) == L"com" || base.substr(0, 3) == L"lpt") &&
                          base[3] >= L'0' && base[3] <= L'9';
    if (name.empty() || base == L"con" || base == L"prn" || base == L"aux" || base == L"nul" || numbered)
        name = L"TVM-" + (name.empty() ? std::wstring(L"video") : name);
    return name;
}

std::filesystem::path Reserve(const std::filesystem::path& requested) {
    const auto folder = requested.parent_path();
    std::filesystem::create_directories(folder);
    const auto stem = requested.stem().wstring();
    const auto ext = requested.extension().wstring();
    for (unsigned suffix = 0; suffix < 10000; ++suffix) {
        const auto file = folder / (stem + (suffix == 0 ? L"" : L" (" + std::to_wstring(suffix) + L")") + ext);
        HANDLE handle = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (handle != INVALID_HANDLE_VALUE) {
            CloseHandle(handle);
            return file;
        }
        if (GetLastError() != ERROR_FILE_EXISTS && GetLastError() != ERROR_ALREADY_EXISTS)
            throw std::runtime_error("The download folder is not writable.");
    }
    throw std::runtime_error("Too many downloads have the same name.");
}

}  // namespace tvm::downloads
