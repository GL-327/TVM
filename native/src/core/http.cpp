#include "core/http.h"

#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <cstdlib>
#include <iterator>
#include <string_view>
#include <vector>

#include "core/util.h"

namespace tvm::http {

namespace {

// Closes a WinHTTP handle when it leaves scope.
class Handle {
public:
    explicit Handle(HINTERNET handle) : handle_(handle) {}
    ~Handle() {
        if (handle_ != nullptr) WinHttpCloseHandle(handle_);
    }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HINTERNET get() const { return handle_; }
    explicit operator bool() const { return handle_ != nullptr; }

private:
    HINTERNET handle_;
};

// A header line break would let a value add headers of its own, so such a value is refused.
bool HeaderIsSafe(const std::string& text) {
    return text.find_first_of("\r\n") == std::string::npos;
}

// The header block WinHTTP takes: one "Name: value" line per header, each ended by CRLF.
std::optional<std::wstring> HeaderBlock(const Options& options) {
    std::string block = "Accept: " + options.accept + "\r\n";
    for (const auto& [name, value] : options.headers) {
        if (name.empty() || !HeaderIsSafe(name) || !HeaderIsSafe(value)) return std::nullopt;
        block += name + ": " + value + "\r\n";
    }
    return util::ToWide(block);
}

// One response header as UTF-8, or empty when the response has none.
std::string TextHeader(HINTERNET request, DWORD query) {
    DWORD size = 0;
    WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER, &size,
                        WINHTTP_NO_HEADER_INDEX);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) return {};
    std::wstring value(size / sizeof(wchar_t), L'\0');
    if (!WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size,
                             WINHTTP_NO_HEADER_INDEX)) {
        return {};
    }
    value.resize(size / sizeof(wchar_t));
    return util::ToUtf8(value);
}

}  // namespace

bool IsWebUrl(const std::string& url) {
    return url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0;
}

std::optional<Response> Send(const std::string& url, const Options& options) {
    if (!IsWebUrl(url)) return std::nullopt;

    const std::wstring wideUrl = util::ToWide(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256]{};
    wchar_t path[4096]{};
    parts.lpszHostName = host;
    parts.dwHostNameLength = static_cast<DWORD>(std::size(host));
    parts.lpszUrlPath = path;
    parts.dwUrlPathLength = static_cast<DWORD>(std::size(path));
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &parts)) return std::nullopt;

    const std::optional<std::wstring> headers = HeaderBlock(options);
    if (!headers) return std::nullopt;

    const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;
    const std::wstring agent = util::ToWide(options.userAgent);
    Handle session(WinHttpOpen(agent.c_str(), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                               WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) return std::nullopt;

    const auto timeout = static_cast<int>(options.timeoutMs);
    WinHttpSetTimeouts(session.get(), timeout, timeout, timeout, timeout);

    Handle connection(WinHttpConnect(session.get(), host, parts.nPort, 0));
    if (!connection) return std::nullopt;

    const std::wstring method = util::ToWide(options.method);
    const DWORD flags = WINHTTP_FLAG_REFRESH | (secure ? WINHTTP_FLAG_SECURE : 0);
    Handle request(WinHttpOpenRequest(connection.get(), method.c_str(), path, nullptr, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
    if (!request) return std::nullopt;

    // Servers may compress; WinHTTP decodes gzip and deflate for us.
    DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
    WinHttpSetOption(request.get(), WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));
    if (!options.followRedirects) {
        DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        WinHttpSetOption(request.get(), WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof(policy));
    }

    const LPVOID body = options.body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(options.body.data());
    const auto bodySize = static_cast<DWORD>(options.body.size());
    if (!WinHttpSendRequest(request.get(), headers->c_str(), static_cast<DWORD>(headers->size()), body, bodySize,
                            bodySize, 0)) {
        return std::nullopt;
    }
    if (!WinHttpReceiveResponse(request.get(), nullptr)) return std::nullopt;

    Response response;
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                             &status, &statusSize, WINHTTP_NO_HEADER_INDEX)) {
        return std::nullopt;
    }
    response.status = status;
    response.contentType = TextHeader(request.get(), WINHTTP_QUERY_CONTENT_TYPE);
    if (!options.followRedirects && status >= 300 && status < 400) {
        response.location = TextHeader(request.get(), WINHTTP_QUERY_LOCATION);
        return response;
    }

    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request.get(), &available)) return std::nullopt;
        if (available == 0) break;
        if (response.body.size() + available > options.maxBytes) return std::nullopt;

        const std::size_t offset = response.body.size();
        response.body.resize(offset + available);
        DWORD read = 0;
        if (!WinHttpReadData(request.get(), response.body.data() + offset, available, &read)) return std::nullopt;
        response.body.resize(offset + read);
        if (read == 0) break;
    }
    return response;
}

