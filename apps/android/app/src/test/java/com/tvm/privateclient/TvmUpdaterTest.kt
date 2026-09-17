package com.tvm.privateclient

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.GZIPOutputStream
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The interface updater, against a pretend GitHub.
 *
 * The same rules as TVMUpdater.swift and apps/core/src/update/feed.ts. The
 * failure these exist for: the phones compared their interface with the tip
 * of GitHub main, which is often a commit that built no new interface, so an
 * update was always "available" and applying it reloaded the app forever.
 */
class TvmUpdaterTest {
    private val dirs = mutableListOf<File>()
    private val app = object : TvmAppBundle {
        var build = "apk1234"
        val files = mutableMapOf<String, ByteArray>()
        override fun appBuild(): String = build
        override fun readBundled(path: String): ByteArray? = files[path]
    }

    @After
    fun cleanUp() {
        dirs.forEach { it.deleteRecursively() }
        dirs.clear()
    }

    private fun store(): TvmStore {
        val dir = Files.createTempDirectory("tvm-updater").toFile()
        dirs.add(dir)
        return TvmStore(dir)
    }

    private fun stamp(commit: String, nativeApi: Int = StandalonePolicy.NATIVE_API, hash: String = ""): ByteArray =
        JSONObject().put("commit", commit).put("nativeApi", nativeApi).put("contentHash", hash).toString().toByteArray()

