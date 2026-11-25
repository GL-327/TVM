package com.tvm.privateclient

import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's account rules, against a mocked accounts service.
 *
 * The accounts live in TVM's private service; the phone only forwards to it and
 * keeps a session token. These tests stand in for the service (FakeService) so
 * they check what the phone sends, what it keeps, and how it answers the
 * interface, without a network.
 */
class TvmAccountsTest {
    private val dirs = mutableListOf<File>()
    private val password = "a good long password"
    private val terms = "2026-09-15"
    private val access = "{\"termsVersion\":\"$terms\",\"tiers\":[]}"

    @After
    fun cleanUp() {
        dirs.forEach { it.deleteRecursively() }
        dirs.clear()
    }

    /** The accounts service, in memory. Same endpoints and answers as TVM-accounts' README. */
    private class FakeService : TvmAccountsHttp {
        class Member(
            val id: String,
            val email: String,
            val password: String,
            var status: String = "waiting",
            var role: String = "member",
            var liveTv: Boolean = false,
            var termsVersion: String? = null,
            var rdToken: String? = null,
        )

        val members = mutableListOf<Member>()
        val sessions = mutableMapOf<String, Member>()
        val log = mutableListOf<String>()
        val bodies = mutableListOf<JSONObject>()
        var down = false
        private var counter = 0

        fun count(prefix: String) = log.count { it.startsWith(prefix) }

        private fun account(m: Member) = JSONObject().apply {
            put("id", m.id)
            put("email", m.email)
            put("displayName", m.email.substringBefore('@'))
            put("role", m.role)
            put("status", m.status)
            put("tier", "stream")
            put("liveTv", m.liveTv)
            put("emailVerified", false)
            put("termsVersion", m.termsVersion ?: JSONObject.NULL)
            put("hasRdToken", m.rdToken != null)
            put("createdAt", "2026-11-01T10:00:00.000Z")
        }

        override fun send(method: String, url: String, bearer: String?, body: String?, timeoutMs: Int): Pair<Int, String> {
            if (down) throw IOException("offline")
            val path = url.removePrefix(TVM_ACCOUNTS_URL).removePrefix(ORIGIN)
            log.add("$method $path")
            val json = if (body == null) JSONObject() else JSONObject(body).also { bodies.add(it) }
            fun reply(status: Int, value: JSONObject = JSONObject()) = status to value.toString()
            fun session(): Member? = bearer?.let { sessions[it] }?.takeIf { it.status != "suspended" }

            return when {
                method == "POST" && path == "/v1/register" -> {
                    val email = json.getString("email")
                    // A duplicate gets the same receipt, so the service never says who has an account.
                    val existing = members.firstOrNull { it.email == email }
                    val made = existing ?: Member("acc_${++counter}", email, json.getString("password")).also { members.add(it) }
                    reply(201, JSONObject().put("account", account(if (existing == null) made else Member("acc_new", email, ""))))
                }
                method == "POST" && path == "/v1/signin" -> {
                    val m = members.firstOrNull { it.email == json.getString("email") }
                    if (m == null || m.password != json.getString("password") || m.status == "suspended") {
                        reply(401, JSONObject().put("error", "invalid"))
                    } else {
                        val token = "s".repeat(10) + (++counter).toString().padStart(40, '0')
                        sessions[token] = m
                        reply(200, JSONObject().put("session", token).put("account", account(m)))
                    }
                }
                path == "/v1/signout" && method == "POST" -> {
                    if (session() == null) reply(401, JSONObject().put("error", "unauthorized"))
                    else { sessions.remove(bearer); reply(204) }
                }
                path == "/v1/me" && method == "GET" -> {
                    val m = session() ?: return reply(401, JSONObject().put("error", "unauthorized"))
                    reply(200, JSONObject().put("account", account(m)))
                }
                path == "/v1/me/terms" && method == "POST" -> {
                    val m = session() ?: return reply(401, JSONObject().put("error", "unauthorized"))
                    m.termsVersion = json.getString("version")
                    reply(200, JSONObject().put("account", account(m)))
                }
                path == "/v1/me/rd-token" && method == "PUT" -> {
                    val m = session() ?: return reply(401, JSONObject().put("error", "unauthorized"))
                    m.rdToken = json.getString("token").ifEmpty { null }
                    reply(200, JSONObject().put("account", account(m)))
                }
                path == "/v1/me/rd-token" && method == "GET" -> {
                    val m = session() ?: return reply(401, JSONObject().put("error", "unauthorized"))
                    if (m.status != "active") reply(403, JSONObject().put("error", "forbidden"))
                    else reply(200, JSONObject().put("token", m.rdToken ?: JSONObject.NULL))
                }
                else -> reply(404, JSONObject().put("error", "not_found"))
            }
        }
    }

