' Liquid-glass look for Roku when the theme id is "glass".
' SceneGraph cannot blur the framebuffer. Frost is a few static
' rectangles: fill, hairline rim, optional top highlight. No sheen
' animation and no stacked edge lights — cheaper on the compositor.
'
' Wire from a theme apply once a sibling stores a theme id:
'   <script type="text/brightscript" uri="pkg:/source/themeGlass.brs" />
'   if tvmIsGlassTheme(themeId) then applyGlassTheme(m.top)
'   if not tvmIsGlassTheme(themeId) then clearGlassTheme(m.top)
'
' If no theme router exists yet, include the same script on TVMScene and call:
'   applyGlassTheme(m.top)
' That applies glass unless root.themeId / root.theme / GetGlobalAA().tvmThemeId
' is set to something other than glass.
'
' Screens can frost a local panel without a full theme pass:
'   panel = tvmMakeGlassOverlay(1960, 840, 36, "panel")
'   paintGlassChrome(ribbonBar)

function tvmIsGlassTheme(themeId as Dynamic) as Boolean
  key = tvmThemeKey(themeId)
  if key = "glass" then return true
  if key = "liquid-glass" then return true
  if key = "liquidglass" then return true
  return false
end function

function tvmGlassActive() as Boolean
  g = GetGlobalAA()
  if g = invalid then return false
  return g.tvmGlassOn = true
end function

function tvmReadThemeId(root as Object) as String
  if root <> invalid
    value = tvmThemeKey(root.themeId)
    if value <> "" then return value
    value = tvmThemeKey(root.theme)
    if value <> "" then return value
  end if
  g = GetGlobalAA()
  if g = invalid then return ""
  value = tvmThemeKey(g.tvmThemeId)
  if value <> "" then return value
  return tvmThemeKey(g.themeId)
end function

function tvmThemeKey(value as Dynamic) as String
  if value = invalid then return ""
  if GetInterface(value, "ifString") = invalid then return ""
  key = LCase(value.Trim())
  return key
end function

sub applyGlassTheme(root as Object)
  themeId = tvmReadThemeId(root)
  if themeId <> "" and not tvmIsGlassTheme(themeId) then return
  if root = invalid then return

  g = GetGlobalAA()
  if g <> invalid
    g.tvmGlassOn = true
    g.tvmThemeId = "glass"
  end if

  paintGlassStage(root)
  wash = ensureGlassWash(root)
  if wash <> invalid
    wash.visible = true
    paintGlassWash(wash)
  end if
  paintGlassChrome(root)
end sub

sub clearGlassTheme(root as Object)
  g = GetGlobalAA()
  if g <> invalid then g.tvmGlassOn = false
  if root = invalid then return

  bg = root.findNode("bg")
  if bg <> invalid then bg.color = tvmBg()

  wash = root.findNode("glassWash")
  if wash <> invalid then wash.visible = false
end sub

sub paintGlassOverlayNode()
  if m.top = invalid then return
  paintGlassOverlay(m.top)
end sub

sub paintGlassWash(wash as Object)
  if wash = invalid then return
  fill = wash.findNode("fill")
  if fill = invalid
    wash.width = 3840
    wash.height = 2160
    wash.color = tvmGlassWash()
    return
  end if
  hideGlassExtras(wash)
  paintGlassRect(fill, true, 3840, 2160, [0, 0], 0, tvmGlassWash())
end sub

sub paintGlassOverlay(overlay as Object)
  if overlay = invalid then return
  fill = overlay.findNode("fill")
  if fill = invalid
    paintGlassWash(overlay)
    return
  end if

  ensureGlassLayers(overlay)
  hideGlassExtras(overlay)

  variant = tvmThemeKey(overlay.variant)
  if variant = "" then variant = "panel"

  width = glassDim(overlay.panelWidth, overlay.width, 960)
  height = glassDim(overlay.panelHeight, overlay.height, 540)
  radius = glassDim(overlay.radius, 36, 36)
  if variant = "wash" then radius = 0
  if variant = "pill" and radius < 64 then radius = Int(height / 2)

  overlay.width = width
  overlay.height = height
  overlay.focusable = false

  fillColor = tvmGlassPanel()
  showRim = true
  showHi = true
  if variant = "wash"
    fillColor = tvmGlassWash()
    showRim = false
    showHi = false
  else if variant = "chrome"
    fillColor = tvmGlassChrome()
    showHi = false
  else if variant = "pill"
    fillColor = tvmGlassFillStrong()
  end if

  paintGlassRect(overlay.findNode("rim"), showRim, width, height, [0, 0], radius, tvmGlassHairline())
  paintGlassRect(overlay.findNode("fill"), true, width, height, [0, 0], radius, fillColor)

  specH = 6
  if height < 120 then specH = 4
  hiW = width - 24
  if hiW < 8 then hiW = width
  paintGlassRect(overlay.findNode("highlight"), showHi, hiW, specH, [12, 6], 4, tvmGlassHighlight())
