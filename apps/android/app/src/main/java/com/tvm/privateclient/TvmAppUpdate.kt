package com.tvm.privateclient

import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Updates of the app itself (the APK), as opposed to TvmUpdater, which keeps
 * the interface inside it current.
 *
 * CI publishes every build of main as TVM.apk on the `android` release, with
 * "Build `<sha>`" in its notes. This compares that with the commit this APK was
 * built from (assets/BuildInfo.json), downloads the file, checks it against the
 * digest GitHub records for it, and leaves it ready for Android's installer.
 * Android itself refuses an APK not signed with the same key as the installed
 * app, so a download can only ever upgrade TVM, never replace it.
 */
class TvmAppUpdate(
    private val http: TvmHttp = TvmHttp.Default,
    /** This APK's commit, or "unknown" for a local build. */
    private val appBuild: () -> String,
) {
    data class Release(val build: String, val url: String, val sha256: String?, val size: Long)

    sealed class Check {
        data class Available(val release: Release) : Check()
        data class Current(val build: String) : Check()
        data class Unknown(val release: Release) : Check()
        data class Failed(val reason: String) : Check()
    }

    fun check(): Check {
        val (status, body) = try {
            http.get(API_URL, 15_000)
        } catch (_: Exception) {
            return Check.Failed("TVM could not reach GitHub. Check the connection and try again.")
        }
        if (status == 404) return Check.Failed("No Android app is published on GitHub yet.")
        if (status !in 200..299) return Check.Failed("GitHub did not answer the update check (HTTP $status).")
        val release = parseRelease(body.toString(Charsets.UTF_8))
            ?: return Check.Failed("The Android release on GitHub has no app in it.")
        val mine = appBuild().lowercase(Locale.US)
        return when {
            mine.isEmpty() || mine == "unknown" -> Check.Unknown(release)
            sameBuild(mine, release.build) -> Check.Current(mine)
            else -> Check.Available(release)
        }
    }

    /** Downloads the APK into [dir] and checks it. Returns the file, ready to install. */
    fun download(release: Release, dir: File, onProgress: (Long) -> Unit = {}): File {
        TvmHttp.progress.set(onProgress)
        val (status, data) = try {
            http.get(release.url, 180_000)
        } finally {
            TvmHttp.progress.remove()
        }
        if (status !in 200..299 || data.size < 1024) throw ClientException("GitHub did not return the TVM app.")
        if (release.size > 0 && data.size.toLong() != release.size) {
            throw ClientException("The download was incomplete. Try again.")
        }
        val expected = release.sha256
        if (expected != null && TvmUpdater.sha256Hex(data) != expected) {
            throw ClientException("The downloaded app did not match its published checksum.")
        }
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, "TVM-${release.build}.apk")
        apk.writeBytes(data)
        return apk
    }

    companion object {
        const val RELEASE_TAG = "android"
        const val ASSET = "TVM.apk"
        val API_URL = "https://api.github.com/repos/${TvmUpdater.REPO}/releases/tags/$RELEASE_TAG"
        val PAGE_URL = "https://github.com/${TvmUpdater.REPO}/releases/tag/$RELEASE_TAG"

        private val BUILD = Regex("""\|\s*Build\s*\|\s*`([0-9a-fA-F]{7,40})`""")

        /** The build and the APK from the release JSON; null when either is missing. */
        fun parseRelease(text: String): Release? {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
            val build = BUILD.find(json.optString("body", ""))?.groupValues?.get(1)?.lowercase(Locale.US) ?: return null
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val asset = assets.optJSONObject(i) ?: continue
                if (asset.optString("name") != ASSET) continue
                val url = asset.optString("browser_download_url", "")
                if (!url.startsWith("https://github.com/${TvmUpdater.REPO}/releases/download/")) return null
                val digest = asset.optString("digest", "")
                val sha = if (digest.startsWith("sha256:")) digest.removePrefix("sha256:").lowercase(Locale.US) else null
                return Release(build, url, sha, asset.optLong("size", 0L))
            }
            return null
        }

        /** Short and long forms of the same commit match. */
        fun sameBuild(a: String, b: String): Boolean {
            val x = a.lowercase(Locale.US)
            val y = b.lowercase(Locale.US)
            if (x.length < 7 || y.length < 7) return false
            return x.startsWith(y) || y.startsWith(x)
        }
    }
}
