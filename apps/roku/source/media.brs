function asText(value as Dynamic) as String
  if value = invalid then return ""
  valueType = Type(value)
  if valueType = "roString" or valueType = "String" then return value
  if valueType = "Integer" or valueType = "roInt" or valueType = "roInteger" then return StrI(value).Trim()
  if valueType = "Float" or valueType = "roFloat" or valueType = "Double" or valueType = "roDouble"
    return StrI(Int(value)).Trim()
  end if
  return ""
end function

function aaGet(obj as Object, key as String, fallback as Dynamic) as Dynamic
  if obj = invalid then return fallback
  if GetInterface(obj, "ifAssociativeArray") = invalid then return fallback
  if not obj.DoesExist(key) then return fallback
  value = obj[key]
  if value = invalid then return fallback
  return value
end function

function isMediaItem(item as Object) as Boolean
  if item = invalid then return false
  if GetInterface(item, "ifAssociativeArray") = invalid then return false
  title = aaGet(item, "title", "")
  return title <> ""
end function

function clipItems(items as Object, limit as Integer) as Object
  out = []
  if items = invalid then return out
  i = 0
  while i < items.Count() and i < limit
    out.Push(items[i])
    i = i + 1
  end while
  return out
end function

function homeHero(payload as Object) as Object
  if payload = invalid then return invalid
  featured = aaGet(payload, "featured", invalid)
  if isMediaItem(featured) then return featured

  watching = aaGet(payload, "continueWatching", [])
  if watching <> invalid and watching.Count() > 0 and isMediaItem(watching[0]) then return watching[0]

  rails = aaGet(payload, "rails", [])
  if rails <> invalid
    for each rail in rails
      items = aaGet(rail, "items", [])
      if items <> invalid and items.Count() > 0 and isMediaItem(items[0]) then return items[0]
    end for
  end if

  return invalid
end function

function homeContentRails(payload as Object) as Object
  rails = []
  if payload = invalid then return rails

  watching = aaGet(payload, "continueWatching", [])
  if watching <> invalid and watching.Count() > 0
    rails.Push({ id: "continue", title: "Continue watching", items: clipItems(watching, 16) })
  end if

  watchlist = aaGet(payload, "watchlist", [])
  if watchlist <> invalid and watchlist.Count() > 0
    rails.Push({ id: "watchlist", title: "Watchlist", items: clipItems(watchlist, 16) })
  end if

  incoming = aaGet(payload, "rails", [])
  if incoming <> invalid
    for each rail in incoming
      items = aaGet(rail, "items", [])
      if items <> invalid and items.Count() > 0
        rails.Push({
          id: aaGet(rail, "id", "rail")
          title: aaGet(rail, "title", "Titles")
          items: clipItems(items, 16)
        })
      end if
      if rails.Count() >= 8 then exit for
    end for
  end if

  return rails
end function

function homeIsEmpty(payload as Object) as Boolean
  if isMediaItem(homeHero(payload)) then return false
  return homeContentRails(payload).Count() = 0
end function

function homeHeroes(payload as Object) as Object
  out = []
  if payload = invalid then return out
  candidates = []
  featured = aaGet(payload, "featured", invalid)
  if isMediaItem(featured) then candidates.Push(featured)
  watching = aaGet(payload, "continueWatching", [])
  if watching <> invalid
    for each item in watching
      if isMediaItem(item) then candidates.Push(item)
    end for
  end if
  rails = aaGet(payload, "rails", [])
  if rails <> invalid
    for each rail in rails
      items = aaGet(rail, "items", [])
      if items <> invalid
        for each item in items
          if isMediaItem(item) then candidates.Push(item)
        end for
      end if
    end for
  end if

  seen = {}
  for each item in candidates
    id = asText(aaGet(item, "id", ""))
    titleKey = LCase(asText(aaGet(item, "title", "")))
    key = id
    if key = "" then key = titleKey
    skip = false
    if key = "" then skip = true
    if skip = false and seen.DoesExist(key) then skip = true
    if skip = false and titleKey <> "" and seen.DoesExist(titleKey) then skip = true
    if skip = false
      seen[key] = true
      if titleKey <> "" then seen[titleKey] = true
      out.Push(item)
      if out.Count() >= 4 then exit for
    end if
  end for
  return out
