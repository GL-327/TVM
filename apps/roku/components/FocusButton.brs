sub init()
  m.top.focusable = true
  m.ring = m.top.findNode("ring")
  m.bg = m.top.findNode("bg")
  m.glyph = m.top.findNode("glyph")
  m.text = m.top.findNode("text")
  m.sub = m.top.findNode("sub")
  m.pill = m.top.findNode("pill")
  m.pillGlass = m.top.findNode("pillGlass")
  m.pillGlyph = m.top.findNode("pillGlyph")
  m.pillText = m.top.findNode("pillText")
  m.pillAnim = m.top.findNode("pillAnim")
  m.pillScale = m.top.findNode("pillScale")
  m.pillLift = m.top.findNode("pillLift")
  m.pressTimer = invalid
  m.text.font = tvmFont("bold", 36)
  m.sub.font = tvmFont("regular", 26)
  layout()
end sub

sub layout()
  if m.ring = invalid then return
  variant = m.top.variant
  if variant = invalid or variant = "" then variant = "glass"

  m.bg.visible = true
  m.ring.visible = true
  m.bg.shape = "card"
  m.text.horizAlign = "left"
  m.text.visible = true
  m.glyph.visible = false
  m.pill.visible = false

  if variant = "glassPill"
    layoutGlassPill()
    return
  end if

  if variant = "primary"
    setBox(496, 160, 480, 144)
    m.bg.tintColor = tvmText()
    m.text.color = tvmAccentInk()
    m.text.translation = [48, 44]
    m.sub.visible = false
  else if variant = "pill"
    setBox(496, 160, 480, 144)
    m.bg.shape = "card"
    m.bg.tintColor = tvmSurfaceHover()
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 480
    m.text.translation = [8, 44]
    m.sub.visible = false
  else if variant = "watchnow"
    setBox(428, 88, 428, 88)
    m.bg.visible = false
    m.ring.visible = false
    m.text.color = tvmFocus()
    m.text.font = tvmFont("bold", 40)
    m.text.translation = [0, 16]
    m.sub.visible = false
  else if variant = "chromelink"
    setBox(280, 80, 264, 64)
    m.bg.tintColor = "0x00000000"
    m.bg.shape = "card"
    m.text.color = "0xB3B3B3FF"
    m.text.font = tvmFont("bold", 32)
    m.text.translation = [24, 16]
    m.sub.visible = false
  else if variant = "row"
    setBox(3520, 192, 3504, 176)
    m.text.font = tvmFont("semibold", tvmTypeSize(tvmTypeSecondary()))
    m.sub.font = tvmFontMeta()
    m.bg.tintColor = tvmSurface()
    m.text.color = tvmText()
    m.text.translation = [56, 36]
    m.sub.visible = true
    m.sub.translation = [56, 104]
    m.sub.width = 3360
  else if variant = "season"
    setBox(3520, 144, 3504, 128)
    m.bg.tintColor = tvmSurface()
    m.text.color = tvmText()
    m.text.translation = [56, 36]
    m.sub.visible = false
  else if variant = "key"
    setBox(176, 128, 160, 112)
    m.bg.tintColor = tvmSurface()
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 160
    m.text.translation = [8, 32]
    m.sub.visible = false
  else if variant = "keywide"
    setBox(400, 128, 384, 112)
    m.bg.tintColor = tvmSurface()
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 384
    m.text.translation = [8, 32]
    m.sub.visible = false
  else if variant = "icon"
    setBox(144, 144, 128, 128)
    m.bg.tintColor = "0x00000000"
    m.bg.visible = false
    m.glyph.visible = true
    m.glyph.width = 72
    m.glyph.height = 72
    m.glyph.translation = [36, 36]
    m.text.visible = false
    m.sub.visible = false
  else if variant = "transport"
    setBox(176, 176, 160, 160)
    m.bg.visible = true
    m.bg.tintColor = "0xFFFFFF18"
    m.bg.shape = "card"
    m.glyph.visible = true
    m.glyph.width = 72
    m.glyph.height = 72
    m.glyph.translation = [52, 52]
    m.text.visible = false
    m.sub.visible = false
  else if variant = "transportPlay"
    setBox(208, 208, 192, 192)
    m.bg.visible = true
    m.bg.tintColor = tvmEmber()
    m.bg.shape = "card"
    m.glyph.visible = true
    m.glyph.width = 80
    m.glyph.height = 80
    m.glyph.translation = [64, 64]
    m.text.visible = false
    m.sub.visible = false
  else if variant = "ribbon"
    setBox(224, 240, 112, 112)
    m.bg.tintColor = "0x2A2A2AFF"
    m.bg.shape = "card"
    m.bg.translation = [56, 16]
    m.ring.width = 128
    m.ring.height = 128
    m.ring.translation = [48, 8]
    m.glyph.visible = true
    m.glyph.width = 56
    m.glyph.height = 56
    m.glyph.translation = [84, 44]
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 224
    m.text.translation = [0, 176]
    m.text.font = tvmFontCaption()
    m.sub.visible = false
  else
    setBox(496, 160, 480, 144)
    m.bg.tintColor = tvmSurfaceHover()
    m.text.color = tvmText()
    m.text.translation = [48, 44]
    m.sub.visible = false
  end if

  onIcon()
  onFocusStyle()
