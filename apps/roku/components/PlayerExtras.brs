sub initPlayerExtras()
  m.segments = {} : m.skipSeen = {} : m.skipConsumed = {}
  m.activeSegment = invalid : m.activeSegmentKey = ""
  m.extrasPrefs = { skipSegments: "button", autoplayNext: true, subtitleLanguage: "eng" }
  m.extraTracks = [] : m.extrasStarted = false
  m.upShown = false : m.upCancelled = false : m.upCol = 0 : m.upSeconds = 10
  m.upCard = m.top.findNode("upCard")
  m.upPlay = m.top.findNode("upPlay") : m.upCancel = m.top.findNode("upCancel")
  m.upPlay.label = "Play now" : m.upCancel.label = "Cancel"
  m.upPlay.variant = "glassPill" : m.upCancel.variant = "glassPill"
  m.upPlay.pillWidth = 380 : m.upCancel.pillWidth = 380
  m.top.findNode("upTitle").font = tvmFontBody()
  m.top.findNode("upCountdown").font = tvmFontMeta()
  m.extrasTick = m.top.findNode("extrasTick")
  m.extrasTick.observeField("fire", "onExtrasTick")
  m.watchClock = CreateObject("roTimespan") : m.watchClock.Mark()
  m.watchSeconds = 0 : m.watchPosition = 0
  m.video.observeField("availableSubtitleTracks", "onExtrasTracks")
end sub

function playerExtrasTask(path as String, callback as String, method = "GET" as String, body = "" as String) as Object
  task = CreateObject("roSGNode", "ApiTask")
  task.requestUrl = "local:" + path : task.requestMethod = method : task.requestBody = body
  task.profileId = m.top.profileId
  task.profileMaxAge = m.top.profileMaxAge
  task.observeField("done", callback)
  task.control = "RUN"
  return task
end function

sub startPlayerExtras()
  if m.extrasStarted then return
  m.extrasStarted = true
  m.extrasTick.control = "start"
  if Left(m.top.mediaId, 2) <> "tt" then return
  title = asText(aaGet(m.top.mediaItem, "showTitle", aaGet(m.top.mediaItem, "title", "")))
  anime = "0"
  for each genre in aaArray(m.top.mediaItem, "genres")
    if LCase(genre) = "anime" then anime = "1"
  end for
  query = "?id=" + playerExtrasEncode(m.top.mediaId) + "&title=" + playerExtrasEncode(title) + "&anime=" + anime
  m.extrasPrefsTask = playerExtrasTask("/api/prefs", "onPlayerPrefs")
  m.segmentsTask = playerExtrasTask("/api/extras/segments" + query, "onPlayerSegments")
  m.subtitlesTask = playerExtrasTask("/api/extras/subtitles" + query, "onPlayerSubtitles")
  if m.top.mediaKind = "series" then m.nextTask = playerExtrasTask("/api/extras/next" + query, "onPlayerNext")
end sub

function playerExtrasEncode(value as String) as String
  return CreateObject("roUrlTransfer").Escape(value)
end function

sub onPlayerPrefs(event as Object)
  if m.closing then return
  task = event.GetRoSGNode()
  if task.ok then m.extrasPrefs = task.json
  onExtrasTracks()
end sub

sub onPlayerSegments(event as Object)
  if m.closing then return
  task = event.GetRoSGNode()
  if task.ok then m.segments = task.json
  updateSkipRecap()
end sub

sub onPlayerSubtitles(event as Object)
  if m.closing then return
  task = event.GetRoSGNode()
  if not task.ok then return
  m.extraTracks = aaArray(task.json, "subtitles")
  if m.video.content <> invalid then m.video.content.subtitleTracks = m.extraTracks
  onExtrasTracks()
end sub

sub onExtrasTracks()
  if m.closing or m.extraTracks.Count() = 0 then return
  if m.subtitleChosen = true then return
  language = asText(aaGet(m.extrasPrefs, "subtitleLanguage", "eng"))
  if language = "off"
    m.video.globalCaptionMode = "Off"
    return
  end if
  for each track in m.extraTracks
    if track.language = language
      m.video.subtitleTrack = track.TrackName
      return
    end if
  end for
end sub

