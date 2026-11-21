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
        0x27, 0xd2, 0xbd, 0x86, 0xac, 0x0e, 0xd4, 0x2e,
        0xaf, 0x21, 0xac, 0x57, 0x44, 0xbc, 0xb4, 0xe3,
    ]
    private static let expected: [UInt8] = [
        0x45, 0xd0, 0x72, 0x77, 0x54, 0x74, 0xc4, 0x0a,
        0x8c, 0x97, 0xc4, 0x32, 0x9c, 0xdf, 0x0a, 0xd6,
        0x5e, 0xa2, 0x88, 0x4a, 0x9b, 0x8a, 0x51, 0x2f,
        0xe2, 0x15, 0xb8, 0x53, 0xbe, 0xe7, 0xcf, 0xac,
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
