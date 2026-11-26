' The guide runs in its own Task. The ordinary channel list never waits for XMLTV.
function lcLiveGuide(ctx as Object) as Object
  now = lcNowSeconds()
  start = now - (now mod 1800)
  date = CreateObject("roDateTime")
  supplied = lcAaText(ctx.query, "start")
  if Len(supplied) >= 19
    date.FromISO8601String(Left(supplied, 19))
    start = date.AsSeconds()
  end if
  hours = lcAaInt(ctx.query, "hours", 24)
  if hours < 1 then hours = 1
  if hours > 24 then hours = 24
  finish = start + hours * 3600
  state = lcLoadLiveState()
  channels = lcFreeChannels(ctx)
  picked = {}
  for each id in state.picks
    picked[id] = true
  end for
  for each row in lcLoadLiveChannels()
    if picked.DoesExist(row.id) and lcAllowed(row, lcProfileLevel(ctx)) then channels.Push(row)
  end for
  freeDoc = lcContent("free-channels")
  feeds = lcAaGet(freeDoc, "epgFeeds", [])
  freeTargets = []
  ipTargets = []
  for each ch in channels
    if ch.source = "free"
      freeTargets.Push(ch)
    else
      if lcAaText(state, "xtreamEpg") <> "" then ch.source = "xtream"
      ipTargets.Push(ch)
    end if
  end for
  ' Use the shared feed mapping when distributed. Freeview covers the UK on older bundles.
  if Type(feeds) <> "roArray" then feeds = []
  if feeds.Count() = 0
    feeds = ["https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml"]
  end if
  listings = {}
  for each entry in feeds
    url = lcAaText(entry, "url")
    if Type(entry) = "String" or Type(entry) = "roString" then url = entry
    if url <> "" then lcGuideFeed(url, freeTargets, start, finish, listings)
  end for
  for each url in lcAaGet(state, "epgUrls", [])
    lcGuideFeed(url, ipTargets, start, finish, listings)
  end for
  xtream = lcAaText(state, "xtreamEpg")
  if xtream <> ""
    fallbackCount = 0
    for each ch in ipTargets
      if fallbackCount >= 8 then exit for
      if not listings.DoesExist(ch.id) and lcAaText(ch, "streamId") <> "" and now >= start and now < finish
        client = lcXtreamShortUrl(xtream, ch.streamId)
        if client <> ""
          lcGuideShort(client, ch.id, start, finish, listings)
          fallbackCount = fallbackCount + 1
        end if
      end if
    end for
  end if
  group = lcAaText(ctx.query, "group")
  groups = []
  out = []
  for i = 0 to channels.Count() - 1
    ch = channels[i]
    name = lcAaText(ch, "name", lcAaText(ch, "title"))
    number = lcAaInt(ch, "number")
    if number < 1 then number = i + 1
    if ch.group <> invalid and ch.group <> "" and not lcIncludes(groups, ch.group) then groups.Push(ch.group)
    if group = "" or group = ch.group
      programmes = lcAaGet(listings, ch.id, [])
      programmes.SortBy("start")
      if programmes.Count() = 0 then programmes.Push({ start: lcGuideIso(start), end: lcGuideIso(finish), title: "No guide information" })
      source = lcAaText(ch, "source", "m3u")
      out.Push({ id: ch.id, name: name, number: number, source: source, group: ch.group, logo: ch.logo, programmes: programmes, favourite: picked.DoesExist(ch.id) })
    end if
  end for
  return { status: 200, json: { now: lcGuideIso(now), start: lcGuideIso(start), end: lcGuideIso(finish), groups: groups, channels: out } }
end function

function lcGuideIso(epoch as Integer) as String
  dt = CreateObject("roDateTime")
  dt.FromSeconds(epoch)
  return Left(dt.ToISOString(), 19) + "Z"
end function

function lcGuideEpoch(raw as String) as Integer
  if Len(raw) < 14 then return 0
  iso = Left(raw, 4) + "-" + Mid(raw, 5, 2) + "-" + Mid(raw, 7, 2) + "T" + Mid(raw, 9, 2) + ":" + Mid(raw, 11, 2) + ":" + Mid(raw, 13, 2) + "Z"
  dt = CreateObject("roDateTime")
  dt.FromSeconds(0)
  dt.FromISO8601String(Left(iso, 19))
  zone = Mid(raw, 15).Trim()
  sign = Left(zone, 1)
  delta = 0
  if sign = "+" or sign = "-" then delta = (Int(Val(Mid(zone, 2, 2))) * 60 + Int(Val(Mid(zone, 4, 2)))) * 60
  if sign = "-" then delta = -delta
  return dt.AsSeconds() - delta
