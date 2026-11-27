package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

class TvmSyncTest {
    private val dirs = mutableListOf<File>()
    private val closables = mutableListOf<() -> Unit>()
    private val terms = "2026-09-15"
    private val access = """{"termsVersion":"$terms","tiers":[]}"""
    private val passPhrase = "long-passphrase-for-sync-tests"

    @After
    fun cleanUp() {
        closables.forEach { runCatching { it() } }
        closables.clear()
        dirs.forEach { it.deleteRecursively() }
        dirs.clear()
    }

    private fun tempDir(prefix: String = "tvm-sync-"): File =
        Files.createTempDirectory(prefix).toFile().also { dirs.add(it) }

    private fun loadFixture(): JSONObject {
        val stream = TvmSyncTest::class.java.classLoader?.getResourceAsStream("sync-fixture.json")
        val text = if (stream != null) {
            stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } else {
            val candidates = listOf(
                File("app/src/test/resources/sync-fixture.json"),
                File("src/test/resources/sync-fixture.json"),
            )
            candidates.first { it.isFile }.readText(Charsets.UTF_8)
        }
        return JSONObject(text)
    }

    private class FakeScheduler(private val clock: () -> Long) : TvmSyncScheduler {
        private class Entry(val id: Long, val runAt: Long, val task: Runnable, var cancelled: Boolean = false)

        private var nextId = 0L
        private val entries = mutableListOf<Entry>()

        override fun schedule(delayMs: Long, task: Runnable): TvmSyncScheduler.Cancellable {
            val entry = Entry(++nextId, clock() + maxOf(0L, delayMs), task)
            synchronized(entries) { entries.add(entry) }
            return TvmSyncScheduler.Cancellable {
                synchronized(entries) { entry.cancelled = true }
            }
        }

        fun runDue(advanceClock: (Long) -> Unit, deltaMs: Long) {
            val target = clock() + deltaMs
            while (true) {
                val next = synchronized(entries) {
                    entries.filter { !it.cancelled && it.runAt <= target }
                        .minWithOrNull(compareBy<Entry> { it.runAt }.thenBy { it.id })
                        ?.also { entries.remove(it) }
                }
                if (next == null) {
                    val remaining = target - clock()
                    if (remaining > 0L) advanceClock(remaining)
                    return
                }
                val step = next.runAt - clock()
                if (step > 0L) advanceClock(step)
                next.task.run()
            }
        }

        fun activeCount(): Int = synchronized(entries) { entries.count { !it.cancelled } }

        override fun shutdown() {
            synchronized(entries) {
                for (entry in entries) entry.cancelled = true
                entries.clear()
            }
        }
    }

    private class FakeTransport(private val clock: () -> Long) : SyncTransport {
        data class Row(val item: SyncItem, val seq: Long)

        var seqClock = 0L
        var generation = "\"0\""
        val rows = LinkedHashMap<String, Row>()
        var getCalls = 0
        var putCalls = 0
        val putPayloads = mutableListOf<String>()
        val getQueries = mutableListOf<String>()
        var customGet: ((String, Long, String?, String?) -> SyncPage)? = null
        var customPut: ((String, List<SyncItem>, String) -> Unit)? = null
        val queuedGetErrors = ArrayDeque<Throwable>()

        fun seed(items: List<SyncItem>) {
            seqClock = maxOf(seqClock + 1L, clock())
            for (item in items) {
                val id = item.itemId
                val old = rows[id]?.item
                if (old == null || old.updatedAt < item.updatedAt) {
                    rows[id] = Row(item, seqClock)
                }
            }
        }

        fun clearCloud() {
            rows.clear()
            seqClock++
            generation = "\"1\""
        }

        override fun getSyncPage(token: String, since: Long, cursor: String?, generation: String?): SyncPage {
            getCalls++
            getQueries.add(if (cursor == null) "since=$since" else "since=$since&cursor=$cursor")
            if (queuedGetErrors.isNotEmpty()) throw queuedGetErrors.removeFirst()
            customGet?.let { return it(token, since, cursor, generation) }
            if (generation != null && generation != this.generation) throw SyncHttpException(412)
            val arr = JSONArray()
            for (row in rows.values) {
                if (row.seq > since) arr.put(row.item.json())
            }
            return SyncPage(JSONObject().put("items", arr).put("now", seqClock), this.generation)
        }

