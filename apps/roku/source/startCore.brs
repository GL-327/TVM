' Hub start page data mapping. Pure logic mirroring apps/ui/src/screens/Hub.tsx:
' a greeting, a spotlight hero from artwork, Continue watching, apps and free live
' channels. Core already filters the Home payload and the free channel list by the
' profile's age limit, so nothing here filters again.

function startGreeting(hour as Integer) as String
  if hour < 12 then return "Good morning"
  if hour < 18 then return "Good afternoon"
  return "Good evening"
end function

function startGreetingLine(hour as Integer, name as Dynamic) as String
  line = startGreeting(hour)
  if Type(name) = "roString" or Type(name) = "String"
    trimmed = name.Trim()
    if trimmed <> "" then return line + ", " + trimmed
  end if
  return line
end function

function startHasBackdrop(item as Dynamic) as Boolean
  if Type(item) <> "roAssociativeArray" then return false
  if not item.DoesExist("backdrop") then return false
  value = item.backdrop
  if Type(value) <> "roString" and Type(value) <> "String" then return false
  return value <> ""
end function

function startContinue(payload as Dynamic) as Object
  out = []
  if Type(payload) <> "roAssociativeArray" then return out
  if Type(payload.continueWatching) <> "roArray" then return out
  for each item in payload.continueWatching
    if isMediaItem(item) and out.Count() < 16 then out.Push(item)
  end for
  return out
end function

' The first of featured then every rail item that has a backdrop, else the first continue-watching item.
function startHeroItem(payload as Dynamic) as Dynamic
  if Type(payload) <> "roAssociativeArray" then return invalid
  if startHasBackdrop(payload.featured) and isMediaItem(payload.featured) then return payload.featured
  if Type(payload.rails) = "roArray"
    for each rail in payload.rails
      if Type(rail) = "roAssociativeArray" and Type(rail.items) = "roArray"
        for each item in rail.items
          if startHasBackdrop(item) and isMediaItem(item) then return item
        end for
      end if
    end for
  end if
  watching = startContinue(payload)
  if watching.Count() > 0 then return watching[0]
  return invalid
end function

function startPopularIds() as Object
  return ["bbc-one", "bbc-two", "bbc-news", "cbbc", "dw-english", "weathernation"]
end function

' Free live TV on the start page: the well-known channels first, then the rest, six in all, playable only.
function startChannels(channels as Dynamic) as Object
  out = []
  if Type(channels) <> "roArray" then return out
  playable = []
  for each channel in channels
    if Type(channel) = "roAssociativeArray" and channel.DoesExist("url") and channel.url <> invalid and channel.url <> "" then playable.Push(channel)
  end for
  used = {}
  for each popular in startPopularIds()
    for each channel in playable
      if channel.id = "live:free:" + popular and not used.DoesExist(channel.id)
        out.Push(channel)
        used[channel.id] = true
      end if
    end for
  end for
  for each channel in playable
    if not used.DoesExist(channel.id)
      out.Push(channel)
      used[channel.id] = true
    end if
  end for
  while out.Count() > 6
    out.Pop()
  end while
  return out
end function

' Pressing OK on a Continue watching card: play it, except a series with no season and episode, which opens details.
function startResumeAction(item as Dynamic) as String
  if Type(item) <> "roAssociativeArray" then return "details"
  kind = ""
  if item.DoesExist("kind") and item.kind <> invalid then kind = LCase(item.kind)
  if kind <> "series" and kind <> "show" and kind <> "tv" then return "play"
  id = ""
  if item.DoesExist("id") and item.id <> invalid then id = item.id
  if CreateObject("roRegex", "^tt[0-9]+:[0-9]+:[0-9]+$", "i").IsMatch(id) then return "play"
  if item.DoesExist("season") and item.DoesExist("episode") and item.season <> invalid and item.episode <> invalid then return "play"
  return "details"
end function

' The rows the start page shows, in order. Continue watching is left out when empty.
function startRowIds(hasContinue as Boolean, hasChannels as Boolean) as Object
  rows = []
  if hasContinue then rows.Push("continue")
  rows.Push("apps")
  if hasChannels then rows.Push("live")
  return rows
end function
