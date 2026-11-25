package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlin.math.ceil

data class AgeLevel(
    val id: String,
    val maxAge: Int,
    val label: String,
    val summary: String,
    val allowGenres: Set<String>?,
    val blockGenres: Set<String>?,
    val ratingMax: Set<String>?,
    val liveGroups: Set<String>?,
)

class PinException(
    val httpStatus: Int,
    val errorCode: String,
    val retryAfter: Int? = null,
) : RuntimeException(errorCode) {
    fun json(): JSONObject {
        val out = Json.obj("error" to errorCode)
        if (retryAfter != null) out.put("retryAfter", retryAfter)
        return out
    }
}

object TvmParental {
    val VALID_AGES: Set<Int> = setOf(7, 12, 15, 18)

    val FALLBACK_LEVELS: List<AgeLevel> = listOf(
        AgeLevel(
            id = "kids-young",
            maxAge = 7,
            label = "Kids 7+",
            summary = "Animation, family and U/G titles only.",
            allowGenres = setOf("animation", "family", "comedy"),
            blockGenres = setOf("horror", "thriller", "crime", "war", "western", "mystery", "drama", "erotica"),
            ratingMax = setOf("G", "TV-Y", "TV-Y7", "TV-G", "U"),
            liveGroups = setOf("kids", "family", "cartoons", "documentary", "music"),
        ),
        AgeLevel(
            id = "kids-older",
            maxAge = 12,
            label = "Kids 12+",
            summary = "Family films and series up to PG / 12A.",
            allowGenres = null,
            blockGenres = setOf("horror", "thriller", "crime", "erotica"),
            ratingMax = setOf("G", "PG", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "U", "12", "12A", "PG-13", "TV-14"),
            liveGroups = setOf("kids", "family", "cartoons", "documentary", "education", "music", "sports"),
        ),
        AgeLevel(
            id = "teen",
            maxAge = 15,
            label = "Teen 15+",
            summary = "Most films and series up to 15; personal files stay visible.",
            allowGenres = null,
            blockGenres = setOf("erotica"),
            ratingMax = null,
            liveGroups = null,
        ),
        AgeLevel(
            id = "adult",
            maxAge = 18,
            label = "Adult 18+",
            summary = "Unrestricted access to all titles and live TV groups.",
            allowGenres = null,
            blockGenres = null,
            ratingMax = null,
            liveGroups = null,
        ),
    )

    private val KNOWN_RATINGS: Set<String> = setOf(
        "G", "PG", "PG-13", "R", "NC-17", "X", "U",
        "12", "12A", "13", "15", "16", "18",
        "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG", "TV-14", "TV-MA",
    )

    private val DECIMAL_SCORE_RE = Regex("^\\d+\\.\\d+$")

    fun normalizeAge(raw: Any?, kind: String): Int? {
        if (raw == null || raw === JSONObject.NULL) return if (kind == "kids") 7 else 18
        val num = when (raw) {
            is Number -> raw.toInt()
            is String -> raw.trim().toIntOrNull()
            else -> null
        } ?: return null
        return if (num in VALID_AGES) num else null
    }

    fun defaultAge(kind: String): Int = if (kind == "kids") 7 else 18

