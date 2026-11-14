package com.tvm.privateclient

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread

/**
 * Downloads on the phone itself.
 *
 * The interface saved files with the browser's folder picker
 * (showDirectoryPicker), which Android's WebView does not have: Choose folder
 * was disabled and nothing could be downloaded. Here the folder is chosen with
 * Android's own picker (the Storage Access Framework, so no storage permission
 * is needed), and files are written straight into it by the app, one at a time,
 * resuming after a dropped connection. A file is only listed as complete once
 * every byte has arrived; anything less is removed. A completed download is
 * remembered by the title or episode it belongs to, and playing that title
 * plays the file on the phone (TvmLocalCore's /api/playback), offline.
 */
class TvmDownloads(
    private val resolver: ContentResolver,
    private val store: TvmStore,
    /** The copy to download: its URL and file name, or the reason there is none. */
    private val resolve: suspend (id: String, language: String, maxHeight: Int) -> Result<Pair<String, String>>,
) {
    /** Shows Android's folder picker; null when the person backs out. Set by MainActivity. */
    @Volatile var pickFolder: (suspend () -> Uri?)? = null

    private val lock = Any()
    private val jobs = mutableListOf<Job>()
    private val queue = LinkedBlockingQueue<Job>()
    private val cancelled = mutableSetOf<String>()

    class Job(
        val id: String,
        val mediaId: String,
        val title: String,
        val language: String,
        val maxHeight: Int,
        var state: String = "queued",
        var bytes: Long = 0,
        var total: Long = 0,
        var uri: String? = null,
        var name: String? = null,
        var error: String? = null,
    ) {
        fun json(folder: String?): JSONObject = Json.obj(
            "id" to id,
            "title" to title,
            "state" to state,
            "bytes" to bytes,
            "total" to total,
        ).apply {
            if (state == "complete" && name != null) put("path", listOfNotNull(folder, name).joinToString("/"))
            if (error != null) put("error", error)
        }

        fun saved(): JSONObject = json(null).apply {
            put("mediaId", mediaId); put("language", language); put("maxHeight", maxHeight)
            uri?.let { put("uri", it) }; name?.let { put("name", it) }
        }
    }

    init {
        // Jobs that were running when the app last closed did not finish.
        (store.readJSON(INDEX) as? JSONArray)?.let { saved ->
            for (i in 0 until saved.length()) {
                val o = saved.optJSONObject(i) ?: continue
                val job = Job(
                    id = o.optString("id"), mediaId = o.optString("mediaId"), title = o.optString("title"),
                    language = o.optString("language", "en"), maxHeight = o.optInt("maxHeight", 1080),
                    state = o.optString("state"), bytes = o.optLong("bytes"), total = o.optLong("total"),
                    uri = o.optString("uri").ifEmpty { null }, name = o.optString("name").ifEmpty { null },
                    error = o.optString("error").ifEmpty { null },
                )
                if (job.state in ACTIVE) {
                    job.uri?.let { delete(it) }
                    job.state = "failed"; job.uri = null; job.bytes = 0
                    job.error = "Stopped when TVM closed. Start it again."
                }
                jobs += job
            }
        }
        thread(name = "tvm-downloads", isDaemon = true) { work() }
    }

    // ---- The folder ---------------------------------------------------------------

    fun folderName(): String? {
        val tree = folderUri() ?: return null
        return (store.readJSON(FOLDER) as? JSONObject)?.optString("name")?.ifEmpty { null } ?: displayName(tree)
    }

    private fun folderUri(): Uri? {
        val raw = (store.readJSON(FOLDER) as? JSONObject)?.optString("uri")?.ifEmpty { null } ?: return null
        val uri = Uri.parse(raw)
        // Still allowed to write there (the permission is kept across restarts)?
        val held = resolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission }
        return if (held) uri else null
    }

    /** Opens Android's folder picker and keeps the chosen folder; null if none was chosen. */
    suspend fun chooseFolder(): String? {
        val picker = pickFolder ?: throw IOException("The folder picker is not available right now.")
        val tree = picker() ?: return null
        resolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        val name = displayName(tree) ?: "Chosen folder"
        store.writeJSON(FOLDER, Json.obj("uri" to tree.toString(), "name" to name))
        return name
    }

    private fun displayName(tree: Uri): String? = runCatching {
        val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        resolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    // ---- The queue ----------------------------------------------------------------

    fun list(): JSONObject = synchronized(lock) {
        val folder = folderName()
        Json.obj("jobs" to JSONArray(jobs.map { it.json(folder) }), "folder" to (folder ?: JSONObject.NULL))
    }

    fun enqueue(items: List<Pair<String, String>>, language: String, maxHeight: Int): JSONObject {
        if (folderUri() == null) throw IOException("Choose a download folder first.")
        synchronized(lock) {
            if (jobs.count { it.state in ACTIVE } + items.size > 1000) throw IOException("The download queue is full.")
            for ((mediaId, title) in items) {
                val job = Job(UUID.randomUUID().toString(), mediaId, title, language, maxHeight)
                jobs += job
                queue.put(job)
            }
            persist()
        }
        return list()
    }

    fun cancel(id: String) = synchronized(lock) {
        val job = jobs.firstOrNull { it.id == id } ?: return@synchronized
        if (job.state in ACTIVE) {
            cancelled += id
            if (job.state == "queued") { job.state = "cancelled"; queue.remove(job) }
            persist()
        }
    }

    /** A completed download of [mediaId] that is still there, to play on the phone. */
    fun offlineCopy(mediaId: String): Pair<String, String>? {
        val job = synchronized(lock) { jobs.lastOrNull { it.mediaId == mediaId && it.state == "complete" && it.uri != null } } ?: return null
        val uri = Uri.parse(job.uri)
        val exists = runCatching { resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_SIZE), null, null, null)?.use { it.moveToFirst() } == true }.getOrDefault(false)
        return if (exists) job.uri!! to (job.name ?: job.title) else null
    }

    private fun persist() {
        store.writeJSON(INDEX, JSONArray(jobs.map { it.saved() }))
    }

    private fun work() {
        while (true) {
            val job = queue.take()
            if (job.state != "queued") continue
            runCatching { download(job) }.onFailure { problem ->
                Log.w(TAG, "download failed: ${job.title}", problem)
                finish(job, "failed", problem.message ?: "Download failed.")
            }
        }
    }

    private fun stopped(job: Job) = synchronized(lock) { job.id in cancelled }

    private fun finish(job: Job, state: String, error: String? = null) = synchronized(lock) {
        if (state != "complete") {
            job.uri?.let { delete(it) }
            job.uri = null
        }
        job.state = if (job.id in cancelled) "cancelled" else state
        job.error = if (job.state == "failed") error else null
        cancelled -= job.id
        persist()
    }

    private fun download(job: Job) {
        synchronized(lock) { job.state = "resolving"; persist() }
        val found = runBlocking { resolve(job.mediaId, job.language, job.maxHeight) }
        if (stopped(job)) return finish(job, "cancelled")
        val (url, filename) = found.getOrElse { return finish(job, "failed", it.message ?: "No downloadable file was found.") }
        val tree = folderUri() ?: return finish(job, "failed", "The download folder is no longer available. Choose it again.")
        val ext = EXTENSION.find(filename)?.value?.lowercase() ?: ".mkv"
        val stem = job.title.replace(Regex("""[<>:"/\\|?*\u0000-\u001f]"""), "_").trim().trimEnd('.').take(140).ifEmpty { "TVM video" }
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val doc = DocumentsContract.createDocument(resolver, parent, mimeFor(ext), "$stem [${job.language}]$ext")
            ?: return finish(job, "failed", "The file could not be created in the download folder.")
        synchronized(lock) { job.uri = doc.toString(); job.name = displayNameOf(doc) ?: "$stem$ext"; job.state = "downloading"; job.bytes = 0; job.total = 0; persist() }

        var attempt = 0
        while (true) {
            if (stopped(job)) return finish(job, "cancelled")
            try {
                if (transfer(job, url, doc)) break
            } catch (problem: IOException) {
                // A dropped connection: carry on from the last byte written.
                attempt++
                Log.w(TAG, "download interrupted (${attempt}/$RETRIES) at ${job.bytes}: ${problem.message}")
                if (attempt >= RETRIES) return finish(job, "failed", "The connection kept dropping. Retry this download.")
                Thread.sleep(2_000L * attempt)
            }
        }
        if (stopped(job)) return finish(job, "cancelled")
        if (job.bytes == 0L || (job.total > 0 && job.bytes != job.total)) return finish(job, "failed", "The file was incomplete. Retry this download.")
        finish(job, "complete")
    }

    /** Copies the rest of the file (from job.bytes). True when the server says it is all there. */
    private fun transfer(job: Job, url: String, doc: Uri): Boolean {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.instanceFollowRedirects = true
        if (job.bytes > 0) connection.setRequestProperty("Range", "bytes=${job.bytes}-")
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw IOException("HTTP $status")
            val resumed = status == 206 && job.bytes > 0
            if (!resumed && job.bytes > 0) job.bytes = 0 // the server sent the whole file again
            val length = connection.contentLengthLong
            if (!resumed) job.total = if (length > 0) length else 0
            val out: OutputStream = resolver.openOutputStream(doc, if (resumed) "wa" else "wt") ?: throw IOException("The file could not be opened for writing.")
            out.use { sink ->
                connection.inputStream.use { source ->
                    val buffer = ByteArray(256 * 1024)
                    var lastSave = System.currentTimeMillis()
                    while (true) {
                        if (stopped(job)) return false
                        val n = source.read(buffer)
                        if (n < 0) break
                        sink.write(buffer, 0, n)
                        job.bytes += n
                        if (System.currentTimeMillis() - lastSave > 5_000) { lastSave = System.currentTimeMillis(); synchronized(lock) { persist() } }
                    }
                }
            }
            if (job.total > 0 && job.bytes < job.total) throw IOException("ended early at ${job.bytes} of ${job.total}")
            return true
        } finally {
            connection.disconnect()
        }
    }

    private fun displayNameOf(doc: Uri): String? = runCatching {
        resolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull()

    private fun delete(uri: String) {
        runCatching { DocumentsContract.deleteDocument(resolver, Uri.parse(uri)) }
    }

    companion object {
        private const val TAG = "TVMDownloads"
        private const val INDEX = "downloads.json"
        private const val FOLDER = "downloads-folder.json"
        private const val RETRIES = 6
        val ACTIVE = setOf("queued", "resolving", "downloading")
        private val EXTENSION = Regex("""\.(mp4|mkv|webm|m4v|mov|avi|ts|mpg|mpeg)$""", RegexOption.IGNORE_CASE)

        fun mimeFor(ext: String): String = when (ext.lowercase()) {
            ".mp4", ".m4v" -> "video/mp4"
            ".webm" -> "video/webm"
            ".mov" -> "video/quicktime"
            ".avi" -> "video/x-msvideo"
            ".ts" -> "video/mp2t"
            ".mpg", ".mpeg" -> "video/mpeg"
            else -> "video/x-matroska"
        }
    }
}