end function

function lcGuideMatchKey(raw as String) as String
  raw = LCase(raw.Trim())
  if Right(raw, 3) = " hd" then raw = Left(raw, Len(raw) - 3)
  return CreateObject("roRegex", "[^a-z0-9]", "").ReplaceAll(raw, "")
end function

function lcGuideFile(url as String) as String
  if Left(url, 8) <> "https://" and Left(url, 7) <> "http://" then return ""
  prefix = "tmp:/tvm_epg_" + Left(lcSha256Hex(url), 24)
  target = prefix + ".xml"
  fs = CreateObject("roFileSystem")
  stat = fs.Stat(target)
  if stat <> invalid and stat.mtime <> invalid and lcNowSeconds() - stat.mtime.AsSeconds() < 21600 then return target
  xfer = CreateObject("roUrlTransfer")
  port = CreateObject("roMessagePort")
  xfer.SetMessagePort(port)
  xfer.SetUrl(url)
  xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
  xfer.EnableEncodings(true)
  temp = prefix + "_" + lcUuid() + ".tmp"
  if xfer.AsyncGetToFile(temp)
    msg = Wait(12000, port)
    if msg <> invalid and Type(msg) = "roUrlEvent" and msg.GetResponseCode() = 200
      if fs.Rename(temp, target) then return target
    end if
  end if
  xfer.AsyncCancel()
  DeleteFile(temp)
  if stat <> invalid then return target
  return ""
end function

sub lcGuideFeed(url as String, channels as Object, start as Integer, finish as Integer, listings as Object)
  if channels.Count() = 0 then return
  path = lcGuideFile(url)
  if path = "" then return
  map = {}
  names = {}
  fallbackIds = {
    "live:free:bbc-one": "BBCOneYorkshire.uk"
    "live:free:bbc-two": "BBCTwoHD.uk"
    "live:free:bbc-three": "BBCThreeHD.uk"
    "live:free:bbc-four": "BBCFourHD.uk"
    "live:free:bbc-parliament": "BBCParliament.uk"
    "live:free:bbc-scotland": "BBCScotland.uk"
    "live:free:france-24": "France24English.fr"
  }
  for each ch in channels
    epgId = lcAaText(ch, "epgId")
    if epgId = "" then epgId = lcAaText(fallbackIds, ch.id)
    if epgId <> "" then map[LCase(epgId)] = ch.id
    names[lcGuideMatchKey(ch.title)] = ch.id
  end for
  bytes = CreateObject("roByteArray")
  offset = 0
  carry = ""
  record = CreateObject("roRegex", "<(channel|programme)\s[^>]*>[\s\S]*?</(?:channel|programme)>", "i")
  attributes = CreateObject("roRegex", "([a-z]+)\s*=\s*['" + Chr(34) + "]([^'" + Chr(34) + "]*)['" + Chr(34) + "]", "i")
  while bytes.ReadFile(path, offset, 65536)
    if bytes.Count() = 0 then exit while
    if offset = 0 and bytes[0] = 31 and bytes[1] = 139 then exit while
    offset = offset + bytes.Count()
    carry = carry + bytes.ToAsciiString()
    last = 0
    for each match in record.MatchAll(carry)
      xml = match[0]
      found = Instr(last + 1, carry, xml)
      last = found + Len(xml) - 1
      tagEnd = Instr(1, xml, ">")
      attr = {}
      for each pair in attributes.MatchAll(Left(xml, tagEnd))
        attr[LCase(pair[1])] = pair[2]
      end for
      if LCase(match[1]) = "channel"
        key = LCase(lcAaText(attr, "id"))
        if not map.DoesExist(key)
          node = CreateObject("roXMLElement")
          if node.Parse(xml)
            for each display in node.GetNamedElements("display-name")
              name = lcGuideMatchKey(display.GetText())
              if names.DoesExist(name) then map[key] = names[name] : exit for
            end for
          end if
        end if
      else
        channel = LCase(lcAaText(attr, "channel"))
        if map.DoesExist(channel)
          begins = lcGuideEpoch(lcAaText(attr, "start"))
          ends = lcGuideEpoch(lcAaText(attr, "stop"))
          if begins > 0 and ends > begins and ends > start and begins < finish
            node = CreateObject("roXMLElement")
            if node.Parse(xml)
              id = map[channel]
              lcGuideAdd(listings, id, {
                start: lcGuideIso(begins), end: lcGuideIso(ends)
                title: lcGuideTag(node, "title"), subtitle: lcGuideTag(node, "sub-title")
                description: lcGuideTag(node, "desc"), category: lcGuideTag(node, "category")
              })
            end if
          end if
        end if
      end if
    end for
    if last > 0 then carry = Mid(carry, last + 1)
    ' Keep one incomplete element, plus a short tail for a split opening tag.
    if Len(carry) > 262144 then carry = Right(carry, 65536)
  end while
