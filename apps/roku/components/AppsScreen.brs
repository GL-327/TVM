sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.grid = m.top.findNode("grid")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.ribbon.activeId = "apps"
  m.ribbon.focusCol = 13
  m.ribbon.hasBarFocus = false
  m.apps = tvmAppList()
  m.tiles = []
  m.labels = []
  m.rings = []
  cols = 4
  i = 0
  while i < m.apps.Count()
    col = i mod cols
    row = Int(i / cols)
    wrap = CreateObject("roSGNode", "Group")
    wrap.translation = [col * 880, row * 560]
    ring = CreateObject("roSGNode", "Rectangle")
    ring.width = 832
    ring.height = 512
    ring.translation = [-16, -16]
    ring.cornerRadius = 36
    ring.color = "0x00000000"
    art = CreateObject("roSGNode", "Poster")
    art.width = 800
    art.height = 480
    art.uri = m.apps[i].tile
    art.loadDisplayMode = "scaleToFill"
    name = CreateObject("roSGNode", "Label")
    name.text = m.apps[i].wordmark
    name.color = tvmText()
    name.width = 800
    name.height = 480
    name.horizAlign = "center"
    name.vertAlign = "center"
    name.font = tvmFontTitle()
    wrap.appendChild(ring)
    wrap.appendChild(art)
    wrap.appendChild(name)
    m.grid.appendChild(wrap)
    m.tiles.Push(wrap)
    m.rings.Push(ring)
    i = i + 1
  end while
  m.zone = "grid"
  m.col = 1
  m.seq = 0
  paintFocus()
end sub

sub paintFocus()
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  i = 0
  while i < m.rings.Count()
    if m.zone = "grid" and i = m.col
      m.rings[i].color = tvmFocus()
      m.tiles[i].scale = [tvmFocusScale(), tvmFocusScale()]
    else
      m.rings[i].color = "0x00000000"
      m.tiles[i].scale = [1.0, 1.0]
    end if
    i = i + 1
  end while
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq }
  if extra <> invalid
    for each key in extra
      action[key] = extra[key]
    end for
  end if
  m.top.action = action
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if m.zone = "ribbon"
    if intent = "left" and m.ribbon.focusCol > 0 then m.ribbon.focusCol = m.ribbon.focusCol - 1
    if intent = "right" and m.ribbon.focusCol < tvmRibbonLast() then m.ribbon.focusCol = m.ribbon.focusCol + 1
    if intent = "down" then m.zone = "grid"
    if intent = "select" then emit(tvmRibbonSpec()[m.ribbon.focusCol].action, invalid)
    if intent = "home" then emit("home", invalid)
    paintFocus()
    return true
  end if
  cols = 4
  count = m.apps.Count()
  row = Int(m.col / cols)
  col = m.col mod cols
  maxRow = Int((count - 1) / cols)
  if intent = "left"
    if col > 0 then m.col = m.col - 1 else m.col = row * cols + ((count - 1) mod cols)
    if m.col >= count then m.col = count - 1
  end if
  if intent = "right"
    if m.col < count - 1 then m.col = m.col + 1 else m.col = row * cols
  end if
  if intent = "up"
    if row > 0
      m.col = m.col - cols
    else
      m.zone = "ribbon"
    end if
  end if
  if intent = "down" and row < maxRow
    nextCol = m.col + cols
    if nextCol < count then m.col = nextCol
  end if
  if intent = "select"
    spec = m.apps[m.col]
    emit("openApp", { id: spec.id, name: spec.name })
  end if
  if intent = "home" then emit("home", invalid)
  paintFocus()
  return true
end function
