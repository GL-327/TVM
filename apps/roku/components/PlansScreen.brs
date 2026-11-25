' Plans screen for 10-foot TV: Monthly / Yearly segmented control, equal-height
' Stream and Stream + Live cards, 6-row Compare everything table, and fenced Donate note.

sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.subhead = m.top.findNode("subhead")
  m.accountStatusLine = m.top.findNode("accountStatusLine")
  m.cadenceThumb = m.top.findNode("cadenceThumb")
  m.cadenceRing = m.top.findNode("cadenceRing")
  m.cadenceMonthly = m.top.findNode("cadenceMonthly")
  m.cadenceYearly = m.top.findNode("cadenceYearly")
  m.thumbAnim = m.top.findNode("thumbAnim")
  m.thumbMove = m.top.findNode("thumbMove")
  m.feedbackBanner = m.top.findNode("feedbackBanner")

  m.streamGlass = m.top.findNode("streamGlass")
  m.streamBadgeGlass = m.top.findNode("streamBadgeGlass")
  m.streamBadgeLabel = m.top.findNode("streamBadgeLabel")
  m.streamName = m.top.findNode("streamName")
  m.streamTagline = m.top.findNode("streamTagline")
  m.streamPrice = m.top.findNode("streamPrice")
  m.streamPeriod = m.top.findNode("streamPeriod")
  m.streamFeatures = m.top.findNode("streamFeatures")
  m.btnStream = m.top.findNode("btnStream")

  m.liveGlass = m.top.findNode("liveGlass")
  m.liveBadgeGlass = m.top.findNode("liveBadgeGlass")
  m.liveBadgeLabel = m.top.findNode("liveBadgeLabel")
  m.liveName = m.top.findNode("liveName")
  m.liveTagline = m.top.findNode("liveTagline")
  m.livePrice = m.top.findNode("livePrice")
  m.livePeriod = m.top.findNode("livePeriod")
  m.liveFeatures = m.top.findNode("liveFeatures")
  m.btnLive = m.top.findNode("btnLive")

  m.compareRows = m.top.findNode("compareRows")
  m.donateTitle = m.top.findNode("donateTitle")
  m.donateBody = m.top.findNode("donateBody")
  m.btnPrivacy = m.top.findNode("btnPrivacy")
  m.btnBack = m.top.findNode("btnBack")

  m.cadence = "monthly"
  m.row = 1
  m.col = 0
  m.seq = 0

  styleText()
  buildCompareTable()
  paint()
end sub

sub styleText()
  m.heading.font = tvmFontScreenTitle()
  m.heading.color = tvmText()
  m.subhead.font = tvmFontSecondary()
  m.subhead.color = tvmMuted()
  m.accountStatusLine.font = tvmFontMeta()
  m.accountStatusLine.color = tvmMuted()
  m.cadenceMonthly.font = tvmFontSecondary()
  m.cadenceMonthly.color = "0xFFFFFFFF"
  m.cadenceYearly.font = tvmFontSecondary()
  m.cadenceYearly.color = tvmMuted()
  m.feedbackBanner.font = tvmFontMeta()
  m.feedbackBanner.color = tvmSuccess()

  m.streamName.font = tvmFontLabel()
  m.streamName.color = tvmText()
  m.streamBadgeLabel.font = tvmFontMeta()
  m.streamBadgeLabel.color = "0xFFFFFFFF"
  m.streamTagline.font = tvmFontMeta()
  m.streamTagline.color = tvmMuted()
  m.streamPrice.font = tvmFontDisplay()
  m.streamPrice.color = tvmText()
  m.streamPeriod.font = tvmFontMeta()
  m.streamPeriod.color = tvmMuted()
  m.streamFeatures.font = tvmFontMeta()
  m.streamFeatures.color = tvmText()

  m.liveName.font = tvmFontLabel()
  m.liveName.color = tvmText()
  m.liveBadgeLabel.font = tvmFontMeta()
  m.liveBadgeLabel.color = tvmMuted()
  m.liveTagline.font = tvmFontMeta()
  m.liveTagline.color = tvmMuted()
  m.livePrice.font = tvmFontDisplay()
  m.livePrice.color = tvmText()
  m.livePeriod.font = tvmFontMeta()
  m.livePeriod.color = tvmMuted()
  m.liveFeatures.font = tvmFontMeta()
  m.liveFeatures.color = tvmText()

  m.donateTitle.font = tvmFontMeta()
  m.donateTitle.color = tvmText()
  m.donateBody.font = tvmFontMeta()
  m.donateBody.color = tvmMuted()
end sub

