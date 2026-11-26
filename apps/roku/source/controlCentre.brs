' Player Control Centre helpers. Everything here is pure (no nodes, no network)
' so apps/roku/scripts/controlCentre.test.mjs can port it to JS and run the
' same cases (scripts/fixtures/controlCentre-cases.json) through both.
'
' Needs asText()/aaGet() from media.brs and hub.brs (hubHasCap, hubIsOnline,
' hubPlatformGlyph, hubCommandText, hubSendErrorText, hubErrorKind,
' hubErrorText). Row models are plain assocarrays:
'   { kind: "row"|"header"|"info", id, label, detail, glyph, trailing,
'     enabled, checked, small }
' kind "row" is focusable; "header" and "info" are skipped by focus.
' trailing is "chevron", "check" or "none".

' ---- Constants ----

function ccTabIds() as Object
  return ["playback", "audio", "devices"]
end function

function ccTabLabels() as Object
  return ["Playback", "Audio & Subtitles", "Devices"]
end function

' Seek step used by the player's Left/Right and the Back/Forward rows.
function ccSeekDelta() as Integer
  return 10
end function

function ccIdleCloseMs() as Integer
  return 10000
end function

' The client gives up on a handoff this long after sending it.
function ccHandoffTimeoutMs() as Integer
  return 40000
end function

function ccFocusKey(tabId as String, rowId as String) as String
  return "cc:" + tabId + ":" + rowId
end function

' ---- Row builders ----

function ccRow(id as String, label as String, glyph as String, trailing as String, enabled as Boolean, detail as String) as Object
  return { kind: "row", id: id, label: label, detail: detail, glyph: glyph, trailing: trailing, enabled: enabled, checked: false, small: false }
end function

function ccHeader(id as String, label as String, detail as String) as Object
  return { kind: "header", id: id, label: label, detail: detail, glyph: "", trailing: "none", enabled: false, checked: false, small: false }
end function

' A disabled, unfocusable-looking explanatory row. Long text wraps in a
' smaller type size (small = true), so it stays a row in the same list.
function ccNote(id as String, label as String) as Object
  row = ccRow(id, label, "", "none", false, "")
  row.small = (Len(label) > 30)
  return row
end function

' ---- Playback tab ----

' state: { playing, hasNext, nextTitle, live, hasVersions, versionLabel, sleepEnabled, sleepLabel }
function ccPlaybackRows(state as Object) as Object
  rows = []
  playing = (aaGet(state, "playing", false) = true)
  live = (aaGet(state, "live", false) = true)
  delta = StrI(ccSeekDelta()).Trim()
  if playing
    rows.Push(ccRow("toggle", "Pause", "pause", "none", true, ""))
  else
    rows.Push(ccRow("toggle", "Play", "play", "none", true, ""))
  end if
  liveReason = ""
  if live then liveReason = "Live TV"
  rows.Push(ccRow("back", "Back " + delta + " seconds", "rewind", "none", not live, liveReason))
  rows.Push(ccRow("forward", "Forward " + delta + " seconds", "forward", "none", not live, liveReason))
  rows.Push(ccRow("restart", "Start over", "restart", "none", not live, liveReason))
  if aaGet(state, "hasNext", false) = true
    detail = asText(aaGet(state, "nextTitle", ""))
    rows.Push(ccRow("next", "Next episode", "forward", "chevron", true, detail))
  end if
  if not live and aaGet(state, "hasVersions", false) = true
    rows.Push(ccRow("versions", "Versions", "apps", "chevron", true, asText(aaGet(state, "versionLabel", ""))))
  end if
  if aaGet(state, "sleepEnabled", false) = true
    sleepDetail = asText(aaGet(state, "sleepLabel", "Off"))
    if sleepDetail = "" then sleepDetail = "Off"
    rows.Push(ccRow("sleep", "Sleep timer", "", "chevron", true, sleepDetail))
  end if
  return rows
end function

function ccSleepLabel(mode as String, remaining = 0 as Integer) as String
  if mode = "end" then return "End of episode"
  if remaining > 0
    mins = Int((remaining + 59) / 60)
    if mins <= 1 then return "1 min left"
    return StrI(mins).Trim() + " min left"
  end if
  if mode = "15" or mode = "30" or mode = "45" or mode = "60" then return mode + " min"
  return "Off"
end function

