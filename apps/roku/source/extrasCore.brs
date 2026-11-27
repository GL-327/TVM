' Extras run only on ApiTask; optional sources fail closed and never block playback.
function lcExtrasRoute(ctx as Object) as Dynamic
  path = ctx.path
  if path <> "/api/prefs" and Left(path, 12) <> "/api/extras/" then return invalid
  age = m.top.profileMaxAge
  if age <> 7 and age <> 12 and age <> 15 and age <> 18 then age = 7
  if age < lcProfileLevel(ctx).maxAge then ctx.maxAge = age
  m.extrasDeadline = lcNowSeconds() + 22
  if path = "/api/prefs"
    if ctx.method = "PUT" then lcSaveExtrasPrefs(ctx)
    return { status: 200, json: lcExtrasPrefs(ctx) }
  end if
  data = {}
  gates = {
    "/api/extras/subtitles": "onlineSubtitles", "/api/extras/collection": "collections"
    "/api/extras/upcoming": "comingUp", "/api/extras/upcoming/home": "comingUp"
    "/api/extras/anime-title": "animeTitles", "/api/extras/progress": "watchStats"
    "/api/extras/surprise": "surpriseMe"
  }
  gate = lcAaText(gates, path)
  if gate <> "" and not lcAaBool(lcExtrasPrefs(ctx).extras, gate, true) then return { status: 404, json: {} }
  if path = "/api/extras/hero-clip" or path = "/api/extras/theme" or path = "/api/extras/ytdlp" then return { status: 404, json: {} }
  if path = "/api/extras/next" then data = lcExtrasNext(ctx)
  if path = "/api/extras/segments" then data = lcExtrasSegments(ctx.query)
  if path = "/api/extras/subtitles" then data = { subtitles: lcExtrasSubtitles(ctx) }
  if path = "/api/extras/collection" then data = lcExtrasCollection(ctx)
  if path = "/api/extras/upcoming" then data = lcExtrasUpcoming(lcAaText(ctx.query, "id"))
  if path = "/api/extras/upcoming/home" then data = lcExtrasHome(ctx)
  if path = "/api/extras/anime-title" then data = lcExtrasAnime(lcAaText(ctx.query, "title"))
  if path = "/api/extras/surprise" then data = lcExtrasSurprise(ctx)
  if path = "/api/extras/stats" then data = lcExtrasStats(ctx)
  if path = "/api/extras/stats/clear" and ctx.method = "POST"
    all = lcReadRegJson("extrasStats", {})
    all.Delete(lcActiveProfileId(ctx))
    lcWriteRegJson("extrasStats", all)
    data = lcExtrasStats(ctx)
  end if
  if path = "/api/extras/progress" and ctx.method = "POST"
    lcRecordWatch(ctx, lcAaGet(ctx.body, "position", 0), lcAaGet(ctx.body, "duration", 0))
  end if
  return { status: 200, json: data }
end function

function lcExtraDefaults() as Object
  return {
    onlineSubtitles: true, trailers: false, trailerBackdrops: false, collections: true, comingUp: true
    watchStats: true, animeTitles: true, ratings: true, qualityBadges: true, versionPicker: true
    chapters: false, seekPreviews: false, themeSongs: false, spoilerBlur: false, surpriseMe: true
    autoCollections: true, sleepTimer: true, nightMode: false, pauseOnMinimize: false
    shortcutsOverlay: false, webhook: false, announcements: true, franchiseIntros: true
  }
end function