    private var clock = 1_000_000L
    private val service = FakeService()
    private val vault = MemorySessionVault()

    private fun accounts(): TvmAccounts = TvmAccounts({ access }, service, vault, ORIGIN_FOR_TESTS, { clock })

    private fun join(email: String = "someone@example.com", status: String = "waiting", role: String = "member"): FakeService.Member {
        val made = FakeService.Member("acc_seed_${service.members.size}", email, password, status, role)
        service.members.add(made)
        return made
    }

    private fun signIn(a: TvmAccounts, email: String = "someone@example.com"): String =
        a.signIn(email, password, "test").getOrThrow().getString("token")

    // ---- Registering and signing in -----------------------------------------

    @Test
    fun registeringSendsOnlyWhatTheServiceTakesAndGrantsNothing() {
        val a = accounts()
        val made = a.register("  Someone@Example.com ", password, "Someone", "test agent").getOrThrow()
        assertFalse(made.getBoolean("activated"))
        assertTrue(made.isNull("tier"))
        assertEquals("member", made.getString("role"))
        assertEquals("POST /v1/register", service.log.single())
        val sent = service.bodies.single()
        assertEquals(setOf("email", "password", "displayName", "client"), sent.keys().asSequence().toSet())
        assertEquals("someone@example.com", sent.getString("email"))
        assertEquals(0, service.sessions.size)
    }

    @Test
    fun badInputIsRefusedWithoutAskingTheService() {
        val a = accounts()
        assertTrue(a.register("not an email", password, null, null).isFailure)
        assertTrue(a.register("someone@example.com", "short", null, null).isFailure)
        assertTrue(a.register("someone@example.com", "x".repeat(201), null, null).isFailure)
        assertEquals(0, service.log.size)
        assertTrue(a.register("someone@example.com", "0123456789", null, null).isSuccess)
    }

    @Test
    fun aWaitingAccountSignsInButCanDoNothing() {
        join()
        val a = accounts()
        val signedIn = a.signIn("someone@example.com", password, "test").getOrThrow()
        assertFalse(signedIn.getJSONObject("usable").getBoolean("ok"))
        assertEquals("awaiting_activation", signedIn.getJSONObject("usable").getString("reason"))
        assertFalse(signedIn.getJSONObject("account").getBoolean("activated"))
    }

    @Test
    fun wrongPasswordAndMissingAccountAnswerIdentically() {
        join()
        val a = accounts()
        val wrong = a.signIn("someone@example.com", "not the password", "test").exceptionOrNull()
        val missing = a.signIn("nobody@example.com", password, "test").exceptionOrNull()
        assertNotNull(wrong)
        assertEquals(wrong!!.message, missing!!.message)
        assertNull(vault.read())
    }

    @Test
    fun activationAloneIsNotEnoughTheTermsStillHaveToBeAgreed() {
        val member = join(status = "active")
        val a = accounts()
        val token = signIn(a)
        val before = a.usable(a.resolve(token))
        assertFalse(before.getBoolean("ok"))
        assertEquals("terms_required", before.getString("reason"))

        val accepted = a.acceptTerms(token).getOrThrow()
        assertEquals(terms, accepted.getString("termsVersion"))
        assertEquals(terms, member.termsVersion)
        assertTrue(a.usable(a.resolve(token)).getBoolean("ok"))
    }

    @Test
    fun newerTermsAskAgain() {
        join(status = "active").termsVersion = "2025-01-01"
        val a = accounts()
        val token = signIn(a)
        assertEquals("terms_required", a.usable(a.resolve(token)).getString("reason"))
    }

    @Test
    fun anAdminAccountIsAnsweredAsTheOldDevRoleAndAlwaysUsable() {
        join(email = "owner@example.com", status = "active", role = "admin")
        val a = accounts()
        val signedIn = a.signIn("owner@example.com", password, "test").getOrThrow()
        assertEquals("dev", signedIn.getJSONObject("account").getString("role"))
        assertTrue(signedIn.getJSONObject("usable").getBoolean("ok"))
    }

    @Test
    fun aSuspendedAccountIsSignedOut() {
        val member = join(status = "active")
        val a = accounts()
        val token = signIn(a)
        clock += TvmAccounts.ACCOUNT_TTL_MS + 1
        member.status = "suspended"
        assertNull(a.resolve(token))
        assertNull(vault.read())
        assertTrue(a.signIn("someone@example.com", password, "test").isFailure)
    }

