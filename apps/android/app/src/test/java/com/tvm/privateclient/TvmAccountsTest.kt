package com.tvm.privateclient

import java.io.File
import java.nio.file.Files
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's account rules.
 *
 * The Android build runs its own embedded core, so the gate in front of
 * everything is answered here rather than by a desktop. The desktop equivalent
 * has had tests since it was written; this had none, which is the wrong way
 * round, because the rules that matter most are the ones about who gets in and
 * they now exist twice.
 *
 * Each test names the rule it protects rather than the method it calls: the
 * point is that this implementation and the TypeScript one agree.
 */
class TvmAccountsTest {
    private val dirs = mutableListOf<File>()
    private val password = "a good long password"

    @After
    fun cleanUp() {
        dirs.forEach { it.deleteRecursively() }
        dirs.clear()
    }

    private fun accounts(terms: String = "2026-09-15"): TvmAccounts {
        val dir = Files.createTempDirectory("tvm-accounts").toFile()
        dirs.add(dir)
        return TvmAccounts(TvmStore(dir)) { "{\"termsVersion\":\"" + terms + "\",\"tiers\":[]}" }
    }

    private fun register(a: TvmAccounts, email: String = "someone@example.com"): String {
        val made = a.register(email, password, "Someone", "test")
        assertTrue(made.isSuccess)
        return made.getOrThrow().getString("id")
    }

    private fun tokenFor(a: TvmAccounts, email: String = "someone@example.com"): String =
        a.signIn(email, password, "test").getOrThrow().getString("token")

    @Test
    fun accountStartsInertAndGrantsNothing() {
        val a = accounts()
        val made = a.register("someone@example.com", password, "Someone", "test").getOrThrow()
        assertFalse(made.getBoolean("activated"))
        assertTrue(made.isNull("tier"))

        val signedIn = a.signIn("someone@example.com", password, "test").getOrThrow()
        assertFalse(signedIn.getJSONObject("usable").getBoolean("ok"))
        assertEquals("awaiting_activation", signedIn.getJSONObject("usable").getString("reason"))
    }

    @Test
    fun activationAloneIsNotEnoughTheTermsStillHaveToBeAgreed() {
        val a = accounts()
        val id = register(a)
        assertNotNull(a.activate(id, "stream-live", null))

        val afterActivation = a.usable(a.resolve(tokenFor(a)))
        assertFalse(afterActivation.getBoolean("ok"))
        assertEquals("terms_required", afterActivation.getString("reason"))

        a.acceptTerms(id)
        assertTrue(a.usable(a.resolve(tokenFor(a))).getBoolean("ok"))
    }

    @Test
    fun wrongPasswordAndMissingAccountAnswerIdentically() {
        val a = accounts()
        register(a)
        val wrongPassword = a.signIn("someone@example.com", "not the password", "test")
        val noSuchAccount = a.signIn("nobody@example.com", "not the password", "test")
        assertTrue(wrongPassword.isFailure)
        assertTrue(noSuchAccount.isFailure)
        assertEquals(wrongPassword.exceptionOrNull()?.message, noSuchAccount.exceptionOrNull()?.message)
    }

    @Test
    fun signingUpTwiceSaysNothingAboutWhetherTheAddressIsTaken() {
        val a = accounts()
        register(a)
        val again = a.register("someone@example.com", "a different long password", null, null)
        assertTrue(again.isFailure)
        val message = again.exceptionOrNull()?.message ?: ""
        assertFalse(message.contains("already registered"))
        assertFalse(message.contains("taken"))
        assertTrue(message.contains("could not be created"))
    }

    @Test
    fun nothingOnDiskCanProduceThePasswordAndSaltsAreNeverShared() {
        val a = accounts()
        register(a, "one@example.com")
        register(a, "two@example.com")
        val ledger = dirs.first().resolve("accounts.json").readText()
        assertFalse(ledger.contains(password))

        val rows = JSONObject(ledger).getJSONArray("accounts")
        val first = rows.getJSONObject(0)
        val second = rows.getJSONObject(1)
        assertNotEquals(first.getString("passwordSalt"), second.getString("passwordSalt"))
        // Same password, different salt, so the digests have to differ too.
        assertNotEquals(first.getString("passwordHash"), second.getString("passwordHash"))
    }

