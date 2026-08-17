sub init()
  m.top.focusable = true
  m.account = m.top.findNode("account")
  m.premium = m.top.findNode("premium")
  m.manage = m.top.findNode("manage")
  m.back = m.top.findNode("back")
  m.seq = 0
  m.col = 0
  m.manage.variant = "primary"
  m.manage.label = "Manage Real-Debrid"
  m.back.variant = "glass"
  m.back.label = "Back"
  paintFocus()
end sub

sub onRd()
  rd = m.top.rd
  username = asText(aaGet(rd, "username", ""))
  configured = aaGet(rd, "configured", false)
  if username <> ""
    m.account.text = "Real-Debrid  ·  " + username
  else if configured = true
    m.account.text = "Real-Debrid  ·  Connected"
  else
    m.account.text = "Real-Debrid  ·  Not connected"
  end if
  if aaGet(rd, "premium", false) = true
    m.premium.text = "Premium  ·  Active"
  else
    m.premium.text = "Premium  ·  No"
  end if
end sub

sub paintFocus()
  m.manage.hasFocusStyle = (m.col = 0)
  m.back.hasFocusStyle = (m.col = 1)
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
    if m.col = 0 then emit("realdebrid") else emit("back")
    return true
  end if
  return true
end function
