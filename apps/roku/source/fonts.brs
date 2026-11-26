' Fonts are cached per component scope: a Font node is created once per
' weight + size instead of on every call (cards, rails and buttons used to
' build a fresh node each time).
function tvmFont(weight as String, size as Integer) as Object
  cache = GetGlobalAA()
  if cache.tvmFontCache = invalid then cache.tvmFontCache = {}
  family = tvmFontFamily()
  bold = (LCase(weight) = "bold")
  semibold = (LCase(weight) = "semibold")
  key = "r" + StrI(size).Trim()
  if bold then key = "b" + StrI(size).Trim()
  if semibold then key = "s" + StrI(size).Trim()
  key = family + ":" + weight + ":" + key
  if cache.tvmFontCache.DoesExist(key) then return cache.tvmFontCache[key]

  font = CreateObject("roSGNode", "Font")
  uri = "pkg:/fonts/Inter-Regular.otf"
  fallback = "font:SystemFontFile"
  if bold
    uri = "pkg:/fonts/Inter-Bold.otf"
    fallback = "font:BoldSystemFontFile"
  end if
  if semibold
    uri = "pkg:/fonts/Inter-SemiBold.otf"
    fallback = "font:BoldSystemFontFile"
  end if
  if family = "Geist"
    suffix = "Regular"
    if weight = "medium" then suffix = "Medium"
    if semibold then suffix = "SemiBold"
    if bold then suffix = "Bold"
    uri = "pkg:/fonts/Geist-" + suffix + ".ttf"
  else if family = "System"
    uri = fallback
  end if
  font.uri = uri
  if font.uri = invalid or font.uri = "" then font.uri = fallback
  font.size = size
  cache.tvmFontCache[key] = font
  return font
end function

function tvmFontCaption() as Object
  return tvmFont("regular", 26)
end function

function tvmFontBody() as Object
  return tvmFont("regular", 34)
end function

function tvmFontBodyLg() as Object
  return tvmFont("bold", 40)
end function

function tvmFontTitle() as Object
  return tvmFont("bold", 56)
end function

function tvmFontDisplay() as Object
  return tvmFont("bold", 88)
end function

function tvmFontHero() as Object
  return tvmFont("bold", 144)
end function

' The shared ratios are sized for a TV viewing distance.
function tvmFontHeroTitle() as Object
  return tvmFont("bold", tvmTypeSize(tvmTypeHero()))
end function

function tvmFontScreenTitle() as Object
  return tvmFont("bold", tvmTypeSize(tvmTypeScreen()))
end function

function tvmFontLabel() as Object
  return tvmFont("semibold", tvmTypeSize(tvmTypePrimary()))
end function

function tvmFontSecondary() as Object
  return tvmFont("medium", tvmTypeSize(tvmTypeSecondary()))
end function

function tvmFontMeta() as Object
  return tvmFont("regular", tvmTypeSize(tvmTypeCaption()))
end function

function tvmFontFamily() as String
  section = CreateObject("roRegistrySection", "tvm")
  family = section.Read("fontFamily")
  if family = "Inter" or family = "System" then return family
  return "Geist"
end function

sub tvmApplyFonts(node as Object)
  if node.hasField("font") and node.font <> invalid
    previous = node.font
    uri = LCase(previous.uri)
    weight = "regular"
    if Instr(1, uri, "bold") > 0 then weight = "bold"
    if Instr(1, uri, "semibold") > 0 then weight = "semibold"
    if Instr(1, uri, "medium") > 0 then weight = "medium"
    if previous.size > 0 then node.font = tvmFont(weight, previous.size)
  end if
  for i = 0 to node.getChildCount() - 1
    tvmApplyFonts(node.getChild(i))
  end for
end sub

function tvmExtraEnabled(key as String, fallback = true as Boolean) as Boolean
  if m.global = invalid or not m.global.hasField("rokuPrefs") then return fallback
  flags = m.global.remoteFlags
  if flags <> invalid and flags.DoesExist(key) and flags[key] = false then return false
  prefs = m.global.rokuPrefs
  if prefs = invalid or not prefs.DoesExist("extras") then return fallback
  if prefs.extras.DoesExist(key) then return prefs.extras[key] = true
  return fallback
end function
