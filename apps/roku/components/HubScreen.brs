' TVM Hub screen: title, SpatialTabs (Network, Devices, Activity), a content
' host and the inspector host. This node owns the one SceneGraph focus; the
' tabs, the three content views and the inspector are driven through their
' handleIntent() functions, so focus order is a small table of zones:
'   tabs -> content -> inspector, plus the Add device button and the
'   unavailable/retry state.
' Back order: modal (confirm or keyboard dialog) -> inspector -> content ->
' tabs -> previous route.
' Network: GET /overview every 15 s while visible, applied in place. 404 or
' 503 means "Hub unavailable" with a Retry. hubFixture shows the bundled
' demo data, labelled "Demo data", and never sends a command.
sub init()
  m.top.focusable = true
  m.title = m.top.findNode("title")
  m.tabs = m.top.findNode("tabs")
  m.demoChip = m.top.findNode("demoChip")
  m.demoText = m.top.findNode("demoText")
  m.notice = m.top.findNode("notice")
  m.network = m.top.findNode("network")
  m.devicesList = m.top.findNode("devicesList")
  m.activity = m.top.findNode("activity")
  m.inspector = m.top.findNode("inspector")
  m.addBtn = m.top.findNode("addBtn")
  m.stateHost = m.top.findNode("stateHost")
  m.stateTitle = m.top.findNode("stateTitle")
  m.stateBody = m.top.findNode("stateBody")
  m.retryBtn = m.top.findNode("retryBtn")
  m.modalHost = m.top.findNode("modalHost")
  m.hostsGroup = m.top.findNode("hosts")
  m.poll = m.top.findNode("poll")
  m.commandPoll = m.top.findNode("commandPoll")

  m.title.font = tvmFontScreenTitle()
  m.title.color = tvmText()
  m.demoText.font = tvmFont("bold", tvmTypeSize(tvmTypeCaption()))
  m.notice.font = tvmFontMeta()
  m.stateTitle.font = tvmFontScreenTitle()
  m.stateBody.font = tvmFontSecondary()
  m.tabs.ids = ["network", "devices", "activity"]
  m.tabs.labels = ["Network", "Devices", "Activity"]

  m.tab = "network"
  m.zone = "content"
  m.devices = []
  m.events = []
  m.serverTime = ""
  m.currentId = ""
  m.accountName = ""
  m.selectedId = ""
  m.sortKey = "name"
  m.status = "loading"
  m.loaded = false
  m.modal = invalid
  m.modalKind = ""
  m.pending = invalid
  m.ovTask = invalid
  m.actTask = invalid
  m.mutTask = invalid
  m.clock = CreateObject("roTimespan")
  m.hubSeq = 0
  initCommands()

  m.poll.observeField("fire", "onPoll")
  m.network.observeField("focusId", "onFocusChanged")
  m.devicesList.observeField("focusId", "onFocusChanged")
  m.top.observeField("visible", "onVisible")
  setZone("content")
  showTab("network")
  showState("loading", "")
end sub

' ---- Config, visibility, polling ----

sub syncApiState()
  m.coreUrl = m.top.coreUrl
  m.coreToken = m.top.coreToken
  m.accountToken = m.top.accountToken
  m.profileId = m.top.profileId
  m.deviceCredential = m.top.deviceCredential
end sub

sub onFixture()
  fixture = (m.top.fixture = true)
  m.demoChip.visible = fixture
  m.loaded = false
  m.inspector.fixture = fixture
  if m.top.visible then loadOverview(true)
end sub

' A fresh push from Home or the You menu: Network, content, this device.
sub onReset()
  if m.top.reset <> true then return
  m.tab = "network"
  m.tabs.activeIndex = 0
  m.tabs.previewIndex = 0
  m.selectedId = ""
  closeModal()
  showTab("network")
  m.network.callFunc("focusFirst", invalid)
  setZone("content")
  updateInspector()
  loadOverview(true)
end sub

sub onVisible()
  if m.top.visible
    m.demoChip.visible = (m.top.fixture = true)
    if m.top.fixture = true
      loadOverview(false)
    else
      loadOverview(false)
      m.poll.control = "start"
    end if
    startCommandTracking()
  else
    m.poll.control = "stop"
    stopCommandTracking()
  end if
end sub

sub onPoll()
  if not m.top.visible then return
  loadOverview(false)
  if m.tab = "activity" then loadActivity()
