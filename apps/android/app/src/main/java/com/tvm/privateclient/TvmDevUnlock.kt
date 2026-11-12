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
        0xff.toByte(), 0x00, 0xd1.toByte(), 0x9a.toByte(), 0x49, 0xba.toByte(), 0xc7.toByte(), 0x18,
        0x67, 0x61, 0x67, 0xcc.toByte(), 0x32, 0x59, 0x9b.toByte(), 0x88.toByte(),
    )
    private val expected = byteArrayOf(
        0x52, 0x0f, 0x9e.toByte(), 0x3a, 0xad.toByte(), 0x67, 0x1d, 0xec.toByte(),
        0x8b.toByte(), 0x28, 0x79, 0x88.toByte(), 0x77, 0xf2.toByte(), 0x96.toByte(), 0x6e,
        0xb1.toByte(), 0x97.toByte(), 0xfd.toByte(), 0x7d, 0xf5.toByte(), 0xe1.toByte(), 0xc0.toByte(), 0xa4.toByte(),
        0x92.toByte(), 0xdb.toByte(), 0x2d, 0xcb.toByte(), 0x42, 0x8e.toByte(), 0xb4.toByte(), 0xff.toByte(),
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
