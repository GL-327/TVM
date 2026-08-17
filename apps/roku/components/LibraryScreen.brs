sub init()
  m.top.focusable = true
  m.heroArt = m.top.findNode("heroArt")
  m.heroArtB = m.top.findNode("heroArtB")
  m.heroFallback = m.top.findNode("heroFallback")
  m.heroCopy = m.top.findNode("heroCopy")
  m.heroTitle = m.top.findNode("heroTitle")
  m.watchNow = m.top.findNode("watchNow")
  m.learnMore = m.top.findNode("learnMore")
  m.heroBrand = m.top.findNode("heroBrand")
  m.heroRule = m.top.findNode("heroRule")
  m.heroFade = m.top.findNode("heroFade")
  m.heroFadeA = m.top.findNode("heroFadeA")
  m.heroFadeB = m.top.findNode("heroFadeB")
  m.avatar = m.top.findNode("avatar")
  m.searchBtn = m.top.findNode("searchBtn")
  m.homeBtn = m.top.findNode("homeBtn")
  m.showsBtn = m.top.findNode("showsBtn")
  m.moviesBtn = m.top.findNode("moviesBtn")
  m.mark = m.top.findNode("mark")
  m.gate = m.top.findNode("gate")
  m.gateTitle = m.top.findNode("gateTitle")
  m.gateBody = m.top.findNode("gateBody")
  m.tokenBtn = m.top.findNode("tokenBtn")
  m.railsGroup = m.top.findNode("rails")
  m.loading = m.top.findNode("loading")
  m.railsAnim = m.top.findNode("railsAnim")
  m.railsInterp = m.top.findNode("railsInterp")
  if m.heroTitle <> invalid then m.heroTitle.font = tvmFontHero()
  if m.heroRule <> invalid then m.heroRule.font = tvmFont("bold", 40)
  m.gateTitle.font = tvmFontTitle()
  m.gateBody.font = tvmFontBody()
  m.loading.font = tvmFontBody()
  m.searchBtn.variant = "chromelink"
  m.searchBtn.label = "Search"
  m.homeBtn.variant = "chromelink"
  m.homeBtn.label = "Home"
  m.showsBtn.variant = "chromelink"
  m.showsBtn.label = "Shows"
  m.moviesBtn.variant = "chromelink"
  m.moviesBtn.label = "Movies"
  m.watchNow.variant = "watchnow"
  m.watchNow.label = "WATCH NOW"
  m.learnMore.variant = "pill"
  m.learnMore.label = "Learn More"
  m.tokenBtn.variant = "primary"
  m.tokenBtn.label = "Paste token"
  m.gateTitle.text = "Connect Real-Debrid"
  m.gateBody.text = "TVM Stream plays your files and Real-Debrid links. Paste a token to continue."
  m.lane = "all"
  m.zone = "chrome"
  m.chromeCol = 1
  m.heroCol = 0
  m.railRow = 0
  m.railCol = 0
  m.rails = []
  m.railNodes = []
  m.heroItem = invalid
  m.seq = 0
  m.configured = true
  m.heroFront = "a"
  m.shownUri = ""
  paintFocus()
end sub

sub onProfile()
  profile = m.top.profile
  if profile = invalid then return
  m.avatar.name = asText(aaGet(profile, "name", "Profile"))
  hue = aaGet(profile, "hue", 220)
  if hue <> invalid then m.avatar.hue = Int(hue)
end sub

function inLane(item as Object) as Boolean
  if m.lane = "all" then return true
  kind = LCase(asText(aaGet(item, "kind", "")))
  if m.lane = "shows" then return kind = "series"
  return kind <> "series"
end function

function filterItems(items as Object) as Object
  out = []
  if items = invalid then return out
  for each item in items
    if inLane(item) then out.Push(item)
  end for
  return out
end function

