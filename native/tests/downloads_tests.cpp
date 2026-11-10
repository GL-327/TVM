#include <winsock2.h>
#include <filesystem>
#include <string>
#include <thread>
#include <stdexcept>

#include "core/downloads.h"
#include "core/util.h"
#include "core/http.h"
#include "fake_network.h"
#include "harness.h"

namespace {

// A real loopback response exercises WinHTTP's truncated-body and cancellation
// behavior, which a fake provider transport cannot establish.
class DownloadServer {
public:
    explicit DownloadServer(std::string response) {
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("WSAStartup");
        listener_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (listener_ == INVALID_SOCKET || bind(listener_, reinterpret_cast<sockaddr*>(&address), static_cast<int>(sizeof(address))) != 0 ||
            listen(listener_, 1) != 0) throw std::runtime_error("loopback listener");
        int length = static_cast<int>(sizeof(address));
        if (getsockname(listener_, reinterpret_cast<sockaddr*>(&address), &length) != 0) throw std::runtime_error("loopback port");
        url_ = "http://127.0.0.1:" + std::to_string(ntohs(address.sin_port)) + "/video?token=test";
        worker_ = std::thread([this, response = std::move(response)] {
            fd_set ready;
            FD_ZERO(&ready);
            FD_SET(listener_, &ready);
            timeval timeout{10, 0};
            if (select(0, &ready, nullptr, nullptr, &timeout) <= 0) return;
            const SOCKET client = accept(listener_, nullptr, nullptr);
            if (client == INVALID_SOCKET) return;
            char request[4096];
            recv(client, request, static_cast<int>(sizeof(request)), 0);
            std::size_t offset = 0;
            while (offset < response.size()) {
                const int count = send(client, response.data() + offset, static_cast<int>(response.size() - offset), 0);
                if (count <= 0) break;
                offset += static_cast<std::size_t>(count);
            }
            shutdown(client, SD_BOTH);
            closesocket(client);
        });
    }
    ~DownloadServer() {
        if (worker_.joinable()) worker_.join();
        closesocket(listener_);
        WSACleanup();
    }
    const std::string& url() const { return url_; }
private:
    SOCKET listener_ = INVALID_SOCKET;
    std::thread worker_;
    std::string url_;
};

TEST(download_names_reject_paths_and_windows_devices) {
    using tvm::downloads::SafeName;
    REQUIRE_EQ(SafeName("../a:b?*"), std::wstring(L".._a_b__"));
    REQUIRE_EQ(SafeName("CON"), std::wstring(L"TVM-CON"));
    REQUIRE_EQ(SafeName("lpt1.mkv"), std::wstring(L"TVM-lpt1.mkv"));
    REQUIRE_EQ(SafeName("... "), std::wstring(L"TVM-video"));
    REQUIRE_EQ(SafeName("Film. "), std::wstring(L"Film"));
    REQUIRE(SafeName(std::string(300, 'x')).size() <= 150);
}

TEST(duplicate_downloads_reserve_unique_names_without_touching_existing_files) {
    tvm::testing::TempFolder folder;
    const auto original = folder.path() / L"Episode.mkv";
    tvm::util::WriteFileAtomically(original, "keep this video");
    const auto first = tvm::downloads::Reserve(original);
    const auto second = tvm::downloads::Reserve(original);
    REQUIRE_EQ(first.filename(), std::filesystem::path(L"Episode (1).mkv"));
    REQUIRE_EQ(second.filename(), std::filesystem::path(L"Episode (2).mkv"));
    REQUIRE_EQ(tvm::util::ReadTextFile(original).value_or(""), std::string("keep this video"));
    REQUIRE(std::filesystem::exists(first));
    REQUIRE(std::filesystem::exists(second));
}

TEST(http_download_keeps_existing_videos_and_reports_its_actual_output_path) {
    tvm::testing::TempFolder folder;
    const auto file = folder.path() / L"Film.mkv";
    tvm::util::WriteFileAtomically(file, "existing video");
    DownloadServer server("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef");
    const auto result = tvm::http::Download(server.url(), file, {}, 3000);
    REQUIRE(result.ok());
    REQUIRE_EQ(result.path.filename(), std::filesystem::path(L"Film (1).mkv"));
    REQUIRE_EQ(tvm::util::ReadTextFile(file).value_or(""), std::string("existing video"));
    REQUIRE_EQ(tvm::util::ReadTextFile(result.path).value_or(""), std::string("abcdef"));
}

TEST(http_download_does_not_report_a_truncated_body_as_complete) {
    tvm::testing::TempFolder folder;
    DownloadServer server("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort");
    const auto result = tvm::http::Download(server.url(), folder.path() / L"Film.mkv", {}, 3000);
    REQUIRE(!result.ok());
    REQUIRE(result.path.empty());
    REQUIRE(std::filesystem::is_empty(folder.path()));
}

TEST(http_download_cancellation_cleans_up_its_reservation_and_partial_file) {
    tvm::testing::TempFolder folder;
    DownloadServer server("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef");
    const auto result = tvm::http::Download(server.url(), folder.path() / L"Film.mkv",
        [](unsigned long long, unsigned long long) { return false; }, 3000);
    REQUIRE(result.cancelled);
    REQUIRE(!result.ok());
    REQUIRE(std::filesystem::is_empty(folder.path()));
}

}  // namespace
