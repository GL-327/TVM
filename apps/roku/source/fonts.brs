' Fonts are cached per component scope: a Font node is created once per
' weight + size instead of on every call (cards, rails and buttons used to
' build a fresh node each time).
function tvmFont(weight as String, size as Integer) as Object
  cache = GetGlobalAA()
  if cache.tvmFontCache = invalid then cache.tvmFontCache = {}
  bold = (LCase(weight) = "bold")
  semibold = (LCase(weight) = "semibold")
  key = "r" + StrI(size).Trim()
  if bold then key = "b" + StrI(size).Trim()
  if semibold then key = "s" + StrI(size).Trim()
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

' 10-foot scale (needs tokens.brs in the same component). Inter Regular,
' SemiBold and Bold are packaged with their SIL Open Font License.
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
  return tvmFont("regular", tvmTypeSize(tvmTypeSecondary()))
end function

function tvmFontMeta() as Object
  return tvmFont("regular", tvmTypeSize(tvmTypeCaption()))
end function
