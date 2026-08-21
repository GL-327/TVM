' Focus dance — Video vs overlay (do not give the Video node SceneGraph focus)
'
' Firmware will try to focus Video on play / buffer / seek. If that sticks,
' onKeyEvent never reaches this Group and recap / progress / next cannot be
' selected. SceneGraph focus therefore lives on PlayerScreen only.
'
' Rules:
' 1. video.enableUI = false and video.focusable = false.
' 2. Overlay buttons stay focusable = false. Selection is software
'    (zone + col + hasFocusStyle), never child.setFocus.
' 3. After play / seek / state changes, claimOverlayFocus() puts focus
'    back on this Group. A short watchdog does the same if firmware steals.
' 4. "video" and "skip" zones keep Left/Right seek. OK on Skip Recap
'    activates it. hideChrome must not move SceneGraph focus onto Video.
' 5. Zones: video → progress → chrome row (back, rewind, pause, forward,
'    skip recap, next). Skip Recap auto-focuses when it first appears.
' 6. TVMScene also reclaims PlayerScreen if a key reaches the Scene.
'
sub init()
  m.top.focusable = true
  m.video = m.top.findNode("video")
  m.status = m.top.findNode("status")
  m.chrome = m.top.findNode("chrome")
  m.heading = m.top.findNode("heading")
  m.kicker = m.top.findNode("kicker")
  m.time = m.top.findNode("time")
  m.barTrack = m.top.findNode("barTrack")
  m.barRing = m.top.findNode("barRing")
  m.barFill = m.top.findNode("barFill")
  m.barGlow = m.top.findNode("barGlow")
  m.barThumb = m.top.findNode("barThumb")
  m.titleRule = m.top.findNode("titleRule")
  m.lockup = m.top.findNode("lockup")
  m.buffer = m.top.findNode("buffer")
  m.back = m.top.findNode("back")
  m.rewind = m.top.findNode("rewind")
  m.pause = m.top.findNode("pause")
  m.forward = m.top.findNode("forward")
  m.skipRecap = m.top.findNode("skipRecap")
  if m.skipRecap = invalid then m.skipRecap = m.top.findNode("recap")
  m.nextUp = m.top.findNode("nextUp")
  m.chromeFade = m.top.findNode("chromeFade")
  m.chromeFadeInterp = m.top.findNode("chromeFadeInterp")
  m.heading.font = tvmFontTitle()
  m.heading.color = tvmText()
  if m.kicker <> invalid
    m.kicker.font = tvmFont("bold", 28)
    m.kicker.color = tvmEmber()
  end if
  if m.titleRule <> invalid then m.titleRule.color = tvmEmber()
  if m.lockup <> invalid then m.lockup.kind = "wordmark"
  m.time.font = tvmFontBody()
  m.time.color = tvmText()
  m.status.font = tvmFontBody()
  if m.barFill <> invalid then m.barFill.color = tvmEmber()
  if m.barGlow <> invalid then m.barGlow.color = "0xFF8A2B66"
  if m.barThumb <> invalid then m.barThumb.color = tvmFocus()
  if m.buffer <> invalid then m.buffer.color = tvmEmber()
  m.back.variant = "icon"
  m.back.iconUri = "pkg:/images/icons/back.png"
  m.rewind.variant = "transport"
  m.rewind.iconUri = "pkg:/images/icons/rewind.png"
  m.pause.variant = "transportPlay"
  m.pause.iconUri = "pkg:/images/icons/pause.png"
  m.forward.variant = "transport"
  m.forward.iconUri = "pkg:/images/icons/forward.png"
  if m.barFill <> invalid then m.barFill.observeField("width", "paintThumb")
  if m.chrome <> invalid then m.chrome.opacity = 1
  paintThumb()
  if m.skipRecap <> invalid
    m.skipRecap.variant = "pill"
    m.skipRecap.label = "Skip Recap"
    m.skipRecap.itemId = "player-skip-recap"
    m.skipRecap.visible = false
  end if
  if m.nextUp <> invalid
    m.nextUp.variant = "pill"
    m.nextUp.label = "Next"
    m.nextUp.itemId = "player-next"
    m.nextUp.visible = false
  end if
  lockOverlayChildFocus()
  m.seq = 0
  m.col = 2
  m.zone = "video"
  m.closing = false
  m.skipped = false
  m.skipOffered = false
  m.nextOffered = false
  m.lastSaved = 0
  m.duration = 0
  m.position = 0
  m.hideTimer = CreateObject("roSGNode", "Timer")
  m.hideTimer.duration = 3.2
  m.hideTimer.repeat = false
  m.hideTimer.observeField("fire", "hideChrome")
  m.focusWatch = CreateObject("roSGNode", "Timer")
  m.focusWatch.duration = 0.35
  m.focusWatch.repeat = true
  m.focusWatch.observeField("fire", "claimOverlayFocus")
  m.top.observeField("streamUrl", "onStream")
  m.top.observeField("focusedChild", "onFocusedChild")
  m.top.observeField("mediaKind", "updateSkipRecap")
  m.top.observeField("recapEnd", "updateSkipRecap")
  m.video.observeField("state", "onState")
  m.video.observeField("position", "onPosition")
  m.video.observeField("duration", "onDuration")
  m.video.enableUI = false
  m.video.focusable = false
  paintFocus()