DownloadResult Download(const std::string& url, const std::filesystem::path& file,
                        const std::function<bool(unsigned long long, unsigned long long)>& progress, unsigned timeoutMs) {
    DownloadResult result;
    if (!IsWebUrl(url)) return result;
    const std::wstring wideUrl = util::ToWide(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256]{};
    std::wstring path(8192, L'\0');
    parts.lpszHostName = host;
    parts.dwHostNameLength = static_cast<DWORD>(std::size(host));
    parts.lpszUrlPath = path.data();
    parts.dwUrlPathLength = static_cast<DWORD>(path.size());
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &parts)) return result;

    Handle session(WinHttpOpen(L"tvm-core", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                               WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) return result;
    const auto timeout = static_cast<int>(timeoutMs);
    WinHttpSetTimeouts(session.get(), timeout, timeout, timeout, timeout);
    Handle connection(WinHttpConnect(session.get(), host, parts.nPort, 0));
    if (!connection) return result;
    const DWORD flags = WINHTTP_FLAG_REFRESH | (parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    Handle request(WinHttpOpenRequest(connection.get(), L"GET", parts.lpszUrlPath, nullptr, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
    if (!request) return result;
    if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request.get(), nullptr)) {
        return result;
    }
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                        &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    result.status = status;
    if (status < 200 || status >= 300) return result;
    const std::string length = TextHeader(request.get(), WINHTTP_QUERY_CONTENT_LENGTH);
    const unsigned long long total = length.empty() ? 0ULL : std::strtoull(length.c_str(), nullptr, 10);

    // Written beside the target and moved into place once it is whole, so a stopped download leaves nothing.
    std::error_code ignored;
    std::filesystem::create_directories(file.parent_path(), ignored);
    const std::filesystem::path partial = file.wstring() + L".part";
    HANDLE out = CreateFileW(partial.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (out == INVALID_HANDLE_VALUE) {
        result.status = 0;
        return result;
    }
    std::vector<char> buffer(1 << 20);
    bool failed = false;
    for (;;) {
        DWORD read = 0;
        if (!WinHttpReadData(request.get(), buffer.data(), static_cast<DWORD>(buffer.size()), &read)) {
            failed = true;
            break;
        }
        if (read == 0) break;
        DWORD written = 0;
        if (!WriteFile(out, buffer.data(), read, &written, nullptr) || written != read) {
            failed = true;
            break;
        }
        result.bytes += read;
        if (progress && !progress(result.bytes, total)) {
            result.cancelled = true;
            break;
        }
    }
    CloseHandle(out);
    if (failed || result.cancelled || (total > 0 && result.bytes < total)) {
        std::filesystem::remove(partial, ignored);
        if (failed) result.status = 0;
        return result;
    }
    std::filesystem::rename(partial, file, ignored);
    if (ignored) result.status = 0;
    return result;
}

PeekResult Peek(const std::string& url, std::size_t maxBytes, unsigned timeoutMs) {
    PeekResult result;
    const auto fail = [&](const char* what) {
        if (GetLastError() == ERROR_WINHTTP_TIMEOUT) result.timedOut = true;
        else result.networkError = what;
        return result;
    };
    if (!IsWebUrl(url)) {
        result.networkError = "not a web address";
        return result;
    }
    const std::wstring wideUrl = util::ToWide(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256]{};
    std::wstring path(8192, L'\0');
    parts.lpszHostName = host;
    parts.dwHostNameLength = static_cast<DWORD>(std::size(host));
    parts.lpszUrlPath = path.data();
    parts.dwUrlPathLength = static_cast<DWORD>(path.size());
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &parts)) return fail("bad address");
    // A player's agent, as the web player sends one: some panels refuse an unknown client.
    Handle session(WinHttpOpen(L"VLC/3.0.20 LibVLC/3.0.20", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                               WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) return fail("no session");
    const auto timeout = static_cast<int>(timeoutMs);
    WinHttpSetTimeouts(session.get(), timeout, timeout, timeout, timeout);
    Handle connection(WinHttpConnect(session.get(), host, parts.nPort, 0));
    if (!connection) return fail("connection failed");
    const DWORD flags = WINHTTP_FLAG_REFRESH | (parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    Handle request(WinHttpOpenRequest(connection.get(), L"GET", parts.lpszUrlPath, nullptr, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
    if (!request) return fail("request failed");
    if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
        return fail("connection refused");
    }
    if (!WinHttpReceiveResponse(request.get(), nullptr)) return fail("no response");
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                        &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    result.status = status;
    result.contentType = TextHeader(request.get(), WINHTTP_QUERY_CONTENT_TYPE);
    std::vector<char> buffer(16384);
    while (result.head.size() < maxBytes) {
        DWORD read = 0;
        const DWORD want = static_cast<DWORD>(std::min(buffer.size(), maxBytes - result.head.size()));
        if (!WinHttpReadData(request.get(), buffer.data(), want, &read)) {
            // Bytes already in hand are an answer; a stall before any is a channel that is not broadcasting.
            if (result.head.empty() && GetLastError() == ERROR_WINHTTP_TIMEOUT) result.timedOut = true;
            break;
        }
        if (read == 0) break;
        result.head.append(buffer.data(), read);
    }
    return result;
}

std::optional<Response> Get(const std::string& url, const Options& options) {
    Options get = options;
    get.method = "GET";
    get.body.clear();
    return Send(url, get);
}

}  // namespace tvm::http