sub rememberPlayerSubtitle(trackId as String, off as Boolean)
  language = "off"
  if not off
    for each track in m.video.availableSubtitleTracks
      if track.TrackName = trackId then language = asText(track.Language)
    end for
  end if
  m.subtitleChosen = true
  m.subtitlePrefTask = playerExtrasTask("/api/prefs", "onSubtitleRemembered", "PUT", FormatJson({ subtitleLanguage: language }))
end sub

sub onSubtitleRemembered()
end sub

sub onPlayerNext(event as Object)
  if m.closing then return
  task = event.GetRoSGNode()
  nextItem = aaGet(task.json, "next", invalid)
  if not task.ok or not isMediaItem(nextItem) then return
  m.top.nextItem = nextItem
  m.top.nextMediaId = nextItem.id
  m.top.nextTitle = nextItem.title
  m.top.showNext = true
end sub

sub onExtrasTick()
  if m.closing then return
  updateSkipRecap()
  updateNextUp()
  if m.upCard.visible
    elapsed = m.upClock.TotalMilliseconds() / 1000.0 : m.upClock.Mark()
    if m.video.state = "playing" and not m.ccOpen and not m.qualityOpen then m.upElapsed = m.upElapsed + elapsed
    if aaGet(m.extrasPrefs, "autoplayNext", true) = true
      m.upSeconds = 10 - Int(m.upElapsed)
      m.top.findNode("upCountdown").text = "Playing in " + m.upSeconds.ToStr() + " seconds"
      if m.upSeconds <= 0 then doNext()
    else
      m.top.findNode("upCountdown").text = "Autoplay is off"
    end if
  end if
end sub

sub measureWatchTime()
  elapsed = m.watchClock.TotalMilliseconds() / 1000.0 : m.watchClock.Mark()
  delta = m.video.position - m.watchPosition
  m.watchPosition = m.video.position
  if m.video.state <> "playing" or elapsed <= 0 or elapsed > 15 then return
  if delta <= 0 or delta > elapsed + 2 then return
  if delta > elapsed then delta = elapsed
  m.watchSeconds = m.watchSeconds + delta
end sub

function playerSegment() as Dynamic
  for each kind in ["recap", "intro", "credits"]
    segment = aaGet(m.segments, kind, invalid)
    if segment <> invalid
      finish = aaGet(segment, "end", m.duration)
      if finish <> invalid and finish > segment.start and m.position >= segment.start and m.position < finish
        key = kind + ":" + segment.start.ToStr()
        return { kind: kind, start: segment.start, target: finish, key: key }
      end if
    end if
  end for
  return invalid
end function

function extrasCreditsReached() as Boolean
  credits = aaGet(m.segments, "credits", invalid)
  if credits <> invalid then return m.position >= credits.start
  return m.duration > 30 and m.position >= m.duration - 30
end function

sub showUpNextCard()
  if m.upShown or m.upCancelled or not nextIsOffered() or m.top.mediaKind <> "series" then return
  if not extrasCreditsReached() then return
  m.upShown = true : m.upSeconds = 10 : m.upCol = 0
  m.upClock = CreateObject("roTimespan") : m.upClock.Mark() : m.upElapsed = 0
  m.top.findNode("upCountdown").text = "Playing in 10 seconds"
  m.upCard.visible = true
  m.top.findNode("upTitle").text = "Up next: " + m.top.nextTitle
  item = m.top.nextItem
  m.top.findNode("upImage").uri = preferHeroUri(item)
  m.zone = "upnext"
  paintUpNextFocus()
  holdFocus()
end sub

sub paintUpNextFocus()
  m.upPlay.hasFocusStyle = m.zone = "upnext" and m.upCol = 0
  m.upCancel.hasFocusStyle = m.zone = "upnext" and m.upCol = 1
end sub

sub cancelUpNext()
  m.upCancelled = true : m.upCard.visible = false
  focusVideo()
end sub

function handleUpNextKey(intent as String) as Boolean
  if not m.upCard.visible then return false
  if m.zone <> "upnext"
    if intent = "up"
      m.zone = "upnext" : paintUpNextFocus() : holdFocus()
      return true
    end if
    return false
  end if
  if intent = "back" then cancelUpNext() : return true
  if intent = "left" then m.upCol = 0
  if intent = "right" then m.upCol = 1
  if intent = "down" then focusProgress()
  if intent = "select"
    if m.upCol = 0 then doNext() else cancelUpNext()
  end if
  paintUpNextFocus()
  return intent = "up" or intent = "down" or intent = "left" or intent = "right" or intent = "select"
end function
