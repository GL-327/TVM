sub init()
  m.top.focusable = true
  m.lede = m.top.findNode("lede")
  m.status = m.top.findNode("status")
  m.enter = m.top.findNode("enter")
  m.token = m.top.findNode("token")
  m.seq = 0
  m.col = 0
  m.lede.text = "Connect to TVM on your computer. Enter its LAN address and port, then the TVM_LAN_TOKEN created on that PC (32 or more characters). Both devices must be on the same private network."
  m.enter.variant = "primary"
  m.enter.label = "Enter Core URL"
  m.enter.itemId = "enter"
  m.token.variant = "row"
  m.token.label = "Enter access token"
  m.token.itemId = "token"
  paintFocus()
end sub

sub onMessage()
  m.status.text = m.top.message
end sub

sub onCoreUrl()
  url = m.top.coreUrl
  if isValidCoreUrl(url)
    m.enter.detail = url
    m.token.detail = "Same value as TVM_LAN_TOKEN on the PC"
    if m.col = 0 then m.col = 1
  else
    m.enter.detail = "http://YOUR-PC-LAN-IP:7345"
    m.token.detail = "Enter the Core URL first"
    m.col = 0
  end if
  paintFocus()
end sub

sub paintFocus()
  if m.col < 0 then m.col = 0
  if m.col > 1 then m.col = 1
  m.enter.hasFocusStyle = (m.col = 0)
  m.token.hasFocusStyle = (m.col = 1)
  if m.col = 1
    m.top.focusKey = "token"
  else
    m.top.focusKey = "enter"
  end if
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
  if intent = "down" and m.col = 0
    m.col = 1
    paintFocus()
    return true
  end if
  if intent = "up" and m.col = 1
    m.col = 0
    paintFocus()
    return true
  end if
  if intent = "select" or intent = "left" or intent = "right"
    if intent = "select"
      if m.col = 1 then emit("editToken") else emit("editUrl")
    end if
    return true
  end if
  return true
end function
