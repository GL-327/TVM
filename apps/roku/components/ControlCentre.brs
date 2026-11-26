' Player Control Centre (mockup 02): a near-plane glass panel on the right with
' SpatialTabs (Playback, Audio & Subtitles, Devices), two receding ghost panels
' behind it and a windowed list of glass rows. PlayerScreen owns the one
' SceneGraph focus and forwards intents to handleIntent(); this component
' never takes focus and never touches the Video node. Rows ask the player to
' act by setting `action` (playback, audio, subtitle, openHub, handoffApplied,
' handoffFailed, closed), so there is no duplicate playback logic here.
'
' Zones: "tabs" and "rows". Focus inside the list is by row id.
' Devices: GET /overview (the contract's device list) through ApiTask, then
' POST /commands play.title and a 1 s poll of GET /commands/:id. Demo mode
' (hubFixtureEnabled) uses the bundled fixture and a local timer instead and
' never builds a request.
sub init()
  m.top.visible = false
  m.scrim = m.top.findNode("scrim")
  m.ghostFar = m.top.findNode("ghostFar")
  m.ghostNear = m.top.findNode("ghostNear")
  m.panel = m.top.findNode("panel")
  m.tabs = m.top.findNode("tabs")
  m.content = m.top.findNode("content")
  m.rowsHost = m.top.findNode("rows")
  m.plate = m.top.findNode("plate")
  m.status = m.top.findNode("status")
  m.idleTimer = m.top.findNode("idleTimer")
  m.pollTimer = m.top.findNode("pollTimer")
  m.simTimer = m.top.findNode("simTimer")
  m.pressTimer = m.top.findNode("pressTimer")
  m.openAnim = m.top.findNode("openAnim")
  m.openSlide = m.top.findNode("openSlide")
  m.tabAnim = m.top.findNode("tabAnim")
  m.plateAnim = m.top.findNode("plateAnim")
  m.plateMove = m.top.findNode("plateMove")
  m.plateScale = m.top.findNode("plateScale")

  m.tabs.pitch = 496
  m.tabs.ids = ccTabIds()
  m.tabs.labels = ccTabLabels()
  m.status.font = tvmFontMeta()
  m.status.color = tvmMuted()
  m.plate.scaleRotateCenter = [768, 64]

  m.visibleRows = 10
  m.rowPitch = 144
  m.tab = "playback"
  m.zone = "rows"
  m.model = []
  m.index = -1
  m.first = 0
  m.focusId = ""
  m.memory = {}
  m.pool = []
  m.audioCur = ""
  m.subState = { off: true, id: "" }
  m.devices = []
  m.devStatus = "loading"
  m.devError = ""
  m.devCurrent = ""
  m.devTask = invalid
  m.sendTask = invalid
  m.pollTask = invalid
  m.fixture = false
  m.seq = 0
  m.cmdSeq = 0
  m.idle = CreateObject("roTimespan")
  m.hoClock = CreateObject("roTimespan")
  m.handoff = { phase: "idle", deviceId: "", name: "", text: "", cmdId: "" }

  m.idleTimer.observeField("fire", "onIdleTick")
  m.pollTimer.observeField("fire", "onPollTick")
  m.simTimer.observeField("fire", "onSimTick")
  m.pressTimer.observeField("fire", "onPressDone")
  if m.global <> invalid
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paintAll")
  end if
  buildPool()
end sub

' ---- Row pool (10 reusable glass rows, one window over the model) ----

sub buildPool()
  labelFont = tvmFontLabel()
  detailFont = tvmFontMeta()
  i = 0
  while i < m.visibleRows
    row = CreateObject("roSGNode", "Group")
    row.translation = [0, i * m.rowPitch]
    bg = CreateObject("roSGNode", "GlassPanel")
    bg.shape = "tab"
    bg.width = 1536
    bg.height = 128
    glyph = CreateObject("roSGNode", "Poster")
    glyph.loadDisplayMode = "scaleToFit"
    glyph.width = 72
    glyph.height = 72
    glyph.translation = [48, 28]
    label = CreateObject("roSGNode", "Label")
    label.font = labelFont
    label.color = tvmText()
    label.height = 128
    label.vertAlign = "center"
    detail = CreateObject("roSGNode", "Label")
    detail.font = detailFont
    detail.color = tvmMuted()
    detail.height = 128
    detail.vertAlign = "center"
    detail.horizAlign = "right"
    chev = CreateObject("roSGNode", "Poster")
    chev.uri = "pkg:/images/hub/chevron.png"
    chev.width = 56
    chev.height = 56
    chev.translation = [1432, 36]
    dot = CreateObject("roSGNode", "Poster")
    dot.uri = "pkg:/images/glass/dot.png"
    dot.blendColor = "0xC9E1FFFF"
    dot.width = 32
    dot.height = 32
    dot.translation = [1448, 48]
    row.appendChild(bg)
    row.appendChild(glyph)
    row.appendChild(label)
    row.appendChild(detail)
    row.appendChild(chev)
    row.appendChild(dot)
    m.rowsHost.appendChild(row)
    m.pool.Push({ row: row, bg: bg, glyph: glyph, label: label, detail: detail, chev: chev, dot: dot })
    i = i + 1
  end while
