sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.close = m.top.findNode("close")
  m.seq = 0
  m.close.variant = "primary"
  m.close.label = "Close"
  m.close.itemId = "close"
  m.close.hasFocusStyle = true
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

sub onBody()
  m.lede.text = m.top.body
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back" then return false
  if intent = "select"
    emit("close")
    return true
  end if
  return true
end function
