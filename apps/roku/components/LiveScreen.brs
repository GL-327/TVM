sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.grid = m.top.findNode("grid")
  m.empty = m.top.findNode("empty")
  m.error = m.top.findNode("error")
  m.loading = m.top.findNode("loading")
  m.choose = m.top.findNode("choose")
  m.playlist = m.top.findNode("playlist")
  m.nextPage = m.top.findNode("nextPage")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.loading.font = tvmFontBody()
  m.ribbon.activeId = "live"
  m.ribbon.focusCol = 4
  m.ribbon.hasBarFocus = false
  m.choose.variant = "primary"
  m.choose.label = "Choose channels"
  m.playlist.variant = "glass"
  m.playlist.label = "Playlist"
  m.nextPage.variant = "glass"
  m.nextPage.label = "More"
  m.empty.title = "Add a playlist you are allowed to use"
  m.empty.body = "TVM only shows channels from an official service or an M3U/M3U8 playlist you supply."
  m.error.title = "Playlist could not be loaded"
  m.error.body = "Check the URL in Settings, then retry."
  m.all = []
  m.channels = []
  m.tiles = []
  m.pageIndex = 0
  m.pageSize = 12
  m.zone = "grid"
  m.col = 0
  m.action = 0
  m.seq = 0
end sub

sub onMode()
  mode = m.top.mode
  ready = (mode = "ready" and m.channels.Count() > 0)
  m.grid.visible = ready
  m.empty.visible = (mode = "empty" or (mode = "ready" and m.channels.Count() = 0))
  m.error.visible = (mode = "error")
  m.loading.visible = (mode = "loading")
  m.error.hasFocusStyle = (mode = "error" and m.zone <> "ribbon")
  paintFocus()
end sub

sub rebuildPage()
  while m.grid.getChildCount() > 0
    m.grid.removeChildIndex(0)
  end while
  m.tiles = []
  m.channels = []
  cols = 4
  startAt = m.pageIndex * m.pageSize
  i = 0
  while i < m.pageSize and startAt + i < m.all.Count()
    ch = m.all[startAt + i]
    m.channels.Push(ch)
    tile = CreateObject("roSGNode", "ChannelTile")
    tile.item = ch
    tile.picking = false
    tile.translation = [(i mod cols) * 880, Int(i / cols) * 420]
    m.grid.appendChild(tile)
    m.tiles.Push(tile)
    i = i + 1
  end while
  more = m.all.Count() > m.pageSize
  m.nextPage.visible = more
  if m.pageIndex > 0
    m.nextPage.label = "More"
  else
    m.nextPage.label = "More"
  end if
  if m.nextPage.visible = false and m.zone = "next" then m.zone = "choose"
  if m.col >= m.channels.Count() then m.col = 0
end sub

sub onStatus()
  status = m.top.status
  m.all = aaArray(status, "channels")
  m.pageIndex = 0
  m.col = 0
  picked = asText(aaGet(status, "picked", "0"))
  total = asText(aaGet(status, "total", "0"))
  needsPicks = aaGet(status, "needsPicks", false)
  if needsPicks = true and m.all.Count() = 0
    m.heading.text = "Choose channels"
    m.lede.text = total + " channels in this playlist. Pick the ones you watch."
    m.empty.title = "Pick the channels you watch"
    m.empty.body = "This playlist is too large to show at once. The same lineup appears on this Roku and on the computer."
  else if needsPicks = true
    m.heading.text = "Your channels"
    m.lede.text = total + " in the playlist. Choose which channels to keep on Live TV."
  else if m.all.Count() = 0
    m.heading.text = "Your channels"
    m.lede.text = ""
    m.empty.title = "Add a playlist you are allowed to use"
    m.empty.body = "TVM only shows channels from an official service or an M3U/M3U8 playlist you supply."
  else
    m.heading.text = "Your channels"
    if total <> "0"
      m.lede.text = picked + " of " + total + " channels on Live TV."
    else
      m.lede.text = asText(m.all.Count()) + " channels."
    end if
  end if
  rebuildPage()
  if m.channels.Count() = 0 and m.top.mode = "ready" then m.top.mode = "empty"
  if m.channels.Count() = 0 then m.zone = "choose"
  paintFocus()
end sub

sub paintFocus()
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  m.choose.hasFocusStyle = (m.zone = "choose")
  m.playlist.hasFocusStyle = (m.zone = "playlist")
  m.nextPage.hasFocusStyle = (m.zone = "next")
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
    if m.zone = "grid" and m.channels.Count() = 0 then m.zone = "choose"
    paintFocus()
    return true
  end if
  if m.zone = "choose" or m.zone = "playlist" or m.zone = "next"
    if intent = "up"
      if m.channels.Count() > 0 then m.zone = "grid" else m.zone = "ribbon"
    end if
    if intent = "left"
      if m.zone = "next"
        m.zone = "playlist"
      else if m.zone = "playlist"
        m.zone = "choose"
      end if
    end if
    if intent = "right"
      if m.zone = "choose"
        m.zone = "playlist"
      else if m.zone = "playlist" and m.nextPage.visible = true
        m.zone = "next"
      end if
    end if
    if intent = "select"
      if m.zone = "choose" then emit("picks", invalid)
      if m.zone = "playlist" then emit("playlist", invalid)
      if m.zone = "next"
        if (m.pageIndex + 1) * m.pageSize >= m.all.Count()
          m.pageIndex = 0
        else
          m.pageIndex = m.pageIndex + 1
        end if
        rebuildPage()
      end if
    end if
    paintFocus()
    return true
  end if
  cols = 4
  count = m.channels.Count()
  if count = 0
    if intent = "up" then m.zone = "ribbon"
    if intent = "down" or intent = "select" then m.zone = "choose"
    if m.zone = "choose" and intent = "select" then emit("picks", invalid)
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
      m.zone = "choose"
    end if
  end if
  if intent = "select" then emit("play", { item: m.channels[m.col] })
  paintFocus()
  return true
end function
