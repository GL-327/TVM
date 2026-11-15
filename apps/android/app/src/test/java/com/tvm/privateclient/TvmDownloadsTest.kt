package com.tvm.privateclient

import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.content.ContentProvider
import android.content.ContentValues
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.net.ServerSocket
import kotlin.concurrent.thread
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * The download pipeline end to end, except Real-Debrid and the system's own
 * picker screen: a folder chosen through the Storage Access Framework (a
 * documents provider standing in for the phone's storage), a real HTTP
 * transfer that drops mid-file and resumes with a Range request, progress,
 * the completeness check, the file written into the chosen folder, the
 * offline copy found again, and a broken transfer leaving no file behind.
 */
@RunWith(RobolectricTestRunner::class)
class TvmDownloadsTest {
    /**
     * A folder on "the phone": documents are files in a temporary directory.
     * It answers the documents protocol the app uses (DocumentsContract:
     * create, open, query, delete) as a phone's storage provider does.
     * Robolectric cannot host a real DocumentsProvider's queries, so this is
     * a plain provider speaking the same calls.
     */
    class FolderProvider : ContentProvider() {
        companion object { lateinit var dir: File }
        private fun file(id: String) = if (id == "root") dir else File(dir, id)
        override fun onCreate() = true
        override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
            val target = extras?.getParcelable<Uri>("uri") ?: return null
            return when (method) {
                "android:createDocument" -> {
                    val name = extras.getString(Document.COLUMN_DISPLAY_NAME)!!
                    File(dir, name).createNewFile()
                    Bundle().apply { putParcelable("uri", DocumentsContract.buildDocumentUriUsingTree(target, name)) }
                }
                "android:deleteDocument" -> { file(DocumentsContract.getDocumentId(target)).delete(); Bundle() }
                else -> null
            }
        }
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
            val id = DocumentsContract.getDocumentId(uri)
            val f = file(id)
            val cols = projection ?: arrayOf(Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE)
            val cursor = MatrixCursor(cols)
            if (f.exists()) cursor.addRow(cols.map { c -> when (c) { Document.COLUMN_DISPLAY_NAME -> if (id == "root") "Movies" else f.name; Document.COLUMN_SIZE -> f.length(); else -> null } }.toTypedArray())
            return cursor
        }
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
            ParcelFileDescriptor.open(file(DocumentsContract.getDocumentId(uri)), ParcelFileDescriptor.parseMode(mode))
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    private val authority = "com.tvm.test.documents"
    private lateinit var dir: File
    private lateinit var server: ServerSocket
    private val body = Random(7).nextBytes(3 * 1024 * 1024 + 123)
    private val requests = AtomicInteger()
    private val ranges = mutableListOf<String?>()
    /** How the server misbehaves: drop the first answer after 1 MB, or always stop short. */
    private var dropFirst = true
    private var alwaysShort = false

    @Before fun setUp() {
        dir = Files.createTempDirectory("tvm-folder").toFile()
        FolderProvider.dir = dir
        Robolectric.buildContentProvider(FolderProvider::class.java).create(
            ProviderInfo().apply {
                this.authority = this@TvmDownloadsTest.authority
                exported = true; grantUriPermissions = true
            },
        )
        // A plain HTTP/1.1 file server with Range support.
        server = ServerSocket(0)
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    socket.use { sock ->
                        val reader = sock.getInputStream().bufferedReader()
                        var range: String? = null
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Range:", ignoreCase = true)) range = line.substringAfter(':').trim()
                        }
                        val n = requests.incrementAndGet()
                        synchronized(ranges) { ranges += range }
                        val from = range?.removePrefix("bytes=")?.substringBefore('-')?.toInt() ?: 0
                        val rest = body.size - from
                        val head = StringBuilder(if (from > 0) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                        if (from > 0) head.append("Content-Range: bytes $from-${body.size - 1}/${body.size}\r\n")
                        head.append("Content-Length: $rest\r\nContent-Type: video/x-matroska\r\nConnection: close\r\n\r\n")
                        val out = sock.getOutputStream()
                        out.write(head.toString().toByteArray())
                        val cut = when {
                            alwaysShort -> rest / 2
                            dropFirst && n == 1 -> 1024 * 1024
                            else -> rest
                        }
                        out.write(body, from, cut)
                        out.flush()
                        // Closing before the end is a dropped connection.
                    }
                }
            }
        }
    }

    @After fun tearDown() { server.close(); dir.deleteRecursively() }

    private fun downloads(): TvmDownloads {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        org.robolectric.Shadows.shadowOf(context).grantPermissions(android.Manifest.permission.MANAGE_DOCUMENTS)
        val store = TvmStore(Files.createTempDirectory("tvm-store").toFile())
        val url = "http://127.0.0.1:${server.localPort}/episode.mkv"
        return TvmDownloads(context.contentResolver, store) { _, _, _ -> Result.success(url to "South.Park.S01E05.1080p.mkv") }.also { d ->
            d.pickFolder = { DocumentsContract.buildTreeDocumentUri(authority, "root") }
        }
    }

    private fun waitFor(d: TvmDownloads, done: (String) -> Boolean): org.json.JSONObject {
        val until = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < until) {
            val job = d.list().getJSONArray("jobs").getJSONObject(0)
            if (done(job.getString("state"))) return job
            Thread.sleep(50)
        }
        throw AssertionError("download did not finish: ${d.list()}")
    }

    @Test
    fun aDroppedDownloadResumesAndLandsWholeInTheChosenFolder() {
        val d = downloads()
        assertNull(d.folderName())
        assertEquals("Movies", runBlocking { d.chooseFolder() })
        assertEquals("Movies", d.folderName())
        d.enqueue(listOf("tt0121955:1:5" to "South Park - S01E05"), "en", 1080)
        val seen = mutableSetOf<String>()
        val job = run {
            val until = System.currentTimeMillis() + 60_000
            var last: org.json.JSONObject? = null
            while (System.currentTimeMillis() < until) {
                last = d.list().getJSONArray("jobs").getJSONObject(0)
                seen += last.getString("state")
                if (last.getString("state") !in setOf("queued", "resolving", "downloading")) break
                Thread.sleep(20)
            }
            last!!
        }
        assertEquals("complete", job.getString("state"))
        assertTrue("went through downloading: $seen", "downloading" in seen)
        // One drop, one resume from where it stopped.
        assertEquals(2, requests.get())
        assertEquals(listOf(null, "bytes=${1024 * 1024}-"), synchronized(ranges) { ranges.toList() })
        val files = dir.listFiles()!!.filter { it.isFile }
        assertEquals(1, files.size)
        assertEquals("South Park - S01E05 [en].mkv", files[0].name)
        assertArrayEquals(body, files[0].readBytes())
        assertEquals(body.size.toLong(), job.getLong("bytes"))
        assertEquals(body.size.toLong(), job.getLong("total"))
        // Found again for offline playback.
        val offline = d.offlineCopy("tt0121955:1:5")
        assertNotNull(offline)
        assertTrue(offline!!.first.startsWith("content://$authority/"))
    }

    @Test
    fun aDownloadThatNeverCompletesFailsAndLeavesNoFile() {
        dropFirst = false
        alwaysShort = true
        val d = downloads()
        runBlocking { d.chooseFolder() }
        d.enqueue(listOf("tt0121955:1:6" to "South Park - S01E06"), "en", 1080)
        val job = waitFor(d) { it == "failed" || it == "complete" }
        assertEquals("failed", job.getString("state"))
        // It failed in the transfer (the file was created and written), not before it.
        assertEquals("The connection kept dropping. Retry this download.", job.optString("error"))
        assertTrue(requests.get() >= 2)
        assertEquals(emptyList<File>(), dir.listFiles()!!.filter { it.isFile })
        assertNull(d.offlineCopy("tt0121955:1:6"))
    }

    @Test
    fun noFolderNoDownload() {
        val d = downloads()
        val error = runCatching { d.enqueue(listOf("tt1" to "Film"), "en", 1080) }.exceptionOrNull()
        assertEquals("Choose a download folder first.", error?.message)
    }
}