    @Test
    fun serviceTierFollowsLiveTv() {
        val member = join(status = "active")
        member.liveTv = true
        val a = accounts()
        assertEquals("stream-live", a.resolve(signIn(a))!!.getString("tier"))
    }

    // ---- What the phone keeps ------------------------------------------------

    @Test
    fun onlyTheSessionTokenIsKeptNoLedgerAndNoPassword() {
        join()
        val dir = Files.createTempDirectory("tvm-core").toFile()
        dirs.add(dir)
        val core = TvmLocalCore.create(dir, { null }, bundledAccess = { access }, accountsHttp = service, sessionVault = vault)
        val reply = core.handle(
            "POST", "/api/account/signin", "",
            JSONObject().put("email", "someone@example.com").put("password", password).toString().toByteArray(),
        )
        assertEquals(200, reply.status)
        val token = JSONObject(String(reply.body)).getString("token")
        assertEquals(token, vault.read())
        assertFalse(File(dir, "accounts.json").exists())
        val written = dir.walkTopDown().filter { it.isFile }.map { it.readText() }.joinToString("\n")
        assertFalse(written.contains(password))
        assertFalse(written.contains(token))
    }

    @Test
    fun aSecondSignInIsRememberedAndLeavesOtherSessionsAlone() {
        join()
        val a = accounts()
        val first = signIn(a)
        val second = signIn(a)
        assertEquals(second, vault.read())
        assertTrue(service.sessions.containsKey(first))
        assertTrue(service.sessions.containsKey(second))
    }

    @Test
    fun signingOutClosesTheSessionAndForgetsIt() {
        join(status = "active")
        val a = accounts()
        val token = signIn(a)
        a.signOut(token)
        assertTrue(service.sessions.isEmpty())
        assertNull(vault.read())
        assertNull(a.resolve(token))
    }

    @Test
    fun signingOutWorksEvenWhenTheServiceIsUnreachable() {
        join()
        val a = accounts()
        val token = signIn(a)
        service.down = true
        a.signOut(token)
        assertNull(vault.read())
    }

    // ---- The service cannot be reached ------------------------------------------

    @Test
    fun anUnreachableServiceSaysSoInsteadOfPretendingTheAccountIsMissing() {
        join()
        service.down = true
        val a = accounts()
        val failure = a.signIn("someone@example.com", password, "test").exceptionOrNull()
        assertTrue(failure is AccountsException)
        assertEquals(503, (failure as AccountsException).status)
        assertTrue(a.lookup("x".repeat(40)) is AccountLookup.Unavailable)
    }

    @Test
    fun anAccountSeenAMomentAgoStaysSignedInThroughAnOutage() {
        join(status = "active")
        val a = accounts()
        val token = signIn(a)
        clock += TvmAccounts.ACCOUNT_TTL_MS + 1
        service.down = true
        assertNotNull(a.resolve(token))
    }

    @Test
    fun theServiceIsNotAskedAboutTheSameSessionOnEveryRequest() {
        join(status = "active")
        val a = accounts()
        val token = signIn(a)
        repeat(5) { a.resolve(token) }
        assertEquals(0, service.count("GET /v1/me"))
        clock += TvmAccounts.ACCOUNT_TTL_MS + 1
        a.resolve(token)
        a.resolve(token)
        assertEquals(1, service.count("GET /v1/me"))
    }

    // ---- The Real-Debrid key ----------------------------------------------------

    @Test
    fun theRealDebridKeyIsFetchedWhenNeededAndHeldInMemoryForAWhile() {
        val member = join(status = "active")
        member.rdToken = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"
        val a = accounts()
        val token = signIn(a)
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", a.rdTokenFor(token))
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", a.rdTokenFor(token))
        assertEquals(1, service.count("GET /v1/me/rd-token"))

        clock += TvmAccounts.RD_TTL_MS + 1
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", a.rdTokenFor(token))
        assertEquals(2, service.count("GET /v1/me/rd-token"))
    }

    @Test
    fun noKeyIsFetchedForAnAccountThatIsNotOnOrHasNone() {
        join(email = "waiting@example.com").rdToken = "KEYKEYKEYKEY"
        join(email = "empty@example.com", status = "active")
        val a = accounts()
        assertNull(a.rdTokenFor(signIn(a, "waiting@example.com")))
        assertNull(a.rdTokenFor(signIn(a, "empty@example.com")))
        assertEquals(0, service.count("GET /v1/me/rd-token"))
        assertNull(a.rdTokenFor(null))
    }

