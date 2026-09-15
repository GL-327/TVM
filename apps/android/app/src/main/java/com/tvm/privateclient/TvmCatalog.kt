package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.Calendar
import java.util.Locale
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * Cinemeta browse data, cached in memory, on disk and finally in the bundle.
 *
 * Direct port of apps/ios/TVM/TVMCatalog.swift. The same `apps/ui` interface
 * reads both clients, so the shapes, defaults and fallbacks here must match the
 * Swift exactly.
 */

data class CatalogBundle(
    val moviesTop: List<MediaItem>,
    val seriesTop: List<MediaItem>,
    val moviesRated: List<MediaItem>,
    val seriesRated: List<MediaItem>,
    val recentTv: List<MediaItem>,
    val newFilms: List<MediaItem>,
    val catalog: List<MediaItem>,
)

data class TitleMeta(val item: MediaItem, val children: List<MediaItem>)

/**
 * @param store the same on-disk store the rest of the client uses; `catalog-cache.json` lives there.
 * @param loadBundled reads the bundled FallbackCatalog.json. The caller supplies it so this file
 *   stays free of android.content.Context and testable on the JVM, e.g.
 *   `{ runCatching { context.assets.open("FallbackCatalog.json").bufferedReader().use { it.readText() } }.getOrNull() }`.
 *   It is called once, from this constructor, exactly where the Swift reads the bundle resource.
 */