end sub

function glyphUri(name as String) as String
  if name = "" then return ""
  if name = "tv" or name = "laptop" or name = "phone" or name = "web" or name = "user" or name = "dots" then return "pkg:/images/hub/" + name + ".png"
  if name = "restart" then return "pkg:/images/icons/back.png"
  return "pkg:/images/icons/" + name + ".png"
end function

' ---- Config sync (api.brs reads these off m) ----

sub syncApiState()
  m.coreUrl = m.top.coreUrl
  m.coreToken = m.top.coreToken
  m.accountToken = m.top.accountToken
  m.profileId = m.top.profileId
  m.deviceCredential = m.top.deviceCredential
end sub

function signedIn() as Boolean
  if m.fixture then return true
  return isAccountToken(m.top.accountToken)
end function

' ---- Open / close ----

sub openPanel()
  m.fixture = hubFixtureEnabled()
  syncApiState()
  if m.handoff.phase = "failed" then resetHandoff()
  subs = ccNormalizeSubs(m.top.subtitleTracks)
  m.subState = ccSubtitleCurrent(m.top.captionMode, m.top.subtitleCurrent, subs)
  m.audioCur = m.top.audioCurrent
  m.tab = "playback"
  m.playbackSub = ""
  m.tabs.activeIndex = 0
  m.tabs.previewIndex = 0
  m.zone = "rows"
  m.focusId = ""
  m.first = 0
  m.top.visible = true
  m.top.isOpen = true
  m.idle.Mark()
  m.idleTimer.control = "stop"
  m.idleTimer.control = "start"
  refreshRows()
  paintAll()
  playOpen()
end sub

sub closePanel(arg as Dynamic)
  reason = "back"
  if GetInterface(arg, "ifString") <> invalid then reason = arg
  m.playbackSub = ""
  ' Leaving the player also stops any handoff timers (and with them polling).
  if reason = "teardown"
    m.pollTimer.control = "stop"
    m.simTimer.control = "stop"
    m.handoff.phase = "idle"
  end if
  if not m.top.isOpen then return
  m.top.isOpen = false
  m.top.visible = false
  m.idleTimer.control = "stop"
  m.pressTimer.control = "stop"
  m.tabs.hasFocus = false
  emit("closed", { reason: reason })
end sub

sub playOpen()
  if tvmReduceMotion() or m.openAnim = invalid
    m.panel.opacity = 1.0
    m.panel.translation = [2000, 120]
    m.scrim.opacity = 1.0
    m.ghostNear.opacity = 0.55
    m.ghostFar.opacity = 0.3
    return
  end if
  m.openAnim.control = "stop"
  m.panel.opacity = 1.0
  m.panel.translation = [2000, 120]
  m.scrim.opacity = 1.0
  m.ghostNear.opacity = 0.55
  m.ghostFar.opacity = 0.3
  m.openAnim.duration = tvmMotionPanel()
  m.openAnim.control = "start"
end sub

function handoffInFlight() as Boolean
  return ccInFlight(m.handoff.phase)
end function

sub onIdleTick()
  if not m.top.isOpen then return
  if ccShouldAutoClose(m.idle.TotalMilliseconds(), m.handoff.phase) then closePanel("idle")
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

' ---- Models ----

sub onPlayerState()
  if m.top.isOpen then refreshRows()
end sub

sub refreshRows()
  m.model = buildModel(m.tab)
  m.index = ccIndexOfId(m.model, m.focusId)
  if m.index >= 0 then m.focusId = m.model[m.index].id
  paintRows()
end sub

