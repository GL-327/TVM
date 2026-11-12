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
        0xff, 0x00, 0xd1, 0x9a, 0x49, 0xba, 0xc7, 0x18,
        0x67, 0x61, 0x67, 0xcc, 0x32, 0x59, 0x9b, 0x88,
    ]
    private static let expected: [UInt8] = [
        0x52, 0x0f, 0x9e, 0x3a, 0xad, 0x67, 0x1d, 0xec,
        0x8b, 0x28, 0x79, 0x88, 0x77, 0xf2, 0x96, 0x6e,
        0xb1, 0x97, 0xfd, 0x7d, 0xf5, 0xe1, 0xc0, 0xa4,
        0x92, 0xdb, 0x2d, 0xcb, 0x42, 0x8e, 0xb4, 0xff,
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

    /// Surrounding space is dropped first. A phone keyboard adds one easily,
    /// and "that code is not valid" for a space looks the same as a wrong code.
    static func verify(_ password: String) -> Bool {
        let code = password.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, code.count <= 128 else { return false }
        guard let passwordData = code.data(using: .utf8) else { return false }

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
