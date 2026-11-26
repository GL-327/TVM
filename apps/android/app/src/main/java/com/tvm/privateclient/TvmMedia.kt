package com.tvm.privateclient

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
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
private const val TAG = "TVMPlayer"

class TvmMedia(
    private val store: TvmStore,
    private val catalog: TvmCatalog,
    private val rd: TvmRealDebrid,
    private val plans: TvmPlans,
    private val content: TvmContent? = null,
    val pinGuard: PinGuard = PinGuard(),
    private val webhook: TvmWebhook = TvmWebhook({ TvmPrefs.load(store) }),
) {
    private val resolvedContent: TvmContent by lazy { content ?: TvmContent(store, enableRefresh = false) }

    fun parentalLevels(): List<AgeLevel> = TvmParental.levels(resolvedContent)

    fun ageLevel(): Int {
        val registry = store.profiles()
        return registry.profiles.firstOrNull { it.id == registry.activeId }?.maxAge ?: 18
    }

    private class LibraryCache(
        val at: Long,
        val torrents: List<RdTorrent>,
        val downloads: List<RdDownload>,
        val items: List<MediaItem>,
    )

    private var libraryCache: LibraryCache? = null
    private val lock = Any()

    fun playbackEvent(event: PlaybackEventRecord) = webhook.send(activeProfile(), event)

    fun playbackStarted(id: String?, payload: JSONObject) {
        if (TvmWebhook.isValidProgressId(id) && payload.text("kind") == "stream") {
            playbackEvent(PlaybackEventRecord("play", id!!, Json.string(payload.opt("title"))))
        }
    }

    fun withPlaybackDetails(payload: JSONObject): JSONObject {
        if (payload.text("kind") != "stream" || payload.optBoolean("isLive")) return payload
        val filename = payload.text("filename")
        val version = TvmVersions.describeVersion(RdStream(payload.text("url"), filename, "", null, null, 0, true, false, filename), null)
        if (!payload.has("version")) payload.put("version", version.json())
        if (!payload.has("originalLanguage")) payload.put("originalLanguage", JSONObject.NULL)
        if (!payload.has("audioLanguages")) payload.put("audioLanguages", JSONArray(version.languages))
        return payload
    }

    private fun directPlayback(result: Pair<Int, JSONObject>, download: DownloadPrefs?, client: PlaybackClient?, screenHeight: Int?, maxHeight: Int?): Pair<Int, JSONObject> {
        if (result.first != 200 || download != null) return result
        val filename = result.second.text("filename")
        val stream = RdStream(result.second.text("url"), filename, "", null, null, 0, true, false, filename)
        val version = TvmVersions.describeVersion(stream, null)
        val prefs = TvmPrefs.load(store)
        val caps = TvmDeviceCodecs.caps
        val needs = TvmPlaybackChoice.needs(filename, version.height ?: 1080)
        val height = minOf(capFor(null, screenHeight, maxHeight), TvmDeviceCodecs.screenHeight, TvmVersions.qualityCap(prefs.quality))
        if ((version.height ?: 1080) > height || !TvmPlaybackChoice.videoPlayable(needs, caps) || !TvmPlaybackChoice.audioPlayable(needs, caps) ||
            !TvmVersions.supportsVersion(version, filename, client)) return 409 to Json.obj("kind" to "unavailable", "reason" to "unsupported")
        return result.first to withPlaybackDetails(result.second)
    }

    fun activeProfile(): String = store.profiles().activeId

    fun applyProfileHeader(value: String?) {
        if (value.isNullOrEmpty()) return
        val registry = store.profiles()
        if (value == registry.activeId) return
        val target = registry.profiles.firstOrNull { it.id == value } ?: return
        if (target.locked && !pinGuard.isUnlocked(target.id)) return
        store.saveProfiles(value, registry.profiles)
    }

    fun profilesJson(): JSONObject {
        val registry = store.profiles()
        return Json.obj(
            "activeId" to registry.activeId,
            "profiles" to Json.array(registry.profiles.map { it.json() }),
        )
    }

    fun createProfile(
        name: String,
        hue: Int? = null,
        avatarRaw: Any? = null,
        kindRaw: String? = null,
        maxAgeRaw: Any? = null,
        pinRaw: Any? = null,
    ): JSONObject {
        val registry = store.profiles()
        if (registry.profiles.size >= plans.profilesMax()) {
            throw ClientException("TVM holds ${plans.profilesMax()} profiles.")
        }
        val kind = when (kindRaw?.trim()) {
            null, "", "standard" -> "standard"
            "kids" -> "kids"
            else -> throw ClientException("kind must be standard or kids")
        }
        val maxAge = if (maxAgeRaw == null || maxAgeRaw === JSONObject.NULL) {
            TvmParental.defaultAge(kind)
        } else {
            TvmParental.normalizeAge(maxAgeRaw, kind)
                ?: throw ClientException("maxAge must be 7, 12, 15, or 18")
        }
        val avatar = parseAvatarInput(avatarRaw)
        val pin = parseOptionalNewPin(pinRaw)
        val trimmed = name.trim().take(40)
        val profile = ProfileRecord(
            id = "profile-${UUID.randomUUID().toString().uppercase(Locale.US)}",
            name = if (trimmed.isEmpty()) "Profile ${registry.profiles.size + 1}" else trimmed,
            hue = hue ?: PROFILE_HUES[registry.profiles.size % PROFILE_HUES.size],
            created = isoNow(),
            avatar = avatar,
            kind = kind,
            maxAge = maxAge,
            pin = pin,
        )
        val profiles: List<ProfileRecord> = registry.profiles + profile
        store.saveProfiles(profile.id, profiles)
        pinGuard.markUnlocked(profile.id)
        return profilesJson()
    }

    fun updateProfile(body: JSONObject): JSONObject {
        val id = Json.string(body.opt("id")) ?: throw ClientException("id is required")
        val registry = store.profiles()
        val existing = registry.profiles.firstOrNull { it.id == id }
            ?: throw PinException(404, "not_found")

        val nextName = if (body.has("name")) {
            val rawName = body.opt("name")
            if (rawName === JSONObject.NULL || rawName !is String) {
                throw ClientException("name must be a non-empty string")
            }
            val trimmed = rawName.trim().take(40)
            if (trimmed.isEmpty()) throw ClientException("name must be a non-empty string")
            trimmed
        } else {
            existing.name
        }

        val nextHue = if (body.has("hue") && body.opt("hue") !== JSONObject.NULL) {
            Json.int(body.opt("hue")) ?: throw ClientException("hue must be an integer")
        } else {
            existing.hue
        }

        val nextAvatar = if (body.has("avatar")) parseAvatarInput(body.opt("avatar")) else existing.avatar

        val nextKind = if (body.has("kind") && body.opt("kind") !== JSONObject.NULL) {
            when ((body.opt("kind") as? String)?.trim()) {
                "standard" -> "standard"
                "kids" -> "kids"
                else -> throw ClientException("kind must be standard or kids")
            }
        } else {
            existing.kind
        }

        val nextMaxAge = if (body.has("maxAge") && body.opt("maxAge") !== JSONObject.NULL) {
            TvmParental.normalizeAge(body.opt("maxAge"), nextKind)
                ?: throw ClientException("maxAge must be 7, 12, 15, or 18")
        } else if (body.has("kind") && nextKind != existing.kind) {
            TvmParental.defaultAge(nextKind)
        } else {
            existing.maxAge
        }

        val currentPin = extractPinCandidate(body, "currentPin")
        val pinChangeRequested = body.has("pin")
        val looseningKids = existing.kind == "kids" && (nextKind != "kids" || nextMaxAge > existing.maxAge)

        if (existing.pin != null && (pinChangeRequested || looseningKids)) {
            pinGuard.verify(existing.id, existing.pin, currentPin)
        } else if (looseningKids) {
            val guardians = registry.profiles.filter {
                it.id != existing.id && it.kind == "standard" && it.pin != null
            }
            if (guardians.isNotEmpty()) {
                pinGuard.verifyAny(guardians, currentPin)
            }
        }

        val nextPin = if (pinChangeRequested) {
            parseOptionalNewPin(body.opt("pin"))
        } else {
            existing.pin
        }

        val updated = existing.copy(
            name = nextName,
            hue = nextHue,
            avatar = nextAvatar,
            kind = nextKind,
            maxAge = nextMaxAge,
            pin = nextPin,
        )
        val profiles = registry.profiles.map { if (it.id == id) updated else it }
        store.saveProfiles(registry.activeId, profiles)
        if (nextPin == null || pinChangeRequested) pinGuard.markUnlocked(id)
        return profilesJson()
    }

    fun renameProfile(id: String, name: String): JSONObject =
        updateProfile(Json.obj("id" to id, "name" to name))

    fun removeProfile(id: String, pin: String? = null): JSONObject {
        val registry = store.profiles()
        if (registry.profiles.size <= 1) throw ClientException("TVM needs at least one profile.")
        val target = registry.profiles.firstOrNull { it.id == id }
            ?: throw PinException(404, "not_found")
        if (target.pin != null) {
            pinGuard.verify(target.id, target.pin, pin)
        }
        val profiles: List<ProfileRecord> = registry.profiles.filter { it.id != id }
        val active: String = if (registry.activeId == id) (profiles.firstOrNull()?.id ?: id) else registry.activeId
        pinGuard.forget(id)
        store.removeProfileData(id)
        store.saveProfiles(active, profiles)
        return profilesJson()
    }

    fun switchProfile(id: String, pin: String? = null): JSONObject {
        val registry = store.profiles()
        val target = registry.profiles.firstOrNull { it.id == id }
            ?: throw PinException(404, "not_found")
        if (target.pin != null) {
            pinGuard.verify(target.id, target.pin, pin)
            pinGuard.clearSessionUnlocks()
            pinGuard.markUnlocked(target.id)
        } else {
            pinGuard.clearSessionUnlocks()
        }
        store.saveProfiles(id, registry.profiles)
        return profilesJson()
    }

    fun verifyProfilePin(id: String, pin: String?): JSONObject {
        val registry = store.profiles()
        val target = registry.profiles.firstOrNull { it.id == id }
            ?: throw PinException(404, "not_found")
        if (target.pin == null) {
            pinGuard.markUnlocked(target.id)
            return Json.obj("ok" to true)
        }
        pinGuard.verify(target.id, target.pin, pin)
        return Json.obj("ok" to true)
    }

    private fun parseAvatarInput(raw: Any?): String? {
        if (raw == null || raw === JSONObject.NULL) return null
        if (raw !is String) throw ClientException("avatar is invalid")
        val trimmed = raw.trim().lowercase(Locale.US)
        if (trimmed.isEmpty()) return null
        if (!TvmPins.AVATAR_RE.matches(trimmed)) throw ClientException("avatar is invalid")
        return trimmed
    }

    private fun parseOptionalNewPin(raw: Any?): ProfilePin? {
        if (raw == null || raw === JSONObject.NULL) return null
        if (raw !is String) throw PinException(400, "pin-invalid")
        if (raw.trim().isEmpty()) return null
        return TvmPins.makePin(raw.trim())
    }

    private fun extractPinCandidate(body: JSONObject, key: String): String? {
        if (!body.has(key)) return null
        val raw = body.opt(key)
        if (raw == null || raw === JSONObject.NULL) return null
        if (raw !is String) throw PinException(400, "pin-invalid")
        return raw
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
        val previous = store.progress(profile)[id]
        store.writeProgress(profile, id, position, duration)
        if (position.isFinite() && duration.isFinite() && duration > 0 && position / duration > 0.96 && previous?.isFinished != true && TvmWebhook.isValidProgressId(id)) {
            webhook.send(profile, PlaybackEventRecord("finish", id, position = position, duration = duration))
        }
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
        val age = ageLevel()
        val levels = parentalLevels()
        val progress: Map<String, ProgressEntry> = store.progress(activeProfile())
        library = TvmParental.filterForLevel(applyProgress(library, progress), age, levels)
        val bundle: CatalogBundle = catalog.bundle()
        val catalogItems: List<MediaItem> = TvmParental.filterForLevel(
            applyProgress(bundle.catalog, progress),
            age,
            levels,
        )
        val continueWatching: List<MediaItem> = continueWatching(catalogItems + library)
        val watchlist: List<MediaItem> = TvmParental.filterForLevel(watchlist(), age, levels)
        val rails: MutableList<CatalogRail> = buildRails(bundle, continueWatching, watchlist, age, levels).toMutableList()

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
            for (item in catalogItems) {
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
                rails.add(0, CatalogRail("anime-adapted", "Adapted for you", rotated.take(RAIL_LIMIT)))
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
        return TvmParental.filterForLevel(out, ageLevel(), parentalLevels())
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

    /** What a download asks for: its audio language and the tallest picture wanted. */
    data class DownloadPrefs(val language: String, val maxHeight: Int)

    /** The copy to download for [id] (TvmDownloads): its URL and file name. */
    suspend fun download(id: String, language: String, maxHeight: Int): Result<Pair<String, String>> {
        val (status, body) = play(id, null, null, null, null, DownloadPrefs(language, maxHeight))
        if (status == 200 && body.text("url", "").isNotEmpty()) {
            val url = body.text("url", "")
            if (HLS_SUFFIX.containsMatchIn(url) || body.text("transport", "") == "hls") {
                return Result.failure(IllegalStateException("This title is only available as a stream, not as a file to download."))
            }
            return Result.success(url to body.text("filename", "video.mkv"))
        }
        val reason = body.text("reason", "")
        return Result.failure(IllegalStateException(when (reason) {
            "not-configured", "needs-auth" -> "Connect your media account in Settings to download this title."
            "hours-cap" -> "Your viewing allowance has been reached."
            else -> "No downloadable file matches these options. Try another language or quality."
        }))
    }

    /**
     * The copies of a title this phone could play, best first, for the version picker.
     * Capabilities are this phone's own decoders unless the interface says otherwise.
     */
    suspend fun versions(id: String, season: Int?, episode: Int?, client: PlaybackClient?): Pair<Int, JSONObject> {
        val none: Pair<Int, JSONObject> = 200 to Json.obj("originalLanguage" to null, "versions" to Json.array(emptyList<JSONObject>()))
        val token: String = rd.tokenValue() ?: return none
        val imdb = resolveImdb(id, null) ?: return none
        val parsed = TvmTitle.parsePlayId(id)
        val extra = TvmTitle.seasonEpisode(id)
        val meta = catalog.meta(imdb)
        val s = season ?: parsed?.season ?: extra?.season ?: if (meta?.item?.kind == "series") meta.children.firstOrNull()?.season else null
        val e = episode ?: parsed?.episode ?: extra?.episode ?: if (meta?.item?.kind == "series") meta.children.firstOrNull()?.episode else null
        val streams = rd.torrentioStreams(token, imdb, s, e)
        val prefs = TvmPrefs.load(store)
        val original = catalog.originalLanguageFor(meta)
        val runtime = TvmVersions.runtimeSeconds(meta?.item?.runtime)
        val ranked = TvmVersions.rankForPhone(playableSources(streams, s, e), prefs, original, runtime, minOf(plans.maxHeight(), TvmDeviceCodecs.screenHeight), client, TvmDeviceCodecs.caps)
        val reply = Json.obj(
            "versions" to Json.array(ranked.map { it.version.json() }),
            "originalLanguage" to original,
        )
        return 200 to reply
    }

    /** Where to start [id] again (seconds), for a download played on the phone. */
    fun resumePosition(id: String): Double? {
        val entry: ProgressEntry? = store.progress(activeProfile())[id]
        return TvmTitle.resumePosition(entry)
    }

    suspend fun play(
        id: String?,
        link: String?,
        title: String?,
        season: Int?,
        episode: Int?,
        download: DownloadPrefs? = null,
        screenHeight: Int? = null,
        maxHeight: Int? = null,
        versionId: String? = null,
        client: PlaybackClient? = null,
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
        if (versionId == null && link != null && link.trim().isNotEmpty()) {
            return directPlayback(playFromLink(link, id), download, client, screenHeight, maxHeight)
        }
        if (versionId == null && id != null && id.startsWith("rd:")) {
            val owned = resolveOwnedLink(id)
            if (owned != null) return directPlayback(playFromLink(owned, id), download, client, screenHeight, maxHeight)
            return 409 to Json.obj("kind" to "unavailable", "reason" to "not-in-library")
        }
        val wanted = title?.trim() ?: ""
        // Downloads keep their explicit language/size rules. Normal playback
        // ranks every available release before choosing a library copy.
        var libraryCopy: Pair<Int, JSONObject>? = null
        if (download != null && versionId == null && wanted.isNotEmpty()) {
            val matched = findLibraryPlayback(wanted, season, episode)
            if (matched != null) {
                val owned = resolveOwnedLink(matched)
                if (owned != null && !TvmPlaybackMemory.hasFailed(owned)) {
                    val result = playFromLink(owned, id ?: matched)
                    if (result.first == 200 && (download == null || downloadable(result, download))) {
                        TvmPlaybackMemory.served(result.second.text("url", ""), owned)
                        if (fitsScreen(result, download, screenHeight, maxHeight)) return result
                        libraryCopy = result
                    }
                }
            }
        }
        val imdb = resolveImdb(id, title)
        if (imdb != null) {
            val parsed = if (id == null) null else TvmTitle.parsePlayId(id)
            val extra = if (id == null) null else TvmTitle.seasonEpisode(id)
            val found = playFromTorrentio(
                imdb,
                season ?: parsed?.season ?: extra?.season,
                episode ?: parsed?.episode ?: extra?.episode,
                id ?: imdb,
                download,
                screenHeight,
                maxHeight,
                versionId,
                client,
            )
            if (found.first == 200 || libraryCopy == null) return found
        }
        if (libraryCopy != null) return libraryCopy
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
        val spec: JSONObject = appTiles().firstOrNull { it.text("id", "") == id } ?: return null
        if (id == "tvm-stream") return null
        val age = ageLevel()
        val levels = parentalLevels()
        val bundle: CatalogBundle = catalog.bundle()
        val movies: List<MediaItem> = TvmParental.filterForLevel(bundle.moviesTop, age, levels).take(RAIL_LIMIT)
        val shows: List<MediaItem> = TvmParental.filterForLevel(bundle.seriesTop, age, levels).take(RAIL_LIMIT)
        val seeds: List<String> = HUB_SEEDS[id] ?: emptyList()
        val seeded: MutableList<MediaItem> = mutableListOf()
        for (seed in seeds.take(8)) {
            val meta = catalog.meta(seed)
            if (meta != null && TvmParental.allowedForLevel(meta.item, age, levels)) seeded.add(meta.item)
        }
        val pool: List<MediaItem> = if (seeded.isEmpty()) movies + shows else seeded + movies
        val hero: MediaItem? = pool.firstOrNull { it.backdrop.isNotEmpty() } ?: pool.firstOrNull()
        val name: String = spec.text("name", id)
        return Json.obj(
            "id" to spec.text("id", id),
            "name" to name,
            "accent" to spec.text("accent", "#2f6bff"),
            "layout" to spec.text("layout", "hub"),
            "wordmark" to spec.text("wordmark", name),
            "logo" to spec.text("icon", ""),
            "disclaimer" to "Not the licensed $name app. Playback uses TVM Stream / Real-Debrid.",
            "hero" to hero?.json(),
            "continueWatching" to JSONArray(),
            "rails" to Json.array(
                listOf(
                    CatalogRail("$id-films", "Popular films", movies).json(),
                    CatalogRail("$id-shows", "Popular series", shows).json(),
                    CatalogRail("$id-trending", "Trending now", pool.take(RAIL_LIMIT)).json(),
                ),
            ),
        )
    }

    suspend fun railMore(id: String, skipParam: Int = 0, pageParam: Int? = null): JSONObject {
        if (!RAIL_ID_RE.matches(id)) throw ClientException("rail id is invalid")
        val sources = railSources(id)
        if (sources.isEmpty()) {
            return Json.obj("items" to JSONArray(), "more" to false)
        }
        val age = ageLevel()
        val levels = parentalLevels()
        var cursor = (pageParam ?: skipParam).coerceIn(0, 5000)
        var sawRaw = false
        var collected: List<MediaItem> = emptyList()

        for (attempt in 0 until MAX_PAGE_ATTEMPTS) {
            val perSourceCursor = (cursor / sources.size).coerceIn(0, 5000)
            val perSourceLimit = if (sources.size > 1) maxOf(10, PAGE_SIZE / sources.size) else PAGE_SIZE
            val perSource = sources.map { src ->
                val fetched = catalog.page(src.kind, src.list, src.genre, perSourceCursor)
                if (fetched.isNotEmpty()) sawRaw = true
                fetched.take(perSourceLimit)
            }
            var batch = interleave(perSource)
            if (id == "new-films") {
                batch = filterNewFilms(batch)
            }
            collected = TvmParental.filterForLevel(batch, age, levels)
            cursor += PAGE_SIZE
            if (collected.isNotEmpty() || !sawRaw || cursor > 5000) break
        }

        val withProgress = applyProgress(collected, store.progress(activeProfile()))
        val hasMore = sawRaw && cursor <= 5000 && withProgress.isNotEmpty()
        return Json.obj(
            "items" to Json.array(withProgress.map { it.json() }),
            "more" to hasMore,
            "page" to cursor,
        )
    }

    suspend fun activeEvents(today: String = localIsoDate()): JSONObject {
        val doc = resolvedContent.fresh("events")
        val rawEvents = doc?.optJSONArray("events") ?: JSONArray()
        val age = ageLevel()
        val levels = parentalLevels()
        val progress = store.progress(activeProfile())
        val out = JSONArray()

        for (i in 0 until rawEvents.length()) {
            val event = rawEvents.optJSONObject(i) ?: continue
            val start = Json.string(event.opt("start")) ?: continue
            val end = Json.string(event.opt("end")) ?: continue
            if (today < start || today > end) continue

            val imdbId = Json.string(event.opt("imdbId")) ?: continue
            val release = Json.string(event.opt("release")) ?: start
            val spotlightRaw = item(imdbId) ?: catalog.meta(imdbId)?.item
            if (spotlightRaw != null && !TvmParental.allowedForLevel(spotlightRaw, age, levels)) {
                continue
            }
            val spotlight = spotlightRaw?.let { applyProgress(listOf(it), progress).firstOrNull() }

            val railObj = event.optJSONObject("rail")
            val railIds = Json.strings(railObj?.opt("items")).take(RAIL_LIMIT)
            val resolvedItems = ArrayList<MediaItem>()
            for (rid in railIds) {
                val resolved = item(rid) ?: catalog.meta(rid)?.item ?: continue
                if (TvmParental.allowedForLevel(resolved, age, levels)) {
                    resolvedItems.add(resolved)
                }
            }
            val itemsWithProgress = applyProgress(resolvedItems, progress)

            val enriched = JSONObject(event.toString())
            enriched.put("live", true)
            enriched.put("released", today >= release)
            enriched.put("kicker", eventKicker(release, today))
            enriched.put("spotlight", spotlight?.json() ?: JSONObject.NULL)
            enriched.put("featured", spotlight?.json() ?: JSONObject.NULL)
            enriched.put("items", Json.array(itemsWithProgress.map { it.json() }))
            out.put(enriched)
        }
        return Json.obj("events" to out)
    }

    suspend fun servicesJson(): JSONObject {
        val doc = resolvedContent.fresh("services")
        val raw = doc?.optJSONArray("services") ?: JSONArray()
        val connected = store.connectedServices(activeProfile()).toSet()
        val out = JSONArray()
        for (i in 0 until raw.length()) {
            val row = raw.optJSONObject(i) ?: continue
            val copy = JSONObject(row.toString())
            val id = Json.string(copy.opt("id")) ?: continue
            copy.put("connected", id in connected)
            out.put(copy)
        }
        return Json.obj("services" to out)
    }

    suspend fun setServiceConnected(id: String, connected: Boolean): JSONObject {
        val doc = resolvedContent.fresh("services")
        val raw = doc?.optJSONArray("services") ?: JSONArray()
        val validIds = HashSet<String>()
        for (i in 0 until raw.length()) {
            Json.string(raw.optJSONObject(i)?.opt("id"))?.let { validIds.add(it) }
        }
        if (id !in validIds) throw ClientException("Unknown service.")
        val profileId = activeProfile()
        val current = store.connectedServices(profileId).toMutableList()
        if (connected) {
            if (id !in current) current.add(id)
        } else {
            current.removeAll { it == id }
        }
        store.saveConnectedServices(profileId, current)
        return Json.obj("connected" to JSONArray(current))
    }

    suspend fun freeLiveJson(): JSONObject {
        val doc = resolvedContent.fresh("free-channels")
        val raw = doc?.optJSONArray("channels") ?: JSONArray()
        val age = ageLevel()
        val levels = parentalLevels()
        val out = JSONArray()
        for (i in 0 until raw.length()) {
            val row = raw.optJSONObject(i) ?: continue
            val group = Json.string(row.opt("group"))
            if (TvmParental.liveGroupAllowed(group, age, levels)) {
                out.put(JSONObject(row.toString()))
            }
        }
        return Json.obj("channels" to out)
    }

    fun clearCache() {
        synchronized(lock) { libraryCache = null }
        catalog.clear()
        store.clearCacheFiles()
    }

    /** A different Real-Debrid key is in use; its library is not this one. */
    fun forgetLibrary() {
        synchronized(lock) { libraryCache = null }
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
            val startAt: Double? = TvmTitle.resumePosition(entry)
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
        download: DownloadPrefs? = null,
        screenHeight: Int? = null,
        maxHeight: Int? = null,
        versionId: String? = null,
        client: PlaybackClient? = null,
    ): Pair<Int, JSONObject> {
        val token: String = rd.tokenValue()
            ?: return 409 to Json.obj("kind" to "unavailable", "reason" to "not-configured")
        if (TvmTitle.extractImdb(imdb) == null) {
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        var seasonNo: Int? = season
        var episodeNo: Int? = episode
        val metadata = catalog.meta(imdb)
        var catalogTitle: String? = metadata?.item?.title
        if (seasonNo == null || episodeNo == null) {
            val meta = metadata
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
            if (download != null && versionId == null && catalogTitle != null) {
                val matched = findLibraryPlayback(catalogTitle, seasonNo, episodeNo)
                if (matched != null) {
                    val owned = resolveOwnedLink(matched)
                    if (owned != null) return playFromLink(owned, matched)
                }
            }
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        // The plan's limit and this screen's (TvmDeviceChrome.playbackHeight),
        // then this device's decoders: copies it can play fully come first.
        // A download takes the quality asked for (within the plan); playing takes this screen's.
        val height: Int = capFor(download, screenHeight, maxHeight)
        val label = { it: RdStream -> "${it.name} ${it.title}" }
        // A download's audio language is a must: a copy marked as another
        // language, or as MULTi, is never taken instead.
        val spoken: List<RdStream> = if (download == null) streams else streams.filter { TvmPlaybackChoice.languageOk("${label(it)} ${it.details}", download.language) }
        if (spoken.isEmpty()) return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        // A copy that already failed here (decoder, no sound, never started)
        // is not offered again, so a retry moves on to another one.
        // A download never takes a taller copy than asked for.
        val fresh: List<RdStream> = spoken.filter { rd.streamHeight(label(it)) <= height && !TvmPlaybackMemory.hasFailed(sourceKey(it)) }
        // A source whose file is named as another episode, or as a commentary
        // edition or other extra, is not this episode (TvmEpisodeMatch).
        val proper: List<RdStream> = fresh.filter { TvmEpisodeMatch.fit(TvmEpisodeMatch.sourceFile(it.details.ifEmpty { it.title }), seasonNo, episodeNo) != TvmEpisodeMatch.Fit.WRONG }
        // The picker and default playback share the same ordering and safety checks.
        val prefs = TvmPrefs.load(store)
        val original = catalog.originalLanguageFor(metadata)
        val runtime = TvmVersions.runtimeSeconds(metadata?.item?.runtime)
        val ranked = if (download == null) TvmVersions.rankForPhone(proper, prefs, original, runtime, minOf(height, TvmDeviceCodecs.screenHeight), client, TvmDeviceCodecs.caps)
            .filter { versionId == null || it.version.id == versionId }.take(8)
        else TvmPlaybackChoice.order(proper, label, { rd.streamHeight(label(it)) }, TvmDeviceCodecs.caps).take(8).map { RankedVersion(it, TvmVersions.describeVersion(it, runtime)) }
        Log.i(TAG, "sources for $imdb S${seasonNo}E${episodeNo}: ${streams.size} found, height cap $height, ${fresh.size} not failed here, ${proper.size} this episode, trying ${ranked.size}")
        var last: JSONObject = Json.obj("kind" to "unavailable", "reason" to if (fresh.isEmpty()) "unsupported" else "empty")
        // Provider filenames can contradict their listings; check the resolved file too.
        fun selected(result: Pair<Int, JSONObject>, row: RankedVersion): Pair<Int, JSONObject> {
            result.second.put("version", row.version.json())
            result.second.put("originalLanguage", original ?: JSONObject.NULL)
            result.second.put("audioLanguages", JSONArray(row.version.languages))
            return chosen(result, row.stream, label(row.stream))
        }
        fun safeFile(result: Pair<Int, JSONObject>): Boolean {
            val filename = result.second.text("filename")
            val version = TvmVersions.describeVersion(RdStream("", filename, "", null, null, 0, true, false, filename), runtime)
            val needs = TvmPlaybackChoice.needs(filename, version.height ?: 1080)
            val caps = TvmDeviceCodecs.caps
            return fitsScreen(result, download, screenHeight, maxHeight) && (version.height ?: 1080) <= minOf(height, TvmDeviceCodecs.screenHeight, client?.maxHeight ?: Int.MAX_VALUE, TvmVersions.qualityCap(prefs.quality)) &&
                TvmPlaybackChoice.videoPlayable(needs, caps) && TvmPlaybackChoice.audioPlayable(needs, caps) && TvmVersions.supportsVersion(version, filename, client)
        }
        for (row in ranked) {
            val stream = row.stream
            if (stream.url.isNotEmpty()) {
                val resolved: String? = rd.resolveRedirect(stream.url)
                if (resolved != null && !rd.isTorrentioHost(resolved)) {
                    val result = playFromLink(resolved, mediaId ?: imdb)
                    if (result.first == 200 && !rightFile(result, seasonNo, episodeNo)) continue
                    if (result.first == 200 && (if (download == null) !safeFile(result) else !downloadable(result, download))) continue
                    if (result.first == 200) return selected(result, row)
                    last = result.second
                    if (last.text("reason", "") == "needs-auth") return result
                }
            }
            val hash: String? = stream.infoHash
            if (hash != null && hash.isNotEmpty()) {
                val magnet = playFromMagnet(hash, mediaId ?: imdb, seasonNo, episodeNo, stream.fileIdx)
                if (magnet.first == 200 && (if (download == null) !safeFile(magnet) else !downloadable(magnet, download))) continue
                if (magnet.first == 200) return selected(magnet, row)
                last = magnet.second
                if (last.text("reason", "") == "needs-auth") return magnet
            }
        }
        if (download != null && versionId == null && last.text("reason", "") == "empty" && catalogTitle != null) {
            val matched = findLibraryPlayback(catalogTitle, seasonNo, episodeNo)
            if (matched != null) {
                val owned = resolveOwnedLink(matched)
                if (owned != null) return playFromLink(owned, matched)
            }
        }
        return 409 to last
    }

    private fun playableSources(streams: List<RdStream>, season: Int?, episode: Int?): List<RdStream> = streams.filter {
        !TvmPlaybackMemory.hasFailed(sourceKey(it)) && TvmEpisodeMatch.fit(TvmEpisodeMatch.sourceFile(it.details.ifEmpty { it.title }), season, episode) != TvmEpisodeMatch.Fit.WRONG
    }

    /** The copy's own file name says it is no taller than this screen (or the download) needs. */
    private fun fitsScreen(
        result: Pair<Int, JSONObject>,
        download: DownloadPrefs? = null,
        screenHeight: Int? = null,
        maxHeight: Int? = null,
    ): Boolean {
        val name = result.second.text("filename", "")
        return name.isEmpty() || rd.streamHeight(name) <= capFor(download, screenHeight, maxHeight)
    }

    private fun capFor(download: DownloadPrefs?, screenHeight: Int? = null, maxHeight: Int? = null): Int =
        if (download == null) {
            minOf(TvmDeviceChrome.playbackHeight(plans.maxHeight()), screenCapFor(screenHeight, maxHeight))
        } else {
            minOf(download.maxHeight, plans.maxHeight())
        }

    /** A library copy may be downloaded: its language and size fit what was asked. */
    private fun downloadable(result: Pair<Int, JSONObject>, download: DownloadPrefs): Boolean {
        val name = result.second.text("filename", "")
        return TvmPlaybackChoice.languageOk(name, download.language) && rd.streamHeight(name) <= capFor(download)
    }

    /** One copy of a title, the same across searches. */
    private fun sourceKey(stream: RdStream): String =
        stream.infoHash?.takeIf { it.isNotEmpty() }?.let { "$it:${stream.fileIdx ?: 0}" } ?: stream.url

    /** Remembers which copy a stream URL came from, for TvmPlaybackMemory. */
    private fun chosen(result: Pair<Int, JSONObject>, stream: RdStream, label: String): Pair<Int, JSONObject> {
        val url = result.second.text("url", "")
        if (url.isNotEmpty()) TvmPlaybackMemory.served(url, sourceKey(stream))
        Log.i(TAG, "playing: ${label.replace('\n', ' ').take(160)}")
        return result
    }

    /**
     * One file of a torrent: the episode (or film) asked for, never the whole
     * torrent. A pack used to be added with every file selected and its first
     * file played, which for a series is S01E01 whatever was asked for
     * (TvmEpisodeMatch). A torrent with no file that fits is removed again,
     * so it does not linger in the person's library.
     */
    private suspend fun playFromMagnet(
        hash: String,
        mediaId: String?,
        season: Int?,
        episode: Int?,
        fileIdx: Int?,
    ): Pair<Int, JSONObject> {
        val links: List<String>
        var torrentId: String? = null
        try {
            val added: String = rd.addMagnet(hash)
            torrentId = added
            var info: RdTorrentInfo = rd.torrentInfo(added)
            // A new magnet lists its files once Real-Debrid has read it.
            for (step in 0 until 6) {
                if (info.files.isNotEmpty()) break
                Thread.sleep(500)
                info = rd.torrentInfo(added)
            }
            val picked = TvmEpisodeMatch.pickFile(
                info.files.map { TvmEpisodeMatch.File(it.id, it.path, it.bytes) },
                season, episode, fileIdx,
            )
            if (picked == null) {
                Log.i(TAG, "no file in this torrent is S${season}E${episode}; skipping it")
                runCatching { rd.deleteTorrent(added) }
                return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
            }
            try {
                rd.selectTorrentFiles(added, picked.id.toString())
            } catch (_: Throwable) {
                // Already-selected torrents answer 400; the links poll below decides.
            }
            links = rd.waitForTorrentLinks(added, files = picked.id.toString())
        } catch (error: Throwable) {
            if (isAuthFailure(error)) return 409 to Json.obj("kind" to "unavailable", "reason" to "needs-auth")
            torrentId?.let { id -> runCatching { rd.deleteTorrent(id) } }
            return 409 to Json.obj("kind" to "unavailable", "reason" to "empty")
        }
        var last: JSONObject = Json.obj("kind" to "unavailable", "reason" to "empty")
        // Only the chosen file is selected, so its link is the only one; any
        // other link (a torrent selected before) is checked by name below.
        for (link in links.take(6)) {
            val result = playFromLink(link, mediaId)
            if (result.first == 200 && !rightFile(result, season, episode)) continue
            if (result.first == 200) return result
            last = result.second
            if (last.text("reason", "") == "needs-auth") return result
        }
        return 409 to last
    }

    /** The file found is not another episode or an extra (TvmEpisodeMatch). */
    private fun rightFile(result: Pair<Int, JSONObject>, season: Int?, episode: Int?): Boolean {
        val name = result.second.text("filename", "")
        val fit = TvmEpisodeMatch.fit(name, season, episode)
        if (fit == TvmEpisodeMatch.Fit.WRONG) Log.w(TAG, "skipped $name: not S${season}E${episode}")
        return fit != TvmEpisodeMatch.Fit.WRONG
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

    /**
     * A copy of this title already in the person's library: for an episode,
     * only a file numbered as that very episode; for a film, one that is not
     * an episode or an extra. Any title match used to do, and a pack fell back
     * to its first file, so every episode played S01E01 (TvmEpisodeMatch).
     */
    private suspend fun findLibraryPlayback(title: String, season: Int?, episode: Int?): String? {
        val library: List<MediaItem> = libraryOrEmpty()
        val matches: List<MediaItem> = library.filter { item ->
            TvmTitle.titlesMatch(item.title, title) ||
                TvmTitle.titlesMatch(item.showTitle ?: "", title) ||
                TvmTitle.titlesMatch(item.filename ?: "", title)
        }
        fun fits(item: MediaItem): Boolean {
            val name = item.filename?.takeIf { it.isNotEmpty() } ?: item.title
            if (season != null && episode != null && item.season != null && item.episode != null) {
                return item.season == season && item.episode == episode && !TvmEpisodeMatch.isExtra(name)
            }
            val fit = TvmEpisodeMatch.fit(name, season, episode)
            return if (season != null && episode != null) fit == TvmEpisodeMatch.Fit.MATCH else fit != TvmEpisodeMatch.Fit.WRONG
        }
        val direct = matches.firstOrNull { !TvmTitle.looksLikePack(it.title, it.filename ?: "") && fits(it) }
        if (direct != null) return direct.id
        if (season == null || episode == null) return null
        for (pack in matches.filter { it.id.startsWith("rd:t:") }.take(8)) {
            val kids: List<MediaItem> = try {
                loadChildren(pack.id)
            } catch (_: Throwable) {
                continue
            }
            val picked = kids.firstOrNull { fits(it) }
            if (picked != null) return picked.id
        }
        return null
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
        age: Int,
        levels: List<AgeLevel>,
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
            val items: List<MediaItem> = source.filter {
                !used.contains(it.id) &&
                    !used.contains(it.title) &&
                    TvmParental.allowedForLevel(it, age, levels)
            }.take(RAIL_LIMIT)
            for (item in items) {
                used.add(item.id)
                used.add(item.title)
            }
            if (items.isNotEmpty()) {
                val hasMore = if (railSources(id).isNotEmpty()) true else null
                rails.add(CatalogRail(id, title, items, more = hasMore))
            }
        }

        take(bundle.catalog, "for-you", "You might like")
        take(bundle.moviesTop, "films", "Popular films")
        take(bundle.seriesTop, "series", "Popular series")
        take(bundle.moviesRated, "top-films", "Top rated films")
        take(bundle.seriesRated, "top-series", "Top rated series")
        take(bundle.newFilms, "new-films", "New films")
        take(bundle.recentTv, "new-series", "Recently updated")
        val first: MediaItem? = watching.firstOrNull()
        if (first != null) {
            val because: List<MediaItem> = bundle.catalog.filter { item ->
                !used.contains(item.id) &&
                    item.genres.any { first.genres.contains(it) } &&
                    TvmParental.allowedForLevel(item, age, levels)
            }.take(RAIL_LIMIT)
            if (because.isNotEmpty()) {
                rails.add(CatalogRail("because", "Because you watched ${first.title}", because))
            }
        }
        for ((id, title, names) in GENRE_RAILS) {
            val seenMovies: MutableSet<String> = mutableSetOf()
            val movies: MutableList<MediaItem> = mutableListOf()
            for (g in names) {
                for (item in catalog.genre("movie", g)) {
                    if (TvmParental.allowedForLevel(item, age, levels) && seenMovies.add(item.id)) {
                        movies.add(item)
                    }
                }
            }
            val seriesNames: List<String> = if (id == "anime") listOf("Animation") else names
            val seenShows: MutableSet<String> = mutableSetOf()
            val shows: MutableList<MediaItem> = mutableListOf()
            for (g in seriesNames) {
                for (item in catalog.genre("series", g)) {
                    if (TvmParental.allowedForLevel(item, age, levels) && seenShows.add(item.id)) {
                        shows.add(item)
                    }
                }
            }
            val mixed: MutableList<MediaItem> = mutableListOf()
            var i = 0
            while (mixed.size < RAIL_LIMIT && i < maxOf(movies.size, shows.size)) {
                if (i < movies.size && !used.contains(movies[i].id)) {
                    mixed.add(movies[i])
                    used.add(movies[i].id)
                }
                if (mixed.size >= RAIL_LIMIT) break
                if (i < shows.size && !used.contains(shows[i].id)) {
                    mixed.add(shows[i])
                    used.add(shows[i].id)
                }
                i += 1
            }
            if (mixed.isNotEmpty()) rails.add(CatalogRail(id, title, mixed, more = true))
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
        tile("tvm-stream", "TVM Stream", "#2f6bff", "TVM", "/apps/tvm.png", "internal:library", "hub", false, true),
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

    data class RailSource(val kind: String, val list: String, val genre: String? = null)

    companion object {
        val PROFILE_HUES: List<Int> = listOf(221, 190, 145, 38, 315)
        const val LIBRARY_TTL_MS: Long = 45_000
        const val RAIL_LIMIT: Int = 40
        const val PAGE_SIZE: Int = 50
        const val MAX_PAGE_ATTEMPTS: Int = 3
        val RAIL_ID_RE: Regex = Regex("^[a-z0-9-]{1,40}$")
        val QUALITY_LADDER: List<Int> = listOf(480, 720, 1080, 1440, 2160)

        /** Case-sensitive, as the Swift regex was: Real-Debrid emits lowercase. */
        val HLS_SUFFIX: Regex = Regex("""\.m3u8(\?|$)""")

        val GENRE_RAILS: List<Triple<String, String, List<String>>> = listOf(
            Triple("action", "Action & Adventure", listOf("Action", "Adventure")),
            Triple("scifi", "Sci-Fi & Fantasy", listOf("Sci-Fi", "Fantasy")),
            Triple("comedy", "Comedy", listOf("Comedy")),
            Triple("thriller", "Thrillers", listOf("Thriller")),
            Triple("drama", "Critically Acclaimed Drama", listOf("Drama")),
            Triple("crime", "Crime & Mystery", listOf("Crime", "Mystery")),
            Triple("horror", "Horror", listOf("Horror")),
            Triple("animation", "Animation & Family", listOf("Animation", "Family")),
            Triple("romance", "Romance", listOf("Romance")),
            Triple("documentary", "Documentaries", listOf("Documentary")),
            Triple("anime", "Anime", listOf("Anime")),
            Triple("history", "History & Biography", listOf("History", "Biography")),
            Triple("mystery", "Mystery & Suspense", listOf("Mystery")),
        )

        private val EXTRA_GENRE_ALIASES: Map<String, List<String>> = mapOf(
            "sci-fi" to listOf("Sci-Fi", "Fantasy"),
            "adventure" to listOf("Adventure"),
            "fantasy" to listOf("Fantasy"),
            "family" to listOf("Family"),
        )

        fun railSources(id: String): List<RailSource> = when (id) {
            "films" -> listOf(RailSource("movie", "top"))
            "series" -> listOf(RailSource("series", "top"))
            "top-films" -> listOf(RailSource("movie", "imdbRating"))
            "top-series" -> listOf(RailSource("series", "imdbRating"))
            "new-films" -> listOf(RailSource("movie", "year"))
            "new-series" -> listOf(RailSource("series", "last-videos"))
            else -> {
                val matched = GENRE_RAILS.firstOrNull { it.first == id }
                val names = matched?.third ?: EXTRA_GENRE_ALIASES[id]
                if (names == null) {
                    emptyList()
                } else {
                    val seriesNames = if (id == "anime") listOf("Animation") else names
                    names.map { RailSource("movie", "top", it) } +
                        seriesNames.map { RailSource("series", "top", it) }
                }
            }
        }

        fun interleave(lists: List<List<MediaItem>>): List<MediaItem> {
            val out = ArrayList<MediaItem>()
            val seen = HashSet<String>()
            val maxLen = lists.maxOfOrNull { it.size } ?: 0
            for (i in 0 until maxLen) {
                for (list in lists) {
                    if (i < list.size) {
                        val item = list[i]
                        if (seen.add(item.id)) out.add(item)
                    }
                }
            }
            return out
        }

        fun filterNewFilms(items: List<MediaItem>, currentYear: Int = LocalDate.now().year): List<MediaItem> =
            items.filter { it.kind == "movie" && (it.year ?: 0) >= currentYear - 1 }

        fun screenCapFor(screenHeight: Int?, maxHeight: Int?): Int {
            if (maxHeight != null && maxHeight >= 240) return minOf(2160, maxHeight)
            if (screenHeight != null && screenHeight >= 240) {
                return QUALITY_LADDER.firstOrNull { it >= screenHeight - 8 } ?: 2160
            }
            return 2160
        }

        fun localIsoDate(date: LocalDate = LocalDate.now(ZoneId.systemDefault())): String =
            date.toString()

        fun formatReleaseDayMonth(isoDate: String): String {
            val parsed = runCatching { LocalDate.parse(isoDate.trim()) }.getOrNull() ?: return isoDate
            val month = parsed.month.getDisplayName(TextStyle.FULL, Locale.ENGLISH)
            return "${parsed.dayOfMonth} $month"
        }

        fun eventKicker(release: String, today: String = localIsoDate()): String =
            if (today >= release) "In cinemas now" else "In cinemas ${formatReleaseDayMonth(release)}"

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