sub buildCompareTable()
  hdrFont = tvmFontMeta()
  rowFont = tvmFontMeta()
  col0 = CreateObject("roSGNode", "Label")
  col0.font = hdrFont : col0.color = tvmText() : col0.translation = [68, 28] : col0.width = 1280 : col0.text = "Compare everything"
  col1 = CreateObject("roSGNode", "Label")
  col1.font = hdrFont : col1.color = tvmText() : col1.translation = [1440, 28] : col1.width = 820 : col1.text = "Stream"
  col2 = CreateObject("roSGNode", "Label")
  col2.font = hdrFont : col2.color = tvmText() : col2.translation = [2320, 28] : col2.width = 820 : col2.text = "Stream + Live"
  m.compareRows.appendChild(col0)
  m.compareRows.appendChild(col1)
  m.compareRows.appendChild(col2)

  rows = [
    ["Movies & series", "Included", "Included"],
    ["Live TV channels", "—", "Included"],
    ["Private stream cache", "With your Real-Debrid", "With your Real-Debrid"],
    ["Devices", "Web, TV & phone", "Web, TV & phone"],
    ["Card or billing details", "Not needed", "Not needed"],
    ["Availability", "Available", "Coming soon"]
  ]
  i = 0
  while i < rows.Count()
    y = 92 + (i * 68)
    line = CreateObject("roSGNode", "Rectangle")
    line.width = 3064 : line.height = 1 : line.translation = [68, y - 6] : line.color = "0xFFFFFF18"
    m.compareRows.appendChild(line)
    a = CreateObject("roSGNode", "Label")
    a.font = rowFont : a.color = tvmMuted() : a.translation = [68, y] : a.width = 1280 : a.text = rows[i][0]
    b = CreateObject("roSGNode", "Label")
    b.font = rowFont : b.color = tvmText() : b.translation = [1440, y] : b.width = 820 : b.text = rows[i][1]
    c = CreateObject("roSGNode", "Label")
    c.font = rowFont : c.color = tvmMuted() : c.translation = [2320, y] : c.width = 820 : c.text = rows[i][2]
    m.compareRows.appendChild(a)
    m.compareRows.appendChild(b)
    m.compareRows.appendChild(c)
    i = i + 1
  end while
end sub

sub onDataChange()
  paint()
end sub

sub onStatusChange()
  s = asText(m.top.status)
  m.feedbackBanner.visible = (s <> "")
  m.feedbackBanner.text = s
end sub

sub onRestoreKey()
  key = asText(m.top.restoreKey)
  if key = "" then return
  if key = "cadence:monthly" then m.row = 0 : m.col = 0
  if key = "cadence:yearly" then m.row = 0 : m.col = 1
  if key = "tier:stream" then m.row = 1 : m.col = 0
  if key = "tier:stream-live" then m.row = 1 : m.col = 1
  if key = "privacy" then m.row = 2 : m.col = 0
  if key = "back" then m.row = 2 : m.col = 1
  paintFocus()
end sub

function findTier(id as String) as Dynamic
  doc = m.top.tiersDoc
  if doc = invalid or doc.tiers = invalid then return invalid
  for each tier in doc.tiers
    if asText(tier.id) = id then return tier
  end for
  return invalid
end function

sub paint()
  state = m.top.accountState
  account = {}
  if state <> invalid and state.account <> invalid then account = state.account
  email = asText(account.email)
  ent = asText(account.entitlement)
  planName = tvmPlanName(ent)
  if email <> ""
    m.accountStatusLine.text = "Signed in as " + email + "  ·  Current plan: " + planName
  else
    m.accountStatusLine.text = "Current plan: " + planName
  end if

  streamTier = findTier("stream")
  liveTier = findTier("stream-live")
  isYearly = (m.cadence = "yearly")

  if isYearly
    m.cadenceMonthly.color = tvmMuted()
    m.cadenceYearly.color = "0xFFFFFFFF"
  else
    m.cadenceMonthly.color = "0xFFFFFFFF"
    m.cadenceYearly.color = tvmMuted()
  end if

  ' Stream pricing
  sMonthly = 1000
  sYearly = 9000
  if streamTier <> invalid
    if streamTier.monthlyPence <> invalid then sMonthly = Int(streamTier.monthlyPence)
    if streamTier.yearlyPence <> invalid then sYearly = Int(streamTier.yearlyPence)
  end if
  if isYearly
    m.streamPrice.text = formatPence(sYearly)
    m.streamPeriod.text = "/ year  (equivalent to £7.50 / mo)"
  else
    m.streamPrice.text = formatPence(sMonthly)
    m.streamPeriod.text = "/ month"
  end if

  isCurrentStream = (ent = "stream")
  if isCurrentStream
    m.streamBadgeLabel.text = "Your plan"
    m.btnStream.label = "Current plan"
    m.btnStream.accent = false
    m.btnStream.active = true
  else
    m.streamBadgeLabel.text = "Most popular"
    m.btnStream.label = "Choose Stream"
    m.btnStream.accent = true
    m.btnStream.active = false
  end if
  m.btnStream.disabled = (m.top.busy = true)

  ' Stream + Live pricing & orderability
  lMonthly = 1700
  lYearly = 15000
  liveOrderable = false
  liveBadge = "Coming soon"
  if liveTier <> invalid
    if liveTier.monthlyPence <> invalid then lMonthly = Int(liveTier.monthlyPence)
    if liveTier.yearlyPence <> invalid then lYearly = Int(liveTier.yearlyPence)
    if liveTier.orderable = true then liveOrderable = true
    if asText(liveTier.availability) <> "" then liveBadge = asText(liveTier.availability)
  end if
  if isYearly
    m.livePrice.text = formatPence(lYearly)
    m.livePeriod.text = "/ year  (Stream £90 + Live TV £60)"
  else
    m.livePrice.text = formatPence(lMonthly)
    m.livePeriod.text = "/ month  (Stream £10 + Live TV £7)"
  end if

  isCurrentLive = (ent = "stream+live" or ent = "stream-live")
  if isCurrentLive
    m.liveBadgeLabel.text = "Your plan"
    m.liveBadgeGlass.accent = true
    m.liveBadgeLabel.color = "0xFFFFFFFF"
    m.btnLive.label = "Current plan"
    m.btnLive.active = true
    m.btnLive.disabled = false
  else if liveOrderable
    m.liveBadgeLabel.text = "Available"
    m.liveBadgeGlass.accent = false
    m.liveBadgeLabel.color = tvmText()
    m.btnLive.label = "Choose Stream + Live"
    m.btnLive.accent = true
    m.btnLive.disabled = (m.top.busy = true)
  else
    m.liveBadgeLabel.text = liveBadge
    m.liveBadgeGlass.accent = false
    m.liveBadgeLabel.color = tvmMuted()
    m.btnLive.label = liveBadge
    m.btnLive.accent = false
    m.btnLive.disabled = true
  end if

  moveThumb()
  paintFocus()
