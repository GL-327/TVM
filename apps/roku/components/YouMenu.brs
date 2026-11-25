' "You" menu: a glass side panel opened from the profile orb. Root page lists
' TVM Hub, Switch profile, Settings, Account & Plan and Sources. Sources is a
' second page (studio hubs and apps, Real-Debrid, Live picks, Live playlist,
' Inputs) so everything the old 17-button ribbon reached stays reachable.
sub init()
  m.top.focusable = true
  m.panel = m.top.findNode("panel")
  m.glass = m.top.findNode("glass")
  m.title = m.top.findNode("title")
  m.subtitle = m.top.findNode("subtitle")
  m.rowsGroup = m.top.findNode("rows")
  m.enter = m.top.findNode("enter")
  m.title.font = tvmFontScreenTitle()
  m.title.color = tvmText()
  m.subtitle.font = tvmFontMeta()
  m.subtitle.color = tvmMuted()
  m.page = "root"
  m.col = 0
  m.seq = 0
  m.rows = []
  m.spec = []
  buildPage()
  if m.enter <> invalid and not tvmReduceMotion() then m.enter.control = "start"
end sub

sub buildPage()
  while m.rowsGroup.getChildCount() > 0
    m.rowsGroup.removeChildIndex(0)
  end while
  m.rows = []
  if m.page = "sources"
    m.spec = tvmSourcesMenuSpec()
    m.title.text = "Sources"
    m.subtitle.text = "Back returns to You"
  else
    m.spec = tvmYouMenuSpec()
    m.title.text = "You"
    m.subtitle.text = "Back closes this menu"
  end if
  if m.global.hasField("kidsProfile") and m.global.kidsProfile
    m.spec = [{ id: "profiles", label: "Switch profile", detail: "Choose who is watching" }]
  else if m.page = "root"
    m.spec.Push({ id: "services", label: "Services", detail: "Your streaming channels" })
  end if
  rowW = 1040
  rowH = 176
  labelFont = tvmFont("semibold", tvmTypeSize(tvmTypeSecondary()))
  detailFont = tvmFontMeta()
  i = 0
  while i < m.spec.Count()
    row = CreateObject("roSGNode", "Group")
    row.translation = [0, i * (rowH + 16)]
    hl = CreateObject("roSGNode", "GlassPanel")
    hl.width = rowW
    hl.height = rowH
    hl.shape = "pill"
    hl.tintColor = "0x00000000"
    ring = CreateObject("roSGNode", "Poster")
    ring.uri = "pkg:/images/glass/focus-ring.9.png"
    ring.translation = [-16, -16]
    ring.width = rowW + 32
    ring.height = rowH + 32
    ring.visible = false
    title = CreateObject("roSGNode", "Label")
    title.text = m.spec[i].label
    title.font = labelFont
    title.color = tvmText()
    title.translation = [48, 18]
    title.width = rowW - 96
    title.height = 70
    detail = CreateObject("roSGNode", "Label")
    detail.text = m.spec[i].detail
    detail.font = detailFont
    detail.color = tvmMuted()
    detail.translation = [48, 92]
    detail.width = rowW - 96
    detail.height = 64
    row.appendChild(hl)
    row.appendChild(ring)
    row.appendChild(title)
    row.appendChild(detail)
    m.rowsGroup.appendChild(row)
    m.rows.Push({ hl: hl, ring: ring })
    i = i + 1
  end while
  m.glass.height = 280 + (m.spec.Count() * (rowH + 16)) + 60
  if m.col > m.spec.Count() - 1 then m.col = m.spec.Count() - 1
  paintFocus()
end sub

sub paintFocus()
  i = 0
  while i < m.rows.Count()
    focused = (i = m.col)
    if focused
      m.rows[i].hl.tintColor = tvmGlassTintFocused()
    else
      m.rows[i].hl.tintColor = "0x00000000"
    end if
    m.rows[i].hl.focused = focused
    m.rows[i].ring.visible = false
    i = i + 1
  end while
  if m.page = "sources"
    m.top.focusKey = "sources:" + m.spec[m.col].id
  else
    m.top.focusKey = "root:" + m.spec[m.col].id
  end if
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  parsed = parseFocusKey(key)
  want = "root"
  if m.page = "sources" then want = "sources"
  if parsed.zone <> want then return
  i = 0
  while i < m.spec.Count()
    if m.spec[i].id = parsed.a
      m.col = i
      paintFocus()
      return
    end if
    i = i + 1
  end while
end sub

sub emit(kind as String, id as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, id: id, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back"
    if m.page = "sources"
      m.page = "root"
      m.col = 4
      buildPage()
      return true
    end if
    return false
  end if
  if intent = "up" and m.col > 0
    m.col = m.col - 1
    paintFocus()
  else if intent = "down" and m.col < m.spec.Count() - 1
    m.col = m.col + 1
    paintFocus()
  else if intent = "select"
    id = m.spec[m.col].id
    if m.page = "root" and id = "sources"
      m.page = "sources"
      m.col = 0
      buildPage()
    else
      emit("select", id)
    end if
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
