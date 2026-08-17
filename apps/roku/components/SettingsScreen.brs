sub init()
  m.top.focusable = true
  m.list = m.top.findNode("list")
  m.rows = []
  m.col = 0
  m.seq = 0
  m.ids = ["url", "profiles", "realdebrid", "network", "display", "livetv", "updates", "linux", "diagnostics", "cache", "reset", "restart"]
  m.kinds = ["editUrl", "profiles", "realdebrid", "network", "display", "livePlaylist", "updates", "linux", "diagnostics", "cache", "reset", "restart"]
  labels = ["Core API URL", "Profiles", "Real-Debrid", "Network", "Display", "Live TV playlist", "Updates", "Linux desktop", "Diagnostics", "Clear cache", "Fully reset", "Restart"]
  i = 0
  while i < labels.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "row"
    btn.label = labels[i]
    btn.itemId = m.ids[i]
    btn.translation = [0, i * 184]
    m.list.appendChild(btn)
    m.rows.Push(btn)
    i = i + 1
  end while
  paintFocus()
end sub

sub onCoreUrl()
  if m.rows = invalid or m.rows.Count() = 0 then return
  url = m.top.coreUrl
  if url = invalid or url = "" then url = "Not set"
  m.rows[0].detail = url
end sub

sub onHealth()
  if m.rows = invalid or m.rows.Count() < 12 then return
  health = m.top.health
  connected = (health <> invalid and health.ok = true)
  if connected
    m.rows[3].detail = "Connected"
  else
    m.rows[3].detail = "Offline"
  end if
  m.rows[1].detail = "TVM Stream only"
  m.rows[2].detail = "Saved on this machine"
  m.rows[4].detail = "4K canvas, scaled to this panel"
  m.rows[5].detail = "M3U / M3U8"
  m.rows[6].detail = "GitHub Releases"
  m.rows[7].detail = "TVM stick only"
  m.rows[8].detail = "Core and this channel"
  m.rows[9].detail = "Artwork and catalogs"
  m.rows[10].detail = "Including the Real-Debrid token"
  m.rows[11].detail = "Reload Home"
end sub

sub paintFocus()
  i = 0
  while i < m.rows.Count()
    m.rows[i].hasFocusStyle = (i = m.col)
    i = i + 1
  end while
  if m.col > 5
    m.list.translation = [160, 440 - ((m.col - 5) * 184)]
  else
    m.list.translation = [160, 440]
  end if
  m.top.focusKey = "row:" + StrI(m.col).Trim()
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home")
    return true
  end if
  if intent = "up" and m.col > 0
    m.col = m.col - 1
    paintFocus()
    return true
  end if
  if intent = "down" and m.col < m.rows.Count() - 1
    m.col = m.col + 1
    paintFocus()
    return true
  end if
  if intent = "left" or intent = "right" then return true
  if intent = "select"
    emit(m.kinds[m.col])
    return true
  end if
  return true
end function
