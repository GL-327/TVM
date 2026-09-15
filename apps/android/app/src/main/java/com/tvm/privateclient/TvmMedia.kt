package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

/**
 * Home, rails, library, search, playback resolution and progress.
 *
 * Direct port of apps/ios/TVM/TVMMedia.swift. The same `apps/ui` interface is
 * served by both clients, so every JSON key, default and ordering decision here
 * has to match the Swift exactly.
 */
class TvmMedia(
    private val store: TvmStore,
    private val catalog: TvmCatalog,
    private val rd: TvmRealDebrid,
    private val plans: TvmPlans,
) {
    private class LibraryCache(
        val at: Long,
        val torrents: List<RdTorrent>,
        val downloads: List<RdDownload>,
        val items: List<MediaItem>,
    )

    private var libraryCache: LibraryCache? = null
    private val lock = Any()

    fun activeProfile(): String = store.profiles().activeId

    fun applyProfileHeader(value: String?) {
        if (value.isNullOrEmpty()) return
        val registry = store.profiles()
        if (registry.profiles.any { it.id == value }) {
            store.saveProfiles(value, registry.profiles)
        }
    }

    fun profilesJson(): JSONObject {
        val registry = store.profiles()
        return Json.obj(
            "activeId" to registry.activeId,
            "profiles" to Json.array(registry.profiles.map { it.json() }),
        )
    }

    fun createProfile(name: String): JSONObject {
        val registry = store.profiles()
        if (registry.profiles.size >= plans.profilesMax()) {
            throw ClientException("TVM holds ${plans.profilesMax()} profiles.")
        }
        val trimmed = name.trim()
        val profile = ProfileRecord(
            id = "profile-${UUID.randomUUID().toString().uppercase(Locale.US)}",
            name = if (trimmed.isEmpty()) "Profile ${registry.profiles.size + 1}" else trimmed,
            hue = PROFILE_HUES[registry.profiles.size % 5],
            created = isoNow(),
        )
        val profiles: List<ProfileRecord> = registry.profiles + profile
        store.saveProfiles(profile.id, profiles)
        return profilesJson()
    }

    fun renameProfile(id: String, name: String): JSONObject {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return profilesJson()
        val registry = store.profiles()
        val profiles: List<ProfileRecord> = registry.profiles.map { record ->
            if (record.id == id) ProfileRecord(record.id, trimmed, record.hue, record.created) else record
        }
        store.saveProfiles(registry.activeId, profiles)
        return profilesJson()
    }

    fun removeProfile(id: String): JSONObject {
        val registry = store.profiles()
        if (registry.profiles.size <= 1) throw ClientException("TVM needs at least one profile.")
        val profiles: List<ProfileRecord> = registry.profiles.filter { it.id != id }
        val active: String = if (registry.activeId == id) (profiles.firstOrNull()?.id ?: id) else registry.activeId
        store.saveProfiles(active, profiles)
        return profilesJson()
    }

    fun switchProfile(id: String): JSONObject {
        val registry = store.profiles()
        if (!registry.profiles.any { it.id == id }) throw ClientException("Unknown profile.")
        store.saveProfiles(id, registry.profiles)
        return profilesJson()
    }

    fun watchlist(): List<MediaItem> = store.watchlist(activeProfile())

    fun addWatchlist(raw: Any?): List<MediaItem> {
        val parsed = MediaItem.parse(raw) ?: return watchlist()
        val item = parsed.copy(added = isoNow())
        val items: List<MediaItem> = listOf(item) + watchlist().filter { it.id != item.id }
        store.writeWatchlist(activeProfile(), items)
        return items
    }

    fun removeWatchlist(id: String): List<MediaItem> {
        val items: List<MediaItem> = watchlist().filter { it.id != id }
        store.writeWatchlist(activeProfile(), items)
        return items
    }

    fun saveProgress(id: String, position: Double, duration: Double) {
        val profile = activeProfile()
        store.writeProgress(profile, id, position, duration)
        val saved = store.recentMedia(profile)
        if (saved.any { it.id == id }) return
        val imdb = TvmTitle.catalogImdb(id)
        // The player reports whichever id it was handed; keep the card it came
        // from reachable under that id too, or the row disappears from Continue.
        val cousin = saved.firstOrNull { candidate ->
            candidate.id == imdb ||
                TvmTitle.catalogImdb(candidate.id) == id ||
                (imdb != null && TvmTitle.catalogImdb(candidate.id) == imdb)
        } ?: return
        store.rememberMedia(listOf(cousin.copy(id = id)), profile)
    }

    suspend fun status(): RdStatus = rd.status()

    suspend fun setToken(token: String): RdStatus {
        synchronized(lock) { libraryCache = null }
        return rd.setToken(token)
    }

    suspend fun home(): JSONObject {
        var status: RdStatus = rd.status()
        var library: List<MediaItem>
        try {
            library = loadLibrary()
        } catch (error: Throwable) {
            status = status.copy(error = if (error is RdClientException.NeedsAuth) "needs-auth" else "unreachable")
            library = synchronized(lock) { libraryCache?.items ?: emptyList() }
        }
        val progress: Map<String, ProgressEntry> = store.progress(activeProfile())
        library = applyProgress(library, progress)
        val bundle: CatalogBundle = catalog.bundle()
        val catalogItems: List<MediaItem> = applyProgress(bundle.catalog, progress)
        val continueWatching: List<MediaItem> = continueWatching(catalogItems + library)
        val watchlist: List<MediaItem> = watchlist()
        val rails: MutableList<CatalogRail> = buildRails(bundle, continueWatching, watchlist).toMutableList()

        /*
         * Split deliberately, with explicit types at each step. As one chained
         * expression the Swift original blew the type checker's budget; the
         * Kotlin stays a plain loop for the same reason it stays readable.
         */
        val seenFinished: MutableSet<String> = mutableSetOf()
        val finishedPool: MutableList<MediaItem> = mutableListOf()
        finishedPool.addAll(catalogItems)
        finishedPool.addAll(library)
        finishedPool.addAll(watchlist)
        finishedPool.addAll(store.recentMedia(activeProfile()))

        val finishedUnsorted: MutableList<MediaItem> = mutableListOf()
        for (item in finishedPool) {
            val entry: ProgressEntry = progress[item.id] ?: continue
            if (!entry.isFinished && entry.completedAt == null) continue
            if (seenFinished.add(item.id)) finishedUnsorted.add(item)
        }

        // `updated` is non-optional on ProgressEntry; only a missing entry is "".
        fun finishedStamp(item: MediaItem): String {
            val entry: ProgressEntry = progress[item.id] ?: return ""
            return entry.completedAt ?: entry.updated
        }

        val finished: List<MediaItem> = finishedUnsorted.sortedWith(
            Comparator { left, right -> finishedStamp(right).compareTo(finishedStamp(left)) },
        )
        val notebook: JSONArray = Json.array(store.finishedNotebook(activeProfile(), finished))

        var adaptationGeneration = 0
        for (entry in progress.values) {
            adaptationGeneration += maxOf(entry.completions, if (entry.isFinished) 1 else 0)
        }
        if (adaptationGeneration > 0) {
            val watchedIds: MutableSet<String> = mutableSetOf()
            for (item in finished) watchedIds.add(item.id)
            val genres: MutableList<String> = mutableListOf()
            for (item in finished) genres.addAll(item.genres)
            // Score once per item rather than re-filtering `genres` inside the
            // comparator: same ordering, O(n log n) comparisons instead of
            // O(n log n x |genres|).
            val affinity: MutableMap<String, Int> = mutableMapOf()
            val unwatched: MutableList<MediaItem> = mutableListOf()
            for (item in bundle.catalog) {
                if (watchedIds.contains(item.id)) continue
                val itemGenres: Set<String> = item.genres.toSet()
                var total = 0
                for (genre in genres) if (itemGenres.contains(genre)) total += 1
                affinity[item.id] = total
                unwatched.add(item)
            }
            val candidates: List<MediaItem> = unwatched.sortedWith(
                Comparator { left, right -> (affinity[right.id] ?: 0).compareTo(affinity[left.id] ?: 0) },
            )
            if (candidates.isNotEmpty()) {
                val offset: Int = adaptationGeneration % candidates.size
                val rotated: List<MediaItem> = candidates.drop(offset) + candidates.take(offset)
                rails.add(0, CatalogRail("anime-adapted", "Adapted for you", rotated.take(16)))
            }
        }

        val featured: MediaItem? = continueWatching.firstOrNull()
            ?: rails.firstOrNull { it.id == "new-films" }?.items?.firstOrNull()
            ?: rails.firstOrNull { it.id == "films" }?.items?.firstOrNull()
            ?: catalogItems.firstOrNull()
            ?: library.firstOrNull { TvmTitle.isDisplayTitle(it.title) }
            ?: library.firstOrNull()

        return Json.obj(
            "rd" to status.json(),
            "featured" to featured?.json(),
            "library" to Json.array(library.take(400).map { it.json() }),
            "continueWatching" to Json.array(continueWatching.map { it.json() }),
            "watchlist" to Json.array(watchlist.map { it.json() }),
            "finished" to notebook,
            "adaptationGeneration" to adaptationGeneration,
            "fileCount" to library.size,
            "rails" to Json.array(rails.map { it.json() }),
        )
    }

    suspend fun library(): List<MediaItem> = applyProgress(libraryOrEmpty(), store.progress(activeProfile()))

    suspend fun item(id: String): MediaItem? {
        val parsed = TvmTitle.parsePlayId(id)
        if (parsed != null) {
            val meta = catalog.meta(parsed.imdb)
            if (meta != null) {
                val season: Int? = parsed.season
                val episode: Int? = parsed.episode
                if (season != null && episode != null) {
                    val episodeItem = meta.children.firstOrNull { it.season == season && it.episode == episode }
                        ?: return null
                    return remember(episodeItem)
                }
                return remember(meta.item)
            }
        }
        val library: List<MediaItem> = library()
        val found = library.firstOrNull { it.id == id }
        if (found != null) return remember(found)
        val child = childrenOrEmpty(id).firstOrNull { it.id == id }
        if (child != null) return remember(child)
        val cached = store.recentMedia(activeProfile()).firstOrNull { it.id == id }
        if (cached != null) return cached
        val fallback = catalog.fallbackItems().firstOrNull { it.id == id }
        if (fallback != null) return remember(fallback)
        return null
    }

    suspend fun children(id: String): List<MediaItem> {
        val parsed = TvmTitle.parsePlayId(id)
        if (parsed != null) {
            val meta = catalog.meta(parsed.imdb)
            if (meta != null) {
                store.rememberMedia(meta.children, activeProfile())
                return meta.children
            }
        }
        val items: List<MediaItem> = childrenOrEmpty(id)
        store.rememberMedia(items, activeProfile())
        return items
    }

    suspend fun search(query: String): List<MediaItem> {
        val needle = query.trim()
        if (needle.length < 2) return emptyList()
        val local: List<MediaItem> = libraryOrEmpty() + store.recentMedia(activeProfile())
        val localHits: List<MediaItem> = local.filter { item ->
            item.title.contains(needle, ignoreCase = true) ||
                (item.showTitle ?: "").contains(needle, ignoreCase = true)
        }
        val remote: List<MediaItem> = catalog.search(needle)
        val seen: MutableSet<String> = mutableSetOf()
        // Cinemeta already ranked the remote hits; do not drop aliases like "lotr".
        val out: MutableList<MediaItem> = mutableListOf()
        for (item in localHits + remote) if (seen.add(item.id)) out.add(item)
        return out
    }

    private fun remember(item: MediaItem): MediaItem {
        val batch: MutableList<MediaItem> = mutableListOf(item)
        val imdb = TvmTitle.catalogImdb(item.id)
        if (imdb != null && imdb != item.id) batch.add(item.copy(id = imdb))
        store.rememberMedia(batch, activeProfile())
        return item
    }

    private fun rememberPlayback(id: String?, title: String?, season: Int?, episode: Int?) {
        if (id.isNullOrEmpty()) return
        val profile = activeProfile()
        if (store.recentMedia(profile).any { it.id == id }) return
        val name = title?.trim() ?: ""
        if (name.isEmpty()) return
        remember(
            MediaItem(
                id = id,
                title = name,
                year = null,
                kind = if (season != null || episode != null) "series" else "movie",
                synopsis = "",
                poster = "",
                backdrop = "",
                genres = emptyList(),
                rating = "",
                runtime = null,
                playable = true,
                progress = null,
                filename = null,
                hue = TvmTitle.hue(name),
                mimeType = null,
                season = season,
                episode = episode,
                episodeName = null,
                showTitle = if (season != null) name else null,
                aired = null,
                added = null,
            ),
        )
    }

    fun continueWatching(items: List<MediaItem> = emptyList()): List<MediaItem> {
        val progress: Map<String, ProgressEntry> = store.progress(activeProfile())
        return pickContinue(applyProgress(store.recentMedia(activeProfile()) + items, progress), progress)
    }

    suspend fun play(
        id: String?,
        link: String?,
        title: String?,
        season: Int?,
        episode: Int?,
    ): Pair<Int, JSONObject> {
        if (!plans.mobileAllowed()) {
            return 403 to Json.obj("kind" to "unavailable", "reason" to "mobile-plan-required")
        }
        if (plans.hoursBlocked() && id != null && !id.startsWith("live:")) {
            return 409 to Json.obj("kind" to "unavailable", "reason" to "hours-cap")
        }
        if (id != null && id.startsWith("live:")) {
            return 409 to Json.obj("kind" to "unavailable", "reason" to "unsupported")
        }
        rememberPlayback(id, title, season, episode)
        val blocked = probeAuth()
        if (blocked != null) return 409 to blocked
        if (link != null && link.trim().isNotEmpty()) {
            return playFromLink(link, id)
        }
        if (id != null && id.startsWith("rd:")) {
            val owned = resolveOwnedLink(id)
            if (owned != null) return playFromLink(owned, id)
            return 409 to Json.obj("kind" to "unavailable", "reason" to "not-in-library")
        }
        val wanted = title?.trim() ?: ""
        if (wanted.isNotEmpty()) {
            val matched = findLibraryPlayback(wanted, season, episode)
            if (matched != null) {
                val owned = resolveOwnedLink(matched)
                if (owned != null) return playFromLink(owned, id ?: matched)
            }
        }
        val imdb = resolveImdb(id, title)
        if (imdb != null) {
            val parsed = if (id == null) null else TvmTitle.parsePlayId(id)
            val extra = if (id == null) null else TvmTitle.seasonEpisode(id)
            return playFromTorrentio(
                imdb,
                season ?: parsed?.season ?: extra?.season,
                episode ?: parsed?.episode ?: extra?.episode,
                id ?: imdb,
            )
        }
        return 409 to Json.obj("kind" to "unavailable", "reason" to "not-in-library")
    }

    fun appsList(): JSONObject {
        val tiles: List<JSONObject> = appTiles()
        return Json.obj(
            "ribbon" to Json.array(tiles.filter { it.optBoolean("ribbon", false) }),
            "grid" to Json.array(tiles),
        )
    }

    suspend fun appHub(id: String): JSONObject? {
        val spec: JSONObject = appTiles().firstOrNull { it.optString("id", "") == id } ?: return null
        if (id == "tvm-stream") return null
        val bundle: CatalogBundle = catalog.bundle()
        val movies: List<MediaItem> = bundle.moviesTop.take(16)
        val shows: List<MediaItem> = bundle.seriesTop.take(16)
        val seeds: List<String> = HUB_SEEDS[id] ?: emptyList()
        val seeded: MutableList<MediaItem> = mutableListOf()
        for (seed in seeds.take(8)) {
            val meta = catalog.meta(seed)
            if (meta != null) seeded.add(meta.item)
        }
        val pool: List<MediaItem> = if (seeded.isEmpty()) movies + shows else seeded + movies
        val hero: MediaItem? = pool.firstOrNull { it.backdrop.isNotEmpty() } ?: pool.firstOrNull()
        val name: String = spec.optString("name", id)
        return Json.obj(
            "id" to spec.optString("id", id),
            "name" to name,
            "accent" to spec.optString("accent", "#5b3dff"),
            "layout" to spec.optString("layout", "hub"),
            "wordmark" to spec.optString("wordmark", name),
            "logo" to spec.optString("icon", ""),
            "disclaimer" to "Not the licensed $name app. Playback uses TVM Stream / Real-Debrid.",
            "hero" to hero?.json(),
            "continueWatching" to JSONArray(),
            "rails" to Json.array(
                listOf(
                    CatalogRail("$id-films", "Popular films", movies).json(),
                    CatalogRail("$id-shows", "Popular series", shows).json(),
                    CatalogRail("$id-trending", "Trending now", pool.take(16)).json(),
                ),
            ),
        )
    }

    fun clearCache() {
        synchronized(lock) { libraryCache = null }
        catalog.clear()
        store.clearCacheFiles()
    }

    private suspend fun probeAuth(): JSONObject? {
        if (!rd.configured()) return Json.obj("kind" to "unavailable", "reason" to "not-configured")
        val status: RdStatus = rd.status()
        if (status.error == "needs-auth") return Json.obj("kind" to "unavailable", "reason" to "needs-auth")
        if (status.error == null && !status.premium) {
            return Json.obj("kind" to "unavailable", "reason" to "needs-auth")
        }
        return null
    }

    private suspend fun playFromLink(link: String, mediaId: String?): Pair<Int, JSONObject> {
        try {
            val entry: ProgressEntry? = if (mediaId == null) null else store.progress(activeProfile())[mediaId]
            // Resume only where the ratio rules say there is something to resume;
            // the value handed back is the raw position, not the ratio.
            val startAt: Double? = if (TvmTitle.progressRatio(entry) != null) entry?.position else null
            var playUrl: String = link
            var filename: String = runCatching { URI(link) }.getOrNull()?.path?.substringAfterLast('/') ?: "stream"
            var mime = "application/octet-stream"
            if (rd.needsUnrestrict(link)) {
                val unrestricted: RdUnrestrict = rd.unrestrict(link)
                playUrl = unrestricted.download
                filename = unrestricted.filename
                mime = unrestricted.mimeType ?: mime
            }
            if (HLS_SUFFIX.containsMatchIn(playUrl)) {
                return streamReply(
                    playUrl,
                    TvmTitle.parseFilename(filename).title,
                    filename,
                    "application/vnd.apple.mpegurl",
                    "hls",
                    startAt,
                )
            }
            if (TvmPlayback.nativeCanOpen(playUrl)) {
                return streamReply(playUrl, TvmTitle.parseFilename(filename).title, filename, mime, "file", startAt)
            }
            return 409 to Json.obj("kind" to "unavailable", "reason" to "unsupported")
        } catch (error: Throwable) {
            if (isAuthFailure(error)) return 409 to Json.obj("kind" to "unavailable", "reason" to "needs-auth")
            return 409 to Json.obj("kind" to "unavailable", "reason" to "unsupported")
        }
    }

    private suspend fun resolveImdb(id: String?, title: String?): String? {
        if (id != null) {
            val mapped = TvmTitle.catalogImdb(id)
            if (mapped != null) return mapped
        }
        val queries: MutableList<String> = mutableListOf()
        if (title != null) {
            val trimmed = title.trim()
            if (trimmed.length >= 2) queries.add(trimmed)
        }
        if (id != null) {
            val slug: String = id.split(":").firstOrNull() ?: id
            val found = item(slug)
            if (found != null) queries.add(found.title)
        }
        val seen: MutableSet<String> = mutableSetOf()
        for (query in queries) {
            if (!seen.add(query.lowercase(Locale.US))) continue
            val hits: List<MediaItem> = catalog.search(query)
            val imdb: String? = hits.firstNotNullOfOrNull { TvmTitle.extractImdb(it.id) }
            if (imdb != null) return imdb
        }
        return null
    }

    private suspend fun playFromTorrentio(
        imdb: String,
        season: Int?,
        episode: Int?,
        mediaId: String?,
    ): Pair<Int, JSONObject> {
        val token: String = rd.tokenValue()
            ?: return 409 to Json.obj("kind" to "unavailable", "reason" to "not-configured")
        if (TvmTitle.extractImdb(imdb) == null) {
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        var seasonNo: Int? = season
        var episodeNo: Int? = episode
        var catalogTitle: String? = null
        if (seasonNo == null || episodeNo == null) {
            val meta = catalog.meta(imdb)
            if (meta != null) {
                catalogTitle = meta.item.title
                if (meta.item.kind == "series") {
                    if (seasonNo == null) seasonNo = meta.children.firstOrNull()?.season
                    if (episodeNo == null) episodeNo = meta.children.firstOrNull()?.episode
                }
            }
        }
        val streams: List<RdStream> = rd.torrentioStreams(token, imdb, seasonNo, episodeNo)
        if (streams.isEmpty()) {
            if (catalogTitle != null) {
                val matched = findLibraryPlayback(catalogTitle, seasonNo, episodeNo)
                if (matched != null) {
                    val owned = resolveOwnedLink(matched)
                    if (owned != null) return playFromLink(owned, matched)
                }
            }
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        val height: Int = plans.maxHeight()
        val capped: List<RdStream> = streams.filter { rd.streamHeight("${it.name} ${it.title}") <= height }
        val ranked: List<RdStream> = (if (capped.isEmpty()) streams else capped).take(8)
        var last: JSONObject = Json.obj("kind" to "unavailable", "reason" to "empty")
        for (stream in ranked) {
            if (stream.url.isNotEmpty()) {
                val resolved: String? = rd.resolveRedirect(stream.url)
                if (resolved != null && !rd.isTorrentioHost(resolved)) {
                    val result = playFromLink(resolved, mediaId ?: imdb)
                    if (result.first == 200) return result
                    last = result.second
                    if (last.optString("reason", "") == "needs-auth") return result
                }
            }
            val hash: String? = stream.infoHash
            if (hash != null && hash.isNotEmpty()) {
                val magnet = playFromMagnet(hash, mediaId ?: imdb)
                if (magnet.first == 200) return magnet
                last = magnet.second
                if (last.optString("reason", "") == "needs-auth") return magnet
            }
        }
        if (last.optString("reason", "") == "empty" && catalogTitle != null) {
            val matched = findLibraryPlayback(catalogTitle, seasonNo, episodeNo)
            if (matched != null) {
                val owned = resolveOwnedLink(matched)
                if (owned != null) return playFromLink(owned, matched)
            }
        }
        return 409 to last
    }

    private suspend fun playFromMagnet(hash: String, mediaId: String?): Pair<Int, JSONObject> {
        val links: List<String>
        try {
            val torrentId: String = rd.addMagnet(hash)
            try {
                rd.selectTorrentFiles(torrentId)
            } catch (_: Throwable) {
                // Already-selected packs answer 400; the links poll below decides.
            }
            links = rd.waitForTorrentLinks(torrentId)
        } catch (error: Throwable) {
            if (isAuthFailure(error)) return 409 to Json.obj("kind" to "unavailable", "reason" to "needs-auth")
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        var last: JSONObject = Json.obj("kind" to "unavailable", "reason" to "empty")
        for (link in links.take(6)) {
            val result = playFromLink(link, mediaId)
            if (result.first == 200) return result
            last = result.second
            if (last.optString("reason", "") == "needs-auth") return result
        }
        return 409 to last
    }

    private fun streamReply(
        url: String,
        title: String,
        filename: String,
        mime: String,
        transport: String,
        startAt: Double?,
    ): Pair<Int, JSONObject> {
        val body: JSONObject = Json.obj(
            "kind" to "stream",
            "url" to url,
            "title" to title,
            "filename" to filename,
            "mimeType" to mime,
            "engine" to "native",
            "transport" to transport,
        )
        // Omitted rather than null when there is nothing to resume.
        if (startAt != null) body.put("startAt", startAt)
        return 200 to body
    }

    private suspend fun loadLibrary(): List<MediaItem> {
        if (!rd.configured()) return emptyList()
        val fresh: List<MediaItem>? = synchronized(lock) {
            val cache = libraryCache
            if (cache != null && System.currentTimeMillis() - cache.at < LIBRARY_TTL_MS) cache.items else null
        }
        if (fresh != null) return fresh
        val downloads: List<RdDownload>
        val torrents: List<RdTorrent>
        try {
            downloads = rd.downloads()
            torrents = rd.torrents()
        } catch (error: Throwable) {
            // A stale list beats an empty home screen when Real-Debrid blinks.
            val cached: List<MediaItem>? = synchronized(lock) { libraryCache?.items }
            if (cached != null) return cached
            throw error
        }
        val items: MutableList<MediaItem> = mutableListOf()
        for (torrent in torrents) {
            val ready: Boolean = torrent.status == "downloaded" || torrent.progress == 100.0
            if (!ready || torrent.links.isEmpty()) continue
            val parsed: MediaItem = TvmTitle.itemFromName("rd:t:${torrent.id}:0", torrent.filename) ?: continue
            val item: MediaItem =
                if (TvmTitle.looksLikePack(parsed.title, torrent.filename) || torrent.links.size > 1) {
                    parsed.copy(kind = "series", season = null, episode = null)
                } else {
                    parsed
                }
            items.add(item)
        }
        for (download in downloads) {
            val item = TvmTitle.itemFromName("rd:d:${download.id}", download.filename, download.mimeType)
            if (item != null) items.add(item)
        }
        synchronized(lock) {
            libraryCache = LibraryCache(System.currentTimeMillis(), torrents, downloads, items)
        }
        return items
    }

    private suspend fun loadChildren(id: String): List<MediaItem> {
        if (!id.startsWith("rd:t:")) return emptyList()
        val torrentId: String = torrentIdFrom(id)
        val info: RdTorrentInfo = rd.torrentInfo(torrentId)
        val selected: List<RdTorrentFile> = info.files.filter { it.selected == 1 }
        val progress: Map<String, ProgressEntry> = store.progress(activeProfile())
        val out: MutableList<MediaItem> = mutableListOf()
        for ((index, file) in selected.withIndex()) {
            val name: String = TvmTitle.fileName(file.path)
            val childId = "rd:t:$torrentId:$index"
            val parsed: MediaItem =
                TvmTitle.itemFromName(childId, name, null, TvmTitle.progressRatio(progress[childId])) ?: continue
            if (parsed.season == null) {
                val season: Int? = TvmTitle.parseSeason(name) ?: TvmTitle.parseSeason(info.filename)
                if (season != null || selected.size >= 2) {
                    // A multi-file torrent with no markers is still an ordered run
                    // of episodes; number it rather than show a wall of "file".
                    val episode: Int = parsed.episode ?: (index + 1)
                    out.add(parsed.copy(kind = "series", season = season ?: 1, episode = episode))
                    continue
                }
            }
            out.add(parsed)
        }
        return out
    }

    private suspend fun resolveOwnedLink(id: String): String? {
        try {
            loadLibrary()
        } catch (_: Throwable) {
            // The cached torrents/downloads below are still worth a look.
        }
        val torrents: List<RdTorrent> = synchronized(lock) { libraryCache?.torrents ?: emptyList() }
        val downloads: List<RdDownload> = synchronized(lock) { libraryCache?.downloads ?: emptyList() }
        if (id.startsWith("rd:t:")) {
            val torrentId: String = torrentIdFrom(id)
            val index: Int = torrentIndexFrom(id)
            val info: RdTorrentInfo? = try {
                rd.torrentInfo(torrentId)
            } catch (_: Throwable) {
                null
            }
            if (info != null && index < info.links.size && info.links[index].isNotEmpty()) {
                return info.links[index]
            }
            val torrent = torrents.firstOrNull { it.id == torrentId }
            if (torrent != null && index < torrent.links.size) return torrent.links[index]
            return null
        }
        val downloadId: String = if (id.startsWith("rd:d:")) id.drop(5) else id.drop(3)
        return downloads.firstOrNull { it.id == downloadId }?.link
    }

    private fun torrentIdFrom(id: String): String {
        val rest: String = id.drop(5)
        val cut: Int = rest.lastIndexOf(':')
        if (cut >= 0) {
            val suffix: String = rest.substring(cut + 1)
            if (suffix.all { it.isDigit() }) return rest.substring(0, cut)
        }
        return rest
    }

    private fun torrentIndexFrom(id: String): Int {
        val rest: String = id.drop(5)
        val cut: Int = rest.lastIndexOf(':')
        if (cut >= 0) {
            val value: Int? = rest.substring(cut + 1).toIntOrNull()
            if (value != null) return value
        }
        return 0
    }

    private suspend fun findLibraryPlayback(title: String, season: Int?, episode: Int?): String? {
        val library: List<MediaItem> = libraryOrEmpty()
        val matches: List<MediaItem> = library.filter { item ->
            TvmTitle.titlesMatch(item.title, title) ||
                TvmTitle.titlesMatch(item.showTitle ?: "", title) ||
                TvmTitle.titlesMatch(item.filename ?: "", title)
        }
        val direct = matches.firstOrNull { !TvmTitle.looksLikePack(it.title, it.filename ?: "") }
        if (direct != null) return direct.id
        for (pack in matches.filter { it.id.startsWith("rd:t:") }.take(8)) {
            val kids: List<MediaItem> = try {
                loadChildren(pack.id)
            } catch (_: Throwable) {
                continue
            }
            val picked = kids.firstOrNull { it.season == season && it.episode == episode } ?: kids.firstOrNull()
            if (picked != null) return picked.id
        }
        return matches.firstOrNull()?.id
    }

    private fun applyProgress(items: List<MediaItem>, progress: Map<String, ProgressEntry>): List<MediaItem> =
        items.map { item -> item.copy(progress = TvmTitle.progressRatio(progress[item.id])) }

    private fun pickContinue(items: List<MediaItem>, progress: Map<String, ProgressEntry>): List<MediaItem> {
        val started: List<MediaItem> = items.filter { it.progress != null }
        val ordered: List<MediaItem> = started.sortedWith(
            Comparator { left, right ->
                (progress[right.id]?.updated ?: "").compareTo(progress[left.id]?.updated ?: "")
            },
        )
        val seen: MutableSet<String> = mutableSetOf()
        val out: MutableList<MediaItem> = mutableListOf()
        for (item in ordered) {
            // One row per show, not one per episode.
            val key: String = TvmTitle.normalize(item.showTitle ?: item.title)
            if (key.isEmpty()) continue
            if (!seen.add(key)) continue
            out.add(item)
            if (out.size >= 16) break
        }
        return out
    }

    private suspend fun buildRails(
        bundle: CatalogBundle,
        watching: List<MediaItem>,
        watchlist: List<MediaItem>,
    ): List<CatalogRail> {
        val used: MutableSet<String> = mutableSetOf()
        for (item in watching) {
            used.add(item.id)
            used.add(item.title)
        }
        for (item in watchlist) {
            used.add(item.id)
            used.add(item.title)
        }
        val rails: MutableList<CatalogRail> = mutableListOf()

        fun take(source: List<MediaItem>, id: String, title: String) {
            val items: List<MediaItem> =
                source.filter { !used.contains(it.id) && !used.contains(it.title) }.take(16)
            for (item in items) {
                used.add(item.id)
                used.add(item.title)
            }
            if (items.isNotEmpty()) rails.add(CatalogRail(id, title, items))
        }

        take(bundle.catalog, "for-you", "You might like")
        take(bundle.moviesTop, "films", "Popular films")
        take(bundle.seriesTop, "series", "Popular series")
        take(bundle.newFilms, "new-films", "New films")
        take(bundle.recentTv, "new-series", "Recently updated")
        val first: MediaItem? = watching.firstOrNull()
        if (first != null) {
            val because: List<MediaItem> = bundle.catalog.filter { item ->
                !used.contains(item.id) && item.genres.any { first.genres.contains(it) }
            }.take(12)
            if (because.isNotEmpty()) {
                rails.add(CatalogRail("because", "Because you watched ${first.title}", because))
            }
        }
        val genres: List<Pair<String, String>> = listOf(
            "horror" to "Horror", "action" to "Action", "comedy" to "Comedy",
            "thriller" to "Thriller", "scifi" to "Sci-Fi", "romance" to "Romance",
        )
        for ((id, name) in genres) {
            val movies: List<MediaItem> = catalog.genre("movie", name)
            val shows: List<MediaItem> = catalog.genre("series", name)
            val mixed: MutableList<MediaItem> = mutableListOf()
            var i = 0
            while (mixed.size < 16 && i < maxOf(movies.size, shows.size)) {
                if (i < movies.size && !used.contains(movies[i].id)) {
                    mixed.add(movies[i])
                    used.add(movies[i].id)
                }
                if (mixed.size >= 16) break
                if (i < shows.size && !used.contains(shows[i].id)) {
                    mixed.add(shows[i])
                    used.add(shows[i].id)
                }
                i += 1
            }
            if (mixed.isNotEmpty()) rails.add(CatalogRail(id, name, mixed))
        }
        if (rails.isEmpty()) {
            take(catalog.fallbackItems(), "films", "Popular films")
        }
        return rails
    }

    private suspend fun libraryOrEmpty(): List<MediaItem> = try {
        loadLibrary()
    } catch (_: Throwable) {
        emptyList()
    }

    private suspend fun childrenOrEmpty(id: String): List<MediaItem> = try {
        loadChildren(id)
    } catch (_: Throwable) {
        emptyList()
    }

    private fun isAuthFailure(error: Throwable): Boolean =
        error is RdClientException.NeedsAuth || error is RdClientException.NotConfigured

    private fun appTiles(): List<JSONObject> = listOf(
        tile("tvm-stream", "TVM Stream", "#5b3dff", "TVM", "/apps/tvm.svg", "internal:library", "hub", false, true),
        tile("netflix", "Netflix", "#e50914", "NETFLIX", "/apps/netflix.svg", "https://www.netflix.com/", "netflix", true, true),
        tile("prime", "Prime Video", "#00a8e1", "prime video", "/apps/marks/prime.svg", "https://www.primevideo.com/", "prime", true, true),
        tile("max", "HBO Max", "#002be7", "max", "/apps/marks/max.svg", "https://www.max.com/", "max", true, true),
        tile("appletv", "Apple TV", "#141414", "tv+", "/apps/marks/appletv.svg", "https://tv.apple.com/", "appletv", true, true),
        tile("disney", "Disney+", "#113c8c", "disney+", "/apps/marks/disney.svg", "https://www.disneyplus.com/", "disney", true, true),
        tile("hulu", "Hulu", "#1ce783", "hulu", "/apps/marks/hulu.svg", "https://www.hulu.com/", "hulu", true, true),
        tile("peacock", "Peacock", "#000000", "peacock", "/apps/marks/peacock.svg", "https://www.peacocktv.com/", "peacock", true, true),
        tile("youtube", "YouTube", "#ffffff", "YouTube", "/apps/youtube.svg", "https://www.youtube.com/tv", "hub", false, false),
        tile("freevee", "Freevee", "#111111", "freevee", "/apps/marks/freevee.svg", "https://www.amazon.com/gp/video/storefront/freevee", "hub", false, false),
        tile("iplayer", "BBC iPlayer", "#ff4d24", "iPlayer", "/apps/marks/iplayer.svg", "https://www.bbc.co.uk/iplayer", "hub", false, false),
        tile("paramount", "Paramount+", "#0062b4", "paramount+", "/apps/marks/paramount.svg", "https://www.paramountplus.com/", "hub", false, false),
        tile("tubi", "Tubi", "#fa382f", "tubi", "/apps/marks/tubi.svg", "https://tubitv.com/", "hub", false, false),
        tile("pluto", "Pluto TV", "#000000", "Pluto TV", "/apps/marks/pluto.svg", "https://pluto.tv/", "hub", false, false),
        tile("starz", "Starz", "#121212", "STARZ", "/apps/marks/starz.svg", "https://www.starz.com/", "hub", false, false),
        tile("fox", "Fox", "#000000", "FOX", "/apps/marks/fox.svg", "https://www.fox.com/", "hub", false, false),
    )

    private fun tile(
        id: String,
        name: String,
        accent: String,
        wordmark: String,
        icon: String,
        url: String,
        layout: String,
        mock: Boolean,
        ribbon: Boolean,
    ): JSONObject = Json.obj(
        "id" to id,
        "name" to name,
        "accent" to accent,
        "wordmark" to wordmark,
        "icon" to icon,
        "url" to url,
        "layout" to layout,
        "mock" to mock,
        "ribbon" to ribbon,
    )

    private fun isoNow(): String = DateTimeFormatter.ISO_INSTANT.format(Instant.now().truncatedTo(ChronoUnit.SECONDS))

    private companion object {
        val PROFILE_HUES: List<Int> = listOf(350, 220, 140, 32, 280)
        const val LIBRARY_TTL_MS: Long = 45_000

        /** Case-sensitive, as the Swift regex was: Real-Debrid emits lowercase. */
        val HLS_SUFFIX: Regex = Regex("""\.m3u8(\?|$)""")

        val HUB_SEEDS: Map<String, List<String>> = mapOf(
            "netflix" to listOf("tt4574334", "tt0903747", "tt1375666"),
            "prime" to listOf("tt8111088", "tt1160419", "tt10872600"),
            "max" to listOf("tt0944947", "tt0903747", "tt0468569"),
            "appletv" to listOf("tt9737326", "tt10986410"),
            "disney" to listOf("tt2527338", "tt1825683"),
            "hulu" to listOf("tt4574334"),
            "peacock" to listOf("tt8111088"),
        )
    }
}
