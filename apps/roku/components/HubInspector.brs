' Right-hand inspector for the selected device (or the account orb, or the
' More node). Name, room, platform, app/build, last seen with its age against
' serverTime, a state chip, "This device" and a physical-input marker, the
' now-playing card only when the viewer may see it, and the actions filtered
' by capability and isCurrent. Each action row shows its own feedback:
' enabled, pending, confirmed, timed out or rejected. The host routes keys
' through handleIntent(); this node never owns focus.
sub init()
  m.glyph = m.top.findNode("glyph")
  m.title = m.top.findNode("title")
  m.subtitle = m.top.findNode("subtitle")
  m.chips = m.top.findNode("chips")
  m.info = m.top.findNode("info")
  m.nowPlaying = m.top.findNode("nowPlaying")
  m.npArt = m.top.findNode("npArt")
  m.npMask = m.top.findNode("npMask")
  m.npMask.maskSize = [968 * tvmUiScale(), 544 * tvmUiScale()]
  m.npTitle = m.top.findNode("npTitle")
  m.npTrack = m.top.findNode("npTrack")
  m.npFill = m.top.findNode("npFill")
  m.npPos = m.top.findNode("npPos")
  m.npDur = m.top.findNode("npDur")
  m.actionsGroup = m.top.findNode("actions")
  m.fbTimer = m.top.findNode("fbTimer")
  m.fbTimer.observeField("fire", "onFeedbackTimer")
  m.title.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  m.title.color = tvmText()
  m.subtitle.font = tvmFontMeta()
  m.npTitle.font = tvmFontLabel()
  m.npArt.observeField("loadStatus", "onNowPlayingArt")
  m.npPos.font = tvmFontMeta()
  m.npDur.font = tvmFontMeta()
  m.chipNodes = []
  m.infoNodes = []
  m.rows = []
  m.actions = []
  m.index = 0
  m.feedback = {}
  m.shownId = ""
  buildStatic()
  render()
end sub

sub buildStatic()
  chipFont = tvmFont("semibold", tvmTypeSize(tvmTypeCaption()))
  i = 0
  while i < 3
    bg = CreateObject("roSGNode", "GlassPanel")
    bg.height = 60
    bg.shape = "chip"
    bg.visible = false
    text = CreateObject("roSGNode", "Label")
    text.font = chipFont
    text.height = 60
    text.vertAlign = "center"
    text.horizAlign = "center"
    text.visible = false
    m.chips.appendChild(bg)
    m.chips.appendChild(text)
    m.chipNodes.Push({ bg: bg, text: text })
    i = i + 1
  end while
  labelFont = tvmFontMeta()
  valueFont = tvmFontSecondary()
  i = 0
  while i < 4
    key = CreateObject("roSGNode", "Label")
    key.font = labelFont
    key.color = tvmMuted()
    key.translation = [0, i * 76 + 8]
    key.width = 300
    key.height = 60
    value = CreateObject("roSGNode", "Label")
    value.font = valueFont
    value.color = tvmText()
    value.translation = [300, i * 76]
    value.width = 668
    value.height = 68
    m.info.appendChild(key)
    m.info.appendChild(value)
    m.infoNodes.Push({ key: key, value: value })
    i = i + 1
  end while
  rowFont = tvmFont("semibold", tvmTypeSize(tvmTypeSecondary()))
  fbFont = tvmFontMeta()
  i = 0
  while i < 6
    row = CreateObject("roSGNode", "Group")
    row.translation = [0, i * 128]
    tint = CreateObject("roSGNode", "GlassPanel")
    tint.width = 968
    tint.height = 112
    tint.shape = "tab"
    ring = CreateObject("roSGNode", "Poster")
    ring.uri = "pkg:/images/glass/focus-ring.9.png"
    ring.translation = [-16, -16]
    ring.width = 1000
    ring.height = 144
    ring.visible = false
    label = CreateObject("roSGNode", "Label")
    label.font = rowFont
    label.color = tvmText()
    label.translation = [48, 0]
    label.width = 540
    label.height = 112
    label.vertAlign = "center"
    feedback = CreateObject("roSGNode", "Label")
    feedback.font = fbFont
    feedback.translation = [500, 0]
    feedback.width = 420
    feedback.height = 112
    feedback.vertAlign = "center"
    feedback.horizAlign = "right"
    row.appendChild(tint)
    row.appendChild(ring)
    row.appendChild(label)
    row.appendChild(feedback)
    m.actionsGroup.appendChild(row)
    m.rows.Push({ row: row, tint: tint, ring: ring, label: label, feedback: feedback })
    i = i + 1
  end while
end sub

function chipWidth(text as String) as Integer
  return (Len(text) * 26) + 64