end sub

sub setBox(outerW as Integer, outerH as Integer, innerW as Integer, innerH as Integer)
  m.top.width = outerW
  m.top.height = outerH
  m.ring.width = outerW
  m.ring.height = outerH
  m.ring.translation = [0, 0]
  m.bg.width = innerW
  m.bg.height = innerH
  m.bg.translation = [(outerW - innerW) / 2, (outerH - innerH) / 2]
  m.top.scaleRotateCenter = [outerW / 2, outerH / 2]
end sub

sub onLabel()
  if m.text = invalid then return
  m.text.text = m.top.label
  if m.top.variant = "glassPill"
    m.pillText.text = m.top.label
    if m.top.pillWidth <= 0 then layoutGlassPill()
  end if
end sub

sub onDetail()
  if m.sub = invalid then return
  m.sub.text = m.top.detail
end sub

sub onIcon()
  if m.glyph = invalid then return
  uri = m.top.iconUri
  if uri <> invalid and uri <> ""
    m.glyph.uri = uri
    variant = m.top.variant
    if variant = "glassPill" then paintGlassPill()
    if variant = "ribbon" or variant = "icon" or variant = "transport" or variant = "transportPlay"
      m.glyph.visible = true
    end if
  end if
end sub

sub onFocusStyle()
  if m.ring = invalid then return
  focused = m.top.hasFocusStyle = true
  variant = m.top.variant
  if variant = invalid then variant = "glass"
  scale = tvmFocusScale()
  m.bg.focused = focused

  if variant = "glassPill"
    paintGlassPill()
    return
  end if
  if variant = "row" or variant = "season" or variant = "primary" or variant = "pill" then m.ring.visible = false

  if variant = "watchnow"
    m.top.scale = [1.0, 1.0]
    if focused
      m.text.color = tvmFocus()
    else
      m.text.color = tvmText()
    end if
    return
  end if

  if variant = "chromelink"
    m.top.scale = [1.0, 1.0]
    if focused
      m.ring.blendColor = tvmFocus()
      m.bg.tintColor = "0xFFFFFF1F"
      m.text.color = tvmText()
    else if m.top.active = true
      m.ring.blendColor = "0x00000000"
      m.bg.tintColor = "0x00000000"
      m.text.color = tvmText()
    else
      m.ring.blendColor = "0x00000000"
      m.bg.tintColor = "0x00000000"
      m.text.color = "0xB3B3B3FF"
    end if
    return
  end if

  if variant = "ribbon"
    m.top.scale = [1.0, 1.0]
    showLabel = focused or m.top.active = true
    m.text.visible = showLabel
    if focused
      m.ring.blendColor = tvmFocus()
      m.bg.tintColor = "0x3A3A3AFF"
    else
      m.ring.blendColor = "0x00000000"
      m.bg.tintColor = "0x2A2A2AFF"
    end if
    return
  end if

  if focused
    m.ring.blendColor = tvmFocus()
    m.top.scale = [scale, scale]
  else
    m.ring.blendColor = "0x00000000"
    m.top.scale = [1.0, 1.0]
  end if

  if variant = "primary"
    if focused
      m.bg.tintColor = tvmFocus()
    else
      m.bg.tintColor = tvmText()
    end if
  else if variant = "row" or variant = "season"
    if focused
      m.bg.tintColor = tvmSurfaceHover()
    else
      m.bg.tintColor = tvmSurface()
    end if
  else if variant = "pill" or variant = "key" or variant = "keywide"
    if focused
      m.bg.tintColor = "0x3A3A3AFF"
    else
      m.bg.tintColor = tvmSurfaceHover()
    end if
  else if variant = "transport"
    if focused
      m.bg.tintColor = "0xFFFFFF36"
    else
      m.bg.tintColor = "0xFFFFFF18"
    end if
  else if variant = "transportPlay"
    if focused
      m.bg.tintColor = tvmEmber()
    else
      m.bg.tintColor = "0xFF8A2BCC"
    end if
  end if
end sub

