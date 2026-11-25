' Account gate for 10-foot TV: Screen T1 (QR code + short URL + 8-char code)
' and Screen T3 one-field-per-step email/password fallback, plus waiting, paused,
' email verify, terms acceptance, and plain-language Privacy & terms reader.

sub init()
  m.top.focusable = true
  m.card = m.top.findNode("card")
  m.lockup = m.top.findNode("lockup")
  m.phoneGroup = m.top.findNode("phoneGroup")
  m.cardGroup = m.top.findNode("cardGroup")

  m.phoneHeading = m.top.findNode("phoneHeading")
  m.phoneLead = m.top.findNode("phoneLead")
  m.qrCode = m.top.findNode("qrCode")
  m.qrLoading = m.top.findNode("qrLoading")
  m.qrLoadingLabel = m.top.findNode("qrLoadingLabel")
  m.urlCaption = m.top.findNode("urlCaption")
  m.codeLabel = m.top.findNode("codeLabel")
  m.pollSpinner = m.top.findNode("pollSpinner")
  m.pollDot = m.top.findNode("pollDot")
  m.pollLabel = m.top.findNode("pollLabel")
  m.phoneRightTitle = m.top.findNode("phoneRightTitle")
  m.phoneRightBody = m.top.findNode("phoneRightBody")
  m.btnUseForm = m.top.findNode("btnUseForm")
  m.btnNewCode = m.top.findNode("btnNewCode")
  m.btnPhonePrivacy = m.top.findNode("btnPhonePrivacy")
  m.phoneError = m.top.findNode("phoneError")

  m.kickerLabel = m.top.findNode("kickerLabel")
  m.headingLabel = m.top.findNode("headingLabel")
  m.ledeLabel = m.top.findNode("ledeLabel")
  m.emailChipRow = m.top.findNode("emailChipRow")
  m.emailChipGlass = m.top.findNode("emailChipGlass")
  m.emailChipText = m.top.findNode("emailChipText")
  m.btnChipChange = m.top.findNode("btnChipChange")

  m.wellGroup = m.top.findNode("wellGroup")
  m.wellCaption = m.top.findNode("wellCaption")
  m.wellGlass = m.top.findNode("wellGlass")
  m.wellRing = m.top.findNode("wellRing")
  m.wellValue = m.top.findNode("wellValue")
  m.wellHint = m.top.findNode("wellHint")
  m.wellHelper = m.top.findNode("wellHelper")
  m.wellError = m.top.findNode("wellError")

  m.checkGroup = m.top.findNode("checkGroup")
  m.checkGlass = m.top.findNode("checkGlass")
  m.checkRing = m.top.findNode("checkRing")
  m.checkBox = m.top.findNode("checkBox")
  m.checkMark = m.top.findNode("checkMark")
  m.checkLabel = m.top.findNode("checkLabel")
  m.checkError = m.top.findNode("checkError")

  m.statusPillRow = m.top.findNode("statusPillRow")
  m.statusPillGlass = m.top.findNode("statusPillGlass")
  m.statusDot = m.top.findNode("statusDot")
  m.statusPillText = m.top.findNode("statusPillText")

  m.readerGroup = m.top.findNode("readerGroup")
  m.readerGlass = m.top.findNode("readerGlass")
  m.readerBody = m.top.findNode("readerBody")
  m.readerPageLabel = m.top.findNode("readerPageLabel")

  m.bannerLabel = m.top.findNode("bannerLabel")
  m.subNoteLabel = m.top.findNode("subNoteLabel")

  m.btnPrimary = m.top.findNode("btnPrimary")
  m.btnShowPass = m.top.findNode("btnShowPass")
  m.btnForgot = m.top.findNode("btnForgot")
  m.btnPrevPage = m.top.findNode("btnPrevPage")
  m.btnNextPage = m.top.findNode("btnNextPage")
  m.btnSecondary1 = m.top.findNode("btnSecondary1")
  m.btnSecondary2 = m.top.findNode("btnSecondary2")
  m.btnLink = m.top.findNode("btnLink")
  m.spinnerTimer = m.top.findNode("spinnerTimer")

  m.row = 0
  m.col = 0
  m.seq = 0
  m.pageIndex = 0
  m.lastPhase = ""
  m.forgotNoteVisible = false
  m.spinDeg = 0
  m.termsPages = []

  styleText()
  if m.spinnerTimer <> invalid then m.spinnerTimer.observeField("fire", "onSpinnerTick")
  m.top.observeField("visible", "onVisibleChange")
  if m.global <> invalid and m.global.hasField("reduceMotion")
    m.global.observeField("reduceMotion", "syncSpinner")
  end if
  paint()
end sub

