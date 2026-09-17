package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant
import java.util.Locale
import java.util.UUID
import java.util.zip.GZIPInputStream

/*
 * Port of apps/ios/TVM/TVMUpdater.swift: preferences, the interface bundle the
 * app serves, the changelog, and the updater that keeps the bundle current
 * from GitHub. Same file names, same JSON, same rules. Change one, change both.
 */

/** Language and automatic updates, as TVMPrefs. */
data class TvmPrefs(var language: String, var autoUpdate: Boolean) {
    fun json(): JSONObject = Json.obj("language" to language, "autoUpdate" to autoUpdate)

    fun save(store: TvmStore) {
        store.writeJSON("prefs.json", json())
    }

    companion object {
        const val DEFAULT_LANGUAGE = "en"
        val LANGUAGES: Set<String> = setOf("en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh")

        fun load(store: TvmStore): TvmPrefs {
            val saved = store.readJSON("prefs.json") as? JSONObject ?: JSONObject()
            val language = saved.opt("language") as? String
            val allowed = if (language != null && language in LANGUAGES) language else DEFAULT_LANGUAGE
            val auto = saved.opt("autoUpdate") as? Boolean ?: true
            return TvmPrefs(allowed, auto)
        }

        fun acceptLanguage(code: String): String {
            val language = if (code in LANGUAGES) code else DEFAULT_LANGUAGE
            return if (language == "en") "en,en-US;q=0.9" else "$language,en;q=0.8"
        }
    }
}

/** What an interface bundle says about itself (build-info.json, from scripts/stamp-ui-bundle.mjs). */
data class TvmBundleInfo(val commit: String?, val contentHash: String?, val nativeApi: Int) {
    companion object {
        fun parse(text: String?): TvmBundleInfo {
            val saved = Json.parseObject(text)
            val commit = saved.text("commit").lowercase(Locale.US).ifEmpty { null }
            val hash = saved.text("contentHash").lowercase(Locale.US).ifEmpty { null }
            return TvmBundleInfo(commit, hash, Json.int(saved.opt("nativeApi")) ?: 0)
        }

        fun read(dir: File): TvmBundleInfo =
            parse(runCatching { File(dir, "build-info.json").readText(Charsets.UTF_8) }.getOrNull())
    }
}

/** What the APK itself carries. An interface so the rules can be tested off-device. */
interface TvmAppBundle {
    /** Commit this APK was built from (assets/BuildInfo.json), or "unknown". */
    fun appBuild(): String

    /** A file from the bundled interface (assets/ui/<path>), or null. */
    fun readBundled(path: String): ByteArray?

    object None : TvmAppBundle {
        override fun appBuild(): String = "unknown"
        override fun readBundled(path: String): ByteArray? = null
    }
}

/**
 * The interface this app serves: the copy inside the APK, or a newer one
 * downloaded from GitHub. A downloaded copy is only used on top of the exact
 * app build it was applied to, and only when this build's native code is new
 * enough for it — mirroring TVMBundledUI.
 */
class TvmBundledUi(private val store: TvmStore, private val app: TvmAppBundle) {
    companion object {
        const val OVERLAY = "BundledUI"
        const val STAGED = "BundledUI.staged"
        const val MARKER = "BundledUI.native.json"
        const val STAGED_META = "BundledUI.staged.json"
    }

    private val lock = Any()

    /** Whether the downloaded copy is in use; worked out once, reset whenever the folders change. */
    private var resolved: Boolean? = null

    val overlayDir: File get() = store.file(OVERLAY)
    val stagedDir: File get() = store.file(STAGED)

    fun appBuild(): String = app.appBuild()

    fun <T> withLock(body: () -> T): T = synchronized(lock) { body() }

    private fun bundledInfo(): TvmBundleInfo =
        TvmBundleInfo.parse(app.readBundled("build-info.json")?.toString(Charsets.UTF_8))

    private fun overlayUsable(): Boolean {
        if (!File(overlayDir, "index.html").isFile) return false
        val marker = store.readJSON(MARKER) as? JSONObject ?: return false
        if (marker.text("appBuild") != app.appBuild()) return false
        return TvmBundleInfo.read(overlayDir).nativeApi <= StandalonePolicy.NATIVE_API
    }

