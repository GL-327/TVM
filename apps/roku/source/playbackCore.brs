function lcScreenHeight() as Integer
  di = CreateObject("roDeviceInfo")
  mode = LCase(di.GetVideoMode())
  if Instr(1, mode, "2160") > 0 or Instr(1, mode, "4k") > 0 then return 2160
  if Instr(1, mode, "1080") > 0 then return 1080
  if Instr(1, mode, "1440") > 0 then return 1440
  return 720
end function

function lcCodecSupported(label as String, height as Integer) as Boolean
  codec = "mpeg4 avc"
  text = LCase(label)
  if Instr(1, text, "hevc") > 0 or Instr(1, text, "h265") > 0 or Instr(1, text, "h.265") > 0 or Instr(1, text, "hvc1") > 0 or Instr(1, text, "hev1") > 0 then codec = "hevc"
  if Instr(1, text, "vp9") > 0 or Instr(1, text, "vp09") > 0 then codec = "vp9"
  ' Roku exposes AV1 through DASH only; these source lists use MP4/HLS.
  if Instr(1, text, "av01") > 0 or Instr(1, text, "av1") > 0 then return false
  if codec = "mpeg4 avc" and height > 1080 then return false
  profile = "high" : level = "4.1"
  if codec = "hevc"
    profile = "main" : level = "4.1"
    if height > 1080 then level = "5.1"
    if Instr(1, text, "10bit") > 0 or Instr(1, text, "main 10") > 0 then profile = "main 10"
  else if codec = "vp9"
    profile = "profile 0" : level = "4.1"
    if height > 1080 then level = "5.1"
  end if
  result = CreateObject("roDeviceInfo").CanDecodeVideo({ codec: codec, profile: profile, level: level, container: "mp4" })
  return lcAaBool(result, "result", false)
end function

function lcStreamHeight(stream as Object) as Integer
  text = LCase(lcAaText(stream, "name") + " " + lcAaText(stream, "title"))
  if Instr(1, text, "2160") > 0 or Instr(1, text, "4k") > 0 then return 2160
  if Instr(1, text, "1440") > 0 then return 1440
  if Instr(1, text, "1080") > 0 then return 1080
  if Instr(1, text, "720") > 0 then return 720
  return 480
end function

function lcRankStreams(streams as Object, manual = 0 as Integer) as Object
  cap = lcScreenHeight()
  if manual > 0 and manual < cap then cap = manual
  ranked = []
  for each stream in streams
    height = lcStreamHeight(stream)
    label = LCase(lcAaText(stream, "name") + " " + lcAaText(stream, "title"))
    size = lcAaGet(lcAaGet(stream, "behaviorHints", {}), "videoSize", 0)
    sane = (size = 0 or (size >= 50000000 and size <= 120000000000))
    if height <= cap and sane and lcCodecSupported(label, height) and Instr(1, label, "cam") = 0 and Instr(1, label, "tsrip") = 0
      index = 0
      while index < ranked.Count()
        if height > lcStreamHeight(ranked[index]) then exit while
        index = index + 1
      end while
      lcInsert(ranked, index, stream)
    end if
  end for
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