sub styleText()
  m.phoneHeading.font = tvmFontScreenTitle()
  m.phoneHeading.color = tvmText()
  m.phoneLead.font = tvmFontSecondary()
  m.phoneLead.color = tvmMuted()
  m.qrLoadingLabel.font = tvmFontMeta()
  m.qrLoadingLabel.color = tvmMuted()
  m.urlCaption.font = tvmFontSecondary()
  m.urlCaption.color = tvmMuted()
  m.codeLabel.font = tvmFontDisplay()
  m.codeLabel.color = tvmGlassInk()
  m.pollLabel.font = tvmFontSecondary()
  m.pollLabel.color = tvmMuted()
  m.phoneRightTitle.font = tvmFontLabel()
  m.phoneRightTitle.color = tvmText()
  m.phoneRightBody.font = tvmFontSecondary()
  m.phoneRightBody.color = tvmMuted()
  m.phoneError.font = tvmFontMeta()
  m.phoneError.color = tvmDanger()

  m.kickerLabel.font = tvmFontMeta()
  m.kickerLabel.color = tvmMuted()
  m.headingLabel.font = tvmFontScreenTitle()
  m.headingLabel.color = tvmText()
  m.ledeLabel.font = tvmFontSecondary()
  m.ledeLabel.color = tvmMuted()
  m.emailChipText.font = tvmFontSecondary()
  m.emailChipText.color = tvmText()

  m.wellCaption.font = tvmFontMeta()
  m.wellCaption.color = tvmMuted()
  m.wellValue.font = tvmFontLabel()
  m.wellValue.color = tvmText()
  m.wellHint.font = tvmFontMeta()
  m.wellHint.color = tvmFaint()
  m.wellHelper.font = tvmFontMeta()
  m.wellHelper.color = tvmMuted()
  m.wellError.font = tvmFontMeta()
  m.wellError.color = tvmDanger()

  m.checkMark.font = tvmFontLabel()
  m.checkMark.color = "0xFFFFFFFF"
  m.checkLabel.font = tvmFontLabel()
  m.checkLabel.color = tvmText()
  m.checkError.font = tvmFontMeta()
  m.checkError.color = tvmDanger()

  m.statusPillText.font = tvmFontSecondary()
  m.statusPillText.color = tvmText()

  m.readerBody.font = tvmFontSecondary()
  m.readerBody.color = tvmText()
  m.readerPageLabel.font = tvmFontMeta()
  m.readerPageLabel.color = tvmMuted()

  m.bannerLabel.font = tvmFontMeta()
  m.bannerLabel.color = tvmDanger()
  m.subNoteLabel.font = tvmFontMeta()
  m.subNoteLabel.color = tvmMuted()
end sub

sub onPhase()
  phase = asText(m.top.phase)
  if phase <> m.lastPhase
    m.lastPhase = phase
    m.row = 0
    m.col = 0
    m.forgotNoteVisible = false
    if phase = "terms" or phase = "privacy" then m.pageIndex = 0
    if phase = "signin_password" then m.row = 1
  end if
  paint()
  syncSpinner()
end sub

sub onFieldChange()
  paint()
end sub

sub onQrChange()
  urlComplete = asText(m.top.verifyUrlComplete)
  if urlComplete <> ""
    m.qrCode.value = urlComplete
    m.qrCode.visible = true
    m.qrLoading.visible = false
    m.qrLoadingLabel.visible = false
  else
    m.qrCode.visible = false
    m.qrLoading.visible = true
    m.qrLoadingLabel.visible = true
  end if
  paint()
end sub

sub onTermsDocChange()
  buildTermsPages()
  paint()
end sub

sub onVisibleChange()
  syncSpinner()
end sub

sub syncSpinner()
  if m.spinnerTimer = invalid then return
  shouldSpin = (m.top.visible = true and asText(m.top.phase) = "phone" and asText(m.top.pollState) = "waiting" and not tvmReduceMotion())
  if shouldSpin
    m.spinnerTimer.control = "start"
  else
    m.spinnerTimer.control = "stop"
  end if
end sub

sub onSpinnerTick()
  if m.pollSpinner = invalid then return
  m.spinDeg = (m.spinDeg + 0.35)
  if m.spinDeg >= 6.283 then m.spinDeg = 0
  m.pollSpinner.rotation = m.spinDeg
end sub

sub onRestoreKey()
  key = asText(m.top.restoreKey)
  if key = "" then return
  grid = focusGrid()
  r = 0
  while r < grid.Count()
    c = 0
    while c < grid[r].Count()
      if grid[r][c] = key
        m.row = r
        m.col = c
        paint()
        return
      end if
      c = c + 1
    end while
    r = r + 1
  end while
