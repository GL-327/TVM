function lcScreenHeight() as Integer
  di = CreateObject("roDeviceInfo")
  mode = LCase(di.GetVideoMode())
  if Instr(1, mode, "2160") > 0 or Instr(1, mode, "4k") > 0 then return 2160
  if Instr(1, mode, "1080") > 0 then return 1080
  if Instr(1, mode, "1440") > 0 then return 1440
  return 720
end function

function lcCodecSupported(label as String, height as Integer, container = "mp4" as String) as Boolean
  codec = "mpeg4 avc"
  text = LCase(label)
  if Instr(1, text, "hevc") > 0 or Instr(1, text, "h265") > 0 or Instr(1, text, "h.265") > 0 or Instr(1, text, "hvc1") > 0 or Instr(1, text, "hev1") > 0 or Instr(1, text, "x265") > 0 then codec = "hevc"
  if Instr(1, text, "vp9") > 0 or Instr(1, text, "vp09") > 0 then codec = "vp9"
  ' Roku exposes AV1/VP8/VP9 through DASH only; these source lists use MP4/HLS/MKV.
  if Instr(1, text, "av01") > 0 or Instr(1, text, "av1") > 0 or Instr(1, text, "vp8") > 0 then return false
  if codec = "vp9" then return false
  checkH = height
  if checkH <= 0 then checkH = 1080
  if codec = "mpeg4 avc" and checkH > 1080 then return false
  profile = "high" : level = "4.1"
  if codec = "hevc"
    profile = "main" : level = "4.1"
    if checkH > 1080 then level = "5.1"
    if Instr(1, text, "10bit") > 0 or Instr(1, text, "main 10") > 0 then profile = "main 10"
  end if
  result = CreateObject("roDeviceInfo").CanDecodeVideo({ codec: codec, profile: profile, level: level, container: container })
  return lcAaBool(result, "result", false)
end function

function lcStreamHeight(stream as Object) as Integer
  text = LCase(lcAaText(stream, "name") + " " + lcAaText(stream, "description") + " " + lcAaText(stream, "title"))
  if CreateObject("roRegex", "(?:^|[^a-z0-9])(?:4k|uhd|2160p)(?:$|[^a-z0-9])", "i").IsMatch(text) then return 2160
  match = CreateObject("roRegex", "(?:^|[^0-9])(1440|1080|720|576|480|360)[pi](?:$|[^a-z0-9])", "i").Match(text)
  if match.Count() > 1 then return Int(Val(match[1]))
  return 0
end function

function lcRuntimeSeconds(value as String, fallback = 0 as Integer) as Integer
  raw = value.Trim()
  if raw = "" then return fallback
  hours = 0.0
  minutes = 0.0
  hm = CreateObject("roRegex", "([0-9]+(?:\.[0-9]+)?)\s*h", "i").Match(raw)
  if hm.Count() > 1 then hours = Val(hm[1])
  mm = CreateObject("roRegex", "([0-9]+(?:\.[0-9]+)?)\s*m", "i").Match(raw)
  if mm.Count() > 1
    minutes = Val(mm[1])
  else if CreateObject("roRegex", "^[0-9]+(?:\.[0-9]+)?$", "").IsMatch(raw)
    minutes = Val(raw)
  end if
  total = Int((hours * 60.0 + minutes) * 60.0)
  if total > 0 then return total
  return fallback
end function

function lcLanguage(raw as String) as String
  key = LCase(raw.Trim()).Split("-")[0]
  aliases = {
    en: "eng", english: "eng", es: "spa", spanish: "spa", fr: "fra", fre: "fra", french: "fra"
    de: "deu", ger: "deu", german: "deu", it: "ita", italian: "ita", pt: "por", portuguese: "por"
    ja: "jpn", japanese: "jpn", ko: "kor", korean: "kor", zh: "zho", chi: "zho", mandarin: "zho", chinese: "zho"
    yue: "yue", cantonese: "yue"
    ru: "rus", russian: "rus", hi: "hin", hindi: "hin", ar: "ara", arabic: "ara", tr: "tur", turkish: "tur"
    nl: "nld", dut: "nld", dutch: "nld", sv: "swe", swedish: "swe", da: "dan", danish: "dan"
    no: "nor", nb: "nor", norwegian: "nor", fi: "fin", finnish: "fin", pl: "pol", polish: "pol"
    cs: "ces", cze: "ces", czech: "ces", he: "heb", hebrew: "heb", el: "ell", gre: "ell", greek: "ell"
    hu: "hun", hungarian: "hun", ro: "ron", rum: "ron", romanian: "ron", uk: "ukr", ukrainian: "ukr"
    vi: "vie", vietnamese: "vie", th: "tha", thai: "tha", id: "ind", indonesian: "ind"
    ta: "tam", tamil: "tam", te: "tel", telugu: "tel", und: ""
  }
  if aliases.DoesExist(key) then return aliases[key]
  if Len(key) = 3 and CreateObject("roRegex", "^[a-z]{3}$", "").IsMatch(key) then return key
  return ""
