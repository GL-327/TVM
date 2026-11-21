package com.tvm.privateclient

import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The developer code, checked on the phone. It is one code for the desktop,
 * iPhone and Android: the same PBKDF2-HMAC-SHA256 salt and digest are in
 * apps/core/src/providers/devUnlock.ts and TVMDevUnlock.swift, and a test
 * checks they match. The code itself is not in this repository.
 */
object TvmDevUnlock {
    private val salt = byteArrayOf(
        0x27, 0xd2.toByte(), 0xbd.toByte(), 0x86.toByte(), 0xac.toByte(), 0x0e, 0xd4.toByte(), 0x2e,
        0xaf.toByte(), 0x21, 0xac.toByte(), 0x57, 0x44, 0xbc.toByte(), 0xb4.toByte(), 0xe3.toByte(),
    )
    private val expected = byteArrayOf(
        0x45, 0xd0.toByte(), 0x72, 0x77, 0x54, 0x74, 0xc4.toByte(), 0x0a,
        0x8c.toByte(), 0x97.toByte(), 0xc4.toByte(), 0x32, 0x9c.toByte(), 0xdf.toByte(), 0x0a, 0xd6.toByte(),
        0x5e, 0xa2.toByte(), 0x88.toByte(), 0x4a, 0x9b.toByte(), 0x8a.toByte(), 0x51, 0x2f,
        0xe2.toByte(), 0x15, 0xb8.toByte(), 0x53, 0xbe.toByte(), 0xe7.toByte(), 0xcf.toByte(), 0xac.toByte(),
    )
    private const val ITERATIONS = 600_000

    /** Byte-for-byte without an early exit, which would leak how much of a guess was right. */
    private fun constantTimeEquals(left: ByteArray, right: ByteArray): Boolean {
        if (left.size != right.size) return false
        var difference = 0
        for (index in left.indices) difference = difference or (left[index].toInt() xor right[index].toInt())
        return difference == 0
    }

    /**
     * Surrounding space is dropped first. A phone keyboard adds one easily,
     * and "that code is not valid" for a space looks the same as a wrong code.
     */
    fun verify(password: String): Boolean {
        val code = password.trim()
        if (code.isEmpty() || code.length > 128) return false
        return try {
            val spec = PBEKeySpec(code.toCharArray(), salt, ITERATIONS, expected.size * 8)
            val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            spec.clearPassword()
            constantTimeEquals(derived, expected)
        } catch (error: Exception) {
            false
        }
    }
}