end sub

sub buildTermsPages()
  m.termsPages = tvmTermsPages(m.top.termsDoc)
  if m.pageIndex > m.termsPages.Count() - 1 then m.pageIndex = 0
  if m.pageIndex < 0 then m.pageIndex = 0
end sub

sub hideAllCardControls()
  m.emailChipRow.visible = false
  m.wellGroup.visible = false
  m.checkGroup.visible = false
  m.statusPillRow.visible = false
  m.readerGroup.visible = false
  m.bannerLabel.text = ""
  m.bannerLabel.visible = false
  m.subNoteLabel.text = ""
  m.subNoteLabel.visible = false
  m.btnPrimary.visible = false
  m.btnShowPass.visible = false
  m.btnForgot.visible = false
  m.btnPrevPage.visible = false
  m.btnNextPage.visible = false
  m.btnSecondary1.visible = false
  m.btnSecondary2.visible = false
  m.btnLink.visible = false
  for each btn in [m.btnUseForm, m.btnNewCode, m.btnPhonePrivacy, m.btnChipChange, m.btnPrimary, m.btnShowPass, m.btnForgot, m.btnPrevPage, m.btnNextPage, m.btnSecondary1, m.btnSecondary2, m.btnLink]
    btn.hasFocusStyle = false
    btn.active = false
    btn.accent = false
    btn.disabled = false
    btn.hideDisabledHint = true
  end for
  m.wellRing.visible = false
  m.checkRing.visible = false
end sub

' Maps the active phase into rows of logical focus ids so Left/Right/Up/Down stay deterministic.
function focusGrid() as Object
  phase = asText(m.top.phase)
  if phase = "checking" or phase = "" then return []
  if phase = "phone" then return [["btnUseForm"], ["btnNewCode"], ["btnPhonePrivacy"]]
  if phase = "signin_email" then return [["well"], ["btnPrimary"], ["btnSecondary1"], ["btnSecondary2"], ["btnLink"]]
  if phase = "signin_password" then return [["chipChange"], ["well"], ["btnShowPass", "btnForgot"], ["btnPrimary"], ["btnSecondary1"]]
  if phase = "register_name" then return [["well"], ["btnPrimary"], ["btnSecondary1"], ["btnSecondary2"], ["btnLink"]]
  if phase = "register_email" then return [["well"], ["btnPrimary"], ["btnSecondary1"], ["btnSecondary2"]]
  if phase = "register_password" then return [["well"], ["btnShowPass"], ["btnPrimary"], ["btnSecondary1"]]
  if phase = "register_terms" then return [["check"], ["btnLink"], ["btnPrimary"], ["btnSecondary1"], ["btnSecondary2"]]
  if phase = "waiting" or phase = "unreachable" then return [["btnPrimary"], ["btnSecondary1"], ["btnLink"]]
  if phase = "suspended" then return [["btnSecondary1"], ["btnLink"]]
  if phase = "verify" then return [["btnPrimary"], ["btnSecondary1"], ["btnSecondary2"], ["btnLink"]]
  if phase = "terms"
    if m.termsPages.Count() > 1 then return [["btnPrevPage", "btnNextPage"], ["btnPrimary"], ["btnSecondary1"]]
    return [["btnPrimary"], ["btnSecondary1"]]
  end if
  if phase = "privacy"
    if m.termsPages.Count() > 1 then return [["btnPrevPage", "btnNextPage"], ["btnPrimary"]]
    return [["btnPrimary"]]
  end if
  return []
end function

sub paint()
  phase = asText(m.top.phase)
  if phase = "" then phase = "checking"
  busy = (m.top.busy = true)
  hideAllCardControls()

  if phase = "phone"
    m.phoneGroup.visible = true
    m.cardGroup.visible = false
    m.card.width = 3040
    m.card.height = 1540
    m.card.translation = [400, 320]
    m.lockup.translation = [400, 148]
    paintPhonePhase(busy)
    applyFocusStyle(focusGrid())
    return
  end if

  m.phoneGroup.visible = false
  m.cardGroup.visible = true
  paintSingleCardPhase(phase, busy)
  applyFocusStyle(focusGrid())
end sub