end sub

sub onMessage()
  if m.status = invalid then return
  m.status.text = m.top.message
end sub

sub onOverlayFlags()
  updateNextUp()
end sub

sub onStream()
  url = m.top.streamUrl
  if url = invalid or url = "" then return
  content = CreateObject("roSGNode", "ContentNode")
  content.url = url
  content.title = m.top.streamTitle
  fmt = m.top.streamFormat
  if fmt = invalid or fmt = "" then fmt = "mp4"
  content.streamformat = fmt
  startAt = m.top.startAt
  if startAt <> invalid and startAt > 0 then content.playStart = startAt
  m.heading.text = m.top.streamTitle
  m.closing = false
  m.skipped = false
  m.skipOffered = false
  m.nextOffered = false
  m.col = 2
  m.video.content = content
  m.video.control = "play"
  m.top.message = m.top.streamTitle
  startFocusWatch()
  claimOverlayFocus()
  focusVideo()
  showChrome()
  updateSkipRecap()
  updateNextUp()
end sub

sub onState()
  state = m.video.state
  if state = "error"
    m.top.message = "Playback failed on this Roku."
    m.buffer.visible = false
  else if state = "finished"
    saveProgress(true)
    emit("close", invalid)
  else if state = "playing"
    m.top.message = ""
    m.buffer.visible = false
    m.pause.iconUri = "pkg:/images/icons/pause.png"
    startAt = m.top.startAt
    if startAt <> invalid and startAt > 1 and m.position < 1
      m.video.seek = startAt
    end if
    claimOverlayFocus()
  else if state = "paused"
    m.pause.iconUri = "pkg:/images/icons/play.png"
    saveProgress(false)
  else if state = "buffering"
    m.buffer.visible = true
  end if
end sub

sub onDuration()
  m.duration = m.video.duration
  paintBar()
  updateSkipRecap()
end sub

sub onPosition()
  m.position = m.video.position
  paintBar()
  updateSkipRecap()
  if m.position - m.lastSaved >= 10 then saveProgress(false)
end sub

function recapEndKnown() as Boolean
  return m.top.recapEnd <> invalid and m.top.recapEnd > 0
end function

function skipRecapIsSeries() as Boolean
  kind = LCase(asText(m.top.mediaKind))
  return kind = "series"
end function

function skipRecapAllowed() as Boolean
  if m.skipped = true then return false
  id = asText(m.top.mediaId)
  if Left(id, 5) = "live:" then return false
  kind = LCase(asText(m.top.mediaKind))
  if kind = "live" then return false
  if recapEndKnown() then return m.position < m.top.recapEnd
  if skipRecapIsSeries() then return m.position < 90
  return false
end function

function skipRecapTarget() as Float
  if recapEndKnown() then return m.top.recapEnd
  return 90
end function

function chromeLastCol() as Integer
  last = 3
  if skipRecapShowing() then last = last + 1
  if nextShowing() then last = last + 1
  return last
end function

function recapCol() as Integer
  if skipRecapShowing() then return 4
  return -1
end function

function nextCol() as Integer
  if skipRecapShowing() and nextShowing() then return 5
  if nextShowing() then return 4
  return -1