    private fun usingOverlayLocked(): Boolean = resolved ?: overlayUsable().also { resolved = it }

    fun usingOverlay(): Boolean = synchronized(lock) { usingOverlayLocked() }

    /** The build this app is showing. */
    fun currentInfo(): TvmBundleInfo = if (usingOverlay()) TvmBundleInfo.read(overlayDir) else bundledInfo()

    /** Bytes for an interface path, from the downloaded copy when it applies, otherwise from the APK. */
    fun read(path: String): ByteArray? {
        if (!usingOverlay()) return app.readBundled(path)
        val root = runCatching { overlayDir.canonicalFile }.getOrNull() ?: return null
        val file = runCatching { File(root, path).canonicalFile }.getOrNull() ?: return null
        if (!file.path.startsWith(root.path + File.separator)) return null
        return if (file.isFile) runCatching { file.readBytes() }.getOrNull() else null
    }

    /** After something else deleted the folders (a factory reset). */
    fun invalidate() {
        synchronized(lock) { resolved = null }
    }

    /**
     * Launch housekeeping, before anything is on screen. No network. Drops a
     * downloaded interface that belongs to another app build and puts a bundle
     * staged by the previous run in place.
     */
    fun prepare() {
        synchronized(lock) {
            resolved = null
            if (!overlayUsable()) {
                overlayDir.deleteRecursively()
                store.remove(MARKER)
            }
            promoteLocked(null)
        }
    }

    fun stagedCommitLocked(): String? {
        val meta = store.readJSON(STAGED_META) as? JSONObject ?: return null
        if (!File(stagedDir, "index.html").isFile) return null
        return meta.text("commit").ifEmpty { null }
    }

    /** Moves a verified download into the staging folder. Call inside [withLock]. */
    fun installStagedLocked(work: File, commit: String, entries: JSONArray) {
        stagedDir.deleteRecursively()
        if (!work.renameTo(stagedDir)) {
            work.copyRecursively(stagedDir, overwrite = true)
            work.deleteRecursively()
        }
        store.writeJSON(
            STAGED_META,
            Json.obj(
                "commit" to commit,
                "appBuild" to app.appBuild(),
                "entries" to entries,
                "stagedAt" to Instant.now().toString(),
            ),
        )
    }

    /** Moves a verified staged bundle into place. Call inside [withLock]. */
    fun promoteLocked(onlyCommit: String?): JSONObject? {
        val info = TvmBundleInfo.read(stagedDir)
        val meta = store.readJSON(STAGED_META) as? JSONObject
        val stagedCommit = meta?.text("commit").orEmpty()
        val valid = File(stagedDir, "index.html").isFile &&
            meta != null &&
            stagedCommit.isNotEmpty() &&
            info.commit != null &&
            TvmChangelog.sameCommit(stagedCommit, info.commit) &&
            meta.text("appBuild") == app.appBuild() &&
            info.nativeApi <= StandalonePolicy.NATIVE_API
        if (!valid) {
            stagedDir.deleteRecursively()
            store.remove(STAGED_META)
            return null
        }
        if (onlyCommit != null && !TvmChangelog.sameCommit(onlyCommit, stagedCommit)) return null
        val version = stagedCommit.take(7)
        val previous = (if (usingOverlayLocked()) TvmBundleInfo.read(overlayDir) else bundledInfo()).commit
        if (previous != null && TvmChangelog.sameCommit(previous, stagedCommit)) {
            // Already the interface on screen; nothing to announce twice.
            stagedDir.deleteRecursively()
            store.remove(STAGED_META)
            return Json.obj("version" to version, "commit" to stagedCommit, "changed" to false)
        }
        resolved = null
        overlayDir.deleteRecursively()
        if (!stagedDir.renameTo(overlayDir)) {
            val copied = runCatching { stagedDir.copyRecursively(overlayDir, overwrite = true) }.getOrDefault(false)
            if (!copied) return null
            stagedDir.deleteRecursively()
        }
        store.writeJSON(
            MARKER,
            Json.obj("appBuild" to app.appBuild(), "commit" to stagedCommit, "appliedAt" to Instant.now().toString()),
        )
        store.remove(STAGED_META)
        var entries = meta?.optJSONArray("entries") ?: JSONArray()
        if (entries.length() == 0) {
            entries = JSONArray().put(Json.obj("sha" to version, "title" to "Interface $version", "body" to ""))
        }
        TvmChangelog.writePending(store, version, previous?.take(7), stagedCommit, entries)
        return Json.obj("version" to version, "commit" to stagedCommit, "changed" to true)
    }
}