end function

sub setChip(i as Integer, x as Integer, text as String, fill as String, ink as String)
  chip = m.chipNodes[i]
  w = chipWidth(text)
  chip.bg.translation = [x, 0]
  chip.bg.width = w
  chip.bg.tintColor = fill
  chip.bg.visible = true
  chip.text.translation = [x, 0]
  chip.text.width = w
  chip.text.text = text
  chip.text.color = ink
  chip.text.visible = true
end sub

sub render()
  if m.rows = invalid then return
  mode = m.top.mode
  device = m.top.device
  if device = invalid then device = {}
  fixture = (m.top.fixture = true)
  for each chip in m.chipNodes
    chip.bg.visible = false
    chip.text.visible = false
  end for
  infoRows = []
  np = invalid
  m.actions = []
  sameTarget = true

  if mode = "device" and device.Count() > 0
    id = asText(aaGet(device, "id", ""))
    sameTarget = (id = m.shownId)
    m.shownId = id
    state = asText(aaGet(device, "state", "unknown"))
    platform = asText(aaGet(device, "platform", ""))
    m.glyph.uri = "pkg:/images/hub/" + hubPlatformGlyph(platform) + ".png"
    m.title.text = asText(aaGet(device, "name", "Device"))
    model = asText(aaGet(device, "model", ""))
    subtitle = hubPlatformName(platform)
    if model <> "" then subtitle = subtitle + " · " + model
    m.subtitle.text = subtitle
    x = 0
    stateText = hubStateLabel(state)
    setChip(0, 0, stateText, "0xFFFFFF26", hubStateColor(state))
    x = chipWidth(stateText) + 16
    chipIdx = 1
    if aaGet(device, "isCurrent", false) = true
      setChip(chipIdx, x, "This device", "0xFFFFFF26", tvmText())
      x = x + chipWidth("This device") + 16
      chipIdx = chipIdx + 1
    end if
    ' Chips share the 968-unit content width; one that would overflow is skipped.
    if aaGet(device, "physicalInput", false) = true and x + chipWidth("Has remote") <= 968
      setChip(chipIdx, x, "Has remote", "0xFFFFFF26", tvmMuted())
    end if
    room = asText(aaGet(device, "room", ""))
    if room = "" then room = "No room set"
    infoRows.Push({ k: "Room", v: room })
    infoRows.Push({ k: "Platform", v: hubPlatformName(platform) })
    app = asText(aaGet(device, "appVersion", ""))
    build = asText(aaGet(device, "build", ""))
    if build <> "" then app = app + " (" + build + ")"
    infoRows.Push({ k: "App", v: app })
    infoRows.Push({ k: "Last seen", v: hubLastSeenText(device, m.top.serverTime) })
    np = hubNowPlayingView(aaGet(device, "nowPlaying", invalid))
    m.actions = hubActionsFor(device, fixture)
  else if mode = "account"
    sameTarget = (m.shownId = "account")
    m.shownId = "account"
    m.glyph.uri = "pkg:/images/hub/user.png"
    m.title.text = m.top.accountName + " account"
    m.subtitle.text = "Linked devices"
    infoRows.Push({ k: "Signed in", v: m.top.accountName })
    infoRows.Push({ k: "Devices", v: StrI(m.top.deviceCount).Trim() })
    reason = ""
    if fixture then reason = "Demo data"
    m.actions.Push({ id: "add", label: "Add device", enabled: not fixture, reason: reason })
  else if mode = "more"
    sameTarget = (m.shownId = "more")
    m.shownId = "more"
    m.glyph.uri = "pkg:/images/hub/dots.png"
    m.title.text = StrI(m.top.moreCount).Trim() + " more devices"
    m.subtitle.text = "Not shown on the graph"
    infoRows.Push({ k: "On graph", v: "6 devices" })
    infoRows.Push({ k: "More", v: StrI(m.top.moreCount).Trim() })
    m.actions.Push({ id: "devices", label: "Show all devices", enabled: true, reason: "" })
  else
    m.shownId = ""
    m.glyph.uri = "pkg:/images/hub/tv.png"
    m.title.text = "No device selected"
    m.subtitle.text = "Choose a device to see details"
  end if
  m.glyph.blendColor = tvmText()

  i = 0
  while i < m.infoNodes.Count()
    if i < infoRows.Count()
      m.infoNodes[i].key.text = infoRows[i].k
      m.infoNodes[i].value.text = infoRows[i].v
      m.infoNodes[i].key.visible = true
      m.infoNodes[i].value.visible = true
    else
      m.infoNodes[i].key.visible = false
      m.infoNodes[i].value.visible = false
    end if
    i = i + 1
  end while

  actionsY = 290 + (infoRows.Count() * 76) + 24
  m.info.visible = true
  if np <> invalid
    m.info.visible = false
    actionsY = 310
    m.nowPlaying.translation = [56, actionsY]
    m.nowPlaying.visible = true
    m.npTitle.text = np.title
    m.npPos.text = np.posText
    m.npDur.text = np.durText
    m.npFill.width = 8 + Int((648 * np.progressPct) / 100)
    art = asText(aaGet(aaGet(device, "nowPlaying", {}), "artworkUrl", ""))
    if Left(LCase(art), 4) = "http"
      m.npArt.uri = upgradeArtUrl(art, "backdrop")
      m.npArt.visible = true
    else
      m.npArt.visible = false
    end if
    actionsY = actionsY + 760
  else
    m.nowPlaying.visible = false
  end if
  m.actionsGroup.translation = [56, actionsY]

  if not sameTarget
    m.feedback = {}
    m.index = 0
  end if
  if m.index > m.actions.Count() - 1 then m.index = m.actions.Count() - 1
  if m.index < 0 then m.index = 0
  paintActions()