function ccSleepRows(currentMode as String, isSeries = false as Boolean) as Object
  rows = [ccHeader("hdr:sleep", "Sleep timer", "Stop playback automatically")]
  opts = [
    { id: "off", label: "Off", detail: "Do not stop automatically" }
    { id: "15", label: "15 minutes", detail: "" }
    { id: "30", label: "30 minutes", detail: "" }
    { id: "45", label: "45 minutes", detail: "" }
    { id: "60", label: "60 minutes", detail: "" }
  ]
  if isSeries then opts.Push({ id: "end", label: "End of episode", detail: "Stop when this episode finishes" })
  for each opt in opts
    chosen = (opt.id = currentMode)
    trailing = "none"
    if chosen then trailing = "check"
    row = ccRow("sleep:" + opt.id, opt.label, "", trailing, true, opt.detail)
    row.checked = chosen
    rows.Push(row)
  end for
  rows.Push(ccRow("sleep:back", "Back", "back", "none", true, ""))
  return rows
end function

' ---- Audio & Subtitles tab ----

' ISO 639 codes (2 and 3 letter) for the languages Roku streams usually carry.
function ccLanguageName(code as String) as String
  c = LCase(code.Trim())
  if c = "en" or c = "eng" then return "English"
  if c = "es" or c = "spa" then return "Spanish"
  if c = "fr" or c = "fra" or c = "fre" then return "French"
  if c = "de" or c = "deu" or c = "ger" then return "German"
  if c = "it" or c = "ita" then return "Italian"
  if c = "pt" or c = "por" then return "Portuguese"
  if c = "nl" or c = "nld" or c = "dut" then return "Dutch"
  if c = "sv" or c = "swe" then return "Swedish"
  if c = "da" or c = "dan" then return "Danish"
  if c = "no" or c = "nor" or c = "nb" or c = "nob" then return "Norwegian"
  if c = "fi" or c = "fin" then return "Finnish"
  if c = "pl" or c = "pol" then return "Polish"
  if c = "ru" or c = "rus" then return "Russian"
  if c = "tr" or c = "tur" then return "Turkish"
  if c = "ar" or c = "ara" then return "Arabic"
  if c = "he" or c = "heb" then return "Hebrew"
  if c = "hi" or c = "hin" then return "Hindi"
  if c = "ja" or c = "jpn" then return "Japanese"
  if c = "ko" or c = "kor" then return "Korean"
  if c = "zh" or c = "zho" or c = "chi" then return "Chinese"
  return ""
end function

' track: { id, name, language }. Prefers a descriptive name, falls back to
' the language, then to "Track N".
function ccTrackLabel(track as Object, index as Integer) as String
  name = asText(aaGet(track, "name", "")).Trim()
  language = asText(aaGet(track, "language", "")).Trim()
  langName = ccLanguageName(language)
  if langName = "" and language <> "" and LCase(language) <> "und" then langName = language
  lname = LCase(name)
  if lname = "und" or lname = "unknown" or lname = LCase(language) then name = ""
  if name <> "" and langName <> ""
    if Instr(1, lname, LCase(langName)) > 0 then return name
    return langName + " (" + name + ")"
  end if
  if name <> "" then return name
  if langName <> "" then return langName
  return "Track " + StrI(index + 1).Trim()
end function

' Roku availableAudioTracks entries use Track / Name / Language.
function ccNormalizeAudio(raw as Dynamic) as Object
  out = []
  if raw = invalid then return out
  for each t in raw
    id = asText(aaGet(t, "Track", ""))
    if id <> ""
      out.Push({ id: id, name: asText(aaGet(t, "Name", "")), language: asText(aaGet(t, "Language", "")) })
    end if
  end for
  return out
end function

' availableSubtitleTracks entries use TrackName / Description / Language.
function ccNormalizeSubs(raw as Dynamic) as Object
  out = []
  if raw = invalid then return out
  for each t in raw
    id = asText(aaGet(t, "TrackName", ""))
    if id <> ""
      out.Push({ id: id, name: asText(aaGet(t, "Description", "")), language: asText(aaGet(t, "Language", "")) })
    end if
  end for
  return out
end function

' Which subtitle entry is current on open. captionMode is the Video node's
' globalCaptionMode (the device's Settings choice): only "On" shows a track.
' Result: { off, id }.
function ccSubtitleCurrent(captionMode as String, currentTrack as String, tracks as Object) as Object
  if LCase(captionMode) <> "on" then return { off: true, id: "" }
  id = currentTrack
  if id = "" and tracks.Count() > 0 then id = tracks[0].id
  if id = "" then return { off: true, id: "" }
  return { off: false, id: id }
end function

' tracks: normalised audio tracks. currentId "" marks the first one.
function ccAudioRows(tracks as Object, currentId as String) as Object
  rows = [ccHeader("audio-head", "Audio", "")]
  if tracks.Count() = 0
    rows.Push(ccNote("audio-none", "No other audio tracks"))
    return rows
  end if
  current = currentId
  if current = "" then current = tracks[0].id
  i = 0
  for each t in tracks
    row = ccRow("audio:" + t.id, ccTrackLabel(t, i), "", "none", true, "")
    row.checked = (t.id = current)
    if row.checked then row.trailing = "check"
    rows.Push(row)
    i = i + 1
  end for
  return rows