    @Test
    fun savingAndClearingAKeyGoesToTheServiceAndNeverOntoThePhone() {
        val member = join(status = "active")
        val a = accounts()
        val token = signIn(a)

        val saved = a.setRdToken(token, "  RDKEY0000WXYZ  ").getOrThrow()
        assertTrue(saved.getBoolean("rdKey"))
        assertFalse(saved.toString().contains("RDKEY"))
        assertEquals("RDKEY0000WXYZ", member.rdToken)
        assertEquals("RDKEY0000WXYZ", a.rdTokenFor(token))

        assertFalse(a.setRdToken(token, "").getOrThrow().getBoolean("rdKey"))
        assertNull(member.rdToken)
        assertNull(a.rdTokenFor(token))
        assertTrue(a.setRdToken(token, "has a space").isFailure)
    }

    @Test
    fun aSwitchedOffAccountDropsItsKeyFromMemory() {
        val member = join(status = "active")
        member.rdToken = "KEYKEYKEYKEY"
        val a = accounts()
        val token = signIn(a)
        assertEquals("KEYKEYKEYKEY", a.rdTokenFor(token))
        member.status = "waiting"
        clock += TvmAccounts.ACCOUNT_TTL_MS + 1
        assertNull(a.rdTokenFor(token))
    }

    // ---- The on-device core -------------------------------------------------

    private fun core(): TvmLocalCore {
        val dir = Files.createTempDirectory("tvm-core").toFile()
        dirs.add(dir)
        return TvmLocalCore.create(dir, { null }, bundledAccess = { access }, accountsHttp = service, sessionVault = vault)
    }

    private fun call(core: TvmLocalCore, method: String, path: String, body: JSONObject? = null, token: String? = null): Pair<Int, JSONObject> {
        val headers = if (token == null) emptyMap() else mapOf("authorization" to "Bearer $token")
        val reply = core.handle(method, path, "", (body?.toString() ?: "").toByteArray(), headers)
        return reply.status to JSONObject(String(reply.body))
    }

    @Test
    fun theDeveloperCodeIsGoneAndBothRoutesAnswerMoved() {
        val c = core()
        val code = call(c, "POST", "/api/account/dev", JSONObject().put("code", "anything"))
        assertEquals(410, code.first)
        assertEquals("moved", code.second.getString("error"))
        assertEquals(1, code.second.length())
        val unlock = call(c, "POST", "/api/dev/unlock", JSONObject().put("password", "anything"))
        assertEquals(410, unlock.first)
        assertEquals("moved", unlock.second.getString("error"))
        assertFalse(c.plans.developer())
        assertEquals(0, service.log.size)
    }

    @Test
    fun accountAdminRoutesAreForTheDashboardNotThePhone() {
        join(email = "owner@example.com", status = "active", role = "admin")
        val c = core()
        val owner = call(c, "POST", "/api/account/signin", JSONObject().put("email", "owner@example.com").put("password", password))
            .second.getString("token")
        val routes = listOf(
            "GET" to "/api/admin/accounts",
            "POST" to "/api/admin/accounts/activate",
            "POST" to "/api/admin/accounts/suspend",
            "POST" to "/api/admin/accounts/note",
            "POST" to "/api/admin/accounts/erase",
            "POST" to "/api/admin/accounts/live-tv",
            "POST" to "/api/admin/accounts/rd",
            "POST" to "/api/admin/accounts/verify",
        )
        for ((method, path) in routes) {
            for (who in listOf(null, owner)) {
                val reply = call(c, method, path, JSONObject().put("id", "x"), who)
                assertEquals("$method $path", 403, reply.first)
                assertEquals("use_dashboard", reply.second.getString("error"))
            }
        }
    }

    @Test
    fun anAdminAccountTurnsOnDeveloperModeAndOnlyThatAccount() {
        join(email = "owner@example.com", status = "active", role = "admin")
        join(status = "active")
        val c = core()
        val creds = { email: String -> JSONObject().put("email", email).put("password", password) }
        val owner = call(c, "POST", "/api/account/signin", creds("owner@example.com")).second.getString("token")
        val member = call(c, "POST", "/api/account/signin", creds("someone@example.com")).second.getString("token")

        assertTrue(call(c, "GET", "/api/dev/status", token = owner).second.getBoolean("unlocked"))
        assertFalse(call(c, "GET", "/api/dev/status", token = member).second.getBoolean("unlocked"))
        assertFalse(call(c, "GET", "/api/dev/status").second.getBoolean("unlocked"))
        assertEquals(403, call(c, "GET", "/api/admin/mail", token = member).first)
        assertEquals(200, call(c, "GET", "/api/admin/mail", token = owner).first)
        assertEquals("dev", call(c, "GET", "/api/account", token = owner).second.getJSONObject("account").getString("role"))
    }