end function

function lcStreamLanguage(stream as Object, label as String) as Object
  found = []
  explicit = lcAaGet(stream, "languages", [])
  if Type(explicit) = "roArray"
    for each raw in explicit
      code = lcLanguage(asText(raw))
      if code <> "" and not lcIncludes(found, code) then found.Push(code)
    end for
  end if
  patterns = {
    eng: "eng|english|🇬🇧|🇺🇸", spa: "spa|spanish|castellano|latino|🇪🇸|🇲🇽", fra: "fre|fra|french|vff|truefrench|🇫🇷"
    deu: "ger|deu|german|🇩🇪", ita: "ita|italian|🇮🇹", por: "por|portuguese|🇵🇹|🇧🇷"
    jpn: "jpn|japanese|🇯🇵", kor: "kor|korean|🇰🇷", zho: "chi|zho|mandarin|chinese|🇨🇳|🇹🇼", yue: "cantonese|🇭🇰"
    rus: "rus|russian|🇷🇺", hin: "hin|hindi|🇮🇳", ara: "ara|arabic|🇸🇦", tur: "tur|turkish|🇹🇷"
    nld: "nld|dut|dutch|🇳🇱", swe: "swe|swedish|🇸🇪", dan: "dan|danish|🇩🇰", nor: "nor|norwegian|🇳🇴"
    fin: "fin|finnish|🇫🇮", pol: "pol|polish|🇵🇱", ces: "ces|cze|czech|🇨🇿", hun: "hun|hungarian|🇭🇺"
    ron: "ron|rum|romanian|🇷🇴", ell: "ell|gre|greek|🇬🇷", heb: "heb|hebrew|🇮🇱", ukr: "ukr|ukrainian|🇺🇦"
    tha: "tha|thai|🇹🇭", vie: "vie|vietnamese|🇻🇳", ind: "ind|indonesian|🇮🇩", tam: "tam|tamil", tel: "tel|telugu"
  }
  for each code in patterns
    regex = CreateObject("roRegex", "(?:^|[^a-z])(?:" + patterns[code] + ")(?:$|[^a-z])", "i")
    if regex.IsMatch(label) and not lcIncludes(found, code) then found.Push(code)
  end for
  return found
end function

function lcStreamSize(stream as Object) as Double
  hints = lcAaGet(stream, "behaviorHints", {})
  rawSize = lcAaGet(hints, "videoSize", invalid)
  if rawSize <> invalid
    numSize = Val(asText(rawSize))
    if numSize > 0 then return numSize
  end if
  for each fieldKey in ["description", "title", "name"]
    sizeText = lcAaText(stream, fieldKey)
    if sizeText <> ""
      match = CreateObject("roRegex", "([0-9]+(?:[.,][0-9]+)?)\s*([KMGT])i?B", "i").Match(sizeText)
      if match.Count() >= 3
        unit = LCase(match[2])
        multiplier = 1048576.0#
        if unit = "k" then multiplier = 1024.0#
        if unit = "g" then multiplier = 1073741824.0#
        if unit = "t" then multiplier = 1099511627776.0#
        return Val(match[1].Replace(",", ".")) * multiplier
      end if
    end if
  end for
  return 0.0#
end function

