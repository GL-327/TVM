sub init()
  m.body = m.top.findNode("body")
  m.ring = m.top.findNode("ring")
  m.art = m.top.findNode("art")
  m.focusAnim = m.top.findNode("focusAnim")
  m.scaleInterp = m.top.findNode("scaleInterp")
  m.top.width = 284
  m.top.height = 155
  if m.body <> invalid then m.body.scaleRotateCenter = [142, 78]
  m.ring.width = 300
  m.ring.height = 171
  m.ring.translation = [-8, -8]
end sub

sub onAppId()
  app = tvmAppById(m.top.appId)
  if app = invalid then return
  m.art.uri = app.tile
end sub

sub onFocusStyle()
  focused = m.top.hasFocusStyle = true
  fromScale = [1.0, 1.0]
  toScale = [1.0, 1.0]
  if m.body <> invalid
    current = m.body.scale
    if current <> invalid then fromScale = current
  end if
  if focused
    m.ring.color = tvmFocus()
    toScale = [1.1, 1.1]
  else
    m.ring.color = "0x00000000"
    toScale = [1.0, 1.0]
  end if
  if m.body = invalid or m.focusAnim = invalid or m.scaleInterp = invalid
    m.top.scale = toScale
    return
  end if
  if Abs(fromScale[0] - toScale[0]) < 0.005
    m.body.scale = toScale
    return
  end if
  m.focusAnim.control = "stop"
  m.scaleInterp.keyValue = [fromScale, toScale]
  m.focusAnim.control = "start"
end sub