end function

' subState: { off, id } from ccSubtitleCurrent.
function ccSubtitleRows(tracks as Object, subState as Object) as Object
  rows = [ccHeader("subs-head", "Subtitles", "")]
  if tracks.Count() = 0
    rows.Push(ccNote("subs-none", "No subtitles for this title"))
    return rows
  end if
  off = ccRow("sub:off", "Off", "", "none", true, "")
  off.checked = (aaGet(subState, "off", true) = true)
  if off.checked then off.trailing = "check"
  rows.Push(off)
  i = 0
  for each t in tracks
    row = ccRow("sub:" + t.id, ccTrackLabel(t, i), "", "none", true, "")
    row.checked = (aaGet(subState, "off", true) <> true and t.id = asText(aaGet(subState, "id", "")))
    if row.checked then row.trailing = "check"
    rows.Push(row)
    i = i + 1
  end for
  return rows
end function

function ccCaptionInfoRow() as Object
  return { kind: "info", id: "caption-style", label: "Caption style: Roku Settings " + Chr(8250) + " Accessibility", detail: "", glyph: "", trailing: "none", enabled: false, checked: false, small: true }
end function

' ---- Devices tab ("Continue on") ----

' Live TV is anything that is not a catalogue title.
function ccIsVod(mediaKind as String, mediaId as String) as Boolean
  if LCase(mediaKind) = "live" then return false
  if Left(mediaId, 5) = "live:" then return false
  return true
end function

' Devices that may appear: not this one, not revoked.
function ccVisibleDevices(devices as Object, currentId as String) as Object
  out = []
  if devices = invalid then return out
  for each d in devices
    id = asText(aaGet(d, "id", ""))
    state = asText(aaGet(d, "state", "unknown"))
    isThis = (aaGet(d, "isCurrent", false) = true) or (currentId <> "" and id = currentId)
    if not isThis and state <> "revoked" and id <> "" then out.Push(d)
  end for
  return out
end function

' Why a device row cannot be used right now ("" when it can).
function ccDeviceReason(device as Object) as String
  if not hubIsOnline(device) then return "Offline"
  if not hubHasCap(device, "play.title") then return "Can't play titles"
  return ""
end function

' ctx: { signedIn, fixture, live, status ("loading"|"ok"|"error"), errorText,
'        devices, currentId, handoff: { phase, deviceId, text } }
function ccDeviceRows(ctx as Object) as Object
  fixture = (aaGet(ctx, "fixture", false) = true)
  head = ""
  if fixture then head = "Demo data"
  rows = [ccHeader("devices-head", "Continue on", head)]
  if aaGet(ctx, "live", false) = true
    rows.Push(ccNote("live-na", "Continue on another device isn't available for Live TV yet"))
  else if aaGet(ctx, "signedIn", false) <> true
    rows.Push(ccNote("signin", "Sign in to TVM to continue on another device."))
  else
    status = asText(aaGet(ctx, "status", "loading"))
    if status = "loading"
      rows.Push(ccNote("loading", "Looking for your devices..."))
    else if status = "error"
      rows.Push(ccNote("error", asText(aaGet(ctx, "errorText", "TVM Hub could not load. Retry in a moment."))))
    else
      visible = ccVisibleDevices(aaGet(ctx, "devices", []), asText(aaGet(ctx, "currentId", "")))
      handoff = aaGet(ctx, "handoff", {})
      active = []
      inactive = []
      for each d in visible
        id = asText(aaGet(d, "id", ""))
        reason = ccDeviceReason(d)
        glyph = hubPlatformGlyph(asText(aaGet(d, "platform", "")))
        name = asText(aaGet(d, "name", "Device"))
        if reason = ""
          detail = ""
          if fixture then detail = "Demo"
          row = ccRow("dev:" + id, name, glyph, "chevron", true, detail)
          if asText(aaGet(handoff, "deviceId", "")) = id and asText(aaGet(handoff, "phase", "idle")) <> "idle"
            row.detail = asText(aaGet(handoff, "text", ""))
            row.trailing = "none"
            if asText(aaGet(handoff, "phase", "")) = "failed" then row.trailing = "chevron"
          end if
          active.Push(row)
        else
          inactive.Push(ccRow("dev:" + id, name, glyph, "none", false, reason))
        end if
      end for
      for each r in active
        rows.Push(r)
      end for
      for each r in inactive
        rows.Push(r)
      end for
      if visible.Count() = 0 then rows.Push(ccNote("none", "No other devices are linked yet."))
    end if
  end if
  rows.Push(ccRow("hub", "Open TVM Hub", "dots", "chevron", true, ""))
  return rows