end function

function watchSourceLabel(item as Object) as String
  if not isMediaItem(item) then return "tvm"
  id = asText(aaGet(item, "id", ""))
  playable = aaGet(item, "playable", false)
  if Left(id, 2) = "tt" or Left(id, 3) = "rd:" or playable = true then return "tvm stream"
  network = asText(aaGet(item, "network", ""))
  if network <> "" then return LCase(network)
  return "tvm"
end function

function imdbScoreText(rating as String) as String
  trimmed = rating.Trim()
  if trimmed = "" then return ""
  value = Val(trimmed)
  if value <= 0 or value > 10 then return ""
  dot = Instr(1, trimmed, ".")
  if dot = 0
    if Len(trimmed) > 2 then return ""
    return trimmed
  end if
  if dot > 3 then return ""
  return trimmed
end function

function certificateText(rating as String) as String
  trimmed = rating.Trim()
  if trimmed = "" then return ""
  if imdbScoreText(trimmed) <> "" then return ""
  return trimmed
end function

function hasProgress(item as Object) as Boolean
  if item = invalid then return false
  progress = aaGet(item, "progress", invalid)
  return progress <> invalid
end function

function aaArray(obj as Object, key as String) as Object
  value = aaGet(obj, key, [])
  if value = invalid then return []
  return value
end function

function streamFormatFor(url as String, mimeType as String) as String
  combined = LCase(url + " " + mimeType)
  if combined.Instr("m3u8") > 0 or combined.Instr("mpegurl") > 0 then return "hls"
  if combined.Instr("mpd") > 0 or combined.Instr("dash") > 0 then return "dash"
  if combined.Instr("mkv") > 0 then return "mkv"
  return "mp4"
end function

function itemsFromJson(json as Object) as Object
  return clipItems(aaArray(json, "items"), 24)
end function

function watchlistBody(item as Object) as String
  slim = {}
  slim.id = asText(aaGet(item, "id", ""))
  slim.title = aaGet(item, "title", "")
  slim.kind = aaGet(item, "kind", "movie")
  year = aaGet(item, "year", invalid)
  if year <> invalid then slim.year = year
  synopsis = asText(aaGet(item, "synopsis", ""))
  if Len(synopsis) > 800 then synopsis = Left(synopsis, 800)
  slim.synopsis = synopsis
  slim.poster = asText(aaGet(item, "poster", ""))
  slim.backdrop = asText(aaGet(item, "backdrop", ""))
  slim.rating = asText(aaGet(item, "rating", ""))
  slim.playable = aaGet(item, "playable", false)
  hue = aaGet(item, "hue", invalid)
  if hue <> invalid then slim.hue = hue
  payload = {}
  payload.item = slim
  return FormatJson(payload)
end function

function isHttpUrl(value as String) as Boolean
  u = LCase(value.Trim())
  return Left(u, 7) = "http://" or Left(u, 8) = "https://"
end function

function playbackBody(item as Object) as String
  body = {}
  id = asText(aaGet(item, "id", ""))
  if id <> "" then body.id = id
  title = asText(aaGet(item, "title", ""))
  if title = "" then title = asText(aaGet(item, "name", ""))
  if title <> "" then body.title = title
  season = aaGet(item, "season", invalid)
  if season <> invalid then body.season = season
  episode = aaGet(item, "episode", invalid)
  if episode <> invalid then body.episode = episode
  link = asText(aaGet(item, "link", ""))
  if link = "" and Left(id, 5) <> "live:"
    maybeUrl = asText(aaGet(item, "url", ""))
    if isHttpUrl(maybeUrl) then link = maybeUrl
  end if
  if link <> "" then body.link = link
  return FormatJson(body)
end function

