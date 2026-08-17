sub init()
  m.glow = m.top.findNode("glow")
  m.ring = m.top.findNode("ring")
  m.fill = m.top.findNode("fill")
  m.mask = m.top.findNode("mask")
  m.art = m.top.findNode("art")
  m.caption = m.top.findNode("caption")
  m.yearLabel = m.top.findNode("yearLabel")
  m.progressTrack = m.top.findNode("progressTrack")
  m.progressFill = m.top.findNode("progressFill")
  m.caption.font = tvmFont("bold", 26)
  m.yearLabel.font = tvmFont("regular", 22)
  m.body = m.top.findNode("body")
  m.focusAnim = m.top.findNode("focusAnim")
  m.scaleInterp = m.top.findNode("scaleInterp")
  m.opacityInterp = m.top.findNode("opacityInterp")
  applyLayout()
end sub

sub onLayout()
  applyLayout()
end sub

sub applyLayout()
  landscape = m.top.layout = "landscape"
  if landscape
    w = 396
    h = 223
    m.mask.maskUri = "pkg:/images/chrome/poster-mask-wide.png"
  else
    w = 275
    h = 412
    m.mask.maskUri = "pkg:/images/chrome/poster-mask.png"
  end if
  m.artW = w
  m.artH = h
  m.top.width = w
  m.top.height = h + 96
  if m.body <> invalid
    m.body.scaleRotateCenter = [w / 2, h / 2]
  else
    m.top.scaleRotateCenter = [w / 2, h / 2]
  end if
  m.glow.width = w + 28
  m.glow.height = h + 28
  m.glow.translation = [-14, -14]
  m.glow.cornerRadius = 28
  m.ring.width = w + 14
  m.ring.height = h + 14
  m.ring.translation = [-7, -7]
  m.ring.cornerRadius = 24
  m.fill.width = w
  m.fill.height = h
  m.fill.cornerRadius = 20
  m.mask.translation = [0, 0]
  m.art.width = w
  m.art.height = h
  m.art.loadWidth = 780
  m.art.loadHeight = 1170
  if landscape
    m.art.loadWidth = 1280
    m.art.loadHeight = 720
  end if
  m.progressTrack.width = w - 24
  m.progressTrack.height = 8
  m.progressTrack.translation = [12, h - 16]
  m.progressFill.height = 8
  m.progressFill.translation = [12, h - 16]
  m.caption.width = w
  m.caption.height = 40
  m.caption.translation = [0, h + 12]
  m.yearLabel.width = w
  m.yearLabel.height = 32
  m.yearLabel.translation = [0, h + 52]
end sub

sub onItem()
  if m.art = invalid then return
  applyLayout()
  item = m.top.item
  if item = invalid then return

  title = asText(aaGet(item, "title", ""))
  episodeName = asText(aaGet(item, "episodeName", ""))
  if episodeName <> "" then title = episodeName
  m.caption.text = title

  year = aaGet(item, "year", invalid)
  season = aaGet(item, "season", invalid)
  ep = aaGet(item, "episode", invalid)
  if season <> invalid and ep <> invalid
    m.yearLabel.text = "S" + asText(season) + " E" + asText(ep)
  else if year <> invalid and asText(year) <> "" and asText(year) <> "0"
    m.yearLabel.text = asText(year)
  else
    m.yearLabel.text = ""
  end if

  poster = preferPosterUri(item)
  if poster <> ""
    m.art.uri = poster
    m.art.visible = true
  else
    m.art.uri = ""
    m.art.visible = false
  end if

  progress = aaGet(item, "progress", invalid)
  if progress <> invalid
    ratio = progress
    if ratio > 1 then ratio = 1
    if ratio < 0 then ratio = 0
    m.progressTrack.visible = true
    m.progressFill.visible = true
    m.progressFill.width = Int((m.artW - 24) * ratio)
  else
    m.progressTrack.visible = false
    m.progressFill.visible = false
  end if
end sub

sub onFocusStyle()
  focused = m.top.hasFocusStyle = true
  dimmed = m.top.dimmed = true
  scale = tvmPosterFocusScale()
  fromScale = [1.0, 1.0]
  toScale = [1.0, 1.0]
  fromOp = 1.0
  toOp = 1.0
  if m.body <> invalid
    current = m.body.scale
    if current <> invalid then fromScale = current
    fromOp = m.body.opacity
  end if
  if focused
    m.ring.color = tvmFocus()
    m.glow.color = "0xFFFFFF40"
    toScale = [scale, scale]
    toOp = 1
    m.caption.color = tvmText()
    m.yearLabel.color = tvmFaint()
  else
    m.ring.color = "0x00000000"
    m.glow.color = "0x00000000"
    toScale = [1.0, 1.0]
    m.caption.color = tvmText()
    m.yearLabel.color = tvmFaint()
    if dimmed then toOp = 0.45 else toOp = 1
  end if
  animateFocus(fromScale, toScale, fromOp, toOp)
end sub

sub animateFocus(fromScale as Object, toScale as Object, fromOp as Float, toOp as Float)
  if m.body = invalid
    m.top.scale = toScale
    m.top.opacity = toOp
    return
  end if
  if m.focusAnim = invalid or m.scaleInterp = invalid
    m.body.scale = toScale
    m.body.opacity = toOp
    return
  end if
  if Abs(fromScale[0] - toScale[0]) < 0.005 and Abs(fromOp - toOp) < 0.02
    m.body.scale = toScale
    m.body.opacity = toOp
    return
  end if
  m.focusAnim.control = "stop"
  m.scaleInterp.keyValue = [fromScale, toScale]
  if m.opacityInterp <> invalid then m.opacityInterp.keyValue = [fromOp, toOp]
  m.focusAnim.control = "start"
end sub