end function

' ---- Handoff state machine ----
' phases: idle -> sending -> accepted -> applied, or -> failed. Applied is
' terminal. Statuses are monotonic: a late "pending" never undoes "accepted".
' Events: { kind: "start" } | { kind: "sendError", statusCode, error } |
'         { kind: "status", status, reason } | { kind: "pollError", statusCode } |
'         { kind: "timeout" }
' Result: { phase, text, final, changed }. final means stop polling.

function ccInFlight(phase as String) as Boolean
  return phase = "sending" or phase = "accepted"
end function

function ccHandoffStep(phase as String, ev as Object, name as String, fixture as Boolean) as Object
  res = { phase: phase, text: "", final: false, changed: false }
  if phase = "applied" then return res
  kind = asText(aaGet(ev, "kind", ""))
  if kind = "start"
    if ccInFlight(phase) then return res
    return { phase: "sending", text: hubCommandText("pending", ""), final: false, changed: true }
  end if
  if not ccInFlight(phase) then return res
  if kind = "sendError"
    text = hubSendErrorText(Int(hubNum(aaGet(ev, "statusCode", 0))), asText(aaGet(ev, "error", "")))
    return { phase: "failed", text: text, final: true, changed: true }
  end if
  if kind = "timeout"
    return { phase: "failed", text: hubCommandText("timed_out", ""), final: true, changed: true }
  end if
  if kind = "pollError"
    if Int(hubNum(aaGet(ev, "statusCode", 0))) = 404
      return { phase: "failed", text: hubCommandText("rejected", "not_found"), final: true, changed: true }
    end if
    return res
  end if
  if kind = "status"
    status = asText(aaGet(ev, "status", "pending"))
    if status = "applied"
      text = "Playing on " + name
      if fixture then text = "Demo: playing on " + name
      return { phase: "applied", text: text, final: true, changed: true }
    end if
    if status = "rejected" or status = "timed_out"
      return { phase: "failed", text: hubCommandText(status, asText(aaGet(ev, "reason", ""))), final: true, changed: true }
    end if
    if status = "accepted" and phase = "sending"
      return { phase: "accepted", text: hubCommandText("accepted", ""), final: false, changed: true }
    end if
  end if
  return res
end function

' Demo handoff: pending, accepted, then applied after about 1.5 s.
function ccFixtureStatus(elapsedMs as Integer) as String
  if elapsedMs >= 1500 then return "applied"
  if elapsedMs >= 500 then return "accepted"
  return "pending"
end function

' play.title command body for the target. positionSec is floored.
function ccHandoffBody(idempotencyKey as String, target as String, mediaId as String, positionSec as Float) as String
  secs = Int(positionSec)
  if secs < 0 then secs = 0
  return hubCommandBody(idempotencyKey, target, "play.title", { mediaId: mediaId, positionSec: secs }, 30)
end function

' ---- Focus, scroll, auto-close ----

' Move focus through rows, skipping headers and info rows. Hard stops, no
' wrap. Result: { index, edge } where edge is "top" when Up leaves the list.
function ccMoveFocus(rows as Object, index as Integer, intent as String) as Object
  count = rows.Count()
  i = index
  if intent = "down"
    j = i + 1
    while j < count
      if aaGet(rows[j], "kind", "") = "row" then return { index: j, edge: "" }
      j = j + 1
    end while
    return { index: index, edge: "" }
  end if
  if intent = "up"
    j = i - 1
    while j >= 0
      if aaGet(rows[j], "kind", "") = "row" then return { index: j, edge: "" }
      j = j - 1
    end while
    return { index: index, edge: "top" }
  end if
  return { index: index, edge: "" }
end function

' First focusable row index, or -1.
function ccFirstFocusable(rows as Object) as Integer
  i = 0
  for each r in rows
    if aaGet(r, "kind", "") = "row" then return i
    i = i + 1
  end for
  return -1
end function

' Index of the row with this id, falling back to the first focusable row.
function ccIndexOfId(rows as Object, id as String) as Integer
  i = 0
  for each r in rows
    if aaGet(r, "id", "") = id and aaGet(r, "kind", "") = "row" then return i
    i = i + 1
  end for
  return ccFirstFocusable(rows)
end function

' Auto-close: after 10 s without input, unless a handoff is in flight.
function ccShouldAutoClose(idleMs as Integer, phase as String) as Boolean
  if ccInFlight(phase) then return false
  return idleMs >= ccIdleCloseMs()
end function
