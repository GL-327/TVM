' Devices tab: a windowed list (7 pooled rows, recycled on scroll) with a sort
' button (Name, Last seen, Room) and the Graph/List switch. Focus is held by
' device id; a poll re-sorts and finds the focused id again, so rows never
' jump. When focus moves into the inspector, the selected row keeps a dim
' ring and a stronger tint.
sub init()
  m.top.focusable = false
  m.ctlSort = m.top.findNode("ctlSort")
  m.ctlGraph = m.top.findNode("ctlGraph")
  m.ctlList = m.top.findNode("ctlList")
  m.rowsGroup = m.top.findNode("rows")
  m.empty = m.top.findNode("empty")
  m.empty.font = tvmFontSecondary()
  m.visible = 7
  m.pitch = 176
  m.rowW = 2320
  m.rowH = 152
  m.sorted = []
  m.first = 0
  m.zone = "list"
  m.index = 0
  m.ctl = 0
  m.rowNodes = []
  m.ctlGraph.disabled = false
  buildRows()
  onDevices()
end sub

sub buildRows()
  nameFont = tvmFont("semibold", tvmTypeSize(tvmTypeSecondary()))
  subFont = tvmFontMeta()
  i = 0
  while i < m.visible
    row = CreateObject("roSGNode", "Group")
    row.translation = [0, i * m.pitch]
    tint = CreateObject("roSGNode", "GlassPanel")
    tint.width = m.rowW
    tint.height = m.rowH
    tint.shape = "pill"
    ring = CreateObject("roSGNode", "Poster")
    ring.uri = "pkg:/images/glass/focus-ring.9.png"
    ring.translation = [-16, -16]
    ring.width = m.rowW + 32
    ring.height = m.rowH + 32
    ring.visible = false
    glyph = CreateObject("roSGNode", "Poster")
    glyph.loadDisplayMode = "scaleToFit"
    glyph.translation = [48, 38]
    glyph.width = 76
    glyph.height = 76
    name = CreateObject("roSGNode", "Label")
    name.font = nameFont
    name.color = tvmText()
    name.translation = [172, 18]
    name.width = 1800
    name.height = 64
    subLine = CreateObject("roSGNode", "Label")
    subLine.font = subFont
    subLine.color = tvmMuted()
    subLine.translation = [172, 82]
    subLine.width = 1800
    subLine.height = 56
    chevron = CreateObject("roSGNode", "Poster")
    chevron.uri = "pkg:/images/hub/chevron.png"
    chevron.loadDisplayMode = "scaleToFit"
    chevron.translation = [m.rowW - 100, 52]
    chevron.width = 48
    chevron.height = 48
    chevron.blendColor = tvmMuted()
    row.appendChild(tint)
    row.appendChild(ring)
    row.appendChild(glyph)
    row.appendChild(name)
    row.appendChild(subLine)
    row.appendChild(chevron)
    m.rowsGroup.appendChild(row)
    m.rowNodes.Push({ row: row, tint: tint, ring: ring, glyph: glyph, name: name, detail: subLine })
    i = i + 1
  end while
end sub

function currentId() as String
  if m.zone = "ctl"
    if m.ctl = 0 then return "ctl:sort"
    if m.ctl = 1 then return "ctl:graph"
    return "ctl:list"
  end if
  if m.index >= 0 and m.index < m.sorted.Count() then return asText(aaGet(m.sorted[m.index], "id", ""))
  return ""
end function

sub onDevices()
  if m.rowNodes = invalid then return
  heldId = ""
  if m.zone = "list" then heldId = currentId()
  devices = m.top.devices
  if devices = invalid then devices = []
  key = m.top.sortKey
  if key = "" then key = "name"
  m.sorted = hubSortDevices(devices, key)
  m.ctlSort.label = "Sort: " + hubSortKeyLabel(key)
  m.ctlSort.pillWidth = 640
  m.ctlList.active = true
  if heldId <> ""
    found = -1
    i = 0
    while i < m.sorted.Count()
      if asText(aaGet(m.sorted[i], "id", "")) = heldId then found = i
      i = i + 1
    end while
    if found >= 0
      m.index = found
    else if m.index > m.sorted.Count() - 1
      m.index = m.sorted.Count() - 1
    end if
  end if
  if m.index < 0 then m.index = 0
  m.empty.visible = (m.sorted.Count() = 0)
  refreshRows()
  paintFocus()
end sub

sub refreshRows()
  count = m.sorted.Count()
  focusIdx = -1
  if m.zone = "list" then focusIdx = m.index
  m.first = railViewFirst(count, focusIdx, m.first, m.visible)
  serverTime = m.top.serverTime
  r = 0
  while r < m.visible
    nodes = m.rowNodes[r]
    idx = m.first + r
    if idx < count
      d = m.sorted[idx]
      nodes.row.visible = true
      nodes.name.text = asText(aaGet(d, "name", "Device"))
      nodes.glyph.uri = "pkg:/images/hub/" + hubPlatformGlyph(asText(aaGet(d, "platform", ""))) + ".png"
      nodes.glyph.blendColor = tvmText()
      state = asText(aaGet(d, "state", "unknown"))
      line = hubStateLabel(state)
      room = asText(aaGet(d, "room", ""))
      if room <> "" then line = line + " · " + room
      if not hubIsOnline(d)
        seen = hubLastSeenText(d, serverTime)
        if seen <> "" then line = line + " · " + seen
      end if
      nodes.detail.text = line
      nodes.detail.color = hubStateColor(state)
    else
      nodes.row.visible = false
    end if
    r = r + 1
  end while
