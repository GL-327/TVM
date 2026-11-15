package com.tvm.privateclient

import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Artwork that does not belong to the title it is filed under.
 *
 * Cinemeta sometimes links two IMDb titles to one underlying record. "David"
 * (1997, tt0118933) carries Law & Order: SVU's TMDB record, so metahub serves
 * SVU's poster, background and episode stills under David's id, and the two
 * appear side by side in "Recently updated" with the same artwork. Such a
 * pair shows up in the catalog as two different titles with the exact same
 * Stremio popularity, a value computed from the shared record. The better
 * established of the two (more Trakt watchers, then more ranking sources)
 * keeps the artwork; the other's metahub pictures are refused, so the
 * interface shows its own title card instead of somebody else's poster.
 */
object TvmArtTrust {
    private val distrusted: MutableSet<String> = ConcurrentHashMap.newKeySet()
    @Volatile private var file: java.io.File? = null

    /**
     * Called when titles are newly found to carry another title's artwork, so
     * pictures already on screen (Home shows its last copy, and the phone's
     * picture cache, before the catalog is fetched) are replaced as well.
     */
    @Volatile var onDistrusted: ((Set<String>) -> Unit)? = null

    /**
     * Kept on the phone, so the next launch knows before its first picture is
     * asked for. Without this, Home drew its saved copy, with SVU's poster on
     * David, before the catalog was read again.
     */
    fun attach(store: java.io.File) {
        file = store
        runCatching {
            if (store.isFile) {
                val ids = org.json.JSONArray(store.readText())
                for (i in 0 until ids.length()) distrusted.add(ids.getString(i).lowercase(Locale.US))
            }
        }
    }
    private val METAHUB = Regex("""^https?://(?:images|episodes|live)\.metahub\.space/.*?\b(tt\d+)\b""", RegexOption.IGNORE_CASE)

    fun distrust(ids: Collection<String>) {
        val added = ids.map { it.lowercase(Locale.US) }.filter { distrusted.add(it) }.toSet()
        if (added.isEmpty()) return
        file?.let { target -> runCatching { target.writeText(org.json.JSONArray(distrusted.sorted()).toString()) } }
        onDistrusted?.invoke(added)
    }

    fun isDistrusted(id: String): Boolean = distrusted.contains(id.lowercase(Locale.US))

    /** False for a metahub picture filed under a title whose artwork is someone else's. */
    fun trusted(url: String): Boolean {
        val id = METAHUB.find(url)?.groupValues?.get(1) ?: return true
        return !isDistrusted(id)
    }

    fun clear() = distrusted.clear()

    /** Upstream's own marker for a record it knows is a duplicate. */
    fun markedDuplicate(name: String): Boolean = name.trim().startsWith("#DUPE", ignoreCase = true)

    /**
     * Ids in one catalog answer whose artwork belongs to another title in it
     * (see the class comment). A pair with nothing to tell them apart is left
     * alone rather than guessed at.
     */
    fun crossLinked(metas: List<JSONObject>): Set<String> {
        val groups = LinkedHashMap<Double, MutableList<JSONObject>>()
        for (meta in metas) {
            val popularity = (meta.opt("popularity") as? Number)?.toDouble() ?: continue
            if (popularity <= 0.0 || popularity.isNaN()) continue
            if (markedDuplicate((meta.opt("name") as? String) ?: "")) continue
            groups.getOrPut(popularity) { mutableListOf() }.add(meta)
        }
        val out = mutableSetOf<String>()
        for (group in groups.values) {
            val ids = group.map { (it.opt("id") ?: "").toString().lowercase(Locale.US) }.toSet()
            if (ids.size < 2) continue
            val ranked = group.sortedWith(compareByDescending<JSONObject> { standing(it).first }.thenByDescending { standing(it).second })
            val top = standing(ranked[0])
            if (ranked.size > 1 && standing(ranked[1]) == top) continue
            val keeper = (ranked[0].opt("id") ?: "").toString().lowercase(Locale.US)
            out.addAll(ids - keeper)
        }
        return out
    }

    private fun standing(meta: JSONObject): Pair<Double, Int> {
        val sources = meta.optJSONObject("popularities")
        val trakt = (sources?.opt("trakt") as? Number)?.toDouble() ?: 0.0
        return trakt to (sources?.length() ?: 0)
    }
}

/**
 * Search order. Cinemeta answers films and series separately, each in its own
 * order, and the two lists used to be joined films first: "Dexter" put an
 * obscure 2025 film and every spin-off ahead of the 2006 series. Results are
 * now ranked by how well the title matches what was typed (exact, then the
 * title starting with it, then a whole word, then anywhere), then, among the
 * best matches, by the popularity on each title's own Cinemeta record (search
 * answers leave it out), then by how many other results
 * are follow-ons of the same title ("Dexter: New Blood", "Dexter: Original
 * Sin" make "Dexter" the franchise's root), and finally by Cinemeta's own
 * order, films and series taking turns.
 */
object TvmSearchRank {
    class Hit(val item: MediaItem, val popularity: Double, val index: Int)

    fun key(value: String): String {
        val plain = Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("""\p{Mn}+"""), "")
        return plain.lowercase(Locale.US).replace("&", " and ").replace(Regex("""[^\p{L}\p{N}]+"""), " ").trim()
    }

    private fun withoutArticle(value: String): String = value.removePrefix("the ").removePrefix("a ").removePrefix("an ")

    fun tier(query: String, title: String): Int {
        val q = key(query)
        val t = key(title)
        if (q.isEmpty() || t.isEmpty()) return 5
        if (t == q) return 0
        if (withoutArticle(t) == withoutArticle(q)) return 1
        if (t.startsWith("$q ") || withoutArticle(t).startsWith("${withoutArticle(q)} ")) return 2
        if (" $t ".contains(" $q ")) return 3
        if (t.contains(q)) return 4
        return 5
    }

    /** The best-matching hits, whose records are worth asking for their popularity. */
    fun contenders(query: String, movies: List<Hit>, series: List<Hit>, limit: Int = 6): List<Hit> {
        val all = movies + series
        val best = all.minOfOrNull { tier(query, it.item.title) } ?: return emptyList()
        if (best > 1) return emptyList()
        val top = all.filter { tier(query, it.item.title) == best }
        if (top.size < 2) return emptyList()
        return top.sortedBy { it.index }.take(limit)
    }

    fun rank(query: String, movies: List<Hit>, series: List<Hit>, standing: Map<String, Double> = emptyMap()): List<MediaItem> {
        val all = movies + series
        val keys = all.associateWith { key(it.item.title) }
        fun followOns(hit: Hit): Int {
            val root = keys[hit] ?: return 0
            if (root.isEmpty()) return 0
            return all.count { other -> other !== hit && other.item.kind == hit.item.kind && (keys[other] ?: "").startsWith("$root ") }
        }
        val ordered = all.sortedWith(
            compareBy<Hit> { tier(query, it.item.title) }
                .thenByDescending { standing[it.item.id] ?: -1.0 }
                .thenByDescending { followOns(it) }
                .thenBy { it.index }
                .thenBy { if (it.item.kind == "series") 0 else 1 },
        )
        val seen = mutableSetOf<String>()
        return ordered.map { it.item }.filter { seen.add(it.id) }
    }
}
