' Scene wiring for content, spotlights and non-focusable release cards.
' Network requests and catalogue resolution belong to ApiTask.
sub initReleaseFeatures()
  m.releaseCard = m.top.findNode("releaseCard")
  m.updateCard = m.top.findNode("updateCard")
  m.backHint = m.top.findNode("backHint")
  m.top.findNode("backHintText").font = tvmFont("semibold", 44)
  m.installedVersion = CreateObject("roAppInfo").GetVersion()
  m.releasePending = registrySection().Read("lastSeenVersion") <> m.installedVersion
  m.releaseClock = invalid : m.updateClock = invalid
  m.rokuUpdate = {} : m.updateDismissed = false
  m.eventsTask = invalid : m.eventProfile = "" : m.eventDate = ""
  m.global.observeField("inputSerial", "onReleaseInput")
  timer = CreateObject("roSGNode", "Timer")
  timer.duration = 21600 : timer.repeat = true
  timer.observeField("fire", "refreshRokuContent")
  m.top.appendChild(timer)
  m.contentTimer = timer : timer.control = "start"
end sub

sub refreshRokuContent()
  if m.contentRefreshTask <> invalid
    if m.contentRefreshTask.state = "run" then return
  end if
  m.contentRefreshTask = startApiGet("local:/api/roku/refresh", "onRokuContentRefreshed")
  m.rokuUpdateTask = startApiGet("local:/api/roku/update", "onRokuUpdateLoaded")
end sub

sub onRokuContentRefreshed()
  if m.homeNode <> invalid then loadEvents()
  if m.liveNode <> invalid
    if m.stack <> invalid
      if visibleScreen(m.stack).name = "live" then loadLive()
    end if
  end if
end sub

sub loadEvents()
  m.eventProfile = m.profileId
  m.eventDate = sceneLocalDate()
  m.eventsTask = startApiGet(joinCorePath(m.coreUrl, "/api/events/active"), "onEventsLoaded")
end sub

function sceneLocalDate() as String
  dt = CreateObject("roDateTime") : dt.ToLocalTime()
  return Left(dt.ToISOString(), 10)
end function

sub onEventsLoaded(event as Object)
  task = event.GetRoSGNode()
  if task <> m.eventsTask or task.profileId <> m.profileId then return
  if m.homeNode = invalid or not task.ok then return
  events = aaArray(task.json, "events")
  if events.Count() > 0
    m.homeNode.event = events[0]
  else
    m.homeNode.event = {}
  end if
end sub

sub updateBackHint()
  if m.stack = invalid then return
  entry = activeEntry(m.stack)
  screen = visibleScreen(m.stack)
  topLevel = screen.name = "home" or screen.name = "live" or screen.name = "library"
  if screen.name = "catalog"
    nav = asText(aaGet(screen.params, "navId", ""))
    topLevel = nav = "movies" or nav = "series"
  end if
  if entry.name = "search" then topLevel = true
  m.backHint.visible = not topLevel
  if entry.kind = "modal" and entry.name <> "search" then m.backHint.visible = true
  if entry.name = "player" then m.backHint.visible = false
end sub

function releaseHighlights(notes as Object, limit = 4 as Integer) as String
  lines = []
  title = asText(aaGet(notes, "title", ""))
  if title <> "" then lines.Push(title)
  for each highlight in aaArray(notes, "highlights")
    if limit <= 0 then exit for
    lines.Push(asText(highlight)) : limit = limit - 1
  end for
  return lines.Join(Chr(10))
end function

sub onRokuUpdateLoaded()
  task = m.rokuUpdateTask
  if task = invalid or not task.ok then return
  m.rokuUpdate = task.json
  maybeShowReleaseCards()
end sub

sub maybeShowReleaseCards()
  if m.stack = invalid or m.homeNode = invalid then return
  if visibleScreen(m.stack).name <> "home" or activeEntry(m.stack).kind = "modal" then return
  if m.homeNode.mode <> "ready" then return
  if m.releasePending
    for each release in aaArray(uiContent("changelog"), "releases")
      if release.version = m.installedVersion
        m.releaseCard.title = "Updated to " + m.installedVersion
        m.releaseCard.body = releaseHighlights(release) + Chr(10) + "Options (*): All changes" + Chr(10) + "Settings > What's new"
        m.releaseCard.visible = true
        m.homeNode.releaseShortcut = true
        if m.releaseClock = invalid
          m.releaseClock = CreateObject("roTimespan") : m.releaseClock.Mark()
        end if
        exit for
      end if
    end for
  end if
  if aaGet(m.rokuUpdate, "available", false) = true and not m.updateDismissed
    m.updateCard.title = "Update available: " + asText(aaGet(m.rokuUpdate, "version", ""))
    m.updateCard.body = releaseHighlights(aaGet(m.rokuUpdate, "notes", {}), 2) + Chr(10) + "github.com/GL-327/TVM/releases/tag/devices" + Chr(10) + "Install the new TVM-roku.zip from your PC." + Chr(10) + "TVM on your PC can install it for you: Settings > Roku on the Windows app"
    m.updateCard.visible = true
    if m.updateClock = invalid
      m.updateClock = CreateObject("roTimespan") : m.updateClock.Mark()
    end if
  end if
end sub

sub onReleaseInput()
  dismissReleaseCards()
end sub

sub dismissReleaseCards()
  if m.releaseClock <> invalid and m.releasePending
    if m.releaseClock.TotalMilliseconds() >= 1200
      m.releaseCard.visible = false : m.releasePending = false
      if m.homeNode <> invalid then m.homeNode.releaseShortcut = false
      section = registrySection()
      section.Write("lastSeenVersion", m.installedVersion) : section.Flush()
    end if
  end if
  if m.updateClock <> invalid
    if m.updateClock.TotalMilliseconds() >= 1200
      m.updateCard.visible = false : m.updateDismissed = true
    end if
  end if
end sub
