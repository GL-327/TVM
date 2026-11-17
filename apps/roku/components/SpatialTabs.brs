' Reusable glass segmented control. Left/Right only previews the highlight
' (previewIndex); OK activates (activeIndex). The host routes keys through
' handleIntent(), so the strip never owns focus. Focus is stored per tab:
' rememberFocus({ id, key }) and recallFocus(id) keep one key per tab id.
' Active tab = filled pill, no rim. Previewed + focused = rim.
sub init()
  m.pillGlass = m.top.findNode("pillGlass")
  m.hl = m.top.findNode("hl")
  m.activePill = m.top.findNode("activePill")
  m.hlRing = m.top.findNode("hlRing")
  m.tabLabels = m.top.findNode("tabLabels")
  m.hlAnim = m.top.findNode("hlAnim")
  m.hlMove = m.top.findNode("hlMove")
  m.hlRingMove = m.top.findNode("hlRingMove")
  m.labelNodes = []
  m.pitch = 380
  m.hlX = -1.0
  m.memory = {}
  if m.global <> invalid
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paint")
  end if
end sub

sub rebuild()
  if m.tabLabels = invalid then return
  while m.tabLabels.getChildCount() > 0
    m.tabLabels.removeChildIndex(0)
  end while
  m.labelNodes = []
  labels = m.top.labels
  if labels = invalid then return
  size = tvmTypeSize(tvmTypeSecondary())
  i = 0
  while i < labels.Count()
    label = CreateObject("roSGNode", "Label")
    label.text = labels[i]
    label.font = tvmFont("semibold", size)
    label.width = m.pitch
    label.height = 144
    label.horizAlign = "center"
    label.vertAlign = "center"
    label.translation = [24 + (i * m.pitch), 0]
    m.tabLabels.appendChild(label)
    m.labelNodes.Push(label)
    i = i + 1
  end while
  m.pillGlass.width = (labels.Count() * m.pitch) + 48
  m.hlX = -1.0
  paint()
end sub

function shownIndex() as Integer
  idx = m.top.activeIndex
  if m.top.hasFocus = true then idx = m.top.previewIndex
  if idx < 0 then idx = 0
  return idx
end function

sub paint()
  if m.hl = invalid then return
  focused = (m.top.hasFocus = true)
  reduceT = tvmReduceTransparency()
  shown = shownIndex()
  m.activePill.visible = (shown <> m.top.activeIndex)
  m.activePill.translation = [24 + (m.top.activeIndex * m.pitch), 16]
  m.hl.active = (shown = m.top.activeIndex)
  m.hl.scaleRotateCenter = [180, 56]
  m.hl.scale = [1.0, 1.0]
  if focused and not tvmReduceMotion() then m.hl.scale = [tvmPillFocusScale(), tvmPillFocusScale()]
  m.hl.focused = focused
  m.hlRing.visible = false
  i = 0
  while i < m.labelNodes.Count()
    if i = m.top.activeIndex
      m.labelNodes[i].color = tvmAccentInk()
    else if i = shown or i = m.top.activeIndex
      m.labelNodes[i].color = tvmText()
    else
      m.labelNodes[i].color = tvmMuted()
    end if
    i = i + 1
  end while
  moveHighlight(24 + (shown * m.pitch))
end sub

sub moveHighlight(x as Float)
  y = 16
  if m.top.hasFocus and not tvmReduceMotion() then y = y - tvmFocusLift()
  if m.hlX = x and m.hlY = y then return
  m.hlY = y
  fromX = m.hlX
  m.hlX = x
  if fromX < 0 or tvmReduceMotion() or m.hlAnim = invalid
    m.hl.translation = [x, y]
    m.hlRing.translation = [x - 16, 0]
    return
  end if
  m.hlAnim.control = "stop"
  current = m.hl.translation
  startX = fromX
  if current <> invalid then startX = current[0]
  m.hlAnim.duration = tvmMotionTab()
  m.hlMove.keyValue = [current, [x, y]]
  m.hlRingMove.keyValue = [[startX - 16, 0], [x - 16, 0]]
  m.hlAnim.control = "start"
end sub

' Result: { type: "preview"|"activate"|"down"|"back"|"none", index, id }.
function handleIntent(intent as String) as Object
  count = m.labelNodes.Count()
  if intent = "left" or intent = "right"
    m.top.previewIndex = navStep(m.top.previewIndex, intent, count)
    return { type: "preview", index: m.top.previewIndex, id: tabIdAt(m.top.previewIndex) }
  end if
  if intent = "select"
    m.top.activeIndex = m.top.previewIndex
    return { type: "activate", index: m.top.activeIndex, id: tabIdAt(m.top.activeIndex) }
  end if
  if intent = "down" then return { type: "down", index: m.top.previewIndex, id: tabIdAt(m.top.previewIndex) }
  if intent = "back" then return { type: "back", index: m.top.previewIndex, id: "" }
  return { type: "none", index: m.top.previewIndex, id: "" }
end function

function tabIdAt(index as Integer) as String
  ids = m.top.ids
  if ids = invalid then return ""
  if index < 0 or index >= ids.Count() then return ""
  return ids[index]
end function

' arg: { id, key }
function rememberFocus(arg as Object) as Boolean
  if arg = invalid then return false
  m.memory[asText(aaGet(arg, "id", ""))] = asText(aaGet(arg, "key", ""))
  return true
end function

function recallFocus(id as String) as String
  if m.memory.DoesExist(id) then return m.memory[id]
  return ""
end function
