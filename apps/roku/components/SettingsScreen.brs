sub init()
  m.top.focusable = true
  m.list = m.top.findNode("list")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.heading.font = tvmFontScreenTitle()
  m.heading.translation = [160, 120]
  m.kicker.visible = false
  appearance = CreateObject("roSGNode", "Label")
  appearance.text = "Appearance"
  appearance.font = tvmFontMeta()
  appearance.color = tvmMuted()
  appearance.translation = [0, -80]
  m.list.appendChild(appearance)
  services = CreateObject("roSGNode", "Label")
  services.text = "Device and services"
  services.font = tvmFontMeta()
  services.color = tvmMuted()
  services.translation = [0, 380]
  m.list.appendChild(services)
  m.rows = []
  m.col = 0
  m.seq = 0
  m.ids = ["theme", "background", "account", "url", "token", "profiles", "realdebrid", "network", "display", "motion", "transparency", "hubdemo", "livetv", "computer", "restart", "channel"]
  m.kinds = ["cycleTheme", "toggleBackground", "signOut", "editUrl", "editToken", "profiles", "realdebrid", "network", "display", "toggleMotion", "toggleTransparency", "toggleHubDemo", "livePlaylist", "computerSettings", "restart", "channelInfo"]
  labels = ["Theme", "Background", "Account", "Core API URL", "Device access token", "Profiles", "Real-Debrid", "Network", "Display", "Reduce Motion", "Reduce Transparency", "TVM Hub demo data", "Live TV playlist", "Manage on computer", "Reload Home", "This channel"]
  i = 0
  while i < labels.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "row"
    btn.label = labels[i]
    btn.itemId = m.ids[i]
    btn.translation = [0, i * 184]
    if i >= 2 then btn.translation = [0, (i * 184) + 100]
    m.list.appendChild(btn)
    m.rows.Push(btn)
    i = i + 1
  end while
  paintThemeRow()
  paintChannelRow()
  paintFlagRows()
  if m.global <> invalid
    if m.global.hasField("reduceMotion") then m.global.observeField("reduceMotion", "paintFlagRows")
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paintFlagRows")
    if m.global.hasField("background") then m.global.observeField("background", "paintFlagRows")
    if m.global.hasField("hubFixture") then m.global.observeField("hubFixture", "paintFlagRows")
  end if
  paintFocus()
end sub

' Accessibility rows mirror the registry flags kept on m.global.
sub paintFlagRows()
  background = "Trending"
  if loadBackground() = "lighthouse" then background = "Lighthouse"
  setRowDetail("background", background)
  if loadFlag("hubFixture")
    setRowDetail("hubdemo", "On. TVM Hub shows sample devices and sends nothing")
  else
    setRowDetail("hubdemo", "Off")
  end if
  if tvmReduceMotion()
    setRowDetail("motion", "On. No scale, tilt or slide animations")
  else
    setRowDetail("motion", "Off")
  end if
  if tvmReduceTransparency()
    setRowDetail("transparency", "On. Solid panels with a clear edge")
  else
    setRowDetail("transparency", "Off")
  end if
end sub

' A sideloaded channel is uploaded by hand, so it can sit years behind the
' TVM it talks to with nothing on screen to say so. CI writes tvm_commit into
' the manifest when it packages this.
sub paintChannelRow()
  info = CreateObject("roAppInfo")
  build = info.GetValue("tvm_commit")
  detail = "Version " + info.GetVersion()
  if build <> invalid and build <> "" then detail = detail + " · build " + build
  if info.IsDev() then detail = detail + " · sideloaded"
  setRowDetail("channel", detail)
end sub

function rowById(id as String) as Object
  if m.rows = invalid then return invalid
  i = 0
  while i < m.rows.Count()
    if m.rows[i].itemId = id then return m.rows[i]
    i = i + 1
  end while
  return invalid
end function

sub setRowDetail(id as String, text as String)
  row = rowById(id)
  if row <> invalid then row.detail = text
end sub

sub onCoreUrl()
  url = m.top.coreUrl
  if url = invalid or url = "" then url = "Standalone (no PC server needed)"
  setRowDetail("url", url)
end sub

sub onHealth()
  health = m.top.health
  connected = (health <> invalid and health.ok = true)
  standalone = (m.top.coreUrl = invalid or m.top.coreUrl = "")
  if connected
    if standalone
      setRowDetail("network", "Standalone (on this Roku)")
    else
      setRowDetail("network", "Connected")
    end if
  else
    setRowDetail("network", "Offline")
  end if
  setRowDetail("profiles", "TVM Stream only")
  setRowDetail("account", "Sign out of this TVM account")
  if standalone
    setRowDetail("realdebrid", "Saved on this Roku")
    setRowDetail("token", "Optional (only for a PC Core server)")
  else
    setRowDetail("realdebrid", "Saved securely by Core on your computer")
    setRowDetail("token", "Replace the saved device credential")
  end if
  setRowDetail("computer", "Billing, updates and data controls")
  setRowDetail("display", "4K canvas, scaled to this panel")
  setRowDetail("livetv", "M3U / M3U8")
  setRowDetail("updates", "GitHub Releases")
  setRowDetail("diagnostics", "Core and this channel")
  setRowDetail("cache", "Artwork and catalogs")
  setRowDetail("reset", "Including the Real-Debrid token")
  setRowDetail("restart", "Reload Home")
end sub

sub onThemeId()
  paintThemeRow()
end sub

sub paintThemeRow()
  id = m.top.themeId
  if id = invalid or id = "" then id = currentThemeId()
  setRowDetail("theme", tvmThemeLabel(id))
  if m.kicker <> invalid then m.kicker.color = tvmFaint()
  if m.heading <> invalid then m.heading.color = tvmText()
  if m.rows = invalid then return
  i = 0
  while i < m.rows.Count()
    m.rows[i].variant = "row"
    i = i + 1
  end while
  paintFocus()
end sub

sub paintFocus()
  i = 0
  while i < m.rows.Count()
    m.rows[i].hasFocusStyle = (i = m.col)
    i = i + 1
  end while
  if m.col > 5
    m.list.translation = [160, 80 - ((m.col - 5) * 184)]
  else
    m.list.translation = [160, 80]
  end if
  m.top.focusKey = "row:" + StrI(m.col).Trim()
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

sub emitTheme(delta as Integer)
  m.seq = m.seq + 1
  m.top.action = { type: "cycleTheme", delta: delta, seq: m.seq }
end sub

function onThemeRow() as Boolean
  if m.ids = invalid then return false
  if m.col < 0 or m.col >= m.ids.Count() then return false
  return m.ids[m.col] = "theme"
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "info"
    if m.ownerTaps = invalid then m.ownerTaps = 0
    m.ownerTaps = m.ownerTaps + 1
    if m.ownerTaps >= 7
      m.ownerTaps = 0
      emit("ownerDoor")
    end if
    return true
  end if
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
  if intent = "left" or intent = "right"
    if onThemeRow()
      delta = 1
      if intent = "left" then delta = -1
      emitTheme(delta)
    end if
    return true
  end if
  if intent = "select"
    if onThemeRow()
      emitTheme(1)
      return true
    end if
    emit(m.kinds[m.col])
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