function lcExtrasPrefs(ctx as Object) as Object
  all = lcReadRegJson("extrasPrefs", {})
  prefs = lcAaGet(all, lcActiveProfileId(ctx), {})
  synced = syncReadPrefs()
  merged = {}
  for each k in prefs
    merged[k] = prefs[k]
  end for
  for each k in ["skipSegments", "autoplayNext", "subtitleLanguages", "audioLanguage", "subtitleStyle", "homeSections"]
    if synced.DoesExist(k) then merged[k] = synced[k]
  end for
  mode = lcAaText(merged, "skipSegments", "button")
  if mode <> "off" and mode <> "auto" then mode = "button"
  extras = lcExtraDefaults()
  given = lcAaGet(merged, "extras", {})
  for each key in extras
    extras[key] = lcAaBool(given, key, extras[key])
    if synced.DoesExist("extras." + key) and syncIsBool(synced["extras." + key])
      extras[key] = synced["extras." + key]
    end if
  end for
  return {
    skipSegments: mode, autoplayNext: lcAaBool(merged, "autoplayNext", true)
    subtitleLanguages: lcAaGet(merged, "subtitleLanguages", ["eng"]), subtitleLanguage: lcAaText(merged, "subtitleLanguage", "eng")
    quality: lcAaText(merged, "quality", "original"), audioLanguage: lcAaText(merged, "audioLanguage", "original")
    skipUpscaled: lcAaBool(merged, "skipUpscaled", true), subtitleMode: lcAaText(merged, "subtitleMode", "foreign")
    subtitleStyle: lcAaGet(merged, "subtitleStyle", { size: "m", color: "white", background: "shadow" })
    extras: extras, sleepDefault: lcAaText(merged, "sleepDefault", "off")
    spotlightEvents: lcAaBool(merged, "spotlightEvents", true), homeSections: lcAaGet(merged, "homeSections", [])
    webhookUrl: invalid, heroPreviews: false
  }
end function

sub lcSaveExtrasPrefs(ctx as Object)
  before = lcExtrasPrefs(ctx)
  prefs = lcExtrasPrefs(ctx)
  body = ctx.body
  for each key in ["skipSegments", "autoplayNext", "subtitleLanguages", "subtitleLanguage", "quality", "audioLanguage", "skipUpscaled", "subtitleMode", "sleepDefault", "spotlightEvents"]
    previous = prefs[key]
    incoming = lcAaGet(body, key, previous)
    if Type(incoming) = Type(previous) then prefs[key] = incoming
  end for
  if not lcIncludes(["original", "2160", "1080", "720", "saver"], prefs.quality) then prefs.quality = "original"
  if not lcIncludes(["foreign", "always", "off"], prefs.subtitleMode) then prefs.subtitleMode = "foreign"
  if not lcIncludes(["off", "15", "30", "45", "60", "end"], prefs.sleepDefault) then prefs.sleepDefault = "off"
  style = lcAaGet(body, "subtitleStyle", {})
  for each key in ["size", "color", "background"]
    allowed = { size: ["s", "m", "l", "xl"], color: ["white", "yellow", "cyan"], background: ["shadow", "box", "none"] }
    choice = lcAaText(style, key)
    if lcIncludes(allowed[key], choice) then prefs.subtitleStyle[key] = choice
  end for
  extras = lcAaGet(body, "extras", {})
  for each key in prefs.extras
    prefs.extras[key] = lcAaBool(extras, key, prefs.extras[key])
  end for
  sections = lcAaGet(body, "homeSections", invalid)
  if Type(sections) = "roArray" and sections.Count() <= 30 then prefs.homeSections = sections
  all = lcReadRegJson("extrasPrefs", {})
  all[lcActiveProfileId(ctx)] = prefs
  lcWriteRegJson("extrasPrefs", all)

  syncValues = syncReadPrefs()
  syncChanged = false
  for each key in syncPrefKeys()
    if Left(key, 7) = "extras."
      ek = Mid(key, 8)
      beforeVal = before.extras[ek]
      afterVal = prefs.extras[ek]
    else
      beforeVal = before[key]
      afterVal = prefs[key]
    end if
    if syncCanonicalJson(beforeVal) <> syncCanonicalJson(afterVal)
      syncValues[key] = afterVal
      syncChanged = true
    end if
  end for
  if syncChanged then syncWritePrefs(syncValues)
end sub

' Registry holds only small, normalized public metadata (bounded to 9 KB).
function lcExtrasCache(key as String) as Dynamic
  cache = lcReadRegJson("extrasCache", {})
  row = lcAaGet(cache, key, invalid)
  if row = invalid then return invalid
  if lcAaInt(row, "expires") <= lcNowSeconds() then return invalid
  return lcAaGet(row, "data", invalid)
end function

sub lcExtrasRemember(key as String, data as Object, seconds as Integer)
  cache = lcReadRegJson("extrasCache", {})
  cache[key] = { expires: lcNowSeconds() + seconds, data: data }
  if Len(FormatJson(cache)) > 9000 then cache = { }
  cache[key] = { expires: lcNowSeconds() + seconds, data: data }
  if Len(FormatJson(cache)) <= 9000 then lcWriteRegJson("extrasCache", cache)
end sub