function lcReleaseDetails(stream as Object, runtime as Integer) as Object
  name = lcAaText(stream, "name")
  title = lcAaText(stream, "title")
  desc = lcAaText(stream, "description")
  release = desc
  if release = "" then release = title
  text = LCase(name + " " + desc + " " + title)
  lowQuality = CreateObject("roRegex", "(?:^|[^a-z0-9])(?:cam|hdcam|camrip|telesync|telecine|hdts|hdtc|tsrip|ts|tc|screener|dvdscr|dvdscreener|scr|workprint)(?:$|[^a-z0-9])", "i").IsMatch(text)
  upscaled = CreateObject("roRegex", "(?:^|[^a-z0-9])(?:up[ ._-]?scal(?:e[ds]?|ing)|aius|ups|re[ ._-]?grad(?:e[ds]?|ing)|upconvert(?:ed)?)(?:$|[^a-z0-9])", "i").IsMatch(text)
  grades = ["other", "hdtv", "webrip", "web-dl", "bluray", "remux"]
  sourceLabels = ["", "HDTV", "WEBRip", "WEB-DL", "BluRay", "REMUX"]
  source = 0
  for each pattern in ["hdtv", "web[ ._-]?rip", "web[ ._-]?dl", "blu[ ._-]?ray|bdrip|brrip", "remux"]
    if CreateObject("roRegex", pattern, "i").IsMatch(text) then source = LocGradeIndex(pattern)
  end for
  hdr = invalid
  if CreateObject("roRegex", "(?:^|[^a-z0-9])(?:dv|dovi|dolby[ ._-]?vision)(?:$|[^a-z0-9])", "i").IsMatch(text)
    hdr = "dv"
  else if CreateObject("roRegex", "hdr10(?:\+|plus)", "i").IsMatch(text)
    hdr = "hdr10+"
  else if CreateObject("roRegex", "(?:^|[^a-z0-9])hlg(?:$|[^a-z0-9])", "i").IsMatch(text)
    hdr = "hlg"
  else if CreateObject("roRegex", "(?:^|[^a-z0-9])hdr(?:10)?(?:$|[^a-z0-9])", "i").IsMatch(text)
    hdr = "hdr10"
  end if
  codec = "h264"
  if CreateObject("roRegex", "hevc|[xh][ ._-]?265|hvc1|hev1", "i").IsMatch(text) then codec = "hevc"
  if CreateObject("roRegex", "(?:^|[^a-z0-9])av1(?:$|[^a-z0-9])", "i").IsMatch(text) then codec = "av1"
  if CreateObject("roRegex", "(?:^|[^a-z0-9])vp9(?:$|[^a-z0-9])", "i").IsMatch(text) then codec = "vp9"
  if CreateObject("roRegex", "(?:^|[^a-z0-9])vp8(?:$|[^a-z0-9])", "i").IsMatch(text) then codec = "vp8"
  hints = lcAaGet(stream, "behaviorHints", {})
  file = LCase(lcAaText(hints, "filename"))
  streamUrl = LCase(lcAaText(stream, "url"))
  container = "mp4"
  if Right(file, 4) = ".mkv" or Instr(1, text, ".mkv") > 0 or source >= 4 then container = "mkv"
  if Right(file, 4) = ".avi" or Right(file, 4) = ".wmv" or Right(file, 5) = ".webm" or Right(file, 4) = ".mov" then container = "unsupported"
  if CreateObject("roRegex", "\.m3u8(?:\?|$)", "i").IsMatch(streamUrl) then container = "unsupported"
  size = lcStreamSize(stream)
  height = lcStreamHeight(stream)
  bitrate = invalid
  if size > 0.0# and runtime > 0 then bitrate = Int((size * 80.0# / (runtime * 1000000.0#)) + 0.5#) / 10.0
  sound = ""
  if Instr(1, text, "truehd") > 0 or Instr(1, text, "true-hd") > 0 then sound = "TrueHD"
  if Instr(1, text, "dts") > 0 then sound = "DTS"
  if Instr(1, text, "ddp") > 0 or Instr(1, text, "eac3") > 0 or Instr(1, text, "dd+") > 0 then sound = "Dolby Digital Plus"
  if Instr(1, text, "aac") > 0 then sound = "AAC"
  channels = ""
  channelMatch = CreateObject("roRegex", "(?:^|[^0-9])([257][.]1|2[.]0|1[.]0)(?:$|[^0-9])", "").Match(text)
  if channelMatch.Count() > 1 then channels = channelMatch[1]
  hash = lcStreamHash(stream)
  id = ""
  if hash.hash <> "" then id = hash.hash + ":" + hash.file
  labelBits = []
  if height = 2160
    labelBits.Push("4K")
  else if height > 0
    labelBits.Push(StrI(height).Trim() + "p")
  end if
  if hdr = "dv"
    labelBits.Push("Dolby Vision")
  else if hdr <> invalid
    labelBits.Push(UCase(hdr))
  end if
  if source > 0 then labelBits.Push(sourceLabels[source])
  if bitrate <> invalid then labelBits.Push(bitrate.ToStr() + " Mb/s")
  label = labelBits.Join("  ·  ")
  if label = "" then label = title
  cached = Instr(1, UCase(name), "RD+") > 0 or lcAaBool(stream, "cached")
  return {
    version: { id: id, label: label, height: height, hdr: hdr, source: grades[source], codec: codec, sizeBytes: size, bitrateMbps: bitrate, audio: { codec: sound, channels: channels, atmos: Instr(1, text, "atmos") > 0 }, languages: lcStreamLanguage(stream, release + " " + title), upscaled: upscaled, cached: cached, recommended: false }
    stream: stream, container: container, grade: source, lowQuality: lowQuality, rawText: title + " " + desc
  }
