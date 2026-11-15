package com.tvm.privateclient

/**
 * Whether a file is the episode (or film) that was asked for.
 *
 * Every South Park episode played the same Season 1 Episode 1 commentary
 * edition. Two places took "some file of this show" for "this episode":
 *  - The library lookup used any copy in the person's Real-Debrid library
 *    whose title matched, and inside a season pack fell back to its first
 *    file when the episode was not found.
 *  - When a source's own link did not resolve, its whole torrent was added
 *    with every file selected and the first file played. That first file of
 *    a series pack is S01E01 (here a creators' commentary edition), and it
 *    also left the pack in the library, so every later episode matched it.
 * Files are now chosen by their own season and episode numbers, a file
 * numbered as another episode is never played, extras (commentary editions,
 * featurettes, samples) are never taken for the episode itself, and when
 * nothing matches the request fails instead of playing something else.
 */
object TvmEpisodeMatch {
    enum class Fit { MATCH, UNKNOWN, WRONG }

    private val EXTRAS = Regex(
        // Words that are also real titles (Extras, The Interview, Trailer Park
        // Boys, Bonus Family) are left out on purpose.
        """\b(commentary|commentaries|featurettes?|behind[ ._-]the[ ._-]scenes|deleted[ ._-]scenes|gag[ ._-]reel|bloopers)\b|[ ._-]sample\.[a-z0-9]{2,4}$""",
        RegexOption.IGNORE_CASE,
    )
    private val VIDEO = Regex("""\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|mpg|mpeg|wmv)$""", RegexOption.IGNORE_CASE)
    private val SPELLED = Regex("""\bseason[ ._-]*(\d{1,2})\b.*?\bepisode[ ._-]*(\d{1,3})\b""", RegexOption.IGNORE_CASE)

    /** A commentary edition, featurette, sample or other bonus material. */
    fun isExtra(name: String): Boolean = EXTRAS.containsMatchIn(name)

    fun isVideo(path: String): Boolean = VIDEO.containsMatchIn(path)

    /** The season and episode a file name states, if it states one. */
    fun episodeOf(name: String): TvmTitle.SeasonEpisode? {
        // Only the file's own name: a folder called "Season 1" says nothing about the file.
        val leaf = name.substringAfterLast('/')
        TvmTitle.parseEpisode(leaf)?.let { return it }
        val spelled = SPELLED.find(leaf) ?: return null
        val season = spelled.groupValues[1].toIntOrNull() ?: return null
        val episode = spelled.groupValues[2].toIntOrNull() ?: return null
        return if (season > 0 && episode > 0) TvmTitle.SeasonEpisode(season, episode) else null
    }

    /**
     * How a file name fits the request. For an episode: MATCH when it names
     * that episode, WRONG when it names another one or is an extra, UNKNOWN
     * when it names none. For a film: WRONG for an extra or an episode file.
     */
    fun fit(name: String, season: Int?, episode: Int?): Fit {
        if (name.isBlank()) return Fit.UNKNOWN
        // The whole path: a pack keeps commentary editions in their own folder.
        if (isExtra(name)) return Fit.WRONG
        val stated = episodeOf(name)
        if (season == null || episode == null) return if (stated != null) Fit.WRONG else Fit.UNKNOWN
        if (stated == null) return Fit.UNKNOWN
        return if (stated.season == season && stated.episode == episode) Fit.MATCH else Fit.WRONG
    }

    /**
     * The file a search result points at, from its description: Torrentio
     * writes the torrent's name, then (for a pack) the file's own name, then
     * seeds and size. The line naming a video file is the file; otherwise the
     * first line (a single-file torrent is named after its file).
     */
    fun sourceFile(description: String): String {
        val lines = description.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        return lines.lastOrNull { isVideo(it) } ?: lines.firstOrNull() ?: ""
    }

    class File(val id: Int, val path: String, val bytes: Long)

    /**
     * The one file of a torrent to fetch. An episode needs a video file named
     * as that episode; failing that, the file the search result pointed at
     * (Torrentio's fileIdx, 0-based, which is Real-Debrid's file id − 1) when
     * its name does not say it is something else. A film takes that file, or
     * else the largest video that is not an extra. Null when none fits.
     */
    fun pickFile(files: List<File>, season: Int?, episode: Int?, fileIdx: Int?): File? {
        val videos = files.filter { isVideo(it.path) }
        if (videos.isEmpty()) return null
        val pointed = fileIdx?.let { idx -> videos.firstOrNull { it.id == idx + 1 } }
        if (season != null && episode != null) {
            if (pointed != null && fit(pointed.path, season, episode) == Fit.MATCH) return pointed
            videos.filter { fit(it.path, season, episode) == Fit.MATCH }.maxByOrNull { it.bytes }?.let { return it }
            // Torrentio matched this file to the episode itself; its name just does not number it.
            if (pointed != null && fit(pointed.path, season, episode) == Fit.UNKNOWN) return pointed
            return null
        }
        if (pointed != null && fit(pointed.path, null, null) != Fit.WRONG) return pointed
        return videos.filter { fit(it.path, null, null) != Fit.WRONG }.maxByOrNull { it.bytes }
    }
}