sub onPayload()
  payload = m.top.payload
  rd = aaGet(payload, "rd", {})
  m.configured = aaGet(rd, "configured", false) = true
  m.rails = []
  m.heroItem = invalid
  if m.configured
    featured = aaGet(payload, "featured", invalid)
    watching = filterItems(aaArray(payload, "continueWatching"))
    if isMediaItem(featured)
      m.heroItem = featured
    else if watching.Count() > 0
      m.heroItem = watching[0]
    end if
    if watching.Count() > 0 then m.rails.Push({ id: "continue", title: "Continue Watching", items: clipItems(watching, 16), layout: "landscape" })
    mine = filterItems(aaArray(payload, "watchlist"))
    if mine.Count() > 0 then m.rails.Push({ id: "mylist", title: "My List", items: clipItems(mine, 16), layout: "portrait" })
    incoming = aaArray(payload, "rails")
    for each rail in incoming
      items = filterItems(aaArray(rail, "items"))
      if items.Count() > 0
        m.rails.Push({
          id: aaGet(rail, "id", "rail")
          title: aaGet(rail, "title", "Titles")
          items: clipItems(items, 16)
          layout: "portrait"
        })
        if not isMediaItem(m.heroItem) then m.heroItem = items[0]
      end if
      if m.rails.Count() >= 8 then exit for
    end for
  end if
  renderHero()
  renderRails()
  onMode()
end sub

sub renderHero()
  show = (m.configured = true and isMediaItem(m.heroItem))
  if m.heroCopy <> invalid then m.heroCopy.visible = show
  if not show
    if m.heroArt <> invalid then m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    if m.heroFallback <> invalid then m.heroFallback.visible = true
    m.shownUri = ""
    return
  end if
  m.heroTitle.text = UCase(asText(aaGet(m.heroItem, "title", "TVM")))
  uri = preferHeroUri(m.heroItem)
  if uri <> ""
    showHeroUri(uri)
    m.heroFallback.visible = false
  else
    m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    m.heroFallback.visible = true
    m.shownUri = ""
  end if
end sub

sub showHeroUri(uri as String)
  if uri = m.shownUri then return
  if m.shownUri = "" or m.heroArtB = invalid or m.heroFade = invalid
    m.heroArt.uri = uri
    m.heroArt.opacity = 1
    if m.heroArtB <> invalid then m.heroArtB.opacity = 0
    m.shownUri = uri
    m.heroFront = "a"
    return
  end if
  m.heroFade.control = "stop"
  if m.heroFront = "a"
    m.heroArtB.uri = uri
    if m.heroFadeA <> invalid then m.heroFadeA.keyValue = [1.0, 0.0]
    if m.heroFadeB <> invalid then m.heroFadeB.keyValue = [0.0, 1.0]
    m.heroFront = "b"
  else
    m.heroArt.uri = uri
    if m.heroFadeA <> invalid then m.heroFadeA.keyValue = [0.0, 1.0]
    if m.heroFadeB <> invalid then m.heroFadeB.keyValue = [1.0, 0.0]
    m.heroFront = "a"
  end if
  m.heroFade.control = "start"
  m.shownUri = uri
end sub

sub renderRails()
  while m.railsGroup.getChildCount() > 0
    m.railsGroup.removeChildIndex(0)
  end while
  m.railNodes = []
  y = 0
  i = 0
  while i < m.rails.Count()
    rail = CreateObject("roSGNode", "PosterRail")
    rail.title = m.rails[i].title
    rail.layout = m.rails[i].layout
    rail.items = m.rails[i].items
    rail.translation = [0, y]
    if m.rails[i].layout = "landscape"
      y = y + 430
    else
      y = y + 620
    end if
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
    i = i + 1
  end while
end sub

sub onMode()
  mode = m.top.mode
  showGate = (m.configured <> true)
  m.gate.visible = showGate
  if m.heroCopy <> invalid then m.heroCopy.visible = (showGate <> true and isMediaItem(m.heroItem))
  m.railsGroup.visible = (mode = "ready" and showGate <> true)
  m.loading.visible = (mode = "loading")
  if showGate then m.zone = "gate"
  paintFocus()
end sub

