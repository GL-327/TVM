' One orb on the Network star. Every node shares the single orb texture
' (images/glass/orb.png); only the platform glyph, the upright label and the
' status dot differ. Focus lifts the node (scale 1.06 x depth, 12 units up,
' 150 ms) and shows the focus ring. A selected node that is not focused
' (focus is in the inspector) keeps a dim ring and a stronger tint.
' Reduce Motion: no depth scale, no lift, no animation; ring and tint stay.
sub init()
  m.body = m.top.findNode("body")
  m.halo = m.top.findNode("halo")
  m.tint = m.top.findNode("tint")
  m.orb = m.top.findNode("orb")
  m.glyph = m.top.findNode("glyph")
  m.label = m.top.findNode("label")
  m.dot = m.top.findNode("dot")
  m.anim = m.top.findNode("anim")
  m.animScale = m.top.findNode("animScale")
  m.animLift = m.top.findNode("animLift")
  m.curScale = 1.0
  m.curLift = 0
  m.placed = false
  m.label.font = tvmFont("semibold", tvmTypeSize(tvmTypeCaption()))
  if m.global <> invalid
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paintFocus")
    if m.global.hasField("reduceMotion") then m.global.observeField("reduceMotion", "paintFocus")
  end if
  layoutNode()
end sub

sub layoutNode()
  if m.body = invalid then return
  d = m.top.diameter
  m.top.width = d
  m.top.height = d
  m.body.scaleRotateCenter = [d / 2, d / 2]
  m.halo.translation = [-0.125 * d, -0.125 * d]
  m.halo.width = d * 1.25
  m.halo.height = d * 1.25
  m.tint.width = d
  m.tint.height = d
  m.orb.width = d
  m.orb.height = d
  glyphSize = 108
  if m.top.kind = "account" then glyphSize = 128
  m.glyph.width = glyphSize
  m.glyph.height = glyphSize
  m.glyph.translation = [(d - glyphSize) / 2, 56]
  m.label.width = d - 40
  m.label.height = 150
  m.label.translation = [20, 56 + glyphSize + 16]
  m.dot.translation = [d - 74, 30]
  paintContent()
end sub

sub paintContent()
  if m.label = invalid then return
  kind = m.top.kind
  name = m.top.name
  perLine = 14
  glyphName = hubPlatformGlyph(m.top.platform)
  m.dot.visible = (kind = "device")
  if kind = "account"
    glyphName = "user"
  else if kind = "more"
    glyphName = "dots"
    name = "More devices"
    if m.top.count > 0 then name = "+" + StrI(m.top.count).Trim() + " more"
  end if
  m.orb.uri = "pkg:/images/glass/orb.png"
  if kind = "account" then m.orb.uri = "pkg:/images/glass/orb-account.png"
  m.glyph.uri = "pkg:/images/hub/" + glyphName + ".png"
  m.glyph.blendColor = tvmText()
  parts = spatialLabel(name, perLine)
  text = parts.l1
  if parts.l2 <> "" then text = text + Chr(10) + parts.l2
  m.label.text = text
  m.dot.blendColor = hubStateColor(m.top.state)
  paintFocus()
end sub

sub paintFocus()
  if m.body = invalid then return
  focused = (m.top.focused = true)
  selected = (m.top.selected = true) and not focused
  reduceM = tvmReduceMotion()
  m.halo.visible = focused or selected
  if selected
    m.halo.opacity = 0.45
    m.halo.blendColor = "0xBEDAFFFF"
  else
    m.halo.opacity = 1.0
    m.halo.blendColor = "0xFFFFFFFF"
  end if
  if focused
    m.tint.blendColor = tvmGlassTintFocused()
    m.orb.blendColor = "0xFFFFFFFF"
  else if selected
    m.tint.blendColor = tvmGlassTintFocused()
    m.orb.blendColor = "0xE6EAF2FF"
  else
    m.tint.blendColor = tvmGlassTint()
    m.orb.blendColor = "0xC8CEDAFF"
  end if
  m.glyph.opacity = 1.0
  scaleTarget = 1.0
  liftTarget = 0
  if not reduceM
    scaleTarget = m.top.depth
    if focused
      scaleTarget = scaleTarget * tvmPillFocusScale()
      liftTarget = 0 - tvmFocusLift()
    end if
  end if
  applyTransform(scaleTarget, liftTarget)
end sub

sub applyTransform(scaleTarget as Float, liftTarget as Integer)
  if scaleTarget = m.curScale and liftTarget = m.curLift then return
  fromScale = m.curScale
  fromLift = m.curLift
  m.curScale = scaleTarget
  m.curLift = liftTarget
  if not m.placed or tvmReduceMotion() or m.anim = invalid or not m.top.visible
    m.placed = true
    m.body.scale = [scaleTarget, scaleTarget]
    m.body.translation = [0, liftTarget]
    return
  end if
  m.anim.control = "stop"
  m.anim.duration = tvmMotionFocus()
  m.animScale.keyValue = [[fromScale, fromScale], [scaleTarget, scaleTarget]]
  m.animLift.keyValue = [[0, fromLift], [0, liftTarget]]
  m.anim.control = "start"
end sub