    fun levels(content: TvmContent? = null): List<AgeLevel> {
        val array = content?.load("parental")?.optJSONArray("levels") ?: return FALLBACK_LEVELS
        val parsed = ArrayList<AgeLevel>()
        for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            val id = Json.string(row.opt("id")) ?: continue
            val maxAge = Json.int(row.opt("maxAge")) ?: continue
            parsed.add(
                AgeLevel(
                    id = id,
                    maxAge = maxAge,
                    label = Json.string(row.opt("label")) ?: "$maxAge+",
                    summary = Json.string(row.opt("summary")) ?: "",
                    allowGenres = lowercaseSet(row.optJSONArray("allowGenres")),
                    blockGenres = lowercaseSet(row.optJSONArray("blockGenres")),
                    ratingMax = uppercaseSet(row.optJSONArray("ratingMax")),
                    liveGroups = lowercaseSet(row.optJSONArray("liveGroups")),
                ),
            )
        }
        return if (parsed.isEmpty()) FALLBACK_LEVELS else parsed.sortedBy { it.maxAge }
    }

    fun levelForAge(maxAge: Int, levels: List<AgeLevel> = FALLBACK_LEVELS): AgeLevel {
        val list = levels.ifEmpty { FALLBACK_LEVELS }
        return list.firstOrNull { it.maxAge >= maxAge } ?: list.last()
    }

    fun allowedForLevel(item: MediaItem, maxAge: Int, levels: List<AgeLevel> = FALLBACK_LEVELS): Boolean {
        if (maxAge >= 18) return true
        val level = levelForAge(maxAge, levels)
        val genres = item.genres.map { it.trim().lowercase() }.filter { it.isNotEmpty() }

        // Personal library files without genre metadata remain hidden under Teen 15+.
        if (item.kind == "file" && genres.isEmpty() && level.maxAge < 15) return false

        val blocked = level.blockGenres
        if (blocked != null && genres.any { it in blocked }) return false

        val allowed = level.allowGenres
        if (allowed != null && (genres.isEmpty() || genres.none { it in allowed })) return false

        val ratingMax = level.ratingMax
        if (ratingMax != null) {
            val raw = item.rating.trim().uppercase()
            if (raw.isNotEmpty() && !DECIMAL_SCORE_RE.matches(raw)) {
                val normalized = if (raw == "TV-Y7-FV") "TV-Y7" else raw
                if (normalized in KNOWN_RATINGS && normalized !in ratingMax) return false
            }
        }
        return true
    }

    fun filterForLevel(
        items: List<MediaItem>,
        maxAge: Int,
        levels: List<AgeLevel> = FALLBACK_LEVELS,
    ): List<MediaItem> = if (maxAge >= 18) items else items.filter { allowedForLevel(it, maxAge, levels) }

    fun liveGroupAllowed(
        group: String?,
        maxAge: Int,
        levels: List<AgeLevel> = FALLBACK_LEVELS,
    ): Boolean {
        if (maxAge >= 18) return true
        val allowed = levelForAge(maxAge, levels).liveGroups ?: return true
        val normalized = (group ?: "").trim().lowercase()
        return normalized.isNotEmpty() && normalized in allowed
    }

    private fun lowercaseSet(array: JSONArray?): Set<String>? {
        if (array == null) return null
        val out = LinkedHashSet<String>()
        for (i in 0 until array.length()) {
            val v = (array.opt(i) as? String)?.trim()?.lowercase() ?: continue
            if (v.isNotEmpty()) out.add(v)
        }
        return out
    }

    private fun uppercaseSet(array: JSONArray?): Set<String>? {
        if (array == null) return null
        val out = LinkedHashSet<String>()
        for (i in 0 until array.length()) {
            val v = (array.opt(i) as? String)?.trim()?.uppercase() ?: continue
            if (v.isNotEmpty()) out.add(v)
        }
        return out
    }
}

object TvmPins {
    const val PIN_ITERATIONS = 20_000
    const val PIN_SALT_BYTES = 16
    const val PIN_KEY_BITS = 256
    const val PIN_MAX_TRIES = 5
    const val PIN_LOCKOUT_MS = 60_000L

    val PIN_RE = Regex("^\\d{4}$")
    val AVATAR_RE = Regex("^[a-z0-9-]{1,40}/[a-z0-9-]{1,40}$")
    private val rng = SecureRandom()

