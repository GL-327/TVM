package com.tvm.privateclient

/**
 * Filename and title heuristics.
 *
 * Direct port of apps/ios/TVM/TVMTitle.swift. The case sensitivity of each
 * pattern is deliberate and carried over verbatim: the pack heuristics match an
 * uppercase `S` only, so an ordinary lowercase word cannot trip them, while the
 * episode and season parsers accept either case.
 */
object TvmTitle {

    data class SeasonEpisode(val season: Int, val episode: Int)

    data class ParsedName(val title: String, val year: Int?)

    data class PlayId(val imdb: String, val season: Int?, val episode: Int?)

    fun hue(title: String): Int {
        // Swift hashes unicode scalars, so walk code points rather than UTF-16
        // units; the 32-bit wraparound is kept by masking a Long.
        var hash = 0L
        var index = 0
        while (index < title.length) {
            val scalar = Character.codePointAt(title, index)
            hash = (hash * 31L + scalar.toLong()) and 0xFFFFFFFFL
            index += Character.charCount(scalar)
        }
        return (hash % 360L).toInt()
    }

    private val PACK_EPISODE_RANGE = Regex("""\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-–]\s*E?\d{1,2}\b""")
    private val PACK_SEASON_RANGE = Regex("""\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b""")
    private val SINGLE_EPISODE = Regex("""\bS\d{1,2}[\s._-]*E\d{1,2}\b""")
    private val PACK_WORDS = Regex(
        """\b(S\d{1,2}|season|seasons|complete|collection|box\s*set|temporada)\b""",
        RegexOption.IGNORE_CASE,
    )

    fun looksLikePack(title: String, filename: String = ""): Boolean {
        val name = "$title $filename"
        if (PACK_EPISODE_RANGE.containsMatchIn(name)) return true
        if (PACK_SEASON_RANGE.containsMatchIn(name)) return true
        // A lone SxxEyy is one episode, even though the season word below matches.
        if (SINGLE_EPISODE.containsMatchIn(name)) return false
        return PACK_WORDS.containsMatchIn(name)
    }

    private val EPISODE_PATTERNS: List<Regex> = listOf(
        Regex("""\bS(\d{1,2})[\s._-]*E(\d{1,2})\b""", RegexOption.IGNORE_CASE),
        Regex("""\b(\d{1,2})x(\d{1,2})\b""", RegexOption.IGNORE_CASE),
    )
    private val NON_DIGITS = Regex("""\D+""")

    fun parseEpisode(filename: String): SeasonEpisode? {
        if (looksLikePack(filename)) return null
        for (pattern in EPISODE_PATTERNS) {
            val match = pattern.find(filename) ?: continue
            val parts = NON_DIGITS.split(match.value)
                .filter { it.isNotEmpty() }
                .mapNotNull { it.toIntOrNull() }
            if (parts.size >= 2 && parts[0] > 0 && parts[1] > 0) {
                return SeasonEpisode(parts[0], parts[1])
            }
        }
        return null
    }

    private val SEASON_TOKEN = Regex("""\bS(?:eason)?[\s._-]*(\d{1,2})\b""", RegexOption.IGNORE_CASE)

    fun parseSeason(filename: String): Int? {
        val match = SEASON_TOKEN.find(filename) ?: return null
        val digits = match.value.filter { it.isDigit() }
        val value = digits.toIntOrNull() ?: return null
        return if (value > 0) value else null
    }

