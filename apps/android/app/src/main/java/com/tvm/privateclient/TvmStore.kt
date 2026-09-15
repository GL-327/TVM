package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * On-device persistence, a direct port of apps/ios/TVM/TVMStore.swift.
 *
 * Same file names, same JSON shapes, same defaults: the data written here is
 * read back by the same `apps/ui` interface the iPhone client serves, and stays
 * inspectable the same way, so it is plain JSON on disk rather than
 * SharedPreferences. The caller passes context.filesDir as the root.
 */

/** The tuple TVMStore.profiles() returns. Mutable so callers can edit a copy, as the Swift value type allows. */
data class ProfileRegistry(var activeId: String, val profiles: MutableList<ProfileRecord>)

class TvmStore(private val root: File) {
    private val monitor = Any()
    private val hues: List<Int> = listOf(350, 220, 140, 32, 280)

    init {
        synchronized(monitor) {
            root.mkdirs()
            // iOS keeps the provider secrets in the Keychain, which is reachable
            // from anywhere in the process. Android has no such store without a
            // dependency, so they live in the app-private container and the store
            // hands them the root it was given.
            RdKeychain.attach(root)
            XtreamKeychain.attach(root)
        }
    }

    fun file(name: String): File = File(root, name)

    fun readJSON(name: String): Any? {
        synchronized(monitor) {
            return readJsonFile(file(name))
        }
    }

    fun writeJSON(name: String, value: Any) {
        synchronized(monitor) {
            writeAtomic(file(name), serialize(value))
        }
    }

    fun remove(name: String) {
        synchronized(monitor) {
            file(name).deleteRecursively()
        }
    }

    fun clearCacheFiles() {
        remove("catalog-cache.json")
    }

    fun factoryReset() {
        synchronized(monitor) {
            val children = root.listFiles()
            if (children != null) {
                for (child in children) child.deleteRecursively()
            }
            RdKeychain.clear()
            XtreamKeychain.clear()
            root.mkdirs()
        }
    }

    fun profiles(): ProfileRegistry {
        synchronized(monitor) {
            val document = readJsonFile(file("profiles.json")) as? JSONObject
            val list = document?.opt("profiles") as? JSONArray
            if (document != null && list != null) {
                val profiles = ArrayList<ProfileRecord>()
                for (index in 0 until list.length()) {
                    val item = list.opt(index) as? JSONObject ?: continue
                    val id = item.opt("id") as? String ?: continue
                    val name = item.opt("name") as? String ?: continue
                    profiles.add(
                        ProfileRecord(
                            id = id,
                            name = name,
                            hue = (item.opt("hue") as? Number)?.toInt() ?: 220,
                            created = item.opt("created") as? String ?: isoNow(),
                        ),
                    )
                }
                val first = profiles.firstOrNull()
                if (first != null) {
                    val active = document.opt("activeId") as? String
                    val activeId = if (profiles.any { it.id == active }) (active ?: first.id) else first.id
                    return ProfileRegistry(activeId, profiles)
                }
            }
            val first = ProfileRecord(
                id = "profile-1",
                name = "Profile 1",
                hue = hues[0],
                created = isoNow(),
            )
            saveProfiles(activeId = first.id, profiles = listOf(first))
            return ProfileRegistry(first.id, arrayListOf(first))
        }
    }

    fun saveProfiles(activeId: String, profiles: List<ProfileRecord>) {
        synchronized(monitor) {
            writeJSON(
                "profiles.json",
                Json.obj(
                    "activeId" to activeId,
                    "profiles" to Json.array(profiles.map { it.json() }),
                ),
            )
            profileDir(activeId).mkdirs()
        }
    }

    fun profileDir(id: String): File = File(root, "profiles/$id")

    fun progress(profileId: String): Map<String, ProgressEntry> {
        synchronized(monitor) {
            val parsed = readJsonFile(File(profileDir(profileId), "progress.json")) as? JSONObject
                ?: return emptyMap()
            val out = LinkedHashMap<String, ProgressEntry>()
            val keys = parsed.keys()
            while (keys.hasNext()) {
                val id = keys.next()
                // The Swift casts the whole document to [String: [String: Any]],
                // so a single non-object row voids the file rather than the row.
                val entry = parsed.opt(id) as? JSONObject ?: return emptyMap()
                val position = (entry.opt("position") as? Number)?.toDouble() ?: continue
                val duration = (entry.opt("duration") as? Number)?.toDouble() ?: continue
                out[id] = ProgressEntry(
                    position = position,
                    duration = duration,
                    updated = entry.opt("updated") as? String ?: "",
                    completedAt = entry.opt("completedAt") as? String,
                    completions = (entry.opt("completions") as? Number)?.toInt() ?: 0,
                )
            }
            return out
        }
    }