end function

function skipRecapShowing() as Boolean
  return m.skipRecap <> invalid and m.skipRecap.visible = true
end function

function nextIsOffered() as Boolean
  if m.top.showNext = true then return true
  if asText(m.top.nextMediaId) <> "" then return true
  return false
end function

function nextShowing() as Boolean
  return m.nextUp <> invalid and m.nextUp.visible = true
end function

function skipRecapFocused() as Boolean
  if skipRecapShowing() <> true then return false
  if m.zone = "skip" then return true
  return m.zone = "chrome" and m.col = recapCol()
end function

function nextFocused() as Boolean
  if nextShowing() <> true then return false
  if m.zone = "next" then return true
  return m.zone = "chrome" and m.col = nextCol()
end function

function progressFocused() as Boolean
  return m.zone = "progress"
end function

sub updateSkipRecap()
  if m.skipRecap = invalid then return
  show = skipRecapAllowed()
  m.skipRecap.visible = show
  if show
    if m.skipOffered <> true
      m.skipOffered = true
      focusSkip()
      return
    end if
  else if m.zone = "skip" or m.col = 4
    m.col = 2
    if m.chrome <> invalid and m.chrome.visible = true
      focusChrome()
    else
      focusVideo()
    end if
    return
  end if
  paintFocus()
end sub

sub updateNextUp()
  if m.nextUp = invalid then return
  show = nextIsOffered()
  m.nextUp.visible = show
  if show
    label = asText(m.top.nextTitle)
    if label = "" then label = "Next"
    m.nextUp.label = "Next"
    if m.nextOffered <> true then m.nextOffered = true
  else if nextFocused()
    m.col = 2
    if m.zone = "next" then focusChrome()
  end if
  paintFocus()
end sub

sub doSkipRecap()
  target = skipRecapTarget()
  if m.duration > 0 and target > m.duration then target = m.duration
  if target <= m.position then target = m.position + 1
  m.video.seek = target
  m.position = target
  m.skipped = true
  if m.skipRecap <> invalid then m.skipRecap.visible = false
  m.col = 2
  paintBar()
  focusChrome()
  showChrome()
end sub

sub paintBar()
  dur = m.duration
  if dur <= 0 then dur = 1
  ratio = m.position / dur
  if ratio < 0 then ratio = 0
  if ratio > 1 then ratio = 1
  if m.barFill <> invalid then m.barFill.width = Int(3200 * ratio)
  if m.time <> invalid then m.time.text = formatTime(m.position) + " / " + formatTime(m.duration)
end sub

function formatTime(value as Float) as String
  total = Int(value)
  if total < 0 then total = 0
  seconds = total mod 60
  minutes = Int(total / 60) mod 60
  hours = Int(total / 3600)
  secText = StrI(seconds).Trim()
  if seconds < 10 then secText = "0" + secText
  minText = StrI(minutes).Trim()
  if minutes < 10 then minText = "0" + minText
  if hours > 0 then return StrI(hours).Trim() + ":" + minText + ":" + secText
  return StrI(minutes).Trim() + ":" + secText
end function

sub saveProgress(force as Boolean)
  id = m.top.mediaId
  if id = invalid or id = "" then return
  if m.duration <= 0 then return
  m.lastSaved = m.position
  emit("progress", { id: id, position: m.position, duration: m.duration })
end sub

sub showChrome()
  m.chrome.visible = true
  if m.fadeOutTimer <> invalid then m.fadeOutTimer.control = "stop"
  fadeChrome(1.0)
  m.hideTimer.control = "stop"
  m.hideTimer.control = "start"
end sub

sub hideChrome()
  if m.video.state = "paused" then return
  fadeChrome(0.0)
  if m.fadeOutTimer <> invalid
    m.fadeOutTimer.control = "stop"
    m.fadeOutTimer.control = "start"
  else
    m.chrome.visible = false
  end if
  if skipRecapShowing()
    m.zone = "skip"
    m.col = recapCol()
    paintFocus()
    holdFocus()
    return
  end if
  if nextShowing()
    m.zone = "next"
    m.col = nextCol()
    paintFocus()
    holdFocus()
    return
  end if
  focusVideo()
end sub