object TvmChangelog {
    const val FILE = "changelog.json"
    const val LIMIT = 12

    fun sameCommit(left: String, right: String): Boolean {
        val a = left.lowercase(Locale.US)
        val b = right.lowercase(Locale.US)
        if (a.isEmpty() || b.isEmpty()) return false
        return a == b || a.startsWith(b) || b.startsWith(a)
    }

    private fun titled(entries: JSONArray): List<JSONObject> =
        (0 until entries.length()).mapNotNull { entries.optJSONObject(it) }.filter { it.text("title").isNotEmpty() }

    /** Mirrors changesSince in apps/core/src/update/feed.ts and TVMChangelog.changes. */
    fun changes(entries: JSONArray, history: List<String>, since: String?): JSONArray {
        val valid = titled(entries)
        val picked: List<JSONObject> = when {
            since.isNullOrEmpty() -> valid
            else -> {
                val at = history.indexOfFirst { sameCommit(it, since) }
                if (at >= 0) {
                    val newer = history.subList(0, at)
                    valid.filter { entry -> newer.any { sameCommit(it, entry.text("sha")) } }
                } else {
                    val out = ArrayList<JSONObject>()
                    for (entry in valid) {
                        val sha = entry.text("sha")
                        if (sha.isNotEmpty() && sameCommit(sha, since)) break
                        out.add(entry)
                    }
                    out
                }
            }
        }
        return JSONArray(picked.take(LIMIT))
    }

    fun notes(entries: JSONArray): String {
        val titles = titled(entries).map { it.text("title").trim() }.filter { it.isNotEmpty() }
        if (titles.isEmpty()) return "The latest TVM interface"
        return titles.joinToString(" · ").take(400)
    }

    fun record(store: TvmStore): JSONObject? = store.readJSON(FILE) as? JSONObject

    fun writePending(store: TvmStore, version: String, from: String?, to: String?, entries: JSONArray) {
        if (entries.length() == 0) return
        store.writeJSON(
            FILE,
            Json.obj(
                "pending" to true,
                "version" to version,
                "appliedAt" to Instant.now().toString(),
                "entries" to entries,
                "from" to from,
                "to" to to,
            ),
        )
    }

    fun empty(): JSONObject = Json.obj(
        "pending" to false,
        "version" to "",
        "from" to null,
        "to" to null,
        "appliedAt" to "",
        "entries" to JSONArray(),
    )

    fun markSeen(store: TvmStore): JSONObject {
        val payload = record(store) ?: empty()
        payload.put("pending", false)
        store.writeJSON(FILE, payload)
        return payload
    }
}

/** The one network call the updater makes. An interface so tests need no network. */
fun interface TvmHttp {
    /** GET, following redirects. Returns the status and, for a success, the body. */
    fun get(url: String, timeoutMs: Int): Pair<Int, ByteArray>

    companion object {
        /** The largest bundle the updater will accept. */
        const val MAX_BYTES = 64 * 1024 * 1024

        val Default = TvmHttp { url, timeoutMs ->
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = true
            connection.useCaches = false
            connection.setRequestProperty("User-Agent", "tvm-android")
            try {
                val status = connection.responseCode
                if (status !in 200..299) return@TvmHttp (status to ByteArray(0))
                val body = connection.inputStream.use { readLimited(it, MAX_BYTES) }
                (status to body)
            } finally {
                connection.disconnect()
            }
        }

        fun readLimited(input: InputStream, limit: Int): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                if (out.size() > limit) throw IOException("download too large")
            }
            return out.toByteArray()
        }
    }
}

