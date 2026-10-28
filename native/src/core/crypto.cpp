#include "core/crypto.h"

#include <windows.h>
#include <bcrypt.h>
#include <dpapi.h>

#include <stdexcept>

namespace tvm::crypto {

util::Bytes Pbkdf2Sha256(const std::string& password, const util::Bytes& salt, unsigned long iterations,
                         std::size_t length) {
    BCRYPT_ALG_HANDLE hmac = nullptr;
    if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&hmac, BCRYPT_SHA256_ALGORITHM, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG))) {
        throw std::runtime_error("could not open HMAC-SHA256");
    }
    util::Bytes derived(length);
    const NTSTATUS status = BCryptDeriveKeyPBKDF2(
        hmac, reinterpret_cast<PUCHAR>(const_cast<char*>(password.data())), static_cast<ULONG>(password.size()),
        const_cast<PUCHAR>(salt.data()), static_cast<ULONG>(salt.size()), iterations, derived.data(),
        static_cast<ULONG>(derived.size()), 0);
    BCryptCloseAlgorithmProvider(hmac, 0);
    if (!BCRYPT_SUCCESS(status)) throw std::runtime_error("could not derive the key");
    return derived;
}

bool ConstantTimeEqual(const util::Bytes& left, const util::Bytes& right) {
    if (left.size() != right.size()) return false;
    unsigned char difference = 0;
    for (std::size_t i = 0; i < left.size(); ++i) difference |= static_cast<unsigned char>(left[i] ^ right[i]);
    return difference == 0;
}

namespace {

constexpr std::size_t kKeyBytes = 32;
constexpr std::size_t kIvBytes = 12;
constexpr std::size_t kTagBytes = 16;

void Check(NTSTATUS status, const char* what) {
    if (!BCRYPT_SUCCESS(status)) throw std::runtime_error(what);
}

// Owns the BCrypt handles for one AES-GCM key and releases them in order.
class GcmKey {
public:
    explicit GcmKey(const util::Bytes& key) {
        if (key.size() != kKeyBytes) throw std::runtime_error("AES-256 requires a 32-byte key");

        Check(BCryptOpenAlgorithmProvider(&algorithm_, BCRYPT_AES_ALGORITHM, nullptr, 0),
              "could not open AES");
        Check(BCryptSetProperty(algorithm_, BCRYPT_CHAINING_MODE,
                                reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
                                sizeof(BCRYPT_CHAIN_MODE_GCM), 0),
              "could not select GCM mode");

        DWORD objectBytes = 0;
        DWORD resultBytes = 0;
        Check(BCryptGetProperty(algorithm_, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes),
                                sizeof(objectBytes), &resultBytes, 0),
              "could not size the AES key");
        keyObject_.resize(objectBytes);
        Check(BCryptGenerateSymmetricKey(algorithm_, &handle_, keyObject_.data(), objectBytes,
                                         const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0),
              "could not create the AES key");
    }

    ~GcmKey() {
        if (handle_) BCryptDestroyKey(handle_);
        if (algorithm_) BCryptCloseAlgorithmProvider(algorithm_, 0);
    }

    GcmKey(const GcmKey&) = delete;
    GcmKey& operator=(const GcmKey&) = delete;

    BCRYPT_KEY_HANDLE handle() const { return handle_; }

private:
    BCRYPT_ALG_HANDLE algorithm_ = nullptr;
    BCRYPT_KEY_HANDLE handle_ = nullptr;
    util::Bytes keyObject_;
};

BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO AuthInfo(util::Bytes& iv, util::Bytes& tag) {
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = iv.data();
    info.cbNonce = static_cast<ULONG>(iv.size());
    info.pbTag = tag.data();
    info.cbTag = static_cast<ULONG>(tag.size());
    return info;
}

}  // namespace

util::Bytes ProtectForUser(const util::Bytes& plain) {
    DATA_BLOB input{};
    input.cbData = static_cast<DWORD>(plain.size());
    input.pbData = const_cast<BYTE*>(plain.data());

    DATA_BLOB output{};
    if (!CryptProtectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        throw std::runtime_error("DPAPI could not protect the master key");
    }
    util::Bytes result(output.pbData, output.pbData + output.cbData);
    LocalFree(output.pbData);
    return result;
}

std::optional<util::Bytes> UnprotectForUser(const util::Bytes& blob) {
    DATA_BLOB input{};
    input.cbData = static_cast<DWORD>(blob.size());
    input.pbData = const_cast<BYTE*>(blob.data());

    DATA_BLOB output{};
    if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        return std::nullopt;
    }
    util::Bytes result(output.pbData, output.pbData + output.cbData);
    LocalFree(output.pbData);
    return result;
}

util::Bytes AesGcmEncrypt(const util::Bytes& key, const util::Bytes& iv,
                          const util::Bytes& plain, util::Bytes& tagOut) {
    if (iv.size() != kIvBytes) throw std::runtime_error("AES-GCM requires a 12-byte IV");

    GcmKey gcm(key);
    util::Bytes ivCopy = iv;
    tagOut.assign(kTagBytes, 0);
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info = AuthInfo(ivCopy, tagOut);

    util::Bytes cipher(plain.size());
    ULONG written = 0;
    Check(BCryptEncrypt(gcm.handle(), const_cast<PUCHAR>(plain.data()), static_cast<ULONG>(plain.size()),
                        &info, nullptr, 0, cipher.data(), static_cast<ULONG>(cipher.size()), &written, 0),
          "AES-GCM encryption failed");
    cipher.resize(written);
    return cipher;
}

std::optional<util::Bytes> AesGcmDecrypt(const util::Bytes& key, const util::Bytes& iv,
                                         const util::Bytes& tag, const util::Bytes& cipher) {
    if (iv.size() != kIvBytes || tag.size() != kTagBytes) return std::nullopt;

    GcmKey gcm(key);
    util::Bytes ivCopy = iv;
    util::Bytes tagCopy = tag;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info = AuthInfo(ivCopy, tagCopy);

    util::Bytes plain(cipher.size());
    ULONG written = 0;
    const NTSTATUS status = BCryptDecrypt(gcm.handle(), const_cast<PUCHAR>(cipher.data()),
                                          static_cast<ULONG>(cipher.size()), &info, nullptr, 0,
                                          plain.data(), static_cast<ULONG>(plain.size()), &written, 0);
    if (!BCRYPT_SUCCESS(status)) return std::nullopt;
    plain.resize(written);
    return plain;
}

}  // namespace tvm::crypto
