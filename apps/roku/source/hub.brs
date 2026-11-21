' TVM Hub client helpers (contract: docs/redesign/HUB-V1-CONTRACT.md, base
' path /api/hub/v1). Everything that does not touch a node or the network is
' pure, so apps/roku/scripts/hub.test.mjs ports it to JS and runs the same
' fixture (scripts/fixtures/hub-cases.json) through both.
'
' Needs asText()/aaGet() from media.brs. Registry and URL helpers that need
' config.brs live in hubCore.brs.

' ---- Routes and request bodies ----

' Roku: Core exposes the Hub under /api/hub/v1. 404 or 503 from the overview
' means the Hub is not available on this Core.
function hubErrorKind(statusCode as Integer, errorCode as String) as String
  if statusCode = 404 or statusCode = 503 then return "unavailable"
  if statusCode = 401 or statusCode = 403 then return "auth"
  if statusCode = 0 then return "offline"
  if statusCode = 429 then return "limited"
  return "error"
end function

function hubErrorText(kind as String) as String
  if kind = "unavailable" then return "TVM Hub is not available on this Core yet."
  if kind = "auth" then return "Sign in again to use TVM Hub."
  if kind = "offline" then return "Could not reach Core. Check the connection and retry."
  if kind = "limited" then return "Too many requests. Wait a moment and retry."
  return "TVM Hub could not load. Retry in a moment."
end function

function hubCapabilities() as Object
  return ["playback.pause_resume", "playback.seek", "playback.skip", "nav.dpad", "nav.select", "nav.back", "play.title", "handoff.send", "input.physical"]
end function

function hubRegisterBody(clientId as String, name as String, model as String, appVersion as String, build as String) as String
  body = { clientId: clientId, platform: "roku", name: name, appVersion: appVersion, capabilities: hubCapabilities() }
  if model <> "" then body.model = model
  if build <> "" then body.build = build
  return FormatJson(body)
end function

' nowPlaying: invalid, or { mediaId, title, positionSec, durationSec, profileId }.
function hubPresenceBody(seq as Integer, state as String, nowPlaying as Dynamic) as String
  body = { seq: seq, state: state, capabilities: hubCapabilities() }
  if state <> "idle" and nowPlaying <> invalid then body.nowPlaying = nowPlaying
  return FormatJson(body)
end function

function hubCommandBody(idempotencyKey as String, target as String, action as String, payload as Object, ttlSec as Integer) as String
  body = { v: 1, idempotencyKey: idempotencyKey, target: target, action: action, ttlSec: ttlSec }
  if payload <> invalid then body.payload = payload
  return FormatJson(body)
end function

function hubIdempotencyKey(seed as Integer) as String
  info = CreateObject("roDeviceInfo")
  return "roku-" + StrI(info.GetRandomInt()).Trim() + "-" + StrI(seed).Trim()
end function

function hubClientId() as String
  info = CreateObject("roDeviceInfo")
  id = info.GetChannelClientId()
  if id = invalid then return ""
  return id
end function

' ---- Time ----

function hubNum(value as Dynamic) as Float
  if value = invalid then return 0.0
  t = Type(value)
  if t = "Integer" or t = "roInt" or t = "roInteger" or t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble" or t = "LongInteger"
    return value
  end if
  return 0.0
end function

function hubDaysFromCivil(y as Integer, m as Integer, d as Integer) as Integer
  if m <= 2 then y = y - 1
  era = y \ 400
  yoe = y - (era * 400)
  mp = m + 9
  if m > 2 then mp = m - 3
  doy = ((153 * mp) + 2) \ 5 + d - 1
  doe = (yoe * 365) + (yoe \ 4) - (yoe \ 100) + doy
  return (era * 146097) + doe - 719468
end function

' "2026-11-17T12:34:56.789Z" -> { days, tod } (UTC), or invalid.
function hubParseIso(text as String) as Dynamic
  if Len(text) < 19 then return invalid
  if Mid(text, 5, 1) <> "-" or Mid(text, 8, 1) <> "-" then return invalid
  if Mid(text, 11, 1) <> "T" or Mid(text, 14, 1) <> ":" or Mid(text, 17, 1) <> ":" then return invalid
  y = Val(Mid(text, 1, 4))
  mo = Val(Mid(text, 6, 2))
  d = Val(Mid(text, 9, 2))
  h = Val(Mid(text, 12, 2))
  mi = Val(Mid(text, 15, 2))
  s = Val(Mid(text, 18, 2))
  if y < 1970 or mo < 1 or mo > 12 or d < 1 or d > 31 then return invalid
  return { days: hubDaysFromCivil(Int(y), Int(mo), Int(d)), tod: (Int(h) * 3600) + (Int(mi) * 60) + Int(s) }
