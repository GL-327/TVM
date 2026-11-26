' TVM 1.1 routes. Called only on ApiTask, never on the render thread.
function lcContentNames() as Object
  return { changelog: "releases", events: "events", "free-channels": "channels", services: "services", avatars: "sets", parental: "levels" }
end function

function lcValidContent(name as String, data as Dynamic) as Boolean
  names = lcContentNames()
  if not names.DoesExist(name) then return false
  if lcAaInt(data, "schema", 0) <> 1 then return false
  rows = lcAaGet(data, names[name], invalid)
  if Type(rows) <> "roArray" then return false
  for each row in rows
    if GetInterface(row, "ifAssociativeArray") = invalid then return false
    if name = "parental"
      if Type(lcAaGet(row, "block", invalid)) <> "roArray" then return false
    else if name = "changelog"
      if lcAaText(row, "version") = "" or Type(lcAaGet(row, "highlights", invalid)) <> "roArray" then return false
    else
      if lcAaText(row, "id") = "" then return false
    end if
    if name = "free-channels" and (lcAaText(row, "name") = "" or Left(lcAaText(row, "url"), 8) <> "https://") then return false
    if name = "free-channels" and lcAaText(row, "group") = "" then return false
    if name = "services"
      if lcAaText(row, "name") = "" then return false
      roku = lcAaText(row, "roku")
      if roku <> "" and not CreateObject("roRegex", "^[0-9]+$", "").IsMatch(roku) then return false
    end if
    if name = "avatars"
      if Type(lcAaGet(row, "avatars", invalid)) <> "roArray" or lcAaText(row, "title") = "" then return false
      for each avatar in row.avatars
        if lcAaText(avatar, "id") = "" or lcAaText(avatar, "name") = "" or Left(lcAaText(avatar, "image"), 8) <> "https://" then return false
      end for
    end if
    if name = "events"
      datePattern = CreateObject("roRegex", "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", "")
      for each key in ["start", "end", "release"]
        if not datePattern.IsMatch(lcAaText(row, key)) then return false
      end for
      if row.start > row.end then return false
      if not CreateObject("roRegex", "^#[0-9a-f]{6}$", "i").IsMatch(lcAaText(row, "accent")) then return false
      if not CreateObject("roRegex", "^tt[0-9]+$", "").IsMatch(lcAaText(row, "imdbId")) then return false
      rail = lcAaGet(row, "rail", {})
      if lcAaText(row, "title") = "" or lcAaText(rail, "id") = "" or lcAaText(rail, "title") = "" then return false
      if Type(lcAaGet(rail, "items", invalid)) <> "roArray" then return false
      for each id in rail.items
        if Type(id) <> "roString" and Type(id) <> "String" then return false
        if not CreateObject("roRegex", "^tt[0-9]+$", "").IsMatch(id) then return false
      end for
    end if
  end for
  return true
end function

function lcContent(name as String) as Object
  if not lcContentNames().DoesExist(name) then return {}
  data = lcReadTmpJson("tvm_content_" + name + ".json")
  if lcValidContent(name, data) then return data
  data = ParseJson(ReadAsciiFile("cachefs:/tvm_v11_content_" + name + ".json"))
  if lcValidContent(name, data) then return data
  data = ParseJson(ReadAsciiFile("pkg:/source/data/content/" + name + ".json"))
  if lcValidContent(name, data) then return data
  return {}
end function

function lcRefreshContent() as Object
  stamps = lcReadRegJson("contentChecked", {})
  for each name in ["events", "free-channels", "services", "avatars"]
    now = lcNowSeconds()
    if now - lcAaInt(stamps, name, 0) >= 21600
      stamps[name] = now
      lcWriteRegJson("contentChecked", stamps)
      res = lcHttp("https://raw.githubusercontent.com/GL-327/TVM/main/packages/content/" + name + ".json", "GET", "", {}, 6000)
      if res.ok and lcValidContent(name, res.json)
        lcWriteTmpJson("tvm_content_" + name + ".json", res.json)
        WriteAsciiFile("cachefs:/tvm_v11_content_" + name + ".json", FormatJson(res.json))
      end if
    end if
  end for
  return { ok: true }
end function

function lcProfilesStore() as Object
  data = lcReadRegJson("localProfiles", {})
  if Type(lcAaGet(data, "profiles", invalid)) <> "roArray" then data = { activeId: "main", profiles: [] }
  if data.profiles.Count() = 0 then data.profiles.Push({ id: "main", name: "Main", hue: 220, created: lcNowIso() })
  for each p in data.profiles
    if not p.DoesExist("kind") then p.kind = "standard"
    age = 18
    if p.kind = "kids" then age = 7
    if not p.DoesExist("maxAge") then p.maxAge = age
    if not p.DoesExist("hue") then p.hue = 220
    if not p.DoesExist("avatar") then p.avatar = invalid
  end for
  return data