function buildModel(tabId as String) as Object
  if tabId = "audio"
    audio = ccNormalizeAudio(m.top.audioTracks)
    subs = ccNormalizeSubs(m.top.subtitleTracks)
    rows = ccAudioRows(audio, m.audioCur)
    for each r in ccSubtitleRows(subs, m.subState)
      rows.Push(r)
    end for
    rows.Push(ccCaptionInfoRow())
    return rows
  end if
  if tabId = "devices"
    ctx = {
      signedIn: signedIn(), fixture: m.fixture, live: not ccIsVod(m.top.mediaKind, m.top.mediaId)
      status: m.devStatus, errorText: m.devError, devices: m.devices, currentId: m.devCurrent
      handoff: { phase: m.handoff.phase, deviceId: m.handoff.deviceId, text: m.handoff.text }
    }
    return ccDeviceRows(ctx)
  end if
  isVod = ccIsVod(m.top.mediaKind, m.top.mediaId)
  if m.playbackSub = "sleep"
    return ccSleepRows(asText(aaGet(m.top, "sleepMode", "off")), LCase(asText(m.top.mediaKind)) = "series")
  end if
  return ccPlaybackRows({
    playing: m.top.playing
    hasNext: m.top.hasNext
    nextTitle: m.top.nextTitle
    live: not isVod
    hasVersions: (isVod and m.top.hasVersions = true)
    versionLabel: m.top.versionLabel
    sleepEnabled: (m.top.sleepEnabled = true)
    sleepLabel: ccSleepLabel(asText(aaGet(m.top, "sleepMode", "off")), m.top.sleepRemaining)
  })
end function

' ---- Tabs ----

sub setTab(id as String)
  if id = "" or id = m.tab then return
  m.memory[m.tab] = m.focusId
  m.tab = id
  m.playbackSub = ""
  m.focusId = ""
  if m.memory.DoesExist(id) then m.focusId = m.memory[id]
  m.first = 0
  if id = "devices" then loadDevices()
  refreshRows()
  playTabSwitch()
end sub

sub playTabSwitch()
  if tvmReduceMotion() or m.tabAnim = invalid
    m.content.opacity = 1.0
    m.content.translation = [72, 236]
    return
  end if
  m.tabAnim.control = "stop"
  m.content.opacity = 1.0
  m.content.translation = [72, 236]
  m.tabAnim.duration = tvmMotionPanel()
  m.tabAnim.control = "start"
end sub

' ---- Intents (called by PlayerScreen for every key while open) ----

function handleIntent(intent as String) as Object
  m.idle.Mark()
  if not m.top.isOpen then return { type: "none" }
  if intent = "back" and m.tab = "playback" and m.playbackSub = "sleep"
    m.playbackSub = ""
    m.focusId = "sleep"
    refreshRows()
    paintAll()
    return { type: "none" }
  end if
  if intent = "back" or intent = "info"
    closePanel("back")
    return { type: "close" }
  end if
  if m.zone = "tabs"
    keyTabs(intent)
  else
    keyRows(intent)
  end if
  return { type: "none" }
end function

sub keyTabs(intent as String)
  if intent = "left" or intent = "right"
    m.tabs.callFunc("handleIntent", intent)
  else if intent = "select"
    res = m.tabs.callFunc("handleIntent", "select")
    if res.type = "activate" then setTab(res.id)
  else if intent = "down"
    idx = m.tabs.previewIndex
    if idx <> m.tabs.activeIndex
      m.tabs.activeIndex = idx
      ids = ccTabIds()
      setTab(ids[idx])
    end if
    if m.index >= 0 then setZone("rows")
  end if
  paintAll()
end sub

sub keyRows(intent as String)
  if intent = "up" or intent = "down"
    res = ccMoveFocus(m.model, m.index, intent)
    if res.edge = "top"
      m.tabs.previewIndex = m.tabs.activeIndex
      setZone("tabs")
    else if res.index <> m.index
      m.index = res.index
      m.focusId = m.model[m.index].id
    end if
  else if intent = "select"
    activateRow()
    return
  end if
  paintAll()
end sub

sub setZone(zone as String)
  m.zone = zone
  m.tabs.hasFocus = (zone = "tabs")
end sub