function lcExtrasFetch(url as String, method = "GET" as String, body = "" as String) as Dynamic
  remaining = (m.extrasDeadline - lcNowSeconds()) * 1000
  if remaining <= 0 then return invalid
  timeout = 6000
  if remaining < timeout then timeout = remaining
  key = "tvm_extras_" + Left(lcSha256Hex(url + body), 24) + ".json"
  if m.extrasMemory = invalid then m.extrasMemory = {}
  if m.extrasMemory.DoesExist(key) then return m.extrasMemory[key]
  cached = lcReadTmpJson(key, 3600)
  if cached <> invalid then return cached
  res = lcHttp(url, method, body, { Accept: "application/json", "Content-Type": "application/json" }, timeout)
  if not res.ok or res.json = invalid then return invalid
  m.extrasMemory[key] = res.json
  lcWriteTmpJson(key, res.json)
  return res.json
end function

function lcExtrasImdb(id as String) as String
  parts = id.Split(":")
  if parts.Count() = 0 then return ""
  id = parts[0]
  if not CreateObject("roRegex", "^tt[0-9]{5,12}$", "").IsMatch(id) then return ""
  return id
end function

function lcExtrasEpisode(query as Object) as Object
  parts = lcAaText(query, "id").Split(":")
  season = lcAaInt(query, "season") : episode = lcAaInt(query, "episode")
  if parts.Count() >= 3
    season = Int(Val(parts[1])) : episode = Int(Val(parts[2]))
  end if
  return { season: season, episode: episode }
end function

function lcExtrasSparql(query as String) as Object
  data = lcExtrasFetch("https://query.wikidata.org/sparql?format=json&query=" + lcUrlEncode(query))
  results = lcAaGet(data, "results", {})
  return lcAaGet(results, "bindings", [])
end function

function lcExtrasBinding(row as Object, key as String) as String
  return lcAaText(lcAaGet(row, key, {}), "value")
end function

function lcExtrasAnime(title as String) as Object
  empty = { english: "", malId: 0 }
  if title.Trim() = "" then return empty
  key = "anime_" + Left(lcSha256Hex(title), 20)
  cached = lcExtrasCache(key)
  if cached <> invalid then return cached
  query = "query($search:String){Media(search:$search,type:ANIME){idMal title{english romaji}}}"
  data = lcExtrasFetch("https://graphql.anilist.co", "POST", FormatJson({ query: query, variables: { search: title } }))
  media = lcAaGet(lcAaGet(data, "data", {}), "Media", {})
  result = { english: lcAaText(lcAaGet(media, "title", {}), "english"), malId: lcAaInt(media, "idMal") }
  lcExtrasRemember(key, result, 86400)
  return result
end function

function lcExtrasSegments(query as Object) as Object
  empty = { intro: invalid, recap: invalid, credits: invalid, source: invalid }
  id = lcExtrasImdb(lcAaText(query, "id"))
  if id = "" then return empty
  ep = lcExtrasEpisode(query)
  key = "segments_" + id + "_" + ep.season.ToStr() + "_" + ep.episode.ToStr()
  cached = lcExtrasCache(key)
  if cached <> invalid then return cached
  property = "P4947"
  if ep.episode > 0 then property = "P4983"
  rows = lcExtrasSparql("SELECT ?tmdb WHERE { ?item wdt:P345 " + Chr(34) + id + Chr(34) + "; wdt:" + property + " ?tmdb. } LIMIT 1")
  result = empty
  if rows.Count() > 0
    tmdb = lcExtrasBinding(rows[0], "tmdb")
    if CreateObject("roRegex", "^[0-9]+$", "").IsMatch(tmdb)
      url = "https://api.theintrodb.org/v2/media?tmdb_id=" + tmdb
      if ep.episode > 0 then url = url + "&season=" + ep.season.ToStr() + "&episode=" + ep.episode.ToStr()
      data = lcExtrasFetch(url)
      for each kind in ["intro", "recap", "credits"]
        segments = lcAaGet(data, kind, [])
        if Type(segments) = "roArray" and segments.Count() > 0
          segment = segments[0]
          startMs = lcAaGet(segment, "start_ms", invalid)
          endMs = lcAaGet(segment, "end_ms", invalid)
          if startMs <> invalid
            finish = invalid
            if endMs <> invalid then finish = endMs / 1000.0
            if startMs >= 0
              if finish <> invalid or kind = "credits"
                if finish = invalid or finish > startMs / 1000.0
                  result[kind] = { start: startMs / 1000.0, "end": finish }
                  result.source = "theintrodb"
                end if
              end if
            end if
          end if
        end if
      end for
    end if
  end if
  if result.source = invalid and lcAaText(query, "anime") = "1" and ep.episode > 0
    anime = lcExtrasAnime(lcAaText(query, "title"))
    if anime.malId > 0
      data = lcExtrasFetch("https://api.aniskip.com/v2/skip-times/" + anime.malId.ToStr() + "/" + ep.episode.ToStr() + "?types[]=op&types[]=ed&types[]=recap&episodeLength=0")
      for each segment in lcAaGet(data, "results", [])
        kind = ""
        if segment.skipType = "op" then kind = "intro"
        if segment.skipType = "ed" then kind = "credits"
        if segment.skipType = "recap" then kind = "recap"
        interval = lcAaGet(segment, "interval", {})
        startSec = lcAaGet(interval, "startTime", -1)
        endSec = lcAaGet(interval, "endTime", -1)
        if kind <> "" and startSec >= 0 and endSec > startSec
          result[kind] = { start: startSec, "end": endSec }
          result.source = "aniskip"
        end if
      end for
    end if
  end if
  ttl = 86400
  if result.source = invalid then ttl = 900
  lcExtrasRemember(key, result, ttl)
  return result
