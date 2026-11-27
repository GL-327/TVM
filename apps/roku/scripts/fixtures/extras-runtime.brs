' All assertions use production functions; only hardware and HTTP are stubbed.
sub Main()
  m.registry = {} : m.cache = {} : m.calls = []
  m.rows = [{ tmdb: { value: "1396" } }]
  m.data = { intro: [{ start_ms: 228665, end_ms: 246498 }], recap: [{ start_ms: 0, end_ms: 25000 }], credits: [{ start_ms: 3432884, end_ms: invalid }] }
  query = { id: "tt0903747:1:1" }
  segments = lcExtrasSegments(query)
  check(segments.intro.start = 228.665, "milliseconds to seconds")
  check(segments.recap["end"] = 25, "recap end")
  check(segments.credits["end"] = invalid, "open-ended credits")
  check(segments.source = "theintrodb", "primary provider")
  check(Instr(1, m.lastQuery, "P4983") > 0, "series TMDB property")
  count = m.calls.Count()
  cached = lcExtrasSegments(query)
  check(m.calls.Count() = count, "cache avoids network")
  m.cache = {} : m.rows = [] : m.data = invalid
  empty = lcExtrasSegments({ id: "tt1234567" })
  check(empty.source = invalid and empty.intro = invalid, "offline segments hidden")
  m.cache = {} : m.rows = []
  m.data = { results: [{ skipType: "op", interval: { startTime: 57.397, endTime: 145.737 } }, { skipType: "ed", interval: { startTime: 1300, endTime: 1400 } }] }
  anime = lcExtrasSegments({ id: "tt0213338:1:1", anime: "1", title: "Cowboy Bebop" })
  check(anime.source = "aniskip" and anime.intro["end"] = 145.737, "anime fallback")
  check(lcExtrasImdb("tt0903747:1:2") = "tt0903747", "episode IMDb id")
  check(lcExtrasImdb("tt123" + Chr(34)) = "", "SPARQL input validation")
  check(lcExtrasSubtitleUrl("https://subs5.strem.io/en/download/file/1"), "subtitle host")
  check(not lcExtrasSubtitleUrl("https://subs5.strem.io.evil.test/file"), "subtitle host boundary")
  check(not lcExtrasSubtitleUrl("http://subs5.strem.io/file"), "subtitle requires HTTPS")
  m.data = { subtitles: [{ id: "1", lang: "spa", url: "https://subs5.strem.io/es/1" }, { id: "2", lang: "eng", url: "https://subs5.strem.io/en/2" }, { id: "3", lang: "eng", url: "https://subs5.strem.io/en/3" }, { id: "4", lang: "fra", url: "https://evil.test/4" }] }
  tracks = lcExtrasSubtitles({ query: query, profileId: "p1" })
  check(tracks.Count() = 2, "one valid track per language")
  check(tracks[0].language = "eng", "preferred language first")
  check(tracks[0].TrackName = tracks[0].url, "Roku sideload TrackName is URL")
  m.cache = {} : m.level = 18
  m.rows = [{ collectionLabel: { value: "A trilogy" }, imdb: { value: "tt1000001" }, filmLabel: { value: "First" }, date: { value: "2000-01-01" } }, { collectionLabel: { value: "A trilogy" }, imdb: { value: "tt1000002" }, filmLabel: { value: "Second" }, date: { value: "2001-01-01" } }, { collectionLabel: { value: "A trilogy" }, imdb: { value: "tt1000003" }, filmLabel: { value: "Third" }, date: { value: "2002-01-01" } }]
  collection = lcExtrasCollection({ query: { id: "tt1000002" }, profileId: "p1" })
  check(collection.name = "A trilogy" and collection.items.Count() = 2, "collection excludes current film")
  check(collection.items[0].title = "First" and collection.items[1].title = "Third", "collection release order")
  m.level = 7 : m.data = invalid
  hidden = lcExtrasCollection({ query: { id: "tt1000002" }, profileId: "p1" })
  check(hidden.items.Count() = 0, "restricted collection hides unresolved metadata")
  m.level = 18
  m.cache = {} : m.data = { id: 169, _embedded: { nextepisode: { season: 3, number: 1, name: "Tomorrow", airstamp: "2027-01-16T08:00:00Z" } } }
  upcoming = lcExtrasUpcoming("tt0903747")
  check(upcoming.next.name = "Tomorrow", "TVmaze embedded episode")
  m.data = { meta: { name: "Series", genres: ["Drama"], videos: [{ season: 1, episode: 3, title: "Third", released: "2020-01-01T00:00:00Z" }, { season: 2, episode: 1, title: "Future", released: "2030-01-01T00:00:00Z" }, { season: 1, episode: 2, title: "Second", released: "2020-01-01T00:00:00Z" }] } }
  nextEp = lcExtrasNext({ query: query, profileId: "p1" })
  check(nextEp.next.episode = 2, "next episode ordered and aired")
  m.segments = segments : m.position = 50 : m.duration = 3600
  check(playerSegment() = invalid, "no assumed 90-second recap")
  m.position = 230 : m.activeSegment = playerSegment()
  m.skipConsumed = {} : m.extrasPrefs = { skipSegments: "button" }
  check(skipRecapAllowed(), "source-timed intro offered")
  check(skipRecapTarget() = 246.498, "source skip target")
  m.extrasPrefs.skipSegments = "off"
  check(not skipRecapAllowed(), "Off disables skip")
  m.extrasPrefs.skipSegments = "auto" : m.skipConsumed[m.activeSegment.key] = true
  check(not skipRecapAllowed(), "consumed segment not repeated")
  m.position = 3440
  check(extrasCreditsReached(), "credits trigger next")
  m.segments = {} : m.position = 3569
  check(not extrasCreditsReached(), "fallback starts only in last 30 seconds")
  m.position = 3570
  check(extrasCreditsReached(), "last 30 seconds fallback")
  m.watchClock = { TotalMilliseconds: fakeElapsed, Mark: fakeMark }
  m.watchSeconds = 0 : m.watchPosition = 9 : m.video = { state: "playing", position: 10 }
  measureWatchTime()
  check(m.watchSeconds = 1, "playing time counted")
  m.video.position = 100 : measureWatchTime()
  check(m.watchSeconds = 1, "seek time excluded")
  m.video.state = "paused" : m.video.position = 101 : measureWatchTime()
  check(m.watchSeconds = 1, "paused time excluded")
  ctx = { profileId: "p1", body: { id: "tt0903747:1:1", watched: 10, item: { title: "Pilot", kind: "series", genres: ["Drama"] } } }
  lcRecordWatch(ctx, 10, 100)
  lcRecordWatch(ctx, 95, 100)
  stats = lcExtrasStats(ctx)
  check(stats.all = 20 and stats.week = 20 and stats.month = 20, "watch totals count actual seconds")
  check(stats.finished = 1 and stats.streakDays = 1, "finish and streak")
  check(stats.topGenres[0].genre = "Drama", "top genres")
  check(stats.history.Count() = 1 and stats.history[0].seconds = 20, "history aggregates title")
  check(lcExtrasStats({ profileId: "p2" }).all = 0, "profile isolation")
  m.response = { ok: true, status: 200, json: { session: "fixture-session", account: { id: "fixture-account", status: "active", termsVersion: "test-terms", hasRdToken: true, liveTv: false, emailVerified: false } } }
  accountCtx = { accountToken: "fixture-session", body: { email: "test@example.test", password: "test-password" } }
  signed = lcSignInAccount(accountCtx)
  check(signed.json.token = "fixture-session", "private session adapted")
  check(signed.json.usable.ok, "active service account usable without nonexistent email-code flow")
  check(m.http.url = "https://tvm-accounts.tvm-accounts.workers.dev/v1/signin", "fixed account origin")
  check(m.http.headers.Authorization = "Bearer fixture-session", "session Bearer")
  check(m.http.timeout = 6000, "account timeout")
  body = ParseJson(m.http.body)
  check(body.client = "TVM Roku" and not body.DoesExist("code"), "allowed signin schema")
  m.response.json.account.status = "waiting"
  check(lcSignInAccount(accountCtx).json.usable.reason = "awaiting_activation", "waiting gate")
  m.response.json.account.status = "suspended"
  check(lcSignInAccount(accountCtx).json.usable.reason = "suspended", "suspended gate")
  m.response.json.account.status = "active" : m.response.json.account.termsVersion = "old"
  check(lcSignInAccount(accountCtx).json.usable.reason = "terms_required", "terms gate")
  lcAcceptTerms(accountCtx)
  check(ParseJson(m.http.body).version = "test-terms", "terms version submitted")
  m.response = { ok: false, status: 429 }
  check(lcSignInAccount(accountCtx).status = 429, "rate limit preserved")

  ' Device sign-in flow endpoints (unauthenticated public device start & poll)
  m.response = { ok: true, status: 200, json: { deviceCode: "abcdefghijklmnopqrstuvwxyz0123456789abcdefg", userCode: "ABCD-EFGH", verifyUrl: "https://tvm-accounts.tvm-accounts.workers.dev/link", verifyUrlComplete: "https://tvm-accounts.tvm-accounts.workers.dev/link?code=ABCD-EFGH", expiresIn: 600, interval: 5 } }
  devStart = lcDeviceStart({ accountToken: "fixture-session", body: { client: "Living Room Roku" } })
  check(devStart.status = 200 and devStart.json.userCode = "ABCD-EFGH", "device start returns codes")
  check(m.http.url = "https://tvm-accounts.tvm-accounts.workers.dev/v1/device/start", "device start hits accounts worker")
  check(not m.http.headers.DoesExist("Authorization"), "device start sends no bearer token")

  pollCtx = { accountToken: "fixture-session", body: { deviceCode: "abcdefghijklmnopqrstuvwxyz0123456789abcdefg" } }
  m.response = { ok: false, status: 428, json: { error: "pending" } }
  pollPending = lcDevicePoll(pollCtx)
  check(pollPending.status = 428 and pollPending.json.state = "pending", "device poll pending mapped")
  m.response = { ok: false, status: 410, json: { error: "expired" } }
  pollExpired = lcDevicePoll(pollCtx)
  check(pollExpired.status = 410 and pollExpired.json.state = "expired", "device poll expired mapped")
  m.response = { ok: false, status: 429, json: { error: "slow_down" } }
  pollSlow = lcDevicePoll(pollCtx)
  check(pollSlow.status = 429 and pollSlow.json.state = "slow_down", "device poll slow_down mapped")
  m.response = { ok: true, status: 200, json: { session: "device-session", account: { id: "a1", status: "active", termsVersion: "test-terms", hasRdToken: false, liveTv: false } } }
  pollOk = lcDevicePoll(pollCtx)
  check(pollOk.status = 200 and pollOk.json.state = "approved" and pollOk.json.token = "device-session" and pollOk.json.usable.ok, "device poll approved")
  print "EXTRAS_RUNTIME_OK"
