sub init()
  m.top.focusable = true
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.account = m.top.findNode("account")
  m.premium = m.top.findNode("premium")
  m.paste = m.top.findNode("paste")
  m.back = m.top.findNode("back")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.account.font = tvmFontBodyLg()
  m.premium.font = tvmFontBody()
  m.paste.variant = "primary"
  m.paste.label = "Paste token"
  m.back.variant = "glass"
  m.back.label = "Back"
  m.col = 0
  m.seq = 0
  paintFocus()
end sub

sub onStatus()
  status = m.top.status
  configured = aaGet(status, "configured", false) = true
  username = asText(aaGet(status, "username", ""))
  if configured and username <> ""
    m.account.text = "Signed in as " + username
  else if configured
    m.account.text = "Token stored on this computer"
  else
    m.account.text = "Not connected"
  end if
  if aaGet(status, "premium", false) = true
    m.premium.text = "Premium"
  else if configured
    m.premium.text = "Free account — some streams need Premium"
  else
    m.premium.text = "Paste a token from real-debrid.com/apitoken"
  end if
  err = asText(aaGet(status, "error", ""))
  if err <> "" then m.premium.text = err
end sub

sub paintFocus()
  m.paste.hasFocusStyle = (m.col = 0)
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
  if intent = "left" and m.col > 0 then m.col = 0
  if intent = "right" and m.col < 1 then m.col = 1
  if intent = "select"
    if m.col = 0 then emit("paste") else emit("back")
  end if
  paintFocus()
  return true
end function