end sub

' force skips the 3 s freshness guard (a Retry or a reset).
sub loadOverview(force as Boolean)
  if m.top.fixture = true
    data = hubLoadFixture()
    if data.Count() = 0
      showState("error", "Demo data could not be read.")
      return
    end if
    applyOverview(data)
    m.events = aaGet(aaGet(data, "activity", {}), "events", [])
    m.activity.serverTime = asText(aaGet(data, "serverTime", ""))
    m.activity.events = m.events
    return
  end if
  if m.ovTask <> invalid
    if not m.ovTask.done then return
  end if
  if m.loaded and not force and m.clock.TotalMilliseconds() < 3000 then return
  m.clock.Mark()
  if not m.loaded then showState("loading", "")
  syncApiState()
  m.ovTask = startApiGet(hubUrl(m.top.coreUrl, "/overview"), "onOverviewDone")
end sub

sub onOverviewDone()
  task = m.ovTask
  if task = invalid then return
  if task.ok
    applyOverview(task.json)
    return
  end if
  kind = hubErrorKind(task.statusCode, task.error)
  if task.error = "device_revoked"
    emit("revoked", {})
    return
  end if
  if m.loaded
    m.notice.text = "Reconnecting. Showing the last update."
    m.notice.visible = true
    return
  end if
  showState(kind, hubErrorText(kind))
end sub

sub applyOverview(json as Object)
  devices = aaGet(json, "devices", [])
  if devices = invalid then devices = []
  m.devices = devices
  m.serverTime = asText(aaGet(json, "serverTime", ""))
  m.currentId = asText(aaGet(json, "currentInstallationId", ""))
  account = aaGet(json, "account", {})
  m.accountName = asText(aaGet(account, "name", ""))
  if m.accountName = "" then m.accountName = m.top.accountName
  if m.accountName = "" then m.accountName = "Your"
  m.loaded = true
  m.notice.visible = false
  m.network.accountName = m.accountName
  m.network.devices = devices
  m.devicesList.serverTime = m.serverTime
  m.devicesList.devices = devices
  showState("ok", "")
  updateInspector()
end sub

sub loadActivity()
  if m.top.fixture = true then return
  if m.actTask <> invalid
    if not m.actTask.done then return
  end if
  syncApiState()
  m.actTask = startApiGet(hubUrl(m.top.coreUrl, "/activity?limit=50"), "onActivityDone")
end sub

sub onActivityDone()
  task = m.actTask
  if task = invalid or not task.ok then return
  m.events = aaGet(task.json, "events", [])
  st = asText(aaGet(task.json, "serverTime", ""))
  if st = "" then st = m.serverTime
  m.activity.serverTime = st
  m.activity.events = m.events
end sub

' status: "ok" | "loading" | "unavailable" | "auth" | "offline" | "limited" | "error".
sub showState(status as String, message as String)
  m.status = status
  ok = (status = "ok")
  m.stateHost.visible = not ok
  hostsVisible(ok)
  if status = "loading"
    m.stateTitle.text = "Loading TVM Hub..."
    m.stateBody.text = ""
    m.retryBtn.visible = false
  else if not ok
    m.stateTitle.text = "TVM Hub unavailable"
    if status = "error" then m.stateTitle.text = "TVM Hub did not load"
    if status = "auth" then m.stateTitle.text = "Sign in again"
    m.stateBody.text = message
    m.retryBtn.visible = true
  end if
  if not ok and m.zone <> "tabs" then setZone("state")
  if ok and m.zone = "state" then enterContent()
end sub

sub hostsVisible(ok as Boolean)
  m.hostsGroup.visible = ok
  m.inspector.visible = (ok and m.tab <> "activity")
  m.addBtn.visible = (ok and m.tab <> "activity")
end sub

' ---- Tabs and zones ----

function contentNode() as Object
  if m.tab = "devices" then return m.devicesList
  if m.tab = "activity" then return m.activity
  return m.network
end function

sub showTab(id as String)
  m.tab = id
  m.network.visible = (id = "network")
  m.devicesList.visible = (id = "devices")
  m.activity.visible = (id = "activity")
  m.inspector.visible = (m.status = "ok" and id <> "activity")
  m.addBtn.visible = (m.status = "ok" and id <> "activity")
  if id = "devices"
    m.addBtn.translation = [160, 1880]
  else
    m.addBtn.translation = [160, 1900]
  end if
  if id = "activity" then loadActivity()
  updateInspector()
  setZone(m.zone)
