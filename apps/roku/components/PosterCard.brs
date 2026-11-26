' One card = one decoded texture at about 2x its FHD display size
' (landscape 400x225, portrait 300x450), a focus-ring 9-patch (replaces the old
' glow + ring rectangles), a progress bar and a single caption that only shows
' on the focused card. Reduce Motion drops the scale and lift but keeps the ring.
sub init()
  m.glow = m.top.findNode("glow")
  m.ring = m.top.findNode("ring")
  m.fill = m.top.findNode("fill")
  m.mask = m.top.findNode("mask")
  m.art = m.top.findNode("art")
  m.art.observeField("loadStatus", "onArtLoad")
  m.fallbackTitle = m.top.findNode("fallbackTitle")
  m.fallbackTitle.font = tvmFontSecondary()
  m.caption = m.top.findNode("caption")
  m.progressTrack = m.top.findNode("progressTrack")
  m.progressFill = m.top.findNode("progressFill")
  m.badgeBg = m.top.findNode("badgeBg")
  m.badgeText = m.top.findNode("badgeText")
  m.body = m.top.findNode("body")
  m.focusAnim = m.top.findNode("focusAnim")
  m.scaleInterp = m.top.findNode("scaleInterp")
  m.liftInterp = m.top.findNode("liftInterp")
  m.opacityInterp = m.top.findNode("opacityInterp")
  m.maskInterp = m.top.findNode("maskInterp")
  m.caption.font = tvmFontMeta()
  if m.badgeText <> invalid then m.badgeText.font = tvmFont("semibold", 26)
  if m.global <> invalid and m.global.hasField("posterTitles") then m.global.observeField("posterTitles", "onFocusStyle")
  if m.global <> invalid and m.global.hasField("rokuPrefs") then m.global.observeField("rokuPrefs", "onItem")
  if m.global <> invalid and m.global.hasField("remoteFlags") then m.global.observeField("remoteFlags", "onItem")
  m.landscape = false
  applyLayout()
end sub

sub onLayout()
  applyLayout()
end sub

sub applyLayout()
  landscape = (m.top.layout = "landscape")
  if m.landscape = landscape and m.artW <> invalid then return
  m.landscape = landscape
  if landscape
    w = 800
    h = 450
    m.mask.maskUri = "pkg:/images/glass/mask-wide.png"
    m.art.loadWidth = 400
    m.art.loadHeight = 225
  else
    w = 560
    h = 840
    m.mask.maskUri = "pkg:/images/glass/mask-portrait.png"
    m.art.loadWidth = 300
    m.art.loadHeight = 450
  end if
  m.artW = w
  m.artH = h
  m.top.width = w
  m.top.height = h + 96
  m.body.scaleRotateCenter = [w / 2, h / 2]
  m.glow.translation = [-48, -48]
  m.glow.width = w + 96
  m.glow.height = h + 96
  m.ring.translation = [-16, -16]
  m.ring.width = w + 32
  m.ring.height = h + 32
  m.fill.width = w
  m.fill.height = h
  m.mask.translation = [0, 0]
  m.mask.maskSize = [w * tvmUiScale(), h * tvmUiScale()]
  m.art.width = w
  m.art.height = h
  m.fallbackTitle.translation = [32, 32]
  m.fallbackTitle.width = w - 64
  m.fallbackTitle.height = h - 64
  m.progressTrack.width = w - 64
  m.progressTrack.height = 8
  m.progressTrack.translation = [32, h - 40]
  m.progressFill.height = 8
  m.progressFill.translation = [32, h - 40]
  m.caption.width = w
  m.caption.height = 88
  m.caption.wrap = true
  m.caption.maxLines = 2
  m.caption.translation = [0, h + 20]
end sub

sub onItem()
  if m.art = invalid then return
  applyLayout()
  item = m.top.item
  if item = invalid then return

  title = asText(aaGet(item, "title", ""))
  episodeName = asText(aaGet(item, "episodeName", ""))
  if episodeName <> "" then title = episodeName
  season = aaGet(item, "season", invalid)
  ep = aaGet(item, "episode", invalid)
  progress = aaGet(item, "progress", invalid)
  ratio = cardProgressRatio(progress)
  watched = (aaGet(item, "watched", false) = true) or (ratio > 0)
  isEpisode = (season <> invalid and ep <> invalid)
  spoilerHidden = isEpisode and not watched and tvmExtraEnabled("spoilerBlur", false)
  if isEpisode
    if spoilerHidden
      title = "S" + asText(season) + " E" + asText(ep) + "  ·  Unwatched"
    else
      title = "S" + asText(season) + " E" + asText(ep) + "  " + title
    end if
  end if
  m.caption.text = title
  m.fallbackTitle.text = title
  if spoilerHidden then m.fallbackTitle.text = "S" + asText(season) + " E" + asText(ep) + Chr(10) + "Spoiler hidden"
  m.fallbackTitle.visible = true

  poster = preferCardUri(item, m.landscape)
  if poster <> "" and not spoilerHidden
    m.art.uri = poster
    m.art.visible = true
  else
    m.art.uri = ""
    m.art.visible = false
  end if
  m.fallbackTitle.visible = (spoilerHidden or poster = "" or m.art.loadStatus <> "ready")
  paintQualityBadge(item, spoilerHidden)
  onFocusStyle()

  if ratio > 0
    if ratio > 1 then ratio = 1
    m.progressTrack.visible = true
    m.progressFill.visible = true
    m.progressFill.width = Int((m.artW - 64) * ratio)
  else
    m.progressTrack.visible = false
    m.progressFill.visible = false
  end if