sub paintPhonePhase(busy as Boolean)
  displayUrl = tvmFormatVerifyUrl(asText(m.top.verifyUrl))
  code = tvmFormatDeviceCode(asText(m.top.userCode))
  if displayUrl <> ""
    m.urlCaption.text = "Or go to " + displayUrl + " and enter"
  else
    m.urlCaption.text = "Or enter the code below once loaded"
  end if
  if code <> ""
    m.codeLabel.text = code
  else
    m.codeLabel.text = "—"
  end if
  urlComplete = asText(m.top.verifyUrlComplete)
  hasQr = (urlComplete <> "")
  m.qrCode.visible = hasQr
  m.qrLoading.visible = not hasQr
  m.qrLoadingLabel.visible = not hasQr

  pollState = asText(m.top.pollState)
  pollNote = asText(m.top.pollNote)
  m.pollSpinner.visible = (pollState = "waiting" and not tvmReduceMotion())
  m.pollDot.visible = not m.pollSpinner.visible
  if pollState = "approved"
    m.pollDot.color = tvmSuccess()
    m.pollLabel.color = tvmSuccess()
    if pollNote = "" then pollNote = "You're in"
  else if pollState = "error" or pollState = "rate_limited"
    m.pollDot.color = tvmWarning()
    m.pollLabel.color = tvmWarning()
  else
    m.pollDot.color = "0x9FE7FFFF"
    m.pollLabel.color = tvmMuted()
    if pollNote = "" then pollNote = "Waiting for you..."
  end if
  m.pollLabel.text = pollNote

  err = asText(m.top.status)
  m.phoneError.text = err
  m.phoneError.visible = (err <> "")
  m.btnUseForm.accent = true
  m.btnNewCode.disabled = busy
end sub

