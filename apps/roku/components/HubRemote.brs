' Compact remote for another TVM device. This Roku's own keys become Hub
' commands: arrows send nav.dpad, OK nav.select, Options (*) nav.back,
' Play/Pause pause or resume, Rewind / Fast forward skip 10 s. Back closes
' the panel. The host sends the command and reports its progress through
' `status`, so the panel only says what happened (Sending, Done, a reason).
' A target without the capability shows "not supported" and nothing is sent.
sub init()
  m.top.focusable = true
  m.title = m.top.findNode("title")
  m.subtitle = m.top.findNode("subtitle")
  m.hints = m.top.findNode("hints")
  m.statusLabel = m.top.findNode("statusLabel")
  m.flash = m.top.findNode("flash")
  m.seq = 0
  m.lit = ""
  m.keys = {
    up: m.top.findNode("keyUp")
    down: m.top.findNode("keyDown")
    left: m.top.findNode("keyLeft")
    right: m.top.findNode("keyRight")
    select: m.top.findNode("keySelect")
  }
  m.title.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  m.title.color = tvmText()
  m.subtitle.font = tvmFontMeta()
  m.hints.font = tvmFontMeta()
  m.statusLabel.font = tvmFontSecondary()
  labelFont = tvmFont("bold", tvmTypeSize(tvmTypeSecondary()))
  for each id in ["lblUp", "lblDown", "lblLeft", "lblRight", "lblSelect"]
    node = m.top.findNode(id)
    node.font = labelFont
    node.color = tvmText()
  end for
  m.hints.text = "Arrows and OK control the other device." + Chr(10) + "Options (*): Back on that device." + Chr(10) + "Play or Pause, Rewind, Fast forward: transport." + Chr(10) + "Back: close this remote."
  m.flash.observeField("fire", "onFlashEnd")
  paint()
end sub

sub paint()
  if m.title = invalid then return
  device = m.top.device
  if device = invalid then device = {}
  m.title.text = "Remote"
  line = asText(aaGet(device, "name", "Device"))
  state = asText(aaGet(device, "state", ""))
  if state <> "" then line = line + " · " + hubStateLabel(state)
  m.subtitle.text = line
  paintKeys()
end sub

sub onStatus()
  if m.statusLabel = invalid then return
  m.statusLabel.text = m.top.status
end sub

sub paintKeys()
  for each id in m.keys
    node = m.keys[id]
    if id = m.lit
      node.color = tvmGlassTintFocused()
    else if id = "select"
      node.color = "0xFFFFFF4D"
    else
      node.color = tvmGlassTint()
    end if
  end for
end sub

sub onFlashEnd()
  m.lit = ""
  paintKeys()
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq }
  for each key in extra
    action[key] = extra[key]
  end for
  m.top.action = action
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back" or intent = "stop"
    emit("close", {})
    return true
  end if
  device = m.top.device
  if device = invalid then device = {}
  cmd = hubRemoteCommand(intent, device)
  if cmd.reason = "ignored" then return true
  if not cmd.ok
    m.statusLabel.text = cmd.label + ": not supported by this device"
    return true
  end if
  if m.keys.DoesExist(intent)
    m.lit = intent
    paintKeys()
    m.flash.control = "stop"
    m.flash.control = "start"
  end if
  m.statusLabel.text = cmd.label + "..."
  emit("send", { command: cmd.action, payload: cmd.payload, label: cmd.label })
  return true
end function