        override fun putSyncItems(token: String, items: List<SyncItem>, generation: String) {
            putCalls++
            val arr = JSONArray()
            for (item in items) arr.put(item.json())
            putPayloads.add(SyncSchema.canonicalJson(JSONObject().put("items", arr)))
            customPut?.let {
                it(token, items, generation)
                return
            }
            if (generation != this.generation) throw SyncHttpException(412)
            seed(items)
        }
    }

    private class FakeBackend : TvmAccountsHttp, TvmSyncHttp {
        class Account(val id: String, val email: String, val pass: String)

        val accounts = mutableListOf<Account>()
        val sessions = LinkedHashMap<String, Account>()
        val cloudPerAccount = LinkedHashMap<String, LinkedHashMap<String, Pair<SyncItem, Long>>>()
        val generationPerAccount = LinkedHashMap<String, String>()
        val sentPutPayloads = mutableListOf<String>()
        var clock = 100L
        var down = false
        var syncDisabled404 = false
        var injectInvalidRemoteItem: JSONObject? = null
        private var counter = 0

        fun seedCloud(accountId: String, item: SyncItem, seq: Long = 50L) {
            val map = cloudPerAccount.getOrPut(accountId) { LinkedHashMap() }
            map[item.itemId] = item to seq
        }

        fun cloudOf(accountId: String): Map<String, SyncItem> =
            cloudPerAccount[accountId]?.mapValues { it.value.first } ?: emptyMap()

        private fun accountJson(acc: Account) = JSONObject().apply {
            put("id", acc.id)
            put("email", acc.email)
            put("displayName", acc.email.substringBefore('@'))
            put("role", "member")
            put("status", "active")
            put("tier", "stream")
            put("liveTv", false)
            put("emailVerified", true)
            put("termsVersion", "2026-09-15")
            put("hasRdToken", false)
            put("createdAt", "2026-11-01T00:00:00Z")
        }

        override fun send(method: String, url: String, bearer: String?, body: String?, timeoutMs: Int): Pair<Int, String> {
            val reply = send(method, url, bearer, emptyMap(), body, timeoutMs)
            return reply.status to reply.body
        }

        override fun send(
            method: String,
            url: String,
            bearer: String?,
            headers: Map<String, String>,
            body: String?,
            timeoutMs: Int,
        ): SyncHttpReply {
            if (down) throw IOException("offline")
            val rawPath = url.removePrefix(TVM_ACCOUNTS_URL)
            val qIdx = rawPath.indexOf('?')
            val path = if (qIdx >= 0) rawPath.substring(0, qIdx) else rawPath
            val query = if (qIdx >= 0) rawPath.substring(qIdx + 1) else ""

            if (method == "POST" && path == "/v1/signin") {
                val json = JSONObject(body ?: "{}")
                val acc = accounts.firstOrNull { it.email == json.getString("email") && it.pass == json.getString("password") }
                    ?: return SyncHttpReply(401, """{"error":"invalid"}""")
                val tok = "sess_${++counter}_" + "x".repeat(24)
                sessions[tok] = acc
                return SyncHttpReply(200, JSONObject().put("session", tok).put("account", accountJson(acc)).toString())
            }
            val acc = bearer?.let { sessions[it] } ?: return SyncHttpReply(401, """{"error":"unauthorized"}""")
            if (method == "POST" && path == "/v1/signout") {
                sessions.remove(bearer)
                return SyncHttpReply(204, "")
            }
            if (method == "GET" && path == "/v1/me") {
                return SyncHttpReply(200, JSONObject().put("account", accountJson(acc)).toString())
            }
            if (path == "/v1/me/data") {
                if (syncDisabled404) return SyncHttpReply(404, """{"error":"not_found"}""")
                val gen = generationPerAccount.getOrPut(acc.id) { "\"0\"" }
                val map = cloudPerAccount.getOrPut(acc.id) { LinkedHashMap() }
                if (method == "GET") {
                    val since = query.split('&').firstOrNull { it.startsWith("since=") }
                        ?.substringAfter("since=")?.toLongOrNull() ?: 0L
                    val items = JSONArray()
                    for ((item, seq) in map.values) {
                        if (seq > since) items.put(item.json())
                    }
                    injectInvalidRemoteItem?.let { items.put(it) }
                    return SyncHttpReply(
                        200,
                        JSONObject().put("items", items).put("now", clock).toString(),
                        etag = gen,
                    )
                }
                if (method == "PUT") {
                    sentPutPayloads.add(body ?: "")
                    val json = JSONObject(body ?: "{}")
                    val arr = json.optJSONArray("items") ?: JSONArray()
                    clock++
                    for (i in 0 until arr.length()) {
                        val raw = arr.getJSONObject(i)
                        val parsed = SyncSchema.parseSyncItem(raw, Long.MAX_VALUE / 2) ?: continue
                        val prev = map[parsed.itemId]?.first
                        if (prev == null || prev.updatedAt < parsed.updatedAt) {
                            map[parsed.itemId] = parsed to clock
                        }
                    }
                    return SyncHttpReply(204, "", etag = gen)
                }
            }
            return SyncHttpReply(404, """{"error":"not_found"}""")
        }
    }