sub paintSingleCardPhase(phase as String, busy as Boolean)
  wideReader = (phase = "terms" or phase = "privacy")
  cardW = 2160
  cardX = 840
  innerX = 1000
  innerW = 1840
  if wideReader
    cardW = 2480
    cardX = 680
    innerX = 840
    innerW = 2160
  end if
  m.kickerLabel.translation = [innerX, 392]
  m.headingLabel.translation = [innerX, 456]
  m.headingLabel.width = innerW
  m.ledeLabel.translation = [innerX, 578]
  m.ledeLabel.width = innerW
  m.ledeLabel.visible = true

  email = asText(m.top.emailDetail)
  signedAs = asText(m.top.signedAs)
  fieldError = asText(m.top.fieldError)
  banner = asText(m.top.status)
  cardY = 300
  cardH = 1480

  if phase = "checking"
    m.kickerLabel.text = "TVM"
    m.headingLabel.text = "Checking your sign-in..."
    m.ledeLabel.text = "Just a moment."
    cardH = 680
    cardY = 740
  else if phase = "signin_email"
    m.kickerLabel.text = "SIGN IN"
    m.headingLabel.text = "Welcome back"
    m.ledeLabel.text = "Enter your email address to continue."
    m.wellGroup.visible = true
    m.wellGroup.translation = [innerX, 704]
    m.wellCaption.text = "Email"
    paintWellValue(email, "you@example.com", false, fieldError, "Used on your account")
    placeButton(m.btnPrimary, innerX, 1020, innerW, "Continue", true, busy)
    placeButton(m.btnSecondary1, innerX, 1196, innerW, "Sign in with phone instead", false, false)
    placeButton(m.btnSecondary2, innerX, 1368, innerW, "New here? Create an account", false, false)
    placeButton(m.btnLink, innerX, 1540, innerW, "Privacy & terms", false, false)
    cardH = 1420
    cardY = 320
  else if phase = "signin_password"
    m.kickerLabel.text = "SIGN IN"
    m.headingLabel.text = "Enter your password"
    m.ledeLabel.visible = false
    m.emailChipRow.visible = true
    m.emailChipRow.translation = [innerX, 590]
    m.emailChipText.text = email
    m.btnChipChange.visible = true
    m.wellGroup.visible = true
    m.wellGroup.translation = [innerX, 738]
    m.wellCaption.text = "Password"
    paintPasswordWell(fieldError, "Keep your password private")
    placeButton(m.btnShowPass, innerX, 1044, 896, showPassLabel(), false, false)
    placeButton(m.btnForgot, innerX + 944, 1044, 896, "Forgot password?", false, false)
    if banner = "" and m.forgotNoteVisible then banner = "Ask the owner to reset it."
    paintBanner(banner, innerX, 1200, innerW, m.forgotNoteVisible and fieldError = "")
    lbl = "Sign in"
    if busy then lbl = "Signing in..."
    placeButton(m.btnPrimary, innerX, 1286, innerW, lbl, true, busy)
    placeButton(m.btnSecondary1, innerX, 1464, innerW, "Sign in with phone instead", false, false)
    cardH = 1360
    cardY = 320
  else if phase = "register_name"
    m.kickerLabel.text = "CREATE ACCOUNT"
    m.headingLabel.text = "Create an account"
    m.ledeLabel.text = "The owner checks every new account by hand before turning it on."
    m.wellGroup.visible = true
    m.wellGroup.translation = [innerX, 728]
    m.wellCaption.text = "Name (optional)"
    paintWellValue(asText(m.top.nameDetail), "First name or nickname", false, fieldError, "What we'll show in the corner")
    placeButton(m.btnPrimary, innerX, 1044, innerW, "Continue", true, busy)
    placeButton(m.btnSecondary1, innerX, 1220, innerW, "I already have an account", false, false)
    placeButton(m.btnSecondary2, innerX, 1392, innerW, "Sign in with phone instead", false, false)
    placeButton(m.btnLink, innerX, 1564, innerW, "Privacy & terms", false, false)
    cardH = 1440
    cardY = 320
  else if phase = "register_email"
    m.kickerLabel.text = "CREATE ACCOUNT"
    m.headingLabel.text = "Create an account"
    m.ledeLabel.text = "Enter the email address you'll use to sign in."
    m.wellGroup.visible = true
    m.wellGroup.translation = [innerX, 728]
    m.wellCaption.text = "Email"
    paintWellValue(email, "you@example.com", false, fieldError, "Used only to sign in")
    placeButton(m.btnPrimary, innerX, 1044, innerW, "Continue", true, busy)
    placeButton(m.btnSecondary1, innerX, 1220, innerW, "Back", false, false)
    placeButton(m.btnSecondary2, innerX, 1392, innerW, "I already have an account", false, false)
    cardH = 1280
    cardY = 320
  else if phase = "register_password"
    m.kickerLabel.text = "CREATE ACCOUNT"
    m.headingLabel.text = "Choose a password"
    m.ledeLabel.text = "Creating an account for " + email + "."
    m.wellGroup.visible = true
    m.wellGroup.translation = [innerX, 728]
    m.wellCaption.text = "Password"
    paintPasswordWell(fieldError, "Use at least 10 characters.")
    placeButton(m.btnShowPass, innerX, 1044, 896, showPassLabel(), false, false)
    placeButton(m.btnPrimary, innerX, 1220, innerW, "Continue", true, busy)
    placeButton(m.btnSecondary1, innerX, 1396, innerW, "Back", false, false)
    cardH = 1280
    cardY = 320
  else if phase = "register_terms"
    m.kickerLabel.text = "CREATE ACCOUNT"
    m.headingLabel.text = "Almost done"
    m.ledeLabel.text = "The owner checks every new account by hand before turning it on."
    m.checkGroup.visible = true
    m.checkGroup.translation = [innerX, 736]
    if m.top.termsAgreed = true
      m.checkBox.accent = true
      m.checkMark.text = "✓"
    else
      m.checkBox.accent = false
      m.checkMark.text = ""
    end if
    m.checkError.text = fieldError
    m.checkError.visible = (fieldError <> "")
    paintBanner(banner, innerX, 956, innerW, false)
    placeButton(m.btnLink, innerX, 1016, innerW, "Privacy & terms", false, false)
    createLbl = "Create account"
    if busy then createLbl = "Creating account..."
    placeButton(m.btnPrimary, innerX, 1192, innerW, createLbl, true, busy)
    placeButton(m.btnSecondary1, innerX, 1368, innerW, "Back", false, false)
    placeButton(m.btnSecondary2, innerX, 1540, innerW, "I already have an account", false, false)
    cardH = 1420
    cardY = 320
  else if phase = "waiting"
    m.kickerLabel.text = "PENDING"
    m.headingLabel.text = "You're on the list"
    m.ledeLabel.text = "The owner checks new accounts by hand. You can close TVM; we'll let you in as soon as yours is switched on."
    m.statusPillRow.visible = true
    m.statusPillRow.translation = [innerX, 764]
    m.statusDot.color = tvmWarning()
    m.statusPillText.text = pillWithEmail(signedAs, "Waiting for approval")
    chkLbl = "Check again"
    if busy then chkLbl = "Checking..."
    placeButton(m.btnPrimary, innerX, 944, innerW, chkLbl, true, busy)
    m.subNoteLabel.visible = true
    m.subNoteLabel.translation = [innerX, 1112]
    m.subNoteLabel.width = innerW
    note = asText(m.top.pollNote)
    if note = "" then note = "Checking automatically every minute"
    m.subNoteLabel.text = note
    paintBanner(banner, innerX, 1176, innerW, true)
    placeButton(m.btnSecondary1, innerX, 1260, innerW, "Sign out", false, false)
    placeButton(m.btnLink, innerX, 1432, innerW, "Privacy & terms", false, false)
    cardH = 1320
    cardY = 320
  else if phase = "unreachable"
    m.kickerLabel.text = "CONNECTION"
    m.headingLabel.text = "Accounts are unreachable"
    m.ledeLabel.text = "Your sign-in is saved. Check your connection and choose Check again."
    m.statusPillRow.visible = true
    m.statusPillRow.translation = [innerX, 740]
    m.statusDot.color = tvmWarning()
    m.statusPillText.text = pillWithEmail(signedAs, "Connection problem")
    chkLbl = "Check again"
    if busy then chkLbl = "Checking..."
    placeButton(m.btnPrimary, innerX, 928, innerW, chkLbl, true, busy)
    paintBanner(banner, innerX, 1100, innerW, true)
    placeButton(m.btnSecondary1, innerX, 1188, innerW, "Sign out", false, false)
    placeButton(m.btnLink, innerX, 1360, innerW, "Privacy & terms", false, false)
    cardH = 1240
    cardY = 320
  else if phase = "suspended"
    m.kickerLabel.text = "PAUSED"
    m.headingLabel.text = "Your account is paused"
    m.ledeLabel.text = "This account has been paused by the owner. Ask them to turn it back on if you still need access."
    m.statusPillRow.visible = true
    m.statusPillRow.translation = [innerX, 764]
    m.statusDot.color = tvmDanger()
    m.statusPillText.text = pillWithEmail(signedAs, "Paused by the owner")
    paintBanner(banner, innerX, 920, innerW, false)
    placeButton(m.btnSecondary1, innerX, 988, innerW, "Sign out", false, false)
    placeButton(m.btnLink, innerX, 1164, innerW, "Privacy & terms", false, false)
    cardH = 1040
    cardY = 320
  else if phase = "verify"
    m.kickerLabel.text = "EMAIL CHECK"
    m.headingLabel.text = "Check your email"
    m.ledeLabel.text = "Enter the six-digit code sent to " + signedAs + "."
    paintBanner(banner, innerX, 720, innerW, true)
    placeButton(m.btnPrimary, innerX, 820, innerW, "Enter 6-digit code", true, busy)
    placeButton(m.btnSecondary1, innerX, 996, innerW, "Resend code", false, false)
    placeButton(m.btnSecondary2, innerX, 1168, innerW, "Sign out", false, false)
    placeButton(m.btnLink, innerX, 1340, innerW, "Privacy & terms", false, false)
    cardH = 1240
    cardY = 320
  else if phase = "terms"
    m.kickerLabel.text = "BEFORE YOU START"
    m.headingLabel.text = "Accept the terms to continue"
    m.ledeLabel.text = termsMetaLine()
    paintReader(innerX, 650, innerW)
    paintBanner(banner, innerX, 1388, innerW, false)
    agreeLbl = "I agree and continue"
    if busy then agreeLbl = "Saving..."
    pageCtrlY = 1410
    if m.termsPages.Count() > 1
      placeButton(m.btnPrevPage, innerX, pageCtrlY, 1056, "Previous page", false, m.pageIndex <= 0)
      placeButton(m.btnNextPage, innerX + 1104, pageCtrlY, 1056, "Next page", false, m.pageIndex >= m.termsPages.Count() - 1)
      placeButton(m.btnPrimary, innerX, 1582, innerW, agreeLbl, true, busy)
      placeButton(m.btnSecondary1, innerX, 1754, innerW, "Sign out", false, false)
      cardH = 1710
    else
      placeButton(m.btnPrimary, innerX, 1430, innerW, agreeLbl, true, busy)
      placeButton(m.btnSecondary1, innerX, 1602, innerW, "Sign out", false, false)
      cardH = 1560
    end if
    cardY = 230
  else if phase = "privacy"
    m.kickerLabel.text = "PRIVACY & TERMS"
    m.headingLabel.text = "Terms of Service"
    m.ledeLabel.text = termsMetaLine()
    paintReader(innerX, 650, innerW)
    if m.termsPages.Count() > 1
      placeButton(m.btnPrevPage, innerX, 1410, 1056, "Previous page", false, m.pageIndex <= 0)
      placeButton(m.btnNextPage, innerX + 1104, 1410, 1056, "Next page", false, m.pageIndex >= m.termsPages.Count() - 1)
      placeButton(m.btnPrimary, innerX, 1582, innerW, "Done", true, false)
      cardH = 1540
    else
      placeButton(m.btnPrimary, innerX, 1430, innerW, "Done", true, false)
      cardH = 1380
    end if
    cardY = 230
  end if

  if m.card <> invalid
    m.card.width = cardW
    m.card.height = cardH
    m.card.translation = [cardX, cardY]
  end if
  m.lockup.translation = [cardX, 136]
  shiftY = cardY - 320
  m.cardGroup.translation = [0, shiftY]
