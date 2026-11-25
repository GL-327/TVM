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
    btn.translation = [0, (i - first) * 200]
    btn.hasFocusStyle = (i = m.col)
    m.host.appendChild(btn)
    m.nodes.Push(btn)
  end for
  paintBody()
end sub

sub paintBody()
  rows = m.top.rows
  if rows = invalid or rows.Count() = 0 then return
  row = rows[m.col]
  text = asText(aaGet(row, "body", ""))
  ' Pre-wrap into TV-sized lines, then page instead of clipping release notes.
  lines = []
  for each paragraph in text.Split(Chr(10))
    line = ""
    for each word in paragraph.Split(" ")
      if Len(line) + Len(word) > 60
        lines.Push(line)
        line = ""
      end if
      if line <> "" then line = line + " "
      line = line + word
    end for
    lines.Push(line)
  end for
  uri = asText(aaGet(row, "image", ""))
  pageLines = 17
  if uri <> "" then pageLines = 12
  m.maxPage = Int((lines.Count() - 1) / pageLines)
  if m.page > m.maxPage then m.page = m.maxPage
  if m.page < 0 then m.page = 0
  chunk = []
  for i = m.page * pageLines to (m.page + 1) * pageLines - 1
    if i < lines.Count() then chunk.Push(lines[i])
  end for
  m.body.text = chunk.Join(Chr(10))
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
  if intent = "back" then return false
  if m.top.rows = invalid or m.top.rows.Count() = 0 then return true
  if intent = "up" and m.col > 0
    m.col = m.col - 1 : m.page = 0 : buildRows()
  end if
  if intent = "down" and m.col < m.top.rows.Count() - 1
    m.col = m.col + 1 : m.page = 0 : buildRows()
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