end function

function LocGradeIndex(pattern as String) as Integer
  return ["hdtv", "web[ ._-]?rip", "web[ ._-]?dl", "blu[ ._-]?ray|bdrip|brrip", "remux"].IndexOf(pattern) + 1
end function

function lcStreamHash(stream as Object) as Object
  hash = LCase(lcAaText(stream, "infoHash", lcAaText(stream, "info_hash")))
  idx = lcAaInt(stream, "fileIdx", -1)
  if not CreateObject("roRegex", "^[0-9a-f]{40}$", "").IsMatch(hash)
    hash = ""
    match = CreateObject("roRegex", "/([0-9a-f]{40})/[^/]*/([0-9]+|null)(?:/|$)", "i").Match(lcAaText(stream, "url"))
    if match.Count() >= 3
      hash = LCase(match[1])
      if idx < 0 and match[2] <> "null" then idx = Int(Val(match[2]))
    end if
  end if
  file = "auto"
  if idx >= 0 then file = StrI(idx).Trim()
  return { hash: hash, file: file, index: idx }
end function

function lcPlaybackCap(quality as String, client as Object) as Integer
  cap = lcScreenHeight()
  request = lcAaInt(client, "maxHeight")
  if request > 0 and request < cap then cap = request
  if quality = "saver" then quality = "720"
  wanted = Int(Val(quality))
  if wanted > 0 and wanted < cap then cap = wanted
  return cap
end function

function lcRokuHdrSupported(hdr as Dynamic, client as Object) as Boolean
  if hdr = invalid then return true
  if not lcAaBool(client, "hdr", true) then return false
  display = CreateObject("roDeviceInfo").GetDisplayProperties()
  if hdr = "dv" then return lcAaBool(display, "DolbyVision")
  if hdr = "hlg" then return lcAaBool(display, "HLG")
  if hdr = "hdr10+" and lcAaBool(display, "Hdr10Plus") then return true
  return lcAaBool(display, "Hdr10")
end function

function lcVersionBefore(a as Object, b as Object, saver as Boolean) as Boolean
  if a.languageMatch <> b.languageMatch then return a.languageMatch
  aHeight = a.version.height
  if aHeight <= 0 then aHeight = 1080
  bHeight = b.version.height
  if bHeight <= 0 then bHeight = 1080
  if saver
    if a.version.sizeBytes <> b.version.sizeBytes
      if a.version.sizeBytes <= 0 then return false
      if b.version.sizeBytes <= 0 then return true
      return a.version.sizeBytes < b.version.sizeBytes
    end if
    if aHeight <> bHeight then return aHeight < bHeight
  else
    if aHeight <> bHeight then return aHeight > bHeight
    if a.grade <> b.grade then return a.grade > b.grade
    aRate = 0.0#
    bRate = 0.0#
    if a.version.bitrateMbps <> invalid then aRate = a.version.bitrateMbps else aRate = a.version.sizeBytes
    if b.version.bitrateMbps <> invalid then bRate = b.version.bitrateMbps else bRate = b.version.sizeBytes
    if aRate <> bRate then return aRate > bRate
  end if
  if a.version.cached <> b.version.cached then return a.version.cached
  return false
end function