end sub

sub paintWellValue(value as String, placeholder as String, masked as Boolean, err as String, helper as String)
  if value <> ""
    m.wellValue.text = value
    m.wellValue.color = tvmText()
  else
    m.wellValue.text = placeholder
    m.wellValue.color = tvmFaint()
  end if
  if err <> ""
    m.wellError.visible = true
    m.wellError.text = err
    m.wellHelper.visible = false
  else
    m.wellError.visible = false
    m.wellHelper.visible = (helper <> "")
    m.wellHelper.text = helper
  end if
end sub

sub paintPasswordWell(err as String, helper as String)
  if m.top.showPassword = true
    display = asText(m.top.passwordPlain)
  else
    n = m.top.passwordLength
    if n < 0 then n = 0
    if n > 24 then n = 24
    display = ""
    i = 0
    while i < n
      display = display + "•"
      i = i + 1
    end while
  end if
  paintWellValue(display, "Your password", true, err, helper)
end sub

function showPassLabel() as String
  if m.top.showPassword = true then return "Hide password"
  return "Show password"
end function

function pillWithEmail(email as String, statusWord as String) as String
  if email <> "" then return email + "  ·  " + statusWord
  return statusWord
end function

function termsMetaLine() as String
  doc = m.top.termsDoc
  if doc = invalid then return "Plain-English overview and rules for using TVM."
  v = asText(doc.version)
  u = asText(doc.updated)
  if v <> "" and u <> "" then return "Version " + v + "  ·  Updated " + u
  return "Plain-English overview and rules for using TVM."
