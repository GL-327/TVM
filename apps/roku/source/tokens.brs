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
  return tvmThemeColor("accentBlue", "0x2F6BFFFF")
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
  return 1.06
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
    b.plate = "0x7C4DFFFF"
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
  return "0xFFFFFF72"
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

' ---------------------------------------------------------------------------
' 10-foot design tokens (docs/redesign/DECISIONS.md). The canvas is 3840x2160,
' so every size below is the 1080p reference px x 2, in canvas units.
' ---------------------------------------------------------------------------

' Safe insets: 80 px left/right and 60 px top/bottom at 1080p.
function tvmSafeLeft() as Integer
  return 160
end function

function tvmSafeRight() as Integer
  return 3680
end function

function tvmSafeTop() as Integer
  return 120
end function

function tvmSafeBottom() as Integer
  return 2040
end function

' Type scale in canvas units: hero 72 / screen title 48 / primary 30 /
' secondary 24 / caption 22 (1080p px) x 2.
function tvmTypeHero() as Integer
  return 144
end function

function tvmTypeScreen() as Integer
  return 96
end function

function tvmTypePrimary() as Integer
  return 60
end function

function tvmTypeSecondary() as Integer
  return 48
end function

function tvmTypeCaption() as Integer
  return 44
end function

' Smallest legible device px. 20 px at 1080p, never under 18 device px at 720p.
function tvmMinDevicePx() as Integer
  return 18
end function

' Canvas-to-device scale published by TVMScene (0.5 at FHD, 0.333 at HD).
function tvmUiScale() as Float
  scale = 0.5
  if m <> invalid and m.global <> invalid
    if m.global.hasField("uiScale")
      if m.global.uiScale <> invalid
        if m.global.uiScale > 0 then scale = m.global.uiScale
      end if
    end if
  end if
  return scale
end function

' Applies the HD bump: x1.15 on small panels, and always enough canvas units
' to land on at least 18 device px (44 units is 14.7 px at HD, so it becomes 54).
function tvmTypeSize(base as Integer) as Integer
  scale = tvmUiScale()
  size = base
  if scale < 0.45 then size = Int((base * 1.15) + 0.5)
  floorSize = Int((tvmMinDevicePx() / scale) + 0.999)
  if size < floorSize then size = floorSize
  return size
end function

' Motion durations in seconds. Panel moves 220 ms, tab slides 180 ms, focus
' 150 ms ease-out, press 80 ms. Every animation can be interrupted.
function tvmMotionPanel() as Float
  return 0.22
end function

function tvmMotionTab() as Float
  return 0.18
end function

function tvmMotionFocus() as Float
  return 0.15
end function

function tvmMotionPress() as Float
  return 0.08
end function

' Focus geometry: posters scale 1.04, pills and nodes 1.06, lift 6 px (12 units).
function tvmPillFocusScale() as Float
  return 1.06
end function

function tvmFocusLift() as Integer
  return 12
end function

function tvmPressScale() as Float
  return 0.98
end function

' App-wide accessibility flags, stored in the registry and mirrored on m.global.
function tvmReduceMotion() as Boolean
  if m = invalid then return false
  if m.global = invalid then return false
  if not m.global.hasField("reduceMotion") then return false
  return m.global.reduceMotion = true
end function

function tvmReduceTransparency() as Boolean
  if m = invalid then return false
  if m.global = invalid then return false
  if not m.global.hasField("reduceTransparency") then return false
  return m.global.reduceTransparency = true
end function

' Glass fills. Normal: ~18% white over dark scenes. Reduce Transparency: opaque ink.
function tvmGlassTint() as String
  if tvmReduceTransparency() then return "0x12151CFF"
  return "0xEAF6FF22"
end function

function tvmGlassTintFocused() as String
  if tvmReduceTransparency() then return "0x232833FF"
  return "0xF5FBFF38"
end function

function tvmGlassTintPressed() as String
  if tvmReduceTransparency() then return "0x0B0D12FF"
  return "0xFFFFFF1A"
end function

' Reduce Transparency uses a solid, contrast-safe rim instead of a faint specular.
function tvmGlassRimOpacity() as Float
  if tvmReduceTransparency() then return 1.0
  return 0.94
end function