    /** A minimal ustar writer, so the test builds the same kind of archive CI publishes. */
    private fun tarGz(files: Map<String, ByteArray>): ByteArray {
        val tar = ByteArrayOutputStream()
        fun octal(value: Long, width: Int): ByteArray =
            (java.lang.Long.toOctalString(value).padStart(width - 1, '0') + "\u0000").toByteArray()
        for ((name, data) in files) {
            val header = ByteArray(512)
            name.toByteArray().copyInto(header, 0)
            octal(420, 8).copyInto(header, 100)
            octal(0, 8).copyInto(header, 108)
            octal(0, 8).copyInto(header, 116)
            octal(data.size.toLong(), 12).copyInto(header, 124)
            octal(0, 12).copyInto(header, 136)
            header[156] = '0'.code.toByte()
            "ustar\u000000".toByteArray().copyInto(header, 257)
            for (index in 148 until 156) header[index] = ' '.code.toByte()
            val sum = header.sumOf { it.toInt() and 0xff }
            octal(sum.toLong(), 7).copyInto(header, 148)
            tar.write(header)
            tar.write(data)
            val padding = (512 - data.size % 512) % 512
            tar.write(ByteArray(padding))
        }
        tar.write(ByteArray(1024))
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(tar.toByteArray()) }
        return out.toByteArray()
    }

    private class FakeGitHub {
        val files = mutableMapOf<String, ByteArray>()
        val asked = mutableListOf<String>()
        val http = TvmHttp { url, _ ->
            asked.add(url)
            val name = url.substringAfterLast('/')
            val body = files[name]
            if (body == null) (404 to ByteArray(0)) else (200 to body)
        }
    }

    private fun publish(github: FakeGitHub, commit: String, nativeApi: Int = StandalonePolicy.NATIVE_API, hash: String = "") {
        val bundle = tarGz(
            mapOf(
                "./index.html" to "<html>$commit</html>".toByteArray(),
                "./build-info.json" to stamp(commit, nativeApi, hash),
                "./assets/app.js" to "console.log('$commit')".toByteArray(),
            ),
        )
        github.files[TvmUpdater.ASSET_NAME] = bundle
        github.files[TvmUpdater.MANIFEST_NAME] = JSONObject()
            .put("commit", commit)
            .put("asset", TvmUpdater.ASSET_NAME)
            .put("sha256", TvmUpdater.sha256Hex(bundle))
            .put("nativeApi", nativeApi)
            .put("contentHash", hash)
            .put(
                "entries",
                JSONArray()
                    .put(JSONObject().put("sha", commit.take(7)).put("title", "Fix the sign-in form"))
                    .put(JSONObject().put("sha", "aaaaaaa").put("title", "Already installed")),
            )
            .put("history", JSONArray().put(commit.take(7)).put("d0c5123").put("aaaaaaa"))
            .toString()
            .toByteArray()
    }

    @Test
    fun jsonNullNeverReadsAsTheWordNull() {
        val saved = JSONObject("{\"tier\":null,\"name\":\"x\",\"count\":3}")
        assertEquals("", saved.text("tier"))
        assertEquals("fallback", saved.text("tier", "fallback"))
        assertEquals("fallback", saved.text("missing", "fallback"))
        assertEquals("x", saved.text("name"))
        assertEquals("3", saved.text("count"))
        assertEquals("", JSONArray("[null]").text(0))
    }

    @Test
    fun manifestParsingRefusesAnythingIncomplete() {
        val sha = "a".repeat(64)
        val good = TvmUpdater.Manifest.parse(
            JSONObject("{\"commit\":\"ABCDEF1234567\",\"asset\":\"tvm-android-ui.tar.gz\",\"sha256\":\"$sha\",\"nativeApi\":2,\"entries\":[{\"sha\":\"abcdef1\",\"title\":\"Newest\"},{\"title\":\"\"}],\"history\":[\"abcdef1\",7]}"),
        )
        assertEquals("abcdef1234567", good?.commit)
        assertEquals(1, good?.entries?.length())
        assertEquals(listOf("abcdef1"), good?.history)
        assertNull(TvmUpdater.Manifest.parse(JSONObject("{\"commit\":\"nothex!\",\"asset\":\"a.tar.gz\",\"sha256\":\"$sha\"}")))
        assertNull(TvmUpdater.Manifest.parse(JSONObject("{\"commit\":\"abcdef1\",\"asset\":\"../evil\",\"sha256\":\"$sha\"}")))
        assertNull(TvmUpdater.Manifest.parse(JSONObject("{\"commit\":\"abcdef1\",\"asset\":\"a.tar.gz\",\"sha256\":\"short\"}")))
        assertNull(TvmUpdater.Manifest.parse(null))
    }

    /** The same vectors as changesSince in apps/core/src/update/update.test.ts. */
    @Test
    fun changesUseTheHistoryToFindTheRunningBuild() {
        val entries = JSONArray()
            .put(JSONObject().put("sha", "eee5555").put("title", "Newest interface change"))
            .put(JSONObject().put("sha", "ccc3333").put("title", "Older interface change"))
        val history = listOf("eee5555", "ddd4444", "ccc3333", "bbb2222")
        fun titles(current: String?): List<String> {
            val out = TvmChangelog.changes(entries, history, current)
            return (0 until out.length()).map { out.getJSONObject(it).getString("title") }
        }
        assertEquals(listOf("Newest interface change"), titles("ddd4444" + "0".repeat(33)))
        assertEquals(listOf("Newest interface change", "Older interface change"), titles("bbb2222"))
        assertEquals(emptyList<String>(), titles("eee5555"))
        assertEquals(2, titles(null).size)
    }

    @Test
    fun appliesAPublishedInterfaceOnceAndThenReportsItIsCurrent() {
        val store = store()
        app.files["build-info.json"] = stamp("aaaaaaa")
        app.files["index.html"] = "<html>bundled</html>".toByteArray()
        val bundle = TvmBundledUi(store, app)
        val github = FakeGitHub()
        val commit = "bbbbbbb" + "1".repeat(33)
        publish(github, commit)
        val updater = TvmUpdater(store, bundle, github.http)

        val status = updater.check()
        assertEquals("available", status.getString("kind"))
        val changelog = status.getJSONObject("available").getJSONArray("changelog")
        assertEquals(1, changelog.length())
        assertEquals("Fix the sign-in form", changelog.getJSONObject(0).getString("title"))

        val applied = updater.apply()
        assertTrue(applied.getBoolean("changed"))
        assertEquals("reload", applied.getString("restart"))
        assertEquals("bbbbbbb", applied.getString("version"))
        assertEquals("<html>$commit</html>", String(bundle.read("index.html")!!))
        assertTrue(TvmChangelog.record(store)!!.getBoolean("pending"))

        // The loop this replaced: after applying, nothing is available any more.
        assertEquals("up_to_date", updater.check().getString("kind"))
        val again = updater.apply()
        assertFalse(again.getBoolean("changed"))
        assertEquals(1, github.asked.count { it.endsWith(TvmUpdater.ASSET_NAME) })
    }

    @Test
    fun skipsTheDownloadWhenOnlyTheCommitChanged() {
        val store = store()
        val hash = "c".repeat(64)
        app.files["build-info.json"] = stamp("aaaaaaa", hash = hash)
        val github = FakeGitHub()
        publish(github, "ddddddd" + "2".repeat(33), hash = hash)
        val updater = TvmUpdater(store, TvmBundledUi(store, app), github.http)
        assertEquals("up_to_date", updater.check().getString("kind"))
        assertFalse(updater.apply().getBoolean("changed"))
        assertTrue(github.asked.none { it.endsWith(TvmUpdater.ASSET_NAME) })
    }

    @Test
    fun neverAppliesAnInterfaceThatNeedsNewerNativeCode() {
        val store = store()
        app.files["build-info.json"] = stamp("aaaaaaa")
        val github = FakeGitHub()
        publish(github, "eeeeeee" + "3".repeat(33), nativeApi = StandalonePolicy.NATIVE_API + 1)
        val updater = TvmUpdater(store, TvmBundledUi(store, app), github.http)
        assertEquals("app_update_required", updater.check().getString("kind"))
        try {
            updater.apply()
            fail("apply must refuse")
        } catch (expected: ClientException) {
            assertTrue(expected.message!!.contains("newer TVM app"))
        }
        assertTrue(github.asked.none { it.endsWith(TvmUpdater.ASSET_NAME) })
    }

    @Test
    fun refusesABundleThatDoesNotMatchItsChecksum() {
        val store = store()
        app.files["build-info.json"] = stamp("aaaaaaa")
        val github = FakeGitHub()
        publish(github, "fffffff" + "4".repeat(33))
        github.files[TvmUpdater.ASSET_NAME] = tarGz(mapOf("index.html" to "tampered".toByteArray()))
        val updater = TvmUpdater(store, TvmBundledUi(store, app), github.http)
        try {
            updater.apply()
            fail("apply must refuse")
        } catch (expected: ClientException) {
            assertTrue(expected.message!!.contains("checksum"))
        }
        assertFalse(File(store.file(TvmBundledUi.OVERLAY), "index.html").exists())
    }

    @Test
    fun aBackgroundStageGoesLiveOnTheNextLaunchOnly() {
        val store = store()
        app.files["build-info.json"] = stamp("aaaaaaa")
        app.files["index.html"] = "<html>bundled</html>".toByteArray()
        val github = FakeGitHub()
        val commit = "1234567" + "5".repeat(33)
        publish(github, commit)

        val running = TvmBundledUi(store, app)
        TvmUpdater(store, running, github.http).applyIfNeeded()
        // Nothing changes under the viewer.
        assertEquals("<html>bundled</html>", String(running.read("index.html")!!))

        val nextLaunch = TvmBundledUi(store, app)
        nextLaunch.prepare()
        assertEquals("<html>$commit</html>", String(nextLaunch.read("index.html")!!))
        assertEquals("1234567", TvmChangelog.record(store)!!.getString("version"))
    }

    @Test
    fun aDownloadedInterfaceIsDroppedWhenADifferentAppIsInstalled() {
        val store = store()
        app.files["build-info.json"] = stamp("aaaaaaa")
        app.files["index.html"] = "<html>bundled</html>".toByteArray()
        val github = FakeGitHub()
        val commit = "7654321" + "6".repeat(33)
        publish(github, commit)
        val bundle = TvmBundledUi(store, app)
        TvmUpdater(store, bundle, github.http).apply()
        assertTrue(bundle.usingOverlay())

        app.build = "newapk99"
        val reinstalled = TvmBundledUi(store, app)
        reinstalled.prepare()
        assertFalse(reinstalled.usingOverlay())
        assertEquals("<html>bundled</html>", String(reinstalled.read("index.html")!!))
        assertFalse(store.file(TvmBundledUi.OVERLAY).exists())
    }

    @Test
    fun archivesCannotWriteOutsideTheirFolder() {
        val dest = Files.createTempDirectory("tvm-archive").toFile()
        dirs.add(dest)
        try {
            TvmArchive.extractTarGz(tarGz(mapOf("../escape.txt" to "no".toByteArray())), File(dest, "inside"))
            fail("a traversal must be refused")
        } catch (expected: java.io.IOException) {
            assertTrue(expected.message!!.contains("refusing"))
        }
        assertFalse(File(dest, "escape.txt").exists())
        TvmArchive.extractTarGz(tarGz(mapOf("./a/b.txt" to "yes".toByteArray(), "._junk" to "x".toByteArray())), File(dest, "ok"))
        assertEquals("yes", File(dest, "ok/a/b.txt").readText())
        assertFalse(File(dest, "ok/._junk").exists())
        assertNotNull(TvmPrefs.load(TvmStore(File(dest, "prefs"))))
    }
}