end sub

sub rememberContentFocus()
  node = contentNode()
  m.tabs.callFunc("rememberFocus", { id: m.tab, key: node.focusKey })
end sub

' Switch tabs on activation. Focus stays on the tab strip.
sub activateTab(id as String)
  if id = "" or id = m.tab then return
  rememberContentFocus()
  showTab(id)
end sub

sub enterContent()
  if m.status <> "ok"
    setZone("state")
    return
  end if
  node = contentNode()
  key = m.tabs.callFunc("recallFocus", m.tab)
  if key <> ""
    node.restoreKey = key
  else
    node.callFunc("focusFirst", invalid)
  end if
  setZone("content")
  updateInspector()
end sub

sub setZone(zone as String)
  m.zone = zone
  m.tabs.hasFocus = (zone = "tabs")
  m.network.hasFocus = (zone = "content" and m.tab = "network")
  m.devicesList.hasFocus = (zone = "content" and m.tab = "devices")
  m.activity.hasFocus = (zone = "content" and m.tab = "activity")
  m.inspector.hasFocus = (zone = "inspector")
  m.addBtn.hasFocusStyle = (zone = "add")
  m.retryBtn.hasFocusStyle = (zone = "state")
  ' While focus is in the inspector, the selected node/row stays marked.
  if zone = "inspector"
    m.network.selectedId = m.selectedId
    m.devicesList.selectedId = m.selectedId
  else
    m.network.selectedId = ""
    m.devicesList.selectedId = ""
  end if
  publishFocusKey()
end sub

sub publishFocusKey()
  if m.zone = "tabs"
    m.top.focusKey = "tabs:" + m.tab
  else
    rememberContentFocus()
    m.top.focusKey = "content:" + contentNode().focusKey
  end if
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  parsed = parseFocusKey(key)
  if parsed.zone = "tabs"
    idx = tabIndexOf(parsed.a)
    if idx >= 0
      m.tabs.activeIndex = idx
      m.tabs.previewIndex = idx
      showTab(parsed.a)
    end if
    setZone("tabs")
    return
  end if
  if parsed.zone = "content"
    colon = Instr(1, parsed.a, ":")
    if colon > 0
      tabId = Left(parsed.a, colon - 1)
      idx = tabIndexOf(tabId)
      if idx >= 0
        m.tabs.activeIndex = idx
        m.tabs.previewIndex = idx
        showTab(tabId)
        contentNode().restoreKey = parsed.a
        setZone("content")
        updateInspector()
      end if
    end if
  end if
end sub

function tabIndexOf(id as String) as Integer
  ids = ["network", "devices", "activity"]
  i = 0
  while i < ids.Count()
    if ids[i] = id then return i
    i = i + 1
  end while
  return -1
end function

' ---- Selection and inspector ----

sub onFocusChanged()
  if m.zone <> "content" then return
  updateInspector()
end sub

function selectionId() as String
  if m.tab = "network" then return m.network.focusId
  if m.tab = "devices"
    id = m.devicesList.focusId
    if Left(id, 4) = "ctl:" then return m.selectedId
    return id
  end if
  return ""
end function

function deviceById(id as String) as Object
  for each d in m.devices
    if asText(aaGet(d, "id", "")) = id then return d
  end for
  return invalid
end function

sub updateInspector()
  if m.inspector = invalid then return
  id = selectionId()
  m.selectedId = id
  m.inspector.fixture = (m.top.fixture = true)
  m.inspector.serverTime = m.serverTime
  m.inspector.accountName = m.accountName
  m.inspector.deviceCount = m.devices.Count()
  if id = "more"
    m.inspector.moreCount = spatialAssign(m.devices).overflow.Count()
    m.inspector.mode = "more"
    return
  end if
  if id = "account"
    m.inspector.mode = "account"
    return
  end if
  device = deviceById(id)
  if device <> invalid
    m.inspector.device = device
    m.inspector.mode = "device"
  else
    m.inspector.mode = "empty"
  end if
end sub

' ---- Actions ----

