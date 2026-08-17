sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.confirm = m.top.findNode("confirm")
  m.cancel = m.top.findNode("cancel")
  m.seq = 0
  m.col = 0
  m.confirm.variant = "primary"
  m.confirm.label = "OK"
  m.cancel.variant = "glass"
  m.cancel.label = "Cancel"
  paintFocus()
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

sub onBody()
  m.lede.text = m.top.body
end sub

sub onConfirmLabel()
  label = m.top.confirmLabel
  if label = invalid or label = "" then label = "OK"
  m.confirm.label = label
end sub

sub paintFocus()
  m.confirm.hasFocusStyle = (m.col = 0)
  m.cancel.hasFocusStyle = (m.col = 1)
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq, confirmId: m.top.confirmId }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back"
    emit("cancel")
    return true
  end if
  if intent = "left" and m.col > 0
    m.col = m.col - 1
    paintFocus()
    return true
  end if
  if intent = "right" and m.col < 1
    m.col = m.col + 1
    paintFocus()
    return true
  end if
  if intent = "select"
    if m.col = 0 then emit("confirm") else emit("cancel")
    return true
  end if
  return true
end function