    @Test
    fun theOwnerListingNeverCarriesTheDigestOrTheSalt() {
        val a = accounts()
        val id = register(a)
        a.activate(id, "stream", null)
        val listed = a.list(null, null).getJSONArray("accounts").getJSONObject(0).toString()
        assertFalse(listed.contains("passwordHash"))
        assertFalse(listed.contains("passwordSalt"))
    }

    @Test
    fun aTokenStopsWorkingTheMomentItIsSignedOut() {
        val a = accounts()
        val id = register(a)
        a.activate(id, "stream", null)
        a.acceptTerms(id)
        val token = tokenFor(a)
        assertNotNull(a.resolve(token))
        a.signOut(token)
        assertNull(a.resolve(token))
    }

    @Test
    fun suspendingCutsLiveSessionsRatherThanWaitingForThemToLapse() {
        val a = accounts()
        val id = register(a)
        a.activate(id, "stream", null)
        a.acceptTerms(id)
        val token = tokenFor(a)
        assertNotNull(a.resolve(token))

        a.setSuspended(id, true)
        assertNull(a.resolve(token))
    }

    @Test
    fun erasingTakesTheAccountAndItsSessionsTogether() {
        val a = accounts()
        val id = register(a)
        a.activate(id, "stream", null)
        a.acceptTerms(id)
        val token = tokenFor(a)

        a.erase(id)
        assertNull(a.resolve(token))
        assertEquals(0, a.list(null, null).getJSONArray("accounts").length())
        assertFalse(dirs.first().resolve("accounts.json").readText().contains("someone@example.com"))
    }

    @Test
    fun onlyTheTwoRealTiersCanBeGranted() {
        val a = accounts()
        val id = register(a)
        assertNull(a.activate(id, "free", null))
        assertNull(a.activate(id, "premium", null))
        assertNotNull(a.activate(id, "stream", null))
        assertNotNull(a.activate(id, "stream-live", null))
    }

    @Test
    fun termsAgreedToAnOlderVersionDoNotCarryOver() {
        val a = accounts()
        val id = register(a)
        a.activate(id, "stream", null)
        a.acceptTerms(id)
        assertTrue(a.usable(a.resolve(tokenFor(a))).getBoolean("ok"))

        // The same ledger, read by a build carrying newer terms.
        val moved = TvmAccounts(TvmStore(dirs.first())) { "{\"termsVersion\":\"2027-01-01\",\"tiers\":[]}" }
        val reread = moved.resolve(moved.signIn("someone@example.com", password, "test").getOrThrow().getString("token"))
        assertEquals("terms_required", moved.usable(reread).getString("reason"))
    }

    @Test
    fun aPasswordBelowTenCharactersIsRefused() {
        val a = accounts()
        assertTrue(a.register("someone@example.com", "short", null, null).isFailure)
        assertTrue(a.register("someone@example.com", "0123456789", null, null).isSuccess)
    }

    @Test
    fun rokuAccountHeaderIsAcceptedByTheOnDeviceCore() {
        val dir = Files.createTempDirectory("tvm-core").toFile()
        dirs.add(dir)
        val core = TvmLocalCore.create(dir, { null })
        val register = core.handle(
            "POST",
            "/api/account/register",
            "",
            JSONObject()
                .put("email", "someone@example.com")
                .put("password", password)
                .put("displayName", "Someone")
                .toString()
                .toByteArray(),
        )
        assertEquals(200, register.status)
        val signed = core.handle(
            "POST",
            "/api/account/signin",
            "",
            JSONObject().put("email", "someone@example.com").put("password", password).toString().toByteArray(),
        )
        assertEquals(200, signed.status)
        val token = JSONObject(String(signed.body)).getString("token")
        val viaHeader = core.handle("GET", "/api/account", "", ByteArray(0), mapOf("x-tvm-account" to token))
        assertEquals(200, viaHeader.status)
        assertTrue(JSONObject(String(viaHeader.body)).getBoolean("signedIn"))
    }

