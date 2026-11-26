' On-device standalone Core for Roku (no PC server required).
' Uses roUrlTransfer for Cinemeta / Torrentio / Real-Debrid / TVMaze / M3U
' and roRegistrySection + tmp:/ for state and caching.

function lcHandleRequest(url as String, method as String, bodyStr as String, accountToken as String, profileId as String, requestId as String) as Object
  result = {
    ok: false
    statusCode: 500
    json: {}
    error: ""
    requestId: requestId
  }

  raw = Mid(url, 7) ' strip "local:"
  qIdx = Instr(1, raw, "?")
  path = raw
  queryStr = ""
  if qIdx > 0
    path = Left(raw, qIdx - 1)
    queryStr = Mid(raw, qIdx + 1)
  end if
  if Left(path, 1) <> "/" then path = "/" + path

  mth = UCase(method)
  if mth = "" then mth = "GET"

  reqBody = {}
  if bodyStr <> invalid and bodyStr.Trim() <> ""
    parsed = ParseJson(bodyStr)
    if parsed <> invalid and GetInterface(parsed, "ifAssociativeArray") <> invalid
      reqBody = parsed
    end if
  end if

  query = lcParseQuery(queryStr)
  ctx = {
    method: mth
    path: path
    query: query
    body: reqBody
    accountToken: accountToken.Trim()
    profileId: profileId.Trim()
  }

  lcPurgeLegacyAccounts()
  res = lcExtrasRoute(ctx)
  if res = invalid then res = lcV11Route(ctx)
  if res = invalid then res = lcRoute(ctx)
  res = lcFilterResponse(res, ctx)
  code = lcAaInt(res, "status", 200)
  payload = lcAaGet(res, "json", {})
  if payload = invalid then payload = {}
  result.statusCode = code
  result.json = payload
  if code >= 200 and code < 300
    result.ok = true
  else
    result.error = lcAaText(payload, "error", "http_" + StrI(code).Trim())
  end if
  return result
end function

function lcRoute(ctx as Object) as Object
  path = ctx.path
  mth = ctx.method

  if path = "/api/health"
    return { status: 200, json: { ok: true, status: "ok", version: "standalone", standalone: true } }
  else if path = "/api/config" and mth = "GET"
    return lcGetPublicConfig(ctx)
  end if

  if path = "/api/account" and mth = "GET"
    return lcGetAccount(ctx)
  else if path = "/api/account/register" and mth = "POST"
    return lcRegisterAccount(ctx)
  else if path = "/api/account/signin" and mth = "POST"
    return lcSignInAccount(ctx)
  else if path = "/api/account/terms" and mth = "POST"
    return lcAcceptTerms(ctx)
  else if path = "/api/account/signout" and mth = "POST"
    return lcSignOut(ctx)
  else if path = "/api/account/device/start" and mth = "POST"
    return lcDeviceStart(ctx)
  else if path = "/api/account/device/poll" and mth = "POST"
    return lcDevicePoll(ctx)
  else if path = "/api/terms" and mth = "GET"
    return lcGetTerms()
  else if path = "/api/tiers" and mth = "GET"
    return lcGetTiers()
  else if path = "/api/pricing/quote" and mth = "POST"
    return lcPricingQuote(ctx)
  else if path = "/api/pricing/accept" and mth = "POST"
    return lcPricingAccept(ctx)
  else if path = "/api/account/email/verify" and mth = "POST"
    return { status: 404, json: { error: "not_supported" } }
  else if (path = "/api/account/email/send" or path = "/api/account/verify/resend") and mth = "POST"
    return lcResendVerify(ctx)
  else if path = "/api/account/password/forgot" and mth = "POST"
    return lcForgotPassword(ctx)
  else if path = "/api/profiles" and mth = "GET"
    return { status: 200, json: lcGetProfiles() }
  else if path = "/api/profiles" and mth = "POST"
    return lcCreateProfile(ctx)
  else if path = "/api/profiles/active" and mth = "POST"
    return lcActivateProfile(ctx)
  else if path = "/api/profiles/remove" and mth = "POST"
    return lcRemoveProfile(ctx)
  else if path = "/api/home" and mth = "GET"
    return { status: 200, json: lcGetHome(ctx) }
  else if path = "/api/library" and mth = "GET"
    return { status: 200, json: lcGetLibrary(ctx) }
  else if path = "/api/watchlist" and mth = "GET"
    return { status: 200, json: { items: lcGetWatchlist(lcActiveProfileId(ctx)) } }
  else if path = "/api/watchlist" and mth = "PUT"
    return lcAddWatchlist(ctx)
  else if path = "/api/watchlist/remove" and mth = "POST"
    return lcRemoveWatchlist(ctx)
  else if path = "/api/search" and mth = "GET"
    return { status: 200, json: { items: lcSearch(lcAaText(ctx.query, "q", "")) } }
  else if path = "/api/media" and mth = "GET"
    return lcGetMedia(lcAaText(ctx.query, "id", ""))
  else if path = "/api/media/children" and mth = "GET"
    return { status: 200, json: { items: lcGetChildren(lcAaText(ctx.query, "id", "")) } }
  else if Left(path, 10) = "/api/apps/" and mth = "GET"
    return { status: 200, json: lcGetServiceApp(Mid(path, 11)) }
  else if path = "/api/rd/status" and mth = "GET"
    return { status: 200, json: lcGetRdStatus(ctx) }
  else if path = "/api/rd/token" and mth = "PUT"
    return lcSetRdToken(ctx)
  else if path = "/api/live" and mth = "GET"
    return { status: 200, json: lcGetLive(ctx) }
  else if path = "/api/live" and mth = "PUT"
    return lcSaveLiveUrl(ctx)
  else if path = "/api/live/guide" and mth = "GET"
    return lcLiveGuide(ctx)
  else if path = "/api/live/catalog" and mth = "GET"
    return { status: 200, json: lcGetLiveCatalog(ctx) }
  else if path = "/api/live/picks" and mth = "POST"
    return lcToggleLivePick(ctx)
  else if path = "/api/live/picks/group" and mth = "POST"
    return lcToggleLiveGroup(ctx)
  else if path = "/api/playback/versions" and mth = "GET"
    return lcListVersions(ctx)
  else if path = "/api/playback" and mth = "POST"
    return lcPlayback(ctx)
  else if path = "/api/progress" and mth = "POST"
    return lcSaveProgress(ctx)
  else if path = "/api/update/status" and mth = "GET"
    return { status: 200, json: { current: "standalone", autoUpdate: false } }
  else if path = "/api/maintenance/clear-cache" and mth = "POST"
    lcClearCacheFiles()
    return { status: 200, json: { ok: true } }
  else if path = "/api/maintenance/factory-reset" and mth = "POST"
    lcFactoryReset()
    return { status: 200, json: { ok: true } }
  end if

  return { status: 404, json: { error: "not_found" } }
end function

' ---- Helpers ----

