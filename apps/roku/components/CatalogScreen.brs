' Catalogue list for Movies, Series, Library views, Watchlist, Search results
' and episode lists. Uses the shared NavStrip; the title list is one windowed,
' non-looping rail. focusKey is id-based ("items:<itemId>", "nav:<col>").
sub init()
  m.top.focusable = true
  m.nav = m.top.findNode("nav")
  m.title = m.top.findNode("title")
  m.rail = m.top.findNode("rail")
  m.error = m.top.findNode("error")
  m.empty = m.top.findNode("empty")
  m.loading = m.top.findNode("loading")
  m.title.font = tvmFontScreenTitle()
  m.loading.font = tvmFontSecondary()
  m.nav.activeId = "library"
  m.zone = "rail"
  m.navCol = 4
  m.col = 0
  m.seq = 0
  m.pendingKey = ""
end sub

sub onNavId()
  if m.nav = invalid then return
  m.nav.activeId = m.top.navId
  m.navCol = tvmNavIndex(m.top.navId)
end sub

sub onProfileName()
  if m.nav <> invalid then m.nav.profileName = m.top.profileName
end sub

sub onHeading()
  if m.title = invalid then return
  m.title.text = m.top.heading
end sub

sub onItems()
  if m.rail = invalid then return
  kind = m.top.kind
  if kind = "watchlist" or kind = "children"
    m.rail.layout = "landscape"
  else
    m.rail.layout = "portrait"
  end if
  m.rail.title = ""
  m.rail.items = m.top.items
  m.col = 0
  if m.pendingKey <> ""
    key = m.pendingKey
    m.pendingKey = ""
    applyKey(key)
  end if
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

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  items = m.top.items
  if Left(key, 6) = "items:" and (items = invalid or items.Count() = 0)
    m.pendingKey = key
    return
  end if
  applyKey(key)
  paintFocus()
end sub

sub applyKey(key as String)
  parsed = parseFocusKey(key)
  if parsed.zone = "nav"
    m.zone = "nav"
    m.navCol = Int(Val(parsed.a))
  else if parsed.zone = "items"
    items = m.top.items
    if items = invalid then return
    i = 0
    while i < items.Count()
      if asText(aaGet(items[i], "id", "")) = parsed.a
        m.col = i
        m.zone = "rail"
      end if
      i = i + 1
    end while
  end if
end sub

sub paintFocus()
  mode = m.top.mode
  m.nav.hasBarFocus = (m.zone = "nav")
  m.nav.focusCol = m.navCol
  if m.zone = "nav"
    m.rail.focusCol = -1
    m.error.hasFocusStyle = false
    m.top.focusKey = "nav:" + StrI(m.navCol).Trim()
    return
  end if
  if mode = "ready"
    m.rail.focusCol = m.col
    m.error.hasFocusStyle = false
    items = m.top.items
    if items <> invalid and m.col < items.Count()
      m.top.focusKey = "items:" + asText(aaGet(items[m.col], "id", ""))
    end if
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
  if m.zone = "nav"
    count = tvmNavSpec().Count() + 1
    if intent = "left" or intent = "right" then m.navCol = navStep(m.navCol, intent, count)
    if intent = "down" then m.zone = "rail"
    if intent = "select"
      if m.navCol >= tvmNavSpec().Count()
        emit("you", invalid)
      else
        emit("nav", { id: tvmNavSpec()[m.navCol].id })
      end if
    end if
    paintFocus()
    return true
  end if
  if intent = "up"
    m.zone = "nav"
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
  if intent = "left" and m.col > 0
    m.col = m.col - 1
    paintFocus()
    return true
  end if
  if intent = "right" and m.col < count - 1
    m.col = m.col + 1
    paintFocus()
    return true
  end if
  if intent = "select" and count > 0
    emit("details", { item: items[m.col] })
    return true
  end if
  return true
end function

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
