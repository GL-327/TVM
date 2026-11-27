' Hub start page: a greeting over trending art, then Continue watching, apps and
' free live TV. Zones: nav (NavStrip) | hero (0 Browse Home, 1 Search) | rows.
' Remote: Left/Right move inside a zone, Down/Up move between zones and rows,
' OK opens, Back (handled by the scene) returns to the previous screen.
' The apps and live rows keep a small window of tiles around the focused one,
' so low-end Rokus stay light.
sub init()
  m.top.focusable = true
  m.nav = m.top.findNode("nav")
  m.heroArt = m.top.findNode("heroArt")
  m.heroFade = m.top.findNode("heroFade")
  m.copyIn = m.top.findNode("copyIn")
  m.heroCopy = m.top.findNode("heroCopy")
  m.railScrim = m.top.findNode("railScrim")
  m.rowsGroup = m.top.findNode("rows")
  m.rowsAnim = m.top.findNode("rowsAnim")
  m.rowsInterp = m.top.findNode("rowsInterp")
  m.greeting = m.top.findNode("greeting")
  m.prompt = m.top.findNode("prompt")
  m.caption = m.top.findNode("caption")
  m.browseBtn = m.top.findNode("browseBtn")
  m.searchBtn = m.top.findNode("searchBtn")
  m.greeting.font = tvmFontHeroTitle()
  m.prompt.font = tvmFont("medium", tvmTypeSize(tvmTypePrimary()))
  m.prompt.text = "What are you in the mood for?"
  m.caption.font = tvmFontMeta()
  m.browseBtn.variant = "glassPill"
  m.browseBtn.pillWidth = 420
  m.browseBtn.iconUri = "pkg:/images/icons/play.png"
  m.browseBtn.label = "Browse Home"
  m.browseBtn.itemId = "start-browse"
  m.searchBtn.variant = "glassPill"
  m.searchBtn.pillWidth = 360
  m.searchBtn.iconUri = "pkg:/images/icons/search.png"
  m.searchBtn.label = "Search"
  m.searchBtn.itemId = "start-search"
  m.heroArt.observeField("loadStatus", "onHeroLoad")
  m.top.observeField("visible", "onVisible")
  m.zone = "hero"
  m.heroCol = 0
  m.navCol = 0
  m.row = 0
  m.col = 0
  m.seq = 0
  m.rows = []
  m.watching = []
  m.channels = []
  m.apps = tvmAppList()
  m.rowsY = 1500
  m.heroUri = ""
  m.nav.activeId = "home"
  onGreeting()
  rebuildRows()
  paintFocus()
end sub

sub onVisible()
  if m.top.visible
    onGreeting()
    if m.copyIn <> invalid and not tvmReduceMotion() then m.copyIn.control = "start"
  end if
end sub

sub onGreeting()
  if m.greeting = invalid then return
  dt = CreateObject("roDateTime")
  dt.ToLocalTime()
  m.greeting.text = startGreetingLine(dt.GetHours(), m.top.profileName)
  m.nav.profileName = m.top.profileName
end sub

sub onPayload()
  payload = m.top.payload
  m.watching = startContinue(payload)
  hero = startHeroItem(payload)
  uri = ""
  caption = ""
  if hero <> invalid
    uri = preferHeroUri(hero)
    caption = "On Home  -  " + asText(aaGet(hero, "title", ""))
  end if
  m.caption.text = caption
  if uri <> m.heroUri
    m.heroUri = uri
    m.heroArt.opacity = 0
    m.heroArt.uri = uri
  end if
  rebuildRows()
  paintFocus()
end sub

sub onHeroLoad()
  if m.heroArt.loadStatus <> "ready" then return
  if m.heroFade = invalid or tvmReduceMotion()
    m.heroArt.opacity = 1
  else
    m.heroFade.control = "stop"
    m.heroFade.control = "start"
  end if
end sub

sub onChannels()
  m.channels = startChannels(m.top.freeChannels)
  rebuildRows()
  paintFocus()
end sub

function rowHeightFor(id as String) as Integer
  if id = "continue" then return railRowHeight("landscape")
  return 560
end function

sub rebuildRows()
  if m.rowsGroup = invalid then return
  while m.rowsGroup.getChildCount() > 0
    m.rowsGroup.removeChildIndex(0)
  end while
  m.rows = []
  ids = startRowIds(m.watching.Count() > 0, m.channels.Count() > 0)
  y = 0
  for each id in ids
    row = { id: id, y: y, first: -1, tiles: [], count: 0, pitch: 640 }
    group = CreateObject("roSGNode", "Group")
    group.translation = [0, y]
    if id = "continue"
      rail = CreateObject("roSGNode", "PosterRail")
      rail.layout = "landscape"
      rail.loop = false
      rail.title = "Continue watching"
      rail.items = m.watching
      group.appendChild(rail)
      row.rail = rail
      row.count = m.watching.Count()
    else
      heading = CreateObject("roSGNode", "Label")
      heading.font = tvmFontLabel()
      heading.color = tvmText()
      heading.translation = [160, 0]
      heading.width = 3200
      if id = "apps"
        heading.text = "Apps & services"
        row.count = m.apps.Count()
      else
        heading.text = "Free live TV"
        row.count = m.channels.Count()
        row.pitch = 736
      end if
      group.appendChild(heading)
      track = CreateObject("roSGNode", "Group")
      track.translation = [160, 100]
      group.appendChild(track)
      row.track = track
    end if
    m.rowsGroup.appendChild(group)
    m.rows.Push(row)
    y = y + rowHeightFor(id)
  end for
  if m.row >= m.rows.Count() then m.row = m.rows.Count() - 1
  if m.row < 0 then m.row = 0
  if m.zone = "rows" and m.rows.Count() = 0 then m.zone = "hero"
  clampCol()