end function

sub paintReader(x as Integer, y as Integer, w as Integer)
  if m.termsPages.Count() = 0 then buildTermsPages()
  m.readerGroup.visible = true
  m.readerGroup.translation = [x, y]
  m.readerGlass.width = w
  m.readerBody.width = w - 96
  m.readerPageLabel.width = w - 96
  idx = m.pageIndex
  if idx < 0 then idx = 0
  if m.termsPages.Count() > 0 and idx > m.termsPages.Count() - 1 then idx = m.termsPages.Count() - 1
  if m.termsPages.Count() > 0
    m.readerBody.text = m.termsPages[idx]
    m.readerPageLabel.text = "Page " + StrI(idx + 1).Trim() + " of " + StrI(m.termsPages.Count()).Trim() + "  ·  Left / Right to turn pages"
  else
    m.readerBody.text = "Terms of Service are loading."
    m.readerPageLabel.text = ""
  end if
end sub

sub paintBanner(text as String, x as Integer, y as Integer, w as Integer, soft as Boolean)
  m.bannerLabel.translation = [x, y]
  m.bannerLabel.width = w
  m.bannerLabel.text = text
  m.bannerLabel.visible = (text <> "")
  if soft
    m.bannerLabel.color = tvmWarning()
  else
    m.bannerLabel.color = tvmDanger()
  end if
end sub

sub placeButton(btn as Object, x as Integer, y as Integer, w as Integer, label as String, accent as Boolean, disabled as Boolean)
  btn.visible = true
  btn.translation = [x, y]
  btn.pillWidth = w
  btn.label = label
  btn.accent = accent
  btn.disabled = disabled
  btn.hideDisabledHint = true
end sub