function upgradeArtUrl(url as String, kind as String) as String
  if url = "" then return url
  nextUrl = url
  nextUrl = nextUrl.Replace("/poster/small/", "/poster/large/")
  nextUrl = nextUrl.Replace("/poster/medium/", "/poster/large/")
  nextUrl = nextUrl.Replace("/background/small/", "/background/large/")
  nextUrl = nextUrl.Replace("/background/medium/", "/background/large/")
  if kind = "backdrop"
    nextUrl = nextUrl.Replace("/t/p/w300/", "/t/p/original/")
    nextUrl = nextUrl.Replace("/t/p/w500/", "/t/p/original/")
    nextUrl = nextUrl.Replace("/t/p/w780/", "/t/p/original/")
    nextUrl = nextUrl.Replace("/t/p/w1280/", "/t/p/original/")
  else
    nextUrl = nextUrl.Replace("/t/p/w154/", "/t/p/w780/")
    nextUrl = nextUrl.Replace("/t/p/w185/", "/t/p/w780/")
    nextUrl = nextUrl.Replace("/t/p/w342/", "/t/p/w780/")
    nextUrl = nextUrl.Replace("/t/p/w500/", "/t/p/w780/")
  end if
  nextUrl = nextUrl.Replace("100x100bb", "2000x2000bb")
  nextUrl = nextUrl.Replace("200x200bb", "2000x2000bb")
  nextUrl = nextUrl.Replace("600x600bb", "2000x2000bb")
  return nextUrl
end function

function preferHeroUri(item as Object) as String
  if not isMediaItem(item) then return ""
  uri = upgradeArtUrl(asText(aaGet(item, "backdrop", "")), "backdrop")
  if uri <> "" then return uri
  id = asText(aaGet(item, "id", ""))
  if Left(LCase(id), 2) = "tt"
    tt = id
    colon = Instr(1, id, ":")
    if colon > 0 then tt = Left(id, colon - 1)
    return "https://images.metahub.space/background/large/" + LCase(tt) + "/img"
  end if
  return upgradeArtUrl(asText(aaGet(item, "poster", "")), "poster")
end function

function preferPosterUri(item as Object) as String
  if not isMediaItem(item) then return ""
  uri = upgradeArtUrl(asText(aaGet(item, "poster", "")), "poster")
  if uri <> "" then return uri
  id = asText(aaGet(item, "id", ""))
  if Left(LCase(id), 2) = "tt"
    tt = id
    colon = Instr(1, id, ":")
    if colon > 0 then tt = Left(id, colon - 1)
    return "https://images.metahub.space/poster/large/" + LCase(tt) + "/img"
  end if
  return upgradeArtUrl(asText(aaGet(item, "backdrop", "")), "backdrop")
end function

function tvmRibbonSpec() as Object
  return [
    { id: "profile", label: "Profile", action: "profile", kind: "icon", icon: "pkg:/images/icons/profile.png" }
    { id: "inputs", label: "Inputs", action: "inputs", kind: "icon", icon: "pkg:/images/icons/inputs.png" }
    { id: "search", label: "Search", action: "search", kind: "icon", icon: "pkg:/images/icons/search.png" }
    { id: "home", label: "Home", action: "home", kind: "icon", icon: "pkg:/images/icons/home.png" }
    { id: "live", label: "Live TV", action: "live", kind: "icon", icon: "pkg:/images/icons/live.png" }
    { id: "watchlist", label: "Watchlist", action: "watchlist", kind: "icon", icon: "pkg:/images/icons/watchlist.png" }
    { id: "library", label: "TVM Stream", action: "stream", kind: "app", appId: "tvm-stream" }
    { id: "app-netflix", label: "Netflix", action: "service", kind: "app", appId: "netflix" }
    { id: "app-prime", label: "Prime Video", action: "service", kind: "app", appId: "prime" }
    { id: "app-max", label: "HBO Max", action: "service", kind: "app", appId: "max" }
    { id: "app-appletv", label: "Apple TV", action: "service", kind: "app", appId: "appletv" }
    { id: "app-disney", label: "Disney+", action: "service", kind: "app", appId: "disney" }
    { id: "app-hulu", label: "Hulu", action: "service", kind: "app", appId: "hulu" }
    { id: "app-peacock", label: "Peacock", action: "service", kind: "app", appId: "peacock" }
    { id: "apps", label: "Apps", action: "apps", kind: "icon", icon: "pkg:/images/icons/apps.png" }
    { id: "settings", label: "Settings", action: "settings", kind: "icon", icon: "pkg:/images/icons/settings.png" }
  ]
end function

function tvmRibbonLast() as Integer
  return tvmRibbonSpec().Count() - 1
end function