end sub

function lcGuideTag(node as Object, tag as String) as String
  value = node.GetNamedElements(tag)
  if value.Count() = 0 then return ""
  return Left(value[0].GetText(), 600)
end function

sub lcGuideAdd(listings as Object, id as String, row as Object)
  if row.title = "" then return
  if not listings.DoesExist(id) then listings[id] = []
  if listings[id].Count() >= 160 then return
  for each existing in listings[id]
    if existing.start = row.start and existing.end = row.end then return
  end for
  listings[id].Push(row)
end sub

function lcXtreamShortUrl(xmltv as String, streamId as String) as String
  marker = Instr(1, xmltv, "/xmltv.php?")
  if marker = 0 then return ""
  return Left(xmltv, marker) + "player_api.php?" + Mid(xmltv, marker + 11) + "&action=get_short_epg&limit=6&stream_id=" + lcUrlEncode(streamId)
end function

sub lcGuideShort(url as String, id as String, start as Integer, finish as Integer, listings as Object)
  key = "tvm_short_epg_" + Left(lcSha256Hex(url), 24) + ".json"
  data = lcReadTmpJson(key, 21600)
  if data = invalid
    res = lcHttp(url, "GET", "", {}, 1200)
    if not res.ok or res.json = invalid then return
    data = res.json
    lcWriteTmpJson(key, data)
  end if
  for each entry in lcAaGet(data, "epg_listings", [])
    begins = lcAaInt(entry, "start_timestamp")
    ends = lcAaInt(entry, "stop_timestamp")
    if begins > 0 and ends > begins and ends > start and begins < finish
      lcGuideAdd(listings, id, { start: lcGuideIso(begins), end: lcGuideIso(ends), title: lcGuideBase64(lcAaText(entry, "title")), description: lcGuideBase64(lcAaText(entry, "description")) })
    end if
  end for
end sub

function lcGuideBase64(value as String) as String
  data = CreateObject("roByteArray")
  data.FromBase64String(value)
  return data.ToAsciiString()
end function

function lcXtreamEpgUrl(url as String) as String
  marker = Instr(1, url, "/get.php?")
  if marker = 0 then return ""
  query = lcParseQuery(Mid(url, marker + 9))
  user = lcAaText(query, "username")
  pass = lcAaText(query, "password")
  if user = "" or pass = "" then return ""
  return Left(url, marker) + "xmltv.php?username=" + lcUrlEncode(user) + "&password=" + lcUrlEncode(pass)
end function

function lcXtreamStreamId(url as String) as String
  if Instr(1, url, "/live/") = 0 then return ""
  path = url.Tokenize("?")[0].Tokenize("/")
  if path.Count() = 0 then return ""
  file = path[path.Count() - 1]
  return file.Tokenize(".")[0]
end function

function lcPlaylistGuideUrls(playlist as String, base as String) as Object
  newline = Instr(1, playlist, Chr(10))
  if newline = 0 then return []
  heading = Left(playlist, newline - 1)
  value = lcM3uAttr(heading, "url-tvg")
  if value = "" then value = lcM3uAttr(heading, "x-tvg-url")
  out = []
  for each part in value.Split(",")
    if out.Count() >= 3 then exit for
    if part.Trim() <> "" then out.Push(lcResolveUrl(base, part.Trim()))
  end for
  xtream = lcXtreamEpgUrl(base)
  if xtream <> "" and not lcIncludes(out, xtream) then out.Unshift(xtream)
  return out
end function
