#pragma once

// Test helpers for the providers: a fake network that answers from a route and records
// every request, an environment built from a map, and a folder removed afterwards.
// Nothing here reaches the internet or the viewer's data.

#include <windows.h>

#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "core/http.h"
#include "core/util.h"

namespace tvm::testing {

// A fresh folder per test, removed afterwards.
class TempFolder {
public:
    TempFolder() {
        static unsigned counter = 0;
        path_ = std::filesystem::temp_directory_path() /
                (L"tvm-provider-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
        std::filesystem::create_directories(path_);
    }
    ~TempFolder() {
        std::error_code ignored;
        std::filesystem::remove_all(path_, ignored);
    }
    const std::filesystem::path& path() const { return path_; }

private:
    std::filesystem::path path_;
};

// Records every request, and answers each one from a route.
class FakeNetwork {
public:
    struct Request {
        std::string url;
        http::Options options;
    };
    using Route = std::function<std::optional<http::Response>(const std::string& url)>;

    explicit FakeNetwork(Route route) : route_(std::move(route)) {}

    http::Transport Transport() {
        return [this](const std::string& url, const http::Options& options) {
            requests.push_back(Request{url, options});
            return route_(url);
        };
    }

    std::vector<Request> requests;

private:
    Route route_;
};

inline util::EnvLookup EnvWith(std::map<std::wstring, std::wstring> values) {
    return [values = std::move(values)](const std::wstring& name) -> std::optional<std::wstring> {
        const auto found = values.find(name);
        if (found == values.end()) return std::nullopt;
        return found->second;
    };
}

inline http::Response Answer(unsigned status, const std::string& body = "") {
    return http::Response{status, body};
}

inline std::optional<std::string> HeaderOf(const http::Options& options, const std::string& name) {
    for (const auto& [key, value] : options.headers) {
        if (key == name) return value;
    }
    return std::nullopt;
}

}  // namespace tvm::testing