end sub

sub paintActions()
  if m.rows = invalid then return
  has = (m.top.hasFocus = true)
  i = 0
  while i < m.rows.Count()
    row = m.rows[i]
    if i < m.actions.Count()
      a = m.actions[i]
      row.row.visible = true
      row.label.text = a.label
      fb = m.feedback[a.id]
      fbText = ""
      fbColor = tvmMuted()
      if fb <> invalid
        fbText = fb.text
        if fb.state = "confirmed"
          fbColor = hubStateColor("playing")
        else if fb.state = "timed_out"
          fbColor = hubStateColor("paused")
        else if fb.state = "rejected"
          fbColor = hubStateColor("revoked")
        end if
      else if not a.enabled
        fbText = a.reason
      end if
      row.feedback.text = fbText
      row.feedback.color = fbColor
      focused = (has and i = m.index)
      row.tint.focused = focused
      row.ring.visible = false
      if focused
        row.tint.tintColor = tvmGlassTintFocused()
      else
        row.tint.tintColor = tvmGlassTint()
      end if
      if a.enabled
        row.row.opacity = 1.0
      else
        row.row.opacity = 0.4
      end if
      if fb <> invalid then row.row.opacity = 1.0
    else
      row.row.visible = false
    end if
    i = i + 1
  end while
  if m.index >= 0 and m.index < m.actions.Count()
    m.top.focusKey = "inspector:" + m.actions[m.index].id
  else
    m.top.focusKey = "inspector:"
  end if
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  id = key
  if Left(key, 10) = "inspector:" then id = Mid(key, 11)
  i = 0
  while i < m.actions.Count()
    if m.actions[i].id = id
      m.index = i
      paintActions()
      return
    end if
    i = i + 1
  end while
end sub

function actionCount(arg as Dynamic) as Integer
  return m.actions.Count()
end function

' arg: { id, state: "pending"|"confirmed"|"timed_out"|"rejected"|"clear", text }.
function setFeedback(arg as Object) as Boolean
  if arg = invalid then return false
  id = asText(aaGet(arg, "id", ""))
  state = asText(aaGet(arg, "state", ""))
  if id = "" then return false
  if state = "clear"
    if m.feedback.DoesExist(id) then m.feedback.Delete(id)
  else
    m.feedback[id] = { state: state, text: asText(aaGet(arg, "text", "")) }
    if state <> "pending"
      m.fbTimer.control = "stop"
      m.fbTimer.control = "start"
    end if
  end if
  paintActions()
  return true
end function

sub onFeedbackTimer()
  keep = {}
  for each id in m.feedback
    if m.feedback[id].state = "pending" then keep[id] = m.feedback[id]
  end for
  m.feedback = keep
  paintActions()
end sub

' { type: "action"|"exit"|"focus"|"none", id, enabled }.
function handleIntent(intent as String) as Object
  count = m.actions.Count()
  if intent = "up"
    if m.index > 0
      m.index = m.index - 1
      paintActions()
    end if
    return { type: "focus", id: "", enabled: true }
  end if
  if intent = "down"
    if m.index < count - 1
      m.index = m.index + 1
      paintActions()
    end if
    return { type: "focus", id: "", enabled: true }
  end if
  if intent = "left" or intent = "back" then return { type: "exit", id: "", enabled: true }
  if intent = "select" and count > 0
    a = m.actions[m.index]
    return { type: "action", id: a.id, enabled: a.enabled }
  end if
  return { type: "none", id: "", enabled: true }
end function

sub onNowPlayingArt()
  if m.npArt.loadStatus = "failed" then m.npArt.visible = false
end sub
