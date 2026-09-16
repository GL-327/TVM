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
}
