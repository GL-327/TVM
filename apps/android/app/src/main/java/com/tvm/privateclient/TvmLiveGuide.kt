package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

data class GuideWindow(val now: Instant, val start: Instant, val end: Instant) {
    companion object {
        fun parse(start: String?, hours: String?, now: Instant = Instant.now()): GuideWindow? {
            return runCatching {
                val span = hours?.toDoubleOrNull() ?: if (hours == null) 3.0 else return null
                if (!span.isFinite() || span % 1 != 0.0 || span < 1 || span > 24) return null
                val begin = if (start == null) Instant.ofEpochMilli(now.toEpochMilli() / 1_800_000 * 1_800_000) else {
                    if (!Regex("^\\d{4}-\\d\\d-\\d\\dT", RegexOption.IGNORE_CASE).containsMatchIn(start)) return null
                    runCatching { Instant.parse(start) }.getOrElse { OffsetDateTime.parse(start).toInstant() }
                }
                GuideWindow(now, begin, begin.plusSeconds(span.toLong() * 3600))
            }.getOrNull()
        }
    }
}

/** XML is pulled one record at a time; only channels and programmes in this window survive. */
object TvmXmlTv {
    fun nameKey(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKD)
        .lowercase(Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"), "")

    fun date(value: String?): Instant? {
        return runCatching {
            val m = Regex("^(\\d{12})(\\d{2})?(?:\\s*(Z|UTC|[+-]\\d{4}))?$", RegexOption.IGNORE_CASE)
                .matchEntire(value.orEmpty()) ?: return null
            val zone = m.groupValues[3].ifEmpty { "Z" }.uppercase(Locale.ROOT)
            val offset = if (zone == "UTC") ZoneOffset.UTC else ZoneOffset.of(zone)
            LocalDateTime.parse(m.groupValues[1] + m.groupValues[2].ifEmpty { "00" }, DateTimeFormatter.ofPattern("uuuuMMddHHmmss").withResolverStyle(java.time.format.ResolverStyle.STRICT)).toInstant(offset)
        }.getOrNull()
    }

    fun window(rows: List<JSONObject>, window: GuideWindow): List<JSONObject> {
        val seen = HashSet<String>()
        val out = rows.filter {
            val start = runCatching { Instant.parse(it.text("start")) }.getOrNull()
            val end = runCatching { Instant.parse(it.text("end")) }.getOrNull()
            start != null && end != null && end > window.start && start < window.end && seen.add(start.toString())
        }.sortedBy { it.text("start") }
        return out.ifEmpty { listOf(Json.obj("start" to window.start.toString(), "end" to window.end.toString(), "title" to "No guide information")) }
    }

    fun match(schedule: Map<String, List<JSONObject>>, id: String, name: String): List<JSONObject> =
        schedule["id:${id.lowercase(Locale.ROOT)}"] ?: schedule["name:${nameKey(name)}"] ?: emptyList()

    fun parse(input: InputStream, wants: List<Pair<String, String>>, window: GuideWindow): Map<String, List<JSONObject>> {
        val buffered = input.buffered()
        buffered.mark(2)
        val gzip = buffered.read() == 0x1f && buffered.read() == 0x8b
        buffered.reset()
        val decoded = if (gzip) GZIPInputStream(buffered) else buffered
        val limited = object : FilterInputStream(decoded) {
            var count = 0L
            override fun read(): Int = super.read().also { if (it >= 0) { count++; check(count <= 256L * 1024 * 1024) } }
            override fun read(b: ByteArray, off: Int, len: Int): Int = `in`.read(b, off, len).also { if (it > 0) { count += it; check(count <= 256L * 1024 * 1024) } }
        }
        try {
            val parser = XmlPullParserFactory.newInstance().newPullParser()
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            parser.setInput(limited, null)
            val ids = wants.map { it.first.lowercase(Locale.ROOT) }.filter { it.isNotEmpty() }.toSet()
            val names = wants.map { nameKey(it.second) }.filter { it.isNotEmpty() }.toSet()
            val aliases = HashMap<String, String>()
            val rows = HashMap<String, MutableList<JSONObject>>()
            var channel = ""
            var programme: JSONObject? = null
            var record = ""
            var field = ""
            var value = StringBuilder()
            var valid = false
            var count = 0
            while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                when (parser.eventType) {
                    XmlPullParser.DOCDECL -> check(!parser.text.orEmpty().contains('[')) { "XMLTV entity declarations are not supported" }
                    XmlPullParser.START_TAG -> when (parser.name) {
                        "tv" -> valid = true
                        "channel" -> { record = "channel"; channel = parser.getAttributeValue(null, "id").orEmpty().lowercase(Locale.ROOT) }
                        "programme" -> {
                            record = "programme"
                            channel = parser.getAttributeValue(null, "channel").orEmpty().lowercase(Locale.ROOT)
                            val start = date(parser.getAttributeValue(null, "start"))
                            val end = date(parser.getAttributeValue(null, "stop"))
                            programme = if ((channel in ids || channel in aliases.values) && start != null && end != null && start < end && end > window.start && start < window.end)
                                Json.obj("start" to start.toString(), "end" to end.toString()) else null
                        }
                        "display-name", "title", "sub-title", "desc", "category", "episode-num" -> { field = parser.name; value = StringBuilder() }
                        "icon" -> parser.getAttributeValue(null, "src")?.takeIf { safeUrl(it) }?.let { programme?.put("image", it) }
                    }
                    XmlPullParser.TEXT, XmlPullParser.CDSECT, XmlPullParser.ENTITY_REF -> if (field.isNotEmpty() && value.length < 6000) value.append(parser.text.orEmpty().take(6000 - value.length))
                    XmlPullParser.END_TAG -> {
                        if (parser.name == field) {
                            val text = value.toString().replace(Regex("\\s+"), " ").trim()
                            if (record == "channel" && field == "display-name" && nameKey(text) in names) aliases.putIfAbsent(nameKey(text), channel)
                            val key = mapOf("title" to "title", "sub-title" to "subtitle", "desc" to "description", "category" to "category", "episode-num" to "episode")[field]
                            if (record == "programme" && key != null && text.isNotEmpty() && programme?.has(key) == false) programme?.put(key, text)
                            field = ""
                        }
                        if (parser.name == "programme") {
                            programme?.takeIf { it.has("title") }?.let {
                                check(++count <= 150_000)
                                rows.getOrPut("id:$channel") { mutableListOf() }.add(it)
                            }
                            programme = null; record = ""
                        }
                        if (parser.name == "channel") record = ""
                    }
                }
                parser.nextToken()
            }
            check(valid)
            for ((name, id) in aliases) rows["id:$id"]?.let { rows["name:$name"] = it }
            return rows
        } finally { limited.close() }
    }

