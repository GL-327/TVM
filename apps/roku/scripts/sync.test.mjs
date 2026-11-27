import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function extractFunctions(rel, names) {
  const src = read(rel);
  return names.map((name) => {
    const match = src.match(new RegExp(`^(?:function|sub) ${name}\\([^]*?^end (?:function|sub)`, 'm'));
    assert.ok(match, `${rel}: missing ${name}`);
    return match[0];
  }).join('\n');
}

function toBrsStringLiteral(text) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (cur) { parts.push(`"${cur}"`); cur = ''; }
      parts.push('Chr(34)');
    } else if (ch === '\n') {
      if (cur) { parts.push(`"${cur}"`); cur = ''; }
      parts.push('Chr(10)');
    } else if (ch === '\r') {
      if (cur) { parts.push(`"${cur}"`); cur = ''; }
      parts.push('Chr(13)');
    } else {
      cur += ch;
      if (cur.length >= 200) { parts.push(`"${cur}"`); cur = ''; }
    }
  }
  if (cur) parts.push(`"${cur}"`);
  return parts.length ? parts.join(' + ') : '""';
}

test('Roku syncCore contracts: no IndexOf, ApiTask loads syncCore, TVMScene hooks sync lifecycle', () => {
  const syncCore = read('source/syncCore.brs');
  assert.doesNotMatch(syncCore, /\bIndexOf\b/i, 'syncCore.brs must never use IndexOf');
  assert.doesNotMatch(syncCore, /\r/, 'syncCore.brs must use LF line endings');

  const apiTaskXml = read('components/ApiTask.xml');
  assert.match(apiTaskXml, /pkg:\/source\/syncCore\.brs/, 'ApiTask.xml must load syncCore.brs');

  const apiBrs = read('source/api.brs');
  assert.match(apiBrs, /"\/api\/sync\/"/, 'api.brs must route /api/sync/ to local:');

  const sceneBrs = read('components/TVMScene.brs');
  assert.match(sceneBrs, /syncPoll\.duration\s*=\s*60/);
  assert.match(sceneBrs, /syncPush\.duration\s*=\s*3/);
  assert.match(sceneBrs, /observeField\("fire",\s*"onSyncPoll"\)/);
  assert.match(sceneBrs, /observeField\("fire",\s*"onSyncPushTimer"\)/);
  assert.match(sceneBrs, /sub triggerSyncNow\(/);
  assert.match(sceneBrs, /sub scheduleSyncPush\(/);
  assert.match(sceneBrs, /sub stopSyncTimers\(/);
  assert.match(sceneBrs, /sub onSyncDone\(/);
  assert.match(sceneBrs, /sub enterHome\([^]*?triggerSyncNow\(/);
  assert.match(sceneBrs, /sub signOutAccount\([^]*?stopSyncTimers\(/);
  assert.match(sceneBrs, /statusCode\s*=\s*401/);
});

test('Roku syncCore.brs matches Core fixture hashes, schema, merge, first-sync, error handling, and account isolation in brs', { timeout: 120000 }, () => {
  const fixture = JSON.parse(read('scripts/fixtures/sync-fixture.json'));
  const parent = realpathSync(join(root, 'scripts'));
  const directory = mkdtempSync(join(parent, '.sync-test-'));

  try {
    const harness = `
' ---- Test Harness Mocks ----
function makeFakeReg() as Object
  reg = {
    data: {}
    Exists: function(k as String) as Boolean
      return m.data.DoesExist(k)
    end function
    Read: function(k as String) as String
      if m.data.DoesExist(k) then return m.data[k]
      return ""
    end function
    Write: sub(k as String, v as String)
      m.data[k] = v
    end sub
    Delete: sub(k as String)
      if m.data.DoesExist(k) then m.data.Delete(k)
    end sub
    Flush: function() as Boolean
      return true
    end function
  }
  return reg
end function

function lcReg() as Object
  if m.fakeReg = invalid then m.fakeReg = makeFakeReg()
  return m.fakeReg
end function

function lcReadRegJson(key as String, fallback as Dynamic) as Dynamic
  sec = lcReg()
  if not sec.Exists(key) then return fallback
  raw = sec.Read(key)
  if raw = invalid or raw = "" then return fallback
  parsed = ParseJson(raw)
  if parsed = invalid then return fallback
  return parsed
end function

sub lcWriteRegJson(key as String, val as Object)
  sec = lcReg()
  sec.Write(key, syncCanonicalJson(val))
  sec.Flush()
end sub

function lcReadTmpJson(name as String, maxAgeSeconds = 0 as Integer) as Dynamic
  if m.fakeTmp = invalid then m.fakeTmp = {}
  if not m.fakeTmp.DoesExist(name) then return invalid
  return m.fakeTmp[name]
end function

sub lcWriteTmpJson(name as String, obj as Object)
  if m.fakeTmp = invalid then m.fakeTmp = {}
  m.fakeTmp[name] = obj
end sub

function lcNowSeconds() as Integer
  return Int((syncNowMs() * 1.0#) / 1000.0#)
end function

function lcNowIso() as String
  return syncIsoFromMs(syncNowMs())
end function

function lcUuid() as String
  if m.fakeUuidSeq = invalid then m.fakeUuidSeq = 0
  m.fakeUuidSeq = m.fakeUuidSeq + 1
  return "00000000-0000-4000-8000-" + Right("000000000000" + StrI(m.fakeUuidSeq).Trim(), 12)
end function

function lcNewToken() as String
  return lcUuid().Replace("-", "") + lcUuid().Replace("-", "")
end function

function lcUrlEncode(text as String) as String
  out = ""
  for i = 1 to Len(text)
    ch = Mid(text, i, 1)
    if ch = " "
      out = out + "%20"
    else if ch = "&"
      out = out + "%26"
    else if ch = "="
      out = out + "%3D"
    else if ch = "+"
      out = out + "%2B"
    else
      out = out + ch
    end if
  end for
  return out
end function

function lcSha256Hex(text as String) as String
  return syncSha256Hex(text)
end function

function lcHttp(url as String, method = "GET" as String, body = "" as String, headers = {} as Object, timeoutMs = 15000 as Integer) as Object
  m.httpCalls.Push({ url: url, method: method, body: body, headers: headers })
  if m.fakeHttpQueue <> invalid and m.fakeHttpQueue.Count() > 0
    queued = m.fakeHttpQueue[0]
    nextQ = []
    for i = 1 to m.fakeHttpQueue.Count() - 1
      nextQ.Push(m.fakeHttpQueue[i])
    end for
    m.fakeHttpQueue = nextQ
    if queued <> invalid then return queued
  end if
  auth = lcAaText(headers, "Authorization", "")
  if Instr(1, url, "/v1/me/data") > 0
    if m.cloudUnauthorized = true or (m.validToken <> invalid and auth <> "Bearer " + m.validToken)
      return { ok: false, status: 401, body: "{}", json: { error: "unauthorized" }, headers: {}, etag: "", retryAfter: "" }
    end if
    if UCase(method) = "GET"
      ifMatch = lcAaText(headers, "If-Match", "")
      if ifMatch <> "" and ifMatch <> m.cloudEtag
        return { ok: false, status: 412, body: "{}", json: { error: "precondition" }, headers: {}, etag: "", retryAfter: "" }
      end if
      since = 0&
      sIdx = Instr(1, url, "since=")
      if sIdx > 0
        rest = Mid(url, sIdx + 6)
        amp = Instr(1, rest, "&")
        if amp > 0 then rest = Left(rest, amp - 1)
        since = Int(Val(rest)) * 1&
      end if
      items = []
      for each k in m.cloudRows
        row = m.cloudRows[k]
        if row.clock > since then items.Push(row.item)
      end for
      payload = { items: items, now: m.cloudClock }
      return { ok: true, status: 200, body: FormatJson(payload), json: payload, headers: { etag: m.cloudEtag }, etag: m.cloudEtag, retryAfter: "" }
    else if UCase(method) = "PUT"
      ifMatch = lcAaText(headers, "If-Match", "")
      if ifMatch <> m.cloudEtag
        return { ok: false, status: 412, body: "{}", json: { error: "precondition" }, headers: {}, etag: "", retryAfter: "" }
      end if
      parsed = ParseJson(body)
      m.putPayloads.Push(body)
      m.cloudClock = m.cloudClock + 1&
      for each it in lcAaGet(parsed, "items", [])
        id = it.kind + ":" + it.key
        if not m.cloudRows.DoesExist(id) or m.cloudRows[id].item.updatedAt < it.updatedAt
          m.cloudRows[id] = { item: it, clock: m.cloudClock }
        end if
      end for
      return { ok: true, status: 204, body: "", json: invalid, headers: {}, etag: "", retryAfter: "" }
    end if
  end if
  if Instr(1, url, "/v1/me") > 0
    if m.cloudUnauthorized = true or (m.validToken <> invalid and auth <> "Bearer " + m.validToken)
      return { ok: false, status: 401, body: "{}", json: { error: "unauthorized" }, headers: {}, etag: "", retryAfter: "" }
    end if
    acc = { id: m.cloudAccountId, email: "user@example.test", status: "active", termsVersion: "2026-09-15" }
    return { ok: true, status: 200, body: FormatJson({ account: acc }), json: { account: acc }, headers: {}, etag: "", retryAfter: "" }
  end if
  return { ok: false, status: 404, body: "{}", json: {}, headers: {}, etag: "", retryAfter: "" }
end function

sub resetHarness(accountId as String, token as String)
  m.fakeReg = makeFakeReg()
  m.fakeTmp = {}
  m.httpCalls = []
  m.putPayloads = []
  m.fakeHttpQueue = []
  m.cloudRows = {}
  m.cloudClock = 1795780800000&
  m.cloudEtag = Chr(34) + "1" + Chr(34)
  m.cloudAccountId = accountId
  m.validToken = token
  m.cloudUnauthorized = false
  m.syncTestNowMs = 1795780800000&
end sub

sub assertTrue(cond as Boolean, label as String)
  if not cond then print "FAIL: " + label
end sub

sub assertEq(actual as Dynamic, expected as Dynamic, label as String)
  if actual <> expected
    print "FAIL: " + label + " actual=" + FormatJson(actual) + " expected=" + FormatJson(expected)
  end if
end sub

sub Main()
  fixture = ParseJson(${toBrsStringLiteral(JSON.stringify(fixture))})
  assertTrue(fixture <> invalid, "fixture parsed")

  ' 1. Canonical JSON & Value Hash against ALL 8 fixture items
  resetHarness("acc_1", "tok_1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  assertEq(syncSha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 abc")
  putItems = fixture.putBody.items
  assertEq(putItems.Count(), 8, "8 fixture items")
  for i = 0 to putItems.Count() - 1
    it = putItems[i]
    id = it.kind + ":" + it.key
    expHash = fixture.expected[id].hash
    gotHash = syncValueHash(it.value)
    assertEq(gotHash, expHash, "hash " + id)
  end for

  ' 2. Pull sync-fixture.json getResponse into empty Roku store -> 0 pending PUTs
  resetHarness("acc_1", "tok_1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  m.fakeHttpQueue = [
    invalid, ' /v1/me uses dynamic handler
    { ok: true, status: 200, body: FormatJson(fixture.getResponse), json: fixture.getResponse, headers: { etag: fixture.etag }, etag: fixture.etag, retryAfter: "" }
  ]
  ctx = { method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" }
  res = syncHandleNow(ctx)
  assertEq(res.status, 200, "fixture pull status")
  assertEq(res.json.enabled, true, "fixture pull enabled")
  assertEq(res.json.pending, 0, "fixture pull 0 pending")
  assertEq(res.json.changed, true, "fixture pull changed")
  assertEq(m.putPayloads.Count(), 0, "fixture pull 0 PUTs")

  ' Verify applied stores
  profs = lcProfilesStore()
  assertEq(profs.profiles.Count(), 1, "untouched placeholder replaced by Jamie")
  assertEq(profs.profiles[0].name, "Jamie", "profile name Jamie")
  assertEq(profs.profiles[0].avatar, "space/comet", "profile avatar")
  assertEq(profs.profiles[0].maxAge, 15, "profile maxAge")
  pm = lcProgressMap("profile-1")
  assertEq(pm["tt0137523"].position, 30, "progress 30s")
  assertEq(pm["tt0137523"].duration, 8340, "progress 8340s")
  wl = lcGetWatchlist("profile-1")
  assertEq(wl.Count(), 1, "watchlist count 1")
  assertEq(wl[0].title, "Fight Club", "watchlist title Fight Club")
  prefs = lcExtrasPrefs({ profileId: "profile-1" })
  assertEq(prefs.audioLanguage, "fra", "pref audioLanguage fra")
  assertEq(prefs.extras.ratings, false, "pref extras.ratings false")
  assertEq(prefs.subtitleStyle.size, "l", "pref subtitleStyle size l")
  assertEq(prefs.subtitleLanguages.Count(), 2, "pref subtitleLanguages count 2")
  assertEq(prefs.homeSections.Count(), 2, "pref homeSections count 2")

  ' Re-running syncNow must produce 0 PUTs and changed=false
  m.httpCalls = []
  res2 = syncHandleNow(ctx)
  assertEq(res2.json.pending, 0, "second sync pending 0")
  assertEq(res2.json.changed, false, "second sync changed false")
  assertEq(m.putPayloads.Count(), 0, "second sync 0 PUTs")

  ' 3. Reject EVERY invalidCase from sync-fixture.json
  for i = 0 to fixture.invalidCases.Count() - 1
    bad = fixture.invalidCases[i]
    parsed = syncParseItem(bad, 1795780800000&)
    assertTrue(parsed = invalid, "reject invalidCase #" + StrI(i).Trim())
  end for

  ' 4. LWW, server-wins-tie, and tombstone retention / recreation
  ledger = syncEmptyLedger()
  itLocal = { kind: "preference", key: "extras.ratings", value: false, updatedAt: 20&, deleted: false }
  itAlso = { kind: "preference", key: "extras.trailers", value: false, updatedAt: 30&, deleted: false }
  localMap = {}
  localMap["preference:extras.ratings"] = { item: itLocal, hash: syncValueHash(false), changedAt: 20& }
  localMap["preference:extras.trailers"] = { item: itAlso, hash: syncValueHash(false), changedAt: 30& }
  assertTrue(syncObserveLocal(ledger, localMap, 30&), "observe local")
  remRemote = { kind: "preference", key: "extras.collections", value: false, updatedAt: 10&, deleted: false }
  remOld = { kind: "preference", key: "extras.ratings", value: true, updatedAt: 19&, deleted: false }
  remWin = { kind: "preference", key: "extras.trailers", value: true, updatedAt: 31&, deleted: false }
  changes = syncMergeRemote(ledger, [remRemote, remOld, remWin])
  assertEq(changes.Count(), 2, "merge changes count")
  assertTrue(ledger.p.DoesExist("preference:extras.ratings"), "older remote keeps local pending")
  assertTrue(not ledger.p.DoesExist("preference:extras.trailers"), "newer remote clears pending")
  ' Server-wins-tie
  lTie = syncEmptyLedger()
  tLoc = { kind: "preference", key: "autoplayNext", value: true, updatedAt: 20&, deleted: false }
  mTie = {} : mTie["preference:autoplayNext"] = { item: tLoc, hash: syncValueHash(true), changedAt: 20& }
  syncObserveLocal(lTie, mTie, 20&)
  cTie = syncMergeRemote(lTie, [{ kind: "preference", key: "autoplayNext", value: false, updatedAt: 20&, deleted: false }])
  assertEq(cTie.Count(), 1, "server wins tie")
  assertEq(lTie.p.Count(), 0, "tie clears pending")
  ' Tombstone retention & recreation
  lTomb = syncEmptyLedger()
  tItem = { kind: "preference", key: "extras.announcements", value: false, updatedAt: 10&, deleted: false }
  mTomb = {} : mTomb["preference:extras.announcements"] = { item: tItem, hash: syncValueHash(false), changedAt: 10& }
  syncObserveLocal(lTomb, mTomb, 10&)
  syncObserveLocal(lTomb, {}, 11&)
  assertEq(lTomb.p["preference:extras.announcements"].deleted, true, "tombstone created")
  assertEq(syncMergeRemote(lTomb, [tItem]).Count(), 0, "older item ignored by tombstone")
  assertEq(syncMergeRemote(lTomb, [{ kind: "preference", key: "extras.announcements", value: invalid, updatedAt: 11&, deleted: true }]).Count(), 0, "matching tombstone acked")
  assertEq(lTomb.p.Count(), 0, "tombstone pending cleared")
  assertEq(syncMergeRemote(lTomb, [{ kind: "preference", key: "extras.announcements", value: false, updatedAt: 12&, deleted: false }]).Count(), 1, "newer write recreates")

  ' 5. First-sync merge preserves pre-existing local state & keeps device-only prefs local
  resetHarness("acc_first", "tok_first_xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  m.syncTestNowMs = 1795780800000&
  lcCreateProfile({ body: { name: "Viewer" } })
  lcSaveProgress({ body: { id: "tt11111", position: 45, duration: 120 }, profileId: "" })
  lcAddWatchlist({ body: { item: { id: "tt22222", title: "Local Film", poster: "https://private.test/p.jpg?token=secret" } }, profileId: "" })
  lcSaveExtrasPrefs({ body: { audioLanguage: "spa", quality: "720", subtitleMode: "always", spotlightEvents: false }, profileId: "" })
  m.cloudRows["preference:extras.ratings"] = {
    item: { kind: "preference", key: "extras.ratings", value: false, updatedAt: 1795780700000&, deleted: false }
    clock: 1795780700000&
  }
  firstRes = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(firstRes.json.pending, 0, "first-sync pending 0")
  assertTrue(m.cloudRows.DoesExist("preference:audioLanguage"), "syncable audioLanguage uploaded")
  assertTrue(not m.cloudRows.DoesExist("preference:quality"), "device-only quality never uploaded")
  assertTrue(not m.cloudRows.DoesExist("preference:subtitleMode"), "device-only subtitleMode never uploaded")
  assertTrue(not m.cloudRows.DoesExist("preference:spotlightEvents"), "device-only spotlightEvents never uploaded")
  for each payload in m.putPayloads
    assertEq(Instr(1, payload, "private.test"), 0, "private artwork stripped")
    assertEq(Instr(1, payload, "token=secret"), 0, "token stripped")
  end for
  mergedPrefs = lcExtrasPrefs({ profileId: "" })
  assertEq(mergedPrefs.audioLanguage, "spa", "local audioLanguage kept")
  assertEq(mergedPrefs.quality, "720", "device quality kept")
  assertEq(mergedPrefs.extras.ratings, false, "cloud extras.ratings applied")

  ' 6. Error handling: 412 generation reset, 404 silent disable, 401 clears token, 409/503/429 backoff + Retry-After
  ' 412 generation reset
  m.cloudRows = {}
  m.cloudEtag = Chr(34) + "2" + Chr(34)
  m.cloudClock = 1795780900000&
  m.syncTestNowMs = 1795780900000&
  lcSaveProgress({ body: { id: "tt11111", position: 60, duration: 120 }, profileId: "" })
  res412 = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(res412.json.pending, 0, "412 drops stale queue")
  assertEq(m.cloudRows.Count(), 0, "412 does not re-create erased cloud")
  assertEq(lcProgressMap(lcActiveProfileId({ profileId: "" }))["tt11111"].position, 60, "412 keeps local view")

  ' 503 + 429 Retry-After backoff
  m.syncTestNowMs = 1795781000000&
  m.fakeHttpQueue = [
    { ok: false, status: 503, body: "{}", json: {}, headers: {}, etag: "", retryAfter: "" }
  ]
  res503 = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(res503.json.error, "Account data could not sync.", "503 error message")
  callsBeforeSkip = m.httpCalls.Count()
  m.syncTestNowMs = 1795781004999&
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(m.httpCalls.Count(), callsBeforeSkip, "backoff skips before 5s")
  m.syncTestNowMs = 1795781005000&
  m.fakeHttpQueue = [
    { ok: false, status: 429, body: "{}", json: {}, headers: { "retry-after": "30" }, etag: "", retryAfter: "30" }
  ]
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  callsBeforeRetryAfter = m.httpCalls.Count()
  m.syncTestNowMs = 1795781034999&
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(m.httpCalls.Count(), callsBeforeRetryAfter, "Retry-After 30s respected")
  m.syncTestNowMs = 1795781035000&
  m.fakeHttpQueue = [
    { ok: false, status: 409, body: "{}", json: {}, headers: {}, etag: "", retryAfter: "" }
  ]
  res409 = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(res409.json.error, "Synced data is full.", "409 error message")

  ' 404 silent disable
  resetHarness("acc_404", "tok_404_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  m.fakeHttpQueue = [
    invalid,
    { ok: false, status: 404, body: "{}", json: {}, headers: {}, etag: "", retryAfter: "" }
  ]
  res404 = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(res404.json.enabled, false, "404 disables sync")
  assertEq(res404.json.error, invalid, "404 silent error null")
  calls404 = m.httpCalls.Count()
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(m.httpCalls.Count(), calls404, "404 stops background requests")

  ' 401 clears token & stops sync
  resetHarness("acc_401", "tok_401_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  lcReg().Write("accountToken", m.validToken)
  m.cloudUnauthorized = true
  res401 = syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertEq(res401.status, 401, "401 status returned")
  assertEq(res401.json.enabled, false, "401 disables")
  assertEq(lcReg().Exists("accountToken"), false, "401 deletes accountToken")

  ' 7. Sign-out & account switching isolation
  resetHarness("acc_user_a", "tok_a_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  lcAddWatchlist({ body: { item: { id: "tt99999", title: "User A Film" } }, profileId: "" })
  lcSaveExtrasPrefs({ body: { audioLanguage: "jpn", quality: "1080" }, profileId: "" })
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertTrue(m.cloudRows.DoesExist("watchlist:main/tt99999"), "User A synced watchlist")
  ' Sign out clears ledger & synced stores while keeping device quality
  syncClearOnSignOut()
  assertEq(lcReg().Exists("syncLedger"), false, "signout deletes syncLedger")
  assertEq(lcReg().Exists("syncPrefs"), false, "signout deletes syncPrefs")
  assertEq(lcGetWatchlist("main").Count(), 0, "signout clears watchlist")
  assertEq(lcExtrasPrefs({ profileId: "" }).quality, "1080", "signout keeps device quality")
  assertEq(lcExtrasPrefs({ profileId: "" }).audioLanguage, "original", "signout clears synced audioLanguage")

  ' Sign into User B directly (even without signout) never merges User A data
  m.cloudAccountId = "acc_user_b"
  m.validToken = "tok_b_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  m.cloudRows = {}
  m.putPayloads = []
  lcAddWatchlist({ body: { item: { id: "tt88888", title: "Stale Leftover" } }, profileId: "" })
  syncHandleNow({ method: "POST", path: "/api/sync/now", query: {}, body: {}, accountToken: m.validToken, profileId: "" })
  assertTrue(not m.cloudRows.DoesExist("watchlist:main/tt88888"), "User B must NOT inherit previous account data")
  assertEq(lcGetWatchlist("main").Count(), 0, "User B starts clean")

  print "SYNC_RUNTIME_OK"
end sub
`;

    const source = [
      extractFunctions('source/localCore.brs', [
        'lcAaGet', 'lcAaText', 'lcAaInt', 'lcAaBool',
        'lcCreateProfile', 'lcRemoveProfile',
        'lcGetWatchlist', 'lcAddWatchlist', 'lcRemoveWatchlist',
        'lcProgressMap', 'lcSaveProgress', 'lcFinishedMap',
        'lcActiveProfileId', 'lcGetProfiles',
      ]),
      extractFunctions('source/contentCore.brs', [
        'lcIncludes', 'lcProfilesStore', 'lcPublicProfiles',
        'lcFindProfile', 'lcPinValid', 'lcPinError', 'lcSetProfileFields',
      ]),
      extractFunctions('source/accountsCore.brs', ['lcAccountsHttp']),
      extractFunctions('source/extrasCore.brs', ['lcExtraDefaults', 'lcExtrasPrefs', 'lcSaveExtrasPrefs']),
      read('source/syncCore.brs'),
      harness,
    ].join('\n');

    writeFileSync(join(directory, 'main.brs'), source, 'utf8');
    const command = 'npx --yes brs@0.45.0 main.brs';
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: directory })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', 'main.brs'], { encoding: 'utf8', timeout: 110000, cwd: directory });

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /FAIL:/, result.stdout + result.stderr);
    assert.match(result.stdout, /SYNC_RUNTIME_OK/, result.stdout + result.stderr);
  } finally {
    assert.ok(realpathSync(directory).startsWith(parent + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