function lcAaGet(obj as Dynamic, key as String, fallback as Dynamic) as Dynamic
  if obj = invalid then return fallback
  if GetInterface(obj, "ifAssociativeArray") = invalid then return fallback
  if not obj.DoesExist(key) then return fallback
  val = obj[key]
  if val = invalid then return fallback
  return val
end function

function lcAaText(obj as Dynamic, key as String, fallback = "" as String) as String
  val = lcAaGet(obj, key, invalid)
  if val = invalid then return fallback
  t = Type(val)
  if t = "String" or t = "roString" then return val
  if t = "Integer" or t = "roInt" or t = "roInteger" then return StrI(val).Trim()
  if t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble" then return val.ToStr().Trim()
  return fallback
end function

function lcAaInt(obj as Dynamic, key as String, fallback = 0 as Integer) as Integer
  val = lcAaGet(obj, key, invalid)
  if val = invalid then return fallback
  t = Type(val)
  if t = "Integer" or t = "roInt" or t = "roInteger" then return val
  if t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble" then return Int(val)
  if t = "String" or t = "roString" then return Int(Val(val))
  return fallback
end function

function lcAaBool(obj as Dynamic, key as String, fallback = false as Boolean) as Boolean
  val = lcAaGet(obj, key, invalid)
  if val = invalid then return fallback
  if Type(val) = "Boolean" or Type(val) = "roBoolean" then return val
  return fallback
end function

function lcParseQuery(q as String) as Object
  out = {}
  if q = "" then return out
  xfer = CreateObject("roUrlTransfer")
  for each part in q.Tokenize("&")
    eq = Instr(1, part, "=")
    if eq > 0
      k = xfer.Unescape(Left(part, eq - 1))
      v = xfer.Unescape(Mid(part, eq + 1).Replace("+", " "))
      out[k] = v
    else
      out[xfer.Unescape(part)] = ""
    end if
  end for
  return out
end function

function lcUrlEncode(text as String) as String
  xfer = CreateObject("roUrlTransfer")
  return xfer.Escape(text)
end function

function lcNowSeconds() as Integer
  dt = CreateObject("roDateTime")
  return dt.AsSeconds()
end function

function lcNowIso() as String
  dt = CreateObject("roDateTime")
  return dt.ToISOString()
end function

function lcUuid() as String
  di = CreateObject("roDeviceInfo")
  return di.GetRandomUUID()
end function

function lcNewToken() as String
  return (lcUuid() + lcUuid()).Replace("-", "")
end function

function lcSha256Hex(text as String) as String
  ba = CreateObject("roByteArray")
  ba.FromAsciiString(text)
  dg = CreateObject("roEVPDigest")
  dg.Setup("sha256")
  dg.Update(ba)
  return LCase(dg.Final())
end function

' Profile PIN comparison (account password verification lives in the service).
function lcConstantTimeEquals(a as String, b as String) as Boolean
  if Len(a) <> Len(b) or Len(a) = 0 then return false
  diff = 0
  for i = 1 to Len(a)
    ca = Asc(Mid(a, i, 1)) : cb = Asc(Mid(b, i, 1))
    diff = diff or ((ca + cb) - 2 * (ca and cb))
  end for
  return diff = 0
end function

' ---- Registry & tmp:/ storage ----

function lcReg() as Object
  return CreateObject("roRegistrySection", "tvm")
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
  sec.Write(key, FormatJson(val))
  sec.Flush()
end sub

function lcReadTmpJson(name as String, maxAgeSeconds = 0 as Integer) as Dynamic
  path = "tmp:/" + name
  raw = ReadAsciiFile(path)
  if raw = invalid or raw = "" then return invalid
  parsed = ParseJson(raw)
  if parsed = invalid then return invalid
  if maxAgeSeconds > 0 and GetInterface(parsed, "ifAssociativeArray") <> invalid
    at = lcAaInt(parsed, "_at", 0)
    if lcNowSeconds() - at > maxAgeSeconds then return invalid
  end if
  return parsed
end function

sub lcWriteTmpJson(name as String, obj as Object)
  if GetInterface(obj, "ifAssociativeArray") <> invalid
    obj._at = lcNowSeconds()
  end if
  WriteAsciiFile("tmp:/" + name, FormatJson(obj))
end sub

sub lcClearCacheFiles()
  fs = CreateObject("roFileSystem")
  for each entry in fs.GetDirectoryListing("tmp:/")
    if Left(entry, 4) = "tvm_"
      DeleteFile("tmp:/" + entry)
    end if
  end for
end sub

sub lcFactoryReset()
  lcClearCacheFiles()
  sec = lcReg()
  for each k in ["localAccounts", "localSessions", "localProfiles", "localWatchlist", "localProgress", "localRdToken", "localLive", "accountToken"]
    if sec.Exists(k) then sec.Delete(k)
  end for
  sec.Flush()
end sub

' ---- HTTP client ----

function lcHttp(url as String, method = "GET" as String, body = "" as String, headers = {} as Object, timeoutMs = 15000 as Integer) as Object
  out = { ok: false, status: 0, body: "", json: invalid }
  xfer = CreateObject("roUrlTransfer")
  port = CreateObject("roMessagePort")
  xfer.SetPort(port)
  xfer.SetUrl(url)
  xfer.EnableEncodings(true)
  xfer.RetainBodyOnError(true)
  if LCase(Left(url, 8)) = "https://"
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
  end if
  xfer.AddHeader("User-Agent", "TVM-Roku/1.1")
  if GetInterface(headers, "ifAssociativeArray") <> invalid
    for each k in headers
      xfer.AddHeader(k, lcAaText(headers, k, ""))
    end for
  end if

  mth = UCase(method)
  sent = false
  if mth = "GET"
    sent = xfer.AsyncGetToString()
  else
    xfer.SetRequest(mth)
    sent = xfer.AsyncPostFromString(body)
  end if
  if not sent then return out

  msg = wait(timeoutMs, port)
  if msg = invalid
    xfer.AsyncCancel()
    return out
  end if
  if type(msg) <> "roUrlEvent" then return out

  code = msg.GetResponseCode()
  text = msg.GetString()
  if text = invalid then text = ""
  out.status = code
  out.body = text
  out.ok = (code >= 200 and code < 300)
  if text <> ""
    parsed = ParseJson(text)
    if parsed <> invalid then out.json = parsed
  end if
  return out
end function

' ---- Accounts & Access ----

function lcAccessDoc() as Object
  raw = ReadAsciiFile("pkg:/source/data/access.json")
  if raw <> invalid and raw <> ""
    parsed = ParseJson(raw)
    if parsed <> invalid and GetInterface(parsed, "ifAssociativeArray") <> invalid then return parsed
  end if
  return {}
end function

function lcTermsVersion() as String
  doc = lcAccessDoc()
  v = lcAaText(doc, "termsVersion", "")
  if v <> "" then return v
  return "2026-09-15"
end function

function lcGetTerms() as Object
  doc = lcAccessDoc()
  terms = lcAaGet(doc, "terms", {})
  return { status: 200, json: terms }
end function