end function

function lcPublicProfiles(data as Object) as Object
  profiles = []
  for each p in data.profiles
    copy = {}
    for each k in p
      if k <> "pin" and k <> "pinTries" and k <> "pinUntil" then copy[k] = p[k]
    end for
    copy.locked = (lcAaGet(p, "pin", invalid) <> invalid)
    profiles.Push(copy)
  end for
  return { activeId: lcAaText(data, "activeId", "main"), profiles: profiles, ok: true }
end function

function lcFindProfile(data as Object, id as String) as Dynamic
  for each p in data.profiles
    if p.id = id then return p
  end for
  return invalid
end function

function lcPinValid(pin as String) as Boolean
  return CreateObject("roRegex", "^[0-9]{4}$", "").IsMatch(pin)
end function

function lcPinError(data as Object, p as Object, pin as String) as Dynamic
  saved = lcAaGet(p, "pin", invalid)
  if saved = invalid then return invalid
  retry = lcAaInt(p, "pinUntil", 0) - lcNowSeconds()
  if retry > 0 then return { status: 403, json: { error: "pin-cooldown", retryAfter: retry } }
  if pin = "" then return { status: 403, json: { error: "pin-required" } }
  hash = lcSha256Hex(lcAaText(saved, "salt") + ":" + pin)
  if lcPinValid(pin) and lcConstantTimeEquals(hash, lcAaText(saved, "hash"))
    p.pinTries = 0
    p.pinUntil = 0
    lcWriteRegJson("localProfiles", data)
    return invalid
  end if
  p.pinTries = lcAaInt(p, "pinTries", 0) + 1
  if p.pinTries >= 5
    p.pinUntil = lcNowSeconds() + 60
    p.pinTries = 0
    lcWriteRegJson("localProfiles", data)
    return { status: 403, json: { error: "pin-cooldown", retryAfter: 60 } }
  end if
  lcWriteRegJson("localProfiles", data)
  return { status: 403, json: { error: "pin-wrong" } }
end function

function lcSetProfileFields(p as Object, body as Object) as Boolean
  if body.DoesExist("name")
    name = lcAaText(body, "name").Trim()
    if name = "" or Len(name) > 24 then return false
    p.name = name
  end if
  if body.DoesExist("avatar") then p.avatar = lcAaGet(body, "avatar", invalid)
  if body.DoesExist("kind")
    kind = lcAaText(body, "kind")
    if kind <> "kids" and kind <> "standard" then return false
    p.kind = kind
    if kind = "kids" and not body.DoesExist("maxAge") then p.maxAge = 7
  end if
  if body.DoesExist("maxAge")
    age = lcAaInt(body, "maxAge", 18)
    if age <> 7 and age <> 12 and age <> 15 and age <> 18 then return false
    p.maxAge = age
  end if
  if body.DoesExist("pin")
    pin = lcAaText(body, "pin")
    if lcAaGet(body, "pin", invalid) = invalid
      p.pin = invalid
    else
      if not lcPinValid(pin) then return false
      salt = Left(lcNewToken(), 32)
      p.pin = { salt: salt, hash: lcSha256Hex(salt + ":" + pin), kdf: "salted-sha256" }
    end if
  end if
  return true
end function

function lcUpdateProfile(ctx as Object) as Object
  data = lcProfilesStore()
  p = lcFindProfile(data, lcAaText(ctx.body, "id"))
  if p = invalid then return { status: 404, json: { error: "Profile not found." } }
  err = lcPinError(data, p, lcAaText(ctx.body, "currentPin"))
  if err <> invalid then return err
  if lcAaText(p, "kind") = "kids" and lcAaText(ctx.body, "kind", "kids") = "standard"
    adult = invalid
    for each candidate in data.profiles
      if candidate.kind = "standard" and lcAaGet(candidate, "pin", invalid) <> invalid
        adult = candidate
        exit for
      end if
    end for
    requested = lcFindProfile(data, lcAaText(ctx.body, "adultId"))
    if requested <> invalid
      if requested.kind = "standard" and lcAaGet(requested, "pin", invalid) <> invalid then adult = requested
    end if
    if adult <> invalid
      err = lcPinError(data, adult, lcAaText(ctx.body, "adultPin"))
      if err <> invalid
        err.json.adultRequired = true
        return err
      end if
    end if
  end if
  if not lcSetProfileFields(p, ctx.body) then return { status: 400, json: { error: "Check the profile name, age limit and four-digit PIN." } }
  lcWriteRegJson("localProfiles", data)
  return { status: 200, json: lcPublicProfiles(data) }
