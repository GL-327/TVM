sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.grid = m.top.findNode("grid")
  m.gridAnim = m.top.findNode("gridAnim")
  m.gridInterp = m.top.findNode("gridInterp")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.ribbon.activeId = "apps"
  m.ribbon.focusCol = 13
  m.ribbon.hasBarFocus = false
  m.allowMocks = (m.top.allowMocks <> false)
  m.apps = tvmAppList()
  m.tiles = []
  m.cols = 4
  m.cellW = 880
  m.cellH = 560
  tileScale = 800 / 284
  i = 0
  while i < m.apps.Count()
    spec = m.apps[i]
    tile = CreateObject("roSGNode", "AppTile")
    tile.appId = spec.id
    tile.locked = tvmAppIsLocked(spec.id, m.allowMocks)
    tile.focusable = true
    tile.scaleRotateCenter = [0, 0]
    tile.scale = [tileScale, tileScale]
    tile.translation = [(i mod m.cols) * m.cellW, Int(i / m.cols) * m.cellH]
    m.grid.appendChild(tile)
    m.tiles.Push(tile)
    i = i + 1
  end while
  m.zone = "grid"
  m.col = 0
  m.seq = 0
  paintFocus()
end sub

sub slideGrid(y as Float)
  if m.grid = invalid then return
  current = m.grid.translation
  startY = 0
  if current <> invalid then startY = current[1]
  if Abs(startY - y) < 2
    m.grid.translation = [0, y]
    return
  end if
  if m.gridAnim = invalid or m.gridInterp = invalid
    m.grid.translation = [0, y]
    return
  end if
  m.gridAnim.control = "stop"
  m.gridInterp.keyValue = [[0, startY], [0, y]]
  m.gridAnim.control = "start"
end sub

sub paintFocus()
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  i = 0
  while i < m.tiles.Count()
    on = (m.zone = "grid" and i = m.col)
    m.tiles[i].hasFocusStyle = on
    m.tiles[i].focusable = true
    i = i + 1
  end while
  row = 0
  if m.zone = "grid" and m.col >= 0 and m.col < m.tiles.Count()
    row = Int(m.col / m.cols)
  end if
  slideGrid(0 - (row * m.cellH))
  if m.zone = "grid" and m.col >= 0 and m.col < m.tiles.Count()
    m.tiles[m.col].setFocus(true)
  else
    m.top.setFocus(true)
  end if
end sub

function focusedAppId() as String
  if m.col < 0 or m.col >= m.tiles.Count() then return ""
  tile = m.tiles[m.col]
  if tile = invalid then return ""
  appId = asText(tile.appId)
  if appId <> "" then return appId
  if m.col < m.apps.Count() then return asText(m.apps[m.col].id)
  return ""
end function

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

sub emitOpenApp()
  appId = focusedAppId()
  if appId = "" then return
  spec = tvmAppById(appId)
  name = appId
  if spec <> invalid then name = spec.name
  emit("openApp", { id: appId, appId: appId, name: name })
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if m.zone = "ribbon"
    if intent = "left" and m.ribbon.focusCol > 0 then m.ribbon.focusCol = m.ribbon.focusCol - 1
    if intent = "right" and m.ribbon.focusCol < tvmRibbonLast() then m.ribbon.focusCol = m.ribbon.focusCol + 1
    if intent = "down" then m.zone = "grid"
    if intent = "select" then emit(tvmRibbonSpec()[m.ribbon.focusCol].action, invalid)
    paintFocus()
    return true
  end if
  cols = m.cols
  count = m.tiles.Count()
  if count = 0
    if intent = "up" then m.zone = "ribbon"
    paintFocus()
    return true
  end if
  if m.col < 0 then m.col = 0
  if m.col >= count then m.col = count - 1
  row = Int(m.col / cols)
  col = m.col mod cols
  maxRow = Int((count - 1) / cols)
  if intent = "left" and col > 0 then m.col = m.col - 1
  if intent = "right" and m.col < count - 1 then m.col = m.col + 1
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
  if intent = "select" then emitOpenApp()
  paintFocus()
  return true
end function
