sub init()
  m.top.focusable = true
  m.card = m.top.findNode("card")
  m.brandLabel = m.top.findNode("brandLabel")
  m.headingLabel = m.top.findNode("headingLabel")
  m.ledeLabel = m.top.findNode("ledeLabel")
  m.statusLabel = m.top.findNode("statusLabel")
  m.name = m.top.findNode("name")
  m.codeSignIn = m.top.findNode("codeSignIn")
  m.email = m.top.findNode("email")
  m.password = m.top.findNode("password")
  m.submit = m.top.findNode("submit")
  m.switchMode = m.top.findNode("switchMode")
  m.recheck = m.top.findNode("recheck")
  m.signout = m.top.findNode("signout")
  m.agree = m.top.findNode("agree")
  m.emailCode = m.top.findNode("emailCode")
  m.resendCode = m.top.findNode("resendCode")
  m.seq = 0
  m.col = 0

  m.brandLabel.font = tvmFontCaption()
  m.headingLabel.font = tvmFontTitle()
  m.ledeLabel.font = tvmFontSecondary()
  m.statusLabel.font = tvmFontMeta()

  for each btn in [m.codeSignIn, m.name, m.email, m.password, m.submit, m.switchMode, m.recheck, m.signout, m.agree, m.emailCode, m.resendCode]
    btn.variant = "glassPill"
    btn.pillWidth = 1520
  end for

  m.codeSignIn.label = "Sign in with a code"
  m.codeSignIn.itemId = "codeSignIn"
  m.name.label = "Your name"
  m.name.itemId = "name"
  m.email.label = "Email"
  m.email.itemId = "email"
  m.password.label = "Password"
  m.password.itemId = "password"
  m.submit.label = "Sign in"
  m.submit.accent = true
  m.submit.itemId = "submit"
  m.switchMode.label = "I need an account"
  m.switchMode.itemId = "switch"
  m.recheck.label = "Check again"
  m.recheck.accent = true
  m.recheck.itemId = "recheck"
  m.signout.label = "Sign out"
  m.signout.itemId = "signout"
  m.agree.label = "I have read and agree"
  m.agree.accent = true
  m.agree.itemId = "agree"
  m.emailCode.label = "Enter the code"
  m.emailCode.accent = true
  m.emailCode.itemId = "emailCode"
  m.resendCode.label = "Send a new code"
  m.resendCode.itemId = "resendCode"
  paint()
end sub

sub onHeading()
  m.headingLabel.text = m.top.heading
end sub

sub onLede()
  m.ledeLabel.text = m.top.lede
end sub

sub onStatus()
  m.statusLabel.text = m.top.status
end sub

sub onEmailDetail()
  detail = m.top.emailDetail
  if detail <> invalid and detail <> ""
    m.email.label = detail
  else
    m.email.label = "Email"
  end if
end sub

sub onSignedAs()
  paint()
end sub

sub onPhase()
  m.col = 0
  paint()
end sub

function formButtons() as Object
  phase = m.top.phase
  buttons = []
  if phase = "register" then buttons.Push(m.name)
  if phase = "signin" then buttons.Push(m.codeSignIn)
  if phase = "signin" or phase = "register"
    buttons.Push(m.email)
    buttons.Push(m.password)
    buttons.Push(m.submit)
    buttons.Push(m.switchMode)
  else if phase = "verify"
    buttons.Push(m.emailCode)
    buttons.Push(m.resendCode)
    buttons.Push(m.signout)
  else if phase = "waiting" or phase = "suspended"
    buttons.Push(m.recheck)
    buttons.Push(m.signout)
  else if phase = "terms"
    buttons.Push(m.agree)
    buttons.Push(m.signout)
  end if
  return buttons
end function

sub paint()
  phase = m.top.phase
  signin = (phase = "signin" or phase = "register")
  m.name.visible = (phase = "register")
  m.codeSignIn.visible = (phase = "signin")
  m.email.visible = signin
  m.password.visible = signin
  m.submit.visible = signin
  m.switchMode.visible = signin
  m.recheck.visible = (phase = "waiting" or phase = "suspended")
  m.agree.visible = (phase = "terms")
  m.emailCode.visible = (phase = "verify")
  m.resendCode.visible = (phase = "verify")
  m.signout.visible = (phase = "waiting" or phase = "suspended" or phase = "terms" or phase = "verify")
  if phase = "register"
    m.submit.label = "Create account"
    m.switchMode.label = "I already have an account"
  else
    m.submit.label = "Sign in"
    m.switchMode.label = "I need an account"
  end if
  signed = m.top.signedAs
  if signed <> invalid and signed <> ""
    m.recheck.label = "Check again · " + signed
  else
    m.recheck.label = "Check again"
  end if
  buttons = formButtons()
  headerH = 510
  stepH = 164
  cardW = 1760
  cardH = headerH + (buttons.Count() * stepH) + 72
  if cardH < 720 then cardH = 720
  cardX = Int((3840 - cardW) / 2)
  cardY = Int((2160 - cardH) / 2)
  innerX = cardX + 120
  if m.card <> invalid
    m.card.width = cardW
    m.card.height = cardH
    m.card.translation = [cardX, cardY]
  end if
  m.brandLabel.translation = [innerX, cardY + 72]
  m.headingLabel.translation = [innerX, cardY + 148]
  m.ledeLabel.translation = [innerX, cardY + 268]
  m.statusLabel.translation = [innerX, cardY + 412]

  i = 0
  while i < buttons.Count()
    buttons[i].translation = [innerX, cardY + headerH + (i * stepH)]
    i = i + 1
  end while

  if m.col < 0 then m.col = 0
  if buttons.Count() > 0 and m.col > buttons.Count() - 1 then m.col = buttons.Count() - 1
  for each btn in [m.name, m.codeSignIn, m.email, m.password, m.submit, m.switchMode, m.recheck, m.signout, m.agree, m.emailCode, m.resendCode]
    btn.hasFocusStyle = false
  end for
  if buttons.Count() = 0
    m.top.focusKey = ""
    return
  end if
  focused = buttons[m.col]
  focused.hasFocusStyle = true
  m.top.focusKey = focused.itemId
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
  buttons = formButtons()
  if buttons.Count() = 0 then return true
  if intent = "down"
    if m.col < buttons.Count() - 1 then m.col = m.col + 1
    paint()
    return true
  end if
  if intent = "up"
    if m.col > 0 then m.col = m.col - 1
    paint()
    return true
  end if
  if intent = "select" or intent = "left" or intent = "right"
    if intent = "select"
      id = buttons[m.col].itemId
      if id = "codeSignIn" then emit("codeSignIn")
      if id = "name" then emit("editName")
      if id = "email" then emit("editEmail")
      if id = "password" then emit("editPassword")
      if id = "submit" then emit("submit")
      if id = "switch" then emit("switchMode")
      if id = "recheck" then emit("recheck")
      if id = "signout" then emit("signout")
      if id = "agree" then emit("agree")
      if id = "emailCode" then emit("editEmailCode")
      if id = "resendCode" then emit("resendCode")
    end if
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
