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

sub onButtonLabel()
  if m.top.buttonLabel <> "" then m.close.label = m.top.buttonLabel
end sub

' Patch notes: a taller card with room for the title, highlights, changes and known issues.
sub onTall()
  if not m.top.tall then return
  card = m.top.findNode("card")
  card.translation = [940, 260] : card.height = 1640
  m.heading.translation = [1060, 340]
  m.lede.translation = [1060, 500] : m.lede.maxLines = 16 : m.lede.height = 1100
  m.close.translation = [1060, 1660]
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

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