end function

' Seconds from `thenIso` to `nowIso`, or -1 when either is unreadable.
function hubAgeSeconds(thenIso as String, nowIso as String) as Integer
  a = hubParseIso(thenIso)
  b = hubParseIso(nowIso)
  if a = invalid or b = invalid then return -1
  age = ((b.days - a.days) * 86400) + (b.tod - a.tod)
  if age < 0 then return 0
  return age
end function

function hubAgeText(ageSec as Integer) as String
  if ageSec < 0 then return ""
  if ageSec < 10 then return "just now"
  if ageSec < 60 then return StrI(ageSec).Trim() + " s ago"
  if ageSec < 3600 then return StrI(ageSec \ 60).Trim() + " min ago"
  if ageSec < 86400 then return StrI(ageSec \ 3600).Trim() + " h ago"
  return StrI(ageSec \ 86400).Trim() + " d ago"
end function

' Age is measured against the server clock, never the Roku clock.
function hubLastSeenText(device as Object, serverTime as String) as String
  seen = asText(aaGet(device, "lastSeenAt", ""))
  if seen = "" then return "Never seen"
  age = hubAgeSeconds(seen, serverTime)
  if age < 0
    fallback = aaGet(device, "lastSeenAgeSec", invalid)
    if fallback = invalid then return "Seen earlier"
    age = Int(hubNum(fallback))
  end if
  return hubAgeText(age)
end function

function hubPad2(n as Integer) as String
  s = StrI(n).Trim()
  if Len(s) < 2 then s = "0" + s
  return s
end function

function hubClock(totalSec as Integer) as String
  if totalSec < 0 then totalSec = 0
  h = totalSec \ 3600
  m = (totalSec - (h * 3600)) \ 60
  s = totalSec - (h * 3600) - (m * 60)
  if h > 0 then return StrI(h).Trim() + ":" + hubPad2(m) + ":" + hubPad2(s)
  return StrI(m).Trim() + ":" + hubPad2(s)
end function

' ---- Device presentation ----

function hubStateLabel(state as String) as String
  if state = "playing" then return "Playing"
  if state = "paused" then return "Paused"
  if state = "idle" then return "Idle"
  if state = "offline" then return "Offline"
  if state = "revoked" then return "Removed"
  return "Unknown"
end function

function hubStateColor(state as String) as String
  if state = "playing" then return "0x4ADE80FF"
  if state = "paused" then return "0xFBBF24FF"
  if state = "idle" then return "0x93C5FDFF"
  if state = "revoked" then return "0xF87171FF"
  return "0x8A8F9CFF"
end function

function hubPlatformGlyph(platform as String) as String
  if platform = "roku" or platform = "android-tv" then return "tv"
  if platform = "windows" then return "laptop"
  if platform = "web" then return "web"
  return "phone"
end function

function hubPlatformName(platform as String) as String
  if platform = "roku" then return "Roku"
  if platform = "windows" then return "Windows"
  if platform = "web" then return "Web"
  if platform = "android" then return "Android"
  if platform = "android-tv" then return "Android TV"
  if platform = "ios" then return "iPhone or iPad"
  return "Device"
end function

function hubHasCap(device as Object, cap as String) as Boolean
  caps = aaGet(device, "capabilities", [])
  for each c in caps
    if c = cap then return true
  end for
  return false
end function

function hubIsOnline(device as Object) as Boolean
  state = asText(aaGet(device, "state", "unknown"))
  presence = asText(aaGet(device, "presence", ""))
  if presence = "offline" then return false
  return state = "idle" or state = "playing" or state = "paused"
end function