sub activateRow()
  if m.index < 0 or m.index >= m.model.Count() then return
  row = m.model[m.index]
  if row.kind <> "row" or row.enabled <> true then return
  pressPlate()
  id = row.id
  if m.tab = "playback"
    if id = "sleep"
      m.playbackSub = "sleep"
      m.focusId = "sleep:" + asText(aaGet(m.top, "sleepMode", "off"))
      refreshRows()
    else if id = "sleep:back"
      m.playbackSub = ""
      m.focusId = "sleep"
      refreshRows()
    else if Left(id, 6) = "sleep:"
      mode = Mid(id, 7)
      m.playbackSub = ""
      m.focusId = "sleep"
      emit("sleep", { mode: mode })
      refreshRows()
    else if id = "versions"
      emit("openVersions", {})
      closePanel("versions")
    else
      emit("playback", { id: id })
    end if
  else if m.tab = "audio"
    if Left(id, 6) = "audio:"
      m.audioCur = Mid(id, 7)
      emit("audio", { trackId: m.audioCur })
    else if id = "sub:off"
      m.subState = { off: true, id: "" }
      emit("subtitle", { trackId: "", off: true })
    else if Left(id, 4) = "sub:"
      m.subState = { off: false, id: Mid(id, 5) }
      emit("subtitle", { trackId: m.subState.id, off: false })
    end if
    refreshRows()
  else if m.tab = "devices"
    if id = "hub"
      emit("openHub", {})
    else if Left(id, 4) = "dev:"
      startHandoff(Mid(id, 5))
    end if
  end if
  paintAll()
end sub

' ---- Devices ----

sub loadDevices()
  if m.fixture
    data = hubLoadFixture()
    m.devices = aaGet(data, "devices", [])
    m.devCurrent = asText(aaGet(data, "currentInstallationId", ""))
    m.devStatus = "ok"
    return
  end if
  if not signedIn() then return
  if m.devTask <> invalid
    if not m.devTask.done then return
  end if
  if m.devices.Count() = 0 then m.devStatus = "loading"
  syncApiState()
  m.devTask = startApiGet(hubUrl(m.top.coreUrl, "/overview"), "onDevicesDone")
end sub

sub onDevicesDone()
  task = m.devTask
  if task = invalid then return
  if task.ok
    m.devices = aaGet(task.json, "devices", [])
    m.devCurrent = asText(aaGet(task.json, "currentInstallationId", ""))
    if m.devCurrent = "" then m.devCurrent = loadHubInstallationId()
    m.devStatus = "ok"
    m.devError = ""
  else
    if m.devices.Count() = 0 or m.devStatus = "loading"
      m.devStatus = "error"
      if task.error = "device_revoked"
        m.devError = "This Roku was removed from your account."
      else
        m.devError = hubErrorText(hubErrorKind(task.statusCode, task.error))
      end if
    end if
  end if
  if m.top.isOpen and m.tab = "devices" then refreshRows()
end sub

sub resetHandoff()
  m.handoff = { phase: "idle", deviceId: "", name: "", text: "", cmdId: "" }
end sub

function deviceById(id as String) as Dynamic
  for each d in m.devices
    if asText(aaGet(d, "id", "")) = id then return d
  end for
  return invalid
end function

sub startHandoff(deviceId as String)
  if ccInFlight(m.handoff.phase) then return
  if m.handoff.phase = "applied" and m.handoff.deviceId = deviceId then return
  device = deviceById(deviceId)
  if device = invalid then return
  if ccDeviceReason(device) <> "" then return
  name = asText(aaGet(device, "name", "Device"))
  res = ccHandoffStep("idle", { kind: "start" }, name, m.fixture)
  m.handoff = { phase: res.phase, deviceId: deviceId, name: name, text: res.text, cmdId: "" }
  m.hoClock.Mark()
  if m.fixture
    ' Demo: a local timer stands in for Core. No request is ever built.
    m.simTimer.control = "stop"
    m.simTimer.control = "start"
    return
  end if
  m.cmdSeq = m.cmdSeq + 1
  syncApiState()
  body = ccHandoffBody(hubIdempotencyKey(m.cmdSeq), deviceId, m.top.mediaId, m.top.position)
  m.sendTask = startApiRequest(hubUrl(m.top.coreUrl, "/commands"), "POST", body, "onHandoffSent")
end sub

sub onSimTick()
  if not ccInFlight(m.handoff.phase) then
    m.simTimer.control = "stop"
    return
  end if
  status = ccFixtureStatus(m.hoClock.TotalMilliseconds())
  applyHandoff({ kind: "status", status: status, reason: "" })
end sub

