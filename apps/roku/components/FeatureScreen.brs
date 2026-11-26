' Shared TV menu. Large text pages remain reachable without stealing row focus.
sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.heading.font = tvmFontScreenTitle()
  m.host = m.top.findNode("rows")
  m.body = m.top.findNode("body")
  m.body.font = tvmFont("regular", 56)
  m.top.findNode("hint").font = tvmFont("regular", 44)
  m.preview = m.top.findNode("preview")
  m.nodes = [] : m.col = 0 : m.page = 0 : m.seq = 0
end sub

sub paintHeading()
  m.heading.text = m.top.heading
end sub

sub buildRows()
  if m.host = invalid then return
  m.host.removeChildren(m.host.getChildren(-1, 0))
  m.nodes = []
  rows = m.top.rows
  if rows = invalid then return
  if m.col >= rows.Count() then m.col = 0
  first = m.col - 3
  if first < 0 then first = 0
  last = first + 6
  if last >= rows.Count() then last = rows.Count() - 1
  for i = first to last
    row = rows[i]
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "glassPill"
    btn.pillWidth = 1120
    btn.label = asText(aaGet(row, "label", ""))
    if aaGet(row, "control", "") = "switch" then btn.label = ""
    if aaGet(row, "control", "") = "segments" then btn.label = ""
    btn.translation = [0, (i - first) * 200]
    btn.hasFocusStyle = (i = m.col)
    m.host.appendChild(btn)
    m.nodes.Push(btn)
    paintRowControl(row, (i - first) * 200)
  end for
  paintBody()
end sub

sub controlLabel(value as String, x as Integer, y as Integer, width as Integer, color as String)
  label = CreateObject("roSGNode", "Label")
  label.text = value : label.font = tvmFont("medium", 42) : label.color = color
  label.translation = [x, y] : label.width = width : label.height = 72
  label.vertAlign = "center" : label.horizAlign = "center"
  m.host.appendChild(label)
end sub

sub paintRowControl(row as Object, y as Integer)
  control = asText(aaGet(row, "control", ""))
  if control = "switch"
    controlLabel(row.label, 30, y + 36, 750, tvmText())
    track = CreateObject("roSGNode", "GlassPanel")
    track.shape = "pill" : track.width = 138 : track.height = 76 : track.translation = [902, y + 34]
    track.tintColor = tvmSurfaceHover()
    offset = 911
    if row.value then track.tintColor = tvmAccentBlue() : offset = 977
    m.host.appendChild(track)
    knob = CreateObject("roSGNode", "Poster")
    knob.uri = "pkg:/images/glass/dot.png" : knob.width = 58 : knob.height = 58 : knob.translation = [offset, y + 43]
    m.host.appendChild(knob)
  else if control = "segments"
    controlLabel(row.label, 20, y - 8, 1080, tvmMuted())
    for j = 0 to row.values.Count() - 1
      ink = tvmMuted()
      if row.value = row.values[j]
        selected = CreateObject("roSGNode", "GlassPanel")
        selected.width = 256 : selected.height = 76 : selected.translation = [20 + j * 270, y + 60]
        selected.tintColor = "0xF5F7FAFF"
        m.host.appendChild(selected) : ink = "0x12141AFF"
      end if
      controlLabel(row.labels[j], 20 + j * 270, y + 62, 256, ink)
    end for
  end if
end sub

sub paintBody()
  rows = m.top.rows
  if rows = invalid or rows.Count() = 0 then return
  row = rows[m.col]
  text = asText(aaGet(row, "body", ""))
  uri = asText(aaGet(row, "image", ""))
  pageLines = 17
  if uri <> "" then pageLines = 12
  pages = tvmTextPages(text, 36, pageLines)
  m.maxPage = pages.Count() - 1
  if m.page > m.maxPage then m.page = m.maxPage
  if m.page < 0 then m.page = 0
  m.body.text = pages[m.page]
  m.top.findNode("hint").text = "Left / Right: page " + (m.page + 1).ToStr() + " of " + pages.Count().ToStr() + "    Back: return"
  m.preview.uri = uri
  m.preview.visible = uri <> ""
  m.body.translation = [1500, 500]
  if uri <> "" then m.body.translation = [1500, 800]
  m.top.focusKey = "row:" + asText(aaGet(row, "id", ""))
end sub

sub restore()
  rows = m.top.rows
  if rows = invalid then return
  for i = 0 to rows.Count() - 1
    if m.top.restoreKey = "row:" + asText(aaGet(rows[i], "id", "")) then m.col = i
  end for
  buildRows()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "back" or intent = "play" or intent = "pause" then return false
  if m.top.rows = invalid or m.top.rows.Count() = 0 then return true
  if intent = "up" and m.col > 0
    m.col = m.col - 1 : m.page = 0 : buildRows()
  end if
  if intent = "down" and m.col < m.top.rows.Count() - 1
    m.col = m.col + 1 : m.page = 0 : buildRows()
  end if
  row = m.top.rows[m.col]
  if aaGet(row, "control", "") = "segments" and (intent = "left" or intent = "right")
    delta = 1
    if intent = "left" then delta = -1
    m.seq = m.seq + 1
    m.top.action = { type: "change", row: row, delta: delta, seq: m.seq }
    return true
  end if
  if intent = "right" and m.page < m.maxPage then m.page = m.page + 1 : paintBody()
  if intent = "left" and m.page > 0 then m.page = m.page - 1 : paintBody()
  if intent = "select" or intent = "info"
    m.seq = m.seq + 1
    kind = "select"
    if intent = "info" then kind = "options"
    m.top.action = { type: kind, row: m.top.rows[m.col], seq: m.seq }
  end if
  return true
end function

sub onRemoteIntent()
  key = keyFromIntent(m.top.remoteIntent)
  if key <> "" then onKeyEvent(key, true)
end sub