    fun writeProgress(profileId: String, id: String, position: Double, duration: Double) {
        if (id.isEmpty() || !position.isFinite() || !duration.isFinite() || position < 0 || duration <= 0) return
        synchronized(monitor) {
            val all = LinkedHashMap(progress(profileId))
            val previous = all[id]
            val now = isoNow()
            val finished = position / duration > 0.96
            val previousFinished = previous?.isFinished == true
            val newlyFinished = finished && !previousFinished
            all[id] = ProgressEntry(
                position = position,
                duration = duration,
                updated = now,
                completedAt = if (newlyFinished) now else (previous?.completedAt ?: if (finished) now else null),
                completions = maxOf(previous?.completions ?: 0, if (previousFinished) 1 else 0) +
                    (if (newlyFinished) 1 else 0),
            )
            val body = JSONObject()
            for ((key, entry) in all) {
                val value = Json.obj(
                    "position" to entry.position,
                    "duration" to entry.duration,
                    "updated" to entry.updated,
                    "completions" to entry.completions,
                )
                entry.completedAt?.let { value.put("completedAt", it) }
                body.put(key, value)
            }
            profileDir(profileId).mkdirs()
            writeAtomic(File(profileDir(profileId), "progress.json"), serialize(body))
        }
    }

    // Only the caller's confirmed completed media enter this profile's notebook.
    fun finishedNotebook(profileId: String, items: List<MediaItem>): List<JSONObject> {
        synchronized(monitor) {
            val path = File(profileDir(profileId), "finished-notebook.json")
            val saved = ArrayList<JSONObject>()
            val stored = readJsonFile(path) as? JSONArray
            if (stored != null) {
                var usable = true
                for (index in 0 until stored.length()) {
                    val row = stored.opt(index) as? JSONObject
                    if (row == null) {
                        // A malformed element fails the Swift cast for the whole array.
                        usable = false
                        break
                    }
                    saved.add(row)
                }
                if (!usable) saved.clear()
            }
            val progress = progress(profileId)
            val completed = items.filter {
                progress[it.id]?.isFinished == true || progress[it.id]?.completedAt != null
            }
            val ids = completed.map { it.id }.toSet()
            val rows = ArrayList<JSONObject>()
            for (item in completed) {
                rows.add(Json.obj("id" to item.id, "title" to item.title, "year" to item.year))
            }
            for (row in saved) {
                if (!ids.contains(row.opt("id") as? String ?: "")) rows.add(row)
            }
            if (completed.isNotEmpty()) writeAtomic(path, serialize(Json.array(rows)))
            return rows
        }
    }

    fun recentMedia(profileId: String): List<MediaItem> {
        synchronized(monitor) {
            val raw = readJsonFile(File(profileDir(profileId), "recent-media.json")) as? JSONArray
                ?: return emptyList()
            return parseItems(raw)
        }
    }

    fun rememberMedia(items: List<MediaItem>, profileId: String) {
        synchronized(monitor) {
            val ids = items.map { it.id }.toSet()
            val saved = (items + recentMedia(profileId).filter { !ids.contains(it.id) }).take(300)
            profileDir(profileId).mkdirs()
            writeAtomic(
                File(profileDir(profileId), "recent-media.json"),
                serialize(Json.array(saved.map { it.json() })),
            )
        }
    }

    fun watchlist(profileId: String): List<MediaItem> {
        synchronized(monitor) {
            val parsed = readJsonFile(File(profileDir(profileId), "watchlist.json")) as? JSONArray
                ?: return emptyList()
            return parseItems(parsed)
        }
    }

    fun writeWatchlist(profileId: String, items: List<MediaItem>) {
        synchronized(monitor) {
            profileDir(profileId).mkdirs()
            writeAtomic(
                File(profileDir(profileId), "watchlist.json"),
                serialize(Json.array(items.take(200).map { it.json() })),
            )
        }
    }

    fun personalExport(activeId: String, profiles: List<ProfileRecord>, billing: JSONObject): JSONObject {
        val people = JSONArray()
        for (profile in profiles) {
            val progressBody = JSONObject()
            for ((key, entry) in progress(profile.id)) {
                progressBody.put(
                    key,
                    Json.obj(
                        "position" to entry.position,
                        "duration" to entry.duration,
                        "updated" to entry.updated,
                    ),
                )
            }
            val list = JSONArray()
            for (item in watchlist(profile.id)) {
                list.put(
                    Json.obj(
                        "id" to item.id,
                        "title" to item.title,
                        "year" to item.year,
                        "added" to (item.added ?: ""),
                    ),
                )
            }
            people.put(
                Json.obj(
                    "id" to profile.id,
                    "name" to profile.name,
                    "created" to profile.created,
                    "progress" to progressBody,
                    "watchlist" to list,
                ),
            )
        }
        val exclusions = JSONArray()
        exclusions.put("Provider passwords and tokens")
        exclusions.put("Playlist URLs and contents")
        exclusions.put("Encryption keys")
        exclusions.put("Other services’ account data")
        return Json.obj(
            "format" to "tvm-personal-data-v1",
            "exportedAt" to isoNow(),
            "policyVersion" to "2026-09-12",
            "activeProfileId" to activeId,
            "profiles" to people,
            "billing" to billing,
            "exclusions" to exclusions,
        )
    }