end function

function lcExtrasSubtitleUrl(url as String) as Boolean
  return CreateObject("roRegex", "^https://([a-z0-9-]+\.)*strem\.io/[^ ]+$", "i").IsMatch(url)
end function

function lcExtrasSubtitles(ctx as Object) as Object
  id = lcExtrasImdb(lcAaText(ctx.query, "id"))
  if id = "" then return []
  ep = lcExtrasEpisode(ctx.query)
  kind = "movie"
  if ep.episode > 0
    kind = "series"
    id = id + ":" + ep.season.ToStr() + ":" + ep.episode.ToStr()
  end if
  data = lcExtrasFetch("https://opensubtitles-v3.strem.io/subtitles/" + kind + "/" + id + ".json")
  languages = {} : choices = [] : result = []
  for each subtitle in lcAaGet(data, "subtitles", [])
    language = lcAaText(subtitle, "lang")
    url = lcAaText(subtitle, "url")
    if language <> "" and not languages.DoesExist(language) and lcExtrasSubtitleUrl(url)
      languages[language] = true
      ' Roku fetches SRT/WebVTT itself; never attach the session's HTTP headers.
      choices.Push({ id: lcAaText(subtitle, "id"), language: language, label: language.ToStr(), url: url, TrackName: url, Description: language, SubtitleUrl: url })
    end if
  end for
  prefs = lcExtrasPrefs(ctx)
  for each preferred in prefs.subtitleLanguages
    for each track in choices
      if track.language = preferred then result.Push(track)
    end for
  end for
  for each track in choices
    found = false
    for each preferred in prefs.subtitleLanguages
      if track.language = preferred then found = true
    end for
    if not found then result.Push(track)
    if result.Count() >= 32 then exit for
  end for
  return result
end function

function lcExtrasCollection(ctx as Object) as Object
  empty = { name: "", items: [] }
  id = lcExtrasImdb(lcAaText(ctx.query, "id"))
  if id = "" then return empty
  key = "collection_" + id
  cached = lcExtrasCache(key)
  if cached = invalid
    query = "SELECT DISTINCT ?collectionLabel ?imdb ?filmLabel ?date WHERE { ?item wdt:P345 " + Chr(34) + id + Chr(34) + "; wdt:P179 ?collection. ?film wdt:P179 ?collection; wdt:P345 ?imdb; wdt:P31/wdt:P279* wd:Q11424. OPTIONAL { ?film wdt:P577 ?date. } SERVICE wikibase:label { bd:serviceParam wikibase:language " + Chr(34) + "en" + Chr(34) + ". } } ORDER BY ?date LIMIT 32"
    rows = lcExtrasSparql(query)
    items = [] : seen = {} : name = ""
    for each row in rows
      imdb = lcExtrasImdb(lcExtrasBinding(row, "imdb"))
      collection = lcExtrasBinding(row, "collectionLabel")
      if name = "" then name = collection
      if imdb <> "" and not seen.DoesExist(imdb) and collection = name
        seen[imdb] = true
        items.Push({ id: imdb, title: lcExtrasBinding(row, "filmLabel"), kind: "movie", year: Int(Val(Left(lcExtrasBinding(row, "date"), 4))), poster: "https://images.metahub.space/poster/medium/" + imdb + "/img", playable: true })
      end if
      if items.Count() >= 12 then exit for
    end for
    cached = { name: name, items: items }
    ttl = 604800
    if items.Count() < 2 then ttl = 900
    lcExtrasRemember(key, cached, ttl)
  end if
  items = []
  level = lcProfileLevel(ctx)
  for each item in cached.items
    if level.maxAge < 18
      ' Resolve real genres before applying the existing profile filter.
      raw = lcExtrasFetch("https://v3-cinemeta.strem.io/meta/movie/" + item.id + ".json")
      movie = lcMetaToItem(lcAaGet(raw, "meta", invalid))
      if movie <> invalid
        if lcAllowed(movie, level) then items.Push(movie)
      end if
    else
      items.Push(item)
    end if
  end for
  if items.Count() < 2 then return empty
  others = []
  for each item in items
    if item.id <> id then others.Push(item)
  end for
  return { name: cached.name, items: others }
