package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Instant
import java.util.Locale
import kotlin.concurrent.thread

data class PlaybackEventRecord(
    val event: String,
    val id: String,
    val title: String? = null,
    val position: Double? = null,
    val duration: Double? = null,
)

/**
 * Sends playback lifecycle events to the user's webhook URL when enabled.
 * Mirrors apps/core/src/providers/playbackWebhook.ts.
 */
class TvmWebhook(
    private val readPrefs: () -> TvmPrefs,
    private val now: () -> Long = System::currentTimeMillis,
    private val sender: (String, String) -> Unit = ::defaultPost,
) {
    private val lock = Any()
    private val recent = LinkedHashMap<String, Long>()
    private var pending = 0

    fun send(scope: String, event: PlaybackEventRecord) {
        val prefs = readPrefs()
        if (prefs.extras["webhook"] != true) return
        val rawUrl = prefs.webhookUrl ?: return
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return
        val scheme = uri.scheme?.lowercase(Locale.US)
        if ((scheme != "http" && scheme != "https") || uri.host.isNullOrEmpty() || uri.userInfo != null) return

        val key = "${scope}\u0000${event.id}\u0000${event.event}"
        val ts = now()
        val cooldown = if (event.event == "finish") 8_000L else 1_000L
        synchronized(lock) {
            if (pending >= 8) return
            val last = recent[key]
            if (last != null && ts - last < cooldown) return
            while (recent.size >= 256) {
                val oldest = recent.keys.firstOrNull() ?: break
                recent.remove(oldest)
            }
            recent[key] = ts
            pending += 1
        }

        val host = uri.host.orEmpty()
        val path = uri.rawPath.orEmpty()
        val isDiscord = DISCORD_HOST_RE.matches(host) && DISCORD_PATH_RE.containsMatchIn(path)
        val payload = if (isDiscord) {
            val verb = when (event.event) {
                "play" -> "Playing"
                "pause" -> "Paused"
                "stop" -> "Stopped"
                else -> "Finished"
            }
            JSONObject().apply {
                put("content", "$verb ${event.title ?: event.id}")
                put("allowed_mentions", Json.obj("parse" to JSONArray()))
            }
        } else {
            JSONObject().apply {
                put("event", event.event)
                put("id", event.id)
                event.title?.let { put("title", it) }
                event.position?.let { put("position", it) }
                event.duration?.let { put("duration", it) }
                put("at", Instant.ofEpochMilli(ts).toString())
            }
        }
        val body = payload.toString()
        val href = uri.toString()
        thread(name = "tvm-webhook", isDaemon = true) {
            try {
                sender(href, body)
            } catch (_: Throwable) {
                // Best-effort delivery; never disrupt playback.
            } finally {
                synchronized(lock) { pending = maxOf(0, pending - 1) }
            }
        }
    }

    companion object {
        private val VALID_EVENTS = setOf("play", "pause", "stop", "finish")
        private val PROGRESS_ID_RE = Regex("^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,511}$")
        private val FORBIDDEN_IDS = setOf("constructor", "prototype", "__proto__")
        private val DISCORD_HOST_RE = Regex("^(?:(?:canary|ptb)\\.)?discord(?:app)?\\.com$", RegexOption.IGNORE_CASE)
        private val DISCORD_PATH_RE = Regex("^/api(?:/v\\d+)?/webhooks/")

        fun isValidProgressId(raw: String?): Boolean {
            if (raw == null || raw.length > 512) return false
            if (raw in FORBIDDEN_IDS) return false
            return PROGRESS_ID_RE.matches(raw)
        }

        fun parseEvent(json: JSONObject): PlaybackEventRecord? {
            val event = json.opt("event") as? String ?: return null
            if (event !in VALID_EVENTS) return null
            val id = json.opt("id") as? String ?: return null
            if (!isValidProgressId(id)) return null
            val title = (json.opt("title") as? String)?.trim()?.take(300)?.ifEmpty { null }
            val pos = (json.opt("position") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0.0 }
            val dur = (json.opt("duration") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0.0 }
            return PlaybackEventRecord(event = event, id = id, title = title, position = pos, duration = dur)
        }

        private fun defaultPost(url: String, body: String) {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.instanceFollowRedirects = false
                conn.connectTimeout = 5_000
                conn.readTimeout = 5_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                runCatching { (if (code in 200..299) conn.inputStream else conn.errorStream)?.close() }
            } finally {
                conn.disconnect()
            }
        }
    }
}
