' Hub client that runs for the whole session, outside any screen:
'   - registers this installation after sign-in (registry keys
'     hubInstallationId and hubDeviceSecret; clientId from
'     roDeviceInfo.GetChannelClientId()),
'   - sends a presence heartbeat every heartbeatSec (30 s) and immediately
'     when the play state changes (heartbeatNow),
'   - polls the command inbox every 3 s while registered, decides each
'     command with hubDecide(), hands the effect to the scene and acks every
'     command (accepted then applied, or rejected).
' Demo data (hubFixture) never registers and never sends anything.
sub init()
  m.heartbeat = CreateObject("roSGNode", "Timer")
  m.heartbeat.duration = 30
  m.heartbeat.repeat = true
  m.heartbeat.observeField("fire", "onHeartbeatTimer")
  m.inbox = CreateObject("roSGNode", "Timer")
  m.inbox.duration = 3
  m.inbox.repeat = true
  m.inbox.observeField("fire", "onInboxTimer")
  m.retry = CreateObject("roSGNode", "Timer")
  m.retry.duration = 60
  m.retry.repeat = false
  m.retry.observeField("fire", "onRetry")
  m.regTask = invalid
  m.presTask = invalid
  m.inboxTask = invalid
  m.ackTask = invalid
  m.seq = 0
  m.dirty = false
  m.lastSeq = 0
  m.lastInboxSeq = 0
  m.handled = []
  m.acks = []
  m.awaiting = {}
  m.heartbeatSec = 30
  m.registered = false
end sub

sub syncApiState()
  m.coreUrl = m.top.coreUrl
  m.coreToken = m.top.coreToken
  m.accountToken = m.top.accountToken
  m.profileId = m.top.profileId
  m.deviceCredential = m.top.deviceCredential
end sub

sub setStatus(status as String)
  if m.top.status <> status then m.top.status = status
end sub

sub onActive()
  if m.top.active
    if m.top.fixture = true
      setStatus("demo")
      return
    end if
    ensureRegistered()
  else
    stopTimers()
    setStatus("off")
  end if
end sub

sub stopTimers()
  m.heartbeat.control = "stop"
  m.inbox.control = "stop"
  m.retry.control = "stop"
  m.registered = false
end sub

sub startTimers()
  m.heartbeat.duration = m.heartbeatSec
  m.heartbeat.control = "start"
  m.inbox.control = "start"
  m.registered = true
  setStatus("online")
  sendPresence()
end sub

' ---- Registration ----

sub ensureRegistered()
  cred = hubDeviceCredential()
  if cred <> ""
    m.top.deviceCredential = cred
    m.top.installationId = loadHubInstallationId()
    startTimers()
    return
  end if
  register()
end sub

sub register()
  if m.regTask <> invalid
    if not m.regTask.done then return
  end if
  setStatus("registering")
  syncApiState()
  info = CreateObject("roDeviceInfo")
  app = CreateObject("roAppInfo")
  name = info.GetFriendlyName()
  if name = invalid or name = "" then name = "Roku"
  model = info.GetModelDisplayName()
  if model = invalid then model = ""
  build = app.GetValue("tvm_commit")
  if build = invalid then build = ""
  version = app.GetVersion()
  if version = invalid or version = "" then version = "1.0.0"
  body = hubRegisterBody(hubClientId(), name, model, version, build)
  m.regTask = startApiRequest(hubUrl(m.top.coreUrl, "/installations/register"), "POST", body, "onRegisterDone")
end sub

sub onRegisterDone()
  task = m.regTask
  if task = invalid then return
  if task.ok
    installation = aaGet(task.json, "installation", {})
    id = asText(aaGet(installation, "id", ""))
    secret = asText(aaGet(task.json, "deviceSecret", ""))
    if id = "" or secret = ""
      setStatus("error")
      m.retry.control = "start"
      return
    end if
    saveHubInstallation(id, secret)
    sec = aaGet(task.json, "heartbeatSec", 30)
    if hubNum(sec) >= 5 then m.heartbeatSec = Int(hubNum(sec))
    m.top.deviceCredential = id + "." + secret
    m.top.installationId = id
    startTimers()
    return
  end if
  kind = hubErrorKind(task.statusCode, task.error)
  if kind = "unavailable" or kind = "offline" or kind = "error" or kind = "limited"
    setStatus(kind)
    m.retry.control = "start"
  else
    setStatus("auth")
  end if
end sub

sub onRetry()
  if m.top.active and m.top.fixture <> true then ensureRegistered()
end sub

' Forget the credential (signed out, or the server revoked this installation).
function forget(arg as Dynamic) as Boolean
  stopTimers()
  clearHubInstallation()
  m.top.deviceCredential = ""
  m.top.installationId = ""
  return true
end function

' ---- Presence ----

function heartbeatNow(arg as Dynamic) as Boolean
  if not m.registered then return false
  sendPresence()
  return true
end function

sub onHeartbeatTimer()
  sendPresence()
end sub

' monotonic across restarts: seconds since 2026, never below last + 1
function nextSeq() as Integer
  clock = CreateObject("roDateTime")
  seq = (clock.AsSeconds() - 1767225600) * 8
  if seq <= m.lastSeq then seq = m.lastSeq + 1
  m.lastSeq = seq
  return seq