    // ---- The dev account ---------------------------------------------------

    @Test
    fun devAccountIsBuiltInAlwaysUsableAndNotListed() {
        val a = accounts()
        val first = a.signInDev("test")
        assertEquals("dev", first.getJSONObject("account").getString("role"))
        assertTrue(first.getJSONObject("usable").getBoolean("ok"))
        val second = a.signInDev("test")
        assertEquals(TvmAccounts.DEV_ACCOUNT_ID, second.getJSONObject("account").getString("id"))
        assertEquals(0, a.list(null, null).getJSONArray("accounts").length())
        assertEquals(0, a.list(null, null).getJSONObject("summary").getInt("total"))
    }

    @Test
    fun devAccountCannotBeReachedWithAPassword() {
        val a = accounts()
        a.signInDev("test")
        assertTrue(a.signIn("dev", "", "test").isFailure)
        assertTrue(a.signIn("dev", password, "test").isFailure)
    }

    @Test
    fun devAccountCannotBeSwitchedOffOrErasedFromTheAccountsScreen() {
        val a = accounts()
        val token = a.signInDev("test").getString("token")
        assertNull(a.setSuspended(TvmAccounts.DEV_ACCOUNT_ID, true))
        assertNull(a.activate(TvmAccounts.DEV_ACCOUNT_ID, "stream", null))
        assertTrue(a.setRdToken(TvmAccounts.DEV_ACCOUNT_ID, "abc").isFailure)
        a.erase(TvmAccounts.DEV_ACCOUNT_ID)
        assertNotNull(a.resolve(token))
    }

    @Test
    fun devCountsAsSignedInUntilItsLastSessionEnds() {
        val a = accounts()
        assertFalse(a.devSignedIn())
        val one = a.signInDev("test").getString("token")
        val two = a.signInDev("test").getString("token")
        a.signOut(one)
        assertTrue(a.devSignedIn())
        a.signOut(two)
        assertFalse(a.devSignedIn())
    }

    // ---- What the dev sets per account --------------------------------------

    @Test
    fun anAccountKeepsItsOwnRealDebridKeyAndOnlyShowsItsEnd() {
        val a = accounts()
        val id = register(a)
        val token = tokenFor(a)
        assertNull(a.rdTokenFor(token))

        val saved = a.setRdToken(id, "  ABCDEFGHIJKLMNOPQRSTUVWXYZ1234  ").getOrThrow()
        assertTrue(saved.getBoolean("rdKey"))
        assertEquals("••••1234", saved.getString("rdKeyHint"))
        assertFalse(saved.toString().contains("ABCDEFGHIJ"))
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", a.rdTokenFor(token))

        assertFalse(a.setRdToken(id, "").getOrThrow().getBoolean("rdKey"))
        assertNull(a.rdTokenFor(token))
        assertTrue(a.setRdToken(id, "has a space").isFailure)
    }

    @Test
    fun liveTvIsSwitchedOnlyForAnAccountThatIsOn() {
        val a = accounts()
        val id = register(a)
        assertTrue(a.setLiveTv(id, true).isFailure)
        a.activate(id, "stream", null)
        assertEquals("stream-live", a.setLiveTv(id, true).getOrThrow().getString("tier"))
        assertEquals("stream", a.setLiveTv(id, false).getOrThrow().getString("tier"))
    }

    @Test
    fun theDevCanMarkAnAddressVerified() {
        val a = accounts()
        val id = register(a)
        assertTrue(a.setEmailVerified(id, true).getOrThrow().getBoolean("emailVerified"))
        assertFalse(a.setEmailVerified(id, false).getOrThrow().getBoolean("emailVerified"))
    }

    // ---- The on-device core -------------------------------------------------

    private val access = "{\"termsVersion\":\"2026-09-15\",\"tiers\":[]}"
    private val coreDirs = mutableMapOf<TvmLocalCore, File>()

    private fun core(): TvmLocalCore {
        val dir = Files.createTempDirectory("tvm-core").toFile()
        dirs.add(dir)
        val made = TvmLocalCore.create(dir, { null }, bundledAccess = { access })
        coreDirs[made] = dir
        return made
    }