sub runAction(id as String)
  device = deviceById(m.selectedId)
  if id = "rename" and device <> invalid
    showKeyboard("rename", "Rename device", asText(aaGet(device, "name", "")), "Save")
  else if id = "room" and device <> invalid
    showKeyboard("room", "Set room", asText(aaGet(device, "room", "")), "Save")
  else if id = "remove" and device <> invalid
    showConfirm("Remove " + asText(aaGet(device, "name", "this device")) + "?", "It will be signed out and has to be linked again to come back.", "Remove", "remove:" + m.selectedId)
  else if id = "signout"
    showConfirm("Sign out of TVM on this Roku?", "This Roku stops showing in your devices and has to be linked again.", "Sign out", "signout")
  else if id = "devices"
    m.tabs.activeIndex = 1
    m.tabs.previewIndex = 1
    activateTab("devices")
    enterContent()
  else if id = "add"
    startAddDevice()
  else if id = "pause" or id = "resume"
    sendPlaybackCommand(id, device)
  else if id = "remote"
    openRemote(device)
  end if
end sub

sub setFeedback(id as String, state as String, text as String)
  m.inspector.callFunc("setFeedback", { id: id, state: state, text: text })
end sub

' ---- Dialogs ----

sub showKeyboard(mode as String, title as String, text as String, confirmLabel as String)
  m.pending = { kind: mode, id: m.selectedId }
  m.modalKind = "keyboard"
  dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
  dialog.title = title
  dialog.text = text
  dialog.buttons = [confirmLabel, "Cancel"]
  dialog.observeField("buttonSelected", "onKeyboardButton")
  dialog.observeField("wasClosed", "onKeyboardClosed")
  m.dialog = dialog
  m.top.getScene().dialog = dialog
end sub

sub onKeyboardButton()
  dialog = m.dialog
  if dialog = invalid then return
  index = dialog.buttonSelected
  text = dialog.text.Trim()
  edit = m.pending
  m.pending = invalid
  m.modalKind = ""
  m.dialog = invalid
  m.top.getScene().dialog = invalid
  m.top.setFocus(true)
  if index <> 0 or edit = invalid then return
  if edit.kind = "rename"
    if Len(text) < 1 or Len(text) > 40
      setFeedback("rename", "rejected", "Use 1 to 40 characters")
      return
    end if
    setFeedback("rename", "pending", "Saving...")
    mutate(edit.id, "rename", "/rename", { name: text })
  else if edit.kind = "room"
    if Len(text) > 40
      setFeedback("room", "rejected", "Use up to 40 characters")
      return
    end if
    body = { room: invalid }
    if text <> "" then body.room = text
    setFeedback("room", "pending", "Saving...")
    mutate(edit.id, "room", "/room", body)
  end if
end sub

sub onKeyboardClosed()
  if m.dialog = invalid then return
  m.dialog = invalid
  m.pending = invalid
  m.modalKind = ""
  m.top.setFocus(true)
end sub

sub showConfirm(title as String, body as String, confirmLabel as String, confirmId as String)
  panel = CreateObject("roSGNode", "ConfirmPanel")
  panel.title = title
  panel.body = body
  panel.confirmLabel = confirmLabel
  panel.confirmId = confirmId
  panel.observeField("action", "onConfirmAction")
  m.modalHost.appendChild(panel)
  m.modal = panel
  m.modalKind = "confirm"
  panel.setFocus(true)
end sub

sub closeModal()
  if m.modal <> invalid
    if m.modal.getParent() <> invalid then m.modal.getParent().removeChild(m.modal)
    m.modal = invalid
  end if
  m.modalKind = ""
  m.top.setFocus(true)
end sub

sub onConfirmAction()
  panel = m.modal
  if panel = invalid then return
  action = panel.action
  closeModal()
  if action = invalid then return
  if aaGet(action, "type", "") <> "confirm" then return
  confirmId = asText(aaGet(action, "confirmId", ""))
  if Left(confirmId, 7) = "remove:"
    id = Mid(confirmId, 8)
    setFeedback("remove", "pending", "Removing...")
    mutate(id, "remove", "/revoke", {})
  else if confirmId = "signout"
    setFeedback("signout", "pending", "Signing out...")
    signOutThisRoku()
  end if
end sub

' ---- Mutations: rename, room, revoke, sign out ----

sub mutate(deviceId as String, actionId as String, route as String, body as Object)
  if m.top.fixture = true
    setFeedback(actionId, "rejected", "Demo data")
    return
  end if
  syncApiState()
  m.mutAction = actionId
  m.mutDevice = deviceId
  m.mutTask = startApiRequest(hubUrl(m.top.coreUrl, "/devices/" + deviceId + route), "POST", FormatJson(body), "onMutateDone")
