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
  if u.Instr(" ") > 0 then return false
  if Len(u) < 12 then return false
  return true
end function

function joinCorePath(base as String, path as String) as String
  b = normalizeCoreUrl(base)
  p = path
  if Left(p, 1) <> "/" then p = "/" + p
  return b + p
end function