' Inspector actions filtered by capability and isCurrent. enabled/reason say
' whether the row can run now. Demo data disables every mutating row.
function hubActionsFor(device as Object, fixture as Boolean) as Object
  out = []
  state = asText(aaGet(device, "state", "unknown"))
  if state = "revoked" then return out
  current = (aaGet(device, "isCurrent", false) = true)
  online = hubIsOnline(device)
  if not current
    if hubHasCap(device, "playback.pause_resume")
      if state = "paused"
        out.Push({ id: "resume", label: "Resume", enabled: (online and not fixture), reason: "" })
      else
        out.Push({ id: "pause", label: "Pause", enabled: (online and state = "playing" and not fixture), reason: "" })
      end if
    end if
    if hubHasCap(device, "nav.dpad")
      out.Push({ id: "remote", label: "Open remote", enabled: (online and not fixture), reason: "" })
    end if
  end if
  out.Push({ id: "rename", label: "Rename", enabled: not fixture, reason: "" })
  out.Push({ id: "room", label: "Set room", enabled: not fixture, reason: "" })
  if current
    out.Push({ id: "signout", label: "Sign out", enabled: not fixture, reason: "" })
  else
    out.Push({ id: "remove", label: "Remove device", enabled: not fixture, reason: "" })
  end if
  for each a in out
    if not a.enabled
      if fixture
        a.reason = "Demo data"
      else if a.id = "pause" or a.id = "resume" or a.id = "remote"
        if not online then a.reason = "Offline" else a.reason = "Not playing"
      end if
    end if
  end for
  return out
end function

' Card for the inspector, or invalid when there is nothing the viewer may see.
function hubNowPlayingView(np as Dynamic) as Dynamic
  if np = invalid then return invalid
  if GetInterface(np, "ifAssociativeArray") = invalid then return invalid
  if aaGet(np, "restricted", false) = true then return invalid
  title = asText(aaGet(np, "title", ""))
  if title = "" then return invalid
  position = Int(hubNum(aaGet(np, "positionSec", 0)))
  dur = Int(hubNum(aaGet(np, "durationSec", 0)))
  progress = 0.0
  if dur > 0
    progress = position / dur
    if progress > 1 then progress = 1.0
  end if
  durText = ""
  if dur > 0 then durText = hubClock(dur)
  return { title: title, posText: hubClock(position), durText: durText, progressPct: Int((progress * 100) + 0.5) }
end function

' ---- Sorting (Devices tab) ----

function hubSortKeyLabel(key as String) as String
  if key = "seen" then return "Last seen"
  if key = "room" then return "Room"
  return "Name"
end function

function hubNextSortKey(key as String) as String
  if key = "name" then return "seen"
  if key = "seen" then return "room"
  return "name"
end function

' True when a sorts before b.
function hubBefore(a as Object, b as Object, key as String) as Boolean
  an = LCase(asText(aaGet(a, "name", "")))
  bn = LCase(asText(aaGet(b, "name", "")))
  if key = "seen"
    sa = asText(aaGet(a, "lastSeenAt", ""))
    sb = asText(aaGet(b, "lastSeenAt", ""))
    if sa <> sb
      if sa = "" then return false
      if sb = "" then return true
      return sa > sb
    end if
  else if key = "room"
    ra = LCase(asText(aaGet(a, "room", "")))
    rb = LCase(asText(aaGet(b, "room", "")))
    if ra <> rb
      if ra = "" then return false
      if rb = "" then return true
      return ra < rb
    end if
  end if
  if an <> bn then return an < bn
  return asText(aaGet(a, "id", "")) < asText(aaGet(b, "id", ""))
end function

function hubSortDevices(devices as Object, key as String) as Object
  out = []
  for each d in devices
    at = out.Count()
    i = 0
    while i < out.Count()
      if hubBefore(d, out[i], key)
        at = i
        exit while
      end if
      i = i + 1
    end while
    out.Push(d)
    j = out.Count() - 1
    while j > at
      out[j] = out[j - 1]
      j = j - 1
    end while
    out[at] = d
  end for
  return out
end function

' ---- Commands (sending) ----

function hubCommandIsFinal(status as String) as Boolean
  return status = "applied" or status = "rejected" or status = "timed_out"
end function

function hubReasonText(reason as String) as String
  if reason = "not_ready" then return "Nothing is ready to control there"
  if reason = "unsupported" then return "That device cannot do this"
  if reason = "target_offline" then return "The device is offline"
  if reason = "expired" then return "It took too long"
  if reason = "invalid_payload" then return "The device could not read the request"
  if reason = "device_revoked" then return "The device was removed"
  return "The device said no"
end function

' Feedback line for an action: pending, confirmed, timed out or rejected.
function hubCommandText(status as String, reason as String) as String
  if status = "pending" then return "Sending..."
  if status = "accepted" then return "Received"
  if status = "applied" then return "Done"
  if status = "timed_out" then return "No response in time"
  if status = "rejected" then return hubReasonText(reason)
  return ""
end function