    private fun parseItems(array: JSONArray): List<MediaItem> {
        val out = ArrayList<MediaItem>()
        for (index in 0 until array.length()) {
            MediaItem.parse(array.opt(index))?.let { out.add(it) }
        }
        return out
    }

    private fun readJsonFile(target: File): Any? {
        val text = try {
            if (!target.isFile) return null
            target.readText(Charsets.UTF_8)
        } catch (_: Exception) {
            return null
        }
        val value = try {
            JSONTokener(text).nextValue()
        } catch (_: Exception) {
            return null
        }
        // JSONSerialization refuses top-level fragments; JSONTokener does not.
        return if (value is JSONObject || value is JSONArray) value else null
    }

    private fun serialize(value: Any): ByteArray {
        val text = try {
            when (value) {
                is JSONObject -> value.toString()
                is JSONArray -> value.toString()
                is Map<*, *> -> JSONObject(value as Map<*, *>).toString()
                is Collection<*> -> JSONArray(value as Collection<*>).toString()
                else -> "{}"
            }
        } catch (_: Exception) {
            "{}"
        }
        return text.toByteArray(Charsets.UTF_8)
    }

    private fun writeAtomic(target: File, bytes: ByteArray) {
        try {
            target.parentFile?.mkdirs()
            val temp = File(target.parentFile, target.name + ".tmp")
            try {
                temp.writeBytes(bytes)
                try {
                    Files.move(
                        temp.toPath(),
                        target.toPath(),
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE,
                    )
                } catch (_: Exception) {
                    if (!temp.renameTo(target)) {
                        target.writeBytes(bytes)
                        temp.delete()
                    }
                }
            } catch (_: Exception) {
                temp.delete()
            }
        } catch (_: Exception) {
            // Writes are best effort on both clients: the Swift uses `try?`.
        }
    }

    /** ISO8601DateFormatter's default output: internet date and time, UTC, whole seconds. */
    private fun isoNow(): String = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()
}

/**
 * The Real-Debrid token.
 *
 * iOS holds this in the Keychain as kSecAttrAccessibleWhenUnlockedThisDeviceOnly.
 * The Android counterpart without a dependency is the app-private container,
 * which is credential-encrypted: unreadable to other apps and unavailable until
 * the user has unlocked the device after boot.
 */
/*
 * The on-device Real-Debrid token store. Declared against RdTokenStore so
 * TvmRealDebrid takes a handle rather than reaching for a singleton, which is
 * what lets the unit tests run without a device.
 */
object RdKeychain : RdTokenStore {
    private val monitor = Any()

    @Volatile
    private var store: File? = null

    fun attach(root: File) {
        synchronized(monitor) { store = File(root, "secrets/rd-token") }
    }

    override fun read(): String? {
        synchronized(monitor) {
            val token = readSecret(store) ?: return null
            return token.ifEmpty { null }
        }
    }

    override fun save(token: String) {
        val trimmed = token.trim()
        if (trimmed.isEmpty()) {
            clear()
            return
        }
        synchronized(monitor) {
            val target = store
            if (target == null || !writeSecret(target, trimmed)) {
                throw ClientException("Unable to save the Real-Debrid token. Unlock your device and retry.")
            }
        }
    }

    fun clear() {
        synchronized(monitor) { store?.delete() }
    }
}

/** The Xtream portal password, stored the same way as the Real-Debrid token. */
object XtreamKeychain {
    private val monitor = Any()

    @Volatile
    private var store: File? = null

    fun attach(root: File) {
        synchronized(monitor) { store = File(root, "secrets/xtream-password") }
    }

    // Unlike the Real-Debrid token, an empty saved password reads back as "".
    fun read(): String? {
        synchronized(monitor) { return readSecret(store) }
    }

    fun save(password: String) {
        synchronized(monitor) {
            val target = store ?: return
            writeSecret(target, password)
        }
    }

    fun clear() {
        synchronized(monitor) { store?.delete() }
    }
}

private fun readSecret(target: File?): String? {
    val file = target ?: return null
    return try {
        if (!file.isFile) null else file.readText(Charsets.UTF_8)
    } catch (_: Exception) {
        null
    }
}

private fun writeSecret(target: File, value: String): Boolean = try {
    target.parentFile?.mkdirs()
    target.writeText(value, Charsets.UTF_8)
    true
} catch (_: Exception) {
    false
}