end sub

sub check(value as Boolean, name as String)
  if not value then print "FAIL: " + name
end sub

function lcExtrasFetch(url as String, method = "GET" as String, body = "" as String) as Dynamic
  m.calls.Push(url)
  return m.data
end function

function lcExtrasCache(key as String) as Dynamic
  return lcAaGet(m.cache, key, invalid)
end function

sub lcExtrasRemember(key as String, data as Object, seconds as Integer)
  m.cache[key] = data
end sub

function lcExtrasSparql(query as String) as Object
  m.lastQuery = query
  return m.rows
end function

function lcExtrasBinding(row as Object, key as String) as String
  return lcAaText(lcAaGet(row, key, {}), "value")
end function

function lcExtrasAnime(title as String) as Object
  return { english: title, malId: 1 }
end function

function lcExtrasPrefs(ctx as Object) as Object
  return { subtitleLanguages: ["eng"] }
end function

function lcUrlEncode(value as String) as String
  return value
end function

function lcNowSeconds() as Integer
  return CreateObject("roDateTime").AsSeconds()
end function

function lcReadRegJson(key as String, fallback as Dynamic) as Dynamic
  return lcAaGet(m.registry, key, fallback)
end function

sub lcWriteRegJson(key as String, value as Object)
  m.registry[key] = value
end sub

function lcActiveProfileId(ctx as Object) as String
  return ctx.profileId
end function

function lcProfileLevel(ctx as Object) as Object
  if m.level = invalid then return { maxAge: 18 }
  return { maxAge: m.level }
end function

function lcAllowed(item as Object, level as Object) as Boolean
  return true
end function

function lcHttp(url as String, method as String, body as String, headers as Object, timeout as Integer) as Object
  m.http = { url: url, method: method, body: body, headers: headers, timeout: timeout }
  return m.response
end function

function lcTermsVersion() as String
  return "test-terms"
end function

function fakeElapsed() as Integer
  return 1000
end function

sub fakeMark()
end sub

sub syncBindAccount(token as String, accountId as String)
end sub

sub syncResetBackoff()
end sub

sub syncClearOnSignOut()
end sub
