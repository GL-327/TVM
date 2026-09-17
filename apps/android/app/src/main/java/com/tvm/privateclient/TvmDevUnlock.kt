package com.tvm.privateclient

import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Developer unlock on the phone.
 *
 * The phone builds used to refuse this outright — "available on the desktop
 * Core, not on this phone app" — so a developer code was never actually
 * universal. This verifies the shared code locally, so every build answers the
 * same way.
 *
 * PBKDF2-HMAC-SHA256 rather than the desktop Core's scrypt for one practical
 * reason: scrypt is not in the Android platform libraries, so checking a scrypt
 * digest here would have meant vendoring a crypto library into the app.
 * PBKDF2WithHmacSHA256 ships with the platform, which is what makes a single
 * shared credential possible across desktop, iOS and Android.
 *
 * The password itself is not in this source tree and cannot be recovered from
 * the digest. 600,000 iterations is the OWASP floor for this construction; the
 * salt is public by design, its only job being to stop one precomputed table
 * serving every install.
 */
object TvmDevUnlock {
    private val salt = byteArrayOf(
        0xf8.toByte(), 0x0d, 0x25, 0x73, 0xb5.toByte(), 0xa6.toByte(), 0x4e, 0x22,
        0xbe.toByte(), 0xac.toByte(), 0x1d, 0x51, 0x46, 0xba.toByte(), 0xa2.toByte(), 0xbc.toByte(),
    )
    private val expected = byteArrayOf(
        0x85.toByte(), 0x44, 0xf3.toByte(), 0x26, 0xd1.toByte(), 0xe3.toByte(), 0x12, 0x4d,
        0xda.toByte(), 0x16, 0x79, 0xd4.toByte(), 0xca.toByte(), 0x0d, 0x5e, 0xa4.toByte(),
        0x8a.toByte(), 0x02, 0xc8.toByte(), 0x0e, 0x32, 0x84.toByte(), 0xba.toByte(), 0xbc.toByte(),
        0x2b, 0xac.toByte(), 0xc1.toByte(), 0x11, 0x84.toByte(), 0xd4.toByte(), 0xbc.toByte(), 0x09,
    )
    private const val ITERATIONS = 600_000

    /** Byte-for-byte without an early exit, which would leak how much of a guess was right. */
    private fun constantTimeEquals(left: ByteArray, right: ByteArray): Boolean {
        if (left.size != right.size) return false
        var difference = 0
        for (index in left.indices) difference = difference or (left[index].toInt() xor right[index].toInt())
        return difference == 0
    }

    fun verify(password: String): Boolean {
        if (password.isEmpty() || password.length > 128) return false
        return try {
            val spec = PBEKeySpec(password.toCharArray(), salt, ITERATIONS, expected.size * 8)
            val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            spec.clearPassword()
            constantTimeEquals(derived, expected)
        } catch (error: Exception) {
            false
        }
    }
}
