sub init()
  m.top.focusable = true
  m.kickerLabel = m.top.findNode("kickerLabel")
  m.headingLabel = m.top.findNode("headingLabel")
  m.lede = m.top.findNode("lede")
  m.back = m.top.findNode("back")
  m.seq = 0
  m.back.variant = "primary"
  m.back.label = "Back"
  m.back.hasFocusStyle = true
end sub

sub onKicker()
  m.kickerLabel.text = m.top.kicker
end sub

sub onHeading()
  m.headingLabel.text = m.top.heading
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
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home")
    return true
  end if
  if intent = "select"
    emit("back")
    return true
  end if
  return true
end function
