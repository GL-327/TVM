sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.queryLabel = m.top.findNode("queryLabel")
  m.pill = m.top.findNode("pill")
  m.pillRing = m.top.findNode("pillRing")
  m.keys = m.top.findNode("keys")
  m.rail = m.top.findNode("rail")
  m.close = m.top.findNode("close")
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.queryLabel.font = tvmFontTitle()
  m.close.variant = "pill"
  m.close.label = "Close"
  m.close.focusable = false
  m.lede.text = "Type in the pill, or use the keys below."
  m.query = ""
  m.seq = 0
  m.zone = "pill"
  m.row = 1
  m.col = 0
  m.resultCol = 0
  m.rows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"]
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"]
    ["Z", "X", "C", "V", "B", "N", "M"]
    ["Keyboard", "Space", "Delete", "Clear", "Search"]
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
        x = x + 400
      else
        btn.variant = "key"
        btn.translation = [c * 192, r * 144]
      end if
      btn.label = label
      btn.focusable = false
      m.keys.appendChild(btn)
      rowNodes.Push(btn)
      c = c + 1
    end while
    m.keyNodes.Push(rowNodes)
    r = r + 1
  end while
  paintQuery()
  paintFocus()
  holdFocus()
end sub

sub onMessage()
  m.lede.text = m.top.message
end sub

sub onExternalQuery()
  incoming = m.top.query
  if incoming = invalid then incoming = ""
  if incoming = m.query then return
  m.query = incoming
  paintQuery()
end sub

sub onResults()
  items = m.top.results
  if items = invalid then items = []
  m.rail.title = ""
  m.rail.items = items
  if m.zone = "results" then m.rail.focusCol = m.resultCol else m.rail.focusCol = -1
  holdFocus()
end sub

sub paintQuery()
  if m.query = ""
    m.queryLabel.text = "Title or https://…"
    m.queryLabel.color = tvmFaint()
  else
    m.queryLabel.text = m.query
    m.queryLabel.color = tvmText()
  end if
  if m.top.query <> m.query then m.top.query = m.query
end sub

sub paintFocus()
  pillOn = (m.zone = "pill")
  if pillOn
    m.pillRing.color = tvmFocus()
    m.pill.color = "0x3A3A3AFF"
  else
    m.pillRing.color = "0x00000000"
    m.pill.color = tvmSurfaceHover()
  end if
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

sub holdFocus()
  if not m.top.hasFocus() then m.top.setFocus(true)
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

sub typeChar(ch as String)
  if ch = "" then return
  m.query = m.query + ch
  paintQuery()
  emit("query", invalid)
end sub

sub typeKey(label as String)
  if label = "Space"
    m.query = m.query + " "
  else if label = "Delete"
    if Len(m.query) > 0 then m.query = Left(m.query, Len(m.query) - 1)
  else if label = "Clear"
    m.query = ""
  else if label = "Keyboard"
    emit("keyboard", invalid)
    return
  else if label = "Search"
    emit("submit", invalid)
    return
  else
    m.query = m.query + LCase(label)
  end if
  paintQuery()
  emit("query", invalid)
end sub

function resultCount() as Integer
  items = m.top.results
  if items = invalid then return 0
  return items.Count()
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  ch = typedCharFromKey(key)
  if intent = "" and ch <> ""
    typeChar(ch)
    holdFocus()
    return true
  end if
  lower = LCase(key)
  if intent = "" and (lower = "backspace" or lower = "delete")
    typeKey("Delete")
    holdFocus()
    return true
  end if
  if intent = "" then return true
  if intent = "back" then return false

  if m.zone = "pill"
    if intent = "right" then m.zone = "close"
    if intent = "down" then m.zone = "keys"
    if intent = "left" then m.zone = "close"
    if intent = "select" then emit("keyboard", invalid)
    paintFocus()
    holdFocus()
    return true
  end if

  if m.zone = "close"
    if intent = "left" then m.zone = "pill"
    if intent = "right" then m.zone = "pill"
    if intent = "down" then m.zone = "keys"
    if intent = "select" then emit("close", invalid)
    paintFocus()
    holdFocus()
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
      else if m.col >= 7
        m.zone = "close"
      else
        m.zone = "pill"
      end if
    end if
    if intent = "down"
      if m.row < m.rows.Count() - 1
        m.row = m.row + 1
        if m.col >= m.rows[m.row].Count() then m.col = m.rows[m.row].Count() - 1
      else if resultCount() > 0
        m.zone = "results"
        m.resultCol = 0
      end if
    end if
    if intent = "select" then typeKey(m.rows[m.row][m.col])
    paintFocus()
    holdFocus()
    return true
  end if

  if m.zone = "results"
    items = m.top.results
    count = resultCount()
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
    holdFocus()
    return true
  end if
  return true
end function
