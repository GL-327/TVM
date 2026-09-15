import Foundation
import CommonCrypto

/**
 Developer unlock on the phone.

 The phone builds used to refuse this outright — "available on the desktop
 Core, not on this phone app" — which meant a developer code was not actually
 universal. This verifies the shared code locally so every build answers the
 same way.

 The credential is PBKDF2-HMAC-SHA256 rather than the desktop Core's scrypt for
 one practical reason: scrypt has no implementation in CryptoKit or CommonCrypto,
 so checking a scrypt digest here would have meant vendoring a crypto library
 into the app. PBKDF2 is in the system library on every platform TVM ships to,
 which is what makes one shared credential possible.

 The password itself is not in this source tree and cannot be recovered from
 the digest. 600,000 iterations is the OWASP floor for this construction.
 */
enum TVMDevUnlock {
    private static let salt: [UInt8] = [
        0xf8, 0x0d, 0x25, 0x73, 0xb5, 0xa6, 0x4e, 0x22,
        0xbe, 0xac, 0x1d, 0x51, 0x46, 0xba, 0xa2, 0xbc,
    ]
    private static let expected: [UInt8] = [
        0x15, 0xad, 0xd2, 0x2b, 0xda, 0x5d, 0x47, 0x9c,
        0xb1, 0xb3, 0xfb, 0x9c, 0xaf, 0x87, 0x4c, 0x11,
        0x2e, 0x84, 0xd5, 0x89, 0x58, 0x21, 0x64, 0x62,
        0x4b, 0x89, 0xd0, 0x0c, 0xa7, 0x9e, 0x22, 0xa7,
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