/**
 * Keeps the bundled interface current from GitHub, from the manifest published
 * next to the bundle on the `android-ui` release. Nothing blocks the launch: a
 * bundle found in the background is staged for the next open, and the
 * interface can apply one at once.
 */
class TvmUpdater(
    private val store: TvmStore,
    private val bundle: TvmBundledUi,
    private val http: TvmHttp = TvmHttp.Default,
) {
    companion object {
        const val REPO = "GL-327/TVM"
        const val RELEASE_TAG = "android-ui"
        const val ASSET_NAME = "tvm-android-ui.tar.gz"
        const val MANIFEST_NAME = "tvm-android-ui.json"

        fun downloadUrl(file: String): String = "https://github.com/$REPO/releases/download/$RELEASE_TAG/$file"

        fun sha256Hex(data: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

        private val HEX = Regex("^[0-9a-f]+$")
    }

    data class Manifest(
        val commit: String,
        val asset: String,
        val sha256: String,
        val nativeApi: Int,
        val contentHash: String,
        val entries: JSONArray,
        val history: List<String>,
    ) {
        companion object {
            fun parse(raw: Any?): Manifest? {
                val saved = raw as? JSONObject ?: return null
                val commit = saved.text("commit").lowercase(Locale.US)
                val asset = saved.text("asset")
                val sha = saved.text("sha256").lowercase(Locale.US)
                if (commit.length < 7 || !HEX.matches(commit)) return null
                if (asset.isEmpty() || asset.contains('/') || asset.contains("..")) return null
                if (sha.length != 64 || !HEX.matches(sha)) return null
                val entries = JSONArray()
                val rows = saved.optJSONArray("entries") ?: JSONArray()
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    if (row.text("title").isNotEmpty()) entries.put(row)
                }
                val history = ArrayList<String>()
                val shas = saved.optJSONArray("history") ?: JSONArray()
                for (index in 0 until shas.length()) {
                    val sha7 = shas.opt(index) as? String ?: continue
                    history.add(sha7.lowercase(Locale.US))
                }
                return Manifest(
                    commit = commit,
                    asset = asset,
                    sha256 = sha,
                    nativeApi = Json.int(saved.opt("nativeApi")) ?: 0,
                    contentHash = saved.text("contentHash").lowercase(Locale.US),
                    entries = entries,
                    history = history,
                )
            }
        }
    }

    fun snapshot(): JSONObject {
        val cache = store.readJSON("update-status.json") as? JSONObject
        return Json.obj(
            "current" to StandalonePolicy.VERSION,
            "currentCommit" to bundle.currentInfo().commit,
            "channel" to "github:$REPO#$RELEASE_TAG",
            "lastCheck" to (cache?.opt("lastCheck") as? String),
            "available" to (cache?.optJSONObject("available")),
            "configured" to false,
            "applyAllowed" to true,
            "applyReason" to null,
            "kind" to (cache?.opt("kind") as? String ?: "idle"),
            "notice" to (cache?.opt("notice") as? String),
            "autoUpdate" to TvmPrefs.load(store).autoUpdate,
            "changelog" to TvmChangelog.record(store),
        )
    }

    private fun remember(kind: String, available: JSONObject?, notice: String): JSONObject {
        store.writeJSON(
            "update-status.json",
            Json.obj(
                "kind" to kind,
                "lastCheck" to Instant.now().toString(),
                "notice" to notice,
                "available" to available,
            ),
        )
        return snapshot()
    }

    private sealed class Fetched {
        data class Found(val manifest: Manifest) : Fetched()
        data class Problem(val kind: String, val notice: String) : Fetched()
    }

    private fun fetchManifest(): Fetched {
        val (status, body) = try {
            http.get(downloadUrl(MANIFEST_NAME), 15_000)
        } catch (_: Exception) {
            return Fetched.Problem("failed", "Could not reach GitHub. Check the connection and try again.")
        }
        return when {
            status == 404 -> Fetched.Problem("no_release", "No Android interface is published on GitHub yet.")
            status == 429 -> Fetched.Problem("rate_limited", "GitHub rate-limited this check. Try again in a few minutes.")
            status == 401 || status == 403 -> Fetched.Problem("auth_required", "GitHub refused this check.")
            status !in 200..299 -> Fetched.Problem("failed", "GitHub answered $status. Try again later.")
            else -> {
                val manifest = Manifest.parse(runCatching { JSONObject(body.toString(Charsets.UTF_8)) }.getOrNull())
                if (manifest == null) {
                    Fetched.Problem("failed", "The update information on GitHub was incomplete.")
                } else {
                    Fetched.Found(manifest)
                }
            }
        }
    }

    /** Checks GitHub and records the answer; the manifest comes back only when it is worth applying. */
    private fun evaluate(): Pair<JSONObject, Manifest?> {
        val manifest = when (val fetched = fetchManifest()) {
            is Fetched.Problem -> return (remember(fetched.kind, null, fetched.notice) to null)
            is Fetched.Found -> fetched.manifest
        }
        val current = bundle.currentInfo()
        val commit = current.commit
        if (commit != null && TvmChangelog.sameCommit(commit, manifest.commit)) {
            return (remember("up_to_date", null, "You have the latest interface.") to null)
        }
        // Rebuilt for a commit that changed nothing here: same files, nothing to fetch.
        if (manifest.contentHash.isNotEmpty() && manifest.contentHash == current.contentHash) {
            return (remember("up_to_date", null, "You have the latest interface.") to null)
        }
        if (manifest.nativeApi > StandalonePolicy.NATIVE_API) {
            return (
                remember(
                    "app_update_required",
                    null,
                    "A newer TVM app is on GitHub Releases. Install it to get the latest interface.",
                ) to null
            )
        }
        val changelog = TvmChangelog.changes(manifest.entries, manifest.history, commit)
        val version = manifest.commit.take(7)
        val available = Json.obj(
            "version" to version,
            "commit" to manifest.commit,
            "notes" to TvmChangelog.notes(changelog),
            "changelog" to changelog,
        )
        return (remember("available", available, "Interface $version is ready to apply.") to manifest)
    }

    fun check(): JSONObject = evaluate().first

    /** Downloads and verifies a bundle into the staging folder. Nothing on screen changes until it is promoted. */
    fun stage(manifest: Manifest) {
        val already = bundle.withLock { bundle.stagedCommitLocked() }
        if (already != null && TvmChangelog.sameCommit(already, manifest.commit)) return

        val (status, data) = http.get(downloadUrl(manifest.asset), 120_000)
        if (status !in 200..299 || data.size <= 64) {
            throw ClientException("GitHub did not return the Android interface bundle.")
        }
        if (sha256Hex(data) != manifest.sha256) {
            throw ClientException("The downloaded interface did not match its published checksum.")
        }
        val work = store.file("BundledUI.download-${UUID.randomUUID()}")
        try {
            TvmArchive.extractTarGz(data, work)
            val info = TvmBundleInfo.read(work)
            val commit = info.commit
            if (!File(work, "index.html").isFile || commit == null || !TvmChangelog.sameCommit(commit, manifest.commit)) {
                throw ClientException("The downloaded interface was incomplete.")
            }
            if (info.nativeApi > StandalonePolicy.NATIVE_API) {
                throw ClientException("This interface needs a newer TVM app.")
            }
            val entries = TvmChangelog.changes(manifest.entries, manifest.history, bundle.currentInfo().commit)
            bundle.withLock { bundle.installStagedLocked(work, manifest.commit, entries) }
        } finally {
            work.deleteRecursively()
        }
    }

    /** Applies the published interface now, from the staging folder when it is already there. */
    fun apply(): JSONObject {
        val (status, manifest) = evaluate()
        if (manifest == null) {
            if (status.text("kind") == "up_to_date") {
                val version = bundle.currentInfo().commit?.take(7) ?: StandalonePolicy.VERSION
                return Json.obj("version" to version, "changed" to false, "restart" to "reload")
            }
            throw ClientException(status.text("notice").ifEmpty { "No interface update is available." })
        }
        stage(manifest)
        val result = bundle.withLock { bundle.promoteLocked(manifest.commit) }
            ?: throw ClientException("The new interface could not be put in place. Try again.")
        remember("up_to_date", null, "Applied interface ${result.text("version")}.")
        result.put("restart", "reload")
        result.put("changelog", TvmChangelog.record(store) ?: JSONObject.NULL)
        return result
    }

    /** Launch, in the background: find the next interface and stage it for the next open. */
    fun applyIfNeeded() {
        if (!TvmPrefs.load(store).autoUpdate) return
        val (status, manifest) = runCatching { evaluate() }.getOrNull() ?: return
        if (manifest == null || status.optJSONObject("available") == null) return
        runCatching { stage(manifest) }
    }
}

