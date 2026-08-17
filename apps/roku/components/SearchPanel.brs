sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.queryLabel = m.top.findNode("queryLabel")
  m.keys = m.top.findNode("keys")
  m.rail = m.top.findNode("rail")
  m.close = m.top.findNode("close")
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.queryLabel.font = tvmFontBodyLg()
  m.close.variant = "glass"
  m.close.label = "Close"
  m.lede.text = "Search films and series, or paste a hoster link."
  m.query = ""
  m.seq = 0
  m.zone = "keys"
  m.row = 1
  m.col = 0
  m.resultCol = 0
  m.rows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"]
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"]
    ["Z", "X", "C", "V", "B", "N", "M"]
    ["Space", "Delete", "Clear", "Search"]
  ]
  m.keyNodes = []
  r = 0
  while r < m.rows.Count()
    rowNodes = []
    c = 0
    x = 0
    while c < m.rows[r].Count()
      btn = CreateObject("roSGNode", "FocusButton")
      label = m.rows[r][c]
      if r = 4
        btn.variant = "keywide"
        if label = "Search" then btn.variant = "primary"
        btn.translation = [x, r * 144]
        x = x + 420
      else
        btn.variant = "key"
        btn.translation = [c * 192, r * 144]
      end if
      btn.label = label
      m.keys.appendChild(btn)
      rowNodes.Push(btn)
      c = c + 1
    end while
    m.keyNodes.Push(rowNodes)
    r = r + 1
  end while
  paintQuery()
  paintFocus()
end sub

sub onMessage()
  m.lede.text = m.top.message
end sub

sub onResults()
  items = m.top.results
  if items = invalid then items = []
  m.rail.title = ""
  m.rail.items = items
  if m.zone = "results" then m.rail.focusCol = m.resultCol else m.rail.focusCol = -1
end sub

sub paintQuery()
  shown = m.query
  if shown = "" then shown = "Title or https://…"
  m.queryLabel.text = shown
  m.top.query = m.query
end sub

sub paintFocus()
  m.close.hasFocusStyle = (m.zone = "close")
  r = 0
  while r < m.keyNodes.Count()
    c = 0
    while c < m.keyNodes[r].Count()
      m.keyNodes[r][c].hasFocusStyle = (m.zone = "keys" and m.row = r and m.col = c)
      c = c + 1
    end while
    r = r + 1
  end while
  if m.zone = "results"
    m.rail.focusCol = m.resultCol
  else
    m.rail.focusCol = -1
  end if
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq, query: m.query }
  if extra <> invalid
    for each key in extra
      action[key] = extra[key]
    end for
  end if
  m.top.action = action
end sub

sub typeKey(label as String)
  if label = "Space"
    m.query = m.query + " "
  else if label = "Delete"
    if Len(m.query) > 0 then m.query = Left(m.query, Len(m.query) - 1)
  else if label = "Clear"
    m.query = ""
  else if label = "Search"
    emit("submit", invalid)
    return
  else
    m.query = m.query + LCase(label)
  end if
  paintQuery()
  emit("query", invalid)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back" then return false
  if m.zone = "close"
    if intent = "down" then m.zone = "keys"
    if intent = "select" then emit("close", invalid)
    paintFocus()
    return true
  end if
  if m.zone = "keys"
    row = m.rows[m.row]
    if intent = "left"
      if m.col > 0 then m.col = m.col - 1 else m.col = row.Count() - 1
    end if
    if intent = "right"
      if m.col < row.Count() - 1 then m.col = m.col + 1 else m.col = 0
    end if
    if intent = "up"
      if m.row > 0
        m.row = m.row - 1
        if m.col >= m.rows[m.row].Count() then m.col = m.rows[m.row].Count() - 1
      else
        m.zone = "close"
      end if
    end if
    if intent = "down"
      items = m.top.results
      count = 0
      if items <> invalid then count = items.Count()
      if m.row < m.rows.Count() - 1
        m.row = m.row + 1
        if m.col >= m.rows[m.row].Count() then m.col = m.rows[m.row].Count() - 1
      else if count > 0
        m.zone = "results"
        m.resultCol = 0
      end if
    end if
    if intent = "select" then typeKey(m.rows[m.row][m.col])
    paintFocus()
    return true
  end if
  if m.zone = "results"
    items = m.top.results
    count = 0
    if items <> invalid then count = items.Count()
    if intent = "up" then m.zone = "keys"
    if intent = "left" and count > 0
      if m.resultCol > 0 then m.resultCol = m.resultCol - 1 else m.resultCol = count - 1
    end if
    if intent = "right" and count > 0
      if m.resultCol < count - 1 then m.resultCol = m.resultCol + 1 else m.resultCol = 0
    end if
    if intent = "select" and count > 0
      emit("details", { item: items[m.resultCol] })
    end if
    paintFocus()
    return true
  end if
  return true
end function