class TvmCatalog(
    private val store: TvmStore,
    loadBundled: () -> String? = { null },
) {
    private val lock = Any()
    private var memoryAt: Long = 0
    private var memory: CatalogBundle? = null
    private val genreMem: MutableMap<String, Pair<Long, List<MediaItem>>> = mutableMapOf()
    private val metaMem: MutableMap<String, Pair<Long, TitleMeta>> = mutableMapOf()
    private val fallback: List<MediaItem>

    init {
        val text = runCatching { loadBundled() }.getOrNull()
        val items = if (text.isNullOrEmpty()) null else Json.parseObject(text).optJSONArray("items")
        fallback = if (items == null) emptyList() else parseItems(items)
    }

    fun fallbackItems(): List<MediaItem> = fallback

    fun clear() {
        synchronized(lock) {
            memory = null
            memoryAt = 0
            genreMem.clear()
            metaMem.clear()
        }
        store.clearCacheFiles()
    }

    suspend fun bundle(): CatalogBundle {
        synchronized(lock) {
            val cached = memory
            if (cached != null && System.currentTimeMillis() - memoryAt < 12 * 60 * 1000L) return cached
        }
        val fetched: List<List<MediaItem>> = runParallel(
            listOf(
                { fetchCatalog("/catalog/movie/top.json", "movie") },
                { fetchCatalog("/catalog/series/top.json", "series") },
                { fetchCatalog("/catalog/movie/imdbRating.json", "movie") },
                { fetchCatalog("/catalog/series/imdbRating.json", "series") },
                { fetchCatalog("/catalog/series/last-videos.json", "series") },
                { fetchCatalog("/catalog/movie/top/skip=100.json", "movie") },
            ),
            emptyList(),
        )
        val moviesTop = fetched[0]
        val seriesTop = fetched[1]
        val moviesRated = fetched[2]
        val seriesRated = fetched[3]
        val recentTv = fetched[4]
        val moviesSkip = fetched[5]
        val movies = dedupe(moviesTop + moviesSkip)
        val thisYear = Calendar.getInstance().get(Calendar.YEAR)
        val data = CatalogBundle(
            moviesTop = moviesTop,
            seriesTop = seriesTop,
            moviesRated = moviesRated,
            seriesRated = seriesRated,
            recentTv = recentTv,
            newFilms = movies.filter { it.kind == "movie" && (it.year ?: 0) >= thisYear - 1 },
            catalog = dedupe(movies + seriesTop + moviesRated + seriesRated + recentTv),
        )
        if (data.catalog.isNotEmpty()) {
            synchronized(lock) {
                memory = data
                memoryAt = System.currentTimeMillis()
            }
            store.writeJSON("catalog-cache.json", encode(data))
            return data
        }
        // Use disk or bundled titles so Home still renders.
        return readDisk() ?: fallbackBundle()
    }

    suspend fun search(query: String): List<MediaItem> {
        val needle = query.trim()
        if (needle.length < 2) return emptyList()
        val encoded = Json.formEncode(needle)
        val fetched: List<List<MediaItem>> = runParallel(
            listOf(
                { fetchCatalog("/catalog/movie/top/search=$encoded.json", "movie") },
                { fetchCatalog("/catalog/series/top/search=$encoded.json", "series") },
            ),
            emptyList(),
        )
        val live = dedupe(fetched[0] + fetched[1])
        if (live.isNotEmpty()) return live
        val lower = needle.lowercase(Locale.US)
        return fallback.filter {
            it.title.lowercase(Locale.US).contains(lower) ||
                (it.showTitle ?: "").lowercase(Locale.US).contains(lower)
        }
    }

    suspend fun genre(kind: String, name: String): List<MediaItem> {
        val key = "$kind:$name"
        synchronized(lock) {
            val hit = genreMem[key]
            if (hit != null && System.currentTimeMillis() - hit.first < 20 * 60 * 1000L) return hit.second
        }
        val encoded = queryEncode(name)
        val items = fetchCatalog("/catalog/$kind/top/genre=$encoded.json", kind)
        synchronized(lock) {
            genreMem[key] = System.currentTimeMillis() to items
        }
        return items
    }

    suspend fun meta(id: String): TitleMeta? {
        val imdb = TvmTitle.extractImdb(id)
            ?: return fallback.firstOrNull { it.id == id }?.let { TitleMeta(it, emptyList()) }
        synchronized(lock) {
            val hit = metaMem[imdb]
            if (hit != null && System.currentTimeMillis() - hit.first < 30 * 60 * 1000L) return hit.second
        }
        val fetched: List<TitleMeta?> = runParallel(
            listOf(
                { readKind("movie", imdb) },
                { readKind("series", imdb) },
            ),
            null,
        )
        // A title that exists as both prefers the series, which carries episodes.
        val picked = fetched[1] ?: fetched[0]
        if (picked != null) {
            synchronized(lock) {
                metaMem[imdb] = System.currentTimeMillis() to picked
            }
        }
        return picked
    }

    private fun readKind(kind: String, imdb: String): TitleMeta? {
        val body = getObject("https://v3-cinemeta.strem.io/meta/$kind/$imdb.json", SESSION_TIMEOUT_MS) ?: return null
        val raw = body.opt("meta") as? JSONObject ?: return null
        val item = mapMeta(raw, kind) ?: return null
        val children = if (kind == "series") mapVideos(item, raw.opt("videos")) else emptyList()
        return TitleMeta(item, children)
    }

    private fun fetchCatalog(path: String, kind: String): List<MediaItem> {
        val body = getObject("https://v3-cinemeta.strem.io$path", CATALOG_TIMEOUT_MS) ?: return emptyList()
        val metas = objectList(body.opt("metas")) ?: return emptyList()
        return metas.mapNotNull { mapMeta(it, kind) }
    }

    private fun mapMeta(raw: JSONObject, kind: String): MediaItem? {
        val id = (raw.opt("id") ?: raw.opt("imdb_id") ?: "").toString()
        if (!IMDB_ID.containsMatchIn(id)) return null
        val title = trimSpaces((raw.opt("name") as? String) ?: (raw.opt("title") as? String) ?: "")
        if (title.isEmpty()) return null
        val genres = stringList(raw.opt("genre")) ?: emptyList()
        val poster = (raw.opt("poster") as? String) ?: ""
        val backdrop = (raw.opt("background") as? String) ?: (raw.opt("backdrop") as? String) ?: poster
        val runtimeRaw = raw.opt("runtime")
        val runtime: String? = when {
            runtimeRaw is String -> runtimeRaw
            runtimeRaw is Int -> "$runtimeRaw min"
            runtimeRaw is Long -> "$runtimeRaw min"
            // NSNumber bridges to Int only when the value is whole; mirror that.
            runtimeRaw is Number && runtimeRaw.toDouble() == Math.floor(runtimeRaw.toDouble()) ->
                "${runtimeRaw.toLong()} min"
            else -> null
        }
        val ratingRaw = raw.opt("imdbRating")
        return MediaItem(
            id = id.lowercase(Locale.US),
            title = title,
            year = parseYear(raw.opt("year")) ?: parseYear(raw.opt("releaseInfo")),
            kind = kind,
            synopsis = (raw.opt("description") as? String) ?: "",
            poster = poster,
            backdrop = backdrop,
            genres = genres,
            rating = if (ratingRaw == null || ratingRaw === JSONObject.NULL) "" else ratingRaw.toString(),
            runtime = runtime,
            playable = true,
            progress = null,
            filename = null,
            hue = TvmTitle.hue(title),
            mimeType = null,
            season = null,
            episode = null,
            episodeName = null,
            showTitle = title,
            aired = null,
            added = null,
        )
    }

    private fun mapVideos(show: MediaItem, videos: Any?): List<MediaItem> {
        val list = objectList(videos) ?: return emptyList()
        val mapped = list.mapNotNull { video ->
            val fromId = (video.opt("id") ?: "").toString()
            val idParts = fromId.split(":").filter { it.isNotEmpty() }
            val season = Json.int(video.opt("season") ?: video.opt("seasonNumber"))
                ?: if (idParts.size >= 3) idParts[idParts.size - 2].toIntOrNull() else null
            val episode = Json.int(video.opt("episode") ?: video.opt("number") ?: video.opt("episodeNumber"))
                ?: idParts.lastOrNull()?.toIntOrNull()
            if (season == null || episode == null || season < 1 || episode < 1) return@mapNotNull null
            val name = (video.opt("title") as? String) ?: (video.opt("name") as? String) ?: "Episode $episode"
            val thumbnail = (video.opt("thumbnail") as? String)?.ifEmpty { null } ?: show.poster
            MediaItem(
                id = "${show.id}:$season:$episode",
                title = show.title,
                year = show.year,
                kind = "series",
                synopsis = (video.opt("overview") as? String) ?: (video.opt("description") as? String) ?: "",
                poster = thumbnail,
                backdrop = show.backdrop,
                genres = show.genres,
                rating = "",
                runtime = null,
                playable = true,
                progress = null,
                filename = null,
                hue = show.hue,
                mimeType = null,
                season = season,
                episode = episode,
                episodeName = name,
                showTitle = show.title,
                aired = null,
                added = null,
            )
        }
        return mapped.sortedWith(compareBy({ it.season ?: 0 }, { it.episode ?: 0 }))
    }

    private fun parseYear(value: Any?): Int? {
        val number = Json.int(value)
        if (number != null && number > 1800) return number
        val text = value as? String ?: return null
        val match = YEAR.find(text) ?: return null
        return match.value.toIntOrNull()
    }

    private fun dedupe(items: List<MediaItem>): List<MediaItem> {
        val seen = mutableSetOf<String>()
        return items.filter { seen.add(it.id) }
    }

    private fun fallbackBundle(): CatalogBundle {
        val movies = fallback.filter { it.kind == "movie" }
        val series = fallback.filter { it.kind == "series" }
        return CatalogBundle(
            moviesTop = movies.take(16),
            seriesTop = series.take(16),
            moviesRated = movies.take(16),
            seriesRated = series.take(16),
            recentTv = series.take(16),
            newFilms = movies.filter { (it.year ?: 0) >= 2023 }.take(16),
            catalog = fallback,
        )
    }

    private fun readDisk(): CatalogBundle? {
        val root = store.readJSON("catalog-cache.json") as? JSONObject ?: return null
        val movies = root.opt("moviesTop") as? JSONArray ?: return null
        return CatalogBundle(
            moviesTop = parseItems(movies),
            seriesTop = parseItems(root.opt("seriesTop")),
            moviesRated = parseItems(root.opt("moviesRated")),
            seriesRated = parseItems(root.opt("seriesRated")),
            recentTv = parseItems(root.opt("recentTv")),
            newFilms = parseItems(root.opt("newFilms")),
            catalog = parseItems(root.opt("catalog")),
        )
    }

    private fun encode(data: CatalogBundle): JSONObject = Json.obj(
        "moviesTop" to Json.array(data.moviesTop.map { it.json() }),
        "seriesTop" to Json.array(data.seriesTop.map { it.json() }),
        "moviesRated" to Json.array(data.moviesRated.map { it.json() }),
        "seriesRated" to Json.array(data.seriesRated.map { it.json() }),
        "recentTv" to Json.array(data.recentTv.map { it.json() }),
        "newFilms" to Json.array(data.newFilms.map { it.json() }),
        "catalog" to Json.array(data.catalog.map { it.json() }),
    )

    private fun parseItems(value: Any?): List<MediaItem> {
        val array = value as? JSONArray ?: return emptyList()
        return (0 until array.length()).mapNotNull { MediaItem.parse(array.opt(it)) }
    }

    /**
     * Swift's `as? [[String: Any]]` is all-or-nothing: one non-object entry
     * discards the whole list. Keep that, or a stray element would let entries
     * through that iOS drops.
     */
    private fun objectList(value: Any?): List<JSONObject>? {
        val array = value as? JSONArray ?: return null
        val out = ArrayList<JSONObject>(array.length())
        for (index in 0 until array.length()) {
            val entry = array.opt(index) as? JSONObject ?: return null
            out.add(entry)
        }
        return out
    }

    /** Same all-or-nothing rule as above, and unlike Json.strings it keeps empty entries. */
    private fun stringList(value: Any?): List<String>? {
        val array = value as? JSONArray ?: return null
        val out = ArrayList<String>(array.length())
        for (index in 0 until array.length()) {
            val entry = array.opt(index) as? String ?: return null
            out.add(entry)
        }
        return out
    }

    /** Foundation's `.whitespaces` is spaces and tabs only, so newlines survive the trim. */
    private fun trimSpaces(value: String): String = value.trim {
        it == '\t' || Character.getType(it) == Character.SPACE_SEPARATOR.toInt()
    }

    /**
     * Matches Foundation's `.urlQueryAllowed`, which leaves sub-delimiters
     * intact: a genre such as "Action & Adventure" must reach Cinemeta with its
     * ampersand literal, exactly as iOS sends it.
     */
    private fun queryEncode(value: String): String {
        val allowed = "-._~!$&'()*+,/:;=?@"
        val out = StringBuilder()
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val code = byte.toInt() and 0xFF
            val ch = code.toChar()
            if (code < 128 && (ch.isLetterOrDigit() || allowed.indexOf(ch) >= 0)) {
                out.append(ch)
            } else {
                out.append('%').append(String.format(Locale.US, "%02X", code))
            }
        }
        return out.toString()
    }

    private fun getObject(url: String, timeoutMs: Int): JSONObject? {
        var conn: HttpURLConnection? = null
        return try {
            val opened = URI(url).toURL().openConnection() as HttpURLConnection
            conn = opened
            opened.requestMethod = "GET"
            opened.connectTimeout = timeoutMs
            opened.readTimeout = timeoutMs
            opened.useCaches = false
            val code = opened.responseCode
            if (code !in 200..299) return null
            val text = opened.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            JSONObject(text)
        } catch (error: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * The Swift fires these with `async let`. Without kotlinx-coroutines on the
     * classpath, plain daemon threads keep the same shape: six twelve-second
     * timeouts must not serialise behind one another.
     */
    private fun <T> runParallel(tasks: List<() -> T>, fallbackValue: T): List<T> {
        if (tasks.isEmpty()) return emptyList()
        val pool = Executors.newFixedThreadPool(tasks.size) { runnable ->
            Thread(runnable, "tvm-catalog").apply { isDaemon = true }
        }
        return try {
            val futures = tasks.map { task -> pool.submit(Callable<T> { task() }) }
            futures.map { future -> runCatching { future.get() }.getOrDefault(fallbackValue) }
        } finally {
            pool.shutdown()
        }
    }

    private companion object {
        const val CATALOG_TIMEOUT_MS = 12_000
        const val SESSION_TIMEOUT_MS = 20_000
        val IMDB_ID = Regex("""^tt\d+$""")
        val YEAR = Regex("""\b(19|20)\d{2}\b""")
    }
}