sub finishHideChrome()
  if m.video.state = "paused" then return
  if m.chrome <> invalid then m.chrome.visible = false
end sub

sub fadeChrome(target as Float)
  if m.chrome = invalid then return
  if m.chromeFade = invalid or m.chromeFadeInterp = invalid
    m.chrome.opacity = target
    return
  end if
  current = m.chrome.opacity
  if current = invalid then current = 1
  m.chromeFade.control = "stop"
  m.chromeFadeInterp.keyValue = [current, target]
  m.chromeFade.control = "start"
end sub

sub paintThumb()
  if m.barFill = invalid then return
  fillW = m.barFill.width
  if fillW < 8 then fillW = 8
  if m.barGlow <> invalid then m.barGlow.width = fillW
  if m.barThumb = invalid or m.barTrack = invalid then return
  tx = m.barTrack.translation[0]
  ty = m.barTrack.translation[1]
  tw = m.barThumb.width
  th = m.barThumb.height
  x = tx + fillW - (tw / 2)
  y = ty + (m.barTrack.height - th) / 2
  if x < tx then x = tx
  m.barThumb.translation = [x, y]
end sub

function isVideoFocused() as Boolean
  return m.zone = "video"
end function

function seekKeysActive() as Boolean
  if isVideoFocused() then return true
  if progressFocused() then return true
  if m.zone = "skip" then return true
  return false
end function

sub lockOverlayChildFocus()
  nodes = [m.back, m.rewind, m.pause, m.forward, m.skipRecap, m.nextUp]
  for each node in nodes
    if node <> invalid then node.focusable = false
  end for
end sub

sub onFocusedChild()
  claimOverlayFocus()
end sub

sub startFocusWatch()
  if m.focusWatch = invalid then return
  m.focusWatch.control = "stop"
  m.focusWatch.control = "start"
end sub

sub stopFocusWatch()
  if m.focusWatch = invalid then return
  m.focusWatch.control = "stop"
end sub

sub claimOverlayFocus()
  if m.closing = true then return
  if m.video <> invalid
    m.video.enableUI = false
    m.video.focusable = false
    if m.video.hasFocus()
      m.top.setFocus(true)
      return
    end if
  end if
  if not m.top.hasFocus() then m.top.setFocus(true)
end sub

sub holdFocus()
  claimOverlayFocus()
end sub

sub focusVideo()
  m.zone = "video"
  paintFocus()
  holdFocus()
end sub

sub focusProgress()
  m.zone = "progress"
  showChrome()
  paintFocus()
  holdFocus()
end sub

sub focusSkip()
  if skipRecapShowing() <> true then return
  m.zone = "skip"
  m.col = recapCol()
  showChrome()
  paintFocus()
  holdFocus()
end sub

sub focusNext()
  if nextShowing() <> true then return
  m.zone = "next"
  m.col = nextCol()
  showChrome()
  paintFocus()
  holdFocus()
end sub

sub focusChrome()
  m.zone = "chrome"
  lastCol = chromeLastCol()
  if m.col < 0 or m.col > lastCol then m.col = 2
  if skipRecapShowing() <> true and m.col = 4 and nextShowing() <> true then m.col = 2
  showChrome()
  paintFocus()
  holdFocus()
end sub

sub paintFocus()
  onSkip = skipRecapFocused()
  onNext = nextFocused()
  onProgress = progressFocused()
  onVideo = isVideoFocused()
  onChrome = (onVideo = false and onSkip = false and onNext = false and onProgress = false)
  if m.back <> invalid then m.back.hasFocusStyle = (onChrome and m.col = 0)
  if m.rewind <> invalid then m.rewind.hasFocusStyle = (onChrome and m.col = 1)
  if m.pause <> invalid then m.pause.hasFocusStyle = (onChrome and m.col = 2)
  if m.forward <> invalid then m.forward.hasFocusStyle = (onChrome and m.col = 3)
  if m.skipRecap <> invalid then m.skipRecap.hasFocusStyle = onSkip
  if m.nextUp <> invalid then m.nextUp.hasFocusStyle = onNext
  if m.barRing <> invalid
    if onProgress
      m.barRing.color = tvmFocus()
    else
      m.barRing.color = "0x00000000"
    end if
  end if
  if m.barThumb <> invalid
    if onProgress
      m.barThumb.width = 40
      m.barThumb.height = 40
    else
      m.barThumb.width = 32
      m.barThumb.height = 32
    end if
    paintThumb()
  end if
  key = m.zone
  if onSkip then key = "recap"
  if onNext then key = "next"
  if onProgress then key = "progress"
  m.top.overlayFocus = key
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq }
  if extra <> invalid
    for each key in extra
      action[key] = extra[key]
    end for
  end if
  m.top.action = action
