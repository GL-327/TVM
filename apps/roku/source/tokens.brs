' Copied from packages/design tokens. Roku cannot import CSS.
' When theme.brs has stored a palette on GetGlobalAA(), these follow it.

function tvmThemeColor(key as String, fallback as String) as String
  g = GetGlobalAA()
  if g = invalid then return fallback
  if not g.DoesExist("tvmThemeColors") then return fallback
  colors = g.tvmThemeColors
  if colors = invalid then return fallback
  if GetInterface(colors, "ifAssociativeArray") = invalid then return fallback
  if not colors.DoesExist(key) then return fallback
  value = colors[key]
  if value = invalid or value = "" then return fallback
  return value
end function

function tvmBg() as String
  return tvmThemeColor("bg", "0x0B0B0BFF")
end function

function tvmBgDeep() as String
  return tvmThemeColor("bgDeep", "0x000000FF")
end function

function tvmBgElevated() as String
  return tvmThemeColor("bgElevated", "0x161616FF")
end function

function tvmSurface() as String
  return tvmThemeColor("surface", "0x1D1D1DFF")
end function

function tvmSurfaceHover() as String
  return tvmThemeColor("surfaceHover", "0x2B2B2BFF")
end function

function tvmGlass() as String
  return tvmThemeColor("glass", "0x1C1C1CC7")
end function

function tvmText() as String
  return tvmThemeColor("text", "0xF5F5F5FF")
end function

function tvmMuted() as String
  return tvmThemeColor("muted", "0xC4C4C4FF")
end function

function tvmFaint() as String
  return tvmThemeColor("faint", "0x8A8A8AFF")
end function

function tvmFocus() as String
  return tvmThemeColor("focus", "0xFFFFFFFF")
end function

function tvmAccentInk() as String
  return tvmThemeColor("accentInk", "0x111111FF")
end function

function tvmAccentBlue() as String
  return tvmThemeColor("accentBlue", "0x00A8E1FF")
end function

function tvmDanger() as String
  return "0xFF6B7DFF"
end function

function tvmSuccess() as String
  return "0x59D69AFF"
end function

function tvmWarning() as String
  return "0xFFBF69FF"
end function

function tvmImdb() as String
  return "0xF5C518FF"
end function

function tvmStreamRed() as String
  return "0xE50914FF"
end function

function tvmStreamBg() as String
  return "0x141414FF"
end function

function tvmEmber() as String
  return "0xFF8A2BFF"
end function

function tvmFocusScale() as Float
  return 1.08
end function

function tvmPosterFocusScale() as Float
  return 1.04
end function

function tvmAppBrand(id as String) as Object
  b = {}
  b.plate = tvmSurface()
  b.ink = tvmText()
  b.layout = "center"
  b.wordSize = 36
  b.mark = ""
  key = LCase(id)

  if key = "tvm-stream"
    b.plate = "0x5B3DFFFF"
    b.layout = "tvm"
    b.wordSize = 44
    b.mark = "pkg:/images/apps/marks/tvm-gem.png"
  else if key = "netflix"
    b.plate = tvmStreamRed()
    b.wordSize = 32
  else if key = "prime"
    b.plate = "0x0F171EFF"
    b.layout = "prime"
    b.wordSize = 28
    b.mark = "pkg:/images/apps/marks/prime-smile.png"
  else if key = "max"
    b.plate = "0x0B0614FF"
    b.wordSize = 56
  else if key = "appletv"
    b.plate = "0x111111FF"
    b.wordSize = 52
  else if key = "disney"
    b.plate = "0x113CC8FF"
    b.wordSize = 38
  else if key = "hulu"
    b.plate = "0x0B0B0BFF"
    b.ink = "0x1CE783FF"
    b.wordSize = 48
  else if key = "peacock"
    b.plate = "0x111111FF"
    b.layout = "peacock"
    b.wordSize = 34
  else if key = "youtube"
    b.plate = "0xFFFFFFFF"
    b.ink = "0x111111FF"
    b.layout = "youtube"
    b.wordSize = 30
    b.mark = "pkg:/images/apps/marks/yt-play.png"
  else if key = "freevee"
    b.plate = "0x111111FF"
    b.wordSize = 32
  else if key = "iplayer"
    b.plate = "0xF4F1ECFF"
    b.ink = "0x111111FF"
    b.layout = "iplayer"
    b.wordSize = 34
  else if key = "paramount"
    b.plate = "0x0064FFFF"
    b.layout = "paramount"
    b.wordSize = 28
    b.mark = "pkg:/images/apps/marks/paramount-peak.png"
  else if key = "tubi"
    b.plate = "0xFA382FFF"
    b.wordSize = 48
  else if key = "pluto"
    b.plate = "0x000000FF"
    b.ink = "0xFFD400FF"
    b.wordSize = 30
  else if key = "starz"
    b.plate = "0x121212FF"
    b.wordSize = 34
  else if key = "fox"
    b.plate = "0x000000FF"
    b.wordSize = 56
  end if

  return b
end function

' Liquid-glass colors for theme id "glass". SceneGraph has no blur;
' these are original frosted fills and specular edges, not Apple assets.
' 10-foot: panel fills stay dark enough that tvmText() remains readable.

function tvmGlassBg() as String
  return "0x081018FF"
end function

function tvmGlassWash() as String
  return "0x7EB4D918"
end function

function tvmGlassPanel() as String
  return "0x12202CC7"
end function

function tvmGlassChrome() as String
  return "0x163040D6"
end function

function tvmGlassFill() as String
  return "0xEAF6FF36"
end function

function tvmGlassFillStrong() as String
  return "0xD4ECFF55"
end function

function tvmGlassHighlight() as String
  return "0xFFFFFF5C"
end function

function tvmGlassSheen() as String
  return "0xFFFFFF30"
end function

function tvmGlassEdge() as String
  return "0x9FE7FF40"
end function

function tvmGlassHairline() as String
  return "0xFFFFFF2E"
end function

function tvmGlassShadow() as String
  return "0x02080FB3"
end function

function tvmGlassInk() as String
  return "0xF7FBFFFF"
end function
