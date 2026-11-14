package com.tvm.privateclient

import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore

/**
 * Posters and backdrops for the WebView, fetched by the app itself.
 *
 * The interface asks the image hosts directly. A Search page asks for about
 * forty posters at once; those that failed (a host refusing a burst with 429,
 * a slow answer, a dropped connection) were never asked for again: the
 * interface shows its title card for good after one error. Here each host gets
 * a few requests at a time, a refused or failed request is tried again after a
 * short wait, pictures are kept on the phone, and only a picture the host truly
 * does not have (404, after trying metahub's other sizes) is reported missing.
 */
class TvmImages(
    private val cache: TvmArtCache?,
    private val fetch: (String) -> Fetched = ::httpFetch,
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
) {
    /** One answer from a host: status (-1 for a failed connection), type and bytes. */
    class Fetched(val status: Int, val type: String?, val data: ByteArray?, val retryAfterMs: Long = 0)

    /** What the WebView is given. */
    class Picture(val status: Int, val type: String, val data: ByteArray)

    private val perHost = ConcurrentHashMap<String, Semaphore>()

    fun load(url: String): Picture {
        cache?.get(url)?.let { (type, data) -> return Picture(200, type, data) }
        var last = Fetched(404, null, null)
        for (candidate in variants(url)) {
            val got = fetchWithRetry(candidate)
            if (got.status == 200 && got.data != null && got.data.isNotEmpty()) {
                val type = got.type?.takeIf { it.startsWith("image/") } ?: "image/jpeg"
                cache?.put(url, type, got.data)
                return Picture(200, type, got.data)
            }
            last = got
            // Only "not found" is worth another size; anything else is final.
            if (got.status != 404 && got.status != 410) break
        }
        Log.w(TAG, "picture unavailable (${last.status}): ${url.take(120)}")
        return Picture(if (last.status in 400..599) last.status else 502, "text/plain", ByteArray(0))
    }

    private fun fetchWithRetry(url: String): Fetched {
        val host = runCatching { URL(url).host.lowercase(Locale.US) }.getOrDefault("")
        val gate = perHost.getOrPut(host) { Semaphore(PER_HOST) }
        var last = Fetched(-1, null, null)
        for (attempt in 0 until ATTEMPTS) {
            gate.acquireUninterruptibly()
            last = try { fetch(url) } finally { gate.release() }
            if (last.status == 200 || !retryable(last.status)) return last
            if (attempt < ATTEMPTS - 1) {
                val wait = if (last.retryAfterMs > 0) last.retryAfterMs.coerceAtMost(4_000) else BACKOFF_MS[attempt]
                sleep(wait)
            }
        }
        return last
    }

    companion object {
        private const val TAG = "TVMImages"
        const val PER_HOST = 4
        const val ATTEMPTS = 3
        private val BACKOFF_MS = longArrayOf(600, 1_800)

        /** Rate limits, server trouble and failed connections are worth another try. */
        fun retryable(status: Int): Boolean = status == -1 || status == 408 || status == 429 || status in 500..599

        /**
         * The picture asked for, then metahub's smaller sizes of the same
         * picture: some titles have a small poster but no large one.
         */
        fun variants(url: String): List<String> {
            val m = Regex("""^(https?://(?:images|live)\.metahub\.space/(?:poster|background|logo)/)(large|medium|small)(/.*)$""").find(url)
                ?: return listOf(url)
            val (prefix, size, rest) = m.destructured
            return listOf(size, "medium", "small").distinct().map { "$prefix$it$rest" }
        }

        /** Whether a WebView request is a picture this class should fetch. */
        fun handles(method: String, url: String, accept: String?): Boolean {
            if (!method.equals("GET", ignoreCase = true)) return false
            if (!url.startsWith("https://") && !url.startsWith("http://")) return false
            val host = runCatching { URL(url).host.lowercase(Locale.US) }.getOrDefault("")
            if (host.isEmpty() || host == "127.0.0.1" || host == "localhost") return false
            if (IMAGE_HOSTS.any { host == it || host.endsWith(".$it") }) return true
            return accept != null && accept.startsWith("image/")
        }

        private val IMAGE_HOSTS = listOf(
            "metahub.space", "image.tmdb.org", "media-amazon.com", "mzstatic.com",
            "tvmaze.com", "fanart.tv", "kitsu.io",
        )

        fun httpFetch(url: String): Fetched = try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000
            connection.readTimeout = 12_000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
            try {
                val status = connection.responseCode
                val retryAfter = connection.getHeaderField("Retry-After")?.trim()?.toLongOrNull()?.times(1000) ?: 0
                if (status !in 200..299) {
                    Fetched(status, null, null, retryAfter)
                } else {
                    Fetched(200, connection.contentType, connection.inputStream.use { it.readBytes() })
                }
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            Fetched(-1, null, null)
        }
    }
}