function lcGetTiers() as Object
  doc = lcAccessDoc()
  return {
    status: 200
    json: {
      tiers: lcAaGet(doc, "tiers", [])
      route: lcAaGet(doc, "route", { headline: "Access is arranged with the app owner", detail: "There is no checkout here and nothing to buy in the app.", action: "Contact the app owner" })
      streamMonthlyPence: lcAaInt(doc, "streamMonthlyPence", 1000)
    }
  }
end function

function lcPricingQuote(ctx as Object) as Object
  if ctx.accountToken = "" then return { status: 401, json: { error: "account_required" } }
  return {
    status: 200
    json: {
      cadence: lcAaText(ctx.body, "cadence", "month")
      liveTv: lcAaBool(ctx.body, "liveTv", false)
    }
  }
end function

function lcPricingAccept(ctx as Object) as Object
  if ctx.accountToken = "" then return { status: 401, json: { error: "account_required" } }
  doc = lcAccessDoc()
  route = lcAaGet(doc, "route", {})
  return {
    status: 200
    json: {
      status: "manual_activation"
      message: lcAaText(route, "detail", "There is no checkout here and nothing to buy in the app. Ask the owner to switch your account on.")
    }
  }
end function

' ---- Profiles ----

function lcGetProfiles() as Object
  return lcPublicProfiles(lcProfilesStore())
end function

function lcActiveProfileId(ctx as Object) as String
  if ctx.profileId <> "" then return ctx.profileId
  reg = lcGetProfiles()
  return lcAaText(reg, "activeId", "main")
end function

function lcCreateProfile(ctx as Object) as Object
  name = lcAaText(ctx.body, "name", "").Trim()
  if name = "" then return { status: 400, json: { error: "Name required." } }
  data = lcProfilesStore()
  if data.profiles.Count() >= 5 then return { status: 400, json: { error: "Up to five profiles allowed." } }
  colors = ["#2F6BFF", "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B"]
  idx = data.profiles.Count() mod colors.Count()
  id = "prof_" + Left(lcNewToken(), 8)
  p = { id: id, name: name, color: colors[idx], hue: 220 + idx * 35, created: lcNowIso(), kind: "standard", maxAge: 18, avatar: invalid }
  if not lcSetProfileFields(p, ctx.body) then return { status: 400, json: { error: "Check the profile name, age limit and four-digit PIN." } }
  data.profiles.Push(p)
  data.activeId = id
  lcWriteRegJson("localProfiles", data)
  return { status: 201, json: lcPublicProfiles(data) }
end function

function lcActivateProfile(ctx as Object) as Object
  id = lcAaText(ctx.body, "id", "")
  data = lcProfilesStore()
  for each p in data.profiles
    if lcAaText(p, "id", "") = id
      err = lcPinError(data, p, lcAaText(ctx.body, "pin"))
      if err <> invalid then return err
      data.activeId = id
      lcWriteRegJson("localProfiles", data)
      return { status: 200, json: lcPublicProfiles(data) }
    end if
  end for
  return { status: 404, json: { error: "Profile not found." } }
end function

function lcRemoveProfile(ctx as Object) as Object
  id = lcAaText(ctx.body, "id", "")
  data = lcProfilesStore()
  p = lcFindProfile(data, id)
  if p = invalid then return { status: 404, json: { error: "Profile not found." } }
  err = lcPinError(data, p, lcAaText(ctx.body, "pin"))
  if err <> invalid then return err
  if data.profiles.Count() <= 1 then return { status: 400, json: { error: "Keep at least one profile." } }
  kept = []
  for each p in data.profiles
    if lcAaText(p, "id", "") <> id then kept.Push(p)
  end for
  if kept.Count() = data.profiles.Count() then return { status: 404, json: { error: "Profile not found." } }
  data.profiles = kept
  if data.activeId = id then data.activeId = lcAaText(kept[0], "id", "main")
  lcWriteRegJson("localProfiles", data)
  return { status: 200, json: lcPublicProfiles(data) }
end function

' ---- Watchlist & Progress ----

