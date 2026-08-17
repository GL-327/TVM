sub init()
  m.ring = m.top.findNode("ring")
  m.tile = m.top.findNode("tile")
  m.caption = m.top.findNode("caption")
  m.caption.font = tvmFontCaption()
  m.top.width = 304
  m.top.height = 400
  m.top.scaleRotateCenter = [152, 152]
  paint()
end sub

function hslApprox(hue as Integer) as String
  h = hue mod 360
  if h < 0 then h = h + 360
  sector = Int(h / 60)
  f = (h / 60.0) - sector
  p = 40
  q = Int(220 - f * 80)
  t = Int(140 + f * 80)
  v = 220
  r = v
  g = p
  b = p
  if sector = 0
    r = v : g = t : b = p
  else if sector = 1
    r = q : g = v : b = p
  else if sector = 2
    r = p : g = v : b = t
  else if sector = 3
    r = p : g = q : b = v
  else if sector = 4
    r = t : g = p : b = v
  else
    r = v : g = p : b = q
  end if
  return "0x" + hex2(r) + hex2(g) + hex2(b) + "FF"
end function

function hex2(value as Integer) as String
  n = value
  if n < 0 then n = 0
  if n > 255 then n = 255
  digits = "0123456789ABCDEF"
  hi = Int(n / 16)
  lo = n - (hi * 16)
  return Mid(digits, hi + 1, 1) + Mid(digits, lo + 1, 1)
end function

sub paint()
  if m.tile = invalid then return
  m.tile.color = hslApprox(m.top.hue)
  m.caption.text = m.top.name
end sub

sub onFocus()
  focused = m.top.hasFocusStyle = true
  scale = tvmFocusScale()
  if focused
    m.ring.color = tvmFocus()
    m.top.scale = [scale, scale]
    m.caption.color = tvmText()
  else
    m.ring.color = "0x00000000"
    m.top.scale = [1.0, 1.0]
    m.caption.color = tvmMuted()
  end if
end sub
