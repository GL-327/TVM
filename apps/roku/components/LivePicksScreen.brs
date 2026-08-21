sub init()
  m.top.focusable = true
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.chips = m.top.findNode("chips")
  m.list = m.top.findNode("list")
  m.loading = m.top.findNode("loading")
  m.search = m.top.findNode("search")
  m.addGroup = m.top.findNode("addGroup")
  m.done = m.top.findNode("done")
  m.prevPage = m.top.findNode("prevPage")
  m.nextPage = m.top.findNode("nextPage")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.loading.font = tvmFontBody()
  m.search.variant = "glass"
  m.search.label = "Search"
  m.addGroup.variant = "glass"
  m.addGroup.label = "Add group"
  m.done.variant = "primary"
  m.done.label = "Done"
  m.prevPage.variant = "glass"
  m.prevPage.label = "Previous"
  m.nextPage.variant = "glass"
  m.nextPage.label = "Next"
  m.groups = []
  m.groupNodes = []
  m.items = []
  m.tiles = []
  m.groupIndex = 0
  m.row = 0
  m.zone = "list"
  m.action = 0
  m.seq = 0
  m.hasPrev = false
  m.hasNext = false
end sub

sub onMode()
  m.loading.visible = (m.top.mode = "loading")
  m.list.visible = (m.top.mode <> "loading")
  paintFocus()
end sub

sub clearGroup(node as Object)
  while node.getChildCount() > 0
    node.removeChildIndex(0)
  end while
end sub

sub onPage()
  page = m.top.page
  picked = asText(aaGet(page, "picked", "0"))
  limit = asText(aaGet(page, "pickLimit", "48"))
  total = asText(aaGet(page, "total", "0"))
  matched = aaGet(page, "matched", 0)
  offset = aaGet(page, "offset", 0)
  limitN = aaGet(page, "limit", 8)
  m.lede.text = picked + " of " + limit + " on Live TV · " + total + " in the playlist."
  m.groups = [{ name: "All", count: aaGet(page, "total", 0), picked: aaGet(page, "picked", 0) }]
  rawGroups = aaArray(page, "groups")
  g = 0
  while g < rawGroups.Count() and g < 5
    m.groups.Push(rawGroups[g])
    g = g + 1
  end while
  clearGroup(m.chips)
  m.groupNodes = []
  i = 0
  while i < m.groups.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "pill"
    name = aaGet(m.groups[i], "name", "Live")
    btn.label = name
    btn.translation = [i * 540, 0]
    m.chips.appendChild(btn)
    m.groupNodes.Push(btn)
    i = i + 1
  end while
  if m.groupIndex >= m.groups.Count() then m.groupIndex = 0
  m.items = aaArray(page, "items")
  clearGroup(m.list)
  m.tiles = []
  i = 0
  while i < m.items.Count() and i < 8
    tile = CreateObject("roSGNode", "ChannelTile")
    tile.picking = true
    tile.item = m.items[i]
    tile.translation = [0, i * 168]
    m.list.appendChild(tile)
    m.tiles.Push(tile)
    i = i + 1
  end while
  if m.row >= m.tiles.Count() then m.row = 0
  off = 0
  if Type(offset) = "Integer" or Type(offset) = "roInt" or Type(offset) = "roInteger" then off = offset
  lim = 8
  if Type(limitN) = "Integer" or Type(limitN) = "roInt" or Type(limitN) = "roInteger" then lim = limitN
  matchCount = 0
  if Type(matched) = "Integer" or Type(matched) = "roInt" or Type(matched) = "roInteger" then matchCount = matched
  m.hasPrev = off > 0
  m.hasNext = (off + lim) < matchCount
  m.prevPage.visible = m.hasPrev
  m.nextPage.visible = m.hasNext
  if m.tiles.Count() = 0 then m.zone = "search"
  paintFocus()
end sub

sub paintFocus()
  i = 0
  while i < m.groupNodes.Count()
    m.groupNodes[i].hasFocusStyle = (m.zone = "chips" and i = m.groupIndex)
    i = i + 1
  end while
  i = 0
  while i < m.tiles.Count()
    m.tiles[i].hasFocusStyle = (m.zone = "list" and i = m.row)
    i = i + 1
  end while
  m.search.hasFocusStyle = (m.zone = "search")
  m.addGroup.hasFocusStyle = (m.zone = "add")
  m.done.hasFocusStyle = (m.zone = "done")
  m.prevPage.hasFocusStyle = (m.zone = "prev")
  m.nextPage.hasFocusStyle = (m.zone = "next")
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

function currentGroupName() as String
  if m.groupIndex < 0 or m.groupIndex >= m.groups.Count() then return ""
  name = aaGet(m.groups[m.groupIndex], "name", "")
  if name = "All" then return ""
  return name
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back"
    emit("done", invalid)
    return true
  end if
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if m.zone = "chips"
    if intent = "left" and m.groupIndex > 0 then m.groupIndex = m.groupIndex - 1
    if intent = "right" and m.groupIndex < m.groups.Count() - 1 then m.groupIndex = m.groupIndex + 1
    if intent = "down"
      if m.tiles.Count() > 0 then m.zone = "list" else m.zone = "search"
    end if
    if intent = "select" then emit("group", { group: currentGroupName() })
    paintFocus()
    return true
  end if
  if m.zone = "list"
    if intent = "up"
      if m.row > 0 then m.row = m.row - 1 else m.zone = "chips"
    end if
    if intent = "down"
      if m.row < m.tiles.Count() - 1 then m.row = m.row + 1 else m.zone = "search"
    end if
    if intent = "select" and m.row < m.items.Count()
      item = m.items[m.row]
      picked = aaGet(item, "picked", false)
      nextPicked = true
      if picked = true then nextPicked = false
      emit("toggle", { id: aaGet(item, "id", ""), picked: nextPicked })
    end if
    paintFocus()
    return true
  end if
  if intent = "up"
    if m.tiles.Count() > 0 then m.zone = "list" else m.zone = "chips"
  end if
  if intent = "left"
    if m.zone = "next"
      m.zone = "prev"
    else if m.zone = "prev"
      m.zone = "done"
    else if m.zone = "done"
      m.zone = "add"
    else if m.zone = "add"
      m.zone = "search"
    end if
  end if
  if intent = "right"
    if m.zone = "search"
      m.zone = "add"
    else if m.zone = "add"
      m.zone = "done"
    else if m.zone = "done" and m.hasPrev
      m.zone = "prev"
    else if m.zone = "done" and m.hasNext
      m.zone = "next"
    else if m.zone = "prev" and m.hasNext
      m.zone = "next"
    end if
  end if
  if intent = "select"
    if m.zone = "search" then emit("search", invalid)
    if m.zone = "add" then emit("addGroup", { group: currentGroupName() })
    if m.zone = "done" then emit("done", invalid)
    if m.zone = "prev" then emit("page", { delta: -1 })
    if m.zone = "next" then emit("page", { delta: 1 })
  end if
  paintFocus()
  return true
end function
