sub initPlayerExtras()
  m.segments = {} : m.skipSeen = {} : m.skipConsumed = {}
  m.activeSegment = invalid : m.activeSegmentKey = ""
  m.extrasPrefs = { skipSegments: "button", autoplayNext: true, subtitleLanguage: "eng", subtitleLanguages: ["eng"], subtitleMode: "foreign", audioLanguage: "original", sleepDefault: "off" }
  m.extraTracks = [] : m.extrasStarted = false
  m.audioChosen = false : m.activeAudioLang = ""
  m.sleepMode = "off" : m.sleepRemaining = 0 : m.sleepManual = false
  m.upShown = false : m.upCancelled = false : m.upCol = 0 : m.upSeconds = 10
  m.upCard = m.top.findNode("upCard")
  upBg = m.top.findNode("upBg")
  if upBg <> invalid then upBg.color = tvmBgElevated()
  upMask = m.top.findNode("upMask")
  if upMask <> invalid then upMask.maskSize = [320 * tvmUiScale(), 180 * tvmUiScale()]
  m.upPlay = m.top.findNode("upPlay") : m.upCancel = m.top.findNode("upCancel")
  m.upPlay.label = "Play now" : m.upCancel.label = "Cancel"
  m.upPlay.variant = "glassPill" : m.upPlay.accent = true
  m.upCancel.variant = "glassPill"
  m.upPlay.pillWidth = 480 : m.upCancel.pillWidth = 480
  upTitle = m.top.findNode("upTitle")
  upTitle.font = tvmFontLabel() : upTitle.color = tvmText()
  upCountdown = m.top.findNode("upCountdown")
  upCountdown.font = tvmFont("medium", tvmTypeSize(tvmTypeMeta())) : upCountdown.color = tvmMuted()
  m.extrasTick = m.top.findNode("extrasTick")
  m.extrasTick.observeField("fire", "onExtrasTick")
  m.watchClock = CreateObject("roTimespan") : m.watchClock.Mark()
  m.watchSeconds = 0 : m.watchPosition = 0
  if m.video.hasField("availableAudioTracks") then m.video.observeField("availableAudioTracks", "onAutoAudioTracks")
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
  if not m.sleepManual and tvmExtraEnabled("sleepTimer")
    defSleep = asText(m.top.sleepDefault)
    if defSleep <> "" and defSleep <> "off" then applySleepTimer(defSleep, false)
  end if
  m.extrasPrefsTask = playerExtrasTask("/api/prefs", "onPlayerPrefs")
  onAutoAudioTracks()
  if Left(m.top.mediaId, 2) <> "tt" then return
  title = asText(aaGet(m.top.mediaItem, "showTitle", aaGet(m.top.mediaItem, "title", "")))
  anime = "0"
  for each genre in aaArray(m.top.mediaItem, "genres")
    if LCase(genre) = "anime" then anime = "1"
  end for
  query = "?id=" + playerExtrasEncode(m.top.mediaId) + "&title=" + playerExtrasEncode(title) + "&anime=" + anime
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
  if task.ok
    m.extrasPrefs = task.json
    if not m.sleepManual and tvmExtraEnabled("sleepTimer")
      defSleep = asText(aaGet(m.extrasPrefs, "sleepDefault", "off"))
      if defSleep = "end" and LCase(asText(m.top.mediaKind)) <> "series" then defSleep = "off"
      if defSleep <> "off" then applySleepTimer(defSleep, false)
    else if not tvmExtraEnabled("sleepTimer")
      applySleepTimer("off", false)
    end if
  end if
  onAutoAudioTracks()
  onExtrasTracks()
end sub

function playerNormLang(raw as String) as String
  key = LCase(raw.Trim()).Split("-")[0].Split("_")[0]
  aliases = {
    en: "eng", es: "spa", fr: "fra", fre: "fra", de: "deu", ger: "deu", it: "ita", pt: "por", pb: "por", pob: "por"
    ja: "jpn", ko: "kor", zh: "zho", chi: "zho", nl: "nld", dut: "nld", cs: "ces", cze: "ces", ro: "ron", rum: "ron"
    el: "ell", gre: "ell", ar: "ara", ru: "rus", pl: "pol", tr: "tur", sv: "swe", no: "nor", nb: "nor", da: "dan"
    fi: "fin", he: "heb", hi: "hin", uk: "ukr", und: ""
  }
  if aliases.DoesExist(key) then return aliases[key]
  if Len(key) = 3 then return key
  return ""
end function

