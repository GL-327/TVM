' Activity tab: a readable account event list (link, sign-in, unlink, revoke,
' control events). Eight pooled rows, windowed. Titles and media ids are
' never part of activity, so there is nothing to scope here.
sub init()
  m.top.focusable = false
  m.rowsGroup = m.top.findNode("rows")
  m.empty = m.top.findNode("empty")
  m.empty.font = tvmFontSecondary()
  m.visible = 8
  m.pitch = 188
  m.rowW = 3040
  m.rowH = 160
  m.events = []
  m.first = 0
  m.index = 0
  m.rowNodes = []
  buildRows()
  onEvents()
end sub

sub buildRows()
  textFont = tvmFont("bold", tvmTypeSize(tvmTypeSecondary()))
  ageFont = tvmFontMeta()
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
    text = CreateObject("roSGNode", "Label")
    text.font = textFont
    text.color = tvmText()
    text.translation = [56, 20]
    text.width = 2500
    text.height = 64
    age = CreateObject("roSGNode", "Label")
    age.font = ageFont
    age.color = tvmMuted()
    age.translation = [56, 90]
    age.width = 2500
    age.height = 56
    row.appendChild(tint)
    row.appendChild(ring)
    row.appendChild(text)
    row.appendChild(age)
    m.rowsGroup.appendChild(row)
    m.rowNodes.Push({ row: row, tint: tint, ring: ring, text: text, age: age })
    i = i + 1
  end while
end sub

function currentId() as String
  if m.index >= 0 and m.index < m.events.Count() then return asText(aaGet(m.events[m.index], "id", ""))
  return ""
end function

sub onEvents()
  if m.rowNodes = invalid then return
  heldId = currentId()
  events = m.top.events
  if events = invalid then events = []
  m.events = events
  if heldId <> ""
    i = 0
    while i < m.events.Count()
      if asText(aaGet(m.events[i], "id", "")) = heldId then m.index = i
      i = i + 1
    end while
  end if
  if m.index > m.events.Count() - 1 then m.index = m.events.Count() - 1
  if m.index < 0 then m.index = 0
  m.empty.visible = (m.events.Count() = 0)
  refreshRows()
  paintFocus()
end sub

sub refreshRows()
  count = m.events.Count()
  m.first = railViewFirst(count, m.index, m.first, m.visible)
  serverTime = m.top.serverTime
  r = 0
  while r < m.visible
    nodes = m.rowNodes[r]
    idx = m.first + r
    if idx < count
      e = m.events[idx]
      nodes.row.visible = true
      nodes.text.text = hubActivityText(e)
      age = hubAgeSeconds(asText(aaGet(e, "at", "")), serverTime)
      nodes.age.text = hubAgeText(age)
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
    focused = (has and (m.first + r) = m.index and (m.first + r) < m.events.Count())
    nodes.row.scaleRotateCenter = [m.rowW / 2, m.rowH / 2]
    nodes.row.scale = [1.0, 1.0]
    nodes.row.translation = [0, r * m.pitch]
    if focused and not tvmReduceMotion()
      nodes.row.scale = [tvmPillFocusScale(), tvmPillFocusScale()]
      nodes.row.translation = [0, (r * m.pitch) - tvmFocusLift()]
    end if
    nodes.tint.focused = focused
    nodes.ring.visible = false
    if focused
      nodes.tint.tintColor = tvmGlassTintFocused()
    else
      nodes.tint.tintColor = tvmGlassTint()
    end if
    r = r + 1
  end while
  m.top.focusKey = "activity:" + currentId()
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  id = key
  if Left(key, 9) = "activity:" then id = Mid(key, 10)
  i = 0
  while i < m.events.Count()
    if asText(aaGet(m.events[i], "id", "")) = id then m.index = i
    i = i + 1
  end while
  refreshRows()
  paintFocus()
end sub

function focusFirst(arg as Dynamic) as String
  m.index = 0
  refreshRows()
  paintFocus()
  return currentId()
end function

' { type: "focus"|"edge"|"back"|"none", edge }.
function handleIntent(intent as String) as Object
  if intent = "up"
    if m.index > 0
      m.index = m.index - 1
      refreshRows()
      paintFocus()
      return { type: "focus", edge: "" }
    end if
    return { type: "edge", edge: "tabs" }
  end if
  if intent = "down"
    if m.index < m.events.Count() - 1
      m.index = m.index + 1
      refreshRows()
      paintFocus()
    end if
    return { type: "focus", edge: "" }
  end if
  if intent = "back" then return { type: "back", edge: "" }
  return { type: "none", edge: "" }
end function