function tvmAppList() as Object
  return [
    { id: "tvm-stream", name: "TVM Stream", wordmark: "TVM", accent: "0x5B3DFFFF", tile: "pkg:/images/apps/tvm-stream.png" }
    { id: "netflix", name: "Netflix", wordmark: "NETFLIX", accent: "0xE50914FF", tile: "pkg:/images/apps/netflix.png" }
    { id: "prime", name: "Prime Video", wordmark: "prime video", accent: "0x00A8E1FF", tile: "pkg:/images/apps/prime.png" }
    { id: "max", name: "HBO Max", wordmark: "max", accent: "0x002BE7FF", tile: "pkg:/images/apps/max.png" }
    { id: "appletv", name: "Apple TV", wordmark: "tv+", accent: "0x141414FF", tile: "pkg:/images/apps/appletv.png" }
    { id: "disney", name: "Disney+", wordmark: "disney+", accent: "0x113C8CFF", tile: "pkg:/images/apps/disney.png" }
    { id: "hulu", name: "Hulu", wordmark: "hulu", accent: "0x1CE783FF", tile: "pkg:/images/apps/hulu.png" }
    { id: "peacock", name: "Peacock", wordmark: "peacock", accent: "0x000000FF", tile: "pkg:/images/apps/peacock.png" }
    { id: "youtube", name: "YouTube", wordmark: "YouTube", accent: "0xFFFFFFFF", tile: "pkg:/images/apps/youtube.png" }
    { id: "freevee", name: "Freevee", wordmark: "freevee", accent: "0x111111FF", tile: "pkg:/images/apps/freevee.png" }
    { id: "iplayer", name: "BBC iPlayer", wordmark: "iPlayer", accent: "0xFF4D24FF", tile: "pkg:/images/apps/iplayer.png" }
    { id: "paramount", name: "Paramount+", wordmark: "paramount+", accent: "0x0062B4FF", tile: "pkg:/images/apps/paramount.png" }
    { id: "tubi", name: "Tubi", wordmark: "tubi", accent: "0xFA382FFF", tile: "pkg:/images/apps/tubi.png" }
    { id: "pluto", name: "Pluto TV", wordmark: "Pluto TV", accent: "0x000000FF", tile: "pkg:/images/apps/pluto.png" }
    { id: "starz", name: "Starz", wordmark: "STARZ", accent: "0x121212FF", tile: "pkg:/images/apps/starz.png" }
    { id: "fox", name: "Fox", wordmark: "FOX", accent: "0x000000FF", tile: "pkg:/images/apps/fox.png" }
  ]
end function

function tvmAppById(id as String) as Object
  apps = tvmAppList()
  for each app in apps
    if app.id = id then return app
  end for
  return invalid
end function

function seasonNumbers(items as Object) as Object
  out = []
  seen = {}
  if items = invalid then return out
  for each item in items
    season = aaGet(item, "season", invalid)
    if season <> invalid
      key = StrI(Int(season)).Trim()
      if not seen.DoesExist(key)
        seen[key] = true
        out.Push(Int(season))
      end if
    end if
  end for
  return out
end function

function episodesForSeason(items as Object, season as Integer) as Object
  out = []
  if items = invalid then return out
  for each item in items
    value = aaGet(item, "season", invalid)
    if value <> invalid and Int(value) = season then out.Push(item)
  end for
  return out
end function

function progressBody(id as String, position as Float, duration as Float) as String
  body = {}
  body.id = id
  body.position = position
  body.duration = duration
  return FormatJson(body)
end function

function playbackNotice(reason as String) as String
  if reason = "not-in-library" then return "No playable stream was found. It may not be cached on Real-Debrid yet."
  if reason = "empty" then return "Torrentio returned no streams for this title. Try another episode, or retry later."
  if reason = "unsupported" then return "This link could not be opened by Real-Debrid."
  if reason = "needs-auth" then return "Real-Debrid rejected the saved token. Open TVM Stream and paste a new one."
  if reason = "not-configured" then return "Real-Debrid is not connected. Open TVM Stream and paste a token."
  if reason = "region-blocked" then return "This title is not available here."
  if reason = "network" then return "TVM could not reach the local core. Check that the app is running, then retry."
  if reason = "internal" or reason = "internal_error" then return "Playback failed inside TVM. Retry, or check that core is running."
  if reason <> "" then return reason
  return "Playback failed inside TVM. Retry, or check that core is running."
end function