' Reasons the Core API gives when it will not accept a command at all.
function hubSendErrorText(statusCode as Integer, errorCode as String) as String
  if errorCode = "target_offline" then return "The device is offline"
  if errorCode = "unsupported" then return "That device cannot do this"
  if errorCode = "not_found" then return "That device is gone"
  if errorCode = "device_revoked" then return "This Roku was removed"
  if statusCode = 0 then return "Could not reach Core"
  return "Could not send"
end function

' Capability a command needs on its target (Hub contract v1).
function hubActionCap(action as String) as String
  if action = "playback.pause" or action = "playback.resume" then return "playback.pause_resume"
  if action = "playback.seek" then return "playback.seek"
  if action = "playback.skip" then return "playback.skip"
  if action = "nav.dpad" then return "nav.dpad"
  if action = "nav.select" then return "nav.select"
  if action = "nav.back" then return "nav.back"
  if action = "play.title" then return "play.title"
  if action = "play.live_channel" then return "play.live_channel"
  return ""
end function

' Remote panel: a key (as an intent) on this Roku becomes a command for the
' target. { ok, action, payload, label, reason }. A target without the
' capability answers ok = false, reason "unsupported".
function hubRemoteCommand(intent as String, device as Object) as Object
  action = ""
  payload = {}
  label = ""
  if intent = "up" or intent = "down" or intent = "left" or intent = "right"
    action = "nav.dpad"
    payload = { direction: intent }
    label = intent
  else if intent = "select"
    action = "nav.select"
    label = "OK"
  else if intent = "info"
    action = "nav.back"
    label = "Back"
  else if intent = "play" or intent = "pause"
    if asText(aaGet(device, "state", "")) = "paused"
      action = "playback.resume"
      label = "Resume"
    else
      action = "playback.pause"
      label = "Pause"
    end if
  else if intent = "rewind"
    action = "playback.skip"
    payload = { deltaSec: -10 }
    label = "Back 10 s"
  else if intent = "fastForward"
    action = "playback.skip"
    payload = { deltaSec: 10 }
    label = "Forward 10 s"
  end if
  if action = "" then return { ok: false, action: "", payload: {}, label: "", reason: "ignored" }
  if not hubHasCap(device, hubActionCap(action)) then return { ok: false, action: action, payload: payload, label: label, reason: "unsupported" }
  return { ok: true, action: action, payload: payload, label: label, reason: "" }
end function

' ---- Commands (receiving, this Roku as target) ----

' Decide a command from the inbox. ctx: { playerOpen: Boolean, playerState:
' "playing"|"paused"|"idle", duration: Float, mayNavigate: Boolean }.
' Returns { status: "applied"|"rejected", reason, effect } where effect is
' { kind: "pause"|"resume"|"seek"|"skip"|"intent"|"play"|"", ... }.
function hubDecide(cmd as Object, ctx as Object) as Object
  action = asText(aaGet(cmd, "action", ""))
  payload = aaGet(cmd, "payload", {})
  if payload = invalid then payload = {}
  if action = "playback.pause" or action = "playback.resume"
    if not ctx.playerOpen then return { status: "rejected", reason: "not_ready", effect: { kind: "" } }
    kind = "pause"
    if action = "playback.resume" then kind = "resume"
    return { status: "applied", reason: "", effect: { kind: kind } }
  end if
  if action = "playback.seek"
    if not ctx.playerOpen then return { status: "rejected", reason: "not_ready", effect: { kind: "" } }
    if aaGet(payload, "positionSec", invalid) = invalid then return { status: "rejected", reason: "invalid_payload", effect: { kind: "" } }
    position = hubNum(aaGet(payload, "positionSec", 0))
    if position < 0 then return { status: "rejected", reason: "invalid_payload", effect: { kind: "" } }
    return { status: "applied", reason: "", effect: { kind: "seek", positionSec: position } }
  end if
  if action = "playback.skip"
    if not ctx.playerOpen then return { status: "rejected", reason: "not_ready", effect: { kind: "" } }
    if aaGet(payload, "deltaSec", invalid) = invalid then return { status: "rejected", reason: "invalid_payload", effect: { kind: "" } }
    delta = hubNum(aaGet(payload, "deltaSec", 0))
    if delta > 3600 then delta = 3600
    if delta < -3600 then delta = -3600
    return { status: "applied", reason: "", effect: { kind: "skip", deltaSec: delta } }
  end if
  if action = "nav.dpad"
    dir = asText(aaGet(payload, "direction", ""))
    if dir <> "up" and dir <> "down" and dir <> "left" and dir <> "right" then return { status: "rejected", reason: "invalid_payload", effect: { kind: "" } }
    return { status: "applied", reason: "", effect: { kind: "intent", intent: dir } }
  end if
  if action = "nav.select" then return { status: "applied", reason: "", effect: { kind: "intent", intent: "select" } }
  if action = "nav.back" then return { status: "applied", reason: "", effect: { kind: "intent", intent: "back" } }
  if action = "play.title"
    mediaId = asText(aaGet(payload, "mediaId", ""))
    if mediaId = "" then return { status: "rejected", reason: "invalid_payload", effect: { kind: "" } }
    if not ctx.mayNavigate then return { status: "rejected", reason: "not_ready", effect: { kind: "" } }
    return { status: "applied", reason: "", effect: { kind: "play", mediaId: mediaId, positionSec: hubNum(aaGet(payload, "positionSec", 0)) } }
  end if
  return { status: "rejected", reason: "unsupported", effect: { kind: "" } }