end function

function lcExtrasUpcoming(id as String) as Object
  id = lcExtrasImdb(id)
  if id = "" then return { next: invalid }
  key = "upcoming_" + id
  cached = lcExtrasCache(key)
  if cached <> invalid then return cached
  show = lcExtrasFetch("https://api.tvmaze.com/lookup/shows?imdb=" + id)
  showId = lcAaInt(show, "id")
  result = { next: invalid }
  if showId > 0
    data = lcExtrasFetch("https://api.tvmaze.com/shows/" + showId.ToStr() + "?embed=nextepisode")
    nextEp = lcAaGet(lcAaGet(data, "_embedded", {}), "nextepisode", invalid)
    if nextEp <> invalid
      stamp = lcAaText(nextEp, "airstamp")
      dt = CreateObject("roDateTime") : dt.FromISO8601String(stamp)
      if stamp <> "" and dt.AsSeconds() > lcNowSeconds()
        result.next = { season: lcAaInt(nextEp, "season"), episode: lcAaInt(nextEp, "number"), name: lcAaText(nextEp, "name"), airstamp: stamp }
      end if
    end if
  end if
  lcExtrasRemember(key, result, 3600)
  return result
end function

function lcExtrasNext(ctx as Object) as Object
  id = lcExtrasImdb(lcAaText(ctx.query, "id"))
  ep = lcExtrasEpisode(ctx.query)
  if id = "" or ep.episode <= 0 then return { next: invalid }
  meta = lcExtrasFetch("https://v3-cinemeta.strem.io/meta/series/" + id + ".json")
  meta = lcAaGet(meta, "meta", {})
  if not lcAllowed({ kind: "series", genres: lcAaGet(meta, "genres", []) }, lcProfileLevel(ctx)) then return { next: invalid }
  best = invalid : bestOrder = 2147483647
  current = ep.season * 10000 + ep.episode
  for each video in lcAaGet(meta, "videos", [])
    season = lcAaInt(video, "season") : episode = lcAaInt(video, "episode")
    order = season * 10000 + episode
    stamp = lcAaText(video, "released", lcAaText(video, "firstAired"))
    dt = CreateObject("roDateTime") : dt.FromISO8601String(stamp)
    if season > 0 and episode > 0 and order > current and order < bestOrder and stamp <> "" and dt.AsSeconds() <= lcNowSeconds()
      bestOrder = order
      best = { id: id + ":" + season.ToStr() + ":" + episode.ToStr(), kind: "series", season: season, episode: episode, title: lcAaText(video, "title", lcAaText(video, "name", "Episode " + episode.ToStr())), showTitle: lcAaText(meta, "name"), genres: lcAaGet(meta, "genres", []), poster: lcAaText(video, "thumbnail", lcAaText(meta, "poster")), backdrop: lcAaText(video, "thumbnail", lcAaText(meta, "background")), playable: true }
    end if
  end for
  return { next: best }
end function

