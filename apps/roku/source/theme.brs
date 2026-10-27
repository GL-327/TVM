' Theme ids match the shared interface. Retired saved themes resolve to Dark.

function tvmThemeDefault() as String
  return "dark"
end function

function tvmThemeIds() as Object
  return ["light", "dark"]
end function

function normalizeThemeId(id as Dynamic) as String
  if id = invalid then return tvmThemeDefault()
  if GetInterface(id, "ifString") = invalid then return tvmThemeDefault()
  key = LCase(id.Trim())
  if key = "dark" then return "dark"
  if key = "light" then return "light"
  return tvmThemeDefault()
end function

function tvmThemeLabel(id as Dynamic) as String
  key = normalizeThemeId(id)
  if key = "dark" then return "Dark"
  return "Light"
end function

sub rememberThemeId(id as Dynamic)
  key = normalizeThemeId(id)
  g = GetGlobalAA()
  if g = invalid then return
  g.tvmThemeId = key
  g.tvmThemeColors = tvmThemePalette(key)
end sub

function currentThemeId() as String
  g = GetGlobalAA()
  if g <> invalid and g.DoesExist("tvmThemeId")
    stored = g.tvmThemeId
    if stored <> invalid and stored <> "" then return normalizeThemeId(stored)
  end if
  return loadThemeId()
end function

function loadThemeId() as String
  section = registrySection()
  if section <> invalid and section.Exists("themeId")
    return normalizeThemeId(section.Read("themeId"))
  end if
  return tvmThemeDefault()
end function

function saveThemeId(id as Dynamic) as Boolean
  key = normalizeThemeId(id)
  rememberThemeId(key)
  section = registrySection()
  if section = invalid then return false
  section.Write("themeId", key)
  return section.Flush()
end function

function nextThemeId(id as Dynamic, delta as Integer) as String
  ids = tvmThemeIds()
  current = normalizeThemeId(id)
  idx = 0
  i = 0
  while i < ids.Count()
    if ids[i] = current then idx = i
    i = i + 1
  end while
  n = ids.Count()
  if n < 1 then return tvmThemeDefault()
  nextIdx = idx + delta
  while nextIdx < 0
    nextIdx = nextIdx + n
  end while
  while nextIdx >= n
    nextIdx = nextIdx - n
  end while
  return ids[nextIdx]
end function

function tvmThemePalette(id as Dynamic) as Object
  key = normalizeThemeId(id)
  p = {}
  if key = "dark"
    p.bg = "0x0A0D12FF"
    p.bgDeep = "0x05070BFF"
    p.bgElevated = "0x141922FF"
    p.surface = "0x1D2430FF"
    p.surfaceHover = "0x253040FF"
    p.glass = "0x141922C7"
    p.text = "0xE8ECF2FF"
    p.muted = "0x9BA7B8FF"
    p.faint = "0x6B7686FF"
    p.focus = "0xFFFFFFFF"
    p.accentInk = "0x111111FF"
    p.accentBlue = "0x00A8E1FF"
    p.sceneFar = "0x14284C88"
    p.sceneMid = "0x1A4A7259"
    p.sceneNear = "0x07101C70"
    p.sceneSun = "0xD8EEFE3D"
  else
    p.bg = "0xF4F5F7FF"
    p.bgDeep = "0xE8ECF2FF"
    p.bgElevated = "0xFFFFFFFF"
    p.surface = "0xE8ECF2FF"
    p.surfaceHover = "0xD8E0EAFF"
    p.glass = "0xFFFFFFE8"
    p.text = "0x18222EFF"
    p.muted = "0x435166FF"
    p.faint = "0x526176FF"
    p.focus = "0x18222EFF"
    p.accentInk = "0xFFFFFFFF"
    p.accentBlue = "0x0068A8FF"
    p.sceneFar = "0x00000000"
    p.sceneMid = "0x00000000"
    p.sceneNear = "0x00000000"
    p.sceneSun = "0x00000000"
  end if
  return p
end function