end sub

sub onMutateDone()
  task = m.mutTask
  if task = invalid then return
  actionId = m.mutAction
  if task.ok
    device = aaGet(task.json, "device", invalid)
    if device <> invalid then mergeDevice(device)
    if actionId = "remove"
      setFeedback("remove", "confirmed", "Removed")
      setZone("content")
      m.clock.Mark()
      loadOverview(true)
    else
      setFeedback(actionId, "confirmed", "Saved")
    end if
    return
  end if
  text = "Could not save"
  if task.error = "invalid_name" then text = "Use 1 to 40 characters"
  if task.error = "not_found" then text = "That device is gone"
  if task.statusCode = 0 then text = "Could not reach Core"
  setFeedback(actionId, "rejected", text)
end sub

' Replace one device by id and refresh every view in place.
sub mergeDevice(device as Object)
  id = asText(aaGet(device, "id", ""))
  if id = "" then return
  out = []
  for each d in m.devices
    if asText(aaGet(d, "id", "")) = id
      out.Push(device)
    else
      out.Push(d)
    end if
  end for
  m.devices = out
  m.network.devices = out
  m.devicesList.devices = out
  updateInspector()
end sub

sub signOutThisRoku()
  if m.top.fixture = true
    setFeedback("signout", "rejected", "Demo data")
    return
  end if
  syncApiState()
  m.mutTask = startApiRequest(hubUrl(m.top.coreUrl, "/session/signout"), "POST", "{}", "onSignOutDone")
end sub

sub onSignOutDone()
  task = m.mutTask
  if task = invalid then return
  if task.ok or task.statusCode = 401
    emit("signedOut", {})
    return
  end if
  setFeedback("signout", "rejected", "Could not sign out")
end sub

' ---- Scene actions ----

sub emit(kind as String, extra as Object)
  m.hubSeq = m.hubSeq + 1
  action = { type: kind, seq: m.hubSeq }
  for each key in extra
    action[key] = extra[key]
  end for
  m.top.action = action
end sub

' ---- Keys ----

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if m.modal <> invalid
    m.modal.setFocus(true)
    return true
  end if
  if m.zone = "tabs" then return keyTabs(intent)
  if m.zone = "content" then return keyContent(intent)
  if m.zone = "inspector" then return keyInspector(intent)
  if m.zone = "add" then return keyAdd(intent)
  if m.zone = "state" then return keyState(intent)
  return true
end function

function keyTabs(intent as String) as Boolean
  res = m.tabs.callFunc("handleIntent", intent)
  if res.type = "activate"
    activateTab(res.id)
  else if res.type = "down"
    enterContent()
  else if res.type = "back"
    emit("back", {})
  end if
  publishFocusKey()
  return true
end function

function keyContent(intent as String) as Boolean
  node = contentNode()
  res = node.callFunc("handleIntent", intent)
  t = res.type
  if t = "focus"
    updateInspector()
    publishFocusKey()
  else if t = "edge"
    edge = res.edge
    if edge = "tabs"
      setZone("tabs")
    else if edge = "inspector"
      enterInspector()
    else if edge = "add"
      if m.addBtn.visible then setZone("add")
    end if
  else if t = "select"
    if m.tab = "network" and res.id = "more"
      m.tabs.activeIndex = 1
      m.tabs.previewIndex = 1
      activateTab("devices")
      enterContent()
    else if res.id = "account" and m.tab = "network"
      enterInspector()
    else
      enterInspector()
    end if
  else if t = "sort"
    m.sortKey = res.key
    m.devicesList.sortKey = res.key
  else if t = "graph"
    m.tabs.activeIndex = 0
    m.tabs.previewIndex = 0
    activateTab("network")
    enterContent()
  else if t = "back"
    setZone("tabs")
  end if
  return true
end function

sub enterInspector()
  if not m.inspector.visible then return
  if m.inspector.callFunc("actionCount", invalid) = 0 then return
  setZone("inspector")
end sub

function keyInspector(intent as String) as Boolean
  res = m.inspector.callFunc("handleIntent", intent)
  if res.type = "exit"
    setZone("content")
  else if res.type = "action"
    if res.enabled then runAction(res.id)
  end if
  return true
end function

function keyAdd(intent as String) as Boolean
  if intent = "up" or intent = "back"
    setZone("content")
  else if intent = "select"
    startAddDevice()
  end if
  return true
