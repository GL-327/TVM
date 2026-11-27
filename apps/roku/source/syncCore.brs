' TVM account sync engine for standalone Roku.
' Matches apps/core/src/sync/{schema,merge,engine,stores}.ts.
' Uses explicit array scans instead of missing Roku OS string/array helpers.

function syncMaxValueBytes() as Integer
  return 16384
end function

function syncMaxItems() as Integer
  return 200
end function

function syncFutureMs() as LongInteger
  return 300000&
end function

function syncBackoffMaxMs() as LongInteger
  return 300000&
end function

function syncMaxPages() as Integer
  return 201
end function

function syncKinds() as Object
  return ["profile", "progress", "watchlist", "preference"]
end function

function syncExtrasKeys() as Object
  return [
    "onlineSubtitles", "trailers", "trailerBackdrops", "collections", "comingUp", "watchStats",
    "animeTitles", "ratings", "qualityBadges", "versionPicker", "chapters", "seekPreviews",
    "themeSongs", "spoilerBlur", "surpriseMe", "autoCollections", "sleepTimer", "nightMode",
    "pauseOnMinimize", "shortcutsOverlay", "webhook", "announcements", "franchiseIntros"
  ]
end function

function syncPrefKeys() as Object
  keys = ["subtitleLanguages", "subtitleStyle", "audioLanguage", "skipSegments", "autoplayNext", "homeSections"]
  for each id in syncExtrasKeys()
    keys.Push("extras." + id)
  end for
  return keys
end function

function syncPrefKeySet() as Object
  set = {}
  for each k in syncPrefKeys()
    set[k] = true
  end for
  return set
end function

function syncArrayContains(arr as Object, target as String) as Boolean
  for i = 0 to arr.Count() - 1
    if arr[i] = target then return true
  end for
  return false
end function

' ---- UTF-8, SHA-256, Base64URL, PBKDF2 ----

function syncUtf8Bytes(text as String) as Object
  bytes = []
  n = Len(text)
  i = 1
  while i <= n
    c = Asc(Mid(text, i, 1))
    if c < 0 then c = c + 65536
    if c >= 55296 and c <= 56319 and i < n
      c2 = Asc(Mid(text, i + 1, 1))
      if c2 < 0 then c2 = c2 + 65536
      if c2 >= 56320 and c2 <= 57343
        c = 65536 + (c - 55296) * 1024 + (c2 - 56320)
        i = i + 1
      end if
    end if
    if c < 128
      bytes.Push(c)
    else if c < 2048
      bytes.Push(192 + Int(c / 64))
      bytes.Push(128 + (c mod 64))
    else if c < 65536
      bytes.Push(224 + Int(c / 4096))
      bytes.Push(128 + (Int(c / 64) mod 64))
      bytes.Push(128 + (c mod 64))
    else
      bytes.Push(240 + Int(c / 262144))
      bytes.Push(128 + (Int(c / 4096) mod 64))
      bytes.Push(128 + (Int(c / 64) mod 64))
      bytes.Push(128 + (c mod 64))
    end if
    i = i + 1
  end while
  return bytes
end function

function syncHexDigitVal(ch as String) as Integer
  c = Asc(LCase(ch))
  if c >= 48 and c <= 57 then return c - 48
  if c >= 97 and c <= 102 then return c - 87
  return 0
end function

function syncHexToBytes(hex as String) as Object
  out = []
  n = Len(hex)
  i = 1
  while i + 1 <= n
    hi = syncHexDigitVal(Mid(hex, i, 1))
    lo = syncHexDigitVal(Mid(hex, i + 1, 1))
    out.Push(hi * 16 + lo)
    i = i + 2
  end while
  return out
end function

function syncBytesToHex(bytes as Object) as String
  digits = "0123456789abcdef"
  out = ""
  for i = 0 to bytes.Count() - 1
    b = bytes[i] and 255
    out = out + Mid(digits, Int(b / 16) + 1, 1) + Mid(digits, (b mod 16) + 1, 1)
  end for
  return out
end function

function syncU32Xor(a as LongInteger, b as LongInteger) as LongInteger
  aa = a and 4294967295&
  bb = b and 4294967295&
  return (aa or bb) - (aa and bb)
end function

function syncU32Not(a as LongInteger) as LongInteger
  return 4294967295& - (a and 4294967295&)
end function

function syncU32Shr(a as LongInteger, n as Integer, pInt as Object, masksInt as Object) as LongInteger
  aa = a and 4294967295&
  if n <= 0 then return aa
  if n >= 32 then return 0&
  lo16 = Int(aa and 65535&)
  hi16 = Int((aa - lo16) / 65536)
  if n >= 16 then return (hi16 \ pInt[n - 16]) * 1&
  return ((hi16 \ pInt[n]) * 65536&) + ((hi16 and masksInt[n]) * pInt[16 - n]) + (lo16 \ pInt[n])
end function

function syncU32Rotr(a as LongInteger, n as Integer, pLong as Object, masks as Object, pInt as Object, masksInt as Object) as LongInteger
  aa = a and 4294967295&
  if n <= 0 or n >= 32 then return aa
  lo16 = Int(aa and 65535&)
  hi16 = Int((aa - lo16) / 65536)
  if n >= 16
    rightPart = (hi16 \ pInt[n - 16]) * 1&
  else
    rightPart = ((hi16 \ pInt[n]) * 65536&) + ((hi16 and masksInt[n]) * pInt[16 - n]) + (lo16 \ pInt[n])
  end if
  leftPart = (aa and masks[n]) * pLong[32 - n]
  return (rightPart or leftPart) and 4294967295&
end function