    fun safeUrl(value: String): Boolean = runCatching { val uri = URI(value); uri.scheme in listOf("http", "https") && !uri.host.isNullOrEmpty() && uri.userInfo == null }.getOrDefault(false)

    fun xtream(payload: JSONObject, window: GuideWindow): List<JSONObject> {
        val list = payload.optJSONArray("epg_listings") ?: return emptyList()
        fun time(row: JSONObject, stamp: String, fallback: String): Instant? {
            val unix = Json.double(row.opt(stamp)) ?: row.text(stamp).toDoubleOrNull()
            if (unix != null && unix.isFinite() && unix > 0 && unix < 1e12) return Instant.ofEpochMilli((unix * 1000).toLong())
            val raw = row.text(fallback).replace(' ', 'T')
            return runCatching { Instant.parse(if (Regex("Z|[+-]\\d{2}:?\\d{2}$").containsMatchIn(raw)) raw else raw + "Z") }.getOrNull()
        }
        fun text(raw: String): String {
            val clean = raw.trim()
            val decoded = if (clean.length % 4 == 0 && Regex("^[A-Za-z0-9+/]+={0,2}$").matches(clean)) runCatching { String(Base64.getDecoder().decode(clean), Charsets.UTF_8) }.getOrNull() else null
            return (decoded?.takeIf { it.isNotEmpty() && '\uFFFD' !in it && it.none { c -> c.code < 32 || c.code == 127 } } ?: clean).take(6000)
        }
        return (0 until minOf(list.length(), 100)).mapNotNull { i ->
            val row = list.optJSONObject(i) ?: return@mapNotNull null
            val start = time(row, "start_timestamp", "start") ?: return@mapNotNull null
            val end = time(row, if (row.has("stop_timestamp")) "stop_timestamp" else "end_timestamp", if (row.has("end")) "end" else "stop") ?: return@mapNotNull null
            val title = text(row.text("title"))
            if (title.isEmpty() || start >= end || end <= window.start || start >= window.end) return@mapNotNull null
            Json.obj("start" to start.toString(), "end" to end.toString(), "title" to title).apply { text(row.text("description")).takeIf { it.isNotEmpty() }?.let { put("description", it) } }
        }
    }
}

/** A cold or failed source yields placeholders immediately. Downloads never run on the route thread. */
class TvmLiveGuide(private val directory: File) {
    private val executor = Executors.newFixedThreadPool(4) { runnable -> Thread(runnable, "tvm-guide").apply { isDaemon = true } }
    private val refreshing = HashSet<String>()
    private val retry = HashMap<String, Long>()

