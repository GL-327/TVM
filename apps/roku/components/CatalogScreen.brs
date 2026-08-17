sub init()
  m.top.focusable = true
  m.ribbon = m.top.findNode("ribbon")
  m.kicker = m.top.findNode("kicker")
  m.title = m.top.findNode("title")
  m.rail = m.top.findNode("rail")
  m.error = m.top.findNode("error")
  m.empty = m.top.findNode("empty")
  m.loading = m.top.findNode("loading")
  m.title.font = tvmFontTitle()
  m.loading.font = tvmFontBody()
  m.ribbon.activeId = "watchlist"
  m.ribbon.focusCol = 5
  m.ribbon.hasBarFocus = false
  m.zone = "rail"
  m.col = 0
  m.seq = 0
end sub

sub onHeading()
  if m.title = invalid then return
  m.title.text = m.top.heading
end sub

sub onItems()
  if m.rail = invalid then return
  kind = m.top.kind
  if kind = "watchlist"
    m.rail.layout = "landscape"
    m.ribbon.activeId = "watchlist"
  else
    m.rail.layout = "portrait"
    m.ribbon.activeId = "library"
  end if
  m.rail.title = ""
  m.rail.items = m.top.items
  m.col = 0
  paintFocus()
end sub

sub onMode()
  if m.rail = invalid then return
  mode = m.top.mode
  m.rail.visible = (mode = "ready")
  m.error.visible = (mode = "error")
  m.empty.visible = (mode = "empty")
  m.loading.visible = (mode = "loading")
  if mode = "error"
    m.error.title = m.top.errorTitle
    m.error.body = m.top.errorBody
  end if
  if mode = "empty"
    m.empty.title = m.top.emptyTitle
    m.empty.body = m.top.emptyBody
  end if
  paintFocus()
end sub

sub paintFocus()
  mode = m.top.mode
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  if m.zone = "ribbon"
    m.rail.focusCol = -1
    m.error.hasFocusStyle = false
    return
  end if
  if mode = "ready"
    m.rail.focusCol = m.col
    m.error.hasFocusStyle = false
  else if mode = "error"
    m.rail.focusCol = -1
    m.error.hasFocusStyle = true
  else
    m.rail.focusCol = -1
    m.error.hasFocusStyle = false
  end if
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
  if m.zone = "ribbon"
    if intent = "left" and m.ribbon.focusCol > 0 then m.ribbon.focusCol = m.ribbon.focusCol - 1
    if intent = "right" and m.ribbon.focusCol < tvmRibbonLast() then m.ribbon.focusCol = m.ribbon.focusCol + 1
    if intent = "down" then m.zone = "rail"
    if intent = "select" then emit(tvmRibbonSpec()[m.ribbon.focusCol].action, invalid)
    paintFocus()
    return true
  end if
  if intent = "up"
    m.zone = "ribbon"
    paintFocus()
    return true
  end if
  if m.top.mode = "error" and intent = "select"
    emit("retry", invalid)
    return true
  end if
  if m.top.mode <> "ready" then return true
  items = m.top.items
  count = 0
  if items <> invalid then count = items.Count()
  if intent = "left" and count > 0
    if m.col > 0 then m.col = m.col - 1 else m.col = count - 1
    paintFocus()
    return true
  end if
  if intent = "right" and count > 0
    if m.col < count - 1 then m.col = m.col + 1 else m.col = 0
    paintFocus()
    return true
  end if
  if intent = "select" and count > 0
    emit("details", { item: items[m.col] })
    return true
  end if
  return true
end function
