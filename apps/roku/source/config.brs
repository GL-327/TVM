function registrySection() as Object
  return CreateObject("roRegistrySection", "tvm")
end function

function readPkgConfig() as Object
  raw = ReadAsciiFile("pkg:/config.json")
  if raw = invalid or raw = "" then return invalid
  return ParseJson(raw)
end function

function loadCoreBaseUrl() as String
  section = registrySection()
  if section.Exists("coreBaseUrl")
    url = section.Read("coreBaseUrl")
    if url <> invalid and url <> "" then return normalizeCoreUrl(url)
  end if

  pkg = readPkgConfig()
  if pkg <> invalid and pkg.DoesExist("coreBaseUrl")
    url = pkg.coreBaseUrl
    if url <> invalid and url <> "" then return normalizeCoreUrl(url)
  end if

  return ""
end function

function saveCoreBaseUrl(url as String) as Boolean
  section = registrySection()
  section.Write("coreBaseUrl", normalizeCoreUrl(url))
  return section.Flush()
end function

' The LAN credential is device-local; never include it in config.json or the zip.
function loadCoreToken() as String
  section = registrySection()
  if section.Exists("coreToken") then return section.Read("coreToken")
  return ""
end function

function saveCoreToken(token as String) as Boolean
  section = registrySection()
  section.Write("coreToken", token.Trim())
  return section.Flush()
end function

function coreOwnsUrl(base as String, url as String) as Boolean
  prefix = LCase(normalizeCoreUrl(base)) + "/"
  return Left(LCase(url), Len(prefix)) = prefix
end function

function absoluteCoreUrl(base as String, url as String) as String
  if Left(url, 1) = "/" and Left(url, 2) <> "//" then return joinCorePath(base, url)
  return url
end function

function normalizeCoreUrl(url as String) as String
  trimmed = url.Trim()
  while Len(trimmed) > 0 and Right(trimmed, 1) = "/"
    trimmed = Left(trimmed, Len(trimmed) - 1)
  end while
  return trimmed
end function

function isValidCoreUrl(url as String) as Boolean
  u = LCase(url.Trim())
  if Left(u, 7) <> "http://" and Left(u, 8) <> "https://" then return false
  validator = CreateObject("roRegex", "^https?://([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(:[0-9]{1,5})?$", "i")
  if not validator.IsMatch(u) then return false
  if Len(u) < 12 then return false
  if isPlaceholderUrl(u) then return false
  return true
end function

function isPlaceholderUrl(url as String) as Boolean
  if url = invalid or url = "" then return true
  return LCase(url).Instr("your-pc-lan-ip") > 0
end function

function isCoreToken(token as Dynamic) as Boolean
  if token = invalid then return false
  tokenType = Type(token)
  if tokenType <> "String" and tokenType <> "roString" then return false
  n = Len(token.Trim())
  return n >= 32 and n <= 512
end function

function loadAccountToken() as String
  section = registrySection()
  if section.Exists("accountToken") then return section.Read("accountToken")
  return ""
end function

function saveAccountToken(token as String) as Boolean
  section = registrySection()
  section.Write("accountToken", token.Trim())
  return section.Flush()
end function

function isAccountToken(token as Dynamic) as Boolean
  return isCoreToken(token)
end function

function joinCorePath(base as String, path as String) as String
  b = normalizeCoreUrl(base)
  p = path
  if Left(p, 1) <> "/" then p = "/" + p
  return b + p
end function

' Accessibility flags. Stored as "1"/"0" in the same registry section and
' mirrored on m.global by TVMScene so every component can observe them.
function loadFlag(key as String) as Boolean
  section = registrySection()
  if section.Exists(key) then return section.Read(key) = "1"
  return false
end function

function saveFlag(key as String, value as Boolean) as Boolean
  section = registrySection()
  if value
    section.Write(key, "1")
  else
    section.Write(key, "0")
  end if
  return section.Flush()
end function

function loadReduceMotion() as Boolean
  return loadFlag("reduceMotion")
end function

function saveReduceMotion(value as Boolean) as Boolean
  return saveFlag("reduceMotion", value)
end function

function loadReduceTransparency() as Boolean
  return loadFlag("reduceTransparency")
end function

function loadBackground() as String
  section = registrySection()
  if section.Exists("background")
    if section.Read("background") = "lighthouse" then return "lighthouse"
  end if
  return "trending"
end function

function saveBackground(value as String) as Boolean
  section = registrySection()
  section.Write("background", value)
  return section.Flush()
end function

function saveReduceTransparency(value as Boolean) as Boolean
  return saveFlag("reduceTransparency", value)
end function
