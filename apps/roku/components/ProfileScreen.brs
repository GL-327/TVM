' Signed-in Account overview for 10-foot TV: identity header, interactive rows
' (Plan, Real-Debrid, Live TV, Stream profiles), Status / Member since bar,
' and footer actions (Sign out, Privacy & terms, Back).

sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.avatarInitial = m.top.findNode("avatarInitial")
  m.nameLabel = m.top.findNode("nameLabel")
  m.emailLabel = m.top.findNode("emailLabel")
  m.statusDot = m.top.findNode("statusDot")
  m.statusPillText = m.top.findNode("statusPillText")
  m.rowsGroup = m.top.findNode("rowsGroup")
  m.statusHeading = m.top.findNode("statusHeading")
  m.statusValue = m.top.findNode("statusValue")
  m.sinceHeading = m.top.findNode("sinceHeading")
  m.sinceValue = m.top.findNode("sinceValue")
  m.btnSignOut = m.top.findNode("btnSignOut")
  m.btnPrivacy = m.top.findNode("btnPrivacy")
  m.btnBack = m.top.findNode("btnBack")

  m.heading.font = tvmFontScreenTitle()
  m.heading.color = tvmText()
  m.avatarInitial.font = tvmFontTitle()
  m.avatarInitial.color = "0xFFFFFFFF"
  m.nameLabel.font = tvmFontLabel()
  m.nameLabel.color = tvmText()
  m.emailLabel.font = tvmFontSecondary()
  m.emailLabel.color = tvmMuted()
  m.statusPillText.font = tvmFontMeta()
  m.statusPillText.color = tvmText()
  m.statusHeading.font = tvmFontMeta()
  m.statusHeading.color = tvmMuted()
  m.statusValue.font = tvmFontSecondary()
  m.statusValue.color = tvmText()
  m.sinceHeading.font = tvmFontMeta()
  m.sinceHeading.color = tvmMuted()
  m.sinceValue.font = tvmFontSecondary()
  m.sinceValue.color = tvmText()

  m.row = 0
  m.col = 0
  m.seq = 0
  m.rowNodes = []
  m.rowIds = ["plan", "realdebrid", "livetv", "profiles"]
  m.rowLabels = ["Plan", "Real-Debrid", "Live TV", "Stream profiles"]

  buildRows()
  paint()
end sub

sub buildRows()
  rowW = 2480
  rowH = 152
  stepY = 168
  titleFont = tvmFontLabel()
  detailFont = tvmFontSecondary()
  i = 0
  while i < m.rowIds.Count()
    g = CreateObject("roSGNode", "Group")
    g.translation = [0, i * stepY]
    glass = CreateObject("roSGNode", "GlassPanel")
    glass.shape = "pill"
    glass.width = rowW
    glass.height = rowH
    ring = CreateObject("roSGNode", "Poster")
    ring.uri = "pkg:/images/glass/focus-ring.9.png"
    ring.translation = [-16, -16]
    ring.width = rowW + 32
    ring.height = rowH + 32
    ring.visible = false
    lbl = CreateObject("roSGNode", "Label")
    lbl.text = m.rowLabels[i]
    lbl.font = titleFont
    lbl.color = tvmText()
    lbl.translation = [60, 42]
    lbl.width = 920
    detail = CreateObject("roSGNode", "Label")
    detail.font = detailFont
    detail.color = tvmMuted()
    detail.translation = [1000, 44]
    detail.width = 1360
    detail.horizAlign = "right"
    detail.text = ""
    chev = CreateObject("roSGNode", "Label")
    chev.font = detailFont
    chev.color = tvmFaint()
    chev.translation = [2376, 44]
    chev.width = 64
    chev.text = ">"
    g.appendChild(glass)
    g.appendChild(ring)
    g.appendChild(lbl)
    g.appendChild(detail)
    g.appendChild(chev)
    m.rowsGroup.appendChild(g)
    m.rowNodes.Push({ id: m.rowIds[i], glass: glass, ring: ring, detail: detail, chev: chev })
    i = i + 1
  end while
end sub

sub onAccountState()
  paint()
end sub

sub onRd()
  paint()
end sub

sub onRestoreKey()
  key = asText(m.top.restoreKey)
  if key = "" then return
  if key = "signout"
    m.row = 4 : m.col = 0 : paintFocus() : return
  else if key = "privacy"
    m.row = 4 : m.col = 1 : paintFocus() : return
  else if key = "back"
    m.row = 4 : m.col = 2 : paintFocus() : return
  end if
  i = 0
  while i < m.rowIds.Count()
    if m.rowIds[i] = key
      m.row = i : m.col = 0 : paintFocus() : return
    end if
    i = i + 1
  end while