end function

function lcProfileLevel(ctx as Object) as Object
  data = lcProfilesStore()
  id = lcAaText(ctx, "profileId", lcAaText(data, "activeId", "main"))
  if id = "" then id = lcAaText(data, "activeId", "main")
  p = lcFindProfile(data, id)
  age = lcAaInt(p, "maxAge", 18)
  if ctx.DoesExist("maxAge") then age = ctx.maxAge
  for each level in lcAaGet(lcContent("parental"), "levels", [])
    if lcAaInt(level, "maxAge", 18) = age then return level
  end for
  return { maxAge: 18, block: [], liveGroups: invalid }
end function

function lcIncludes(items as Dynamic, needle as String) as Boolean
  if Type(items) <> "roArray" then return false
  for each item in items
    if LCase(item) = LCase(needle) then return true
  end for
  return false
end function

function lcAllowed(item as Object, level as Object) as Boolean
  if lcAaInt(level, "maxAge", 18) = 18 then return true
  if lcAaText(item, "kind") = "live" or Left(lcAaText(item, "id"), 5) = "live:"
    groups = lcAaGet(level, "liveGroups", invalid)
    return groups = invalid or lcIncludes(groups, lcAaText(item, "group"))
  end if
  genres = lcAaGet(item, "genres", [])
  if Type(genres) <> "roArray" or genres.Count() = 0 then return false
  allowed = lcAaGet(level, "allow", invalid) = invalid
  for each genre in genres
    if lcIncludes(level.block, genre) then return false
    if lcIncludes(lcAaGet(level, "allow", []), genre) then allowed = true
  end for
  return allowed
end function

function lcFilterItems(items as Dynamic, ctx as Object) as Object
  out = []
  if Type(items) <> "roArray" then return out
  level = lcProfileLevel(ctx)
  for each item in items
    if lcAllowed(item, level) then out.Push(item)
  end for
  return out
end function

function lcFilterResponse(res as Object, ctx as Object) as Object
  if lcAaInt(res, "status", 200) >= 400 then return res
  data = res.json
  if ctx.path = "/api/media"
    if not lcAllowed(data, lcProfileLevel(ctx)) then return { status: 403, json: { error: "Hidden by this profile's age limit. Filters by genre." } }
  end if
  for each key in ["items", "trending", "continueWatching", "watchlist", "channels"]
    if data.DoesExist(key) then data[key] = lcFilterItems(data[key], ctx)
  end for
  for each key in ["hero", "featured"]
    item = lcAaGet(data, key, invalid)
    if item <> invalid
      if not lcAllowed(item, lcProfileLevel(ctx)) then data[key] = invalid
    end if
  end for
  for each rail in lcAaGet(data, "rails", [])
    rail.items = lcFilterItems(rail.items, ctx)
  end for
  return res
end function

function lcFreeChannels(ctx as Object) as Object
  out = []
  for each ch in lcAaGet(lcContent("free-channels"), "channels", [])
    out.Push({ id: "live:free:" + ch.id, title: ch.name, name: ch.name, group: ch.group, logo: ch.logo, url: ch.url, geo: ch.geo, source: "free", epgId: lcAaText(ch, "epgId"), number: lcAaInt(ch, "number"), kind: "live", playable: true })
  end for
  return lcFilterItems(out, ctx)
end function

function lcServices(ctx as Object) as Object
  out = []
  all = lcReadRegJson("profileServices", {})
  connected = lcAaGet(all, lcActiveProfileId(ctx), {})
  for each service in lcAaGet(lcContent("services"), "services", [])
    if lcAaText(service, "roku") <> ""
      service.connected = lcAaBool(connected, service.id, false)
      out.Push(service)
    end if
  end for
  return { services: out }
end function

function lcLocalDate() as String
  dt = CreateObject("roDateTime")
  dt.ToLocalTime()
  return Left(dt.ToISOString(), 10)
end function

