' Theme ids match apps/ui: happy (default), dark, glass (Liquid Glass).
' Persist on this Roku via the tvm registry section. Scene apply paints
' letterbox / stage / boot. TVMScene calls applyGlassTheme when glass.

function tvmThemeDefault() as String
  return "happy"
end function

function tvmThemeIds() as Object
  return ["happy", "dark", "glass"]
end function

function normalizeThemeId(id as Dynamic) as String
  if id = invalid then return tvmThemeDefault()
  if GetInterface(id, "ifString") = invalid then return tvmThemeDefault()
  key = LCase(id.Trim())
  if key = "dark" then return "dark"
  if key = "glass" then return "glass"
  if key = "liquid-glass" then return "glass"
  if key = "liquidglass" then return "glass"
  return "happy"
end function

function tvmThemeLabel(id as Dynamic) as String
  key = normalizeThemeId(id)
  if key = "dark" then return "Dark"
  if key = "glass" then return "Liquid Glass"
  return "Happy"
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
  else if key = "glass"
    p.bg = "0x08141EFF"
    p.bgDeep = "0x02080EFF"
    p.bgElevated = "0x101C2CFF"
    p.surface = "0x081422CC"
    p.surfaceHover = "0x1A2C40FF"
    p.glass = "0x0A182694"
    p.text = "0xF4FAFFFF"
    p.muted = "0xD2DCE8FF"
    p.faint = "0xA8B6C6FF"
    p.focus = "0xFFFEF6FF"
    p.accentInk = "0x0A1624FF"
    p.accentBlue = "0x6EE4FFFF"
    p.sceneFar = "0x08141E80"
    p.sceneMid = "0x6EC8E859"
    p.sceneNear = "0x123A6270"
    p.sceneSun = "0xFFF6E43D"
  else
    p.bg = "0x2A1C28FF"
    p.bgDeep = "0x1A1218FF"
    p.bgElevated = "0x3A2836FF"
    p.surface = "0x443240FF"
    p.surfaceHover = "0x564450FF"
    p.glass = "0x443240D6"
    p.text = "0xFFFDF8FF"
    p.muted = "0xF3E6D4FF"
    p.faint = "0xD0BBA8FF"
    p.focus = "0xFFFEF8FF"
    p.accentInk = "0x1A1220FF"
    p.accentBlue = "0x3EC8FFFF"
    p.sceneFar = "0x6A203888"
    p.sceneMid = "0xFF9A6C59"
    p.sceneNear = "0x5A204070"
    p.sceneSun = "0xFFE5664D"
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
