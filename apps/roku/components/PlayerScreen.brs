sub init()
  m.top.focusable = true
  m.video = m.top.findNode("video")
  m.status = m.top.findNode("status")
  m.chrome = m.top.findNode("chrome")
  m.heading = m.top.findNode("heading")
  m.time = m.top.findNode("time")
  m.barFill = m.top.findNode("barFill")
  m.buffer = m.top.findNode("buffer")
  m.back = m.top.findNode("back")
  m.rewind = m.top.findNode("rewind")
  m.pause = m.top.findNode("pause")
  m.forward = m.top.findNode("forward")
  m.heading.font = tvmFontBodyLg()
  m.time.font = tvmFontCaption()
  m.status.font = tvmFontBody()
  m.back.variant = "icon"
  m.back.iconUri = "pkg:/images/icons/back.png"
  m.rewind.variant = "icon"
  m.rewind.iconUri = "pkg:/images/icons/rewind.png"
  m.pause.variant = "icon"
  m.pause.iconUri = "pkg:/images/icons/pause.png"
  m.forward.variant = "icon"
  m.forward.iconUri = "pkg:/images/icons/forward.png"
  m.seq = 0
  m.col = 1
  m.lastSaved = 0
  m.duration = 0
  m.position = 0
  m.hideTimer = CreateObject("roSGNode", "Timer")
  m.hideTimer.duration = 3.2
  m.hideTimer.repeat = false
  m.hideTimer.observeField("fire", "hideChrome")
  m.top.observeField("streamUrl", "onStream")
  m.video.observeField("state", "onState")
  m.video.observeField("position", "onPosition")
  m.video.observeField("duration", "onDuration")
  m.video.enableUI = false
  paintFocus()
end sub

sub onMessage()
  if m.status = invalid then return
  m.status.text = m.top.message
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
  m.video.content = content
  m.video.control = "play"
  m.top.message = m.top.streamTitle
  m.top.setFocus(true)
  showChrome()
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
end sub

sub onPosition()
  m.position = m.video.position
  paintBar()
  if m.position - m.lastSaved >= 10 then saveProgress(false)
end sub

sub paintBar()
  dur = m.duration
  if dur <= 0 then dur = 1
  ratio = m.position / dur
  if ratio < 0 then ratio = 0
  if ratio > 1 then ratio = 1
  m.barFill.width = Int(3200 * ratio)
  m.time.text = formatTime(m.position) + " / " + formatTime(m.duration)
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
  m.hideTimer.control = "stop"
  m.hideTimer.control = "start"
end sub

sub hideChrome()
  if m.video.state = "paused" then return
  m.chrome.visible = false
end sub

sub paintFocus()
  m.back.hasFocusStyle = (m.col = 0)
  m.rewind.hasFocusStyle = (m.col = 1)
  m.pause.hasFocusStyle = (m.col = 2)
  m.forward.hasFocusStyle = (m.col = 3)
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
  m.video.seek = nextPos
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  showChrome()
  if intent = "back"
    m.video.control = "stop"
    saveProgress(true)
    emit("close", invalid)
    return true
  end if
  if intent = "stop"
    m.video.control = "stop"
    saveProgress(true)
    emit("close", invalid)
    return true
  end if
  if intent = "left" and m.col > 0
    m.col = m.col - 1
    paintFocus()
    return true
  end if
  if intent = "right" and m.col < 3
    m.col = m.col + 1
    paintFocus()
    return true
  end if
  if intent = "rewind"
    seekBy(-10)
    return true
  end if
  if intent = "fastForward"
    seekBy(10)
    return true
  end if
  if intent = "select" or intent = "play" or intent = "pause"
    if m.col = 0 and intent = "select"
      m.video.control = "stop"
      saveProgress(true)
      emit("close", invalid)
      return true
    end if
    if m.col = 1 and intent = "select"
      seekBy(-10)
      return true
    end if
    if m.col = 3 and intent = "select"
      seekBy(10)
      return true
    end if
    state = m.video.state
    if state = "playing"
      m.video.control = "pause"
    else
      m.video.control = "resume"
    end if
    return true
  end if
  return true
end function
