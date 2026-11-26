' Remote input is normalised into intents before it reaches any screen.
' Screens must not read raw Roku key names except through this map.

function intentFromKey(key as String) as String
  if m.global <> invalid
    if m.global.hasField("inputSerial") then m.global.inputSerial = m.global.inputSerial + 1
  end if
  if key = "up" then return "up"
  if key = "down" then return "down"
  if key = "left" then return "left"
  if key = "right" then return "right"
  if key = "OK" then return "select"
  if key = "select" then return "select"
  if key = "back" then return "back"
  if key = "play" then return "play"
  if key = "pause" then return "pause"
  if key = "playonly" then return "play"
  if key = "stop" then return "stop"
  if key = "replay" then return "previous"
  if key = "rewind" then return "rewind"
  if key = "fastforward" then return "fastForward"
  if key = "info" then return "info"
  if key = "options" then return "info"
  return ""
end function

' The inverse of intentFromKey for the intents a remote controller can send.
function keyFromIntent(intent as String) as String
  if intent = "up" then return "up"
  if intent = "down" then return "down"
  if intent = "left" then return "left"
  if intent = "right" then return "right"
  if intent = "select" then return "OK"
  if intent = "back" then return "back"
  if intent = "previous" then return "replay"
  if intent = "rewind" then return "rewind"
  if intent = "fastForward" then return "fastforward"
  if intent = "play" then return "play"
  if intent = "pause" then return "pause"
  if intent = "stop" then return "stop"
  if intent = "info" then return "info"
  return ""
end function

function isDirectional(intent as String) as Boolean
  return intent = "up" or intent = "down" or intent = "left" or intent = "right"
end function

function typedCharFromKey(key as String) as String
  if key = invalid or key = "" then return ""
  raw = key
  lower = LCase(raw)
  if lower = " " or lower = "space" then return " "
  if Left(lower, 4) = "lit_" then raw = Mid(raw, 5)
  if Len(raw) <> 1 then return ""
  ch = LCase(raw)
  code = Asc(ch)
  if code >= 97 and code <= 122 then return ch
  if code >= 48 and code <= 57 then return ch
  if Instr(1, ".-_/:?&=%+#@", ch) > 0 then return ch
  return ""
end function
