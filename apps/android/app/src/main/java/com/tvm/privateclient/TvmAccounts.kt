package com.tvm.privateclient

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Locale
import org.json.JSONObject

/**
 * Where the private accounts service lives. The service holds accounts, sign-ins
 * and Real-Debrid keys; this public app holds none of them. Must match
 * ACCOUNTS_URL in apps/core/src/config.ts.
 */
const val TVM_ACCOUNTS_URL = "https://tvm-accounts.tvm-accounts.workers.dev"

/** One JSON request to the accounts service. An interface so tests need no network. */
fun interface TvmAccountsHttp {
    /** Returns the status and body text. Throws IOException when the service cannot be reached at all. */
    fun send(method: String, url: String, bearer: String?, body: String?, timeoutMs: Int): Pair<Int, String>

    companion object {
        private const val MAX_BODY = 64 * 1024

        val Default = TvmAccountsHttp { method, url, bearer, body, timeoutMs ->
            val target = URL(url)
            if (target.protocol != "https") throw IOException("accounts need https")
            val connection = target.openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = timeoutMs
                connection.readTimeout = timeoutMs
                connection.useCaches = false
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.setRequestProperty("User-Agent", "TVM/1.1 (Android; +https://github.com/GL-327/TVM)")
                if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.use { String(TvmHttp.readLimited(it, MAX_BODY), Charsets.UTF_8) } ?: ""
                status to text
            } finally {
                connection.disconnect()
            }
        }
    }
}

/**
 * Where the one session token is kept. On the phone this is
 * EncryptedSharedPreferences (see EncryptedSessionVault in CredentialStore.kt);
 * tests use the in-memory copy.
 */
interface TvmSessionVault {
    fun read(): String?
    fun write(token: String?)
}

class MemorySessionVault : TvmSessionVault {
    @Volatile
    private var token: String? = null
    override fun read(): String? = token
    override fun write(token: String?) {
        this.token = token
    }
}

/** What the service said, in words the sign-in screen can show. */
class AccountsException(val status: Int, message: String) : Exception(message)

/** The answer to "who is this session": the account, signed out, or the service could not be asked. */
sealed class AccountLookup {
    class Found(val account: JSONObject) : AccountLookup()
    object SignedOut : AccountLookup()
    object Unavailable : AccountLookup()
}

/**
 * Accounts on the phone. The accounts live in TVM's private service
 * (TVM_ACCOUNTS_URL); this class only talks to it. The phone keeps the session
 * token, in secure storage, and nothing else: no password, no ledger, no
 * Real-Debrid key on disk. A member's Real-Debrid key is fetched from the
 * service when it is needed and held in memory for a few minutes.
 *
 * The local /api/account routes keep the shape the interface already uses, so
 * the service's role 'admin' is answered as the old 'dev' role.
 *
 * Existing on-phone accounts could not be moved (their passwords were stored as
 * digests the service cannot read), so people register again and the owner
 * switches them on. Admin work happens on the web dashboard, not here.
 */
