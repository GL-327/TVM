sub init()
  m.top.focusable = true
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.account = m.top.findNode("account")
  m.premium = m.top.findNode("premium")
  m.paste = m.top.findNode("paste")
  m.back = m.top.findNode("back")
  m.overrideBtn = m.top.findNode("overrideBtn")
  m.removeBtn = m.top.findNode("removeBtn")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.account.font = tvmFontBodyLg()
  m.premium.font = tvmFontBody()
  m.paste.variant = "glassPill"
  m.paste.pillWidth = 540
  m.paste.accent = true
  m.paste.label = "Paste token"
  m.back.variant = "glassPill"
  m.back.pillWidth = 540
  m.back.label = "Back"
  m.overrideBtn.variant = "glassPill"
  m.overrideBtn.pillWidth = 540
  m.overrideBtn.quiet = true
  m.overrideBtn.label = "Use my own key"
  m.removeBtn.variant = "glassPill"
  m.removeBtn.pillWidth = 540
  m.removeBtn.quiet = true
  m.removeBtn.label = "Remove my key"
  m.buttons = [m.paste, m.back]
  m.col = 0
  m.seq = 0
  paintFocus()
end sub

sub onFirstLoad()
  if m.back = invalid then return
  if m.top.firstLoad = true
    m.back.label = "Skip for now"
  else
    m.back.label = "Back"
  end if
end sub

sub onStatus()
  status = m.top.status
  configured = aaGet(status, "configured", false) = true
  ownKey = aaGet(status, "ownKey", false) = true or aaGet(status, "source", "") = "device"
  username = asText(aaGet(status, "username", ""))
  err = asText(aaGet(status, "error", ""))

  if configured and not ownKey
    m.account.text = "Connected through your TVM account"
    m.lede.text = "Your TVM account already includes Real-Debrid access. You do not need to enter a key."
    if aaGet(status, "premium", false) = true
      m.premium.text = "Premium"
    else
      m.premium.text = "Active"
    end if
    m.paste.visible = false
    m.back.translation = [1120, 1240]
    m.back.accent = true
    m.overrideBtn.visible = true
    m.overrideBtn.translation = [1120, 1416]
    m.removeBtn.visible = false
    m.buttons = [m.back, m.overrideBtn]
    m.col = 0
  else if configured and ownKey
    if username <> ""
      m.account.text = "Signed in as " + username
    else
      m.account.text = "Connected with your own key"
    end if
    m.lede.text = "Each person uses their own Real-Debrid account. Paste a key from real-debrid.com/apitoken to update yours."
    if aaGet(status, "premium", false) = true
      m.premium.text = "Premium"
    else
      m.premium.text = "Free account — some streams need Premium"
    end if
    m.paste.visible = true
    m.paste.label = "Change my key"
    m.paste.translation = [1120, 1240]
    m.paste.accent = true
    m.back.translation = [1700, 1240]
    m.back.accent = false
    m.overrideBtn.visible = false
    m.removeBtn.visible = true
    m.removeBtn.translation = [1120, 1416]
    m.buttons = [m.paste, m.back, m.removeBtn]
    if m.col >= m.buttons.Count() then m.col = 0
  else
    m.account.text = "Not connected"
    m.lede.text = "Each person uses their own Real-Debrid account. Paste a key from real-debrid.com/apitoken to stream cached titles and your cloud library."
    m.premium.text = "Get an API key at real-debrid.com/apitoken"
    m.paste.visible = true
    m.paste.label = "Paste token"
    m.paste.translation = [1120, 1240]
    m.paste.accent = true
    m.back.translation = [1700, 1240]
    m.back.accent = false
    m.overrideBtn.visible = false
    m.removeBtn.visible = false
    m.buttons = [m.paste, m.back]
    if m.col >= m.buttons.Count() then m.col = 0
  end if
  if err <> ""
    if err = "needs-auth"
      m.premium.text = "Real-Debrid rejected that key. Try another or contact the owner."
    else if err = "unreachable"
      m.premium.text = "Real-Debrid could not be reached right now."
    else
      m.premium.text = err
    end if
  end if
  paintFocus()
end sub

sub paintFocus()
  for i = 0 to m.buttons.Count() - 1
    m.buttons[i].hasFocusStyle = (i = m.col)
  end for
  if not m.paste.visible then m.paste.hasFocusStyle = false
  if not m.overrideBtn.visible then m.overrideBtn.hasFocusStyle = false
  if not m.removeBtn.visible then m.removeBtn.hasFocusStyle = false
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
  if (intent = "left" or intent = "up") and m.col > 0 then m.col = m.col - 1
  if (intent = "right" or intent = "down") and m.col < m.buttons.Count() - 1 then m.col = m.col + 1
  if intent = "select" and m.col >= 0 and m.col < m.buttons.Count()
    btn = m.buttons[m.col]
    if btn.id = "paste" or btn.id = "overrideBtn"
      emit("paste")
    else if btn.id = "removeBtn"
      emit("clearRd")
    else
      emit("back")
    end if
  end if
  paintFocus()
  return true
end function

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