end sub

sub paint()
  state = m.top.accountState
  if state = invalid then state = {}
  account = {}
  if state.DoesExist("account") and state.account <> invalid then account = state.account
  email = asText(account.email)
  displayName = asText(account.displayName)
  if displayName = "" then displayName = email
  if displayName = "" then displayName = "Your account"
  m.nameLabel.text = displayName
  m.emailLabel.text = email
  initial = UCase(Left(displayName, 1))
  if initial = "" then initial = "T"
  m.avatarInitial.text = initial

  usable = {}
  if state.DoesExist("usable") and state.usable <> invalid then usable = state.usable
  statusText = tvmAccountStatusText(account, usable)
  m.statusPillText.text = statusText
  m.statusValue.text = statusText

  isOk = (usable.ok = true)
  if isOk
    m.statusDot.color = tvmSuccess()
    m.statusValue.color = tvmSuccess()
  else if asText(usable.reason) = "suspended" or asText(account.status) = "suspended"
    m.statusDot.color = tvmDanger()
    m.statusValue.color = tvmDanger()
  else
    m.statusDot.color = tvmWarning()
    m.statusValue.color = tvmWarning()
  end if

  m.sinceValue.text = tvmShortDateText(asText(account.createdAt))

  planLabel = tvmPlanName(asText(account.entitlement))
  m.rowNodes[0].detail.text = planLabel + "  ·  Change"

  rd = m.top.rd
  rdText = "Connect"
  if rd <> invalid and (rd.configured = true or rd.connected = true)
    own = (aaGet(rd, "ownKey", false) = true) or (asText(aaGet(rd, "source", "")) = "device")
    user = asText(rd.username)
    if not own
      rdText = "Connected through your TVM account"
    else if user <> ""
      rdText = "Connected  ·  " + user
    else
      rdText = "Connected"
    end if
  end if
  m.rowNodes[1].detail.text = rdText

  if tvmHasLiveEntitlement(asText(account.entitlement))
    m.rowNodes[2].detail.text = "On"
  else
    m.rowNodes[2].detail.text = "Off"
  end if
  m.rowNodes[3].detail.text = "Manage"
  paintFocus()
end sub

sub paintFocus()
  i = 0
  while i < m.rowNodes.Count()
    focused = (m.row = i)
    m.rowNodes[i].glass.focused = focused
    m.rowNodes[i].ring.visible = focused
    i = i + 1
  end while

  m.btnSignOut.hasFocusStyle = (m.row = 4 and m.col = 0)
  m.btnPrivacy.hasFocusStyle = (m.row = 4 and m.col = 1)
  m.btnBack.hasFocusStyle = (m.row = 4 and m.col = 2)

  if m.row < 4
    m.top.focusKey = m.rowIds[m.row]
  else if m.col = 0
    m.top.focusKey = "signout"
  else if m.col = 1
    m.top.focusKey = "privacy"
  else
    m.top.focusKey = "back"
  end if
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back"
    emit("back")
    return true
  end if
  if intent = "down"
    if m.row < 4
      m.row = m.row + 1
      m.col = 0
      paintFocus()
    end if
    return true
  end if
  if intent = "up"
    if m.row > 0
      m.row = m.row - 1
      m.col = 0
      paintFocus()
    end if
    return true
  end if
  if intent = "left"
    if m.row = 4 and m.col > 0
      m.col = m.col - 1
      paintFocus()
    end if
    return true
  end if
  if intent = "right"
    if m.row = 4 and m.col < 2
      m.col = m.col + 1
      paintFocus()
    end if
    return true
  end if
  if intent = "select"
    if m.row = 0 then emit("plans")
    if m.row = 1 then emit("realdebrid")
    if m.row = 2
      state = m.top.accountState
      ent = ""
      if state <> invalid and state.account <> invalid then ent = asText(state.account.entitlement)
      if tvmHasLiveEntitlement(ent)
        emit("live")
      else
        emit("plans")
      end if
    end if
    if m.row = 3 then emit("profiles")
    if m.row = 4
      if m.col = 0 then emit("signout")
      if m.col = 1 then emit("privacy")
      if m.col = 2 then emit("back")
    end if
    return true
  end if
  return false
end function

sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