function syncSha256Pure(bytes as Object) as Object
  k = [
    1116352408&, 1899447441&, 3049323471&, 3921009573&, 961987163&, 1508970993&, 2453635748&, 2870763221&,
    3624381080&, 310598401&, 607225278&, 1426881987&, 1925078388&, 2162078206&, 2614888103&, 3248222580&,
    3835390401&, 4022224774&, 264347078&, 604807628&, 770255983&, 1249150122&, 1555081692&, 1996064986&,
    2554220882&, 2821834349&, 2952996808&, 3210313671&, 3336571891&, 3584528711&, 113926993&, 338241895&,
    666307205&, 773529912&, 1294757372&, 1396182291&, 1695183700&, 1986661051&, 2177026350&, 2456956037&,
    2730485921&, 2820302411&, 3259730800&, 3345764771&, 3516065817&, 3600352804&, 4094571909&, 275423344&,
    430227734&, 506948616&, 659060556&, 883997877&, 958139571&, 1322822218&, 1537002063&, 1747873779&,
    1955562222&, 2024104815&, 2227730452&, 2361852424&, 2428436474&, 2756734187&, 3204031479&, 3329325298&
  ]
  h = [1779033703&, 3144134277&, 1013904242&, 2773480762&, 1359893119&, 2600822924&, 528734635&, 1541459225&]

  pInt = [1]
  masksInt = [0]
  curI = 1
  for i = 1 to 16
    masksInt.Push(curI * 2 - 1)
    curI = curI * 2
    pInt.Push(curI)
  end for

  msg = []
  for i = 0 to bytes.Count() - 1
    msg.Push(bytes[i] and 255)
  end for
  bitLen = bytes.Count() * 8&
  msg.Push(128)
  while (msg.Count() mod 64) <> 56
    msg.Push(0)
  end while
  loBitLen = bitLen and 4294967295&
  hiBitLen = 0&
  if bitLen > 4294967295&
    hiBitLen = Int(((bitLen - loBitLen) * 1.0#) / 4294967296.0#) * 1&
  end if
  for s = 7 to 0 step -1
    if s >= 4
      shift = (s - 4) * 8
      msg.Push(Int(syncU32Shr(hiBitLen, shift, pInt, masksInt) and 255&))
    else
      shift = s * 8
      msg.Push(Int(syncU32Shr(loBitLen, shift, pInt, masksInt) and 255&))
    end if
  end for

  w = []
  for i = 0 to 63
    w.Push(0&)
  end for

  off = 0
  while off < msg.Count()
    for i = 0 to 15
      j = off + i * 4
      w[i] = ((msg[j] * 16777216&) + (msg[j + 1] * 65536&) + (msg[j + 2] * 256&) + msg[j + 3]) and 4294967295&
    end for
    for i = 16 to 63
      x = w[i - 15]
      xl = Int(x and 65535&)
      xh = Int((x - xl) / 65536)
      r0 = (((xh \ 128) * 65536&) + ((xh and 127) * 512) + (xl \ 128)) or ((x and 127&) * 33554432&)
      r1 = ((xh \ 4) * 1&) or ((x and 262143&) * 16384&)
      r2 = ((xh \ 8) * 65536&) + ((xh and 7) * 8192) + (xl \ 8)
      s0 = (r0 or r1) - (r0 and r1)
      s0 = (s0 or r2) - (s0 and r2)

      x = w[i - 2]
      xl = Int(x and 65535&)
      xh = Int((x - xl) / 65536)
      r0 = ((xh \ 2) * 1&) or ((x and 131071&) * 32768&)
      r1 = ((xh \ 8) * 1&) or ((x and 524287&) * 8192&)
      r2 = ((xh \ 1024) * 65536&) + ((xh and 1023) * 64) + (xl \ 1024)
      s1 = (r0 or r1) - (r0 and r1)
      s1 = (s1 or r2) - (s1 and r2)

      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) and 4294967295&
    end for

    a = h[0] : b = h[1] : c = h[2] : d = h[3]
    e = h[4] : f = h[5] : g = h[6] : hh = h[7]

    for i = 0 to 63
      el = Int(e and 65535&)
      eh = Int((e - el) / 65536)
      r0 = (((eh \ 64) * 65536&) + ((eh and 63) * 1024) + (el \ 64)) or ((e and 63&) * 67108864&)
      r1 = (((eh \ 2048) * 65536&) + ((eh and 2047) * 32) + (el \ 2048)) or ((e and 2047&) * 2097152&)
      r2 = ((eh \ 512) * 1&) or ((e and 33554431&) * 128&)
      s1 = (r0 or r1) - (r0 and r1)
      s1 = (s1 or r2) - (s1 and r2)

      ch = (e and f) + ((4294967295& - e) and g)
      temp1 = (hh + s1 + ch + k[i] + w[i]) and 4294967295&

      al = Int(a and 65535&)
      ah = Int((a - al) / 65536)
      r0 = (((ah \ 4) * 65536&) + ((ah and 3) * 16384) + (al \ 4)) or ((a and 3&) * 1073741824&)
      r1 = (((ah \ 8192) * 65536&) + ((ah and 8191) * 8) + (al \ 8192)) or ((a and 8191&) * 524288&)
      r2 = ((ah \ 64) * 1&) or ((a and 4194303&) * 1024&)
      s0 = (r0 or r1) - (r0 and r1)
      s0 = (s0 or r2) - (s0 and r2)

      ab = a and b : ac = a and c : bc = b and c
      maj = (ab or ac) - (ab and ac)
      maj = (maj or bc) - (maj and bc)
      temp2 = (s0 + maj) and 4294967295&

      hh = g
      g = f
      f = e
      e = (d + temp1) and 4294967295&
      d = c
      c = b
      b = a
      a = (temp1 + temp2) and 4294967295&
    end for

    h[0] = (h[0] + a) and 4294967295&
    h[1] = (h[1] + b) and 4294967295&
    h[2] = (h[2] + c) and 4294967295&
    h[3] = (h[3] + d) and 4294967295&
    h[4] = (h[4] + e) and 4294967295&
    h[5] = (h[5] + f) and 4294967295&
    h[6] = (h[6] + g) and 4294967295&
    h[7] = (h[7] + hh) and 4294967295&
    off = off + 64
  end while

  digest = []
  for i = 0 to 7
    word = h[i]
    digest.Push(Int(syncU32Shr(word, 24, pInt, masksInt) and 255&))
    digest.Push(Int(syncU32Shr(word, 16, pInt, masksInt) and 255&))
    digest.Push(Int(syncU32Shr(word, 8, pInt, masksInt) and 255&))
    digest.Push(Int(word and 255&))
  end for
  return digest
end function

function syncSha256Bytes(bytes as Object) as Object
  dg = CreateObject("roEVPDigest")
  ba = CreateObject("roByteArray")
  if dg <> invalid and ba <> invalid
    for i = 0 to bytes.Count() - 1
      ba.Push(bytes[i] and 255)
    end for
    dg.Setup("sha256")
    dg.Update(ba)
    hex = LCase(dg.Final())
    if Len(hex) = 64 then return syncHexToBytes(hex)
  end if
  return syncSha256Pure(bytes)
end function

function syncSha256Hex(text as String) as String
  return syncBytesToHex(syncSha256Bytes(syncUtf8Bytes(text)))
end function

function syncBase64Url(bytes as Object) as String
  alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  out = ""
  n = bytes.Count()
  i = 0
  while i < n
    b0 = bytes[i] and 255
    has1 = (i + 1 < n)
    has2 = (i + 2 < n)
    b1 = 0
    b2 = 0
    if has1 then b1 = bytes[i + 1] and 255
    if has2 then b2 = bytes[i + 2] and 255
    c0 = b0 \ 4
    c1 = ((b0 and 3) * 16) + (b1 \ 16)
    c2 = ((b1 and 15) * 4) + (b2 \ 64)
    c3 = b2 and 63
    out = out + Mid(alpha, c0 + 1, 1) + Mid(alpha, c1 + 1, 1)
    if has1 then out = out + Mid(alpha, c2 + 1, 1)
    if has2 then out = out + Mid(alpha, c3 + 1, 1)
    i = i + 3
  end while
  return out
end function

function syncSha256Base64Url(text as String) as String
  return syncBase64Url(syncSha256Bytes(syncUtf8Bytes(text)))
end function

function syncPbkdf2Sha256(pin as String, saltHex as String, iterations as Integer) as String
  hm = CreateObject("roHMAC")
  keyBa = CreateObject("roByteArray")
  msgBa = CreateObject("roByteArray")
  if hm = invalid or keyBa = invalid or msgBa = invalid then return ""
  pinBytes = syncUtf8Bytes(pin)
  for i = 0 to pinBytes.Count() - 1
    keyBa.Push(pinBytes[i])
  end for
  saltBytes = syncHexToBytes(saltHex)
  for i = 0 to saltBytes.Count() - 1
    msgBa.Push(saltBytes[i])
  end for
  msgBa.Push(0) : msgBa.Push(0) : msgBa.Push(0) : msgBa.Push(1)
  if hm.Setup("sha256", keyBa) <> 0 then return ""
  u = hm.Process(msgBa)
  if u = invalid or u.Count() <> 32 then return ""
  acc = []
  for i = 0 to 31
    acc.Push(u[i])
  end for
  for iter = 2 to iterations
    if hm.Setup("sha256", keyBa) <> 0 then return ""
    u = hm.Process(u)
    if u = invalid or u.Count() <> 32 then return ""
    for i = 0 to 31
      b = acc[i]
      ub = u[i]
      acc[i] = (b or ub) - (b and ub)
    end for
  end for
  return syncBytesToHex(acc)
end function

' ---- Canonical JSON ----

function syncEscapeJsonString(text as String) as String
  q = Chr(34)
  if Instr(1, text, q) = 0 and Instr(1, text, "\") = 0 and not CreateObject("roRegex", "[\x01-\x1f]", "").IsMatch(text) and Instr(1, text, Chr(0)) = 0
    return q + text + q
  end if
  hexDigits = "0123456789abcdef"
  out = q
  n = Len(text)
  for i = 1 to n
    ch = Mid(text, i, 1)
    c = Asc(ch)
    if c < 0 then c = c + 65536
    if c = 34
      out = out + "\" + q
    else if c = 92
      out = out + "\\"
    else if c = 8
      out = out + "\b"
    else if c = 12
      out = out + "\f"
    else if c = 10
      out = out + "\n"
    else if c = 13
      out = out + "\r"
    else if c = 9
      out = out + "\t"
    else if c < 32
      out = out + "\u00" + Mid(hexDigits, Int(c / 16) + 1, 1) + Mid(hexDigits, (c mod 16) + 1, 1)
    else
      out = out + ch
    end if
  end for
  return out + q
end function

function syncSortStrings(items as Object) as Object
  out = []
  for i = 0 to items.Count() - 1
    out.Push(items[i])
  end for
  for i = 1 to out.Count() - 1
    cur = out[i]
    j = i - 1
    while j >= 0 and out[j] > cur
      out[j + 1] = out[j]
      j = j - 1
    end while
    out[j + 1] = cur
  end for
  return out
end function

function syncCanonicalJson(value as Dynamic) as String
  if value = invalid then return "null"
  t = Type(value)
  if t = "Boolean" or t = "roBoolean"
    if value = true then return "true"
    return "false"
  end if
  if t = "Integer" or t = "roInt" or t = "roInteger"
    return StrI(value).Trim()
  end if
  if t = "LongInteger" or t = "roLongInteger"
    return value.ToStr().Trim()
  end if
  if t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble"
    if value = 0 then return "0"
    s = FormatJson(value).Trim()
    if Right(s, 2) = ".0" then s = Left(s, Len(s) - 2)
    if s = "-0" then s = "0"
    return s
  end if
  if t = "String" or t = "roString"
    return syncEscapeJsonString(value)
  end if
  if GetInterface(value, "ifArray") <> invalid
    parts = []
    for i = 0 to value.Count() - 1
      parts.Push(syncCanonicalJson(value[i]))
    end for
    return "[" + parts.Join(",") + "]"
  end if
  if GetInterface(value, "ifAssociativeArray") <> invalid
    keys = syncSortStrings(value.Keys())
    parts = []
    for i = 0 to keys.Count() - 1
      k = keys[i]
      parts.Push(syncEscapeJsonString(k) + ":" + syncCanonicalJson(value[k]))
    end for
    return "{" + parts.Join(",") + "}"
  end if
  return "null"
end function

function syncValueHash(value as Dynamic) as String
  return syncSha256Base64Url(syncCanonicalJson(value))
end function

function syncValueBytes(value as Dynamic) as Integer
  return syncUtf8Bytes(syncCanonicalJson(value)).Count()
end function

' ---- Time & ISO8601 ----

function syncNowMs() as LongInteger
  if m.syncTestNowMs <> invalid then return m.syncTestNowMs
  dt = CreateObject("roDateTime")
  return dt.AsSeconds() * 1000& + dt.GetMilliseconds() * 1&
end function

function syncMaxLong(a as LongInteger, b as LongInteger) as LongInteger
  if a >= b then return a
  return b
end function

function syncMinLong(a as LongInteger, b as LongInteger) as LongInteger
  if a <= b then return a
  return b
end function

function syncDaysInMonth(year as Integer, month as Integer) as Integer
  if month = 2
    leap = (year mod 4 = 0 and year mod 100 <> 0) or (year mod 400 = 0)
    if leap then return 29
    return 28
  end if
  if month = 4 or month = 6 or month = 9 or month = 11 then return 30
  return 31
end function

function syncParseIsoMs(raw as Dynamic) as Dynamic
  if Type(raw) <> "String" and Type(raw) <> "roString" then return invalid
  rx = CreateObject("roRegex", "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$", "")
  if not rx.IsMatch(raw) then return invalid
  yr = Int(Val(Mid(raw, 1, 4)))
  mo = Int(Val(Mid(raw, 6, 2)))
  da = Int(Val(Mid(raw, 9, 2)))
  hr = Int(Val(Mid(raw, 12, 2)))
  mn = Int(Val(Mid(raw, 15, 2)))
  sc = Int(Val(Mid(raw, 18, 2)))
  if mo < 1 or mo > 12 then return invalid
  if da < 1 or da > syncDaysInMonth(yr, mo) then return invalid
  if hr < 0 or hr > 23 or mn < 0 or mn > 59 or sc < 0 or sc > 59 then return invalid

  idx = 20
  ms = 0
  if Mid(raw, idx, 1) = "."
    idx = idx + 1
    frac = ""
    while idx <= Len(raw)
      ch = Mid(raw, idx, 1)
      code = Asc(ch)
      if code < 48 or code > 57 then exit while
      if Len(frac) < 3 then frac = frac + ch
      idx = idx + 1
    end while
    while Len(frac) < 3
      frac = frac + "0"
    end while
    ms = Int(Val(frac))
  end if

  tzSec = 0&
  tzChar = Mid(raw, idx, 1)
  if tzChar <> "Z"
    sign = 1&
    if tzChar = "-" then sign = -1&
    tzh = Int(Val(Mid(raw, idx + 1, 2)))
    tzm = Int(Val(Mid(raw, idx + 4, 2)))
    if tzh > 23 or tzm > 59 then return invalid
    tzSec = sign * (tzh * 3600& + tzm * 60&)
  end if

  y = yr
  if mo <= 2 then y = y - 1
  era = Int(y / 400)
  if y < 0 then era = Int((y - 399) / 400)
  yoe = y - era * 400
  mAdj = mo + 9
  if mo > 2 then mAdj = mo - 3
  doy = Int((153 * mAdj + 2) / 5) + da - 1
  doe = yoe * 365 + Int(yoe / 4) - Int(yoe / 100) + doy
  days = (era * 146097 + doe - 719468) * 1&
  return (days * 86400& + hr * 3600& + mn * 60& + sc - tzSec) * 1000& + ms * 1&
end function

function syncPad2(n as Integer) as String
  s = StrI(n).Trim()
  if Len(s) < 2 then return "0" + s
  return s
end function

function syncPad3(n as Integer) as String
  s = StrI(n).Trim()
  while Len(s) < 3
    s = "0" + s
  end while
  return s
end function

function syncPad4(n as Integer) as String
  s = StrI(n).Trim()
  while Len(s) < 4
    s = "0" + s
  end while
  return s
end function

function syncIsoFromMs(totalMs as LongInteger) as String
  remDay = totalMs mod 86400000&
  if remDay < 0 then remDay = remDay + 86400000&
  days = Int(((totalMs - remDay) * 1.0#) / 86400000.0#)
  msOfDay = Int(remDay)
  ms = msOfDay mod 1000
  secOfDay = Int((msOfDay - ms) / 1000)
  hr = Int(secOfDay / 3600)
  mn = Int((secOfDay mod 3600) / 60)
  sc = secOfDay mod 60

  z = days + 719468
  era = Int(z / 146097)
  if z < 0 then era = Int((z - 146096) / 146097)
  doe = z - era * 146097
  yoe = Int((doe - Int(doe / 1460) + Int(doe / 36524) - Int(doe / 146096)) / 365)
  y = yoe + era * 400
  doy = doe - (365 * yoe + Int(yoe / 4) - Int(yoe / 100))
  mp = Int((5 * doy + 2) / 153)
  da = doy - Int((153 * mp + 2) / 5) + 1
  mo = mp - 9
  if mp < 10 then mo = mp + 3
  if mo <= 2 then y = y + 1

  return syncPad4(y) + "-" + syncPad2(mo) + "-" + syncPad2(da) + "T" + syncPad2(hr) + ":" + syncPad2(mn) + ":" + syncPad2(sc) + "." + syncPad3(ms) + "Z"
end function

function syncIsoTimestamp(raw as Dynamic, fallbackMs as LongInteger) as String
  ms = syncParseIsoMs(raw)
  if ms <> invalid then return raw
  return syncIsoFromMs(fallbackMs)
end function

' ---- Schema validation (apps/core/src/sync/schema.ts) ----

function syncIsString(v as Dynamic) as Boolean
  if v = invalid then return false
  t = Type(v)
  return t = "String" or t = "roString"
end function

function syncIsBool(v as Dynamic) as Boolean
  if v = invalid then return false
  t = Type(v)
  return t = "Boolean" or t = "roBoolean"
end function

function syncIsNumber(v as Dynamic) as Boolean
  if v = invalid then return false
  t = Type(v)
  return t = "Integer" or t = "roInt" or t = "roInteger" or t = "LongInteger" or t = "roLongInteger" or t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble"
end function

function syncAsSafeInt(v as Dynamic) as Dynamic
  if not syncIsNumber(v) then return invalid
  t = Type(v)
  if t = "Integer" or t = "roInt" or t = "roInteger" then return v * 1&
  if t = "LongInteger" or t = "roLongInteger"
    if v > 9007199254740991& or v < -9007199254740991& then return invalid
    return v
  end if
  ' Float or Double: ensure whole number within safe integer range without 32-bit Fix overflow
  if v > 9007199254740991.0# or v < -9007199254740991.0# then return invalid
  s = FormatJson(v).Trim()
  if Right(s, 2) = ".0" then s = Left(s, Len(s) - 2)
  if Instr(1, s, ".") > 0 or Instr(1, LCase(s), "e") > 0 then return invalid
  if v >= -2147483647.0# and v <= 2147483647.0# then return Int(v) * 1&
  return Int(v / 1000.0#) * 1000& + Int(v - Int(v / 1000.0#) * 1000.0#) * 1&
end function

function syncOnlyAllowedKeys(obj as Dynamic, allowed as Object) as Boolean
  if obj = invalid or GetInterface(obj, "ifAssociativeArray") = invalid then return false
  for each k in obj
    if not syncArrayContains(allowed, k) then return false
  end for
  return true
end function

function syncDisplayText(v as Dynamic, required = false as Boolean) as Boolean
  if not syncIsString(v) then return false
  if required and v.Trim() = "" then return false
  if CreateObject("roRegex", "\b(bearer\s+|(password|api[_ -]?key|(rd|session)[_ -]?token)\s*[:=]|https?://)", "i").IsMatch(v) then return false
  return true
end function

function syncValidTime(v as Dynamic) as Boolean
  return syncParseIsoMs(v) <> invalid
end function

function syncValidProfileId(v as Dynamic) as Boolean
  if not syncIsString(v) then return false
  if not CreateObject("roRegex", "^[0-9a-zA-Z][0-9a-zA-Z_-]{0,79}$", "").IsMatch(v) then return false
  if CreateObject("roRegex", "^(con|prn|aux|nul|com[0-9]|lpt[0-9])$", "i").IsMatch(v) then return false
  return true
end function

function syncValidMediaId(v as Dynamic) as Boolean
  if not syncIsString(v) then return false
  return CreateObject("roRegex", "^[0-9a-zA-Z][0-9a-zA-Z._:-]{0,198}$", "").IsMatch(v)
end function

function syncSafeArtwork(v as Dynamic) as Boolean
  if not syncIsString(v) then return false
  if v = "" then return true
  pattern = "^https://(images\.metahub\.space|live\.metahub\.space|image\.tmdb\.org|([a-z0-9-]+\.)?mzstatic\.com|([a-z0-9-]+\.)?tvmaze\.com|([a-z0-9-]+\.)?kitsu\.io|([a-z0-9-]+\.)?fanart\.tv|m\.media-amazon\.com|image\.tving\.com|artworks\.tvm\.gl)/[a-zA-Z0-9./_%~@-]+$"
  return CreateObject("roRegex", pattern, "").IsMatch(v)
end function

function syncPublicArtwork(v as Dynamic) as String
  if syncSafeArtwork(v) then return v
  return ""
end function

function syncValidPreference(key as String, value as Dynamic) as Boolean
  if key = "subtitleLanguages"
    if value = invalid or GetInterface(value, "ifArray") = invalid then return false
    if value.Count() > 20 then return false
    rx = CreateObject("roRegex", "^[a-z]{2,3}(-[A-Za-z]{2,4})?$", "")
    for i = 0 to value.Count() - 1
      if not syncIsString(value[i]) or not rx.IsMatch(value[i]) then return false
    end for
    return true
  else if key = "audioLanguage"
    if not syncIsString(value) then return false
    return CreateObject("roRegex", "^(original|[a-z]{3})$", "").IsMatch(value)
  else if key = "skipSegments"
    return syncIsString(value) and (value = "off" or value = "button" or value = "auto")
  else if key = "autoplayNext"
    return syncIsBool(value)
  else if key = "subtitleStyle"
    if not syncOnlyAllowedKeys(value, ["size", "color", "background"]) then return false
    sz = lcAaGet(value, "size", invalid)
    cl = lcAaGet(value, "color", invalid)
    bg = lcAaGet(value, "background", invalid)
    if not syncIsString(sz) or not syncIsString(cl) or not syncIsString(bg) then return false
    return CreateObject("roRegex", "^(s|m|l|xl)$", "").IsMatch(sz) and CreateObject("roRegex", "^(white|yellow|cyan)$", "").IsMatch(cl) and CreateObject("roRegex", "^(shadow|box|none)$", "").IsMatch(bg)
  else if key = "homeSections"
    if value = invalid or GetInterface(value, "ifArray") = invalid then return false
    if value.Count() > 100 then return false
    rx = CreateObject("roRegex", "^[a-z0-9][a-z0-9-]{0,63}$", "i")
    for i = 0 to value.Count() - 1
      row = value[i]
      if not syncOnlyAllowedKeys(row, ["id", "visible"]) then return false
      if not syncIsString(lcAaGet(row, "id", invalid)) or not rx.IsMatch(row.id) then return false
      if not syncIsBool(lcAaGet(row, "visible", invalid)) then return false
    end for
    return true
  end if
  return syncPrefKeySet().DoesExist(key) and syncIsBool(value)
end function

function syncValidKey(kind as String, key as Dynamic) as Boolean
  if not syncIsString(key) then return false
  if Len(key) < 1 or Len(key) > 200 then return false
  if kind = "profile" then return syncValidProfileId(key)
  if kind = "preference" then return syncPrefKeySet().DoesExist(key)
  slash = Instr(1, key, "/")
  if slash <= 1 then return false
  return syncValidProfileId(Left(key, slash - 1)) and syncValidMediaId(Mid(key, slash + 1))
end function

function syncValidValue(kind as String, key as String, value as Dynamic) as Boolean
  if kind = "preference" then return syncValidPreference(key, value)
  if kind = "profile"
    if not syncOnlyAllowedKeys(value, ["id", "name", "hue", "created", "avatar", "kind", "maxAge", "pin"]) then return false
    if lcAaGet(value, "id", invalid) <> key then return false
    name = lcAaGet(value, "name", invalid)
    if not syncDisplayText(name, true) or Len(name) > 40 then return false
    hue = lcAaGet(value, "hue", invalid)
    if not syncIsNumber(hue) or hue < 0 or hue >= 360 then return false
    if not syncValidTime(lcAaGet(value, "created", invalid)) then return false
    avatar = lcAaGet(value, "avatar", invalid)
    if avatar <> invalid
      if not syncIsString(avatar) or not CreateObject("roRegex", "^[a-z0-9-]{1,40}/[a-z0-9-]{1,40}$", "").IsMatch(avatar) then return false
    end if
    pkind = lcAaGet(value, "kind", invalid)
    if not syncIsString(pkind) or (pkind <> "standard" and pkind <> "kids") then return false
    maxAge = lcAaGet(value, "maxAge", invalid)
    if not syncIsNumber(maxAge) then return false
    if maxAge <> 7 and maxAge <> 12 and maxAge <> 15 and maxAge <> 18 then return false
    pin = lcAaGet(value, "pin", invalid)
    if pin <> invalid
      if not syncOnlyAllowedKeys(pin, ["hash", "salt", "iter"]) then return false
      h = lcAaGet(pin, "hash", invalid)
      s = lcAaGet(pin, "salt", invalid)
      it = lcAaGet(pin, "iter", invalid)
      if not syncIsString(h) or not CreateObject("roRegex", "^[a-f0-9]{64}$", "i").IsMatch(h) then return false
      if not syncIsString(s) or not CreateObject("roRegex", "^[a-f0-9]{32}$", "i").IsMatch(s) then return false
      if not syncIsNumber(it) or it <> 20000 then return false
    end if
    return true
  end if
  if kind = "progress"
    if not syncOnlyAllowedKeys(value, ["position", "duration", "updated", "hiddenFromContinueWatching", "completedAt", "completions", "completedTitle", "completedYear"]) then return false
    posSec = lcAaGet(value, "position", invalid)
    dur = lcAaGet(value, "duration", invalid)
    if not syncIsNumber(posSec) or posSec < 0 or not syncIsNumber(dur) or dur < 0 then return false
    if not syncValidTime(lcAaGet(value, "updated", invalid)) then return false
    if value.DoesExist("hiddenFromContinueWatching") and value.hiddenFromContinueWatching <> invalid
      if not syncIsBool(value.hiddenFromContinueWatching) then return false
    end if
    if value.DoesExist("completedAt") and value.completedAt <> invalid
      if not syncValidTime(value.completedAt) then return false
    end if
    if value.DoesExist("completions") and value.completions <> invalid
      comp = syncAsSafeInt(value.completions)
      if comp = invalid or comp < 0 then return false
    end if
    if value.DoesExist("completedTitle") and value.completedTitle <> invalid
      if not syncDisplayText(value.completedTitle) then return false
    end if
    if value.DoesExist("completedYear") and value.completedYear <> invalid
      if not syncIsNumber(value.completedYear) then return false
    end if
    return true
  end if
  ' watchlist
  if not syncOnlyAllowedKeys(value, ["id", "title", "year", "kind", "synopsis", "poster", "backdrop", "genres", "rating", "playable", "hue", "added"]) then return false
  slash = Instr(1, key, "/")
  if lcAaGet(value, "id", invalid) <> Mid(key, slash + 1) then return false
  if not syncDisplayText(lcAaGet(value, "title", invalid), true) then return false
  if not value.DoesExist("year") then return false
  if value.year <> invalid and not syncIsNumber(value.year) then return false
  mkind = lcAaGet(value, "kind", invalid)
  if not syncIsString(mkind) or not CreateObject("roRegex", "^(movie|series|file)$", "").IsMatch(mkind) then return false
  if not syncDisplayText(lcAaGet(value, "synopsis", invalid)) then return false
  if not syncSafeArtwork(lcAaGet(value, "poster", invalid)) then return false
  if not syncSafeArtwork(lcAaGet(value, "backdrop", invalid)) then return false
  genres = lcAaGet(value, "genres", invalid)
  if genres = invalid or GetInterface(genres, "ifArray") = invalid then return false
  for i = 0 to genres.Count() - 1
    if not syncDisplayText(genres[i]) then return false
  end for
  if not syncDisplayText(lcAaGet(value, "rating", invalid)) then return false
  if not syncIsBool(lcAaGet(value, "playable", invalid)) then return false
  if not syncIsNumber(lcAaGet(value, "hue", invalid)) then return false
  if not syncValidTime(lcAaGet(value, "added", invalid)) then return false
  return true
end function

function syncParseItem(raw as Dynamic, nowMs as LongInteger) as Dynamic
  if not syncOnlyAllowedKeys(raw, ["kind", "key", "value", "updatedAt", "deleted"]) then return invalid
  kind = lcAaGet(raw, "kind", invalid)
  if not syncIsString(kind) or not syncArrayContains(syncKinds(), kind) then return invalid
  key = lcAaGet(raw, "key", invalid)
  if not syncValidKey(kind, key) then return invalid
  updatedAt = syncAsSafeInt(lcAaGet(raw, "updatedAt", invalid))
  if updatedAt = invalid or updatedAt < 0& or updatedAt > nowMs + syncFutureMs() then return invalid
  deleted = false
  if raw.DoesExist("deleted") and raw.deleted <> invalid
    if not syncIsBool(raw.deleted) then return invalid
    deleted = (raw.deleted = true)
  end if
  val = lcAaGet(raw, "value", invalid)
  if deleted
    if val <> invalid then return invalid
    return { kind: kind, key: key, value: invalid, updatedAt: updatedAt, deleted: true }
  end if
  if not syncValidValue(kind, key, val) then return invalid
  if syncValueBytes(val) > syncMaxValueBytes() then return invalid
  return { kind: kind, key: key, value: val, updatedAt: updatedAt, deleted: false }
end function

' ---- Ledger & Syncable Prefs Persistence ----

function syncEmptyLedger() as Object
  return { v: {}, p: {}, s: 0&, g: invalid, l: invalid, d: false, f: 0, r: 0&, e: invalid }
end function

function syncReadLedger() as Object
  sec = lcReg()
  raw = ""
  if sec <> invalid and sec.Exists("syncLedger")
    raw = sec.Read("syncLedger")
    if raw = "__cachefs__"
      raw = ReadAsciiFile("cachefs:/tvm_sync_ledger.json")
    end if
  end if
  if raw = invalid or raw = "" then return syncEmptyLedger()
  parsed = ParseJson(raw)
  if parsed = invalid or GetInterface(parsed, "ifAssociativeArray") = invalid then return syncEmptyLedger()
  out = syncEmptyLedger()
  v = lcAaGet(parsed, "v", {})
  if GetInterface(v, "ifAssociativeArray") <> invalid
    for each id in v
      entry = v[id]
      if GetInterface(entry, "ifArray") <> invalid and entry.Count() >= 2
        ts = syncAsSafeInt(entry[0])
        if ts = invalid then ts = 0&
        out.v[id] = [ts, entry[1]]
      end if
    end for
  end if
  p = lcAaGet(parsed, "p", {})
  if GetInterface(p, "ifAssociativeArray") <> invalid then out.p = p
  s = syncAsSafeInt(lcAaGet(parsed, "s", 0&))
  if s <> invalid then out.s = s
  out.g = lcAaGet(parsed, "g", invalid)
  l = syncAsSafeInt(lcAaGet(parsed, "l", invalid))
  if l <> invalid then out.l = l
  out.d = lcAaBool(parsed, "d", false)
  out.f = lcAaInt(parsed, "f", 0)
  r = syncAsSafeInt(lcAaGet(parsed, "r", 0&))
  if r <> invalid then out.r = r
  out.e = lcAaGet(parsed, "e", invalid)
  return out
end function

sub syncWriteLedger(ledger as Object)
  sec = lcReg()
  if sec = invalid then return
  raw = syncCanonicalJson(ledger)
  if Len(raw) <= 6500
    sec.Write("syncLedger", raw)
    if sec.Flush()
      DeleteFile("cachefs:/tvm_sync_ledger.json")
      return
    end if
  end if
  WriteAsciiFile("cachefs:/tvm_sync_ledger.json", raw)
  sec.Write("syncLedger", "__cachefs__")
  sec.Flush()
end sub

function syncPrefDefaults() as Object
  defaults = {
    "subtitleLanguages": ["eng"]
    "subtitleStyle": { size: "m", color: "white", background: "shadow" }
    "audioLanguage": "original"
    "skipSegments": "button"
    "autoplayNext": true
    "homeSections": []
  }
  extras = lcExtraDefaults()
  for each id in syncExtrasKeys()
    defaults["extras." + id] = lcAaBool(extras, id, true)
  end for
  return defaults
end function

function syncReadPrefs() as Object
  raw = lcReadRegJson("syncPrefs", {})
  if GetInterface(raw, "ifAssociativeArray") = invalid then return {}
  return raw
end function

sub syncWritePrefs(values as Object)
  lcWriteRegJson("syncPrefs", values)
end sub

sub syncStripSyncableFromExtrasPrefs()
  all = lcReadRegJson("extrasPrefs", {})
  if GetInterface(all, "ifAssociativeArray") = invalid or all.Count() = 0 then return
  syncExtras = syncExtrasKeys()
  topKeys = ["subtitleLanguages", "subtitleStyle", "audioLanguage", "skipSegments", "autoplayNext", "homeSections"]
  changed = false
  for each pid in all
    prefs = all[pid]
    if GetInterface(prefs, "ifAssociativeArray") <> invalid
      for each k in topKeys
        if prefs.DoesExist(k)
          prefs.Delete(k)
          changed = true
        end if
      end for
      extras = lcAaGet(prefs, "extras", invalid)
      if GetInterface(extras, "ifAssociativeArray") <> invalid
        for each ek in syncExtras
          if extras.DoesExist(ek)
            extras.Delete(ek)
            changed = true
          end if
        end for
      end if
    end if
  end for
  if changed then lcWriteRegJson("extrasPrefs", all)
end sub

sub syncClearAllSyncedState(clearOwner = false as Boolean)
  sec = lcReg()
  if sec <> invalid
    keys = ["syncLedger", "syncPrefs", "localProfiles", "localProgress", "localFinished", "localWatchlist"]
    if clearOwner then keys.Push("syncOwner")
    for each k in keys
      if sec.Exists(k) then sec.Delete(k)
    end for
    sec.Flush()
  end if
  DeleteFile("cachefs:/tvm_sync_ledger.json")
  DeleteFile("tmp:/tvm_sync_session.json")
  syncStripSyncableFromExtrasPrefs()
end sub

sub syncClearOnSignOut()
  syncClearAllSyncedState(false)
end sub

sub syncResetBackoff()
  sec = lcReg()
  if sec = invalid or not sec.Exists("syncLedger") then return
  ledger = syncReadLedger()
  ledger.d = false
  ledger.f = 0
  ledger.r = 0&
  ledger.e = invalid
  syncWriteLedger(ledger)
end sub

sub syncImportLegacyPrefs()
  existing = syncReadPrefs()
  if existing.Count() > 0 then return
  all = lcReadRegJson("extrasPrefs", {})
  if GetInterface(all, "ifAssociativeArray") = invalid or all.Count() = 0 then return
  profData = lcReadRegJson("localProfiles", {})
  pid = lcAaText(profData, "activeId", "main")
  prefs = lcAaGet(all, pid, invalid)
  if prefs = invalid
    for each k in all
      prefs = all[k]
      exit for
    end for
  end if
  if prefs = invalid or GetInterface(prefs, "ifAssociativeArray") = invalid then return
  defaults = syncPrefDefaults()
  chosen = {}
  for each key in syncPrefKeys()
    val = invalid
    if Left(key, 7) = "extras."
      exMap = lcAaGet(prefs, "extras", invalid)
      if exMap <> invalid and exMap.DoesExist(Mid(key, 8)) then val = exMap[Mid(key, 8)]
    else if prefs.DoesExist(key)
      val = prefs[key]
    end if
    if val <> invalid and syncValidPreference(key, val)
      if syncCanonicalJson(val) <> syncCanonicalJson(defaults[key])
        chosen[key] = val
      end if
    end if
  end for
  if chosen.Count() > 0 then syncWritePrefs(chosen)
end sub

sub syncEnsureAccount(accountId as String)
  if accountId = "" then return
  digest = syncSha256Hex(accountId)
  sec = lcReg()
  if sec = invalid then return
  owner = ""
  if sec.Exists("syncOwner") then owner = sec.Read("syncOwner")
  if owner = ""
    sec.Write("syncOwner", digest)
    sec.Flush()
    syncImportLegacyPrefs()
  else if owner <> digest
    syncClearAllSyncedState(false)
    sec.Write("syncOwner", digest)
    sec.Flush()
  end if
end sub

sub syncBindAccount(token as String, accountId as String)
  if token = "" or accountId = "" then return
  syncEnsureAccount(accountId)
  lcWriteTmpJson("tvm_sync_session.json", { th: syncSha256Hex(token), aid: accountId })
end sub

' ---- Local Store Snapshot & Apply ----

function syncUntouchedProfile(p as Object) as Boolean
  name = lcAaText(p, "name", "")
  id = lcAaText(p, "id", "")
  hue = lcAaInt(p, "hue", 220)
  isDefaultNameHue = (name = "Profile 1" and hue = 221) or (id = "main" and name = "Main" and hue = 220)
  if not isDefaultNameHue then return false
  if lcAaGet(p, "avatar", invalid) <> invalid then return false
  if lcAaGet(p, "pin", invalid) <> invalid then return false
  if lcAaText(p, "kind", "standard") <> "standard" then return false
  if lcAaInt(p, "maxAge", 18) <> 18 then return false
  return true
end function

function syncValidCorePin(pin as Dynamic) as Dynamic
  if pin = invalid or GetInterface(pin, "ifAssociativeArray") = invalid then return invalid
  if not pin.DoesExist("iter") then return invalid
  if lcAaInt(pin, "iter", 0) <> 20000 then return invalid
  h = lcAaText(pin, "hash", "")
  s = lcAaText(pin, "salt", "")
  if not CreateObject("roRegex", "^[a-f0-9]{64}$", "i").IsMatch(h) then return invalid
  if not CreateObject("roRegex", "^[a-f0-9]{32}$", "i").IsMatch(s) then return invalid
  return { hash: h, salt: s, iter: 20000 }
end function

function syncSnapshot(nowMs as LongInteger, knownProfiles as Object) as Object
  result = {}
  mediaProfiles = {}

  regProfiles = lcProfilesStore()
  allProg = lcReadRegJson("localProgress", {})
  if GetInterface(allProg, "ifAssociativeArray") = invalid then allProg = {}
  allFin = lcReadRegJson("localFinished", {})
  if GetInterface(allFin, "ifAssociativeArray") = invalid then allFin = {}
  allWl = lcReadRegJson("localWatchlist", {})
  if GetInterface(allWl, "ifAssociativeArray") = invalid then allWl = {}

  finMutated = false
  progMutated = false
  wlMutated = false

  ' Collect all profile IDs that appear in profiles, progress, finished, or watchlist
  pids = {}
  for each p in regProfiles.profiles
    pid = lcAaText(p, "id", "")
    if syncValidProfileId(pid) then pids[pid] = true
  end for
  for each pid in allProg
    if syncValidProfileId(pid) then pids[pid] = true
  end for
  for each pid in allFin
    if syncValidProfileId(pid) then pids[pid] = true
  end for
  for each pid in allWl
    if syncValidProfileId(pid) then pids[pid] = true
  end for

  for each pid in pids
    pm = lcAaGet(allProg, pid, {})
    if GetInterface(pm, "ifAssociativeArray") <> invalid
      for each mediaId in pm
        entry = pm[mediaId]
        if GetInterface(entry, "ifAssociativeArray") <> invalid
          updatedIso = lcAaText(entry, "updated", "")
          if syncParseIsoMs(updatedIso) = invalid
            fallbackSec = lcAaInt(entry, "updatedAt", 0)
            fallbackMs = nowMs
            if fallbackSec > 0 then fallbackMs = fallbackSec * 1000&
            updatedIso = syncIsoFromMs(fallbackMs)
            entry.updated = updatedIso
            progMutated = true
          end if
          val = syncProjectProgressValue(entry, nowMs)
          updatedMs = syncParseIsoMs(val.updated)
          if updatedMs = invalid then updatedMs = nowMs
          syncSnapshotAdd(result, mediaProfiles, "progress", pid + "/" + mediaId, val, updatedMs, updatedMs, nowMs)
        end if
      end for
    end if

    fin = lcAaGet(allFin, pid, {})
    if GetInterface(fin, "ifAssociativeArray") <> invalid
      for each mediaId in fin
        if GetInterface(pm, "ifAssociativeArray") = invalid or not pm.DoesExist(mediaId)
          entry = fin[mediaId]
          if Type(entry) = "Boolean" or Type(entry) = "roBoolean"
            if entry = true
              entry = { position: 1, duration: 1, updated: syncIsoFromMs(nowMs), "hiddenFromContinueWatching": false, "completedAt": syncIsoFromMs(nowMs), completions: 1 }
              fin[mediaId] = entry
              finMutated = true
            end if
          end if
          if GetInterface(entry, "ifAssociativeArray") <> invalid
            val = syncProjectProgressValue(entry, nowMs)
            updatedMs = syncParseIsoMs(val.updated)
            if updatedMs = invalid then updatedMs = nowMs
            syncSnapshotAdd(result, mediaProfiles, "progress", pid + "/" + mediaId, val, updatedMs, updatedMs, nowMs)
          end if
        end if
      end for
    end if

    wl = lcAaGet(allWl, pid, [])
    if GetInterface(wl, "ifArray") <> invalid
      for i = 0 to wl.Count() - 1
        entry = wl[i]
        if GetInterface(entry, "ifAssociativeArray") <> invalid
          addedIso = lcAaText(entry, "added", "")
          if syncParseIsoMs(addedIso) = invalid
            addedIso = syncIsoFromMs(nowMs)
            entry.added = addedIso
            wlMutated = true
          end if
          addedMs = syncParseIsoMs(addedIso)
          if addedMs = invalid then addedMs = nowMs
          val = syncProjectWatchlistValue(entry, addedIso)
          syncSnapshotAdd(result, mediaProfiles, "watchlist", pid + "/" + lcAaText(val, "id", ""), val, addedMs, addedMs, nowMs)
        end if
      end for
    end if
  end for

  if progMutated then lcWriteRegJson("localProgress", allProg)
  if finMutated then lcWriteRegJson("localFinished", allFin)
  if wlMutated then lcWriteRegJson("localWatchlist", allWl)

  for each row in regProfiles.profiles
    pid = lcAaText(row, "id", "")
    if syncValidProfileId(pid)
      untouched = syncUntouchedProfile(row)
      if not untouched or mediaProfiles.DoesExist(pid) or knownProfiles.DoesExist(pid)
        createdMs = syncParseIsoMs(lcAaText(row, "created", ""))
        if createdMs = invalid then createdMs = nowMs
        kind = lcAaText(row, "kind", "standard")
        if kind <> "kids" then kind = "standard"
        maxAge = lcAaInt(row, "maxAge", 18)
        if maxAge <> 7 and maxAge <> 12 and maxAge <> 15 and maxAge <> 18 then maxAge = 18
        hue = lcAaInt(row, "hue", 220) mod 360
        if hue < 0 then hue = hue + 360
        val = {
          id: pid
          name: lcAaText(row, "name", "Profile")
          hue: hue
          created: syncIsoTimestamp(lcAaText(row, "created", ""), createdMs)
          avatar: lcAaGet(row, "avatar", invalid)
          kind: kind
          "maxAge": maxAge
          pin: syncValidCorePin(lcAaGet(row, "pin", invalid))
        }
        initial = createdMs
        if untouched then initial = 0&
        syncSnapshotAdd(result, mediaProfiles, "profile", pid, val, initial, nowMs, nowMs)
      end if
    end if
  end for

  prefs = syncReadPrefs()
  for each key in prefs
    syncSnapshotAdd(result, mediaProfiles, "preference", key, prefs[key], nowMs, nowMs, nowMs)
  end for

  return result
end function

function syncProjectProgressValue(entry as Object, fallbackMs as LongInteger) as Object
  updatedIso = syncIsoTimestamp(lcAaText(entry, "updated", ""), fallbackMs)
  val = {
    position: lcAaGet(entry, "position", 0)
    duration: lcAaGet(entry, "duration", 0)
    updated: updatedIso
  }
  if entry.DoesExist("hiddenFromContinueWatching") and entry.hiddenFromContinueWatching <> invalid
    val["hiddenFromContinueWatching"] = (entry.hiddenFromContinueWatching = true)
  end if
  if entry.DoesExist("completedAt") and entry.completedAt <> invalid
    val["completedAt"] = syncIsoTimestamp(lcAaText(entry, "completedAt", ""), fallbackMs)
  end if
  if entry.DoesExist("completions") and entry.completions <> invalid
    val["completions"] = lcAaInt(entry, "completions", 0)
  end if
  if entry.DoesExist("completedTitle") and entry.completedTitle <> invalid
    val["completedTitle"] = lcAaText(entry, "completedTitle", "")
  end if
  if entry.DoesExist("completedYear") and entry.completedYear <> invalid
    val["completedYear"] = entry.completedYear
  end if
  return val
end function

function syncProjectWatchlistValue(entry as Object, addedIso as String) as Object
  kind = LCase(lcAaText(entry, "kind", "movie"))
  if kind <> "series" and kind <> "file" then kind = "movie"
  genres = []
  rawGenres = lcAaGet(entry, "genres", [])
  if GetInterface(rawGenres, "ifArray") <> invalid
    for i = 0 to rawGenres.Count() - 1
      if syncIsString(rawGenres[i]) then genres.Push(rawGenres[i])
    end for
  end if
  yearVal = invalid
  if entry.DoesExist("year") and syncIsNumber(entry.year) then yearVal = entry.year
  return {
    id: lcAaText(entry, "id", "")
    title: lcAaText(entry, "title", "")
    year: yearVal
    kind: kind
    synopsis: lcAaText(entry, "synopsis", "")
    poster: syncPublicArtwork(lcAaText(entry, "poster", ""))
    backdrop: syncPublicArtwork(lcAaText(entry, "backdrop", ""))
    genres: genres
    rating: lcAaText(entry, "rating", "")
    playable: lcAaBool(entry, "playable", false)
    hue: lcAaInt(entry, "hue", 220)
    added: addedIso
  }
end function

sub syncSnapshotAdd(result as Object, mediaProfiles as Object, kind as String, key as String, value as Dynamic, initial as LongInteger, changedAt as LongInteger, nowMs as LongInteger)
  clamped = initial
  if clamped > nowMs then clamped = nowMs
  if clamped < 0& then clamped = 0&
  item = syncParseItem({ kind: kind, key: key, value: value, "updatedAt": clamped, deleted: false }, nowMs)
  if item <> invalid
    id = kind + ":" + key
    result[id] = { item: item, hash: syncValueHash(value), changedAt: changedAt }
    if kind = "progress" or kind = "watchlist"
      slash = Instr(1, key, "/")
      if slash > 1 then mediaProfiles[Left(key, slash - 1)] = true
    end if
  end if
end sub

sub syncApplyItems(items as Object)
  groups = {}
  for i = 0 to items.Count() - 1
    item = items[i]
    gkey = item.kind
    if item.kind = "progress" or item.kind = "watchlist"
      slash = Instr(1, item.key, "/")
      gkey = item.kind + ":" + Left(item.key, slash - 1)
    end if
    if not groups.DoesExist(gkey) then groups[gkey] = []
    groups[gkey].Push(item)
  end for

  for each gkey in groups
    group = groups[gkey]
    kind = group[0].kind
    if kind = "profile"
      reg = lcProfilesStore()
      origCount = reg.profiles.Count()
      firstPrev = invalid
      if origCount = 1 then firstPrev = reg.profiles[0]
      rows = {}
      for each row in reg.profiles
        rows[row.id] = row
      end for
      incomingKeys = {}
      for each item in group
        incomingKeys[item.key] = true
        if item.deleted
          if rows.DoesExist(item.key) then rows.Delete(item.key)
        else
          rows[item.key] = item.value
        end if
      end for
      if rows.Count() > 1 and origCount = 1 and firstPrev <> invalid and syncUntouchedProfile(firstPrev)
        if not incomingKeys.DoesExist(firstPrev.id)
          if lcProgressMap(firstPrev.id).Count() = 0 and lcFinishedMap(firstPrev.id).Count() = 0 and lcGetWatchlist(firstPrev.id).Count() = 0
            rows.Delete(firstPrev.id)
          end if
        end if
      end if
      profiles = []
      for each pid in rows
        profiles.Push(rows[pid])
      end for
      profiles = syncSortProfiles(profiles)
      if profiles.Count() = 0
        profiles.Push({ id: "profile-" + lcUuid(), name: "Profile 1", hue: 221, created: syncIsoFromMs(syncNowMs()), kind: "standard", "maxAge": 18, avatar: invalid, pin: invalid })
      end if
      activeId = reg.activeId
      if not rows.DoesExist(activeId)
        activeId = ""
        for each p in profiles
          if lcAaGet(p, "pin", invalid) = invalid
            activeId = p.id
            exit for
          end if
        end for
        if activeId = "" then activeId = profiles[0].id
      end if
      lcWriteRegJson("localProfiles", { activeId: activeId, profiles: profiles })
    else if kind = "preference"
      prefs = syncReadPrefs()
      for each item in group
        if item.deleted
          if prefs.DoesExist(item.key) then prefs.Delete(item.key)
        else
          prefs[item.key] = item.value
        end if
      end for
      syncWritePrefs(prefs)
    else if kind = "progress"
      pid = Mid(gkey, Instr(1, gkey, ":") + 1)
      allProg = lcReadRegJson("localProgress", {})
      if GetInterface(allProg, "ifAssociativeArray") = invalid then allProg = {}
      pm = lcAaGet(allProg, pid, {})
      if GetInterface(pm, "ifAssociativeArray") = invalid then pm = {}
      allFin = lcReadRegJson("localFinished", {})
      if GetInterface(allFin, "ifAssociativeArray") = invalid then allFin = {}
      fin = lcAaGet(allFin, pid, {})
      if GetInterface(fin, "ifAssociativeArray") = invalid then fin = {}

      for each item in group
        mediaId = Mid(item.key, Instr(1, item.key, "/") + 1)
        if item.deleted
          if pm.DoesExist(mediaId) then pm.Delete(mediaId)
          if fin.DoesExist(mediaId) then fin.Delete(mediaId)
        else
          v = item.value
          posSec = lcAaGet(v, "position", 0)
          dur = lcAaGet(v, "duration", 0)
          ratio = 0.0
          if dur > 0 then ratio = (posSec * 1.0) / (dur * 1.0)
          if ratio >= 0.92
            if pm.DoesExist(mediaId) then pm.Delete(mediaId)
            fin[mediaId] = v
          else
            if fin.DoesExist(mediaId) then fin.Delete(mediaId)
            entry = {}
            for each k in v
              entry[k] = v[k]
            end for
            entry.ratio = ratio
            ms = syncParseIsoMs(lcAaText(v, "updated", ""))
            if ms <> invalid then entry["updatedAt"] = Int((ms * 1.0#) / 1000.0#)
            pm[mediaId] = entry
          end if
        end if
      end for

      allProg[pid] = pm
      allFin[pid] = fin
      lcWriteRegJson("localProgress", allProg)
      lcWriteRegJson("localFinished", allFin)
    else if kind = "watchlist"
      pid = Mid(gkey, Instr(1, gkey, ":") + 1)
      allWl = lcReadRegJson("localWatchlist", {})
      if GetInterface(allWl, "ifAssociativeArray") = invalid then allWl = {}
      cur = lcAaGet(allWl, pid, [])
      byId = {}
      if GetInterface(cur, "ifArray") <> invalid
        for i = 0 to cur.Count() - 1
          byId[lcAaText(cur[i], "id", "")] = cur[i]
        end for
      end if
      for each item in group
        mediaId = Mid(item.key, Instr(1, item.key, "/") + 1)
        if item.deleted
          if byId.DoesExist(mediaId) then byId.Delete(mediaId)
        else
          byId[mediaId] = item.value
        end if
      end for
      arr = []
      for each midKey in byId
        arr.Push(byId[midKey])
      end for
      arr = syncSortWatchlist(arr)
      if arr.Count() > 24
        trimmed = []
        for i = 0 to 23
          trimmed.Push(arr[i])
        end for
        arr = trimmed
      end if
      allWl[pid] = arr
      lcWriteRegJson("localWatchlist", allWl)
    end if
  end for
end sub

function syncSortProfiles(profiles as Object) as Object
  out = []
  for i = 0 to profiles.Count() - 1
    out.Push(profiles[i])
  end for
  for i = 1 to out.Count() - 1
    cur = out[i]
    curCreated = lcAaText(cur, "created", "")
    curId = lcAaText(cur, "id", "")
    j = i - 1
    while j >= 0
      prevCreated = lcAaText(out[j], "created", "")
      prevId = lcAaText(out[j], "id", "")
      if prevCreated < curCreated or (prevCreated = curCreated and prevId <= curId) then exit while
      out[j + 1] = out[j]
      j = j - 1
    end while
    out[j + 1] = cur
  end for
  return out
end function

function syncSortWatchlist(items as Object) as Object
  out = []
  for i = 0 to items.Count() - 1
    out.Push(items[i])
  end for
  for i = 1 to out.Count() - 1
    cur = out[i]
    curMs = syncParseIsoMs(lcAaText(cur, "added", ""))
    if curMs = invalid then curMs = 0&
    curId = lcAaText(cur, "id", "")
    j = i - 1
    while j >= 0
      prevMs = syncParseIsoMs(lcAaText(out[j], "added", ""))
      if prevMs = invalid then prevMs = 0&
      prevId = lcAaText(out[j], "id", "")
      if prevMs > curMs or (prevMs = curMs and prevId <= curId) then exit while
      out[j + 1] = out[j]
      j = j - 1
    end while
    out[j + 1] = cur
  end for
  return out
end function

' ---- Merge & Engine ----

function syncObserveLocal(ledger as Object, local as Object, nowMs as LongInteger) as Boolean
  changed = false
  for each id in local
    row = local[id]
    prior = invalid
    if ledger.v.DoesExist(id) then prior = ledger.v[id]
    if prior = invalid or prior[1] <> row.hash
      updatedAt = row.item.updatedAt
      if prior <> invalid
        cand = syncMinLong(row.changedAt, nowMs)
        updatedAt = syncMaxLong(prior[0] + 1&, cand)
      end if
      ledger.v[id] = [updatedAt, row.hash]
      copyItem = {
        kind: row.item.kind
        key: row.item.key
        value: row.item.value
        "updatedAt": updatedAt
        deleted: row.item.deleted
      }
      ledger.p[id] = copyItem
      changed = true
    end if
  end for
  for each id in ledger.v.Keys()
    ver = ledger.v[id]
    if ver[1] <> invalid and not local.DoesExist(id)
      colon = Instr(1, id, ":")
      updatedAt = syncMaxLong(nowMs, ver[0] + 1&)
      ledger.v[id] = [updatedAt, invalid]
      ledger.p[id] = {
        kind: Left(id, colon - 1)
        key: Mid(id, colon + 1)
        value: invalid
        "updatedAt": updatedAt
        deleted: true
      }
      changed = true
    end if
  end for
  return changed
end function

function syncMergeRemote(ledger as Object, incomingList as Object) as Object
  changes = []
  for i = 0 to incomingList.Count() - 1
    item = incomingList[i]
    id = item.kind + ":" + item.key
    prior = invalid
    if ledger.v.DoesExist(id) then prior = ledger.v[id]
    if prior = invalid or prior[0] <= item.updatedAt
      hash = invalid
      if not item.deleted then hash = syncValueHash(item.value)
      if ledger.p.DoesExist(id) then ledger.p.Delete(id)
      ledger.v[id] = [item.updatedAt, hash]
      if prior = invalid or prior[1] <> hash
        changes.Push(item)
      end if
    end if
  end for
  return changes
end function

function syncCapture(ledger as Object, nowMs as LongInteger) as Boolean
  known = {}
  for each id in ledger.v
    if Left(id, 8) = "profile:" and ledger.v[id][1] <> invalid
      known[Mid(id, 9)] = true
    end if
  end for
  local = syncSnapshot(nowMs, known)
  changed = syncObserveLocal(ledger, local, nowMs)
  if changed then syncWriteLedger(ledger)
  return changed
end function

function syncPull(ctx as Object, ledger as Object, nowMs as LongInteger) as Object
  match = ledger.g
  since = ledger.s
  reset = false
  incoming = {}
  cursor = invalid
  watermark = invalid
  more = true
  etagRegex = CreateObject("roRegex", "^" + Chr(34) + "[0-9]+" + Chr(34) + "$", "")

  count = 0
  while count < syncMaxPages() and more
    url = "https://tvm-accounts.tvm-accounts.workers.dev/v1/me/data?since=" + since.ToStr().Trim()
    if cursor <> invalid and cursor <> ""
      url = url + "&cursor=" + lcUrlEncode(cursor)
    end if
    headers = {
      Accept: "application/json"
      Authorization: "Bearer " + lcAaText(ctx, "accountToken")
    }
    if match <> invalid and match <> ""
      headers["If-Match"] = match
    end if

    res = lcHttp(url, "GET", "", headers, 10000)
    if not res.ok
      if res.status = 412 and match <> invalid and match <> "" and not reset
        match = invalid
        since = 0&
        cursor = invalid
        watermark = invalid
        incoming = {}
        reset = true
      else
        st = res.status
        if st <= 0 then st = 503
        return { ok: false, status: st, retryAfter: lcAaText(res, "retryAfter", "") }
      end if
    else
      body = res.json
      if body = invalid or GetInterface(body, "ifAssociativeArray") = invalid
        return { ok: false, status: 503, retryAfter: "" }
      end if
      rawItems = lcAaGet(body, "items", invalid)
      if rawItems = invalid or GetInterface(rawItems, "ifArray") = invalid or rawItems.Count() > 100
        return { ok: false, status: 503, retryAfter: "" }
      end if
      pageNow = syncAsSafeInt(lcAaGet(body, "now", invalid))
      if pageNow = invalid or pageNow < 0&
        return { ok: false, status: 503, retryAfter: "" }
      end if
      nextCursor = lcAaGet(body, "nextCursor", invalid)
      if nextCursor <> invalid
        if not syncIsString(nextCursor) or rawItems.Count() = 0 or Len(nextCursor) > 750
          return { ok: false, status: 503, retryAfter: "" }
        end if
      end if

      etag = lcAaText(res, "etag", "")
      if etag = "" or not etagRegex.IsMatch(etag) then return { ok: false, status: 503, retryAfter: "" }
      if match <> invalid and match <> "" and etag <> match then return { ok: false, status: 503, retryAfter: "" }
      if watermark <> invalid and pageNow <> watermark then return { ok: false, status: 503, retryAfter: "" }
      if pageNow < since then return { ok: false, status: 503, retryAfter: "" }
      if cursor <> invalid and nextCursor = cursor then return { ok: false, status: 503, retryAfter: "" }

      checkNow = syncMaxLong(syncNowMs(), pageNow)
      for i = 0 to rawItems.Count() - 1
        item = syncParseItem(rawItems[i], checkNow)
        if item = invalid then return { ok: false, status: 503, retryAfter: "" }
        incoming[item.kind + ":" + item.key] = item
      end for

      match = etag
      watermark = pageNow
      cursor = nextCursor
      more = (cursor <> invalid and cursor <> "")
      count = count + 1
    end if
  end while

  if more or watermark = invalid then return { ok: false, status: 503, retryAfter: "" }

  syncCapture(ledger, syncNowMs())

  prevSince = ledger.s
  prevGen = ledger.g
  ledger.s = watermark
  ledger.g = match
  if reset
    ledger.p = {}
    for each id in ledger.v.Keys()
      ledger.v[id] = [-1&, ledger.v[id][1]]
    end for
  end if

  incomingList = []
  for each id in incoming
    incomingList.Push(incoming[id])
  end for
  changes = syncMergeRemote(ledger, incomingList)
  if changes.Count() > 0
    syncApplyItems(changes)
    syncWriteLedger(ledger)
    return { ok: true, changed: true }
  else if incomingList.Count() > 0 or reset or prevSince <> ledger.s or prevGen <> ledger.g
    syncWriteLedger(ledger)
  end if
  return { ok: true, changed: false }
end function

function syncPush(ctx as Object, ledger as Object) as Object
  queue = []
  for each id in ledger.p
    queue.Push(ledger.p[id])
  end for
  if queue.Count() = 0 then return { ok: true, pushed: false }

  offset = 0
  while offset < queue.Count()
    batch = []
    limit = offset + syncMaxItems()
    if limit > queue.Count() then limit = queue.Count()
    for i = offset to limit - 1
      batch.Push(queue[i])
    end for

    headers = {
      Accept: "application/json"
      "Content-Type": "application/json"
      Authorization: "Bearer " + lcAaText(ctx, "accountToken")
      "If-Match": ledger.g
    }
    res = lcHttp("https://tvm-accounts.tvm-accounts.workers.dev/v1/me/data", "PUT", syncCanonicalJson({ items: batch }), headers, 15000)
    if not res.ok
      st = res.status
      if st <= 0 then st = 503
      return { ok: false, status: st, retryAfter: lcAaText(res, "retryAfter", "") }
    end if

    for i = 0 to batch.Count() - 1
      item = batch[i]
      key = item.kind + ":" + item.key
      if ledger.p.DoesExist(key)
        if ledger.p[key].updatedAt = item.updatedAt then ledger.p.Delete(key)
      end if
    end for
    syncWriteLedger(ledger)
    offset = limit
  end while

  return { ok: true, pushed: true }
end function

function syncDisabledResult(status = 200 as Integer, errMsg = invalid as Dynamic) as Object
  return {
    status: status
    json: {
      enabled: false
      "lastSyncAt": invalid
      pending: 0
      error: errMsg
      changed: false
    }
  }
end function

function syncApplyFailure(ledger as Object, status as Integer, retryAfter as String) as Object
  if status = 404
    ledger.d = true
    ledger.e = invalid
    ledger.f = 0
    ledger.r = 0&
    syncWriteLedger(ledger)
    return syncDisabledResult(200, invalid)
  end if
  if status = 401
    syncClearOnSignOut()
    sec = lcReg()
    if sec <> invalid
      sec.Delete("accountToken")
      sec.Flush()
    end if
    return syncDisabledResult(401, "unauthorized")
  end if
  failures = ledger.f
  exp = failures
  if exp > 6 then exp = 6
  mult = 1&
  for i = 1 to exp
    mult = mult * 2&
  end for
  delay = 5000& * mult
  if delay > syncBackoffMaxMs() then delay = syncBackoffMaxMs()
  raSec = Int(Val(retryAfter))
  if raSec > 0
    raMs = raSec * 1000&
    if raMs > delay then delay = raMs
  end if
  ledger.f = failures + 1
  ledger.r = syncNowMs() + delay
  if status = 409
    ledger.e = "Synced data is full."
  else
    ledger.e = "Account data could not sync."
  end if
  syncWriteLedger(ledger)
  return {
    status: 200
    json: {
      enabled: true
      "lastSyncAt": ledger.l
      pending: ledger.p.Count()
      error: ledger.e
      changed: false
    }
  }
end function

function syncHandleStatus(ctx as Object) as Object
  if lcAaText(ctx, "accountToken") = "" then return syncDisabledResult()
  ledger = syncReadLedger()
  if ledger.d = true then return syncDisabledResult()
  syncCapture(ledger, syncNowMs())
  return {
    status: 200
    json: {
      enabled: true
      "lastSyncAt": ledger.l
      pending: ledger.p.Count()
      error: ledger.e
    }
  }
end function

function syncHandleNow(ctx as Object) as Object
  token = lcAaText(ctx, "accountToken")
  if token = "" then return syncDisabledResult()

  cached = lcReadTmpJson("tvm_sync_session.json")
  tokenHash = syncSha256Hex(token)
  accountId = ""
  if cached <> invalid and lcAaText(cached, "th", "") = tokenHash
    accountId = lcAaText(cached, "aid", "")
  end if
  if accountId <> ""
    syncEnsureAccount(accountId)
  else
    meRes = lcAccountsHttp(ctx, "/v1/me")
    if meRes.status = 401
      syncClearOnSignOut()
      sec = lcReg()
      if sec <> invalid
        sec.Delete("accountToken")
        sec.Flush()
      end if
      return syncDisabledResult(401, "unauthorized")
    end if
    if not meRes.ok
      ledger = syncReadLedger()
      if ledger.d = true then return syncDisabledResult()
      st = meRes.status
      if st <= 0 then st = 503
      return syncApplyFailure(ledger, st, lcAaText(meRes, "retryAfter", ""))
    end if
    acc = lcAaGet(meRes.json, "account", invalid)
    accountId = lcAaText(acc, "id", "")
    if accountId = ""
      ledger = syncReadLedger()
      return syncApplyFailure(ledger, 503, "")
    end if
    syncBindAccount(token, accountId)
  end if

  ledger = syncReadLedger()
  if ledger.d = true then return syncDisabledResult()

  force = lcAaBool(lcAaGet(ctx, "body", {}), "force", false)
  nowMs = syncNowMs()
  if not force and ledger.r > 0& and nowMs < ledger.r
    return {
      status: 200
      json: {
        enabled: true
        "lastSyncAt": ledger.l
        pending: ledger.p.Count()
        error: ledger.e
        changed: false
      }
    }
  end if

  syncCapture(ledger, nowMs)
  changed = false

  pullRes = syncPull(ctx, ledger, nowMs)
  if not pullRes.ok then return syncApplyFailure(ledger, pullRes.status, pullRes.retryAfter)
  if pullRes.changed = true then changed = true

  pushRes = syncPush(ctx, ledger)
  if not pushRes.ok then return syncApplyFailure(ledger, pushRes.status, pushRes.retryAfter)
  if pushRes.pushed = true
    pull2 = syncPull(ctx, ledger, syncNowMs())
    if not pull2.ok then return syncApplyFailure(ledger, pull2.status, pull2.retryAfter)
    if pull2.changed = true then changed = true
  end if

  ledger.l = syncNowMs()
  ledger.f = 0
  ledger.r = 0&
  ledger.e = invalid
  syncWriteLedger(ledger)
  return {
    status: 200
    json: {
      enabled: true
      "lastSyncAt": ledger.l
      pending: ledger.p.Count()
      error: invalid
      changed: changed
    }
  }
end function
