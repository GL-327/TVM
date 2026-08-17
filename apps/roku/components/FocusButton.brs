sub init()
  m.top.focusable = true
  m.ring = m.top.findNode("ring")
  m.bg = m.top.findNode("bg")
  m.glyph = m.top.findNode("glyph")
  m.text = m.top.findNode("text")
  m.sub = m.top.findNode("sub")
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
  m.bg.cornerRadius = 24
  m.ring.cornerRadius = 32
  m.text.horizAlign = "left"
  m.text.visible = true
  m.glyph.visible = false

  if variant = "primary"
    setBox(496, 160, 480, 144)
    m.bg.color = tvmText()
    m.text.color = tvmAccentInk()
    m.text.translation = [48, 44]
    m.sub.visible = false
  else if variant = "pill"
    setBox(496, 160, 480, 144)
    m.bg.cornerRadius = 72
    m.ring.cornerRadius = 80
    m.bg.color = tvmSurfaceHover()
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
    m.bg.color = "0x00000000"
    m.bg.cornerRadius = 40
    m.ring.cornerRadius = 48
    m.text.color = "0xB3B3B3FF"
    m.text.font = tvmFont("bold", 32)
    m.text.translation = [24, 16]
    m.sub.visible = false
  else if variant = "row"
    setBox(3520, 192, 3504, 176)
    m.bg.color = tvmSurface()
    m.text.color = tvmText()
    m.text.translation = [56, 36]
    m.sub.visible = true
    m.sub.translation = [56, 104]
    m.sub.width = 3360
  else if variant = "season"
    setBox(3520, 144, 3504, 128)
    m.bg.color = tvmSurface()
    m.text.color = tvmText()
    m.text.translation = [56, 36]
    m.sub.visible = false
  else if variant = "key"
    setBox(176, 128, 160, 112)
    m.bg.color = tvmSurface()
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 160
    m.text.translation = [8, 32]
    m.sub.visible = false
  else if variant = "keywide"
    setBox(400, 128, 384, 112)
    m.bg.color = tvmSurface()
    m.text.color = tvmText()
    m.text.horizAlign = "center"
    m.text.width = 384
    m.text.translation = [8, 32]
    m.sub.visible = false
  else if variant = "icon"
    setBox(144, 144, 128, 128)
    m.bg.color = "0x00000000"
    m.bg.visible = false
    m.ring.cornerRadius = 72
    m.glyph.visible = true
    m.glyph.width = 72
    m.glyph.height = 72
    m.glyph.translation = [36, 36]
    m.text.visible = false
    m.sub.visible = false
  else if variant = "ribbon"
    setBox(224, 240, 112, 112)
    m.bg.color = "0x2A2A2AFF"
    m.bg.cornerRadius = 56
    m.ring.cornerRadius = 64
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
    m.bg.color = tvmSurfaceHover()
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
    if m.top.variant = "ribbon" or m.top.variant = "icon" then m.glyph.visible = true
  end if
end sub

sub onFocusStyle()
  if m.ring = invalid then return
  focused = m.top.hasFocusStyle = true
  variant = m.top.variant
  if variant = invalid then variant = "glass"
  scale = tvmFocusScale()

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
      m.ring.color = tvmFocus()
      m.bg.color = "0xFFFFFF1F"
      m.text.color = tvmText()
    else if m.top.active = true
      m.ring.color = "0x00000000"
      m.bg.color = "0x00000000"
      m.text.color = tvmText()
    else
      m.ring.color = "0x00000000"
      m.bg.color = "0x00000000"
      m.text.color = "0xB3B3B3FF"
    end if
    return
  end if

  if variant = "ribbon"
    m.top.scale = [1.0, 1.0]
    showLabel = focused or m.top.active = true
    m.text.visible = showLabel
    if focused
      m.ring.color = tvmFocus()
      m.bg.color = "0x3A3A3AFF"
    else
      m.ring.color = "0x00000000"
      m.bg.color = "0x2A2A2AFF"
    end if
    return
  end if

  if focused
    m.ring.color = tvmFocus()
    m.top.scale = [scale, scale]
  else
    m.ring.color = "0x00000000"
    m.top.scale = [1.0, 1.0]
  end if

  if variant = "primary"
    if focused
      m.bg.color = tvmFocus()
    else
      m.bg.color = tvmText()
    end if
  else if variant = "row" or variant = "season"
    if focused
      m.bg.color = tvmSurfaceHover()
    else
      m.bg.color = tvmSurface()
    end if
  else if variant = "pill" or variant = "key" or variant = "keywide"
    if focused
      m.bg.color = "0x3A3A3AFF"
    else
      m.bg.color = tvmSurfaceHover()
    end if
  end if
end sub