end function

' { state, nowPlaying } from the open player, or idle.
function playerSnapshot() as Object
  p = m.top.player
  if p = invalid then return { state: "idle", nowPlaying: invalid }
  state = asText(p.playState)
  if state <> "playing" and state <> "paused" then return { state: "idle", nowPlaying: invalid }
  media = asText(p.mediaId)
  np = { mediaId: media, title: asText(p.streamTitle), positionSec: Int(hubNum(p.playPosition)), profileId: asText(m.top.profileId) }
  if hubNum(p.playDuration) > 0 then np.durationSec = Int(hubNum(p.playDuration))
  return { state: state, nowPlaying: np }
end function

sub sendPresence()
  if not m.registered then return
  if m.presTask <> invalid
    if not m.presTask.done
      m.dirty = true
      return
    end if
  end if
  m.dirty = false
  syncApiState()
  snap = playerSnapshot()
  body = hubPresenceBody(nextSeq(), snap.state, snap.nowPlaying)
  m.presTask = startApiRequest(hubUrl(m.top.coreUrl, "/presence"), "POST", body, "onPresenceDone")
end sub

sub onPresenceDone()
  task = m.presTask
  if task = invalid then return
  if task.ok
    setStatus("online")
    sec = hubNum(aaGet(task.json, "heartbeatSec", 0))
    if sec >= 5 and Int(sec) <> m.heartbeatSec
      m.heartbeatSec = Int(sec)
      m.heartbeat.duration = m.heartbeatSec
    end if
    if hubNum(aaGet(task.json, "pendingCommands", 0)) > 0 then pollInbox()
    if m.dirty then sendPresence()
    return
  end if
  if task.error = "device_revoked"
    forget(invalid)
    setStatus("revoked")
    return
  end if
  if task.statusCode = 401
    ' Stale credential: register again once.
    forget(invalid)
    if m.top.active then register()
    return
  end if
  kind = hubErrorKind(task.statusCode, task.error)
  if kind = "unavailable" then setStatus("unavailable")
end sub

' ---- Command inbox (this Roku as a target) ----

sub onInboxTimer()
  pollInbox()
end sub

sub pollInbox()
  if not m.registered then return
  if m.inboxTask <> invalid
    if not m.inboxTask.done then return
  end if
  syncApiState()
  m.inboxTask = startApiGet(hubUrl(m.top.coreUrl, "/inbox?after=" + StrI(m.lastInboxSeq).Trim()), "onInboxDone")
end sub

sub onInboxDone()
  task = m.inboxTask
  if task = invalid or not task.ok then return
  commands = aaGet(task.json, "commands", [])
  if commands = invalid then return
  for each cmd in commands
    handleCommand(cmd)
  end for
end sub

function wasHandled(id as String) as Boolean
  for each h in m.handled
    if h = id then return true
  end for
  return false
end function

sub remember(id as String)
  m.handled.Push(id)
  while m.handled.Count() > 40
    m.handled.Delete(0)
  end while
end sub

' Decide, hand the effect to the scene, and ack. play.title is acked
' "accepted" now and finished by the scene through report().
sub handleCommand(cmd as Object)
  id = asText(aaGet(cmd, "id", ""))
  if id = "" then return
  seq = aaGet(cmd, "seq", 0)
  if hubNum(seq) > m.lastInboxSeq then m.lastInboxSeq = Int(hubNum(seq))
  if wasHandled(id) then return
  remember(id)
  ctx = { playerOpen: (m.top.player <> invalid), mayNavigate: m.top.mayNavigate }
  result = hubDecide(cmd, ctx)
  if result.status = "applied"
    effect = result.effect
    effect.commandId = id
    if effect.kind = "play"
      m.awaiting[id] = true
      queueAck(id, "accepted", "")
    else
      queueAck(id, "accepted", "")
      queueAck(id, "applied", "")
    end if
    m.top.effect = effect
  else
    queueAck(id, "rejected", result.reason)
  end if
end sub

' The scene finishes a command it held open (play.title).
function report(arg as Object) as Boolean
  id = asText(aaGet(arg, "id", ""))
  if id = "" or not m.awaiting.DoesExist(id) then return false
  m.awaiting.Delete(id)
  status = asText(aaGet(arg, "status", "applied"))
  queueAck(id, status, asText(aaGet(arg, "reason", "")))
  return true
end function

sub queueAck(id as String, status as String, reason as String)
  m.acks.Push({ id: id, status: status, reason: reason })
  sendNextAck()
end sub

sub sendNextAck()
  if m.acks.Count() = 0 then return
  if m.ackTask <> invalid
    if not m.ackTask.done then return
  end if
  ack = m.acks[0]
  syncApiState()
  body = { status: ack.status }
  if ack.reason <> "" then body.reason = ack.reason
  m.ackTask = startApiRequest(hubUrl(m.top.coreUrl, "/commands/" + ack.id + "/ack"), "POST", FormatJson(body), "onAckDone")
end sub

sub onAckDone()
  task = m.ackTask
  if task = invalid then return
  ' A failed ack is dropped: the command was already acted on and the
  ' server expires it. Retrying could re-apply nothing, so move on.
  if m.acks.Count() > 0 then m.acks.Delete(0)
  sendNextAck()
end sub