function lcExtrasHome(ctx as Object) as Object
  candidates = lcAaGet(ctx.body, "items", [])
  candidates.Append(lcGetWatchlist(lcActiveProfileId(ctx)))
  result = [] : seen = {} : count = 0
  for each item in candidates
    kind = lcAaText(item, "kind")
    id = lcExtrasImdb(lcAaText(item, "id"))
    if (kind = "series" or kind = "episode") and id <> "" and not seen.DoesExist(id)
      seen[id] = true : count = count + 1
      upcoming = lcExtrasUpcoming(id)
      if upcoming.next <> invalid
        dt = CreateObject("roDateTime") : dt.FromISO8601String(upcoming.next.airstamp)
        if dt.AsSeconds() <= lcNowSeconds() + 604800
          copy = {} : copy.Append(item)
          copy.id = id : copy.kind = "series"
          copy.title = lcAaText(item, "showTitle", lcAaText(item, "title"))
          copy.airDateKey = upcoming.next.airstamp
          copy.comingUp = upcoming.next
          result.Push(copy)
        end if
      end if
      if count >= 8 or lcNowSeconds() >= m.extrasDeadline then exit for
    end if
  end for
  result.SortBy("airDateKey")
  return { items: lcFilterItems(result, ctx) }
end function

' Watch time is supplied by the player's monotonic clock, excluding seeks/pauses.
sub lcRecordWatch(ctx as Object, position as Dynamic, duration as Dynamic)
  seconds = lcAaInt(ctx.body, "watched")
  if seconds <= 0 then return
  if seconds > 60 then seconds = 60
  id = lcAaText(ctx.body, "id")
  if id = "" or Left(id, 5) = "live:" then return
  all = lcReadRegJson("extrasStats", {})
  pid = lcActiveProfileId(ctx)
  stats = lcAaGet(all, pid, { all: 0, days: {}, finished: {}, genres: {}, history: [] })
  stats.all = lcAaInt(stats, "all") + seconds
  now = lcNowSeconds() : day = Int(now / 86400).ToStr()
  stats.days[day] = lcAaInt(stats.days, day) + seconds
  for each key in stats.days.Keys()
    if Int(Val(key)) < Int(now / 86400) - 40 then stats.days.Delete(key)
  end for
  if duration > 0 and position / duration >= 0.92 then stats.finished[id] = true
  item = lcAaGet(ctx.body, "item", {})
  for each genre in lcAaGet(item, "genres", [])
    stats.genres[genre] = lcAaInt(stats.genres, genre) + seconds
  end for
  history = [] : previous = 0
  for each row in stats.history
    if row.item.id = id then previous = row.seconds
  end for
  history.Push({ item: { id: id, title: lcAaText(item, "title", id), kind: lcAaText(item, "kind"), genres: lcAaGet(item, "genres", []) }, at: now, seconds: previous + seconds })
  for each row in stats.history
    if row.item.id <> id and history.Count() < 24 then history.Push(row)
  end for
  stats.history = history
  all[pid] = stats
  lcWriteRegJson("extrasStats", all)
end sub

function lcExtrasStats(ctx as Object) as Object
  stats = lcAaGet(lcReadRegJson("extrasStats", {}), lcActiveProfileId(ctx), {})
  week = 0 : month = 0 : streak = 0
  days = lcAaGet(stats, "days", {})
  today = Int(lcNowSeconds() / 86400)
  for each key in days
    age = today - Int(Val(key))
    if age >= 0 and age < 7 then week = week + days[key]
    if age >= 0 and age < 30 then month = month + days[key]
  end for
  start = today
  if not days.DoesExist(start.ToStr()) then start = start - 1
  while days.DoesExist(start.ToStr())
    streak = streak + 1 : start = start - 1
  end while
  genres = lcAaGet(stats, "genres", {}) : topGenres = []
  for each genre in genres
    topGenres.Push({ genre: genre, seconds: genres[genre] })
  end for
  topGenres.SortBy("seconds", "r")
  return { week: week, month: month, all: lcAaInt(stats, "all"), finished: lcAaGet(stats, "finished", {}).Count(), streakDays: streak, topGenres: topGenres, history: lcAaGet(stats, "history", []) }
end function

function lcExtrasSurprise(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  candidates = []
  candidates.Append(lcGetWatchlist(pid))
  bundle = lcCatalogBundle()
  candidates.Append(lcAaGet(bundle, "trending", []))
  candidates.Append(lcAaGet(bundle, "all", []))
  filtered = lcFilterItems(lcDedupeItems(candidates), ctx)
  if filtered.Count() = 0 then return { item: invalid }
  pick = filtered[Rnd(filtered.Count()) - 1]
  return { item: pick }
end function
