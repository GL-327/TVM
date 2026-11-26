package com.tvm.privateclient

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TvmWebhookTest {
    @Test fun validatesEventsWithoutCoercingStringsIntoSeconds() {
        assertNull(TvmWebhook.parseEvent(JSONObject("""{"event":"invalid","id":"tt123"}""")))
        assertNull(TvmWebhook.parseEvent(JSONObject("""{"event":"play","id":"../private"}""")))
        val event = TvmWebhook.parseEvent(JSONObject("""{"event":"pause","id":"tt123","title":" Film ","position":"12","duration":-1}"""))!!
        assertEquals("Film", event.title)
        assertNull(event.position)
        assertNull(event.duration)
    }

    @Test fun sendsGenericEventsInBackgroundWithProfileScopedDeduplication() {
        val prefs = TvmPrefs(webhookUrl = "https://example.test/hook")
        val payloads = Collections.synchronizedList(mutableListOf<JSONObject>())
        val threadNames = Collections.synchronizedList(mutableListOf<String>())
        val delivered = CountDownLatch(3)
        val caller = Thread.currentThread().name
        val webhook = TvmWebhook({ prefs }, { 1_800_000_000_000L }) { _, body ->
            payloads.add(JSONObject(body)); threadNames.add(Thread.currentThread().name); delivered.countDown()
        }
        webhook.send("one", PlaybackEventRecord("play", "tt123"))
        assertTrue(payloads.isEmpty())
        prefs.extras["webhook"] = true
        prefs.webhookUrl = null
        webhook.send("one", PlaybackEventRecord("play", "tt123"))
        assertTrue(payloads.isEmpty())
        prefs.webhookUrl = "https://example.test/hook"
        webhook.send("one", PlaybackEventRecord("play", "tt123", "Film", 12.5, 100.0))
        webhook.send("one", PlaybackEventRecord("play", "tt123"))
        webhook.send("one", PlaybackEventRecord("pause", "tt123"))
        webhook.send("two", PlaybackEventRecord("play", "tt123"))
        assertTrue(delivered.await(3, TimeUnit.SECONDS))
        assertEquals(3, payloads.size)
        assertTrue(threadNames.all { it != caller })
        val full = payloads.first { it.has("title") }
        assertEquals("play", full.getString("event"))
        assertEquals("tt123", full.getString("id"))
        assertEquals(12.5, full.getDouble("position"), 0.0)
        assertTrue(full.has("at"))
    }

    @Test fun discordPayloadDisablesMentions() {
        val prefs = TvmPrefs(webhookUrl = "https://discord.com/api/webhooks/123/test").apply { extras["webhook"] = true }
        val delivered = CountDownLatch(1)
        var payload: JSONObject? = null
        TvmWebhook({ prefs }, sender = { _, body -> payload = JSONObject(body); delivered.countDown() })
            .send("profile", PlaybackEventRecord("finish", "tt123", "Film"))
        assertTrue(delivered.await(3, TimeUnit.SECONDS))
        assertEquals("Finished Film", payload!!.getString("content"))
        assertEquals(0, payload!!.getJSONObject("allowed_mentions").getJSONArray("parse").length())
        assertFalse(payload!!.has("event"))
    }
}
