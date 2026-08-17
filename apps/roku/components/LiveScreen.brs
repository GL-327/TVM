sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.grid = m.top.findNode("grid")
  m.empty = m.top.findNode("empty")
  m.error = m.top.findNode("error")
  m.loading = m.top.findNode("loading")
  m.playlist = m.top.findNode("playlist")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.loading.font = tvmFontBody()
  m.ribbon.activeId = "live"
  m.ribbon.focusCol = 4
  m.ribbon.hasBarFocus = false
  m.playlist.variant = "glass"
  m.playlist.label = "Playlist URL"
  m.empty.title = "Add a playlist you are allowed to use"
  m.empty.body = "TVM only shows channels from an official service or an M3U/M3U8 playlist you supply."
  m.error.title = "Playlist could not be loaded"
  m.error.body = "Check the URL in Settings, then retry."
  m.channels = []
  m.tiles = []
  m.zone = "grid"
  m.col = 0
  m.seq = 0
end sub

sub onMode()
  mode = m.top.mode
  m.grid.visible = (mode = "ready" and m.channels.Count() > 0)
  m.empty.visible = (mode = "empty" or (mode = "ready" and m.channels.Count() = 0))
  m.error.visible = (mode = "error")
  m.loading.visible = (mode = "loading")
  m.error.hasFocusStyle = (mode = "error" and m.zone <> "ribbon")
  paintFocus()
end sub

sub onStatus()
  while m.grid.getChildCount() > 0
    m.grid.removeChildIndex(0)
  end while
  m.tiles = []
  m.channels = []
  status = m.top.status
  channels = aaArray(status, "channels")
  cols = 4
  i = 0
  while i < channels.Count() and i < 24
    ch = channels[i]
    m.channels.Push(ch)
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "glass"
    btn.label = aaGet(ch, "name", "Channel")
    btn.detail = aaGet(ch, "group", "")
    btn.translation = [(i mod cols) * 880, Int(i / cols) * 200]
    m.grid.appendChild(btn)
    m.tiles.Push(btn)
    i = i + 1
  end while
  if m.channels.Count() = 0 and m.top.mode = "ready" then m.top.mode = "empty"
  m.col = 0
  paintFocus()
end sub

sub paintFocus()
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  m.playlist.hasFocusStyle = (m.zone = "playlist")
  i = 0
  while i < m.tiles.Count()
    m.tiles[i].hasFocusStyle = (m.zone = "grid" and i = m.col)
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
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if m.top.mode = "error" and intent = "select"
    emit("retry", invalid)
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
  if m.zone = "playlist"
    if intent = "up" then m.zone = "grid"
    if intent = "select" then emit("playlist", invalid)
    paintFocus()
    return true
  end if
  cols = 4
  count = m.channels.Count()
  if count = 0
    if intent = "up" then m.zone = "ribbon"
    if intent = "down" or intent = "select" then m.zone = "playlist"
    if m.zone = "playlist" and intent = "select" then emit("playlist", invalid)
    paintFocus()
    return true
  end if
  row = Int(m.col / cols)
  col = m.col mod cols
  maxRow = Int((count - 1) / cols)
  if intent = "left" and col > 0 then m.col = m.col - 1
  if intent = "right" and m.col < count - 1 then m.col = m.col + 1
  if intent = "up"
    if row > 0 then m.col = m.col - cols else m.zone = "ribbon"
  end if
  if intent = "down"
    nextCol = m.col + cols
    if nextCol < count
      m.col = nextCol
    else
      m.zone = "playlist"
    end if
  end if
  if intent = "select" then emit("play", { item: m.channels[m.col] })
  paintFocus()
  return true
end function