/** The tar.gz reader, as TVMArchive: plain files and folders only, nothing outside the destination. */
object TvmArchive {
    private const val BLOCK = 512

    fun extractTarGz(archive: ByteArray, dest: File) {
        dest.mkdirs()
        val root = dest.canonicalFile
        GZIPInputStream(ByteArrayInputStream(archive)).use { input ->
            val header = ByteArray(BLOCK)
            var longName: String? = null
            var total = 0L
            while (true) {
                if (!readFully(input, header)) break
                if (header.all { it.toInt() == 0 }) break
                val name = cString(header, 0, 100)
                val prefix = cString(header, 345, 155)
                val size = octal(header, 124, 12)
                val type = header[156].toInt().toChar()
                total += size
                if (size < 0 || total > TvmHttp.MAX_BYTES * 4L) throw IOException("archive too large")
                val data = ByteArray(size.toInt())
                if (!readFully(input, data)) throw IOException("archive truncated")
                val padding = (BLOCK - (size % BLOCK).toInt()) % BLOCK
                if (padding > 0 && !readFully(input, ByteArray(padding))) throw IOException("archive truncated")

                // GNU long names arrive as their own entry, naming the next one.
                if (type == 'L') {
                    longName = String(data, Charsets.UTF_8).trimEnd('\u0000').trim()
                    continue
                }
                var full = longName ?: if (prefix.isEmpty()) name else "$prefix/$name"
                longName = null
                if (full.startsWith("./")) full = full.substring(2)
                if (type == 'x' || type == 'g' || type == 'K') continue
                if (full.isEmpty() || full == "." || full == "./") continue
                if (full.startsWith("/") || full.split('/').any { it == ".." }) {
                    throw IOException("refusing archive path: $full")
                }
                val leaf = full.trimEnd('/').substringAfterLast('/')
                if (leaf.startsWith("._") || leaf == ".DS_Store") continue
                val target = File(root, full).canonicalFile
                if (target.path != root.path && !target.path.startsWith(root.path + File.separator)) {
                    throw IOException("refusing archive path: $full")
                }
                if (type == '5' || full.endsWith("/")) {
                    target.mkdirs()
                    continue
                }
                if (type != '0' && type != '\u0000' && type != '7') continue
                target.parentFile?.mkdirs()
                target.writeBytes(data)
            }
        }
    }

    private fun readFully(input: InputStream, buffer: ByteArray): Boolean {
        var offset = 0
        while (offset < buffer.size) {
            val read = input.read(buffer, offset, buffer.size - offset)
            if (read < 0) return offset == 0 && buffer.isEmpty()
            offset += read
        }
        return true
    }

    private fun cString(bytes: ByteArray, start: Int, length: Int): String {
        var end = start
        while (end < start + length && bytes[end].toInt() != 0) end += 1
        return String(bytes, start, end - start, Charsets.UTF_8).trim()
    }

    private fun octal(bytes: ByteArray, start: Int, length: Int): Long {
        val raw = cString(bytes, start, length).replace(" ", "")
        return if (raw.isEmpty()) 0L else raw.toLongOrNull(8) ?: -1L
    }
}