    private val EXTENSION = Regex("""\.[a-z0-9]{2,4}$""")
    private val BRACKETED = Regex("""\[[^\]]*]""")
    private val SEPARATORS = Regex("""[._]+""")
    private val YEAR = Regex("""\b(19|20)\d{2}\b""")
    private val TITLE_CUT = Regex(
        """\b(?:S(?:eason)?[\s._-]*\d{1,2}|\d{1,2}x\d{1,2}|(?:19|20)\d{2}|\d{3,4}p)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val JUNK = Regex(
        """\b(1080p|720p|2160p|480p|4k|uhd|webrip|web-?dl|bluray|x264|x265|h264|h265|hevc|aac|hdr|remux)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val WHITESPACE = Regex("""\s+""")

    fun parseFilename(filename: String): ParsedName {
        var base = EXTENSION.replace(filename, "")
        base = BRACKETED.replace(base, " ")
        base = SEPARATORS.replace(base, " ")
        val year = YEAR.find(base)?.value?.toIntOrNull()
        val cut = TITLE_CUT.find(base)
        // A cut at offset zero would leave nothing, so keep the whole string.
        val head = if (cut != null && cut.range.first > 0) base.substring(0, cut.range.first) else base
        val title = WHITESPACE.replace(JUNK.replace(head, " "), " ").trim()
        return ParsedName(if (title.isEmpty()) base else title, year)
    }

    private val NON_MEDIA = Regex(
        """\.(srt|idx|sub|nfo|txt|jpg|jpeg|png|gif|bmp|exe|zip|rar|7z|iso)$""",
        RegexOption.IGNORE_CASE,
    )

    fun isPlayableFile(filename: String, mimeType: String?): Boolean {
        if (mimeType?.startsWith("audio/") == true) return false
        return !NON_MEDIA.containsMatchIn(filename)
    }

    private val TITLE_NOISE = Regex("""\b(s\d|e\d|1080|2160|webrip)\b""", RegexOption.IGNORE_CASE)

    fun isDisplayTitle(title: String): Boolean {
        if (title.length < 2 || title.length > 46) return false
        if (title.any { it == '[' || it == ']' || it == '{' || it == '}' }) return false
        return !TITLE_NOISE.containsMatchIn(title)
    }

    fun normalize(value: String): String =
        value.lowercase().filter { it.isLetter() || it.isDigit() }

    fun titlesMatch(left: String, right: String): Boolean {
        val a = normalize(left)
        val b = normalize(right)
        if (a.isEmpty() || b.isEmpty()) return false
        return a == b || a.contains(b) || b.contains(a)
    }

    private val PLAY_ID = Regex("""^(tt\d+)(?::(\d+):(\d+))?$""", RegexOption.IGNORE_CASE)

    fun parsePlayId(id: String): PlayId? {
        val match = PLAY_ID.find(id) ?: return null
        val parts = match.value.split(":").filter { it.isNotEmpty() }
        val first = parts.firstOrNull() ?: return null
        val season = if (parts.size >= 3) parts[1].toIntOrNull() else null
        val episode = if (parts.size >= 3) parts[2].toIntOrNull() else null
        return PlayId(first.lowercase(), season, episode)
    }

    private val IMDB = Regex("""tt\d+""", RegexOption.IGNORE_CASE)

    fun extractImdb(id: String): String? = IMDB.find(id)?.value?.lowercase()

    /** Fallback browse cards used to be slugs (`fight-club`). Torrentio needs IMDb. */
    fun catalogImdb(id: String): String? {
        val imdb = extractImdb(id)
        if (imdb != null) return imdb
        val slug = id.split(":").filter { it.isNotEmpty() }.firstOrNull()?.lowercase() ?: id.lowercase()
        return catalogImdbMap[slug]
    }

    fun seasonEpisode(from: String): SeasonEpisode? {
        val parts = from.split(":").filter { it.isNotEmpty() }
        if (parts.size < 3) return null
        val season = parts[parts.size - 2].toIntOrNull() ?: return null
        val episode = parts[parts.size - 1].toIntOrNull() ?: return null
        if (season <= 0 || episode <= 0) return null
        return SeasonEpisode(season, episode)
    }

    private val catalogImdbMap: Map<String, String> = mapOf(
        "ten-truths-about-love" to "tt15483404",
        "dune-part-two" to "tt15239678",
        "the-last-of-us" to "tt3581920",
        "oppenheimer" to "tt15398776",
        "the-batman" to "tt1877830",
        "stranger-things" to "tt4574334",
        "the-boys" to "tt1190634",
        "spider-verse" to "tt9362722",
        "interstellar" to "tt0816692",
        "the-dark-knight" to "tt0468569",
        "inception" to "tt1375666",
        "no-way-home" to "tt10872600",
        "infinity-war" to "tt4154756",
        "endgame" to "tt4154796",
        "john-wick-4" to "tt10366206",
        "star-wars" to "tt0076759",
        "the-godfather" to "tt0068646",
        "shawshank" to "tt0111161",
        "pulp-fiction" to "tt0110912",
        "fight-club" to "tt0137523",
        "titanic" to "tt0120338",
        "game-of-thrones" to "tt0944947",
        "breaking-bad" to "tt0903747",
        "wednesday" to "tt13443470",
        "house-of-the-dragon" to "tt11198330",
        "severance" to "tt11280740",
        "silo" to "tt14688458",
        "the-bear" to "tt14452776",
        "squid-game" to "tt10919420",
        "the-mandalorian" to "tt8111088",
        "the-witcher" to "tt5180504",
        "the-devil-wears-prada" to "tt0458352",
        "invincible" to "tt6741278",
        "avatar" to "tt0499549",
        "dexter" to "tt0773262",
        "supernatural" to "tt0460681",
        "outer-range" to "tt9051676",
        "the-wilds" to "tt10671440",
        "outlander" to "tt3006802",
        "yellowjackets" to "tt11041332",
        "baywatch" to "tt1467386",
        "reacher" to "tt9288030",
        "bel-air" to "tt13652442",
        "smackdown" to "tt0227972",
        "girls5eva" to "tt11761214",
        "star-trek-discovery" to "tt5171438",
    )

    fun fileName(from: String): String =
        from.split('/', '\\').filter { it.isNotEmpty() }.lastOrNull() ?: from

    fun itemFromName(
        id: String,
        filename: String,
        mimeType: String? = null,
        progress: Double? = null,
    ): MediaItem? {
        if (!isPlayableFile(filename, mimeType)) return null
        val parsed = parseFilename(filename)
        val episode = parseEpisode(filename)
        return MediaItem(
            id = id,
            title = parsed.title,
            year = parsed.year,
            kind = if (episode == null) "file" else "series",
            synopsis = filename,
            poster = "",
            backdrop = "",
            genres = listOf("Your files"),
            rating = "",
            runtime = null,
            playable = true,
            progress = progress,
            filename = filename,
            hue = hue(parsed.title),
            mimeType = mimeType,
            season = episode?.season,
            episode = episode?.episode,
            episodeName = null,
            showTitle = parsed.title,
            aired = null,
            added = null,
        )
    }

    fun progressRatio(entry: ProgressEntry?): Double? {
        if (entry == null) return null
        // Swift's `guard` rejects a NaN duration because `NaN >= 60` is false.
        // `!(x >= y)` keeps that; the plain `x < y` would have let NaN through.
        if (!(entry.duration >= 60.0) || !(entry.position >= 30.0)) return null
        val value = entry.position / entry.duration
        // Anything this close to the end is "watched", not "continue watching".
        if (value >= 0.96) return null
        return minOf(1.0, maxOf(0.0, value))
    }
}