end sub

sub paintFocus()
  if m.rowNodes = invalid then return
  has = (m.top.hasFocus = true)
  r = 0
  while r < m.visible
    nodes = m.rowNodes[r]
    idx = m.first + r
    focused = false
    selected = false
    if idx < m.sorted.Count()
      id = asText(aaGet(m.sorted[idx], "id", ""))
      focused = (has and m.zone = "list" and idx = m.index)
      selected = (not focused and id = m.top.selectedId and id <> "")
    end if
    nodes.row.scaleRotateCenter = [m.rowW / 2, m.rowH / 2]
    nodes.row.scale = [1.0, 1.0]
    nodes.row.translation = [0, r * m.pitch]
    if focused and not tvmReduceMotion()
      nodes.row.scale = [tvmPillFocusScale(), tvmPillFocusScale()]
      nodes.row.translation = [0, (r * m.pitch) - tvmFocusLift()]
    end if
    nodes.tint.focused = focused
    nodes.tint.selected = selected
    nodes.ring.visible = false
    if selected then nodes.ring.opacity = 0.45 else nodes.ring.opacity = 1.0
    if focused or selected
      nodes.tint.tintColor = tvmGlassTintFocused()
    else
      nodes.tint.tintColor = tvmGlassTint()
    end if
    r = r + 1
  end while
  m.ctlSort.hasFocusStyle = (has and m.zone = "ctl" and m.ctl = 0)
  m.ctlGraph.hasFocusStyle = (has and m.zone = "ctl" and m.ctl = 1)
  m.ctlList.hasFocusStyle = (has and m.zone = "ctl" and m.ctl = 2)
  id = currentId()
  m.top.focusId = id
  m.top.focusKey = "devices:" + id
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  id = key
  if Left(key, 8) = "devices:" then id = Mid(key, 9)
  if id = "ctl:sort" or id = "ctl:graph" or id = "ctl:list"
    m.zone = "ctl"
    if id = "ctl:sort" then m.ctl = 0
    if id = "ctl:graph" then m.ctl = 1
    if id = "ctl:list" then m.ctl = 2
  else
    i = 0
    while i < m.sorted.Count()
      if asText(aaGet(m.sorted[i], "id", "")) = id
        m.zone = "list"
        m.index = i
      end if
      i = i + 1
    end while
  end if
  refreshRows()
  paintFocus()
end sub

function focusFirst(arg as Dynamic) as String
  if m.sorted.Count() > 0
    m.zone = "list"
    m.index = 0
  else
    m.zone = "ctl"
    m.ctl = 0
  end if
  refreshRows()
  paintFocus()
  return currentId()
end function

' { type: "focus"|"edge"|"sort"|"graph"|"select"|"back"|"none", id, edge, key }.
function handleIntent(intent as String) as Object
  count = m.sorted.Count()
  if m.zone = "ctl"
    if intent = "left" and m.ctl > 0
      m.ctl = m.ctl - 1
      paintFocus()
      return { type: "focus", id: currentId(), edge: "", key: "" }
    end if
    if intent = "right"
      if m.ctl < 2
        m.ctl = m.ctl + 1
        paintFocus()
        return { type: "focus", id: currentId(), edge: "", key: "" }
      end if
      return { type: "edge", id: "", edge: "inspector", key: "" }
    end if
    if intent = "up" then return { type: "edge", id: "", edge: "tabs", key: "" }
    if intent = "down"
      if count > 0
        m.zone = "list"
        refreshRows()
        paintFocus()
        return { type: "focus", id: currentId(), edge: "", key: "" }
      end if
      return { type: "edge", id: "", edge: "add", key: "" }
    end if
    if intent = "select"
      if m.ctl = 0 then return { type: "sort", id: "", edge: "", key: hubNextSortKey(m.top.sortKey) }
      if m.ctl = 1 then return { type: "graph", id: "", edge: "", key: "" }
      return { type: "none", id: "", edge: "", key: "" }
    end if
    if intent = "back" then return { type: "back", id: "", edge: "", key: "" }
    return { type: "none", id: "", edge: "", key: "" }
  end if

  if intent = "up"
    if m.index > 0
      m.index = m.index - 1
      refreshRows()
      paintFocus()
      return { type: "focus", id: currentId(), edge: "", key: "" }
    end if
    m.zone = "ctl"
    paintFocus()
    return { type: "focus", id: currentId(), edge: "", key: "" }
  end if
  if intent = "down"
    if m.index < count - 1
      m.index = m.index + 1
      refreshRows()
      paintFocus()
      return { type: "focus", id: currentId(), edge: "", key: "" }
    end if
    return { type: "edge", id: "", edge: "add", key: "" }
  end if
  if intent = "right" then return { type: "edge", id: "", edge: "inspector", key: "" }
  if intent = "select" then return { type: "select", id: currentId(), edge: "", key: "" }
  if intent = "back" then return { type: "back", id: "", edge: "", key: "" }
  return { type: "none", id: "", edge: "", key: "" }
end function