sub applyThemeColorsToScene(scene as Object, id as Dynamic)
  key = normalizeThemeId(id)
  rememberThemeId(key)
  if scene = invalid then return
  scene.themeId = key
  palette = tvmThemePalette(key)
  letterbox = scene.findNode("letterbox")
  if letterbox <> invalid then letterbox.color = palette.bgDeep
  bg = scene.findNode("bg")
  if bg <> invalid then bg.color = palette.bg
  boot = scene.findNode("bootLabel")
  if boot <> invalid then boot.color = palette.text
  scene.backgroundColor = palette.bgDeep
  paintSceneWash(scene, palette)
end sub

' SceneGraph XML has fixed initial colors. Repaint cached screens when the
' palette changes, while picture overlays keep their authored contrast.
function tvmPalettePairs(previous as Object, current as Object) as Object
  probe = CreateObject("roSGNode", "Rectangle")
  labels = []
  rectangles = []
  for each key in ["text", "muted", "faint"]
    probe.color = previous[key]
    oldColor = probe.color
    probe.color = current[key]
    labels.Push({ oldColor: oldColor, newColor: probe.color })
  end for
  for each row in [{ value: "0xF5F5F5FF", key: "text" }, { value: "0xFFFFFFFF", key: "text" }, { value: "0xC4C4C4FF", key: "muted" }, { value: "0x8A8A8AFF", key: "faint" }]
    probe.color = row.value
    oldColor = probe.color
    probe.color = current[row.key]
    labels.Push({ oldColor: oldColor, newColor: probe.color })
  end for
  for each key in ["bg", "bgDeep", "bgElevated", "surface", "surfaceHover", "glass"]
    probe.color = previous[key]
    oldColor = probe.color
    probe.color = current[key]
    rectangles.Push({ oldColor: oldColor, newColor: probe.color })
  end for
  for each row in [{ value: "0x000000FF", key: "bgDeep" }, { value: "0x0B0B0BFF", key: "bg" }, { value: "0x161616FF", key: "bgElevated" }, { value: "0x1D1D1DFF", key: "surface" }, { value: "0x2B2B2BFF", key: "surfaceHover" }]
    probe.color = row.value
    oldColor = probe.color
    probe.color = current[row.key]
    rectangles.Push({ oldColor: oldColor, newColor: probe.color })
  end for
  return { labels: labels, rectangles: rectangles }
end function

sub repaintThemeNodes(node as Object, pairs as Object)
  if node = invalid then return
  kind = node.subtype()
  if kind = "PlayerScreen" or kind = "DetailsPanel" or kind = "ServiceScreen" or kind = "BrandLockup" then return
  if node.id <> invalid and Left(LCase(node.id), 4) = "hero" then return
  if kind = "FocusButton"
    variant = node.variant
    node.variant = ""
    node.variant = variant
    return
  end if
  colors = invalid
  if kind = "Label" then colors = pairs.labels
  if kind = "Rectangle" then colors = pairs.rectangles
  if colors <> invalid
    for each pair in colors
      if node.color = pair.oldColor
        node.color = pair.newColor
        exit for
      end if
    end for
  end if
  for i = 0 to node.getChildCount() - 1
    repaintThemeNodes(node.getChild(i), pairs)
  end for
end sub

sub paintSceneWash(scene as Object, palette as Object)
  if scene = invalid then return
  far = scene.findNode("sceneFar")
  if far <> invalid then far.color = palette.sceneFar
  mid = scene.findNode("sceneMid")
  if mid <> invalid then mid.color = palette.sceneMid
  near = scene.findNode("sceneNear")
  if near <> invalid then near.color = palette.sceneNear
  sun = scene.findNode("sceneSun")
  if sun <> invalid then sun.color = palette.sceneSun
  ids = ["sceneFarAnim", "sceneMidAnim", "sceneNearAnim", "sceneSunAnim"]
  i = 0
  while i < ids.Count()
    anim = scene.findNode(ids[i])
    if anim <> invalid then anim.control = "start"
    i = i + 1
  end while
end sub