    fun hashPin(pin: String, saltHex: String, iterations: Int = PIN_ITERATIONS): String {
        val salt = hexToBytes(saltHex)
        val spec = PBEKeySpec(pin.toCharArray(), salt, iterations, PIN_KEY_BITS)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val derived = try {
            factory.generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
        return bytesToHex(derived)
    }

    fun makePin(pin: String): ProfilePin {
        if (!PIN_RE.matches(pin)) throw PinException(400, "pin-invalid")
        val salt = ByteArray(PIN_SALT_BYTES)
        rng.nextBytes(salt)
        val saltHex = bytesToHex(salt)
        return ProfilePin(
            hash = hashPin(pin, saltHex, PIN_ITERATIONS),
            salt = saltHex,
            iter = PIN_ITERATIONS,
        )
    }

    fun verifyHash(pin: String, stored: ProfilePin): Boolean {
        if (!PIN_RE.matches(pin)) return false
        val expected = hexToBytesOrNull(stored.hash) ?: return false
        val actualHex = runCatching { hashPin(pin, stored.salt, stored.iter.coerceAtLeast(1)) }.getOrNull()
            ?: return false
        val actual = hexToBytesOrNull(actualHex) ?: return false
        return MessageDigest.isEqual(actual, expected)
    }

    private fun hexToBytes(hex: String): ByteArray =
        hexToBytesOrNull(hex) ?: throw IllegalArgumentException("Invalid hex string")

    private fun hexToBytesOrNull(hex: String): ByteArray? {
        val clean = hex.trim()
        if (clean.isEmpty() || clean.length % 2 != 0) return null
        val out = ByteArray(clean.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(clean[i * 2], 16)
            val lo = Character.digit(clean[i * 2 + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    private fun bytesToHex(bytes: ByteArray): String = buildString(bytes.size * 2) {
        for (b in bytes) {
            val v = b.toInt() and 0xff
            append("0123456789abcdef"[v ushr 4])
            append("0123456789abcdef"[v and 0x0f])
        }
    }
}

class PinGuard(private val clock: () -> Long = System::currentTimeMillis) {
    private data class AttemptState(var count: Int = 0, var lockedUntilMs: Long = 0L)

    private val lock = Any()
    private val attempts = HashMap<String, AttemptState>()
    private val unlocked = HashSet<String>()

    fun isUnlocked(profileId: String): Boolean = synchronized(lock) { profileId in unlocked }

    fun markUnlocked(profileId: String) {
        synchronized(lock) {
            attempts.remove(profileId)
            unlocked.add(profileId)
        }
    }

    fun clearSessionUnlocks() {
        synchronized(lock) { unlocked.clear() }
    }

    fun forget(profileId: String) {
        synchronized(lock) {
            attempts.remove(profileId)
            unlocked.remove(profileId)
        }
    }

    fun verify(profileId: String, stored: ProfilePin?, candidate: String?) {
        val now = clock()
        synchronized(lock) {
            val state = attempts[profileId]
            if (state != null && state.lockedUntilMs > now) {
                val retryAfter = ceil((state.lockedUntilMs - now) / 1000.0).toInt().coerceAtLeast(1)
                throw PinException(403, "pin-cooldown", retryAfter)
            }
            if (state != null && state.lockedUntilMs > 0L && state.lockedUntilMs <= now) {
                attempts.remove(profileId)
            }
        }
        val clean = candidate?.trim()
        if (clean.isNullOrEmpty()) throw PinException(403, "pin-required")
        if (!TvmPins.PIN_RE.matches(clean)) throw PinException(400, "pin-invalid")
        if (stored == null) {
            markUnlocked(profileId)
            return
        }
        if (TvmPins.verifyHash(clean, stored)) {
            markUnlocked(profileId)
            return
        }
        synchronized(lock) {
            val state = attempts.getOrPut(profileId) { AttemptState() }
            state.count += 1
            if (state.count >= TvmPins.PIN_MAX_TRIES) {
                state.lockedUntilMs = now + TvmPins.PIN_LOCKOUT_MS
                state.count = 0
            }
        }
        throw PinException(403, "pin-wrong")
    }

    fun verifyAny(guardians: List<ProfileRecord>, candidate: String?) {
        if (guardians.isEmpty()) return
        val now = clock()
        synchronized(lock) {
            for (g in guardians) {
                val state = attempts[g.id]
                if (state != null && state.lockedUntilMs > now) {
                    val retryAfter = ceil((state.lockedUntilMs - now) / 1000.0).toInt().coerceAtLeast(1)
                    throw PinException(403, "pin-cooldown", retryAfter)
                }
            }
        }
        val clean = candidate?.trim()
        if (clean.isNullOrEmpty()) throw PinException(403, "pin-required")
        if (!TvmPins.PIN_RE.matches(clean)) throw PinException(400, "pin-invalid")
        for (g in guardians) {
            val stored = g.pin ?: continue
            if (TvmPins.verifyHash(clean, stored)) {
                markUnlocked(g.id)
                return
            }
        }
        val primary = guardians.first()
        synchronized(lock) {
            val state = attempts.getOrPut(primary.id) { AttemptState() }
            state.count += 1
            if (state.count >= TvmPins.PIN_MAX_TRIES) {
                state.lockedUntilMs = now + TvmPins.PIN_LOCKOUT_MS
                state.count = 0
            }
        }
        throw PinException(403, "pin-wrong")
    }
}