end function

' ---- Activity ----

function hubActivityText(event as Object) as String
  kind = asText(aaGet(event, "type", ""))
  actor = aaGet(event, "actor", {})
  target = aaGet(event, "target", {})
  actorName = asText(aaGet(actor, "name", ""))
  targetName = asText(aaGet(target, "name", ""))
  if targetName = "" then targetName = "A device"
  if actorName = "" then actorName = "Someone"
  if kind = "device.linked" then return targetName + " was linked"
  if kind = "device.signed_in" then return targetName + " signed in"
  if kind = "device.renamed" then return targetName + " was renamed"
  if kind = "device.room" then return targetName + " moved room"
  if kind = "device.revoked" then return targetName + " was removed"
  if kind = "device.signed_out" then return targetName + " signed out"
  if kind = "pair.approved" then return actorName + " approved " + targetName
  if kind = "pair.denied" then return actorName + " denied " + targetName
  if kind = "command.sent" then return actorName + " sent a command to " + targetName
  if kind = "command.applied" then return targetName + " ran a command"
  if kind = "command.rejected" then return targetName + " refused a command"
  if kind = "command.timed_out" then return targetName + " did not answer a command"
  return "Activity on " + targetName
end function

' ---- Pairing: approving another device from this TV ----

function hubPairAlphabet() as String
  return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
end function

' Upper-case, drop the dash and spaces and anything outside the alphabet.
function hubPairNormalize(text as String) as String
  alphabet = hubPairAlphabet()
  up = UCase(text)
  out = ""
  i = 1
  while i <= Len(up)
    ch = Mid(up, i, 1)
    if Instr(1, alphabet, ch) > 0 then out = out + ch
    i = i + 1
  end while
  if Len(out) > 8 then out = Left(out, 8)
  return out
end function

' "ABCD", "ABCDEF" -> "ABCD-EF". The server accepts the dash or not.
function hubPairFormat(code as String) as String
  c = hubPairNormalize(code)
  if Len(c) <= 4 then return c
  return Left(c, 4) + "-" + Mid(c, 5)
end function

function hubPairComplete(code as String) as Boolean
  return Len(hubPairNormalize(code)) = 8
end function

function hubPairErrorText(statusCode as Integer, errorCode as String) as String
  if statusCode = 429 or errorCode = "rate_limited" then return "Too many wrong codes. Wait 15 minutes and try again."
  if errorCode = "expired" or errorCode = "expired_token" then return "That code has expired. Ask the other device for a new one."
  if statusCode = 404 or errorCode = "not_found" then return "That code was not found. Check it and try again."
  if statusCode = 401 or errorCode = "auth_required" then return "Sign in again to approve a device."
  if statusCode = 0 then return "Could not reach Core."
  return "Could not check that code."
end function

' RFC 8628 polling on the device being signed in. Returns { action: "wait"|
' "stop", interval, reason }. slow_down adds 5 s to the interval.
function hubPairPollNext(interval as Integer, errorCode as String) as Object
  if interval < 1 then interval = 5
  if errorCode = "authorization_pending" then return { action: "wait", interval: interval, reason: "" }
  if errorCode = "slow_down" then return { action: "wait", interval: interval + 5, reason: "" }
  if errorCode = "access_denied" then return { action: "stop", interval: interval, reason: "denied" }
  if errorCode = "expired_token" then return { action: "stop", interval: interval, reason: "expired" }
  return { action: "stop", interval: interval, reason: "error" }
end function

function hubPairStopText(reason as String) as String
  if reason = "denied" then return "The request was denied on the other device."
  if reason = "expired" then return "The code expired. Start again for a new one."
  return "Could not finish signing in with a code."
end function