end sub

sub moveThumb()
  toPos = [12, 12]
  if m.cadence = "yearly" then toPos = [544, 12]
  fromPos = m.cadenceThumb.translation
  if fromPos = invalid then fromPos = [12, 12]
  m.cadenceRing.translation = [toPos[0] - 16, -4]
  if tvmReduceMotion() or m.thumbAnim = invalid
    m.cadenceThumb.translation = toPos
    return
  end if
  if Abs(fromPos[0] - toPos[0]) < 2 then return
  m.thumbAnim.control = "stop"
  m.thumbMove.keyValue = [fromPos, toPos]
  m.thumbAnim.control = "start"
end sub

sub paintFocus()
  m.cadenceRing.visible = (m.row = 0)
  m.btnStream.hasFocusStyle = (m.row = 1 and m.col = 0)
  m.btnLive.hasFocusStyle = (m.row = 1 and m.col = 1)
  m.streamGlass.focused = (m.row = 1 and m.col = 0)
  m.liveGlass.focused = (m.row = 1 and m.col = 1)
  m.btnPrivacy.hasFocusStyle = (m.row = 2 and m.col = 0)
  m.btnBack.hasFocusStyle = (m.row = 2 and m.col = 1)

  if m.row = 0
    if m.col = 0 then m.top.focusKey = "cadence:monthly" else m.top.focusKey = "cadence:yearly"
  else if m.row = 1
    if m.col = 0 then m.top.focusKey = "tier:stream" else m.top.focusKey = "tier:stream-live"
  else
    if m.col = 0 then m.top.focusKey = "privacy" else m.top.focusKey = "back"
  end if
end sub

sub emit(kind as String, extra as Dynamic)
  m.seq = m.seq + 1
  payload = { type: kind, seq: m.seq }
  if extra <> invalid
    for each k in extra
      payload[k] = extra[k]
    end for
  end if
  m.top.action = payload
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back"
    emit("back", invalid)
    return true
  end if
  if intent = "down"
    if m.row < 2
      m.row = m.row + 1
      paintFocus()
    end if
    return true
  end if
  if intent = "up"
    if m.row > 0
      m.row = m.row - 1
      if m.row = 0
        if m.cadence = "yearly" then m.col = 1 else m.col = 0
      end if
      paintFocus()
    end if
    return true
  end if
  if intent = "left"
    if m.col > 0
      m.col = m.col - 1
      if m.row = 0
        m.cadence = "monthly"
        paint()
      else
        paintFocus()
      end if
    end if
    return true
  end if
  if intent = "right"
    if m.col < 1
      m.col = m.col + 1
      if m.row = 0
        m.cadence = "yearly"
        paint()
      else
        paintFocus()
      end if
    end if
    return true
  end if
  if intent = "select"
    if m.row = 0
      if m.col = 0 then m.cadence = "monthly" else m.cadence = "yearly"
      paint()
    else if m.row = 1
      if m.col = 0
        emit("choosePlan", { tierId: "stream", cadence: m.cadence })
      else
        emit("choosePlan", { tierId: "stream-live", cadence: m.cadence })
      end if
    else
      if m.col = 0 then emit("privacy", invalid) else emit("back", invalid)
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
