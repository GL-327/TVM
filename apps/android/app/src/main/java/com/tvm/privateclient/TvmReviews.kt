package com.tvm.privateclient

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.math.round

data class ReviewEntry(
    val author: String,
    val stars: Double?,
    val text: String,
    val likes: Int?,
    val url: String?,
) {
    fun json(): JSONObject = Json.obj(
        "author" to author,
        "stars" to stars,
        "text" to text,
        "likes" to likes,
        "url" to url,
    )
}

data class ReviewsPayload(
    val imdbId: String,
    val imdbUrl: String,
    val rating: Double?,
    val source: String?,
    val sourceUrl: String?,
    val average: Double?,
    val reviews: List<ReviewEntry>,
) {
    fun json(): JSONObject = Json.obj(
        "imdbId" to imdbId,
        "imdbUrl" to imdbUrl,
        "rating" to rating,
        "source" to source,
        "sourceUrl" to sourceUrl,
        "average" to average,
        "reviews" to Json.array(reviews.map { it.json() }),
    )
}

class TvmReviews(
    private val itemLookup: suspend (String) -> MediaItem?,
    private val pageFetcher: suspend (String) -> Pair<String, String?> = ::fetchPageWithRedirects,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val REVIEWS_TTL_MS = 24L * 60 * 60 * 1000
        const val MAX_CACHED = 300
        const val MIN_REVIEW_LENGTH = 40
        const val MAX_REVIEW_LENGTH = 420
        const val MAX_REVIEWS = 3
        const val TIMEOUT_MS = 10_000

        val IMDB_RE = Regex("^tt\\d{5,10}$")
        private val FILM_URL_RE = Regex("^https?://(?:www\\.)?letterboxd\\.com/film/[^/?#]+/?$", RegexOption.IGNORE_CASE)
        private val ARTICLE_RE = Regex(
            "<article\\b[^>]*class=[\"'][^\"']*\\bproduction-viewing\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</article>",
            RegexOption.IGNORE_CASE,
        )
        private val META_TWITTER_DATA2_A = Regex(
            "<meta\\b[^>]*\\bname=[\"']twitter:data2[\"'][^>]*\\bcontent=[\"']([^\"']+)[\"'][^>]*>",
            RegexOption.IGNORE_CASE,
        )
        private val META_TWITTER_DATA2_B = Regex(
            "<meta\\b[^>]*\\bcontent=[\"']([^\"']+)[\"'][^>]*\\bname=[\"']twitter:data2[\"'][^>]*>",
            RegexOption.IGNORE_CASE,
        )
        private val FLOAT_RE = Regex("(\\d+(?:\\.\\d+)?)")
        private val AUTHOR_RE = Regex(
            "<strong\\b[^>]*\\bclass=[\"'][^\"']*\\b(?:displayname|name)\\b[^\"']*[\"'][^>]*>([^<]+)<",
            RegexOption.IGNORE_CASE,
        )
        private val CONTEXT_LINK_A = Regex(
            "<a\\b[^>]*\\bhref=[\"'](/[^\"']+/film/[^\"']+)[\"'][^>]*\\bclass=[\"'][^\"']*\\bcontext\\b[^\"']*[\"'][^>]*>",
            RegexOption.IGNORE_CASE,
        )
        private val CONTEXT_LINK_B = Regex(
            "<a\\b[^>]*\\bclass=[\"'][^\"']*\\bcontext\\b[^\"']*[\"'][^>]*\\bhref=[\"'](/[^\"']+/film/[^\"']+)[\"'][^>]*>",
            RegexOption.IGNORE_CASE,
        )
        private val RATING_SPAN_RE = Regex(
            "<span\\b[^>]*\\bclass=[\"']([^\"']*\\brating\\b[^\"']*)[\"'][^>]*>([\\s\\S]*?)</span>",
            RegexOption.IGNORE_CASE,
        )
        private val RATED_CLASS_RE = Regex("\\brated-(\\d+)\\b", RegexOption.IGNORE_CASE)
        private val ARIA_LABEL_RE = Regex("\\baria-label=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
        private val DATA_COUNT_RE = Regex("\\bdata-count=[\"'](\\d+)[\"']", RegexOption.IGNORE_CASE)
        private val BODY_TEXT_RE = Regex(
            "<div\\b[^>]*\\bclass=[\"'][^\"']*\\bbody-text\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</div>",
            RegexOption.IGNORE_CASE,
        )
        private val BLOCK_BREAK_RE = Regex("</?(?:p|br)\\b[^>]*>", RegexOption.IGNORE_CASE)
        private val TAG_RE = Regex("<[^>]+>")
        private val SPACE_RE = Regex("\\s+")
        private val NUMERIC_ENTITY_RE = Regex("&#(x?[0-9a-fA-F]+);")

        fun isValidImdbId(raw: String): Boolean = IMDB_RE.matches(raw.trim().lowercase(Locale.ROOT))

        fun parseLetterboxd(finalUrl: String, html: String): Triple<String?, Double?, List<ReviewEntry>> {
            val cleanUrl = finalUrl.trim()
            if (!FILM_URL_RE.matches(cleanUrl)) {
                return Triple(null, null, emptyList())
            }
            val canonicalUrl = if (cleanUrl.endsWith("/")) cleanUrl else "$cleanUrl/"
            val avgMatch = META_TWITTER_DATA2_A.find(html) ?: META_TWITTER_DATA2_B.find(html)
            val average = avgMatch?.groupValues?.getOrNull(1)?.let { content ->
                FLOAT_RE.find(content)?.groupValues?.getOrNull(1)?.toDoubleOrNull()?.takeIf { it > 0.0 && it <= 5.0 }
                    ?.let { round(it * 100.0) / 100.0 }
            }

            val parsed = ArrayList<ReviewEntry>()
            for (match in ARTICLE_RE.findAll(html)) {
                val block = match.groupValues[1]
                val lowerBlock = block.lowercase(Locale.ROOT)
                if ("contains-spoilers" in lowerBlock || "has-spoilers" in lowerBlock || "this review may contain spoilers" in lowerBlock) {
                    continue
                }
                val bodyHtml = BODY_TEXT_RE.find(block)?.groupValues?.getOrNull(1) ?: continue
                val cleanText = stripAndDecode(bodyHtml)
                if (cleanText.length < MIN_REVIEW_LENGTH) continue
                val text = clampText(cleanText, MAX_REVIEW_LENGTH)

                val author = AUTHOR_RE.find(block)?.groupValues?.getOrNull(1)?.let(::decodeEntities)?.trim()
                    ?.takeIf { it.isNotEmpty() } ?: "Reviewer"
                val relUrl = (CONTEXT_LINK_A.find(block) ?: CONTEXT_LINK_B.find(block))
                    ?.groupValues?.getOrNull(1)?.trim()
                val reviewUrl = if (!relUrl.isNullOrEmpty()) "https://letterboxd.com$relUrl" else null
                val stars = extractStars(block)
                val likes = DATA_COUNT_RE.find(block)?.groupValues?.getOrNull(1)?.toIntOrNull()
                parsed.add(ReviewEntry(author = author, stars = stars, text = text, likes = likes, url = reviewUrl))
            }

            val sorted = parsed.sortedByDescending { it.likes ?: 0 }.take(MAX_REVIEWS)
            return Triple(canonicalUrl, average, sorted)
        }

        private fun extractStars(block: String): Double? {
            for (match in RATING_SPAN_RE.findAll(block)) {
                val cls = match.groupValues[1]
                val inner = decodeEntities(match.groupValues[2])
                val aria = ARIA_LABEL_RE.find(match.value)?.groupValues?.getOrNull(1)?.let(::decodeEntities) ?: ""
                val combined = "$inner $aria"
                val full = combined.count { it == '★' }
                val half = if ('½' in combined) 0.5 else 0.0
                if (full > 0 || half > 0.0) return (full + half).coerceIn(0.5, 5.0)
                val rated = RATED_CLASS_RE.find(cls)?.groupValues?.getOrNull(1)?.toIntOrNull()
                if (rated != null && rated in 1..10) return rated / 2.0
            }
            val anyRated = RATED_CLASS_RE.find(block)?.groupValues?.getOrNull(1)?.toIntOrNull()
            return if (anyRated != null && anyRated in 1..10) anyRated / 2.0 else null
        }

        fun clampText(text: String, maxLen: Int): String {
            if (text.length <= maxLen) return text
            val slice = text.substring(0, maxLen)
            val breakAt = slice.lastIndexOf(' ')
            val cut = if (breakAt >= (maxLen * 3) / 4) slice.substring(0, breakAt) else slice
            return cut.trimEnd() + "…"
        }

        fun decodeEntities(input: String): String {
            var s = input
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&#39;", "'")
                .replace("&nbsp;", " ")
                .replace("&hellip;", "…")
                .replace("&mdash;", "—")
                .replace("&ndash;", "–")
                .replace("&rsquo;", "’")
                .replace("&lsquo;", "‘")
                .replace("&ldquo;", "“")
                .replace("&rdquo;", "”")
            s = NUMERIC_ENTITY_RE.replace(s) { m ->
                val raw = m.groupValues[1]
                val code = if (raw.startsWith("x", ignoreCase = true)) {
                    raw.substring(1).toIntOrNull(16)
                } else {
                    raw.toIntOrNull(10)
                }
                if (code != null && code in 1..0x10ffff) String(Character.toChars(code)) else m.value
            }
            return s
        }

        private fun stripAndDecode(html: String): String {
            val spaced = BLOCK_BREAK_RE.replace(html, " ")
            val noTags = TAG_RE.replace(spaced, " ")
            return SPACE_RE.replace(decodeEntities(noTags), " ").trim()
        }

        suspend fun fetchPageWithRedirects(startUrl: String): Pair<String, String?> = withContext(Dispatchers.IO) {
            runCatching {
                var current = startUrl
                repeat(5) {
                    val conn = (URL(current).openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = false
                        connectTimeout = TIMEOUT_MS
                        readTimeout = TIMEOUT_MS
                        setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 TVM/1.1")
                        setRequestProperty("Accept", "text/html,application/xhtml+xml")
                        setRequestProperty("Accept-Language", "en-US,en;q=0.9")
                    }
                    val status = conn.responseCode
                    if (status in 300..399) {
                        val loc = conn.getHeaderField("Location")
                        conn.disconnect()
                        if (loc.isNullOrBlank()) return@runCatching current to null
                        current = URL(URL(current), loc).toString()
                        return@repeat
                    }
                    val body = (if (status in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                    conn.disconnect()
                    return@runCatching if (status in 200..299) current to body else current to null
                }
                current to null
            }.getOrElse { startUrl to null }
        }
    }

    private data class CachedReviews(val payload: ReviewsPayload, val fetchedAt: Long)

    private val cacheLock = Any()
    private val cache = object : LinkedHashMap<String, CachedReviews>(MAX_CACHED + 1, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, CachedReviews>?): Boolean =
            size > MAX_CACHED
    }

    suspend fun get(rawId: String): ReviewsPayload? {
        val key = rawId.trim().lowercase(Locale.ROOT)
        if (!IMDB_RE.matches(key)) return null

        val now = clock()
        synchronized(cacheLock) {
            cache[key]?.let { hit ->
                if (now - hit.fetchedAt < REVIEWS_TTL_MS) return hit.payload
            }
        }

        val item = runCatching { itemLookup(key) }.getOrNull()
        val rating = item?.rating?.trim()?.toDoubleOrNull()?.takeIf { it > 0.0 && it <= 10.0 }
        val (finalUrl, html) = pageFetcher("https://letterboxd.com/imdb/$key/")
        val (sourceUrl, average, reviews) = if (html != null) {
            parseLetterboxd(finalUrl, html)
        } else {
            Triple(null, null, emptyList())
        }
        val source = if (sourceUrl != null) "letterboxd" else null

        val payload = ReviewsPayload(
            imdbId = key,
            imdbUrl = "https://www.imdb.com/title/$key/",
            rating = rating,
            source = source,
            sourceUrl = sourceUrl,
            average = average,
            reviews = reviews,
        )

        if (source != null || rating != null) {
            synchronized(cacheLock) {
                cache[key] = CachedReviews(payload, now)
            }
        }
        return payload
    }
}
