' Shared rounded glass, including its fill. Every layer uses the same SDF
' silhouette and 9-patch guides. No Rectangle.cornerRadius dependency.
sub init()
  m.shadow = m.top.findNode("shadow")
  m.glow = m.top.findNode("glow")
  m.tint = m.top.findNode("tint")
  m.bodyGradient = m.top.findNode("bodyGradient")
  m.rim = m.top.findNode("rim")
  m.sheen = m.top.findNode("sheen")
  if m.global <> invalid
    if m.global.hasField("reduceTransparency") then m.global.observeField("reduceTransparency", "paint")
  end if
  layout()
end sub

sub layout()
  if m.tint = invalid then return
  w = m.top.width
  h = m.top.height
  shape = m.top.shape
  if shape <> "pill" and shape <> "card" and shape <> "tab" and shape <> "chip" then shape = "panel"
  m.shape = shape
  prefix = "pkg:/images/glass/" + shape
  m.tint.uri = prefix + "-fill.9.png"
  m.bodyGradient.uri = prefix + "-body.9.png"
  m.sheen.uri = prefix + "-gloss.9.png"
  m.shadow.uri = prefix + "-shadow.9.png"
  m.glow.uri = prefix + "-focus-glow.9.png"
  for each layer in [m.tint, m.bodyGradient, m.sheen, m.rim]
    layer.width = w
    layer.height = h
  end for
  m.shadow.translation = [-72, -72]
  m.shadow.width = w + 144
  m.shadow.height = h + 144
  m.glow.translation = [-48, -48]
  m.glow.width = w + 96
  m.glow.height = h + 96
  paint()
end sub

sub paint()
  if m.tint = invalid then return
  tint = tvmGlassTint()
  if m.top.focused then tint = tvmGlassTintFocused()
  if m.top.active then tint = "0xFFFFFF38"
  if m.top.tintColor <> "" then tint = m.top.tintColor
  if m.top.accent then tint = m.top.accentColor
  m.tint.blendColor = tint
  m.rim.uri = "pkg:/images/glass/" + m.shape + ".9.png"
  m.rim.blendColor = "0xF2F9FFFF"
  if m.top.focused
    m.rim.uri = "pkg:/images/glass/" + m.shape + "-focus.9.png"
    m.rim.blendColor = "0xE6F4FFFF"
  end if
  if m.shape = "pill" and (m.top.selected or m.top.active) then m.rim.uri = "pkg:/images/glass/pill-thumb.9.png"
  if m.top.selected then m.rim.blendColor = "0xFFFFFFFF"
  m.rim.opacity = tvmGlassRimOpacity()
  if m.top.focused then m.rim.opacity = 1.0
  m.glow.visible = (m.top.focused or m.top.active)
  if m.top.focused
    m.glow.opacity = 0.94
    m.glow.blendColor = "0xCFE8FFFF"
  else if m.top.active
    m.glow.opacity = 0.42
    m.glow.blendColor = "0xFFFFFFCC"
  end if
  m.shadow.opacity = 0.85
  if m.top.focused then m.shadow.opacity = 1.0
  reduced = tvmReduceTransparency()
  m.bodyGradient.visible = not reduced
  m.sheen.visible = not reduced
  m.bodyGradient.uri = "pkg:/images/glass/" + m.shape + "-body.9.png"
  if m.top.accent and m.shape = "pill" and m.top.accentColor = "0x2F6BFF8C" and not reduced
    m.tint.blendColor = "0x00000000"
    m.bodyGradient.uri = "pkg:/images/glass/pill-accent.9.png"
  end if
  if not reduced
    m.bodyGradient.blendColor = "0xEAF6FFFF"
    m.bodyGradient.opacity = 0.85
    m.sheen.blendColor = "0xFFFFFFF2"
    m.sheen.opacity = 0.80
    if m.top.focused
      m.bodyGradient.opacity = 1.0
      m.sheen.opacity = 1.0
    else if m.top.active
      m.sheen.opacity = 0.95
    end if
  end if
end sub