function lcGetWatchlist(pid as String) as Object
  all = lcReadRegJson("localWatchlist", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then return []
  items = lcAaGet(all, pid, [])
  if Type(items) <> "roArray" then return []
  return items
end function

function lcAddWatchlist(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  item = lcAaGet(ctx.body, "item", ctx.body)
  id = lcAaText(item, "id", "")
  if id = "" then return { status: 400, json: { error: "Missing title id." } }
  all = lcReadRegJson("localWatchlist", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then all = {}
  list = lcGetWatchlist(pid)
  out = [item]
  for each existing in list
    if lcAaText(existing, "id", "") <> id
      out.Push(existing)
      if out.Count() >= 24 then exit for
    end if
  end for
  all[pid] = out
  lcWriteRegJson("localWatchlist", all)
  return { status: 200, json: { items: out } }
end function

function lcRemoveWatchlist(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  id = lcAaText(ctx.body, "id", "")
  all = lcReadRegJson("localWatchlist", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then all = {}
  out = []
  for each existing in lcGetWatchlist(pid)
    if lcAaText(existing, "id", "") <> id then out.Push(existing)
  end for
  all[pid] = out
  lcWriteRegJson("localWatchlist", all)
  return { status: 200, json: { items: out } }
end function

function lcProgressMap(pid as String) as Object
  all = lcReadRegJson("localProgress", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then return {}
  m = lcAaGet(all, pid, {})
  if GetInterface(m, "ifAssociativeArray") = invalid then return {}
  return m
end function

function lcSaveProgress(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  id = lcAaText(ctx.body, "id", "")
  if id = "" then return { status: 400, json: { error: "Missing id." } }
  posSec = lcAaGet(ctx.body, "position", 0)
  dur = lcAaGet(ctx.body, "duration", 0)
  all = lcReadRegJson("localProgress", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then all = {}
  pm = lcProgressMap(pid)
  ratio = 0.0
  if dur > 0 then ratio = (posSec * 1.0) / (dur * 1.0)
  if ratio >= 0.92
    if pm.DoesExist(id) then pm.Delete(id)
    finAll = lcReadRegJson("localFinished", {})
    if GetInterface(finAll, "ifAssociativeArray") = invalid then finAll = {}
    finPid = lcAaGet(finAll, pid, {})
    if GetInterface(finPid, "ifAssociativeArray") = invalid then finPid = {}
    finPid[id] = true
    finAll[pid] = finPid
    lcWriteRegJson("localFinished", finAll)
  else if posSec > 5
    pm[id] = { position: posSec, duration: dur, ratio: ratio, updatedAt: lcNowSeconds() }
  end if
  ' Keep progress map bounded so registry stays small.
  keys = pm.Keys()
  if keys.Count() > 24
    oldestKey = ""
    oldestTime = 2147483647
    for each k in keys
      t = lcAaInt(pm[k], "updatedAt", 0)
      if t < oldestTime
        oldestTime = t
        oldestKey = k
      end if
    end for
    if oldestKey <> "" then pm.Delete(oldestKey)
  end if
  all[pid] = pm
  lcWriteRegJson("localProgress", all)
  return { status: 200, json: { ok: true } }
end function

' ---- Cinemeta & Fallback Catalog ----

function lcFallbackItems() as Object
  raw = ReadAsciiFile("pkg:/source/data/fallbackCatalog.json")
  if raw = invalid or raw = "" then return []
  parsed = ParseJson(raw)
  items = lcAaGet(parsed, "items", [])
  if Type(items) <> "roArray" then return []
  return items
end function

function lcMetaToItem(meta as Object, fallbackKind = "movie" as String) as Object
  if meta = invalid or GetInterface(meta, "ifAssociativeArray") = invalid then return invalid
  id = lcAaText(meta, "imdb_id", "")
  if id = "" then id = lcAaText(meta, "id", "")
  title = lcAaText(meta, "name", "")
  if title = "" then title = lcAaText(meta, "title", "")
  if id = "" or title = "" then return invalid
  kind = LCase(lcAaText(meta, "type", fallbackKind))
  if kind <> "series" then kind = "movie"
  year = lcAaInt(meta, "year", 0)
  if year = 0
    ri = lcAaText(meta, "releaseInfo", "")
    if Len(ri) >= 4 then year = Int(Val(Left(ri, 4)))
  end if
  genres = lcAaGet(meta, "genres", [])
  if Type(genres) <> "roArray" then genres = []
  item = {
    id: id
    title: title
    kind: kind
    synopsis: lcAaText(meta, "description", lcAaText(meta, "synopsis", ""))
    poster: lcAaText(meta, "poster", "")
    backdrop: lcAaText(meta, "background", lcAaText(meta, "backdrop", ""))
    genres: genres
    rating: lcAaText(meta, "imdbRating", lcAaText(meta, "rating", ""))
    imdbRating: lcAaText(meta, "imdbRating", lcAaText(meta, "rating", ""))
    logo: lcAaText(meta, "logo", "")
    runtime: lcAaText(meta, "runtime", "")
    playable: true
  }
  if year > 0 then item.year = year
  return item
end function

function lcFetchCinemetaCatalog(path as String, kind as String, limit = 20 as Integer, timeoutMs = 8000 as Integer) as Object
  res = lcHttp("https://v3-cinemeta.strem.io" + path, "GET", "", {}, timeoutMs)
  out = []
  if not res.ok or res.json = invalid then return out
  metas = lcAaGet(res.json, "metas", [])
  if Type(metas) <> "roArray" then return out
  for each meta in metas
    item = lcMetaToItem(meta, kind)
    if item <> invalid
      out.Push(item)
      if out.Count() >= limit then exit for
    end if
  end for
  return out
end function

function lcDedupeItems(items as Object) as Object
  out = []
  seen = {}
  for each item in items
    id = lcAaText(item, "id", "")
    if id <> "" and not seen.DoesExist(id)
      seen[id] = true
      out.Push(item)
    end if
  end for
  return out
end function

function lcTakeUnused(items as Object, used as Object, limit as Integer) as Object
  out = []
  for each item in items
    id = lcAaText(item, "id", "")
    if id <> "" and not used.DoesExist(id)
      used[id] = true
      out.Push(item)
      if out.Count() >= limit then exit for
    end if
  end for
  return out
end function

function lcFilterFallbackGenre(fb as Object, genre as String) as Object
  out = []
  needle = LCase(genre)
  for each item in fb
    genres = lcAaGet(item, "genres", [])
    if Type(genres) = "roArray"
      matched = false
      for each g in genres
        gl = LCase(g)
        if gl = needle or (needle = "sci-fi" and gl = "science fiction")
          matched = true
          exit for
        end if
      end for
      if matched then out.Push(item)
    end if
  end for
  return out
end function

function lcGenreSpecs() as Object
  return [
    { id: "action", title: "Action", genre: "Action" }
    { id: "scifi", title: "Sci-Fi", genre: "Sci-Fi" }
    { id: "comedy", title: "Comedy", genre: "Comedy" }
    { id: "thriller", title: "Thriller", genre: "Thriller" }
    { id: "drama", title: "Drama", genre: "Drama" }
    { id: "crime", title: "Crime", genre: "Crime" }
    { id: "horror", title: "Horror", genre: "Horror" }
    { id: "animation", title: "Animation", genre: "Animation" }
    { id: "documentary", title: "Documentary", genre: "Documentary" }
  ]
end function

function lcFinishedMap(pid as String) as Object
  all = lcReadRegJson("localFinished", {})
  if GetInterface(all, "ifAssociativeArray") = invalid then return {}
  m = lcAaGet(all, pid, {})
  if GetInterface(m, "ifAssociativeArray") = invalid then return {}
  return m
end function

function lcProgressRatio(entry as Dynamic) as Float
  if entry = invalid then return 0.0
  if GetInterface(entry, "ifAssociativeArray") <> invalid
    r = lcAaGet(entry, "ratio", invalid)
    if r <> invalid then return r * 1.0
    position = lcAaGet(entry, "position", 0)
    dur = lcAaGet(entry, "duration", 0)
    if dur > 0 then return (position * 1.0) / (dur * 1.0)
    return 0.0
  end if
  return entry * 1.0
end function

function lcAttachProgress(items as Object, pm as Object) as Object
  out = []
  for each item in items
    id = lcAaText(item, "id", "")
    if id <> "" and pm.DoesExist(id)
      copy = {}
      for each k in item
        copy[k] = item[k]
      end for
      copy.progress = lcProgressRatio(pm[id])
      out.Push(copy)
    else
      out.Push(item)
    end if
  end for
  return out
end function

function lcCatalogBundle() as Object
  cached = lcReadTmpJson("tvm_home_cache.json", 720)
  if cached <> invalid then return cached
  rails = [] : all = []
  specs = [
    { id: "films", title: "Popular Movies" }
    { id: "series", title: "Popular Series" }
    { id: "top-films", title: "Top Rated Movies" }
    { id: "top-series", title: "Top Rated Series" }
    { id: "recent-tv", title: "Recently Updated" }
  ]
  for each genre in lcGenreSpecs()
    specs.Push(genre)
  end for
  for each spec in specs
    res = lcRailPage({ query: { id: spec.id, skip: 0 }, profileId: "", unfiltered: true })
    page = res.json
    items = lcAaGet(page, "items", [])
    more = true
    nextSkip = lcAaInt(page, "nextSkip", 0)
    if res.status = 200 then more = lcAaBool(page, "more", false)
    if items.Count() = 0 and res.status <> 200
      fb = lcFallbackItems()
      if spec.DoesExist("genre") then fb = lcFilterFallbackGenre(fb, spec.genre)
      items = fb
    end if
    rails.Push({ id: spec.id, title: spec.title, items: items, more: more, nextSkip: nextSkip })
    all.Append(items)
  end for
  all = lcDedupeItems(all)
  trending = []
  for each item in all
    if lcAaText(item, "backdrop") <> "" then trending.Push(item)
    if trending.Count() >= 6 then exit for
  end for
  bundle = { trending: trending, rails: rails, all: all }
  if trending.Count() > 0 then bundle.featured = trending[0]
  lcWriteTmpJson("tvm_home_cache.json", bundle)
  return bundle
end function

function lcGetHome(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  pm = lcProgressMap(pid)
  wl = lcGetWatchlist(pid)
  bundle = lcCatalogBundle()

  cw = []
  all = lcAaGet(bundle, "all", [])
  byId = {}
  for each item in all
    byId[lcAaText(item, "id", "")] = item
  end for
  for each item in wl
    byId[lcAaText(item, "id", "")] = item
  end for
  for each id in pm.Keys()
    baseId = id
    colon = Instr(1, id, ":")
    if colon > 0 then baseId = Left(id, colon - 1)
    if byId.DoesExist(baseId)
      src = byId[baseId]
      copy = {}
      for each k in src
        copy[k] = src[k]
      end for
      copy.id = id
      copy.progress = lcProgressRatio(pm[id])
      cw.Push(copy)
    end if
  end for

  rails = []
  for each r in lcAaGet(bundle, "rails", [])
    rails.Push({ id: r.id, title: r.title, items: lcAttachProgress(r.items, pm), more: lcAaBool(r, "more"), nextSkip: lcAaInt(r, "nextSkip", r.items.Count()) })
  end for

  return {
    featured: lcAaGet(bundle, "featured", invalid)
    trending: lcAaGet(bundle, "trending", [])
    continueWatching: cw
    watchlist: lcAttachProgress(wl, pm)
    rails: rails
  }
end function

function lcGetLibrary(ctx as Object) as Object
  bundle = lcCatalogBundle()
  return { items: lcAaGet(bundle, "all", []) }
end function

function lcSearch(query as String) as Object
  q = query.Trim()
  if Len(q) < 2 then return []
  enc = lcUrlEncode(q)
  movies = lcFetchCinemetaCatalog("/catalog/movie/top/search=" + enc + ".json", "movie", 12)
  series = lcFetchCinemetaCatalog("/catalog/series/top/search=" + enc + ".json", "series", 12)
  combined = []
  for each item in movies
    combined.Push(item)
  end for
  for each item in series
    combined.Push(item)
  end for
  if combined.Count() = 0
    needle = LCase(q)
    for each fb in lcFallbackItems()
      if Instr(1, LCase(lcAaText(fb, "title", "")), needle) > 0
        combined.Push(fb)
      end if
    end for
  end if
  return lcDedupeItems(combined)
end function

function lcFetchMetaRaw(id as String) as Object
  base = id
  colon = Instr(1, id, ":")
  if colon > 0 then base = Left(id, colon - 1)
  if Left(LCase(base), 2) <> "tt" then return invalid

  cached = lcReadTmpJson("tvm_meta_" + base + ".json", 3600)
  if cached <> invalid then return cached

  for each kind in ["movie", "series"]
    res = lcHttp("https://v3-cinemeta.strem.io/meta/" + kind + "/" + base + ".json", "GET", "", {}, 8000)
    if res.ok and res.json <> invalid
      meta = lcAaGet(res.json, "meta", invalid)
      if meta <> invalid and lcAaText(meta, "name", "") <> ""
        lcWriteTmpJson("tvm_meta_" + base + ".json", meta)
        return meta
      end if
    end if
  end for
  return invalid
end function

function lcGetMedia(id as String) as Object
  meta = lcFetchMetaRaw(id)
  if meta <> invalid
    item = lcMetaToItem(meta, "movie")
    if item <> invalid then return { status: 200, json: item }
  end if
  for each fb in lcFallbackItems()
    if lcAaText(fb, "id", "") = id then return { status: 200, json: fb }
  end for
  return { status: 404, json: { error: "Not found" } }
end function

function lcGetChildren(id as String) as Object
  meta = lcFetchMetaRaw(id)
  if meta = invalid then return []
  videos = lcAaGet(meta, "videos", [])
  if Type(videos) <> "roArray" then return []
  pid = lcActiveProfileId({ profileId: m.top.profileId })
  pm = lcProgressMap(pid)
  fin = lcFinishedMap(pid)
  showTitle = lcAaText(meta, "name", "")
  backdrop = lcAaText(meta, "background", "")
  poster = lcAaText(meta, "poster", "")
  out = []
  for each v in videos
    s = lcAaInt(v, "season", 0)
    e = lcAaInt(v, "episode", 0)
    if s > 0 and e > 0
      epTitle = lcAaText(v, "title", lcAaText(v, "name", "Episode " + StrI(e).Trim()))
      epId = lcAaText(v, "id", id + ":" + StrI(s).Trim() + ":" + StrI(e).Trim())
      thumb = lcAaText(v, "thumbnail", backdrop)
      if thumb = "" then thumb = poster
      row = {
        id: epId
        title: epTitle
        episodeName: epTitle
        showTitle: showTitle
        kind: "series"
        genres: lcAaGet(meta, "genres", [])
        season: s
        episode: e
        synopsis: lcAaText(v, "overview", "")
        poster: thumb
        backdrop: thumb
        aired: lcAaText(v, "released", "")
        playable: true
      }
      if pm.DoesExist(epId) then row.progress = lcProgressRatio(pm[epId])
      if fin.DoesExist(epId) then row.watched = true
      out.Push(row)
    end if
  end for
  return out
end function

function lcGetServiceApp(appId as String) as Object
  bundle = lcCatalogBundle()
  all = lcAaGet(bundle, "all", [])
  subset = []
  for each item in all
    subset.Push(item)
    if subset.Count() >= 12 then exit for
  end for
  hero = invalid
  if subset.Count() > 0 then hero = subset[0]
  return {
    appId: appId
    hero: hero
    continueWatching: []
    rails: [{ id: "originals", title: "Featured", items: subset }]
  }
end function

' ---- Real-Debrid ----

function lcRdTokenInfo(ctx as Object) as Object
  ' Read the account key live. A missing key must never survive the request.
  if lcAaText(ctx, "accountToken") = "" then return { token: "", source: "none" }
  res = lcAccountsHttp(ctx, "/v1/me/rd-token")
  if res.ok then return { token: lcAaText(res.json, "token"), source: "account" }
  return { token: "", source: "none" }
end function

function lcRdToken(ctx as Object) as String
  return lcRdTokenInfo(ctx).token
end function

function lcRdRequest(token as String, path as String, method = "GET" as String, form = "" as String) as Object
  headers = {
    "Authorization": "Bearer " + token
    "Accept": "application/json"
  }
  if form <> "" then headers["Content-Type"] = "application/x-www-form-urlencoded"
  return lcHttp("https://api.real-debrid.com/rest/1.0" + path, method, form, headers, 15000)
end function

function lcGetRdStatus(ctx as Object) as Object
  info = lcRdTokenInfo(ctx)
  return lcValidateRdToken(info)
end function

function lcValidateRdToken(info as Object) as Object
  tok = info.token
  src = info.source
  if tok = "" then return { configured: false, premium: false, username: "", source: "none" }
  res = lcRdRequest(tok, "/user", "GET")
  if res.status = 401 or res.status = 403
    return { configured: true, premium: false, error: "needs-auth", source: src }
  end if
  if not res.ok or res.json = invalid
    return { configured: true, premium: false, error: "unreachable", source: src }
  end if
  return {
    configured: true
    username: lcAaText(res.json, "username", "")
    premium: (lcAaInt(res.json, "premium", 0) > 0)
    source: src
  }
end function

function lcSetRdToken(ctx as Object) as Object
  res = lcAccountsHttp(ctx, "/v1/me/rd-token", "PUT", { token: lcAaText(ctx.body, "token").Trim() })
  if not res.ok then return lcAccountsError(res)
  return { status: 200, json: lcGetRdStatus(ctx) }
end function

' ---- Live TV (M3U + DW News test channel) ----

function lcLoadLiveState() as Object
  data = lcReadRegJson("localLive", invalid)
  if data = invalid or GetInterface(data, "ifAssociativeArray") = invalid
    data = { url: "", picks: [] }
  end if
  if lcAaGet(data, "picks", invalid) = invalid then data.picks = []
  return data
end function

function lcLoadLiveChannels() as Object
  cached = lcReadTmpJson("tvm_live_channels.json", 0)
  if cached <> invalid and Type(lcAaGet(cached, "channels", invalid)) = "roArray"
    return cached.channels
  end if
  return []
end function

function lcParseM3u(text as String) as Object
  channels = []
  lines = text.Replace(chr(13), "").Tokenize(chr(10))
  curName = ""
  curGroup = ""
  curLogo = "" : curEpg = "" : curNumber = 0
  for each rawLine in lines
    line = rawLine.Trim()
    if line <> ""
      if Left(line, 7) = "#EXTINF"
        curName = ""
        curGroup = ""
        curLogo = ""
        comma = Instr(1, line, ",")
        if comma > 0 then curName = Mid(line, comma + 1).Trim()
        curGroup = lcM3uAttr(line, "group-title")
        curLogo = lcM3uAttr(line, "tvg-logo")
        curEpg = lcM3uAttr(line, "tvg-id")
        curNumber = Int(Val(lcM3uAttr(line, "tvg-chno")))
      else if Left(line, 1) <> "#"
        if Left(LCase(line), 7) = "http://" or Left(LCase(line), 8) = "https://"
          if curName = "" then curName = "Channel " + StrI(channels.Count() + 1).Trim()
          channels.Push({
            id: "live:" + Left(lcSha256Hex(line), 12)
            title: curName
            group: curGroup
            logo: curLogo
            epgId: curEpg
            number: curNumber
            source: "m3u"
            streamId: lcXtreamStreamId(line)
            url: line
            kind: "live"
            playable: true
          })
          curName = "" : curGroup = "" : curLogo = "" : curEpg = "" : curNumber = 0
          if channels.Count() >= 2000 then exit for
        end if
      end if
    end if
  end for
  return channels
end function

function lcM3uAttr(line as String, attr as String) as String
  needle = attr + "="""
  idx = Instr(1, line, needle)
  if idx = 0 then return ""
  rest = Mid(line, idx + Len(needle))
  q = Instr(1, rest, """")
  if q = 0 then return ""
  return Left(rest, q - 1)
end function

function lcGetLive(ctx as Object) as Object
  state = lcLoadLiveState()
  all = lcLoadLiveChannels()
  if all.Count() = 0 and lcAaText(state, "url", "") <> ""
    res = lcHttp(lcAaText(state, "url", ""), "GET", "", {}, 15000)
    if res.ok and res.body <> ""
      all = lcParseM3u(res.body)
      lcWriteTmpJson("tvm_live_channels.json", { channels: all })
      if not state.DoesExist("epgUrls")
        state.epgUrls = lcPlaylistGuideUrls(res.body, state.url)
        state.xtreamEpg = lcXtreamEpgUrl(state.url)
        lcWriteRegJson("localLive", state)
      end if
    end if
  end if
  picksSet = {}
  for each id in lcAaGet(state, "picks", [])
    picksSet[id] = true
  end for

  channels = lcFreeChannels(ctx)
  if lcHasLiveTv(ctx)
    channels.Push({
      id: "live:test:dw-news"
      title: "DW News (Test)"
      group: "News"
      kind: "live"
      playable: true
    })
  end if
  for each ch in all
    if picksSet.DoesExist(ch.id)
      channels.Push({
        id: ch.id
        title: ch.title
        group: ch.group
        logo: ch.logo
        kind: "live"
        playable: true
      })
    end if
  end for
  return {
    configured: (lcAaText(state, "url", "") <> "" or channels.Count() > 0)
    url: lcAaText(state, "url", "")
    channels: channels
  }
end function

function lcSaveLiveUrl(ctx as Object) as Object
  url = lcAaText(ctx.body, "url", "").Trim()
  if lcAaText(ctx.body, "server") <> ""
    server = lcAaText(ctx.body, "server").Trim()
    while Right(server, 1) = "/" : server = Left(server, Len(server) - 1) : end while
    url = server + "/get.php?username=" + lcUrlEncode(lcAaText(ctx.body, "username")) + "&password=" + lcUrlEncode(lcAaText(ctx.body, "password")) + "&type=m3u_plus&output=m3u8"
  end if
  if url = ""
    lcWriteRegJson("localLive", { url: "", picks: [] })
    DeleteFile("tmp:/tvm_live_channels.json")
    return { status: 200, json: lcGetLive(ctx) }
  end if
  if Left(LCase(url), 7) <> "http://" and Left(LCase(url), 8) <> "https://"
    return { status: 400, json: { error: "Invalid M3U URL." } }
  end if
  res = lcHttp(url, "GET", "", {}, 15000)
  if not res.ok or res.body = ""
    return { status: 400, json: { error: "Could not load that playlist." } }
  end if
  channels = lcParseM3u(res.body)
  lcWriteTmpJson("tvm_live_channels.json", { channels: channels })
  picks = []
  for each ch in channels
    picks.Push(ch.id)
    if picks.Count() >= 48 then exit for
  end for
  lcWriteRegJson("localLive", { url: url, picks: picks, epgUrls: lcPlaylistGuideUrls(res.body, url), xtreamEpg: lcXtreamEpgUrl(url) })
  return { status: 200, json: lcGetLive(ctx) }
end function

function lcGetLiveCatalog(ctx as Object) as Object
  state = lcLoadLiveState()
  all = lcFreeChannels(ctx)
  all.Append(lcLoadLiveChannels())
  all = lcFilterItems(all, ctx)
  picksSet = {}
  for each id in lcAaGet(state, "picks", [])
    picksSet[id] = true
  end for
  q = LCase(lcAaText(ctx.query, "q", "").Trim())
  grp = lcAaText(ctx.query, "group", "").Trim()
  limit = lcAaInt(ctx.query, "limit", 8)
  offset = lcAaInt(ctx.query, "offset", 0)

  groupsSeen = {}
  groups = []
  filtered = []
  for each ch in all
    g = lcAaText(ch, "group", "")
    if g <> "" and not groupsSeen.DoesExist(g)
      groupsSeen[g] = true
      groups.Push(g)
    end if
    matchGroup = (grp = "" or g = grp)
    matchQuery = (q = "" or Instr(1, LCase(ch.title), q) > 0)
    if matchGroup and matchQuery then filtered.Push(ch)
  end for

  if offset < 0 then offset = 0
  pageItems = []
  idx = offset
  while idx < filtered.Count() and pageItems.Count() < limit
    ch = filtered[idx]
    pageItems.Push({
      id: ch.id
      title: ch.title
      group: ch.group
      logo: ch.logo
      picked: picksSet.DoesExist(ch.id)
    })
    idx = idx + 1
  end while

  return {
    total: filtered.Count()
    pickedCount: lcAaGet(state, "picks", []).Count()
    limit: limit
    offset: offset
    groups: groups
    items: pageItems
  }
end function

function lcToggleLivePick(ctx as Object) as Object
  id = lcAaText(ctx.body, "id", "")
  picked = lcAaBool(ctx.body, "picked", false)
  state = lcLoadLiveState()
  picks = []
  for each existing in lcAaGet(state, "picks", [])
    if existing <> id then picks.Push(existing)
  end for
  if picked
    if picks.Count() >= 48 then return { status: 400, json: { error: "limit" } }
    picks.Push(id)
  end if
  state.picks = picks
  lcWriteRegJson("localLive", state)
  return { status: 200, json: { ok: true } }
end function

function lcToggleLiveGroup(ctx as Object) as Object
  grp = lcAaText(ctx.body, "group", "")
  picked = lcAaBool(ctx.body, "picked", true)
  state = lcLoadLiveState()
  all = lcLoadLiveChannels()
  picksSet = {}
  for each existing in lcAaGet(state, "picks", [])
    picksSet[existing] = true
  end for
  for each ch in all
    if lcAaText(ch, "group", "") = grp
      if picked
        if picksSet.Count() < 48 then picksSet[ch.id] = true
      else
        if picksSet.DoesExist(ch.id) then picksSet.Delete(ch.id)
      end if
    end if
  end for
  state.picks = picksSet.Keys()
  lcWriteRegJson("localLive", state)
  return { status: 200, json: { ok: true } }
end function

' ---- Playback ----

function lcPlayback(ctx as Object) as Object
  pid = lcActiveProfileId(ctx)
  pm = lcProgressMap(pid)
  id = lcAaText(ctx.body, "id", "")
  title = lcAaText(ctx.body, "title", "Stream")
  link = lcAaText(ctx.body, "link", "").Trim()

  startAt = 0
  if id <> "" and pm.DoesExist(id)
    startAt = lcAaGet(pm[id], "position", 0)
  end if

  ' Reject blocked titles even if an old card or remote command supplied the id.
  if Left(id, 2) = "tt" and lcProfileLevel(ctx).maxAge < 18
    media = lcGetMedia(id)
    if media.status <> 200 then return { status: 403, json: { error: "Title unavailable for this profile." } }
    if not lcAllowed(media.json, lcProfileLevel(ctx)) then return { status: 403, json: { error: "Hidden by this profile's age limit. Filters by genre." } }
  end if
  if lcProfileLevel(ctx).maxAge < 18 and link <> "" then return { status: 403, json: { error: "Direct links are unavailable on age-limited profiles." } }
  for each ch in lcFreeChannels(ctx)
    if ch.id = id then return { status: 200, json: { kind: "stream", url: ch.url, mimeType: "application/vnd.apple.mpegurl", title: ch.title, geo: ch.geo, source: "free", startAt: 0 } }
  end for
  ' Live TV
  if Left(id, 5) = "live:"
    if id = "live:test:dw-news" and lcHasLiveTv(ctx)
      return {
        status: 200
        json: {
          kind: "stream"
          url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8"
          mimeType: "application/vnd.apple.mpegurl"
          title: "DW News"
          startAt: 0
        }
      }
    end if
    for each ch in lcFilterItems(lcLoadLiveChannels(), ctx)
      if ch.id = id
        return { status: 200, json: { kind: "stream", url: ch.url, mimeType: "application/vnd.apple.mpegurl", title: ch.title, startAt: 0 } }
      end if
    end for
    return { status: 404, json: { kind: "unavailable", reason: "empty" } }
  end if

  info = lcRdTokenInfo(ctx)
  tok = info.token

  ' Direct link
  if link <> ""
    if tok <> "" and Instr(1, LCase(link), "real-debrid.com") > 0
      unr = lcRdRequest(tok, "/unrestrict/link", "POST", "link=" + lcUrlEncode(link))
      if unr.ok and unr.json <> invalid
        dl = lcAaText(unr.json, "download", "")
        if dl <> ""
          return {
            status: 200
            json: {
              kind: "stream"
              url: dl
              mimeType: lcAaText(unr.json, "mimeType", "video/mp4")
              title: lcAaText(unr.json, "filename", title)
              startAt: startAt
            }
          }
        end if
      end if
    end if
    return { status: 200, json: { kind: "stream", url: link, mimeType: "video/mp4", title: title, startAt: startAt } }
  end if

  if tok = ""
    return { status: 409, json: { kind: "unavailable", reason: "not-configured" } }
  end if

  st = lcValidateRdToken(info)
  if lcAaText(st, "error") = "needs-auth"
    return { status: 409, json: { kind: "unavailable", reason: "needs-auth" } }
  end if
  prefs = lcExtrasPrefs(ctx)
  manual = lcAaInt(ctx.body, "quality", 0)
  if manual > 0 then prefs.quality = StrI(manual).Trim()
  request = lcPlaybackSelection(ctx.body, tok, prefs, lcAaGet(ctx.body, "client", {}))
  versions = []
  requested = lcAaText(ctx.body, "versionId")
  for each row in request.rows
    versions.Push(row.version)
  end for
  tried = 0
  for each row in request.rows
    if tried >= 4 then exit for
    version = row.version
    if requested = "" or requested = version.id
      tried = tried + 1
      hash = lcStreamHash(row.stream)
      idx = invalid
      if hash.index >= 0 then idx = hash.index
      dl = lcResolveMagnetViaRd(tok, hash.hash, idx)
      if dl <> invalid
        audio = lcAaText(prefs, "audioLanguage", "original")
        if audio = "original" then audio = request.original
        return { status: 200, json: {
          kind: "stream", url: dl.download, mimeType: dl.mimeType, title: title, startAt: startAt
          resolution: version.height, version: version, versions: versions
          originalLanguage: request.original, audioLanguage: audio, audioLanguages: version.languages
          subtitleMode: lcAaText(prefs, "subtitleMode", "foreign")
        } }
      end if
    end if
  end for
  return { status: 409, json: { kind: "unavailable", reason: "not-in-library" } }
end function

function lcListVersions(ctx as Object) as Object
  id = lcAaText(ctx.query, "id")
  token = lcRdToken(ctx)
  if token = "" then return { status: 200, json: { versions: [], originalLanguage: invalid } }
  if lcProfileLevel(ctx).maxAge < 18
    media = lcGetMedia(id.Split(":")[0])
    if media.status <> 200 or not lcAllowed(media.json, lcProfileLevel(ctx)) then return { status: 403, json: { error: "Title unavailable for this profile." } }
  end if
  request = lcPlaybackSelection(ctx.query, token, lcExtrasPrefs(ctx), { maxHeight: lcScreenHeight(), player: "roku" })
  versions = []
  for each row in request.rows
    versions.Push(row.version)
  end for
  return { status: 200, json: { versions: versions, originalLanguage: request.original } }
end function

function lcResolveOriginalLanguage(meta as Object) as String
  raw = lcAaText(meta, "original_language", lcAaText(meta, "originalLanguage", lcAaText(meta, "language")))
  if raw <> ""
    first = raw.Split(",")[0].Trim()
    code = lcLanguage(first)
    if code <> "" then return code
  end if
  tmdb = lcAaText(meta, "moviedb_id", lcAaText(meta, "tmdb_id"))
  if tmdb <> "" and Val(tmdb) > 0
    kind = "movie"
    if LCase(lcAaText(meta, "type")) = "series" then kind = "tv"
    cacheKey = "origlang_" + kind + "_" + tmdb
    cached = lcExtrasCache(cacheKey)
    if cached <> invalid then return lcAaText(cached, "lang")
    res = lcHttp("https://www.themoviedb.org/" + kind + "/" + tmdb + "?language=en-US", "GET", "", {}, 2500)
    if res.ok and res.body <> ""
      match = CreateObject("roRegex", "Original Language</bdi>\s*</strong>\s*([^<]+)", "i").Match(res.body)
      if match.Count() > 1
        code = lcLanguage(match[1].Trim())
        if code <> ""
          lcExtrasRemember(cacheKey, { lang: code }, 86400 * 7)
          return code
        end if
      end if
    end if
  end if
  return ""
end function

function lcEpisodeRuntimeText(meta as Object, season as Integer, episode as Integer) as String
  if meta = invalid or season < 0 or episode < 0 then return ""
  videos = lcAaGet(meta, "videos", [])
  if Type(videos) <> "roArray" then return ""
  for each v in videos
    if lcAaInt(v, "season", -1) = season and lcAaInt(v, "episode", -1) = episode
      rt = lcAaText(v, "runtime")
      if rt <> "" then return rt
    end if
  end for
  return ""
end function

function lcPlaybackSelection(args as Object, token as String, prefs as Object, client as Object) as Object
  id = lcAaText(args, "id")
  parts = id.Split(":")
  imdb = parts[0]
  empty = { rows: [], original: "" }
  if not CreateObject("roRegex", "^tt[0-9]{5,12}$", "").IsMatch(imdb) then return empty
  season = lcAaInt(args, "season", -1)
  episode = lcAaInt(args, "episode", -1)
  if parts.Count() >= 3 and season < 0
    season = Int(Val(parts[1])) : episode = Int(Val(parts[2]))
  end if
  meta = lcFetchMetaRaw(imdb)
  if LCase(lcAaText(meta, "type")) = "series" and (season < 0 or episode < 0)
    videos = lcAaGet(meta, "videos", [])
    if Type(videos) = "roArray"
      for each v in videos
        s = lcAaInt(v, "season", 0) : e = lcAaInt(v, "episode", 0)
        if s > 0 and e > 0
          season = s : episode = e : exit for
        end if
      end for
    end if
  end if
  path = "/stream/movie/" + imdb + ".json"
  if season >= 0 and episode >= 0 then path = "/stream/series/" + imdb + ":" + StrI(season).Trim() + ":" + StrI(episode).Trim() + ".json"
  ' VOD copies are un-restricted into the original RD download in lcPlayback.
  result = lcHttp("https://torrentio.strem.fun/realdebrid=" + lcUrlEncode(token) + path, "GET", "", {}, 12000)
  if not result.ok then return empty
  streams = lcAaGet(result.json, "streams", [])
  if Type(streams) <> "roArray" or streams.Count() = 0 then return empty
  original = lcResolveOriginalLanguage(meta)
  epRuntime = lcEpisodeRuntimeText(meta, season, episode)
  runtimeText = epRuntime
  if runtimeText = "" then runtimeText = lcAaText(meta, "runtime")
  runtime = lcRuntimeSeconds(runtimeText, 0)
  if season >= 0 and runtime <= 0 then runtime = 0
  return { rows: lcRankVersions(streams, original, runtime, prefs, client), original: original }
end function

function lcResolveMagnetViaRd(token as String, infoHash as String, fileIdx as Dynamic) as Object
  magnet = "magnet:?xt=urn:btih:" + infoHash
  addRes = lcRdRequest(token, "/torrents/addMagnet", "POST", "magnet=" + lcUrlEncode(magnet))
  if not addRes.ok or addRes.json = invalid then return invalid
  tid = lcAaText(addRes.json, "id", "")
  if tid = "" then return invalid

  links = []
  for attempt = 1 to 6
    infoRes = lcRdRequest(token, "/torrents/info/" + tid, "GET")
    if infoRes.ok and infoRes.json <> invalid
      st = lcAaText(infoRes.json, "status", "")
      if st = "waiting_files_selection"
        sel = ""
        files = lcAaGet(infoRes.json, "files", [])
        if fileIdx <> invalid
          idxNum = Int(fileIdx)
          if Type(files) = "roArray" and idxNum >= 0 and idxNum < files.Count()
            sel = StrI(lcAaInt(files[idxNum], "id", 1)).Trim()
          end if
        end if
        if sel = "" and Type(files) = "roArray"
          largest = 0
          for each file in files
            path = LCase(lcAaText(file, "path"))
            size = lcAaGet(file, "bytes", 0)
            if size > largest and (Right(path, 4) = ".mkv" or Right(path, 4) = ".mp4" or Right(path, 4) = ".m4v")
              largest = size : sel = StrI(lcAaInt(file, "id")).Trim()
            end if
          end for
        end if
        if sel = "" then exit for
        lcRdRequest(token, "/torrents/selectFiles/" + tid, "POST", "files=" + lcUrlEncode(sel))
      else if st = "downloaded"
        links = lcAaGet(infoRes.json, "links", [])
        if Type(links) = "roArray" and links.Count() > 0 then exit for
      else if st = "error" or st = "virus" or st = "dead"
        exit for
      end if
    end if
    sleep(400)
  end for

  if Type(links) <> "roArray" or links.Count() = 0
    lcRdRequest(token, "/torrents/delete/" + tid, "DELETE")
    return invalid
  end if

  linkToUse = ""
  if Type(links[0]) = "String" or Type(links[0]) = "roString" then linkToUse = links[0]
  if linkToUse = "" then return invalid

  unr = lcRdRequest(token, "/unrestrict/link", "POST", "link=" + lcUrlEncode(linkToUse))
  if not unr.ok or unr.json = invalid then return invalid
  dl = lcAaText(unr.json, "download", "")
  if dl = "" then return invalid
  return {
    download: dl
    mimeType: lcAaText(unr.json, "mimeType", "video/mp4")
  }
end function
