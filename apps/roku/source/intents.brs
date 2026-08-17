' Remote input is normalised into intents before it reaches any screen.
' Screens must not read raw Roku key names except through this map.

function intentFromKey(key as String) as String
  if key = "up" then return "up"
  if key = "down" then return "down"
  if key = "left" then return "left"
  if key = "right" then return "right"
  if key = "OK" then return "select"
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

function isDirectional(intent as String) as Boolean
  return intent = "up" or intent = "down" or intent = "left" or intent = "right"
end function