end sub

function cardProgressRatio(progress as Dynamic) as Float
  if progress = invalid then return 0.0
  if GetInterface(progress, "ifAssociativeArray") <> invalid
    r = aaGet(progress, "ratio", invalid)
    if r <> invalid then return r * 1.0
    position = aaGet(progress, "position", 0)
    dur = aaGet(progress, "duration", 0)
    if dur > 0 then return (position * 1.0) / (dur * 1.0)
    return 0.0
  end if
  return progress * 1.0
end function

sub paintQualityBadge(item as Object, spoilerHidden as Boolean)
  if m.badgeBg = invalid or m.badgeText = invalid then return
  if spoilerHidden or not tvmExtraEnabled("qualityBadges")
    m.badgeBg.visible = false : m.badgeText.visible = false : return
  end if
  badge = asText(aaGet(item, "qualityBadge", ""))
  if badge = ""
    parts = []
    q = aaGet(item, "resolution", aaGet(item, "height", 0))
    if q = 2160
      parts.Push("4K")
    else if q = 1080 or q = 720
      parts.Push(StrI(q).Trim() + "p")
    else
      qStr = asText(aaGet(item, "quality", ""))
      if qStr <> "" then parts.Push(UCase(qStr))
    end if
    hdr = LCase(asText(aaGet(item, "hdr", "")))
    if hdr = "dv" then parts.Push("DV")
    if hdr = "hdr10+" then parts.Push("HDR10+")
    if hdr = "hdr10" or hdr = "hdr" then parts.Push("HDR")
    if aaGet(item, "atmos", false) = true then parts.Push("Atmos")
    badge = parts.Join(" · ")
  end if
  if badge = ""
    m.badgeBg.visible = false : m.badgeText.visible = false : return
  end if
  bw = Int(Len(badge) * 18) + 32
  if bw < 84 then bw = 84
  if bw > m.artW - 40 then bw = m.artW - 40
  m.badgeBg.width = bw : m.badgeBg.height = 44
  m.badgeBg.translation = [m.artW - bw - 18, 18]
  m.badgeText.width = bw - 16 : m.badgeText.height = 44
  m.badgeText.translation = [m.artW - bw - 10, 18]
  m.badgeText.text = badge
  m.badgeBg.visible = true : m.badgeText.visible = true
end sub

sub onArtLoad()
  if m.art.loadStatus = "ready" then m.fallbackTitle.visible = false
  if m.art.loadStatus = "failed" then m.art.visible = false
end sub

sub onFocusStyle()
  focused = (m.top.hasFocusStyle = true)
  dimmed = (m.top.dimmed = true)
  fromScale = [1.0, 1.0]
  toScale = [1.0, 1.0]
  fromLift = [0.0, 0.0]
  toLift = [0.0, 0.0]
  fromOp = 1.0
  toOp = 1.0
  current = m.body.scale
  if current <> invalid then fromScale = current
  currentLift = m.body.translation
  if currentLift <> invalid then fromLift = currentLift
  fromOp = m.body.opacity

  m.glow.visible = focused
  m.ring.visible = focused
  m.caption.visible = focused or loadFlag("posterTitles")
  m.caption.wrap = focused
  m.caption.maxLines = 1
  if focused then m.caption.maxLines = 2
  if focused
    if not tvmReduceMotion()
      toScale = [tvmPosterFocusScale(), tvmPosterFocusScale()]
      toLift = [0.0, -1.0 * tvmFocusLift()]
    end if
  else if dimmed
    toOp = 0.5
  end if
  if not focused
    m.focusAnim.control = "stop"
    m.body.scale = toScale
    m.body.translation = toLift
    m.body.opacity = toOp
    m.mask.maskSize = [m.artW * tvmUiScale(), m.artH * tvmUiScale()]
    return
  end if
  animateFocus(fromScale, toScale, fromLift, toLift, fromOp, toOp)
end sub

sub animateFocus(fromScale as Object, toScale as Object, fromLift as Object, toLift as Object, fromOp as Float, toOp as Float)
  if m.focusAnim = invalid or tvmReduceMotion()
    m.body.scale = toScale
    m.body.translation = toLift
    m.body.opacity = toOp
    m.mask.maskSize = [m.artW * tvmUiScale() * toScale[0], m.artH * tvmUiScale() * toScale[1]]
    return
  end if
  if Abs(fromScale[0] - toScale[0]) < 0.005 and Abs(fromLift[1] - toLift[1]) < 0.5 and Abs(fromOp - toOp) < 0.02
    m.body.scale = toScale
    m.body.translation = toLift
    m.body.opacity = toOp
    return
  end if
  m.focusAnim.control = "stop"
  m.focusAnim.duration = tvmMotionFocus()
  m.scaleInterp.keyValue = [fromScale, toScale]
  m.liftInterp.keyValue = [fromLift, toLift]
  m.opacityInterp.keyValue = [fromOp, toOp]
  m.maskInterp.keyValue = [[m.artW * tvmUiScale() * fromScale[0], m.artH * tvmUiScale() * fromScale[1]], [m.artW * tvmUiScale() * toScale[0], m.artH * tvmUiScale() * toScale[1]]]
  m.focusAnim.control = "start"
end sub
