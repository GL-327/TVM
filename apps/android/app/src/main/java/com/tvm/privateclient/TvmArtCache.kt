package com.tvm.privateclient

import java.io.File
import java.security.MessageDigest

/**
 * Posters and backdrops kept on the phone.
 *
 * Every picture the interface shows comes through the loopback core's
 * `/api/art`, which used to fetch it from the provider again each time it was
 * drawn, and the response was marked no-store, so the WebView could not keep
 * it either. Scrolling a rail back and forth meant downloading and decoding
 * the same posters over and over. Pictures are now kept here, keyed by their
 * source URL, and served with a long cache lifetime so the WebView's own
 * memory and disk cache can reuse them as well.
 *
 * Bounded by size; the least recently used files go first.
 */
class TvmArtCache(private val dir: File, private val maxBytes: Long = DEFAULT_MAX_BYTES) {
    private val lock = Any()

    fun get(src: String): Pair<String, ByteArray>? {
        val key = key(src)
        val data = File(dir, "$key.img")
        val type = File(dir, "$key.type")
        return synchronized(lock) {
            if (!data.isFile || !type.isFile) return null
            runCatching {
                data.setLastModified(System.currentTimeMillis())
                type.readText() to data.readBytes()
            }.getOrNull()
        }
    }

    fun put(src: String, type: String, bytes: ByteArray) {
        if (bytes.isEmpty() || bytes.size > MAX_ITEM_BYTES || !type.startsWith("image/")) return
        val key = key(src)
        synchronized(lock) {
            runCatching {
                dir.mkdirs()
                val tmp = File(dir, "$key.tmp")
                tmp.writeBytes(bytes)
                File(dir, "$key.type").writeText(type)
                tmp.renameTo(File(dir, "$key.img"))
                prune()
            }
        }
    }

    /** Oldest first until the folder is back under its limit. */
    private fun prune() {
        val files = dir.listFiles { file -> file.name.endsWith(".img") } ?: return
        var total = files.sumOf { it.length() }
        if (total <= maxBytes) return
        for (file in files.sortedBy { it.lastModified() }) {
            if (total <= maxBytes * 8 / 10) break
            total -= file.length()
            file.delete()
            File(dir, file.name.removeSuffix(".img") + ".type").delete()
        }
    }

    companion object {
        const val DEFAULT_MAX_BYTES = 160L * 1024 * 1024
        const val MAX_ITEM_BYTES = 8 * 1024 * 1024
        /** What the WebView is told: keep a picture for a week. */
        const val CACHE_CONTROL = "public, max-age=604800, immutable"

        fun key(src: String): String =
            MessageDigest.getInstance("SHA-256").digest(src.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}