class TvmAccounts(
    private val readAccess: () -> String?,
    private val http: TvmAccountsHttp = TvmAccountsHttp.Default,
    private val vault: TvmSessionVault = MemorySessionVault(),
    private val origin: String = TVM_ACCOUNTS_URL,
    private val now: () -> Long = System::currentTimeMillis,
    private val adminVault: TvmSessionVault = MemorySessionVault(),
) {
    companion object {
        private const val TIMEOUT_MS = 15_000
        /** How long an answer about an account is trusted before the service is asked again. */
        const val ACCOUNT_TTL_MS = 30_000L
        /** How long a fetched Real-Debrid key stays in memory (bounded under 1 minute for rotations). */
        const val RD_TTL_MS = 45_000L
        /** An empty or failed key fetch is retried promptly. */
        private const val RD_NULL_TTL_MS = 5_000L
        private const val RD_FAILURE_TTL_MS = RD_NULL_TTL_MS
        /** Public config TTL (5 min on success, 15s on failure). */
        const val CONFIG_TTL_MS = 5 * 60_000L
        private const val CONFIG_ERROR_TTL_MS = 15_000L
    }

    private class CachedAccount(val account: JSONObject, val at: Long)
    private class CachedKey(val token: String?, val expires: Long)

    private val lock = Any()
    private val accountCache = HashMap<String, CachedAccount>()
    private val rdCache = HashMap<String, CachedKey>()
    private var configCache: JSONObject = defaultConfig()
    private var configExpires: Long = Long.MIN_VALUE

    // ---- Access resource (generated by scripts/export-access.mjs) ----------

    private var cachedAccess: JSONObject? = null

    fun access(): JSONObject {
        cachedAccess?.let { return it }
        val text = runCatching { readAccess() }.getOrNull() ?: return JSONObject()
        val parsed = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
        cachedAccess = parsed
        return parsed
    }

    fun termsVersion(): String = access().text("termsVersion", "")

    // ---- The service ---------------------------------------------------------

    private fun callRaw(method: String, path: String, bearer: String?, body: String?): Pair<Int, String> {
        return try {
            http.send(method, origin + path, bearer, body, TIMEOUT_MS)
        } catch (error: Exception) {
            throw AccountsException(503, "TVM accounts cannot be reached. Check your connection and try again.")
        }
    }

    private fun call(method: String, path: String, bearer: String?, body: JSONObject?): Pair<Int, JSONObject> {
        val reply = callRaw(method, path, bearer, body?.toString())
        val parsed = runCatching { JSONObject(reply.second) }.getOrNull() ?: JSONObject()
        return reply.first to parsed
    }

    private fun defaultConfig(): JSONObject = JSONObject().apply {
        put("announcement", JSONObject.NULL)
        put("minVersion", JSONObject.NULL)
        put("flags", JSONObject())
        put("openSignups", false)
        put("mail", false)
    }

    private fun safeHttpUrl(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.US)
        if ((scheme != "http" && scheme != "https") || uri.host.isNullOrEmpty() || uri.userInfo != null) return null
        return uri.toString()
    }

    private fun publicConfig(raw: JSONObject): JSONObject {
        val a = raw.optJSONObject("announcement")
        var announcement: JSONObject? = null
        if (a != null) {
            val id = a.text("id")
            val text = a.text("text")
            val level = a.text("level")
            if (id.isNotEmpty() && text.isNotEmpty() && level in setOf("info", "warning", "critical")) {
                announcement = Json.obj("id" to id, "text" to text, "level" to level)
                safeHttpUrl(a.opt("link") as? String)?.let { announcement.put("link", it) }
            }
        }
        val flagsOut = JSONObject()
        val flags = raw.optJSONObject("flags")
        if (flags != null) {
            val keys = flags.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = flags.opt(key)
                if (value is Boolean) flagsOut.put(key, value)
            }
        }
        val minVersion = (raw.opt("minVersion") as? String)?.trim()?.takeIf { it.isNotEmpty() }
        return JSONObject().apply {
            put("announcement", announcement ?: JSONObject.NULL)
            put("minVersion", minVersion ?: JSONObject.NULL)
            put("flags", flagsOut)
            put("openSignups", raw.optBoolean("openSignups", false))
            put("mail", raw.optBoolean("mail", false))
        }
    }

    fun config(force: Boolean = false): JSONObject {
        val current = now()
        synchronized(lock) {
            if (!force && current < configExpires) return configCache
        }
        return try {
            val (status, reply) = call("GET", "/v1/config", null, null)
            if (status in 200..299) {
                val mapped = publicConfig(reply)
                synchronized(lock) {
                    configCache = mapped
                    configExpires = now() + CONFIG_TTL_MS
                }
                mapped
            } else {
                synchronized(lock) {
                    configExpires = now() + CONFIG_ERROR_TTL_MS
                    configCache
                }
            }
        } catch (_: Exception) {
            synchronized(lock) {
                configExpires = now() + CONFIG_ERROR_TTL_MS
                configCache
            }
        }
    }

    fun announcement(): JSONObject {
        val cfg = config()
        return JSONObject().apply {
            put("announcement", cfg.opt("announcement") ?: JSONObject.NULL)
            put("minVersion", cfg.opt("minVersion") ?: JSONObject.NULL)
            put("flags", cfg.optJSONObject("flags") ?: JSONObject())
        }
    }

    private fun failure(status: Int, fallback: String): AccountsException = when {
        status == 429 -> AccountsException(429, "Too many tries. Wait a few minutes and try again.")
        status >= 500 -> AccountsException(503, "TVM accounts are not answering right now. Try again in a moment.")
        else -> AccountsException(status, fallback)
    }

    /** The service's account, in the shape the rest of the phone's core reads. */
    private fun local(service: JSONObject): JSONObject {
        val status = service.text("status")
        val version = service.opt("termsVersion").let { if (it is String && it.isNotEmpty()) it else null }
        return JSONObject().apply {
            put("id", service.text("id"))
            put("email", service.text("email"))
            put("displayName", service.text("displayName"))
            put("role", if (service.text("role") == "admin") "dev" else "member")
            put("activated", status == "active")
            put("suspended", status == "suspended")
            put("tier", when {
                status == "waiting" -> JSONObject.NULL
                service.optBoolean("liveTv") -> "stream-live"
                else -> "stream"
            })
            put("createdAt", service.text("createdAt"))
            put("termsVersion", version ?: JSONObject.NULL)
            put("termsAcceptedAt", if (version != null) service.text("createdAt") else JSONObject.NULL)
            put("emailVerified", service.optBoolean("emailVerified"))
            put("hasRdToken", service.optBoolean("hasRdToken"))
        }
    }

    private fun clientName(raw: String?): String? {
        val cleaned = raw?.filter { !it.isISOControl() }?.trim()?.take(200)
        return if (cleaned.isNullOrEmpty()) null else cleaned
    }

    private fun normalize(email: String) = email.trim().lowercase(Locale.US)

    private fun emailLooksValid(email: String): Boolean {
        if (email.length > 254 || email.contains(' ')) return false
        val parts = email.split("@")
        if (parts.size != 2 || parts[0].isEmpty()) return false
        val host = parts[1]
        val dot = host.lastIndexOf('.')
        return dot > 0 && host.length - dot > 2
    }

    // ---- Rules ------------------------------------------------------------

    /** Switched on, a tier, current terms, not suspended. An owner (admin) account always passes, like the desktop. */
    fun usable(account: JSONObject?): JSONObject {
        val out = JSONObject()
        if (account == null) return out.put("ok", false).put("reason", "no_account")
        if (account.text("role") == "dev") return out.put("ok", true).put("reason", JSONObject.NULL)
        if (account.optBoolean("suspended")) return out.put("ok", false).put("reason", "suspended")
        if (!account.optBoolean("activated") || account.text("tier").isEmpty()) {
            return out.put("ok", false).put("reason", "awaiting_activation")
        }
        if (account.text("termsVersion") != termsVersion() || account.text("termsAcceptedAt").isEmpty()) {
            return out.put("ok", false).put("reason", "terms_required")
        }
        return out.put("ok", true).put("reason", JSONObject.NULL)
    }

    /** Never includes a password or a Real-Debrid key. */
    fun publicOf(account: JSONObject): JSONObject = JSONObject().apply {
        put("id", account.text("id"))
        put("email", account.text("email"))
        put("displayName", account.text("displayName"))
        put("role", account.text("role").ifEmpty { "member" })
        put("activated", account.optBoolean("activated"))
        put("tier", account.opt("tier") ?: JSONObject.NULL)
        put("suspended", account.optBoolean("suspended"))
        put("createdAt", account.text("createdAt"))
        put("termsVersion", account.opt("termsVersion") ?: JSONObject.NULL)
        put("termsAcceptedAt", account.opt("termsAcceptedAt") ?: JSONObject.NULL)
        put("emailVerified", account.optBoolean("emailVerified"))
        // Phones never send a code.
        put("emailCodeSent", false)
        put("rdKey", account.optBoolean("hasRdToken"))
    }

    // ---- Actions ----------------------------------------------------------

    fun register(rawEmail: String, password: String, displayName: String?, client: String?): Result<JSONObject> {
        val email = normalize(rawEmail)
        if (!emailLooksValid(email)) return Result.failure(Exception("Enter a valid email address."))
        if (password.length < 10) return Result.failure(Exception("Use at least 10 characters."))
        if (password.length > 200) return Result.failure(Exception("That password is too long."))
        return runCatching {
            val body = JSONObject().put("email", email).put("password", password)
            val name = displayName?.trim()?.filter { !it.isISOControl() }?.take(80)
            if (!name.isNullOrEmpty()) body.put("displayName", name)
            clientName(client)?.let { body.put("client", it) }
            val (status, reply) = call("POST", "/v1/register", null, body)
            if (status != 201 && status != 200) {
                throw failure(status, "That account could not be created. If it already exists, sign in instead.")
            }
            val account = reply.optJSONObject("account")
                ?: throw AccountsException(503, "TVM accounts sent an answer this app does not understand.")
            publicOf(local(account))
        }
    }

    fun signIn(rawEmail: String, password: String, client: String?): Result<JSONObject> {
        val email = normalize(rawEmail)
        if (email.isEmpty() || password.isEmpty() || password.length > 200) {
            return Result.failure(Exception("That email address and password do not match."))
        }
        return runCatching {
            val body = JSONObject().put("email", email).put("password", password)
            clientName(client)?.let { body.put("client", it) }
            val (status, reply) = call("POST", "/v1/signin", null, body)
            if (status == 401 || status == 400) throw AccountsException(401, "That email address and password do not match.")
            if (status != 200) throw failure(status, "Sign in failed.")
            val session = reply.text("session")
            val account = reply.optJSONObject("account")
            if (session.isEmpty() || account == null) {
                throw AccountsException(503, "TVM accounts sent an answer this app does not understand.")
            }
            // The phone remembers the latest session; other sessions (a paired Roku, say) are left alone.
            runCatching { vault.write(session) }
            val mapped = local(account)
            synchronized(lock) { accountCache[session] = CachedAccount(mapped, now()) }
            JSONObject().apply {
                put("token", session)
                put("account", publicOf(mapped))
                put("usable", usable(mapped))
            }
        }
    }

    /** Best effort: the service forgets the session, and so does this phone, whatever the service says. */
    private fun revoke(token: String) {
        runCatching { call("POST", "/v1/signout", token, null) }
        forget(token)
    }

    fun signOut(token: String) {
        revoke(token)
        if (vault.read() == token) runCatching { vault.write(null) }
    }

    /** Factory reset: close the session the phone holds and drop everything in memory. */
    fun forgetEverything() {
        vault.read()?.let { revoke(it) }
        runCatching { vault.write(null) }
        runCatching { adminVault.write(null) }
        synchronized(lock) {
            accountCache.clear()
            rdCache.clear()
            configCache = defaultConfig()
            configExpires = Long.MIN_VALUE
        }
    }

    fun invalidateCaches() {
        synchronized(lock) {
            accountCache.clear()
            rdCache.clear()
            configExpires = Long.MIN_VALUE
        }
    }

    fun cachedRdTokenFor(token: String?): String? {
        if (token.isNullOrEmpty()) return null
        synchronized(lock) {
            val cached = rdCache[token] ?: return null
            if (cached.expires <= now()) {
                rdCache.remove(token)
                return null
            }
            return cached.token
        }
    }

    fun forgetRdToken(token: String?, rejected: String? = null) {
        if (token.isNullOrEmpty()) return
        synchronized(lock) {
            val cached = rdCache[token]
            if (rejected == null || cached?.token == rejected) {
                rdCache.remove(token)
            }
        }
    }

    private fun forget(token: String) {
        synchronized(lock) {
            accountCache.remove(token)
            rdCache.remove(token)
        }
    }

    /** Who this session belongs to, asking the service at most every ACCOUNT_TTL_MS. */
    fun lookup(token: String?): AccountLookup {
        if (token.isNullOrEmpty()) return AccountLookup.SignedOut
        val cached = synchronized(lock) { accountCache[token] }
        if (cached != null && now() - cached.at < ACCOUNT_TTL_MS) return AccountLookup.Found(cached.account)
        val reply = try {
            call("GET", "/v1/me", token, null)
        } catch (error: AccountsException) {
            // The service cannot be reached: an account seen a moment ago stays signed in.
            return if (cached != null) AccountLookup.Found(cached.account) else AccountLookup.Unavailable
        }
        val (status, body) = reply
        if (status == 401 || status == 403) {
            forget(token)
            if (vault.read() == token) runCatching { vault.write(null) }
            return AccountLookup.SignedOut
        }
        val account = body.optJSONObject("account")
        if (status != 200 || account == null) {
            return if (cached != null) AccountLookup.Found(cached.account) else AccountLookup.Unavailable
        }
        val mapped = local(account)
        if (mapped.optBoolean("suspended")) {
            forget(token)
            return AccountLookup.SignedOut
        }
        synchronized(lock) {
            accountCache[token] = CachedAccount(mapped, now())
            // A change on the service (switched off, key removed, or cached null) must not leave stale state blocking a rotated key.
            if (!mapped.optBoolean("activated") || !mapped.optBoolean("hasRdToken") || rdCache[token]?.token == null) {
                rdCache.remove(token)
            }
        }
        return AccountLookup.Found(mapped)
    }

    fun resolve(token: String?): JSONObject? = (lookup(token) as? AccountLookup.Found)?.account

    /** The account's own Real-Debrid key for this session, if it has one. Fetched on demand, held in memory only. */
    @JvmOverloads
    fun rdTokenFor(token: String?, fresh: Boolean = false): String? {
        if (token.isNullOrEmpty()) return null
        val account = resolve(token) ?: return null
        if (!account.optBoolean("activated") || !account.optBoolean("hasRdToken")) return null
        if (fresh) {
            synchronized(lock) { rdCache.remove(token) }
        }
        val cached = synchronized(lock) { rdCache[token] }
        if (cached != null && cached.expires > now()) return cached.token
        return try {
            val (status, body) = call("GET", "/v1/me/rd-token", token, null)
            when (status) {
                200 -> {
                    val key = body.text("token").ifEmpty { null }
                    val ttl = if (key == null) RD_NULL_TTL_MS else RD_TTL_MS
                    synchronized(lock) { rdCache[token] = CachedKey(key, now() + ttl) }
                    key
                }
                401, 403 -> {
                    synchronized(lock) { rdCache.remove(token) }
                    null
                }
                else -> {
                    synchronized(lock) { rdCache[token] = CachedKey(null, now() + RD_FAILURE_TTL_MS) }
                    null
                }
            }
        } catch (error: AccountsException) {
            synchronized(lock) { rdCache[token] = CachedKey(null, now() + RD_FAILURE_TTL_MS) }
            null
        }
    }

    fun resendVerification(token: String?, rawEmail: String?): Pair<Int, JSONObject> {
        return try {
            if (!token.isNullOrEmpty()) {
                val (status, reply) = call("POST", "/v1/me/verify/resend", token, null)
                if (status in 200..299) 202 to Json.obj("ok" to true)
                else if (status == 401) {
                    forget(token)
                    401 to Json.obj("error" to "Sign in first.")
                } else {
                    status to Json.obj("error" to (reply.text("error").ifEmpty { "Could not send verification link." }))
                }
            } else {
                val email = normalize(rawEmail.orEmpty())
                if (!emailLooksValid(email)) return 400 to Json.obj("error" to "Enter a valid email address.")
                call("POST", "/v1/verify/resend", null, JSONObject().put("email", email))
                202 to Json.obj("ok" to true)
            }
        } catch (_: AccountsException) {
            503 to Json.obj("error" to "TVM accounts cannot be reached. Check your connection and try again.")
        }
    }

    fun forgotPassword(rawEmail: String?): Pair<Int, JSONObject> {
        val email = normalize(rawEmail.orEmpty())
        if (!emailLooksValid(email)) return 400 to Json.obj("error" to "Enter a valid email address.")
        return try {
            call("POST", "/v1/password/forgot", null, JSONObject().put("email", email))
            202 to Json.obj("ok" to true)
        } catch (_: AccountsException) {
            503 to Json.obj("error" to "TVM accounts cannot be reached. Check your connection and try again.")
        }
    }

    fun hasAdminKey(): Boolean = !adminVault.read().isNullOrEmpty()

    fun installAdminKey(token: String?, rawKey: String): Pair<Int, JSONObject> {
        val actor = resolve(token) ?: return 401 to Json.obj("error" to "Sign in first.")
        if (actor.text("role") != "dev") return 403 to Json.obj("error" to "developer_required")
        if (rawKey.length > 4096 || rawKey.any { it == '\r' || it == '\n' }) {
            return 400 to Json.obj("error" to "invalid_key")
        }
        val key = rawKey.trim()
        if (key.isEmpty()) {
            runCatching { adminVault.write(null) }
            synchronized(lock) { configExpires = Long.MIN_VALUE }
            return 200 to Json.obj("ok" to true, "configured" to false)
        }
        return try {
            val (status, _) = callRaw("GET", "/v1/admin/config", key, null)
            if (status in 200..299) {
                runCatching { adminVault.write(key) }
                synchronized(lock) { configExpires = Long.MIN_VALUE }
                200 to Json.obj("ok" to true, "configured" to true)
            } else if (status == 401 || status == 403) {
                403 to Json.obj("error" to "invalid_key")
            } else {
                503 to Json.obj("error" to "TVM accounts cannot be reached.")
            }
        } catch (_: AccountsException) {
            503 to Json.obj("error" to "TVM accounts cannot be reached.")
        }
    }

    fun mirrorAdmin(token: String?, v1Path: String, method: String, body: JSONObject? = null): HttpReply {
        val actor = resolve(token) ?: return HttpReply.json(401, Json.obj("error" to "Sign in first."))
        if (actor.text("role") != "dev") return HttpReply.json(403, Json.obj("error" to "developer_required"))
        val key = adminVault.read()?.takeIf { it.isNotEmpty() }
            ?: return HttpReply.json(403, Json.obj("error" to "admin_key_required"))
        return try {
            val cleanPath = v1Path.trimStart('/')
            val (status, text) = callRaw(method, "/v1/admin/$cleanPath", key, body?.toString())
            if (method != "GET") {
                synchronized(lock) {
                    rdCache.clear()
                    if (cleanPath == "config" || cleanPath.startsWith("config?")) configExpires = Long.MIN_VALUE
                }
            }
            if (status == 204) return HttpReply.empty(204)
            val contentType = if (cleanPath.startsWith("accounts.csv")) "text/csv; charset=utf-8" else "application/json; charset=utf-8"
            HttpReply.bytes(status, contentType, text.ifEmpty { "{}" }.toByteArray(Charsets.UTF_8))
        } catch (_: AccountsException) {
            HttpReply.json(503, Json.obj("error" to "TVM accounts cannot be reached."))
        }
    }

    fun acceptTerms(token: String): Result<JSONObject> = runCatching {
        val (status, body) = call("POST", "/v1/me/terms", token, JSONObject().put("version", termsVersion()))
        if (status == 401) {
            forget(token)
            throw AccountsException(401, "Sign in first.")
        }
        if (status != 200) throw failure(status, "The terms could not be saved. Try again.")
        val account = body.optJSONObject("account")
            ?: throw AccountsException(503, "TVM accounts sent an answer this app does not understand.")
        val mapped = local(account)
        synchronized(lock) { accountCache[token] = CachedAccount(mapped, now()) }
        publicOf(mapped)
    }

    /** Saves or clears this account's own Real-Debrid key on the service. */
    fun setRdToken(token: String, key: String): Result<JSONObject> {
        val trimmed = key.trim()
        if (trimmed.length > 200 || trimmed.any { it.isWhitespace() }) {
            return Result.failure(Exception("That does not look like a Real-Debrid key."))
        }
        return runCatching {
            synchronized(lock) { rdCache.remove(token) }
            val (status, body) = call("PUT", "/v1/me/rd-token", token, JSONObject().put("token", trimmed))
            if (status == 401) {
                forget(token)
                throw AccountsException(401, "Sign in first.")
            }
            if (status != 200) throw failure(status, "That key could not be saved.")
            val account = body.optJSONObject("account")
                ?: throw AccountsException(503, "TVM accounts sent an answer this app does not understand.")
            val mapped = local(account)
            synchronized(lock) { accountCache[token] = CachedAccount(mapped, now()) }
            publicOf(mapped)
        }
    }
}
