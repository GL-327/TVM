sub init()
  m.top.focusable = true
  m.headingLabel = m.top.findNode("headingLabel")
  m.ledeLabel = m.top.findNode("ledeLabel")
  m.statusLabel = m.top.findNode("statusLabel")
  m.name = m.top.findNode("name")
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
  m.name.variant = "row"
  m.name.label = "Your name"
  m.name.itemId = "name"
  m.email.variant = "row"
  m.email.label = "Email"
  m.email.itemId = "email"
  m.password.variant = "row"
  m.password.label = "Password"
  m.password.itemId = "password"
  m.submit.variant = "primary"
  m.submit.label = "Sign in"
  m.submit.itemId = "submit"
  m.switchMode.variant = "row"
  m.switchMode.label = "I need an account"
  m.switchMode.itemId = "switch"
  m.recheck.variant = "primary"
  m.recheck.label = "Check again"
  m.recheck.itemId = "recheck"
  m.signout.variant = "row"
  m.signout.label = "Sign out"
  m.signout.itemId = "signout"
  m.agree.variant = "primary"
  m.agree.label = "I have read and agree"
  m.agree.itemId = "agree"
  m.emailCode.variant = "primary"
  m.emailCode.label = "Enter the code"
  m.emailCode.itemId = "emailCode"
  m.resendCode.variant = "row"
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
  m.email.detail = m.top.emailDetail
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
  m.password.detail = "At least 10 characters"
  signed = m.top.signedAs
  if signed <> invalid and signed <> "" then m.recheck.detail = signed
  buttons = formButtons()
  if m.col < 0 then m.col = 0
  if buttons.Count() > 0 and m.col > buttons.Count() - 1 then m.col = buttons.Count() - 1
  m.name.hasFocusStyle = false
  m.email.hasFocusStyle = false
  m.password.hasFocusStyle = false
  m.submit.hasFocusStyle = false
  m.switchMode.hasFocusStyle = false
  m.recheck.hasFocusStyle = false
  m.signout.hasFocusStyle = false
  m.agree.hasFocusStyle = false
  m.emailCode.hasFocusStyle = false
  m.resendCode.hasFocusStyle = false
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
  if key = "options" or key = "info"
    if m.secretTaps = invalid then m.secretTaps = 0
    m.secretTaps = m.secretTaps + 1
    if m.secretTaps >= 7
      m.secretTaps = 0
      emit("ownerDoor")
    end if
    return true
  end if
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
