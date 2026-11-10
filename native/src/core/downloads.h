#pragma once

#include <filesystem>
#include <string>

namespace tvm::downloads {

// Windows device names and illegal filename characters follow the Electron
// downloader's rules. The title is a name, never a path.
std::wstring SafeName(const std::string& title);

// Reserve an unused output name atomically. Existing files, including pending
// downloads, are never overwritten. The caller removes its reservation on failure.
std::filesystem::path Reserve(const std::filesystem::path& requested);

}  // namespace tvm::downloads
