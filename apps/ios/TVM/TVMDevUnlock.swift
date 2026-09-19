import Foundation
import CommonCrypto

/**
 The developer code, checked on the phone. It is one code for the desktop,
 iPhone and Android: the same PBKDF2-HMAC-SHA256 salt and digest are in
 apps/core/src/providers/devUnlock.ts and TvmDevUnlock.kt, and a test checks
 they match. The code itself is not in this repository.
 */
enum TVMDevUnlock {
    private static let salt: [UInt8] = [
        0x73, 0x18, 0xf8, 0x16, 0x72, 0x54, 0x13, 0x7f,
        0xe7, 0x4c, 0xa4, 0xb6, 0x68, 0x2c, 0x1a, 0xaa,
    ]
    private static let expected: [UInt8] = [
        0x8e, 0x14, 0x4e, 0xd5, 0x29, 0x28, 0x9b, 0x3b,
        0x61, 0x7e, 0x50, 0xee, 0x6c, 0x4f, 0x0f, 0xfb,
        0x3e, 0x98, 0x90, 0xa1, 0xbb, 0xd2, 0x24, 0xfb,
        0x2a, 0x33, 0x9c, 0xac, 0x7a, 0xaa, 0xbc, 0xa2,
    ]
    private static let iterations: UInt32 = 600_000

    /// Byte-for-byte in constant time: an early exit would leak how much of a
    /// guess was right.
    private static func constantTimeEqual(_ lhs: [UInt8], _ rhs: [UInt8]) -> Bool {
        guard lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for index in 0..<lhs.count { difference |= lhs[index] ^ rhs[index] }
        return difference == 0
    }

    static func verify(_ password: String) -> Bool {
        guard !password.isEmpty, password.count <= 128 else { return false }
        guard let passwordData = password.data(using: .utf8) else { return false }

        var derived = [UInt8](repeating: 0, count: expected.count)
        let status = passwordData.withUnsafeBytes { passwordBytes -> Int32 in
            guard let passwordBase = passwordBytes.bindMemory(to: Int8.self).baseAddress else {
                return Int32(kCCParamError)
            }
            return salt.withUnsafeBufferPointer { saltBuffer in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    passwordBase,
                    passwordData.count,
                    saltBuffer.baseAddress,
                    saltBuffer.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    iterations,
                    &derived,
                    derived.count
                )
            }
        }
        guard status == Int32(kCCSuccess) else { return false }
        return constantTimeEqual(derived, expected)
    }
}