function lcActiveEvents(ctx as Object) as Object
  out = []
  today = lcLocalDate()
  for each event in lcAaGet(lcContent("events"), "events", [])
    if today >= event.start and today <= event.end
      event.live = true
      event.released = today >= event.release
      event.kicker = "In cinemas now"
      if not event.released
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        month = Int(Val(Mid(event.release, 6, 2)))
        if month >= 1 and month <= 12 then event.kicker = "In cinemas " + StrI(Int(Val(Right(event.release, 2)))).Trim() + " " + months[month - 1]
      end if
      items = []
      for each id in event.rail.items
        meta = lcFetchMetaRaw(id)
        if meta <> invalid
          item = lcMetaToItem(meta)
          if item <> invalid then items.Push(item)
        end if
      end for
      event.items = lcFilterItems(items, ctx)
      hero = lcFetchMetaRaw(event.imdbId)
      if hero <> invalid
        event.hero = lcMetaToItem(hero)
        if event.hero <> invalid and event.items.Count() > 0
          if lcAllowed(event.hero, lcProfileLevel(ctx)) then out.Push(event)
        end if
      end if
    end if
  end for
  return { events: out }
end function

function lcRailSource(id as String) as Dynamic
  kind = "movie"
  sort = "top"
  genre = ""
  if id = "series" or id = "top-series" or id = "recent-tv" then kind = "series"
  if id = "top-series" or id = "top-films" then sort = "imdbRating"
  if id = "recent-tv" then sort = "last-videos"
  known = lcIncludes(["films", "series", "top-series", "top-films", "recent-tv", "for-you"], id)
  for each spec in lcGenreSpecs()
    if spec.id = id
      genre = spec.genre
      known = true
    end if
  end for
  if not known then return invalid
  return { kind: kind, sort: sort, genre: genre }
end function

function lcRailPage(ctx as Object) as Object
  id = lcAaText(ctx.query, "id")
  src = lcRailSource(id)
  if src = invalid then return { status: 404, json: { error: "Unknown row." } }
  skip = lcAaInt(ctx.query, "skip", 0)
  if skip < 0 then skip = 0
  cacheName = "tvm_rail_" + id + "_" + StrI(skip).Trim() + ".json"
  page = lcReadTmpJson(cacheName, 21600)
  if page = invalid
    args = "skip=" + StrI(skip).Trim()
    if src.genre <> "" then args = "genre=" + lcUrlEncode(src.genre) + "&" + args
    path = "/catalog/" + src.kind + "/" + src.sort + "/" + args + ".json"
    res = lcHttp("https://v3-cinemeta.strem.io" + path, "GET", "", {}, 8000)
    if not res.ok or Type(lcAaGet(res.json, "metas", invalid)) <> "roArray" then return { status: 503, json: { error: "Could not load more titles. Try the row again." } }
    raw = res.json.metas
    items = []
    consumed = 0
    for each meta in raw
      if consumed >= 40 then exit for
      consumed = consumed + 1
      item = lcMetaToItem(meta, src.kind)
      if item <> invalid then items.Push(item)
    end for
    page = { items: lcDedupeItems(items), more: raw.Count() > 0, nextSkip: skip + consumed }
    lcWriteTmpJson(cacheName, page)
  end if
  if not lcAaBool(ctx, "unfiltered") then page.items = lcFilterItems(page.items, ctx)
  return { status: 200, json: page }
end function

function lcVersionNewer(a as String, b as String) as Boolean
  aa = a.Tokenize(".") : bb = b.Tokenize(".")
  for i = 0 to 2
    av = 0 : bv = 0
    if i < aa.Count() then av = Int(Val(aa[i]))
    if i < bb.Count() then bv = Int(Val(bb[i]))
    if av <> bv then return av > bv
  end for
  return false
end function

function lcRokuUpdate() as Object
  current = CreateObject("roAppInfo").GetVersion()
  ' The update Task runs beside content refresh; keep their stamps separate.
  stamps = lcReadRegJson("rokuUpdateChecked", {})
  cached = lcReadTmpJson("tvm_roku_update.json", 21600)
  if cached = invalid then cached = ParseJson(ReadAsciiFile("cachefs:/tvm_v11_roku_update.json"))
  if cached = invalid then cached = { available: false }
  cached.current = current
  cached.available = lcVersionNewer(lcAaText(cached, "version"), current)
  if lcNowSeconds() - lcAaInt(stamps, "update", 0) < 21600 then return cached
  stamps.update = lcNowSeconds()
  lcWriteRegJson("rokuUpdateChecked", stamps)
  res = lcHttp("https://github.com/GL-327/TVM/releases/download/devices/roku.json", "GET", "", {}, 10000)
  data = cached
  if res.ok and CreateObject("roRegex", "^[0-9]+\.[0-9]+\.[0-9]+$", "").IsMatch(lcAaText(res.json, "version")) and Type(lcAaGet(lcAaGet(res.json, "notes", {}), "highlights", invalid)) = "roArray"
    data = res.json
    data.current = current
    data.available = lcVersionNewer(data.version, current)
    lcWriteTmpJson("tvm_roku_update.json", data)
    WriteAsciiFile("cachefs:/tvm_v11_roku_update.json", FormatJson(data))
  end if
  return data