sub paintFocus()
  m.avatar.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 0)
  m.searchBtn.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 1)
  m.homeBtn.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 2)
  m.showsBtn.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 3)
  m.moviesBtn.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 4)
  m.showsBtn.active = (m.lane = "shows")
  m.moviesBtn.active = (m.lane = "movies")
  m.homeBtn.active = false
  if m.watchNow <> invalid then m.watchNow.hasFocusStyle = (m.zone = "hero" and m.heroCol = 0)
  if m.learnMore <> invalid then m.learnMore.hasFocusStyle = (m.zone = "hero" and m.heroCol = 1)
  m.tokenBtn.hasFocusStyle = (m.zone = "gate")
  r = 0
  while r < m.railNodes.Count()
    if m.zone = "rails" and r = m.railRow
      m.railNodes[r].focusCol = m.railCol
    else
      m.railNodes[r].focusCol = -1
    end if
    r = r + 1
  end while
  if m.zone = "rails"
    offset = 0
    i = 0
    while i < m.railRow and i < m.railNodes.Count()
      if m.railNodes[i].layout = "landscape"
        offset = offset + 430
      else
        offset = offset + 620
      end if
      i = i + 1
    end while
    slideRails(1320 - offset)
  else
    slideRails(1320)
  end if
end sub

sub slideRails(y as Float)
  if m.railsGroup = invalid then return
  current = m.railsGroup.translation
  startY = 1320
  if current <> invalid then startY = current[1]
  if Abs(startY - y) < 2 or m.railsAnim = invalid or m.railsInterp = invalid
    m.railsGroup.translation = [0, y]
    return
  end if
  m.railsAnim.control = "stop"
  m.railsInterp.keyValue = [[0, startY], [0, y]]
  m.railsAnim.control = "start"
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

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if m.zone = "gate"
    if intent = "select"
      emit("rdToken", invalid)
      return true
    end if
    return true
  end if
  if m.zone = "chrome"
    if intent = "left" and m.chromeCol > 0 then m.chromeCol = m.chromeCol - 1
    if intent = "right" and m.chromeCol < 4 then m.chromeCol = m.chromeCol + 1
    if intent = "down"
      if isMediaItem(m.heroItem)
        m.zone = "hero"
        m.heroCol = 0
      else if m.railNodes.Count() > 0
        m.zone = "rails"
        m.railRow = 0
        m.railCol = 0
      end if
    end if
    if intent = "select" then activateChrome()
    paintFocus()
    return true
  end if
  if m.zone = "hero"
    if intent = "up" then m.zone = "chrome"
    if intent = "down"
      if m.heroCol = 0
        m.heroCol = 1
      else if m.railNodes.Count() > 0
        m.zone = "rails"
        m.railRow = 0
        m.railCol = 0
      end if
    end if
    if intent = "select" then emit("details", { item: m.heroItem })
    paintFocus()
    return true
  end if
  if m.zone = "rails"
    row = m.rails[m.railRow]
    count = 0
    if row <> invalid then count = row.items.Count()
    if intent = "left" and count > 0
      if m.railCol > 0 then m.railCol = m.railCol - 1 else m.railCol = count - 1
    end if
    if intent = "right" and count > 0
      if m.railCol < count - 1 then m.railCol = m.railCol + 1 else m.railCol = 0
    end if
    if intent = "up"
      if m.railRow > 0
        m.railRow = m.railRow - 1
      else if isMediaItem(m.heroItem)
        m.zone = "hero"
        m.heroCol = 1
      else
        m.zone = "chrome"
      end if
    end if
    if intent = "down" and m.railRow < m.railNodes.Count() - 1 then m.railRow = m.railRow + 1
    if intent = "select" and row <> invalid
      emit("details", { item: row.items[m.railCol] })
    end if
    paintFocus()
    return true
  end if
  return true
end function

sub activateChrome()
  if m.chromeCol = 0 then emit("profiles", invalid)
  if m.chromeCol = 1 then emit("search", invalid)
  if m.chromeCol = 2 then emit("home", invalid)
  if m.chromeCol = 3
    if m.lane = "shows" then m.lane = "all" else m.lane = "shows"
    onPayload()
  end if
  if m.chromeCol = 4
    if m.lane = "movies" then m.lane = "all" else m.lane = "movies"
    onPayload()
  end if
end sub
