#pragma once

// Files shipped beside the app, such as the TVM mark that the intro draws. A picture is named with the
// prefix "asset:" in front of its file name, so a drawing call can ask for it as it asks for a web address.

#include <optional>
#include <string>

#include "core/paths.h"

namespace tvm::platform {

inline constexpr char kAssetPrefix[] = "asset:";

// The file of an asset, named without its prefix. It is looked for in the `assets` folder beside the
// executable, and then one folder up, where the build puts the executable. Nothing when it is not there.
std::optional<paths::fs::path> AssetFile(const std::string& name);

}  // namespace tvm::platform