end function

function lcV11Route(ctx as Object) as Dynamic
  path = ctx.path : method = ctx.method
  if Left(path, 13) = "/api/content/" and method = "GET"
    name = Mid(path, 14)
    if not lcContentNames().DoesExist(name) then return { status: 404, json: { error: "Unknown content." } }
    return { status: 200, json: lcContent(name) }
  end if
  if path = "/api/changelog" then return { status: 200, json: { current: CreateObject("roAppInfo").GetVersion(), releases: lcContent("changelog").releases } }
  if path = "/api/roku/refresh" then return { status: 200, json: lcRefreshContent() }
  if path = "/api/roku/update" then return { status: 200, json: lcRokuUpdate() }
  if path = "/api/rails/more" then return lcRailPage(ctx)
  if path = "/api/events/active" then return { status: 200, json: lcActiveEvents(ctx) }
  if path = "/api/live/free" then return { status: 200, json: { channels: lcFreeChannels(ctx) } }
  if path = "/api/roku/free-fallback" or path = "/api/roku/free-playback"
    age = lcAaInt(ctx.body, "maxAge", 7)
    if age <> 7 and age <> 12 and age <> 15 and age <> 18 then age = 7
    ctx.maxAge = age
    if path = "/api/roku/free-playback"
      for each ch in lcFreeChannels(ctx)
        if ch.id = lcAaText(ctx.body, "id") then return { status: 200, json: { kind: "stream", url: ch.url, mimeType: "application/vnd.apple.mpegurl", title: ch.title, geo: ch.geo, source: "free", startAt: 0 } }
      end for
      return { status: 404, json: { error: "This channel is unavailable for this profile." } }
    end if
    return { status: 200, json: { channels: lcFreeChannels(ctx) } }
  end if
  if path = "/api/services" then return { status: 200, json: lcServices(ctx) }
  if path = "/api/services/connected" and method = "POST"
    id = lcAaText(ctx.body, "id")
    found = false
    for each service in lcServices(ctx).services
      if service.id = id then found = true
    end for
    if not found then return { status: 404, json: { error: "Unknown service." } }
    all = lcReadRegJson("profileServices", {})
    pid = lcActiveProfileId(ctx)
    connected = lcAaGet(all, pid, {})
    connected[id] = lcAaBool(ctx.body, "connected")
    all[pid] = connected
    lcWriteRegJson("profileServices", all)
    return { status: 200, json: lcServices(ctx) }
  end if
  if path = "/api/profiles" and method = "PUT" then return lcUpdateProfile(ctx)
  if path = "/api/profiles/verify-pin"
    data = lcProfilesStore()
    p = lcFindProfile(data, lcAaText(ctx.body, "id"))
    if p = invalid then return { status: 404, json: { error: "Profile not found." } }
    err = lcPinError(data, p, lcAaText(ctx.body, "pin"))
    if err <> invalid then return err
    return { status: 200, json: { ok: true } }
  end if
  if path = "/api/roku/quality" then return { status: 200, json: lcQualityPlan(ctx.body) }
  if path = "/api/reviews" then return { status: 200, json: lcReviews(lcAaText(ctx.query, "id")) }
  if path = "/api/roku/ecp" and method = "POST"
    id = lcAaText(ctx.body, "id")
    serviceName = "the service"
    roku = ""
    for each service in lcServices(ctx).services
      if service.id = id
        roku = service.roku
        serviceName = service.name
      end if
    end for
    if roku = "" then return { status: 404, json: { error: "Unknown Roku service." } }
    url = "http://localhost:8060/launch/" + roku
    title = lcAaText(ctx.body, "title")
    if title <> "" then url = "http://localhost:8060/search/browse?keyword=" + lcUrlEncode(title) + "&launch=true"
    res = lcHttp(url, "POST", "", {}, 4000)
    if res.ok then return { status: 200, json: { ok: true } }
    return { status: 503, json: { error: "Open " + serviceName + " from your Roku home screen. To allow TVM to open channels: Settings > System > Advanced system settings > Control by mobile apps > Network access: Default or Permissive." } }
  end if
  return invalid
end function