function lcRankVersions(streams as Object, original as String, runtime as Integer, prefs as Object, client as Object) as Object
  quality = lcAaText(prefs, "quality", "original")
  cap = lcPlaybackCap(quality, client)
  prefLang = lcAaText(prefs, "audioLanguage", "original")
  preferred = original
  if prefLang <> "original" then preferred = lcLanguage(prefLang)
  skipUpscale = lcAaBool(prefs, "skipUpscaled", true)
  ranked = [] : seen = {}
  for each stream in streams
    row = lcReleaseDetails(stream, runtime)
    v = row.version
    rawTitle = LCase(lcAaText(stream, "title"))
    capHeight = v.height
    if capHeight <= 0 then capHeight = 1080
    both = CreateObject("roRegex", "(?:^|[^a-z])(?:multi|dual)(?:$|[^a-z])", "i").IsMatch(rawTitle)
    explicitDub = CreateObject("roRegex", "(?:^|[^a-z])(?:dub(?:bed)?|fandub)(?:$|[^a-z])", "i").IsMatch(rawTitle) and not both
    dubOnly = original <> "" and prefLang = "original" and ((v.languages.Count() > 0 and not lcIncludes(v.languages, original) and not both) or (v.languages.Count() = 0 and explicitDub))
    row.languageMatch = preferred <> "" and lcIncludes(v.languages, preferred)
    native = (v.codec <> "hevc" or lcAaBool(client, "hevc", true)) and (row.container <> "mkv" or lcAaBool(client, "mkv", true))
    if v.id <> "" and not seen.DoesExist(v.id) and capHeight <= cap and not row.lowQuality and not dubOnly and native and row.container <> "unsupported" and not ((skipUpscale or quality = "original") and v.upscaled)
      codec = v.codec
      if v.hdr <> invalid then codec = codec + " 10bit"
      if lcRokuHdrSupported(v.hdr, client) and lcCodecSupported(codec, capHeight, row.container)
        index = 0
        while index < ranked.Count()
          if lcVersionBefore(row, ranked[index], quality = "saver") then exit while
          index = index + 1
        end while
        lcInsert(ranked, index, row)
        seen[v.id] = true
      end if
    end if
  end for
  if ranked.Count() > 0 then ranked[0].version.recommended = true
  return ranked
end function

function lcStreamQualities(streams as Object) as Object
  out = []
  for each height in [2160, 1080, 720, 480]
    for each stream in streams
      if lcStreamHeight(stream) = height and height <= lcScreenHeight()
        out.Push(height)
        exit for
      end if
    end for
  end for
  return out
end function

function lcResolveUrl(base as String, relative as String) as String
  if Left(relative, 8) = "https://" or Left(relative, 7) = "http://" then return relative
  scheme = Instr(1, base, "://")
  if scheme = 0 then return ""
  hostEnd = Instr(scheme + 3, base, "/")
  origin = base
  if hostEnd > 0 then origin = Left(base, hostEnd - 1)
  if Left(relative, 2) = "//" then return Left(base, scheme) + relative
  if Left(relative, 1) = "/" then return origin + relative
  clean = base.Tokenize("?")[0]
  slash = Len(clean)
  while slash > 0 and Mid(clean, slash, 1) <> "/"
    slash = slash - 1
  end while
  joined = Left(clean, slash) + relative
  parts = Mid(joined, Len(origin) + 2).Tokenize("/")
  normalized = []
  for each part in parts
    if part = ".."
      if normalized.Count() > 0 then normalized.Pop()
    else if part <> "."
      normalized.Push(part)
    end if
  end for
  return origin + "/" + normalized.Join("/")
end function

function lcHlsVariants(base as String, text as String, cap as Integer) as Object
  out = []
  pending = invalid
  for each raw in text.Split(Chr(10))
    line = raw.Trim()
    if Left(line, 18) = "#EXT-X-STREAM-INF:"
      height = 0
      match = CreateObject("roRegex", "RESOLUTION=[0-9]+x([0-9]+)", "i").Match(line)
      if match.Count() > 1 then height = Int(Val(match[1]))
      bw = 0
      match = CreateObject("roRegex", "(?:^|,)BANDWIDTH=([0-9]+)", "i").Match(Mid(line, 19))
      if match.Count() > 1 then bw = Int(Val(match[1]))
      pending = invalid
      if height > 0 and height <= cap and lcCodecSupported(line, height) then pending = { height: height, bandwidth: bw }
    else if line <> "" and Left(line, 1) <> "#" and pending <> invalid
      pending.url = lcResolveUrl(base, line)
      index = 0
      while index < out.Count()
        if pending.height > out[index].height then exit while
        if pending.height = out[index].height and pending.bandwidth > out[index].bandwidth then exit while
        index = index + 1
      end while
      lcInsert(out, index, pending)
      pending = invalid
    end if
  end for
  return out
end function

function lcQualityPlan(body as Object) as Object
  url = lcAaText(body, "url")
  cap = lcScreenHeight()
  variants = []
  if lcAaText(body, "format") = "hls"
    res = lcHttp(url, "GET", "", lcAaGet(body, "headers", {}), 7000)
    if res.ok then variants = lcHlsVariants(url, res.body, cap)
  end if
  return { url: url, variants: variants, cap: cap }
end function

sub lcInsert(items as Object, index as Integer, value as Dynamic)
  items.Push(invalid)
  for i = items.Count() - 1 to index + 1 step -1
    items[i] = items[i - 1]
  end for
  items[index] = value
end sub