sub onHandoffSent()
  task = m.sendTask
  if task = invalid then return
  if not ccInFlight(m.handoff.phase) then return
  if not task.ok
    applyHandoff({ kind: "sendError", statusCode: task.statusCode, error: task.error })
    return
  end if
  command = aaGet(task.json, "command", {})
  id = asText(aaGet(command, "id", ""))
  status = asText(aaGet(command, "status", "pending"))
  m.handoff.cmdId = id
  applyHandoff({ kind: "status", status: status, reason: asText(aaGet(command, "reason", "")) })
  if ccInFlight(m.handoff.phase) and id <> "" then
    m.pollTimer.control = "stop"
    m.pollTimer.control = "start"
  else if ccInFlight(m.handoff.phase) then
    applyHandoff({ kind: "sendError", statusCode: 0, error: "invalid_json" })
  end if
end sub

' Every second until final: ask Core how the command is doing.
sub onPollTick()
  if not ccInFlight(m.handoff.phase) then
    m.pollTimer.control = "stop"
    return
  end if
  if m.hoClock.TotalMilliseconds() > ccHandoffTimeoutMs()
    applyHandoff({ kind: "timeout" })
    return
  end if
  if m.pollTask <> invalid
    if not m.pollTask.done then return
  end if
  if m.handoff.cmdId = "" then return
  syncApiState()
  m.pollTask = startApiGet(hubUrl(m.top.coreUrl, "/commands/" + m.handoff.cmdId), "onHandoffPolled")
end sub

sub onHandoffPolled()
  task = m.pollTask
  if task = invalid then return
  if not ccInFlight(m.handoff.phase) then return
  if not task.ok
    applyHandoff({ kind: "pollError", statusCode: task.statusCode })
    return
  end if
  command = aaGet(task.json, "command", {})
  applyHandoff({ kind: "status", status: asText(aaGet(command, "status", "pending")), reason: asText(aaGet(command, "reason", "")) })
end sub

sub applyHandoff(ev as Object)
  res = ccHandoffStep(m.handoff.phase, ev, m.handoff.name, m.fixture)
  if not res.changed then return
  m.handoff.phase = res.phase
  m.handoff.text = res.text
  if res.final
    m.pollTimer.control = "stop"
    m.simTimer.control = "stop"
    if res.phase = "applied"
      emit("handoffApplied", { name: m.handoff.name, text: res.text })
    else
      emit("handoffFailed", { name: m.handoff.name, text: res.text })
    end if
  end if
  if m.top.isOpen
    m.idle.Mark()
    if m.tab = "devices" then refreshRows()
    paintStatus()
  end if
end sub

' ---- Painting ----

sub paintAll()
  if m.tabs = invalid then return
  m.tabs.hasFocus = (m.zone = "tabs")
  paintRows()
  paintStatus()
end sub

sub paintStatus()
  text = ""
  color = tvmMuted()
  phase = m.handoff.phase
  if m.tab = "devices" and phase <> "idle"
    if phase = "applied"
      text = m.handoff.text + ". Playback here is paused."
      color = hubStateColor("playing")
    else if phase = "failed"
      text = m.handoff.text + ". Still playing here."
      color = hubStateColor("revoked")
    else
      text = m.handoff.text
      color = tvmText()
    end if
  end if
  m.status.text = text
  m.status.color = color
end sub

function rowDetailColor(model as Object) as String
  id = asText(aaGet(model, "id", ""))
  if m.handoff.phase <> "idle" and id = "dev:" + m.handoff.deviceId
    if m.handoff.phase = "applied" then return hubStateColor("playing")
    if m.handoff.phase = "failed" then return hubStateColor("revoked")
    return tvmText()
  end if
  if asText(aaGet(model, "detail", "")) = "Demo" then return hubStateColor("paused")
  return tvmMuted()
end function

sub paintRows()
  if m.pool = invalid or m.pool.Count() = 0 then return
  count = m.model.Count()
  m.first = railViewFirst(count, m.index, m.first, m.visibleRows)
  i = 0
  while i < m.visibleRows
    item = m.pool[i]
    idx = m.first + i
    if idx < count
      paintItem(item, m.model[idx])
    else
      item.row.visible = false
    end if
    i = i + 1
  end while
  paintPlate()
end sub

