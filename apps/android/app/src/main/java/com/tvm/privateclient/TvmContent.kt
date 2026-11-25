package com.tvm.privateclient

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class TvmContent(
    private val store: TvmStore,
    private val bundled: (String) -> String? = { null },
    private val http: TvmHttp = TvmHttp.Default,
    private val clock: () -> Long = System::currentTimeMillis,
    private val enableRefresh: Boolean = true,
) {
    companion object {
        const val REMOTE_BASE = "https://raw.githubusercontent.com/GL-327/TVM/main/packages/content"
        const val CONTENT_TTL_MS = 6L * 60 * 60 * 1000
        const val CONTENT_TIMEOUT_MS = 8_000

        val CONTENT_NAMES: Set<String> = setOf(
            "changelog",
            "events",
            "free-channels",
            "services",
            "avatars",
            "parental",
        )

        val REFRESHABLE: Map<String, String> = mapOf(
            "events" to "events",
            "free-channels" to "channels",
            "services" to "services",
            "avatars" to "sets",
        )

        fun validContent(name: String, doc: JSONObject): Boolean {
            if (name !in CONTENT_NAMES) return false
            if (name == "changelog") {
                return doc.opt("releases") is JSONArray
            }
            if (doc.optInt("schema", -1) != 1) return false
            val expectedKey = REFRESHABLE[name] ?: return true
            val items = doc.opt(expectedKey) as? JSONArray ?: return false
            return items.length() > 0
        }
    }

    private val lock = Any()
    private val memory = HashMap<String, JSONObject>()
    private val lastAttemptMs = HashMap<String, Long>()

    fun load(name: String): JSONObject? {
        if (name !in CONTENT_NAMES) return null
        if (name in REFRESHABLE) {
            synchronized(lock) { memory[name] }?.let { return it }
            readCached(name)?.let {
                synchronized(lock) { memory[name] = it }
                return it
            }
        }
        return readBundled(name)
    }

    suspend fun fresh(name: String): JSONObject? {
        if (name !in CONTENT_NAMES) return null
        if (name !in REFRESHABLE) return readBundled(name)
        if (enableRefresh) {
            refreshIfDue(name)
        }
        return load(name)
    }

    fun changelogPayload(): JSONObject {
        val doc = load("changelog")
        val releases = doc?.optJSONArray("releases") ?: JSONArray()
        return Json.obj(
            "current" to StandalonePolicy.VERSION,
            "releases" to releases,
        )
    }

    private suspend fun refreshIfDue(name: String) {
        val expectedKey = REFRESHABLE[name] ?: return
        val now = clock()
        val shouldFetch = synchronized(lock) {
            val last = lastAttemptMs[name] ?: 0L
            if (now - last < CONTENT_TTL_MS) {
                false
            } else {
                lastAttemptMs[name] = now
                true
            }
        }
        if (!shouldFetch) return

        val fetched = withContext(Dispatchers.IO) {
            runCatching {
                val (status, bytes) = http.get("$REMOTE_BASE/$name.json", CONTENT_TIMEOUT_MS)
                if (status !in 200..299 || bytes.isEmpty()) return@runCatching null
                val parsed = Json.parseObject(bytes.toString(Charsets.UTF_8)) ?: return@runCatching null
                val arr = parsed.opt(expectedKey) as? JSONArray
                if (arr == null || arr.length() == 0 || !validContent(name, parsed)) return@runCatching null
                parsed
            }.getOrNull()
        } ?: return

        writeCached(name, fetched)
        synchronized(lock) { memory[name] = fetched }
    }

    private fun readBundled(name: String): JSONObject? {
        val raw = runCatching { bundled(name) }.getOrNull()
            ?: readFromClasspath("content/$name.json")
            ?: readFromWorkspaceFile(name)
            ?: return null
        val parsed = Json.parseObject(raw) ?: return null
        return if (validContent(name, parsed)) parsed else null
    }

    private fun readFromClasspath(resource: String): String? =
        runCatching {
            javaClass.classLoader?.getResourceAsStream(resource)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        }.getOrNull()

    private fun readFromWorkspaceFile(name: String): String? {
        val candidates = listOf(
            File("src/main/assets/content/$name.json"),
            File("app/src/main/assets/content/$name.json"),
            File("../../packages/content/$name.json"),
            File("../../../packages/content/$name.json"),
        )
        return candidates.firstOrNull { it.isFile }?.let { runCatching { it.readText(Charsets.UTF_8) }.getOrNull() }
    }

    private fun readCached(name: String): JSONObject? {
        val f = store.contentCacheFile(name)
        if (!f.isFile) return null
        val parsed = runCatching { Json.parseObject(f.readText(Charsets.UTF_8)) }.getOrNull() ?: return null
        return if (validContent(name, parsed)) parsed else null
    }

    private fun writeCached(name: String, doc: JSONObject) {
        val target = store.contentCacheFile(name)
        target.parentFile?.mkdirs()
        val temp = File(target.parentFile, "$name.json.tmp")
        runCatching {
            temp.writeText(doc.toString(), Charsets.UTF_8)
            if (target.exists()) target.delete()
            if (!temp.renameTo(target)) {
                target.writeText(doc.toString(), Charsets.UTF_8)
                temp.delete()
            }
        }
    }
}
