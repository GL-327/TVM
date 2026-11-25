sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.heading = m.top.findNode("heading") : m.heading.font = tvmFontTitle()
  m.lede = m.top.findNode("lede") : m.lede.font = tvmFontBody()
  m.top.findNode("kicker").font = tvmFontCaption()
  m.grid = m.top.findNode("grid")
  m.choose = m.top.findNode("choose") : m.choose.variant = "glassPill" : m.choose.label = "Choose channels" : m.choose.pillWidth = 560
  m.playlist = m.top.findNode("playlist") : m.playlist.variant = "glassPill" : m.playlist.label = "Playlist"
  m.top.findNode("nextPage").visible = false
  m.top.findNode("loading").visible = false
  m.top.findNode("empty").visible = false
  m.top.findNode("error").visible = false
  m.groups = [] : m.tiles = [] : m.row = 0 : m.col = 0 : m.zone = "grid" : m.navCol = 3 : m.seq = 0
end sub

sub onMode()
  ' Playlist failure must never hide the bundled free channels.
  if m.top.mode = "error" then m.lede.text = "Your playlist could not load. Free channels are still available."
end sub

sub onStatus()
  channels = aaArray(m.top.status, "channels")
  groups = [] : byGroup = {}
  for each source in ["free", "playlist"]
    for each ch in channels
      free = aaGet(ch, "source", "") = "free"
      if (source = "free" and free) or (source = "playlist" and not free)
        group = asText(aaGet(ch, "group", "Other"))
        id = source + ":" + group
        if not byGroup.DoesExist(id)
          prefix = "Your channels"
          if free then prefix = "Free channels"
          row = { id: id, title: prefix + " - " + group, items: [] }
          byGroup[id] = row : groups.Push(row)
        end if
        byGroup[id].items.Push(ch)
      end if
    end for
  end for
  m.groups = groups
  m.row = 0 : m.col = 0
  m.heading.text = "Live TV"
  m.lede.text = "Free channels play without a login or playlist. BBC channels play in the UK only."
  rebuildPage()
end sub

sub rebuildPage()
  m.grid.removeChildren(m.grid.getChildren(-1, 0))
  m.tiles = []
  if m.groups.Count() = 0
    m.lede.text = "No channels match this profile's age limit. Switch profile to see other groups."
    m.zone = "choose"
    paintFocus()
    return
  end if
  firstRow = m.row
  for rowIndex = firstRow to firstRow + 1
    if rowIndex < m.groups.Count()
      row = m.groups[rowIndex]
      heading = CreateObject("roSGNode", "Label")
      heading.font = tvmFont("semibold", 56) : heading.text = row.title
      heading.translation = [0, (rowIndex - firstRow) * 620] : heading.width = 3440
      m.grid.appendChild(heading)
      first = 0
      if rowIndex = m.row and m.col > 3 then first = m.col - 3
      for i = first to first + 3
        if i < row.items.Count()
          tile = CreateObject("roSGNode", "ChannelTile")
          tile.item = row.items[i]
          tile.translation = [(i - first) * 864, (rowIndex - firstRow) * 620 + 100]
          tile.hasFocusStyle = (m.zone = "grid" and rowIndex = m.row and i = m.col)
          m.grid.appendChild(tile)
          if rowIndex = m.row then m.tiles.Push({ node: tile, index: i })
        end if
      end for
    end if
  end for
  paintFocus()
end sub

sub paintFocus()
  m.ribbon.activeId = "live"
  m.ribbon.hasBarFocus = m.zone = "ribbon" : m.ribbon.focusCol = m.navCol
  m.choose.hasFocusStyle = m.zone = "choose"
  m.playlist.hasFocusStyle = m.zone = "playlist"
  for each tile in m.tiles
    tile.node.hasFocusStyle = (m.zone = "grid" and tile.index = m.col)
  end for
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
  if intent = "back" then return false
  if m.zone = "ribbon"
    if intent = "left" or intent = "right" then m.navCol = navStep(m.navCol, intent, tvmNavSpec().Count() + 1)
    if intent = "down" then m.zone = "grid" : rebuildPage()
    if intent = "select"
      if m.navCol >= tvmNavSpec().Count() then emit("you", invalid) else emit("nav", { id: tvmNavSpec()[m.navCol].id })
    end if
  else if m.zone = "choose" or m.zone = "playlist"
    if intent = "up"
      if m.groups.Count() > 0 then m.zone = "grid" : rebuildPage() else m.zone = "ribbon"
    end if
    if intent = "left" then m.zone = "choose"
    if intent = "right" then m.zone = "playlist"
    if intent = "select"
      if m.zone = "choose" then emit("picks", invalid) else emit("playlist", invalid)
    end if
  else if m.groups.Count() > 0
    count = m.groups[m.row].items.Count()
    if intent = "left" and m.col > 0 then m.col = m.col - 1 : rebuildPage()
    if intent = "right" and m.col < count - 1 then m.col = m.col + 1 : rebuildPage()
    if intent = "up"
      if m.row > 0 then m.row = m.row - 1 : m.col = 0 : rebuildPage() else m.zone = "ribbon"
    end if
    if intent = "down"
      if m.row < m.groups.Count() - 1 then m.row = m.row + 1 : m.col = 0 : rebuildPage() else m.zone = "choose"
    end if
    if intent = "select" then emit("play", { item: m.groups[m.row].items[m.col] })
  end if
  paintFocus()
  return true
end function

sub onRemoteIntent()
  key = keyFromIntent(m.top.remoteIntent)
  if key <> "" then onKeyEvent(key, true)
end sub