sub onAutoAudioTracks()
  if m.closing or m.audioChosen then return
  if m.video = invalid or not m.video.hasField("availableAudioTracks") then return
  tracks = m.video.availableAudioTracks
  if tracks = invalid or tracks.Count() = 0 then return
  pref = asText(m.top.audioLanguage)
  if pref = "" or pref = "original" then pref = asText(aaGet(m.extrasPrefs, "audioLanguage", "original"))
  if pref = "original" then pref = asText(m.top.originalLanguage)
  wanted = playerNormLang(pref)
  matched = false
  if wanted <> ""
    for each track in tracks
      code = playerNormLang(asText(aaGet(track, "Language", "")))
      if code = wanted and m.video.hasField("audioTrack")
        m.video.audioTrack = asText(aaGet(track, "TrackName", ""))
        m.activeAudioLang = code
        matched = true
        exit for
      end if
    end for
  end if
  if not matched
    curId = ""
    if m.video.hasField("currentAudioTrack") then curId = asText(m.video.currentAudioTrack)
    for each track in tracks
      if asText(aaGet(track, "TrackName", "")) = curId or curId = ""
        m.activeAudioLang = playerNormLang(asText(aaGet(track, "Language", "")))
        if curId <> "" then exit for
      end if
    end for
  end if
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
  if m.closing or m.subtitleChosen = true then return
  mode = asText(m.top.subtitleMode)
  if mode = "" then mode = asText(aaGet(m.extrasPrefs, "subtitleMode", "foreign"))
  if mode = "off"
    applySubtitle("", true)
    return
  end if
  langs = aaArray(m.extrasPrefs, "subtitleLanguages")
  if langs.Count() = 0
    fallback = asText(aaGet(m.extrasPrefs, "subtitleLanguage", "eng"))
    if fallback = "off" then applySubtitle("", true) : return
    if fallback <> "" then langs = [fallback]
  end if
  primaryViewer = "eng"
  if langs.Count() > 0
    norm = playerNormLang(asText(langs[0]))
    if norm <> "" then primaryViewer = norm
  end if
  audioLang = m.activeAudioLang
  if audioLang = "" then audioLang = playerNormLang(asText(m.top.originalLanguage))
  if audioLang = "" and aaArray(m.top, "audioLanguages").Count() > 0 then audioLang = playerNormLang(asText(m.top.audioLanguages[0]))
  if mode = "foreign" and audioLang <> "" and audioLang = primaryViewer
    applySubtitle("", true)
    return
  end if
  candidates = []
  if m.video <> invalid and m.video.hasField("availableSubtitleTracks")
    for each t in aaArray(m.video, "availableSubtitleTracks")
      candidates.Push(t)
    end for
  end if
  for each t in m.extraTracks
    candidates.Push(t)
  end for
  if candidates.Count() = 0 then return
  for each want in langs
    wantCode = playerNormLang(asText(want))
    if wantCode <> ""
      for each track in candidates
        tLang = playerNormLang(asText(aaGet(track, "Language", aaGet(track, "language", ""))))
        if tLang = wantCode
          applySubtitle(asText(aaGet(track, "TrackName", "")), false)
          return
        end if
      end for
    end if
  end for
end sub

sub applySleepTimer(mode as String, manual = false as Boolean)
  if manual then m.sleepManual = true
  m.sleepMode = mode
  if mode = "15" or mode = "30" or mode = "45" or mode = "60"
    m.sleepRemaining = Int(Val(mode)) * 60
  else
    m.sleepRemaining = 0
  end if
  if m.cc <> invalid
    m.cc.sleepMode = m.sleepMode
    m.cc.sleepRemaining = m.sleepRemaining
  end if
  if manual
    if mode = "off"
      showTransient("Sleep timer turned off")
    else if mode = "end"
      showTransient("Playback will stop at the end of this episode")
    else
      showTransient("Sleep timer set for " + mode + " minutes")
    end if
  end if
end sub

sub tickSleepTimer()
  if m.sleepRemaining <= 0 then return
  m.sleepRemaining = m.sleepRemaining - 1
  if m.cc <> invalid then m.cc.sleepRemaining = m.sleepRemaining
  if m.sleepRemaining = 60 then showTransient("Sleep timer: 1 minute left")
  if m.sleepRemaining <= 0
    m.sleepMode = "off"
    closePlayer()
  end if
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
  emit("subtitleRemembered", invalid)
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
  tickSleepTimer()
  if m.closing then return
  updateSkipRecap()
  updateNextUp()
  if m.upCard.visible
    elapsed = m.upClock.TotalMilliseconds() / 1000.0 : m.upClock.Mark()
    if m.video.state = "playing" and not m.ccOpen and not m.qualityOpen then m.upElapsed = m.upElapsed + elapsed
    if aaGet(m.extrasPrefs, "autoplayNext", true) = true
      m.upSeconds = 10 - Int(m.upElapsed)
      m.top.findNode("upCountdown").text = "Playing in " + m.upSeconds.ToStr() + " s"
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
  m.top.findNode("upCountdown").text = "Playing in 10 s"
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
