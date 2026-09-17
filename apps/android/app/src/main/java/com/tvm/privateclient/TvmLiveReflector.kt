package com.tvm.privateclient

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Live TV on the phone goes through the same kind of proxy as desktop Core:
 * the player is handed `/api/live/proxy/<token>`, never the provider address.
 */
class TvmLiveReflector {
    private val targets = ConcurrentHashMap<String, String>()

    fun publish(url: String): String {
        val token = UUID.randomUUID().toString().replace("-", "")
        targets[token] = url
        return "/api/live/proxy/$token"
    }

    fun serve(token: String, method: String): HttpReply {
        val upstream = targets[token] ?: return HttpReply.json(404, Json.obj("error" to "not_found"))
        return try {
            val connection = (URL(upstream).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 15_000
                readTimeout = 20_000
                requestMethod = if (method == "HEAD") "HEAD" else "GET"
                setRequestProperty("User-Agent", "VLC/3.0.21 LibVLC/3.0.21")
            }
            val status = connection.responseCode
            if (status !in 200..299 && status != 206) {
                return HttpReply.json(502, Json.obj("error" to "upstream-$status"))
            }
            val type = connection.contentType ?: ""
            val body = if (method == "HEAD") ByteArray(0) else connection.inputStream.use { it.readBytes() }
            if (looksLikePlaylist(upstream, type, body)) {
                val text = body.toString(Charsets.UTF_8)
                val rewritten = rewrite(text, upstream)
                return HttpReply.bytes(200, "application/vnd.apple.mpegurl", rewritten.toByteArray(Charsets.UTF_8))
            }
            HttpReply.bytes(if (method == "HEAD") 200 else 200, mediaType(upstream, type), body)
        } catch (_: Exception) {
            HttpReply.json(502, Json.obj("error" to "unreachable"))
        }
    }

    private fun looksLikePlaylist(url: String, type: String, body: ByteArray): Boolean {
        if (type.contains("mpegurl", ignoreCase = true)) return true
        if (url.substringBefore('?').endsWith(".m3u8", ignoreCase = true)) return true
        return body.isNotEmpty() && body[0] == '#'.code.toByte()
    }

    private fun mediaType(url: String, declared: String): String {
        val mime = declared.substringBefore(';').trim()
        if (mime.contains("mp2t", ignoreCase = true)) return "video/mp2t"
        if (mime.isNotEmpty() && !mime.contains("octet-stream", ignoreCase = true)) return mime
        val path = url.substringBefore('?').lowercase()
        if (path.endsWith(".ts") || path.endsWith(".m2ts")) return "video/mp2t"
        if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl"
        return "video/mp4"
    }

    private fun rewrite(text: String, base: String): String {
        val origin = runCatching { URI(base) }.getOrNull() ?: return text
        return text.split("\n").joinToString("\n") { line ->
            if (line.startsWith("#")) rewriteAttributes(line, origin)
            else {
                val trimmed = line.trim()
                if (trimmed.isEmpty()) line else publish(resolve(origin, trimmed) ?: trimmed)
            }
        }
    }

    private fun rewriteAttributes(line: String, base: URI): String {
        val regex = Regex("""URI="([^"]*)"""")
        return regex.replace(line) { match ->
            val uri = match.groupValues[1]
            val target = resolve(base, uri) ?: return@replace match.value
            """URI="${publish(target)}""""
        }
    }

    private fun resolve(base: URI, reference: String): String? {
        return try {
            base.resolve(reference).toString()
        } catch (_: Exception) {
            null
        }
    }
}