    /** A dev session on this core, as the right developer code would give. The code is not in the repo. */
    private fun devToken(core: TvmLocalCore): String =
        TvmAccounts(TvmStore(coreDirs.getValue(core))) { access }.signInDev("test").getString("token")

    private fun call(core: TvmLocalCore, method: String, path: String, body: JSONObject? = null, token: String? = null): Pair<Int, JSONObject> {
        val headers = if (token == null) emptyMap() else mapOf("authorization" to "Bearer $token")
        val reply = core.handle(method, path, "", (body?.toString() ?: "").toByteArray(), headers)
        return reply.status to JSONObject(String(reply.body))
    }

    @Test
    fun aWrongDevCodeIsRefusedAndDevModeStaysOff() {
        val c = core()
        val (status, body) = call(c, "POST", "/api/account/dev", JSONObject().put("code", "not the code"))
        assertEquals(403, status)
        assertEquals("That code is not valid.", body.getString("error"))
        assertFalse(c.plans.developer())
    }

    @Test
    fun devOnlyRoutesNeedDevModeAndPhonesSayTheyDoNotSendEmail() {
        val c = core()
        for (path in listOf("/api/admin/accounts/live-tv", "/api/admin/accounts/rd", "/api/admin/accounts/verify")) {
            assertEquals(403, call(c, "POST", path, JSONObject().put("id", "x")).first)
        }
        assertEquals(403, call(c, "GET", "/api/admin/mail").first)
        // Dev mode switched on for the phone is not enough; it has to be the dev asking.
        c.plans.setDeveloper(true)
        assertEquals(403, call(c, "GET", "/api/admin/mail").first)
        assertFalse(call(c, "GET", "/api/plan").second.getBoolean("developer"))

        val dev = devToken(c)
        val mail = call(c, "GET", "/api/admin/mail", token = dev)
        assertEquals(200, mail.first)
        assertFalse(mail.second.getBoolean("supported"))
        assertTrue(call(c, "GET", "/api/plan", token = dev).second.getBoolean("developer"))
        assertEquals(503, call(c, "POST", "/api/account/email/send").first)
    }

    @Test
    fun aMemberCannotUseTheAccountsScreenWhileTheDevIsSignedIn() {
        val c = core()
        val signUp = JSONObject().put("email", "someone@example.com").put("password", password)
        call(c, "POST", "/api/account/register", signUp)
        val member = call(c, "POST", "/api/account/signin", signUp).second.getString("token")
        val dev = devToken(c)
        c.plans.setDeveloper(true)
        assertEquals(403, call(c, "GET", "/api/admin/accounts", token = member).first)
        assertEquals(200, call(c, "GET", "/api/admin/accounts", token = dev).first)
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

    @Test
    fun theDevSetsAMemberKeyAndTheMemberSeesItIsTheirs() {
        val c = core()
        val signUp = JSONObject().put("email", "someone@example.com").put("password", password)
        call(c, "POST", "/api/account/register", signUp)
        val token = call(c, "POST", "/api/account/signin", signUp).second.getString("token")
        val dev = devToken(c)
        val id = call(c, "GET", "/api/admin/accounts", token = dev).second.getJSONArray("accounts").getJSONObject(0).getString("id")
        val saved = call(c, "POST", "/api/admin/accounts/rd", JSONObject().put("id", id).put("token", "RDKEY0000WXYZ"), dev)
        assertEquals("••••WXYZ", saved.second.getString("rdKeyHint"))
        val me = call(c, "GET", "/api/account", token = token).second
        assertTrue(me.getJSONObject("account").getBoolean("rdKey"))
        assertFalse(me.getBoolean("canSendEmail"))

        // Clearing it from the member's own Real-Debrid screen needs no network.
        val cleared = call(c, "PUT", "/api/rd/token", JSONObject().put("token", ""), token)
        assertEquals(200, cleared.first)
        assertTrue(cleared.second.isNull("source"))
        assertFalse(call(c, "GET", "/api/account", token = token).second.getJSONObject("account").getBoolean("rdKey"))
    }
}