' ---------------------------------------------------------------------------
' glassPill: tint + pre-rendered rim/specular PNGs, Inter label. States:
'   rest      18% white tint, rim, specular sheen
'   focused   brighter tint, focus ring, scale 1.06 and a 6 px lift (150 ms)
'   pressed   scale 0.98 for 80 ms, darker tint (set pressed = true)
'   disabled  40% opacity plus a "Not available" line under the pill
'   accent    solid light fill with ink text (the primary Play pill)
' Reduce Motion keeps the ring and tint but drops scale, lift and animation.
' ---------------------------------------------------------------------------
function glassPillWidth() as Integer
  if m.top.pillWidth > 0 then return m.top.pillWidth
  size = tvmTypeSize(tvmTypePrimary())
  w = Int(Len(m.top.label) * size * 0.6) + 168
  if w < 340 then w = 340
  return w
end function

sub layoutGlassPill()
  w = glassPillWidth()
  h = 144
  m.bg.visible = false
  m.ring.visible = false
  m.text.visible = false
  m.sub.visible = false
  m.glyph.visible = false
  m.top.width = w
  m.top.height = h
  m.top.scaleRotateCenter = [w / 2, h / 2]
  m.pill.visible = true
  m.pill.scaleRotateCenter = [w / 2, h / 2]
  m.pillGlass.width = w
  m.pillGlass.height = h
  m.pillGlyph.width = 56
  m.pillGlyph.height = 56
  m.pillGlyph.translation = [64, 44]
  m.pillText.font = tvmFontLabel()
  m.pillText.width = w
  m.pillText.height = h
  m.pillText.translation = [0, 0]
  m.pillText.text = m.top.label
  m.sub.font = tvmFontMeta()
  m.sub.translation = [0, h + 12]
  m.sub.width = w
  m.sub.horizAlign = "center"
  paintGlassPill()
end sub

sub paintGlassPill()
  if m.pill = invalid then return
  if m.top.variant <> "glassPill" then return
  focused = m.top.hasFocusStyle = true
  pressed = m.top.pressed = true
  disabled = m.top.disabled = true
  accent = m.top.accent = true

  m.pillGlass.focused = focused
  m.pillGlass.active = accent or m.top.active
  m.pillGlass.selected = m.top.active and not focused
  m.pillGlass.tintColor = ""
  if pressed then m.pillGlass.tintColor = tvmGlassTintPressed()
  m.pillText.color = tvmText()
  if accent or m.top.active then m.pillText.color = tvmAccentInk()
  m.pill.opacity = 1.0
  if disabled then m.pill.opacity = 0.4
  uri = m.top.iconUri
  m.pillGlyph.visible = (uri <> "")
  if uri <> "" then m.pillGlyph.uri = uri
  m.pillGlyph.blendColor = m.pillText.color
  m.pillText.width = glassPillWidth()
  m.pillText.translation = [0, 0]
  if uri <> ""
    m.pillText.width = glassPillWidth() - 100
    m.pillText.translation = [88, 0]
  end if

  m.sub.visible = disabled
  if disabled
    m.sub.text = "Not available"
    m.sub.color = tvmFaint()
  end if

  toScale = [1.0, 1.0]
  toLift = [0.0, 0.0]
  if pressed
    toScale = [tvmPressScale(), tvmPressScale()]
  else if focused
    toScale = [tvmPillFocusScale(), tvmPillFocusScale()]
    toLift = [0.0, -1.0 * tvmFocusLift()]
  end if
  if tvmReduceMotion()
    toScale = [1.0, 1.0]
    toLift = [0.0, 0.0]
  end if
  animatePill(toScale, toLift)
end sub

sub animatePill(toScale as Object, toLift as Object)
  fromScale = m.pill.scale
  fromLift = m.pill.translation
  if fromScale = invalid then fromScale = [1.0, 1.0]
  if fromLift = invalid then fromLift = [0.0, 0.0]
  if tvmReduceMotion() or m.pillAnim = invalid
    m.pill.scale = toScale
    m.pill.translation = toLift
    return
  end if
  if Abs(fromScale[0] - toScale[0]) < 0.002 and Abs(fromLift[1] - toLift[1]) < 0.5 then return
  m.pillAnim.control = "stop"
  m.pillAnim.duration = tvmMotionFocus()
  if m.top.pressed = true then m.pillAnim.duration = tvmMotionPress()
  m.pillScale.keyValue = [fromScale, toScale]
  m.pillLift.keyValue = [fromLift, toLift]
  m.pillAnim.control = "start"
end sub

' Setting pressed = true plays the 80 ms press (scale 0.98), then releases.
sub onPressed()
  if m.pill = invalid then return
  if m.top.variant <> "glassPill" then return
  paintGlassPill()
  if m.top.pressed = true
    if m.pressTimer = invalid
      m.pressTimer = CreateObject("roSGNode", "Timer")
      m.pressTimer.repeat = false
      m.pressTimer.observeField("fire", "onPressDone")
    end if
    m.pressTimer.duration = tvmMotionPress()
    m.pressTimer.control = "stop"
    m.pressTimer.control = "start"
  end if
end sub

sub onPressDone()
  m.top.pressed = false
end sub