    @Test
    fun phonesSayTheyDoNotSendEmail() {
        val c = core()
        assertEquals(503, call(c, "POST", "/api/account/email/send").first)
        assertFalse(call(c, "GET", "/api/account").second.getBoolean("signedIn"))
    }

    @Test
    fun rokuAccountHeaderIsAcceptedByTheOnDeviceCore() {
        join(status = "active")
        val c = core()
        val token = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", password))
            .second.getString("token")
        val reply = c.handle("GET", "/api/account", "", ByteArray(0), mapOf("x-tvm-account" to token))
        assertEquals(200, reply.status)
        assertTrue(JSONObject(String(reply.body)).getBoolean("signedIn"))
    }

    @Test
    fun theAccountScreenGetsTheSameShapeAsBefore() {
        join(status = "active")
        val c = core()
        val token = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", password))
            .second.getString("token")
        val me = call(c, "GET", "/api/account", token = token).second
        assertTrue(me.getBoolean("signedIn"))
        assertEquals(terms, me.getString("termsVersion"))
        assertFalse(me.getBoolean("canSendEmail"))
        val account = me.getJSONObject("account")
        for (key in listOf(
            "id", "email", "displayName", "role", "activated", "tier", "suspended", "createdAt",
            "termsVersion", "termsAcceptedAt", "emailVerified", "emailCodeSent", "rdKey",
        )) assertTrue(key, account.has(key))
        assertEquals("terms_required", me.getJSONObject("usable").getString("reason"))

        val agreed = call(c, "POST", "/api/account/terms", token = token)
        assertEquals(200, agreed.first)
        assertTrue(call(c, "GET", "/api/account", token = token).second.getJSONObject("usable").getBoolean("ok"))
    }

    @Test
    fun registerAndSignInErrorsKeepTheirStatuses() {
        join()
        val c = core()
        val wrong = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", "nope nope nope"))
        assertEquals(401, wrong.first)
        assertEquals(400, call(c, "POST", "/api/account/register", JSONObject().put("email", "x").put("password", password)).first)
        service.down = true
        val offline = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", password))
        assertEquals(503, offline.first)
        assertEquals(503, call(c, "GET", "/api/account", token = "t".repeat(43)).first)
    }

    @Test
    fun aMemberClearingTheirKeyGoesToTheServiceNotTheDevice() {
        val member = join(status = "active")
        member.rdToken = "RDKEY0000WXYZ"
        val c = core()
        val token = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", password))
            .second.getString("token")
        assertTrue(call(c, "GET", "/api/account", token = token).second.getJSONObject("account").getBoolean("rdKey"))

        // Clearing needs no call to Real-Debrid, so this stays off the network.
        val cleared = call(c, "PUT", "/api/rd/token", JSONObject().put("token", ""), token)
        assertEquals(200, cleared.first)
        assertTrue(cleared.second.isNull("source"))
        assertNull(member.rdToken)
        assertEquals(1, service.count("PUT /v1/me/rd-token"))
        assertFalse(call(c, "GET", "/api/account", token = token).second.getJSONObject("account").getBoolean("rdKey"))
    }

    @Test
    fun factoryResetSignsThePhoneOutOfTheService() {
        join(status = "active")
        val c = core()
        val token = call(c, "POST", "/api/account/signin", JSONObject().put("email", "someone@example.com").put("password", password))
            .second.getString("token")
        assertNotNull(vault.read())
        assertEquals(200, call(c, "POST", "/api/maintenance/factory-reset").first)
        assertNull(vault.read())
        assertFalse(service.sessions.containsKey(token))
    }

    @Test
    fun theTestChannelIsOnlyThereInDevModeAndHidesItsAddress() {
        val c = core()
        assertEquals(0, call(c, "GET", "/api/live").second.getJSONArray("channels").length())
        c.plans.setDeveloper(true)
        val channels = call(c, "GET", "/api/live").second.getJSONArray("channels")
        assertEquals("live:test:dw-news", channels.getJSONObject(0).getString("id"))
        assertFalse(channels.getJSONObject(0).has("url"))
    }

    private companion object {
        const val ORIGIN = "https://accounts.test"
        const val ORIGIN_FOR_TESTS = ORIGIN
    }
}
