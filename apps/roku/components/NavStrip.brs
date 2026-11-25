' Main navigation: TVM wordmark, a centred glass pill with Home / Movies /
' Series / Live TV / Library / Search and one sliding highlight, and the
' profile orb on the right. The strip never owns keys: the screen that hosts it
' moves focusCol (0..5 tabs, 6 the orb) and reads the spec through tvmNavSpec().
' Active tab = filled pill without a rim. Focused = rim + scale (orb scales).
sub init()
  m.pillGlass = m.top.findNode("pillGlass")
  m.hl = m.top.findNode("hl")
  m.activePill = m.top.findNode("activePill")
  m.hlRing = m.top.findNode("hlRing")
  m.tabs = m.top.findNode("tabs")
  m.orbGroup = m.top.findNode("orbGroup")
  m.orbRing = m.top.findNode("orbRing")
  m.orbInitial = m.top.findNode("orbInitial")
  m.hlAnim = m.top.findNode("hlAnim")
  m.hlMove = m.top.findNode("hlMove")
  m.hlRingMove = m.top.findNode("hlRingMove")
  m.hlStretch = m.top.findNode("hlStretch")
  m.spec = tvmNavSpec()
  m.labels = []
  m.pillX = 996
  m.pitch = 300
  m.orbInitial.font = tvmFontLabel()
  size = tvmTypeSize(tvmTypeSecondary())
  i = 0
  while i < m.spec.Count()
    label = CreateObject("roSGNode", "Label")
    label.text = m.spec[i].label
    label.font = tvmFont("semibold", size)
    label.width = m.pitch
    label.height = 144
    label.horizAlign = "center"
    label.vertAlign = "center"
    label.translation = [24 + (i * m.pitch), 0]
    m.tabs.appendChild(label)
    m.labels.Push(label)
    i = i + 1
  end while
  m.orbGroup.scaleRotateCenter = [72, 72]
  m.hlX = -1.0
  if m.global <> invalid
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paint")
  end if
  paint()
end sub

sub onProfile()
  if m.orbInitial = invalid then return
  name = m.top.profileName.Trim()
  if name = "" then name = "T"
  m.orbInitial.text = UCase(Left(name, 1))
end sub

function shownCol() as Integer
  active = tvmNavIndex(m.top.activeId)
  if m.top.hasBarFocus = true and m.top.focusCol >= 0 and m.top.focusCol < m.spec.Count()
    return m.top.focusCol
  end if
  return active
end function

sub paint()
  if m.hl = invalid then return
  barFocus = (m.top.hasBarFocus = true)
  onOrb = (barFocus and m.top.focusCol >= m.spec.Count())
  onTab = (barFocus and not onOrb)
  reduceT = tvmReduceTransparency()
  active = tvmNavIndex(m.top.activeId)
  col = shownCol()

  m.activePill.visible = (col <> active)
  m.activePill.translation = [m.pillX + 24 + (active * m.pitch), 88]
  m.hl.active = (col = active)
  m.hl.scaleRotateCenter = [148, 56]
  m.hl.scale = [1.0, 1.0]
  if onTab and not tvmReduceMotion() then m.hl.scale = [tvmPillFocusScale(), tvmPillFocusScale()]
  m.hl.focused = onTab
  m.hlRing.visible = false

  i = 0
  while i < m.labels.Count()
    if i = active
      m.labels[i].color = "0xFFFFFFFF"
    else if i = col or i = active
      m.labels[i].color = tvmText()
    else
      m.labels[i].color = tvmMuted()
    end if
    i = i + 1
  end while

  moveHighlight(m.pillX + 24 + (col * m.pitch))

  m.orbRing.visible = onOrb
  if onOrb and not tvmReduceMotion()
    m.orbGroup.scale = [tvmPillFocusScale(), tvmPillFocusScale()]
  else
    m.orbGroup.scale = [1.0, 1.0]
  end if
end sub

sub moveHighlight(x as Float)
  y = 88
  if m.top.hasBarFocus and m.top.focusCol < m.spec.Count() and not tvmReduceMotion() then y = y - tvmFocusLift()
  if m.hlX = x and m.hlY = y then return
  m.hlY = y
  fromX = m.hlX
  m.hlX = x
  if fromX < 0 or tvmReduceMotion() or m.hlAnim = invalid
    m.hl.translation = [x, y]
    m.hlRing.translation = [x - 16, 72]
    return
  end if
  m.hlAnim.control = "stop"
  current = m.hl.translation
  startX = fromX
  if current <> invalid then startX = current[0]
  m.hlAnim.duration = tvmMotionTab()
  overshoot = (x - startX) * 0.025
  if overshoot > 24 then overshoot = 24
  if overshoot < -24 then overshoot = -24
  m.hlMove.keyValue = [current, [x + overshoot, y], [x, y]]
  m.hlRingMove.keyValue = [[startX - 16, 72], [x - 16, 72]]
  scale = 1.0
  if m.top.hasBarFocus then scale = tvmPillFocusScale()
  m.hlStretch.keyValue = [[scale, scale], [1.18, scale], [scale, scale]]
  m.hlAnim.control = "start"
end sub