end function

function keyState(intent as String) as Boolean
  if intent = "up" or intent = "back"
    setZone("tabs")
  else if intent = "select"
    loadOverview(true)
  end if
  return true
end function

' Wired to the generic remote-intent hook on every screen.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub

' ---- Commands to another device ----

sub initCommands()
  m.cmdSeq = 0
  m.sendCtx = {}
  m.pollCtx = {}
  m.tracked = {}
  m.cmdClock = CreateObject("roTimespan")
  m.remote = invalid
  m.pairPanel = invalid
  m.commandPoll.observeField("fire", "onCommandPoll")
end sub

sub startCommandTracking()
end sub

sub stopCommandTracking()
  m.commandPoll.control = "stop"
end sub

' Send one command. feedbackId is the inspector row (or "remote") that shows
' its progress: pending, then applied, rejected or timed out.
sub sendCommand(targetId as String, action as String, payload as Object, feedbackId as String)
  if m.top.fixture = true
    showCommandFeedback(feedbackId, "rejected", "Demo data")
    return
  end if
  m.cmdSeq = m.cmdSeq + 1
  syncApiState()
  body = hubCommandBody(hubIdempotencyKey(m.cmdSeq), targetId, action, payload, 30)
  task = startApiRequest(hubUrl(m.top.coreUrl, "/commands"), "POST", body, "onCommandSent")
  m.sendCtx[task.requestId] = { feedbackId: feedbackId, targetId: targetId, action: action }
  showCommandFeedback(feedbackId, "pending", hubCommandText("pending", ""))
end sub

sub onCommandSent(event as Object)
  task = event.getRoSGNode()
  ctx = m.sendCtx[task.requestId]
  if ctx = invalid then return
  m.sendCtx.Delete(task.requestId)
  if not task.ok
    showCommandFeedback(ctx.feedbackId, "rejected", hubSendErrorText(task.statusCode, task.error))
    return
  end if
  command = aaGet(task.json, "command", {})
  id = asText(aaGet(command, "id", ""))
  status = asText(aaGet(command, "status", "pending"))
  if id = "" then return
  if hubCommandIsFinal(status)
    finishCommand(ctx, status, asText(aaGet(command, "reason", "")))
    return
  end if
  showCommandFeedback(ctx.feedbackId, status, hubCommandText(status, ""))
  m.tracked[id] = { feedbackId: ctx.feedbackId, targetId: ctx.targetId, startedMs: m.cmdClock.TotalMilliseconds(), polling: false }
  m.commandPoll.control = "start"
end sub

' Every second: ask Core how each open command is doing (pending, accepted,
' then applied, rejected or timed out).
sub onCommandPoll()
  open = 0
  done = []
  for each id in m.tracked
    entry = m.tracked[id]
    open = open + 1
    if m.cmdClock.TotalMilliseconds() - entry.startedMs > 40000
      finishCommand(entry, "timed_out", "")
      done.Push(id)
    else if not entry.polling
      entry.polling = true
      syncApiState()
      task = startApiGet(hubUrl(m.top.coreUrl, "/commands/" + id), "onCommandPolled")
      m.pollCtx[task.requestId] = id
    end if
  end for
  for each id in done
    m.tracked.Delete(id)
  end for
  if open = 0 then m.commandPoll.control = "stop"
end sub

sub onCommandPolled(event as Object)
  task = event.getRoSGNode()
  id = m.pollCtx[task.requestId]
  if id = invalid then return
  m.pollCtx.Delete(task.requestId)
  entry = m.tracked[id]
  if entry = invalid then return
  entry.polling = false
  if not task.ok
    if task.statusCode = 404
      finishCommand(entry, "rejected", "not_found")
      m.tracked.Delete(id)
    end if
    return
  end if
  command = aaGet(task.json, "command", {})
  status = asText(aaGet(command, "status", "pending"))
  if hubCommandIsFinal(status)
    finishCommand(entry, status, asText(aaGet(command, "reason", "")))
    m.tracked.Delete(id)
  else
    showCommandFeedback(entry.feedbackId, status, hubCommandText(status, ""))
  end if
end sub

sub finishCommand(entry as Object, status as String, reason as String)
  state = "confirmed"
  if status = "rejected" then state = "rejected"
  if status = "timed_out" then state = "timed_out"
  showCommandFeedback(entry.feedbackId, state, hubCommandText(status, reason))
  if status = "applied"
    m.clock.Mark()
    loadOverview(true)
  end if