    @Synchronized private fun snapshot(key: String, download: () -> Map<String, List<JSONObject>>): Map<String, List<JSONObject>> {
        val id = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(directory, "$id.json")
        val cached = runCatching { JSONObject(file.readText()) }.getOrNull()
        val now = System.currentTimeMillis()
        if ((cached == null || now - cached.optLong("at") >= 6 * 3600_000L) && refreshing.size < 64 && id !in refreshing && now >= (retry[id] ?: 0)) {
            refreshing.add(id)
            executor.execute {
                try {
                    val rows = download()
                    val json = JSONObject()
                    rows.forEach { (k, v) -> json.put(k, Json.array(v)) }
                    directory.mkdirs()
                    val temp = File.createTempFile("guide-", ".tmp", directory)
                    try { temp.writeText(Json.obj("at" to System.currentTimeMillis(), "matches" to json).toString()); check(temp.renameTo(file)) } finally { temp.delete() }
                    // Window keys are bounded on disk too, as the timeline moves forward.
                    directory.listFiles { f -> f.extension == "json" }?.sortedByDescending { it.lastModified() }?.drop(128)?.forEach { it.delete() }
                } catch (_: Exception) {
                    synchronized(this) { if (retry.size >= 256) retry.clear(); retry[id] = System.currentTimeMillis() + 60_000 }
                } finally { synchronized(this) { refreshing.remove(id) } }
            }
        }
        val matches = cached?.optJSONObject("matches") ?: return emptyMap()
        return matches.keys().asSequence().associateWith { k -> val list = matches.optJSONArray(k) ?: JSONArray(); (0 until list.length()).mapNotNull { list.optJSONObject(it) } }
    }

    private fun <T> fetch(raw: String, consume: (InputStream) -> T): T {
        require(TvmXmlTv.safeUrl(raw))
        val conn = URL(raw).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000; conn.readTimeout = 30_000
            conn.instanceFollowRedirects = true
            check(conn.responseCode in 200..299)
            return conn.inputStream.use(consume)
        } finally { conn.disconnect() }
    }

    fun guide(window: GuideWindow, group: String?, free: JSONObject?, iptv: List<JSONObject>, urls: List<String>, host: String?, user: String?, password: String?): JSONObject {
        val channels = mutableListOf<JSONObject>()
        val freeRows = free?.optJSONArray("channels") ?: JSONArray()
        val feeds = free?.optJSONArray("epgFeeds") ?: JSONArray()
        val schedules = HashMap<String, Map<String, List<JSONObject>>>()
        fun xml(url: String, wants: List<Pair<String, String>>): Map<String, List<JSONObject>> = snapshot("xml-v1|$url|${window.start}|${window.end}|$wants") { fetch(url) { TvmXmlTv.parse(it, wants, window) } }
        for (i in 0 until minOf(feeds.length(), 12)) {
            val feed = feeds.optJSONObject(i) ?: continue
            val wants = (0 until freeRows.length()).mapNotNull { freeRows.optJSONObject(it) }.filter { it.text("epgFeed") == feed.text("id") }.map { it.text("epgId") to it.text("name") }
            if (wants.isNotEmpty()) schedules[feed.text("id")] = xml(feed.text("url"), wants)
        }
        fun add(row: JSONObject, id: String, number: Int, source: String, programmes: List<JSONObject>) {
            channels.add(Json.obj("id" to id, "number" to number, "name" to row.text("name"), "logo" to row.text("logo").takeIf { TvmXmlTv.safeUrl(it) }, "group" to row.text("group", "Other"), "source" to source, "programmes" to Json.array(TvmXmlTv.window(programmes, window))))
        }
        for (i in 0 until freeRows.length()) {
            val row = freeRows.optJSONObject(i) ?: continue
            add(row, "live:free:${row.text("id")}", row.optInt("number", i + 1), "free", TvmXmlTv.match(schedules[row.text("epgFeed")] ?: emptyMap(), row.text("epgId"), row.text("name")))
        }
        val wants = iptv.map { it.text("epgId") to it.text("name") }
        val xtream = !host.isNullOrEmpty() && !user.isNullOrEmpty() && password != null
        fun endpoint(file: String): String = host.orEmpty().trimEnd('/') + "/$file?username=" + URLEncoder.encode(user, "UTF-8") + "&password=" + URLEncoder.encode(password, "UTF-8")
        val provider = (if (xtream) listOf(endpoint("xmltv.php")) else urls).take(12).map { xml(it, wants) }
        var fallbackCount = 0
        for (row in iptv) {
            var programmes = provider.asSequence().map { TvmXmlTv.match(it, row.text("epgId"), row.text("name")) }.firstOrNull { it.isNotEmpty() } ?: emptyList()
            if (programmes.isEmpty() && xtream && (group.isNullOrEmpty() || row.text("group") == group) && fallbackCount++ < 48) {
                val streamId = runCatching { URI(row.text("url")).path.substringAfterLast('/').substringBefore('.') }.getOrDefault("")
                if (streamId.all { it.isDigit() } && streamId.isNotEmpty()) {
                    val url = endpoint("player_api.php") + "&action=get_short_epg&stream_id=$streamId&limit=24"
                    programmes = snapshot("short|$url|${window.start}|${window.end}") { mapOf("rows" to fetch(url) { TvmXmlTv.xtream(JSONObject(it.bufferedReader().readText()), window) }) }["rows"] ?: emptyList()
                }
            }
            add(row, row.text("id"), row.optInt("number", channels.size + 1), if (xtream) "xtream" else "m3u", programmes)
        }
        return Json.obj("now" to window.now.toString(), "start" to window.start.toString(), "end" to window.end.toString(), "groups" to JSONArray(channels.map { it.text("group") }.distinct()), "channels" to Json.array(channels.filter { group.isNullOrEmpty() || it.text("group") == group }), "refreshing" to synchronized(this) { refreshing.isNotEmpty() })
    }
}