sub paintItem(item as Object, model as Object)
  kind = model.kind
  focused = (m.zone = "rows" and m.index >= 0 and model.id = m.focusId and kind = "row")
  item.row.visible = true
  isRow = (kind = "row")
  item.bg.visible = (isRow and not focused)
  item.bg.selected = (model.checked = true)
  item.row.opacity = 1.0
  if isRow and model.enabled <> true then item.row.opacity = 0.4
  uri = glyphUri(model.glyph)
  item.glyph.visible = (uri <> "")
  if uri <> "" then item.glyph.uri = uri
  hasChev = (isRow and model.trailing = "chevron")
  hasDot = (isRow and model.trailing = "check")
  item.chev.visible = hasChev
  item.dot.visible = hasDot
  detail = asText(model.detail)
  item.detail.text = detail
  item.detail.color = rowDetailColor(model)
  rightEdge = 1480
  if hasChev then rightEdge = 1408
  if hasDot then rightEdge = 1424
  detailW = 0
  if detail <> "" then detailW = (Len(detail) * 28) + 32
  if detailW > 640 then detailW = 640
  item.detail.width = detailW
  item.detail.translation = [rightEdge - detailW, 0]
  if kind = "header"
    item.label.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
    item.label.color = tvmText()
    item.label.translation = [8, 0]
    item.label.width = 1000
    item.label.wrap = false
    item.label.maxLines = 1
    item.detail.translation = [1480 - detailW, 0]
  else if kind = "info"
    item.label.font = tvmFontMeta()
    item.label.color = tvmMuted()
    item.label.translation = [8, 0]
    item.label.width = 1520
    item.label.wrap = false
    item.label.maxLines = 1
  else
    x = 56
    if uri <> "" then x = 156
    w = rightEdge - detailW - x - 24
    if detail = "" then w = rightEdge - x
    item.label.translation = [x, 0]
    item.label.width = w
    item.label.color = tvmText()
    if model.small = true
      item.label.font = tvmFontSecondary()
      item.label.wrap = true
      item.label.maxLines = 2
    else
      item.label.font = tvmFontLabel()
      item.label.wrap = false
      item.label.maxLines = 1
    end if
  end if
  item.label.text = model.label
end sub

' One glass plate slides behind the focused row (rim, glow, 1.06 scale, 12 unit
' lift, 150 ms ease-out). Reduce Motion places it with no scale, lift or slide.
sub paintPlate()
  if m.plate = invalid then return
  show = (m.zone = "rows" and m.index >= 0 and m.index < m.model.Count())
  if show then show = (m.model[m.index].kind = "row")
  wasShown = (m.plate.visible = true)
  m.plate.visible = show
  if not show then return
  model = m.model[m.index]
  m.plate.selected = (model.checked = true)
  m.plate.opacity = 1.0
  if model.enabled <> true then m.plate.opacity = 0.4
  slot = m.index - m.first
  toPos = [0.0, (slot * m.rowPitch) * 1.0]
  toScale = [1.0, 1.0]
  if not tvmReduceMotion()
    toPos = [0.0, (slot * m.rowPitch) - tvmFocusLift() * 1.0]
    toScale = [tvmPillFocusScale(), tvmPillFocusScale()]
  end if
  fromPos = m.plate.translation
  fromScale = m.plate.scale
  if fromPos = invalid then fromPos = toPos
  if fromScale = invalid then fromScale = toScale
  if m.platePlaced <> true or not wasShown or tvmReduceMotion() or m.plateAnim = invalid
    m.platePlaced = true
    m.plate.translation = toPos
    m.plate.scale = toScale
    return
  end if
  if Abs(fromPos[1] - toPos[1]) < 0.5 and Abs(fromScale[0] - toScale[0]) < 0.002 then return
  m.plateAnim.control = "stop"
  m.plate.translation = toPos
  m.plate.scale = toScale
  m.plateAnim.duration = tvmMotionFocus()
  m.plateMove.keyValue = [fromPos, toPos]
  m.plateScale.keyValue = [fromScale, toScale]
  m.plateAnim.control = "start"
  ' Logical focus is already final; the animation only eases the plate there.
end sub

' Pressed: scale 0.98 for 80 ms.
sub pressPlate()
  if tvmReduceMotion() or not m.plate.visible then return
  m.plateAnim.control = "stop"
  m.plate.scale = [tvmPressScale(), tvmPressScale()]
  m.pressTimer.control = "stop"
  m.pressTimer.control = "start"
end sub

sub onPressDone()
  if m.top.isOpen then paintPlate()
end sub