sub applyFocusStyle(grid as Object)
  if grid.Count() = 0
    m.top.focusKey = ""
    return
  end if
  if m.row < 0 then m.row = 0
  if m.row > grid.Count() - 1 then m.row = grid.Count() - 1
  rowItems = grid[m.row]
  if m.col < 0 then m.col = 0
  if m.col > rowItems.Count() - 1 then m.col = rowItems.Count() - 1

  focusedId = rowItems[m.col]
  m.top.focusKey = focusedId

  if focusedId = "btnUseForm" then m.btnUseForm.hasFocusStyle = true
  if focusedId = "btnNewCode" then m.btnNewCode.hasFocusStyle = true
  if focusedId = "btnPhonePrivacy" then m.btnPhonePrivacy.hasFocusStyle = true
  if focusedId = "chipChange" then m.btnChipChange.hasFocusStyle = true
  if focusedId = "well"
    m.wellGlass.focused = true
    m.wellRing.visible = true
  else
    m.wellGlass.focused = false
    m.wellRing.visible = false
  end if
  if focusedId = "check"
    m.checkGlass.focused = true
    m.checkRing.visible = true
  else
    m.checkGlass.focused = false
    m.checkRing.visible = false
  end if
  if focusedId = "btnPrimary" then m.btnPrimary.hasFocusStyle = true
  if focusedId = "btnShowPass" then m.btnShowPass.hasFocusStyle = true
  if focusedId = "btnForgot" then m.btnForgot.hasFocusStyle = true
  if focusedId = "btnPrevPage" then m.btnPrevPage.hasFocusStyle = true
  if focusedId = "btnNextPage" then m.btnNextPage.hasFocusStyle = true
  if focusedId = "btnSecondary1" then m.btnSecondary1.hasFocusStyle = true
  if focusedId = "btnSecondary2" then m.btnSecondary2.hasFocusStyle = true
  if focusedId = "btnLink" then m.btnLink.hasFocusStyle = true
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  phase = asText(m.top.phase)

  if intent = "back"
    if phase = "privacy"
      emit("closePrivacy")
      return true
    else if phase = "signin_email" or phase = "register_name"
      emit("backToPhone")
      return true
    else if phase = "signin_password"
      emit("backToEmail")
      return true
    else if phase = "register_email" or phase = "register_password" or phase = "register_terms"
      emit("prevStep")
      return true
    end if
    return false
  end if

  grid = focusGrid()
  if grid.Count() = 0 then return true

  if intent = "down"
    if m.row < grid.Count() - 1
      m.row = m.row + 1
      m.col = 0
    end if
    applyFocusStyle(grid)
    return true
  end if

  if intent = "up"
    if m.row > 0
      m.row = m.row - 1
      m.col = 0
    end if
    applyFocusStyle(grid)
    return true
  end if

  rowItems = grid[m.row]
  if intent = "left"
    if rowItems.Count() > 1 and m.col > 0
      m.col = m.col - 1
      applyFocusStyle(grid)
      return true
    end if
    if (phase = "terms" or phase = "privacy") and m.pageIndex > 0
      m.pageIndex = m.pageIndex - 1
      paint()
      return true
    end if
    return true
  end if

  if intent = "right"
    if rowItems.Count() > 1 and m.col < rowItems.Count() - 1
      m.col = m.col + 1
      applyFocusStyle(grid)
      return true
    end if
    if (phase = "terms" or phase = "privacy") and m.pageIndex < m.termsPages.Count() - 1
      m.pageIndex = m.pageIndex + 1
      paint()
      return true
    end if
    return true
  end if

  if intent = "select"
    activateFocused(rowItems[m.col], phase)
    return true
  end if
  return true
end function

sub activateFocused(focusedId as String, phase as String)
  if focusedId = "btnUseForm" then emit("switchToForm")
  if focusedId = "btnNewCode" then emit("refreshCode")
  if focusedId = "btnPhonePrivacy" or focusedId = "btnLink" then emit("openPrivacy")
  if focusedId = "chipChange" then emit("backToEmail")
  if focusedId = "well"
    if phase = "signin_email" or phase = "register_email" then emit("editEmail")
    if phase = "signin_password" or phase = "register_password" then emit("editPassword")
    if phase = "register_name" then emit("editName")
  end if
  if focusedId = "check" then emit("toggleTermsAgree")
  if focusedId = "btnShowPass" then emit("toggleShowPassword")
  if focusedId = "btnForgot"
    m.forgotNoteVisible = true
    paint()
  end if
  if focusedId = "btnPrevPage" and m.pageIndex > 0
    m.pageIndex = m.pageIndex - 1
    paint()
  end if
  if focusedId = "btnNextPage" and m.pageIndex < m.termsPages.Count() - 1
    m.pageIndex = m.pageIndex + 1
    paint()
  end if
  if focusedId = "btnPrimary"
    if phase = "signin_email" or phase = "register_name" or phase = "register_email" or phase = "register_password"
      emit("nextStep")
    else if phase = "signin_password" or phase = "register_terms"
      emit("submit")
    else if phase = "waiting" or phase = "unreachable"
      emit("recheck")
    else if phase = "verify"
      emit("editEmailCode")
    else if phase = "terms"
      emit("agree")
    else if phase = "privacy"
      emit("closePrivacy")
    end if
  end if
  if focusedId = "btnSecondary1"
    if phase = "signin_email" or phase = "signin_password"
      emit("backToPhone")
    else if phase = "register_name"
      emit("backToSignin")
    else if phase = "register_email" or phase = "register_password" or phase = "register_terms"
      emit("prevStep")
    else if phase = "waiting" or phase = "unreachable" or phase = "suspended" or phase = "terms"
      emit("signout")
    else if phase = "verify"
      emit("resendCode")
    end if
  end if
  if focusedId = "btnSecondary2"
    if phase = "signin_email"
      emit("startRegister")
    else if phase = "register_name"
      emit("backToPhone")
    else if phase = "register_email" or phase = "register_terms"
      emit("backToSignin")
    else if phase = "verify"
      emit("signout")
    end if
  end if
end sub

sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
