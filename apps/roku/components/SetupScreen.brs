sub init()
  m.top.focusable = true
  m.lede = m.top.findNode("lede")
  m.status = m.top.findNode("status")
  m.enter = m.top.findNode("enter")
  m.seq = 0
  m.lede.text = "This Roku channel is a TV client. It talks to TVM Core on your computer over the local network. Enter that computer's LAN address and port, then use the remote to connect."
  m.enter.variant = "primary"
  m.enter.label = "Enter Core URL"
  m.enter.itemId = "enter"
  m.enter.hasFocusStyle = true
  m.top.focusKey = "enter"
end sub

sub onMessage()
  m.status.text = m.top.message
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "select" or intent = "down" or intent = "up" or intent = "left" or intent = "right"
    if intent = "select" then emit("editUrl")
    return true
  end if
  return true
end function