end sub

function tvmMakeGlassOverlay(width as Integer, height as Integer, radius as Integer, variant as String) as Object
  overlay = CreateObject("roSGNode", "GlassOverlay")
  if overlay = invalid then return invalid
  if variant = invalid or variant = "" then variant = "panel"
  overlay.variant = variant
  overlay.panelWidth = width
  overlay.panelHeight = height
  overlay.radius = radius
  paintGlassOverlay(overlay)
  return overlay
end function

sub paintGlassChrome(node as Object)
  if node = invalid then return
  bar = node.findNode("bar")
  if bar <> invalid
    bar.color = tvmGlassChrome()
  end if
  pill = node.findNode("pill")
  if pill <> invalid
    pill.color = tvmGlassPanel()
  end if
  pillRing = node.findNode("pillRing")
  if pillRing <> invalid
    pillRing.color = tvmGlassHairline()
  end if
end sub

sub paintGlassStage(root as Object)
  bg = root.findNode("bg")
  if bg <> invalid then bg.color = tvmGlassBg()
end sub

function ensureGlassWash(root as Object) as Object
  wash = root.findNode("glassWash")
  if wash <> invalid then return wash

  parent = root.findNode("uiRoot")
  if parent = invalid then parent = root
  wash = CreateObject("roSGNode", "Rectangle")
  if wash = invalid then return invalid
  wash.id = "glassWash"
  wash.width = 3840
  wash.height = 2160
  wash.color = tvmGlassWash()
  wash.translation = [0, 0]

  bg = parent.findNode("bg")
  idx = 0
  if bg <> invalid
    found = glassChildIndex(parent, bg)
    if found >= 0 then idx = found + 1
  end if
  parent.insertChild(wash, idx)
  return wash
end function

sub ensureGlassLayers(node as Object)
  if node = invalid then return
  ids = ["rim", "fill", "highlight"]
  i = 0
  while i < ids.Count()
    if node.findNode(ids[i]) = invalid
      rect = CreateObject("roSGNode", "Rectangle")
      rect.id = ids[i]
      node.appendChild(rect)
    end if
    i = i + 1
  end while
end sub

sub hideGlassExtras(overlay as Object)
  if overlay = invalid then return
  ids = ["shadow", "shade", "edgeLeft", "edgeRight", "edgeBottom", "sheen"]
  i = 0
  while i < ids.Count()
    extra = overlay.findNode(ids[i])
    if extra <> invalid then extra.visible = false
    i = i + 1
  end while
  anim = overlay.findNode("sheenAnim")
  if anim <> invalid then anim.control = "stop"
end sub

sub paintGlassRect(rect as Object, show as Boolean, width as Integer, height as Integer, origin as Object, radius as Integer, color as String)
  if rect = invalid then return
  rect.visible = show
  if not show then return
  if width < 1 then width = 1
  if height < 1 then height = 1
  rect.width = width
  rect.height = height
  rect.translation = origin
  rect.cornerRadius = radius
  rect.color = color
end sub

function glassDim(primary as Dynamic, fallback as Dynamic, defaultValue as Integer) as Integer
  value = glassAsInt(primary)
  if value > 0 then return value
  value = glassAsInt(fallback)
  if value > 0 then return value
  return defaultValue
end function

function glassAsInt(value as Dynamic) as Integer
  if value = invalid then return 0
  kind = Type(value)
  if kind = "Integer" or kind = "roInt" or kind = "roInteger" then return value
  if kind = "Float" or kind = "roFloat" or kind = "Double" or kind = "roDouble" then return Int(value)
  return 0
end function

function glassChildIndex(parent as Object, child as Object) as Integer
  if parent = invalid or child = invalid then return -1
  i = 0
  while i < parent.getChildCount()
    if parent.getChild(i) = child then return i
    i = i + 1
  end while
  return -1
end function