    private fun prefItem(key: String, value: Any?, updatedAt: Long, deleted: Boolean = false): SyncItem =
        SyncItem("preference", key, value, updatedAt, deleted)

    private fun projected(vararg items: SyncItem): Map<String, SnapshotItem> {
        val out = LinkedHashMap<String, SnapshotItem>()
        for (item in items) {
            out[item.itemId] = SnapshotItem(item, SyncSchema.valueHash(item.value), item.updatedAt)
        }
        return out
    }

    // 1. Core fixture compatibility
    @Test
    fun coreFixtureHashesPullAndInvalidCasesMatchExactly() {
        val fixture = loadFixture()
        val now = fixture.getLong("now")
        val expected = fixture.getJSONObject("expected")
        val getResponse = fixture.getJSONObject("getResponse")
        val rawItems = getResponse.getJSONArray("items")

        assertEquals(8, rawItems.length())
        for (i in 0 until rawItems.length()) {
            val raw = rawItems.getJSONObject(i)
            val parsed = SyncSchema.parseSyncItem(raw, now)
            assertNotNull("Fixture item $i should parse", parsed)
            val exp = expected.getJSONObject(parsed!!.itemId)
            assertEquals(exp.getString("id"), parsed.itemId)
            assertEquals(exp.getLong("updatedAt"), parsed.updatedAt)
            assertEquals(exp.getString("hash"), SyncSchema.valueHash(parsed.value))
        }

        val invalidCases = fixture.getJSONArray("invalidCases")
        assertTrue(invalidCases.length() > 0)
        for (i in 0 until invalidCases.length()) {
            val bad = invalidCases.getJSONObject(i)
            assertNull("invalidCase $i must be rejected", SyncSchema.parseSyncItem(bad, now))
        }

        var clock = now
        val dir = tempDir()
        SyncStores.initializeStores(dir, null)
        val scheduler = FakeScheduler { clock }
        val transport = FakeTransport { clock }.apply {
            generation = fixture.getString("etag")
            customGet = { _, _, _, _ -> SyncPage(getResponse, fixture.getString("etag")) }
        }
        val engine = SyncEngine(
            directory = dir,
            reloadProfiles = {},
            transport = transport,
            sessionRejected = {},
            now = { clock },
            scheduler = scheduler,
        )
        closables.add { engine.close() }
        engine.attach("fixture-session")
        val status = engine.syncNow()
        assertTrue(status.enabled)
        assertEquals(0, status.pending)
        assertNull(status.error)
        assertEquals(0, transport.putCalls)

        val snap = SyncStores.snapshot(dir, now)
        val keys = expected.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val expHash = expected.getJSONObject(id).getString("hash")
            assertEquals("Round-trip hash mismatch for $id", expHash, snap[id]?.hash)
        }
    }

    // 2. Merge tests (LWW, ties, tombstones)
    @Test
    fun mergeLogicHandlesDisjointTieAndTombstoneCases() {
        val ledger1 = SyncLedger()
        val local = prefItem("extras.ratings", false, 20L)
        val alsoLocal = prefItem("extras.trailers", false, 30L)
        val remote = prefItem("extras.collections", false, 10L)
        SyncMerge.observeLocal(ledger1, projected(local, alsoLocal), 30L)
        val changes1 = SyncMerge.mergeRemote(
            ledger1,
            listOf(remote, prefItem(local.key, true, 19L), prefItem(alsoLocal.key, true, 31L)),
        )
        assertEquals(listOf(remote, prefItem(alsoLocal.key, true, 31L)), changes1)
        assertEquals(listOf(local), ledger1.pending.values.toList())
        assertEquals(31L, ledger1.versions[alsoLocal.itemId]?.updatedAt)

        val ledger2 = SyncLedger()
        val tieLocal = prefItem("autoplayNext", true, 20L)
        SyncMerge.observeLocal(ledger2, projected(tieLocal), 20L)
        val tieChanges = SyncMerge.mergeRemote(ledger2, listOf(prefItem(tieLocal.key, false, 20L)))
        assertEquals(listOf(prefItem(tieLocal.key, false, 20L)), tieChanges)
        assertTrue(ledger2.pending.isEmpty())
        SyncMerge.observeLocal(ledger2, projected(tieLocal), 20L)
        assertEquals(listOf(prefItem(tieLocal.key, true, 21L)), ledger2.pending.values.toList())
        assertTrue(SyncMerge.mergeRemote(ledger2, listOf(prefItem(tieLocal.key, false, 20L))).isEmpty())

        val ledger3 = SyncLedger()
        val item = prefItem("extras.announcements", false, 10L)
        val deleted = prefItem(item.key, null, 11L, deleted = true)
        SyncMerge.observeLocal(ledger3, projected(item), 10L)
        SyncMerge.observeLocal(ledger3, emptyMap(), 11L)
        assertEquals(listOf(deleted), ledger3.pending.values.toList())
        assertTrue(SyncMerge.mergeRemote(ledger3, listOf(item)).isEmpty())
        assertTrue(SyncMerge.mergeRemote(ledger3, listOf(deleted)).isEmpty())
        assertTrue(ledger3.pending.isEmpty())
        val recreated = item.copy(updatedAt = 12L)
        assertEquals(listOf(recreated), SyncMerge.mergeRemote(ledger3, listOf(recreated)))
    }

    // 3. First-sync merge over TvmLocalCore HTTP routes + device prefs isolation + invalid remote rejection
    @Test
    fun firstSyncMergeOverLocalCoreRoutesAndKeepsDevicePrefsLocal() {
        val dataDir = tempDir("tvm-core-sync-")
        val store = TvmStore(dataDir)
        val reg = store.profiles()
        store.saveProfiles(reg.activeId, listOf(reg.profiles[0].copy(name = "Local Viewer")))
        store.writeProgress("profile-1", "tt00001", 30.0, 120.0)
        store.writeWatchlist(
            "profile-1",
            listOf(
                MediaItem(
                    id = "tt54321",
                    title = "Local Title",
                    poster = "https://private.invalid/asset?token=secret",
                    added = "2026-11-20T00:00:00Z",
                ),
            ),
        )
        TvmPrefs(
            language = "fr",
            quality = "1080",
            audioLanguage = "spa",
            webhookUrl = "https://private.invalid/hook",
        ).save(store)

        val backend = FakeBackend().apply {
            accounts.add(FakeBackend.Account("acc_sync_http", "sync@example.invalid", passPhrase))
            seedCloud("acc_sync_http", prefItem("extras.ratings", false, 50L))
            seedCloud(
                "acc_sync_http",
                SyncItem(
                    kind = "progress",
                    key = "profile-1/tt00002",
                    value = JSONObject().put("position", 60).put("duration", 120).put("updated", "2026-11-27T00:00:00.000Z"),
                    updatedAt = 50L,
                    deleted = false,
                ),
            )
        }
        val vault = MemorySessionVault()
        val core = TvmLocalCore.create(
            dataDir,
            { null },
            bundledAccess = { access },
            accountsHttp = backend,
            sessionVault = vault,
            syncHttp = backend,
        )
        closables.add { core.close() }

        fun call(method: String, path: String, body: JSONObject? = null, token: String? = null): Pair<Int, JSONObject> {
            val headers = if (token == null) emptyMap() else mapOf("authorization" to "Bearer $token")
            val reply = core.handle(method, path, "", (body?.toString() ?: "").toByteArray(Charsets.UTF_8), headers)
            return reply.status to JSONObject(String(reply.body, Charsets.UTF_8))
        }

        assertFalse(call("GET", "/api/sync/status").second.getBoolean("enabled"))
        assertFalse(call("POST", "/api/sync/now", JSONObject()).second.getBoolean("enabled"))

        val signed = call(
            "POST",
            "/api/account/signin",
            JSONObject().put("email", "sync@example.invalid").put("password", passPhrase),
        )
        assertEquals(200, signed.first)
        val token = signed.second.getString("token")

        val first = call("POST", "/api/sync/now", JSONObject(), token)
        assertEquals(200, first.first)
        assertTrue(first.second.getBoolean("enabled"))
        assertEquals(0, first.second.getInt("pending"))
        assertTrue(first.second.isNull("error"))
        assertFalse(first.second.isNull("lastSyncAt"))

        val prefs = call("GET", "/api/prefs", token = token).second
        assertEquals("1080", prefs.getString("quality"))
        assertEquals("fr", prefs.getString("language"))
        assertEquals("spa", prefs.getString("audioLanguage"))
        assertFalse(prefs.getJSONObject("extras").getBoolean("ratings"))
        assertTrue(backend.cloudOf("acc_sync_http").containsKey("progress:profile-1/tt00001"))
        assertTrue(backend.cloudOf("acc_sync_http").containsKey("preference:audioLanguage"))

        // Invalid remote item from cloud must be rejected without applying locally.
        backend.injectInvalidRemoteItem = JSONObject()
            .put("kind", "preference")
            .put("key", "quality")
            .put("value", "720")
            .put("updatedAt", 999L)
            .put("deleted", false)
        val badSync = call("POST", "/api/sync/now", JSONObject(), token).second
        assertEquals("Account data could not sync.", badSync.getString("error"))
        backend.injectInvalidRemoteItem = null

        call("PUT", "/api/prefs", JSONObject().put("audioLanguage", "jpn").put("quality", "720"), token)
        call("PUT", "/api/watchlist", JSONObject().put("item", JSONObject().put("id", "tt55555").put("title", "Watchlisted")), token)
        call("POST", "/api/progress/watched", JSONObject().put("id", "tt00001").put("watched", true), token)
        call("POST", "/api/progress/remove", JSONObject().put("id", "tt00002"), token)

        val synced = call("POST", "/api/sync/now", JSONObject(), token).second
        assertEquals(0, synced.getInt("pending"))
        assertTrue(synced.isNull("error"))
        assertEquals("jpn", backend.cloudOf("acc_sync_http")["preference:audioLanguage"]?.value)
        assertTrue(backend.cloudOf("acc_sync_http")["watchlist:profile-1/tt55555"]?.deleted == true)
        val tt2 = backend.cloudOf("acc_sync_http")["progress:profile-1/tt00002"]?.value as? JSONObject
        assertEquals(true, tt2?.getBoolean("hiddenFromContinueWatching"))

        for (payload in backend.sentPutPayloads) {
            assertFalse(payload.contains("\"quality\""))
            assertFalse(payload.contains("webhookUrl"))
            assertFalse(payload.contains("private.invalid"))
        }
    }

    // 4. Debounce, 60s periodic pull, backoff + Retry-After, 412 reset, 404 disable, 401 reject
    @Test
    fun timersBackoffRetryAfter412Reset404DisableAnd401Reject() {
        var clock = 1_000_000L
        val advance: (Long) -> Unit = { clock += it }
        val scheduler = FakeScheduler { clock }
        val transport = FakeTransport { clock }
        val dir = tempDir()
        SyncStores.initializeStores(dir, null)
        val store = TvmStore(dir)
        val rejected = mutableListOf<String>()

        val engine = SyncEngine(
            directory = dir,
            reloadProfiles = {},
            transport = transport,
            sessionRejected = { rejected.add(it) },
            now = { clock },
            scheduler = scheduler,
        )
        closables.add { engine.close() }
        store.onSyncStoreChanged = { engine.notifyStoreChanged() }

        // Initial pull on attach, 3s debounce from last change, 60s periodic pull.
        engine.attach("s1")
        scheduler.runDue(advance, 0L)
        assertEquals(1, transport.getCalls)

        store.writeProgress("profile-1", "tt12345", 35.0, 120.0)
        scheduler.runDue(advance, 2_000L)
        store.removeContinueWatching("profile-1", "tt12345")
        scheduler.runDue(advance, 2_999L)
        assertEquals(0, transport.putCalls)
        scheduler.runDue(advance, 1L)
        assertEquals(1, transport.putCalls)
        val getsBeforeMinute = transport.getCalls
        scheduler.runDue(advance, 59_999L)
        assertEquals(getsBeforeMinute, transport.getCalls)
        scheduler.runDue(advance, 1L)
        assertEquals(getsBeforeMinute + 1, transport.getCalls)

        // Backoff + Retry-After + restart persistence.
        transport.getCalls = 0
        transport.putCalls = 0
        transport.queuedGetErrors.addLast(SyncHttpException(503))
        transport.queuedGetErrors.addLast(SyncHttpException(429, "30"))
        store.writeWatchlist("profile-1", listOf(MediaItem(id = "tt99900", title = "Saved", added = "2026-11-27T00:00:00Z")))
        scheduler.runDue(advance, 3_000L)
        assertEquals("Account data could not sync.", engine.status().error)
        assertEquals(1, engine.status().pending)
        scheduler.runDue(advance, 4_999L)
        assertEquals(1, transport.getCalls)
        scheduler.runDue(advance, 1L)
        assertEquals(2, transport.getCalls)
        scheduler.runDue(advance, 29_999L)
        assertEquals(2, transport.getCalls)
        assertEquals(0, transport.putCalls)
        engine.close()

        val scheduler2 = FakeScheduler { clock }
        val restarted = SyncEngine(
            directory = dir,
            reloadProfiles = {},
            transport = transport,
            sessionRejected = {},
            now = { clock },
            scheduler = scheduler2,
        )
        closables.add { restarted.close() }
        restarted.attach("s1")
        assertEquals(1, restarted.status().pending)
        assertEquals(0, restarted.syncNow().pending)
        assertTrue(transport.rows.containsKey("watchlist:profile-1/tt99900"))

        // 412 generation reset drops old queue, keeps device data, syncs subsequent edit.
        store.onSyncStoreChanged = { restarted.notifyStoreChanged() }
        store.writeProgress("profile-1", "tt12345", 55.0, 120.0)
        transport.clearCloud()
        val after412 = restarted.syncNow()
        assertEquals(0, after412.pending)
        assertEquals(0, transport.rows.size)
        assertEquals(55.0, store.progress("profile-1")["tt12345"]?.position ?: 0.0, 0.01)
        store.writeProgress("profile-1", "tt12345", 65.0, 120.0)
        restarted.syncNow()
        assertEquals(65, (transport.rows["progress:profile-1/tt12345"]?.item?.value as JSONObject).getInt("position"))
        restarted.close()

        // 404 silent disable.
        val dir404 = tempDir()
        SyncStores.initializeStores(dir404, null)
        val sched404 = FakeScheduler { clock }
        val trans404 = FakeTransport { clock }.apply { queuedGetErrors.addLast(SyncHttpException(404)) }
        val eng404 = SyncEngine(dir404, reloadProfiles = {}, transport = trans404, sessionRejected = {}, now = { clock }, scheduler = sched404)
        closables.add { eng404.close() }
        eng404.attach("s404")
        assertEquals(SyncStatus.DISABLED, eng404.syncNow())
        eng404.notifyStoreChanged()
        sched404.runDue(advance, 600_000L)
        assertEquals(1, trans404.getCalls)
        assertEquals(SyncStatus.DISABLED, eng404.status())

        // 401 session rejection.
        val dir401 = tempDir()
        SyncStores.initializeStores(dir401, null)
        val sched401 = FakeScheduler { clock }
        val trans401 = FakeTransport { clock }.apply { queuedGetErrors.addLast(SyncHttpException(401)) }
        val eng401 = SyncEngine(dir401, reloadProfiles = {}, transport = trans401, sessionRejected = { rejected.add(it) }, now = { clock }, scheduler = sched401)
        closables.add { eng401.close() }
        eng401.attach("s401")
        eng401.syncNow()
        assertEquals(listOf("s401"), rejected)
    }

    // 5. Sign-out clears ledger + different account isolation + 6. No raw secrets on disk
    @Test
    fun signOutClearsLedgerAccountsStayIsolatedAndNoTokensOrPasswordsOnDisk() {
        val dataDir = tempDir("tvm-isolation-")
        val backend = FakeBackend().apply {
            accounts.add(FakeBackend.Account("acc_one", "one@example.invalid", passPhrase))
            accounts.add(FakeBackend.Account("acc_two", "two@example.invalid", passPhrase))
        }
        val vault = MemorySessionVault()
        val core = TvmLocalCore.create(
            dataDir,
            { null },
            bundledAccess = { access },
            accountsHttp = backend,
            sessionVault = vault,
            syncHttp = backend,
        )
        closables.add { core.close() }

        fun call(method: String, path: String, body: JSONObject? = null, token: String? = null): Pair<Int, JSONObject> {
            val headers = if (token == null) emptyMap() else mapOf("authorization" to "Bearer $token")
            val reply = core.handle(method, path, "", (body?.toString() ?: "").toByteArray(Charsets.UTF_8), headers)
            return reply.status to JSONObject(String(reply.body, Charsets.UTF_8))
        }

        // Pre-existing local data before Account One signs in.
        TvmPrefs(audioLanguage = "fra", quality = "720").save(core.store)
        core.store.writeProgress("profile-1", "tt11111", 40.0, 100.0)
        core.store.writeWatchlist("profile-1", listOf(MediaItem(id = "tt11111", title = "Account One Film", added = "2026-11-27T00:00:00Z")))

        val token1 = call("POST", "/api/account/signin", JSONObject().put("email", "one@example.invalid").put("password", passPhrase)).second.getString("token")
        assertEquals(0, call("POST", "/api/sync/now", JSONObject(), token1).second.getInt("pending"))
        assertTrue(backend.cloudOf("acc_one").containsKey("progress:profile-1/tt11111"))

        val account1Dir = core.store.activeSyncDir()!!
        assertTrue(File(account1Dir, "ledger.json").isFile)

        // Verify raw token, password, and email are never written anywhere on disk.
        val diskTextBeforeSignOut = dataDir.walkTopDown().filter { it.isFile }.joinToString("\n") { it.readText(Charsets.UTF_8) }
        assertFalse(diskTextBeforeSignOut.contains(token1))
        assertFalse(diskTextBeforeSignOut.contains(passPhrase))
        assertFalse(diskTextBeforeSignOut.contains("one@example.invalid"))

        // Simulate offline app restart: restoreSyncFromVault restores account1Dir without network.
        backend.down = true
        val coreRestart = TvmLocalCore.create(
            dataDir,
            { null },
            bundledAccess = { access },
            accountsHttp = backend,
            sessionVault = vault,
            syncHttp = backend,
        )
        try {
            coreRestart.restoreSyncFromVault()
            assertEquals(account1Dir, coreRestart.store.activeSyncDir())
            assertEquals(1, coreRestart.store.progress("profile-1").size)
            assertEquals(1, coreRestart.store.watchlist("profile-1").size)
        } finally {
            coreRestart.close()
            backend.down = false
        }

        // Sign out clears ledger.json, disables status, resets activeSyncDir.
        assertEquals(200, call("POST", "/api/account/signout", JSONObject(), token1).first)
        assertFalse(File(account1Dir, "ledger.json").exists())
        assertNull(core.store.activeSyncDir())
        assertFalse(call("GET", "/api/sync/status", token = token1).second.getBoolean("enabled"))

        // Sign into Account Two: must start completely clean and never inherit Account One's data.
        val token2 = call("POST", "/api/account/signin", JSONObject().put("email", "two@example.invalid").put("password", passPhrase)).second.getString("token")
        val account2Dir = core.store.activeSyncDir()!!
        assertNotEquals(account1Dir, account2Dir)
        assertEquals(0, call("POST", "/api/sync/now", JSONObject(), token2).second.getInt("pending"))
        assertTrue(core.store.progress("profile-1").isEmpty())
        assertTrue(core.store.watchlist("profile-1").isEmpty())
        assertEquals("original", call("GET", "/api/prefs", token = token2).second.getString("audioLanguage"))
        assertEquals("720", call("GET", "/api/prefs", token = token2).second.getString("quality"))
        assertTrue(backend.cloudOf("acc_two").isEmpty())

        val diskTextAfterTwo = dataDir.walkTopDown().filter { it.isFile }.joinToString("\n") { it.readText(Charsets.UTF_8) }
        assertFalse(diskTextAfterTwo.contains(token1))
        assertFalse(diskTextAfterTwo.contains(token2))
        assertFalse(diskTextAfterTwo.contains(passPhrase))
    }
}