end sub

sub clampCol()
  if m.rows.Count() = 0
    m.col = 0
    return
  end if
  count = m.rows[m.row].count
  if m.col >= count then m.col = count - 1
  if m.col < 0 then m.col = 0
end sub

' Tiles of the apps and live rows: build the visible window around the focused column.
sub paintTiles(row as Object, focusCol as Integer)
  visible = 5
  first = row.first
  if first < 0 then first = 0
  if focusCol >= 0
    if focusCol < first then first = focusCol
    if focusCol > first + visible - 1 then first = focusCol - visible + 1
  end if
  if first <> row.first
    while row.track.getChildCount() > 0
      row.track.removeChildIndex(0)
    end while
    row.tiles = []
    row.first = first
    i = first
    while i < row.count and i < first + visible
      if row.id = "apps"
        tile = CreateObject("roSGNode", "AppTile")
        tile.appId = m.apps[i].id
        tile.locked = tvmAppIsLocked(m.apps[i].id, true)
        tile.scale = [2.0, 2.0]
      else
        tile = CreateObject("roSGNode", "ChannelTile")
        tile.item = m.channels[i]
        tile.scale = [0.8, 0.8]
      end if
      tile.scaleRotateCenter = [0, 0]
      tile.translation = [(i - first) * row.pitch, 0]
      row.track.appendChild(tile)
      row.tiles.Push(tile)
      i = i + 1
    end while
  end if
  i = 0
  while i < row.tiles.Count()
    row.tiles[i].hasFocusStyle = (focusCol = row.first + i)
    i = i + 1
  end while
end sub

sub paintFocus()
  m.nav.hasBarFocus = (m.zone = "nav")
  m.nav.focusCol = m.navCol
  m.browseBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 0)
  m.searchBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 1)
  inRows = (m.zone = "rows" and m.rows.Count() > 0)
  r = 0
  while r < m.rows.Count()
    row = m.rows[r]
    focusCol = -1
    if inRows and r = m.row then focusCol = m.col
    if row.id = "continue"
      row.rail.focusCol = focusCol
    else
      paintTiles(row, focusCol)
    end if
    r = r + 1
  end while
  m.heroCopy.visible = not inRows
  m.railScrim.visible = inRows
  if inRows
    slideRows(1000 - m.rows[m.row].y)
  else
    slideRows(1500)
  end if
end sub

sub slideRows(y as Float)
  if Abs(m.rowsY - y) < 2
    m.rowsGroup.translation = [0, y]
    return
  end if
  startY = m.rowsY
  m.rowsY = y
  if m.rowsAnim = invalid or tvmReduceMotion()
    m.rowsGroup.translation = [0, y]
    return
  end if
  m.rowsAnim.control = "stop"
  m.rowsInterp.keyValue = [[0, startY], [0, y]]
  m.rowsAnim.control = "start"
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
  if isDirectional(intent)
    moveFocus(intent)
    return true
  end if
  if intent = "select"
    activate()
    return true
  end if
  return true
end function

sub moveFocus(intent as String)
  if m.zone = "nav"
    if intent = "left" or intent = "right"
      m.navCol = navStep(m.navCol, intent, tvmNavSpec().Count() + 1)
    else if intent = "down"
      m.zone = "hero"
    end if
  else if m.zone = "hero"
    if intent = "left" or intent = "right"
      m.heroCol = navStep(m.heroCol, intent, 2)
    else if intent = "up"
      m.zone = "nav"
    else if intent = "down" and m.rows.Count() > 0
      m.zone = "rows"
      m.row = 0
      clampCol()
    end if
  else
    if intent = "left" or intent = "right"
      m.col = navStep(m.col, intent, m.rows[m.row].count)
    else if intent = "up"
      if m.row > 0
        m.row = m.row - 1
        clampCol()
      else
        m.zone = "hero"
      end if
    else if intent = "down" and m.row < m.rows.Count() - 1
      m.row = m.row + 1
      clampCol()
    end if
  end if
  paintFocus()
end sub

sub activate()
  if m.zone = "nav"
    specs = tvmNavSpec()
    if m.navCol >= specs.Count()
      emit("you", invalid)
    else
      emit("nav", { id: specs[m.navCol].id })
    end if
    return
  end if
  if m.zone = "hero"
    if m.heroCol = 0 then emit("browse", invalid)
    if m.heroCol = 1 then emit("search", invalid)
    return
  end if
  if m.rows.Count() = 0 then return
  row = m.rows[m.row]
  if row.id = "continue"
    if m.col < m.watching.Count()
      item = m.watching[m.col]
      emit(startResumeAction(item), { item: item })
    end if
  else if row.id = "apps"
    if m.col < m.apps.Count() then emit("openApp", { id: m.apps[m.col].id, appId: m.apps[m.col].id, name: m.apps[m.col].name })
  else if row.id = "live"
    if m.col < m.channels.Count() then emit("play", { item: m.channels[m.col] })
  end if
end sub

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
