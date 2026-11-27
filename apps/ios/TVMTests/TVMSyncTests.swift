import XCTest
@testable import TVM

final class TVMSyncTests: XCTestCase {
    private var testFolders: [URL] = []

    override func tearDown() {
        for folder in testFolders {
            try? FileManager.default.removeItem(at: folder)
        }
        testFolders.removeAll()
        super.tearDown()
    }

    private func makeTempDir(_ prefix: String = "tvm-sync-test") -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        testFolders.append(dir)
        return dir
    }

    private func loadFixture() throws -> [String: Any] {
        let url = try XCTUnwrap(
            Bundle(for: TVMSyncTests.self).url(forResource: "sync-fixture", withExtension: "json", subdirectory: "SyncFixtures")
        )
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: - Canonical JSON, Fixture Hashes & Schema

    func testCanonicalJsonHandlesCFBooleanAndNumbersAndForwardSlash() throws {
        let raw = Data(#"{"flag":true,"off":false,"num":30.0,"zero":-0.0,"url":"https://a/b"}"#.utf8)
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: raw) as? [String: Any])
        let canonical = TVMSyncCanonical.json(obj)
        XCTAssertEqual(canonical, #"{"flag":true,"num":30,"off":false,"url":"https://a/b","zero":0}"#)
        XCTAssertEqual(TVMSyncSchema.strictBool(obj["flag"]), true)
        XCTAssertNil(TVMSyncSchema.strictNumber(obj["flag"]))
        XCTAssertEqual(TVMSyncSchema.strictNumber(obj["num"]), 30)
        XCTAssertNil(TVMSyncSchema.strictBool(obj["num"]))
    }

    func testFixtureCanonicalHashesMatchCoreAndSchemaRejectsInvalidCases() throws {
        let fixture = try loadFixture()
        let nowMs = try XCTUnwrap(TVMSyncSchema.strictSafeInt(fixture["now"]))
        let expected = try XCTUnwrap(fixture["expected"] as? [String: [String: Any]])
        let putBody = try XCTUnwrap(fixture["putBody"] as? [String: Any])
        let putItems = try XCTUnwrap(putBody["items"] as? [[String: Any]])
        XCTAssertEqual(putItems.count, expected.count)

        for raw in putItems {
            let item = try XCTUnwrap(TVMSyncSchema.parseSyncItem(raw, nowMs: nowMs))
            let row = try XCTUnwrap(expected[item.itemId])
            XCTAssertEqual(TVMSyncCanonical.valueHash(item.value), row["hash"] as? String, item.itemId)
            XCTAssertEqual(item.updatedAt, TVMSyncSchema.strictSafeInt(row["updatedAt"]))
            XCTAssertLessThanOrEqual(TVMSyncSchema.syncValueBytes(item.value), TVMSyncSchema.maxValueBytes)
        }

        let getResponse = try XCTUnwrap(fixture["getResponse"] as? [String: Any])
        let getItems = try XCTUnwrap(getResponse["items"] as? [[String: Any]])
        for raw in getItems {
            let item = try XCTUnwrap(TVMSyncSchema.parseSyncItem(raw, nowMs: nowMs))
            let row = try XCTUnwrap(expected[item.itemId])
            XCTAssertEqual(TVMSyncCanonical.valueHash(item.value), row["hash"] as? String, item.itemId)
        }

        let invalidCases = try XCTUnwrap(fixture["invalidCases"] as? [[String: Any]])
        XCTAssertEqual(invalidCases.count, 7)
        for bad in invalidCases {
            XCTAssertNil(TVMSyncSchema.parseSyncItem(bad, nowMs: nowMs), "Expected rejection for \(bad["kind"] ?? ""):\(bad["key"] ?? "")")
        }
    }

    func testPullsFixtureFromTransportAndPreservesExactSnapshotHashes() async throws {
        let fixture = try loadFixture()
        let nowMs = try XCTUnwrap(TVMSyncSchema.strictSafeInt(fixture["now"]))
        let expected = try XCTUnwrap(fixture["expected"] as? [String: [String: Any]])
        let etag = try XCTUnwrap(fixture["etag"] as? String)
        let getBody = try JSONSerialization.data(withJSONObject: try XCTUnwrap(fixture["getResponse"]))

        let root = makeTempDir("tvm-sync-fixture-pull")
        let syncDir = root.appendingPathComponent("sync-account", isDirectory: true)
        let store = TVMStore(root: root)
        store.setActiveDirectory(syncDir)
        TVMSyncStores.initializeStores(directory: syncDir, store: store, legacy: nil)

        let transport = MockSyncTransport()
        transport.enqueueGet(SyncHTTPReply(status: 200, body: getBody, etag: etag, retryAfter: nil))

        let engine = TVMSyncEngine(
            directory: syncDir,
            store: store,
            origin: "https://accounts.example.test",
            transport: transport,
            reloadProfiles: {},
            sessionRejected: { _ in },
            nowMs: { nowMs }
        )
        defer { engine.close() }

        let session = String(repeating: "s", count: 12) + "001"
        engine.attach(session)
        let status = await engine.syncNow()
        XCTAssertTrue(status.enabled)
        XCTAssertEqual(status.pending, 0)
        XCTAssertNil(status.error)
        XCTAssertEqual(transport.putCalls.count, 0)

        let prog = store.progress(for: "profile-1")["tt0137523"]
        XCTAssertEqual(prog?.position, 30)
        XCTAssertEqual(prog?.duration, 8340)
        XCTAssertEqual(prog?.hiddenFromContinueWatching, false)
        XCTAssertEqual(prog?.completions, 0)

        let watchlist = store.watchlist(for: "profile-1")
        XCTAssertEqual(watchlist.map(\.id), ["tt0137523"])
        XCTAssertEqual(watchlist.first?.title, "Fight Club")

        let profiles = store.profiles()
        XCTAssertEqual(profiles.profiles.first?.name, "Jamie")
        XCTAssertEqual(profiles.profiles.first?.maxAge, 15)
        XCTAssertEqual(profiles.profiles.first?.avatar, "space/comet")

        let prefs = TVMPrefs.load(store)
        XCTAssertEqual(prefs.subtitleLanguages, ["eng", "fra"])
        XCTAssertEqual(prefs.subtitleStyle, SubtitleStylePref(size: "l", color: "yellow", background: "box"))
        XCTAssertEqual(prefs.audioLanguage, "fra")
        XCTAssertEqual(prefs.extras["ratings"], false)
        XCTAssertEqual(prefs.homeSections.count, 2)

        let snap = TVMSyncStores.snapshot(directory: syncDir, store: store, nowMs: nowMs)
        for (id, row) in expected {
            XCTAssertEqual(snap[id]?.hash, row["hash"] as? String, "Snapshot hash mismatch for \(id)")
        }
    }

    // MARK: - Merge & Tombstones

    private func prefItem(_ key: String, _ value: Any?, _ updatedAt: Int64, deleted: Bool = false) -> TVMSyncItem {
        TVMSyncItem(kind: "preference", key: key, value: value, updatedAt: updatedAt, deleted: deleted)
    }

    private func projected(_ items: TVMSyncItem...) -> [String: TVMSnapshotItem] {
        var out: [String: TVMSnapshotItem] = [:]
        for item in items {
            out[item.itemId] = TVMSnapshotItem(
                item: item,
                hash: TVMSyncCanonical.valueHash(item.value),
                changedAt: item.updatedAt
            )
        }
        return out
    }

    func testMergeDisjointItemsAndUsesNewestStamp() {
        var ledger = TVMSyncLedger()
        let local = prefItem("extras.ratings", false, 20)
        let alsoLocal = prefItem("extras.trailers", false, 30)
        let remote = prefItem("extras.collections", false, 10)
        let remoteWins = prefItem(alsoLocal.key, true, 31)

        TVMSyncMerge.observeLocal(&ledger, local: projected(local, alsoLocal), nowMs: 30)
        let changes = TVMSyncMerge.mergeRemote(&ledger, incoming: [remote, prefItem(local.key, true, 19), remoteWins])
        XCTAssertEqual(changes.map(\.itemId), [remote.itemId, remoteWins.itemId])
        XCTAssertEqual(Array(ledger.pending.values).map(\.itemId), [local.itemId])
        XCTAssertEqual(ledger.versions[alsoLocal.itemId]?.updatedAt, 31)
    }

    func testMergeServerWinsOnTieAndKeepsTombstones() {
        var ledger = TVMSyncLedger()
        let local = prefItem("autoplayNext", true, 20)
        TVMSyncMerge.observeLocal(&ledger, local: projected(local), nowMs: 20)
        let tieChanges = TVMSyncMerge.mergeRemote(&ledger, incoming: [prefItem(local.key, false, 20)])
        XCTAssertEqual(tieChanges.count, 1)
        XCTAssertEqual(TVMSyncSchema.strictBool(tieChanges.first?.value), false)
        XCTAssertTrue(ledger.pending.isEmpty)

        TVMSyncMerge.observeLocal(&ledger, local: projected(local), nowMs: 20)
        XCTAssertEqual(ledger.pending[local.itemId]?.updatedAt, 21)
        XCTAssertTrue(TVMSyncMerge.mergeRemote(&ledger, incoming: [prefItem(local.key, false, 20)]).isEmpty)

        // Tombstones
        var tombLedger = TVMSyncLedger()
        let item = prefItem("extras.announcements", false, 10)
        TVMSyncMerge.observeLocal(&tombLedger, local: projected(item), nowMs: 10)
        TVMSyncMerge.observeLocal(&tombLedger, local: [:], nowMs: 11)
        XCTAssertEqual(tombLedger.pending[item.itemId]?.deleted, true)
        XCTAssertTrue(TVMSyncMerge.mergeRemote(&tombLedger, incoming: [item]).isEmpty)
        XCTAssertTrue(TVMSyncMerge.mergeRemote(&tombLedger, incoming: [prefItem(item.key, nil, 11, deleted: true)]).isEmpty)
        XCTAssertTrue(tombLedger.pending.isEmpty)
        let recreated = TVMSyncMerge.mergeRemote(&tombLedger, incoming: [prefItem(item.key, false, 12)])
        XCTAssertEqual(recreated.count, 1)
        XCTAssertEqual(recreated.first?.updatedAt, 12)
    }

    // MARK: - HTTP Core Integration & Account Isolation

    private func send(
        _ core: TVMLocalCore,
        _ method: String,
        _ path: String,
        body: [String: Any]? = nil,
        token: String? = nil
    ) async throws -> (status: Int, json: [String: Any]) {
        var headers: [String: String] = [:]
        if let token { headers["authorization"] = "Bearer \(token)" }
        let reply = await core.handle(method: method, path: path, query: [:], headers: headers, body: body.map { JSONValue.data($0) })
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: reply.body) as? [String: Any])
        return (reply.status, obj)
    }

    func testFirstSyncMergesOverHttpKeepsDevicePrefsLocalAndSignOutClearsLedger() async throws {
        let root = makeTempDir("tvm-sync-http")
        let store = TVMStore(root: root)
        let clock = LockedClock(max(Int64(Date().timeIntervalSince1970 * 1000.0) + 1_000, 1_700_000_000_000))
        let service = FakeAccountsAndSyncService(nowMs: { clock.now() })
        service.join(email: "sync@example.test", status: "active")

        // Seed pre-sign-in local data in root.
        let registry = store.profiles()
        var firstProfile = registry.profiles[0]
        firstProfile.name = "Local Viewer"
        store.saveProfiles(activeId: firstProfile.id, profiles: [firstProfile])
        store.writeProgress(profileId: "profile-1", id: "tt00001", position: 30, duration: 120)
        var initialPrefs = TVMPrefs.load(store)
        initialPrefs.merge([
            "quality": "1080",
            "language": "fr",
            "audioLanguage": "spa",
            "webhookUrl": "https://private.test/hook",
        ])
        initialPrefs.save(store)

        // Seed cloud data.
        service.seedSyncItem(TVMSyncItem(kind: "preference", key: "extras.ratings", value: false, updatedAt: 50, deleted: false), clock: 50)
        service.seedSyncItem(TVMSyncItem(
            kind: "progress",
            key: "profile-1/tt00002",
            value: ["position": 60, "duration": 120, "updated": "2026-11-27T12:00:00.000Z"],
            updatedAt: 50,
            deleted: false
        ), clock: 50)

        let core = TVMLocalCore(
            store: store,
            accountsTransport: service,
            sessionVault: TVMMemorySessionVault(),
            syncTransport: service,
            nowMs: { clock.now() }
        )

        let beforeStatus = try await send(core, "GET", "/api/sync/status")
        XCTAssertEqual(beforeStatus.json["enabled"] as? Bool, false)
        let beforeNow = try await send(core, "POST", "/api/sync/now", body: [:])
        XCTAssertEqual(beforeNow.json["enabled"] as? Bool, false)

        clock.advance()
        let signed = try await send(core, "POST", "/api/account/signin", body: [
            "email": "sync@example.test",
            "password": FakeAccountsAndSyncService.password,
        ])
        XCTAssertEqual(signed.status, 200)
        let session = try XCTUnwrap(signed.json["token"] as? String)

        clock.advance()
        let firstSync = try await send(core, "POST", "/api/sync/now", body: [:], token: session)
        XCTAssertEqual(firstSync.json["enabled"] as? Bool, true)
        XCTAssertEqual(firstSync.json["pending"] as? Int, 0)
        XCTAssertTrue(firstSync.json["error"] is NSNull)
        XCTAssertNotNil(TVMSyncSchema.strictSafeInt(firstSync.json["lastSyncAt"]))

        let prefsAfter = try await send(core, "GET", "/api/prefs", token: session)
        XCTAssertEqual(prefsAfter.json["quality"] as? String, "1080")
        XCTAssertEqual(prefsAfter.json["language"] as? String, "fr")
        XCTAssertEqual(prefsAfter.json["audioLanguage"] as? String, "spa")
        XCTAssertEqual((prefsAfter.json["extras"] as? [String: Any])?["ratings"] as? Bool, false)

        XCTAssertNotNil(service.cloud["progress:profile-1/tt00001"])
        XCTAssertNotNil(service.cloud["progress:profile-1/tt00002"])
        XCTAssertNotNil(service.cloud["preference:audioLanguage"])

        clock.advance()
        _ = try await send(core, "PUT", "/api/prefs", body: ["audioLanguage": "jpn", "quality": "720"], token: session)
        _ = try await send(core, "PUT", "/api/watchlist", body: ["item": ["id": "tt55555", "title": "Watchlisted"]], token: session)
        _ = try await send(core, "POST", "/api/progress/watched", body: ["id": "tt00001", "watched": true], token: session)
        _ = try await send(core, "POST", "/api/progress/remove", body: ["id": "tt00002"], token: session)

        // Offline outage (503) keeps local edits queued until recovery.
        service.down = true
        clock.advance()
        let offlineSync = try await send(core, "POST", "/api/sync/now", body: [:], token: session)
        XCTAssertEqual(offlineSync.json["error"] as? String, "Account data could not sync.")
        XCTAssertGreaterThan(offlineSync.json["pending"] as? Int ?? 0, 0)

        service.down = false
        clock.advance()
        let recovered = try await send(core, "POST", "/api/sync/now", body: [:], token: session)
        XCTAssertEqual(recovered.json["pending"] as? Int, 0)
        XCTAssertTrue(recovered.json["error"] is NSNull)
        XCTAssertEqual(service.cloud["preference:audioLanguage"]?.item.value as? String, "jpn")
        XCTAssertEqual(service.cloud["watchlist:profile-1/tt55555"]?.item.deleted, false)
        XCTAssertEqual((service.cloud["progress:profile-1/tt00002"]?.item.value as? [String: Any])?["hiddenFromContinueWatching"] as? Bool, true)

        for payload in service.sentPutPayloads {
            XCTAssertFalse(payload.contains("\"quality\""))
            XCTAssertFalse(payload.contains("webhookUrl"))
            XCTAssertFalse(payload.contains("private.test"))
        }

        // Verify no raw token or password was ever persisted on disk.
        let allFiles = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.allObjects as? [URL] ?? []
        for file in allFiles {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            XCTAssertFalse(text.contains(session))
            XCTAssertFalse(text.contains(FakeAccountsAndSyncService.password))
        }

        let accountDir = try XCTUnwrap(store.activeSyncDir())
        XCTAssertTrue(FileManager.default.fileExists(atPath: accountDir.appendingPathComponent("ledger.json").path))

        // Sign out clears ledger and restores device-only prefs without leaking account audioLanguage.
        _ = try await send(core, "POST", "/api/account/signout", body: [:], token: session)
        XCTAssertNil(store.activeSyncDir())
        XCTAssertFalse(FileManager.default.fileExists(atPath: accountDir.appendingPathComponent("ledger.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("sync/session-owner.json").path))

        let devicePrefs = TVMPrefs.load(store)
        XCTAssertEqual(devicePrefs.quality, "720")
        XCTAssertEqual(devicePrefs.language, "fr")
        XCTAssertEqual(devicePrefs.audioLanguage, "spa")

        let afterSignoutStatus = try await send(core, "GET", "/api/sync/status", token: session)
        XCTAssertEqual(afterSignoutStatus.json["enabled"] as? Bool, false)
    }

    func testDifferentAccountNeverMergesPreviousUsersDataAndOfflineRestoreWorks() async throws {
        let root = makeTempDir("tvm-sync-isolation")
        let store = TVMStore(root: root)
        let service = FakeAccountsAndSyncService()
        service.join(email: "one@example.test", status: "active")
        service.join(email: "two@example.test", status: "active")

        store.writeProgress(profileId: "profile-1", id: "tt11111", position: 45, duration: 120)
        var initialPrefs = TVMPrefs.load(store)
        initialPrefs.audioLanguage = "fra"
        initialPrefs.save(store)

        let vault = TVMMemorySessionVault()
        let core1 = TVMLocalCore(store: store, accountsTransport: service, sessionVault: vault, syncTransport: service)
        let s1 = try await send(core1, "POST", "/api/account/signin", body: [
            "email": "one@example.test",
            "password": FakeAccountsAndSyncService.password,
        ])
        let token1 = try XCTUnwrap(s1.json["token"] as? String)
        _ = try await send(core1, "POST", "/api/sync/now", body: [:], token: token1)
        XCTAssertNotNil(store.progress(for: "profile-1")["tt11111"])

        // Offline restart with core1's token still in vault restores account 1's directory.
        let storeRestart = TVMStore(root: root)
        let coreRestart = TVMLocalCore(store: storeRestart, accountsTransport: service, sessionVault: vault, syncTransport: service)
        coreRestart.restoreSyncFromVault()
        XCTAssertNotNil(storeRestart.activeSyncDir())
        XCTAssertNotNil(storeRestart.progress(for: "profile-1")["tt11111"])
        coreRestart.accountSync.clearAll()

        // Sign out account 1, then sign in account 2: account 2 must not claim legacy data or account 1's progress.
        _ = try await send(core1, "POST", "/api/account/signout", body: [:], token: token1)
        let s2 = try await send(core1, "POST", "/api/account/signin", body: [
            "email": "two@example.test",
            "password": FakeAccountsAndSyncService.password,
        ])
        let token2 = try XCTUnwrap(s2.json["token"] as? String)
        _ = try await send(core1, "POST", "/api/sync/now", body: [:], token: token2)
        XCTAssertNil(store.progress(for: "profile-1")["tt11111"])
    }

    // MARK: - Error Handling: Backoff, 409, 412, 404, 401

    func testBackoff409Reset412Silent404AndUnauthorized401() async throws {
        var nowMs: Int64 = 1_000_000
        let root = makeTempDir("tvm-sync-errors")
        let syncDir = root.appendingPathComponent("sync-errors", isDirectory: true)
        let store = TVMStore(root: root)
        store.setActiveDirectory(syncDir)
        TVMSyncStores.initializeStores(directory: syncDir, store: store, legacy: nil)

        let transport = MockSyncTransport()
        var rejectedTokens: [String] = []
        let engine = TVMSyncEngine(
            directory: syncDir,
            store: store,
            origin: "https://accounts.example.test",
            transport: transport,
            reloadProfiles: {},
            sessionRejected: { rejectedTokens.append($0) },
            nowMs: { nowMs }
        )
        defer { engine.close() }

        let session = String(repeating: "s", count: 12) + "002"
        transport.enqueueGet(SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":1000000}"#.utf8), etag: "\"0\"", retryAfter: nil))
        engine.attach(session)
        let initial = await engine.syncNow()
        XCTAssertTrue(initial.enabled)

        // 1) 429 with Retry-After
        transport.enqueueGet(SyncHTTPReply(status: 429, body: Data("{}".utf8), etag: nil, retryAfter: "30"))
        let s429 = await engine.syncNow()
        XCTAssertEqual(s429.error, "Account data could not sync.")

        // 2) 409 quota full
        transport.enqueueGet(SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":1000000}"#.utf8), etag: "\"0\"", retryAfter: nil))
        store.writeProgress(profileId: "profile-1", id: "tt0137523", position: 40, duration: 120)
        engine.notifyLocalChange()
        transport.enqueuePut(SyncHTTPReply(status: 409, body: Data("{}".utf8), etag: nil, retryAfter: nil))
        let s409 = await engine.syncNow()
        XCTAssertEqual(s409.error, "Synced data is full.")

        // 3) 412 generation reset preserves local edits, clears old generation queue, then syncs new edit
        transport.enqueueGet(SyncHTTPReply(status: 412, body: Data("{}".utf8), etag: nil, retryAfter: nil))
        transport.enqueueGet(SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":1000010}"#.utf8), etag: "\"1\"", retryAfter: nil))
        let s412 = await engine.syncNow()
        XCTAssertEqual(s412.pending, 0)
        XCTAssertNil(s412.error)
        XCTAssertEqual(store.progress(for: "profile-1")["tt0137523"]?.position, 40)

        store.writeProgress(profileId: "profile-1", id: "tt0137523", position: 60, duration: 120)
        engine.notifyLocalChange()
        transport.enqueueGet(SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":1000020}"#.utf8), etag: "\"1\"", retryAfter: nil))
        transport.enqueuePut(SyncHTTPReply(status: 204, body: Data(), etag: nil, retryAfter: nil))
        transport.enqueueGet(SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":1000021}"#.utf8), etag: "\"1\"", retryAfter: nil))
        let afterReset = await engine.syncNow()
        XCTAssertEqual(afterReset.pending, 0)
        XCTAssertEqual(transport.putCalls.count, 2)

        // 4) 404 silently disables sync
        transport.enqueueGet(SyncHTTPReply(status: 404, body: Data("{}".utf8), etag: nil, retryAfter: nil))
        let s404 = await engine.syncNow()
        XCTAssertEqual(s404, .disabled)

        // 5) Fresh sign-in re-enables, and 401 calls sessionRejected
        let session2 = String(repeating: "s", count: 12) + "003"
        transport.enqueueGet(SyncHTTPReply(status: 401, body: Data("{}".utf8), etag: nil, retryAfter: nil))
        engine.attach(session2, signingIn: true)
        _ = await engine.syncNow()
        XCTAssertEqual(rejectedTokens, [session2])
    }
}

// MARK: - Test Doubles

private final class LockedClock {
    private let lock = NSLock()
    private var value: Int64

    init(_ initial: Int64) {
        self.value = initial
    }

    func now() -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func advance(_ delta: Int64 = 1) {
        lock.lock()
        value += delta
        lock.unlock()
    }
}

private final class MockSyncTransport: TVMSyncTransport {
    private let lock = NSLock()
    var nextGetReplies: [SyncHTTPReply] = []
    var nextPutReplies: [SyncHTTPReply] = []
    var getCalls: [URL] = []
    private var _putCalls: [Data] = []
    var putCalls: [Data] {
        lock.lock()
        defer { lock.unlock() }
        return _putCalls
    }

    func enqueueGet(_ reply: SyncHTTPReply) {
        lock.lock()
        nextGetReplies.append(reply)
        lock.unlock()
    }

    func enqueuePut(_ reply: SyncHTTPReply) {
        lock.lock()
        nextPutReplies.append(reply)
        lock.unlock()
    }

    func send(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) async throws -> SyncHTTPReply {
        lock.lock()
        defer { lock.unlock() }
        if method == "GET" {
            getCalls.append(url)
            if !nextGetReplies.isEmpty { return nextGetReplies.removeFirst() }
            return SyncHTTPReply(status: 200, body: Data(#"{"items":[],"now":0}"#.utf8), etag: "\"0\"", retryAfter: nil)
        }
        if method == "PUT" {
            if let body { _putCalls.append(body) }
            if !nextPutReplies.isEmpty { return nextPutReplies.removeFirst() }
            return SyncHTTPReply(status: 204, body: Data(), etag: nil, retryAfter: nil)
        }
        return SyncHTTPReply(status: 404, body: Data(), etag: nil, retryAfter: nil)
    }
}

private final class FakeAccountsAndSyncService: TVMAccountsTransport, TVMSyncTransport {
    struct Member {
        let id: String
        let email: String
        let password: String
        var status: String
    }

    static let password = "a good long password"

    private let lock = NSLock()
    private let nowMs: () -> Int64
    var members: [Member] = []
    var sessions: [String: Member] = [:]
    /// Synced items per account id, like the real service (one account never sees another's data).
    var clouds: [String: [String: (item: TVMSyncItem, clock: Int64)]] = [:]
    /// The first account's items; most tests use one account.
    var cloud: [String: (item: TVMSyncItem, clock: Int64)] {
        get { clouds["acc_1"] ?? [:] }
        set { clouds["acc_1"] = newValue }
    }
    var sentPutPayloads: [String] = []
    var down = false
    private var counter = 0
    private var clock: Int64 = 100
    private let generation = "\"0\""

    init(nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000.0) }) {
        self.nowMs = nowMs
    }

    func join(email: String, status: String) {
        lock.lock()
        members.append(Member(id: "acc_\(members.count + 1)", email: email, password: Self.password, status: status))
        lock.unlock()
    }

    func seedSyncItem(_ item: TVMSyncItem, clock: Int64) {
        lock.lock()
        self.clock = max(self.clock, clock)
        cloud[item.itemId] = (item, clock)
        lock.unlock()
    }

    func send(method: String, url: URL, bearer: String?, body: Data?) async throws -> (status: Int, body: Data) {
        let reply = try await send(method: method, url: url, bearer: bearer, headers: [:], body: body)
        return (reply.status, reply.body)
    }

    func send(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) async throws -> SyncHTTPReply {
        try handleLocked(method: method, url: url, bearer: bearer, headers: headers, body: body)
    }

    private func handleLocked(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) throws -> SyncHTTPReply {
        lock.lock()
        defer { lock.unlock() }
        if down { throw URLError(.notConnectedToInternet) }
        let json = JSONValue.object(body)

        func reply(_ status: Int, _ obj: [String: Any] = [:], etag: String? = nil) -> SyncHTTPReply {
            SyncHTTPReply(status: status, body: status == 204 ? Data() : JSONValue.data(obj), etag: etag, retryAfter: nil)
        }

        if method == "POST" && url.path == "/v1/signin" {
            guard let member = members.first(where: { $0.email == (json["email"] as? String ?? "") }),
                  member.password == (json["password"] as? String ?? "") else {
                return reply(401, ["error": "invalid"])
            }
            counter += 1
            let token = String(repeating: "s", count: 10) + String(format: "%040d", counter)
            sessions[token] = member
            return reply(200, [
                "session": token,
                "account": [
                    "id": member.id, "email": member.email, "displayName": member.email,
                    "role": "member", "status": member.status, "tier": "stream",
                    "liveTv": false, "emailVerified": true, "termsVersion": TVMAccounts.termsVersion(),
                    "hasRdToken": false, "createdAt": "2026-11-01T00:00:00.000Z",
                ],
            ])
        }

        guard let bearer, let member = sessions[bearer] else {
            return reply(401, ["error": "unauthorized"])
        }

        if method == "POST" && url.path == "/v1/signout" {
            sessions.removeValue(forKey: bearer)
            return reply(204)
        }
        if method == "GET" && url.path == "/v1/me" {
            return reply(200, [
                "account": [
                    "id": member.id, "email": member.email, "displayName": member.email,
                    "role": "member", "status": member.status, "tier": "stream",
                    "liveTv": false, "emailVerified": true, "termsVersion": TVMAccounts.termsVersion(),
                    "hasRdToken": false, "createdAt": "2026-11-01T00:00:00.000Z",
                ],
            ])
        }
        if method == "GET" && url.path == "/v1/me/data" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let sinceStr = components?.queryItems?.first(where: { $0.name == "since" })?.value ?? "0"
            let since = Int64(sinceStr) ?? 0
            let items = (clouds[member.id] ?? [:]).values.filter { $0.clock > since }.map { $0.item.json() }
            return reply(200, ["items": items, "now": clock], etag: generation)
        }
        if method == "PUT" && url.path == "/v1/me/data" {
            if let body, let text = String(data: body, encoding: .utf8) {
                sentPutPayloads.append(text)
            }
            clock = max(clock + 1, nowMs())
            if let rawItems = json["items"] as? [[String: Any]] {
                for raw in rawItems {
                    guard let item = TVMSyncSchema.parseSyncItem(raw, nowMs: clock) else { continue }
                    let prev = clouds[member.id]?[item.itemId]?.item
                    if prev == nil || prev!.updatedAt < item.updatedAt {
                        clouds[member.id, default: [:]][item.itemId] = (item, clock)
                    }
                }
            }
            return reply(204)
        }
        return reply(404, ["error": "not_found"])
    }
}