end sub

sub seekBy(delta as Integer)
  nextPos = m.position + delta
  if nextPos < 0 then nextPos = 0
  if m.duration > 0 and nextPos > m.duration then nextPos = m.duration
  m.position = nextPos
  m.video.seek = nextPos
  paintBar()
  updateSkipRecap()
  holdFocus()
end sub

sub closePlayer()
  m.closing = true
  stopFocusWatch()
  if m.video <> invalid then m.video.control = "stop"
  saveProgress(true)
  emit("close", invalid)
end sub

sub doNext()
  emit("next", { id: asText(m.top.nextMediaId), title: asText(m.top.nextTitle) })
end sub

sub togglePlayback()
  if m.video = invalid then return
  if m.video.state = "playing"
    m.video.control = "pause"
  else
    m.video.control = "resume"
  end if
  holdFocus()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  holdFocus()
  if intent = "back" or intent = "stop"
    closePlayer()
    return true
  end if
  showChrome()
  if intent = "select" and skipRecapFocused()
    doSkipRecap()
    return true
  end if
  if intent = "select" and nextFocused()
    doNext()
    return true
  end if
  if intent = "rewind" or (intent = "left" and seekKeysActive())
    seekBy(-10)
    return true
  end if
  if intent = "fastForward" or (intent = "right" and seekKeysActive())
    seekBy(10)
    return true
  end if
  if intent = "down" and isVideoFocused()
    focusProgress()
    return true
  end if
  if intent = "up" and isVideoFocused()
    if skipRecapShowing()
      focusSkip()
    else
      focusProgress()
    end if
    return true
  end if
  if intent = "up" and progressFocused()
    if skipRecapShowing()
      focusSkip()
    else
      focusVideo()
    end if
    return true
  end if
  if intent = "down" and progressFocused()
    focusChrome()
    return true
  end if
  if intent = "up" and skipRecapFocused()
    focusProgress()
    return true
  end if
  if intent = "down" and skipRecapFocused()
    m.col = 2
    focusChrome()
    return true
  end if
  if intent = "left" and skipRecapFocused()
    m.col = 3
    focusChrome()
    return true
  end if
  if intent = "right" and skipRecapFocused()
    if nextShowing()
      focusNext()
    end if
    return true
  end if
  if intent = "up" and nextFocused()
    focusProgress()
    return true
  end if
  if intent = "down" and nextFocused()
    m.col = 2
    focusChrome()
    return true
  end if
  if intent = "left" and nextFocused()
    if skipRecapShowing()
      focusSkip()
    else
      m.col = 3
      focusChrome()
    end if
    return true
  end if
  if intent = "up" and m.zone = "chrome"
    focusProgress()
    return true
  end if
  if intent = "left" and m.zone = "chrome" and m.col > 0
    m.col = m.col - 1
    if m.col = nextCol()
      focusNext()
    else
      paintFocus()
    end if
    return true
  end if
  if intent = "right" and m.zone = "chrome" and m.col < chromeLastCol()
    m.col = m.col + 1
    if m.col = nextCol()
      focusNext()
    else
      paintFocus()
    end if
    return true
  end if
  if intent = "select" or intent = "play" or intent = "pause"
    if intent = "play" or intent = "pause"
      togglePlayback()
      return true
    end if
    if isVideoFocused() or progressFocused()
      togglePlayback()
      return true
    end if
    if m.col = 0
      closePlayer()
      return true
    end if
    if m.col = 1
      seekBy(-10)
      return true
    end if
    if m.col = 3
      seekBy(10)
      return true
    end if
    if m.col = recapCol()
      doSkipRecap()
      return true
    end if
    if m.col = nextCol()
      doNext()
      return true
    end if
    togglePlayback()
    return true
  end if
  return true
end function
