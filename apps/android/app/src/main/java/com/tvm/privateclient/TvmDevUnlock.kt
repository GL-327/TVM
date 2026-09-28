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
        0x73, 0x18, 0xf8.toByte(), 0x16, 0x72, 0x54, 0x13, 0x7f,
        0xe7.toByte(), 0x4c, 0xa4.toByte(), 0xb6.toByte(), 0x68, 0x2c, 0x1a, 0xaa.toByte(),
    )
    private val expected = byteArrayOf(
        0x8e.toByte(), 0x14, 0x4e, 0xd5.toByte(), 0x29, 0x28, 0x9b.toByte(), 0x3b,
        0x61, 0x7e, 0x50, 0xee.toByte(), 0x6c, 0x4f, 0x0f, 0xfb.toByte(),
        0x3e, 0x98.toByte(), 0x90.toByte(), 0xa1.toByte(), 0xbb.toByte(), 0xd2.toByte(), 0x24, 0xfb.toByte(),
        0x2a, 0x33, 0x9c.toByte(), 0xac.toByte(), 0x7a, 0xaa.toByte(), 0xbc.toByte(), 0xa2.toByte(),
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