end sub

' Inspector rows show feedback in place; the remote panel shows it as a line.
sub showCommandFeedback(feedbackId as String, state as String, text as String)
  if feedbackId = "remote"
    if m.remote <> invalid then m.remote.status = text
    return
  end if
  if state = "accepted" then state = "pending"
  setFeedback(feedbackId, state, text)
end sub

sub sendPlaybackCommand(id as String, device as Dynamic)
  if device = invalid then return
  action = "playback.pause"
  if id = "resume" then action = "playback.resume"
  sendCommand(asText(aaGet(device, "id", "")), action, {}, id)
end sub

' ---- Remote ----

sub openRemote(device as Dynamic)
  if device = invalid then return
  if m.top.fixture = true
    setFeedback("remote", "rejected", "Demo data")
    return
  end if
  panel = CreateObject("roSGNode", "HubRemote")
  panel.device = device
  panel.observeField("action", "onRemoteAction")
  m.modalHost.appendChild(panel)
  m.modal = panel
  m.modalKind = "remote"
  m.remote = panel
  m.remoteTarget = asText(aaGet(device, "id", ""))
  panel.setFocus(true)
end sub

sub onRemoteAction()
  panel = m.remote
  if panel = invalid then return
  action = panel.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "close"
    m.remote = invalid
    closeModal()
    return
  end if
  if kind = "send"
    sendCommand(m.remoteTarget, asText(aaGet(action, "command", "")), aaGet(action, "payload", {}), "remote")
  end if
end sub

' ---- Add device: approve another device from this TV ----

sub startAddDevice()
  if m.top.fixture = true
    emit("notice", { title: "Demo data", body: "TVM Hub is showing sample devices. Turn off demo data in Settings to add a real device." })
    return
  end if
  panel = CreateObject("roSGNode", "HubPair")
  panel.observeField("action", "onPairAction")
  m.modalHost.appendChild(panel)
  m.modal = panel
  m.modalKind = "pair"
  m.pairPanel = panel
  panel.setFocus(true)
end sub

sub onPairAction()
  panel = m.pairPanel
  if panel = invalid then return
  action = panel.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  code = asText(aaGet(action, "code", ""))
  if kind = "close"
    m.pairPanel = invalid
    closeModal()
  else if kind = "lookup"
    panel.phase = "lookup"
    panel.message = "Checking..."
    syncApiState()
    m.pairTask = startApiGet(hubUrl(m.top.coreUrl, "/pair/lookup?userCode=" + encodeQuery(code)), "onPairLookupDone")
  else if kind = "approve" or kind = "deny"
    panel.message = "Sending..."
    syncApiState()
    m.pairDecision = kind
    body = FormatJson({ userCode: code })
    m.pairTask = startApiRequest(hubUrl(m.top.coreUrl, "/pair/" + kind), "POST", body, "onPairDecisionDone")
  end if
end sub

sub onPairLookupDone()
  task = m.pairTask
  panel = m.pairPanel
  if task = invalid or panel = invalid then return
  if not task.ok
    panel.phase = "entry"
    panel.message = hubPairErrorText(task.statusCode, task.error)
    return
  end if
  request = aaGet(task.json, "request", invalid)
  if request = invalid
    panel.phase = "entry"
    panel.message = hubPairErrorText(404, "not_found")
    return
  end if
  st = asText(aaGet(task.json, "serverTime", ""))
  expires = asText(aaGet(request, "expiresAt", ""))
  if hubAgeSeconds(expires, st) > 0
    ' expiresAt is already behind the server clock
    panel.phase = "entry"
    panel.message = hubPairErrorText(410, "expired")
    return
  end if
  panel.serverTime = st
  panel.request = request
  panel.message = ""
  panel.phase = "confirm"
end sub

sub onPairDecisionDone()
  task = m.pairTask
  panel = m.pairPanel
  if task = invalid or panel = invalid then return
  if not task.ok
    panel.phase = "entry"
    panel.message = hubPairErrorText(task.statusCode, task.error)
    return
  end if
  m.pairPanel = invalid
  closeModal()
  if m.pairDecision = "approve"
    emit("notice", { title: "Device approved", body: "It will appear in TVM Hub in a moment." })
    m.clock.Mark()
    loadOverview(true)
  end if
end sub
