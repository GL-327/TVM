sub init()
  m.top.focusable = true
  m.bg = m.top.findNode("bg")
  m.heroArt = m.top.findNode("heroArt")
  m.heroArtB = m.top.findNode("heroArtB")
  m.heroFallback = m.top.findNode("heroFallback")
  m.heroCopy = m.top.findNode("heroCopy")
  m.kicker = m.top.findNode("kicker")
  m.heroTitle = m.top.findNode("heroTitle")
  m.heroMeta = m.top.findNode("heroMeta")
  m.disclaimer = m.top.findNode("disclaimer")
  m.playBtn = m.top.findNode("playBtn")
  m.infoBtn = m.top.findNode("infoBtn")
  m.back = m.top.findNode("back")
  m.brand = m.top.findNode("brand")
  m.tabsGroup = m.top.findNode("tabs")
  m.railsGroup = m.top.findNode("rails")
  m.empty = m.top.findNode("empty")
  m.loading = m.top.findNode("loading")
  m.heroFade = m.top.findNode("heroFade")
  m.heroFadeA = m.top.findNode("heroFadeA")
  m.heroFadeB = m.top.findNode("heroFadeB")
  m.railsAnim = m.top.findNode("railsAnim")
  m.railsInterp = m.top.findNode("railsInterp")
  if m.bg <> invalid then m.bg.color = tvmBgDeep()
  m.kicker.font = tvmFontCaption()
  m.heroTitle.font = tvmFontHero()
  m.heroMeta.font = tvmFontBody()
  m.disclaimer.font = tvmFontCaption()
  m.brand.font = tvmFontTitle()
  m.loading.font = tvmFontBody()
  m.back.variant = "chromelink"
  m.back.label = "Back"
  m.back.focusable = false
  m.playBtn.variant = "primary"
  m.playBtn.label = "Play"
  m.playBtn.focusable = false
  m.infoBtn.variant = "pill"
  m.infoBtn.label = "More Info"
  m.infoBtn.focusable = false
  m.empty.title = "No originals listed yet"
  m.empty.body = "TVM could not load this studio catalog. Retry from Apps."
  m.layout = ""
  m.lane = "home"
  m.zone = "chrome"
  m.chromeCol = 0
  m.heroCol = 0
  m.railRow = 0
  m.railCol = 0
  m.tabs = []
  m.tabNodes = []
  m.watching = []
  m.sourceRails = []
  m.watchlist = []
  m.rails = []
  m.railNodes = []
  m.heroItem = invalid
  m.heroFront = "a"
  m.shownUri = ""
  m.seq = 0
  paintFocus()
end sub

sub onAppId()
  m.lane = "home"
  m.layout = ""
  m.zone = "chrome"
  m.chromeCol = 0
  m.heroCol = 0
  m.railRow = 0
  m.railCol = 0
  m.heroItem = invalid
  m.shownUri = ""
end sub

function serviceNavTabs(layout as String) as Object
  if layout = "netflix"
    return [
      { id: "home", label: "Home" }
      { id: "shows", label: "TV Shows" }
      { id: "movies", label: "Movies" }
      { id: "new", label: "New" }
      { id: "list", label: "My List" }
    ]
  end if
  if layout = "prime"
    return [
      { id: "home", label: "Home" }
      { id: "movies", label: "Movies" }
      { id: "shows", label: "TV" }
      { id: "new", label: "New" }
    ]
  end if
  if layout = "disney"
    return [
      { id: "home", label: "Home" }
      { id: "movies", label: "Movies" }
      { id: "shows", label: "Series" }
      { id: "kids", label: "Kids" }
    ]
  end if
  if layout = "hulu"
    return [
      { id: "home", label: "For You" }
      { id: "movies", label: "Movies" }
      { id: "shows", label: "Series" }
      { id: "list", label: "My Stuff" }
    ]
  end if
  if layout = "peacock"
    return [
      { id: "home", label: "Home" }
      { id: "movies", label: "Movies" }
      { id: "shows", label: "TV Shows" }
      { id: "list", label: "My Stuff" }
    ]
  end if
  if layout = "appletv"
    return [
      { id: "home", label: "Watch Now" }
      { id: "movies", label: "Movies" }
      { id: "shows", label: "TV Shows" }
    ]
  end if
  if layout = "max"
    return [
      { id: "home", label: "Home" }
      { id: "shows", label: "Series" }
      { id: "movies", label: "Movies" }
      { id: "new", label: "New" }
    ]
  end if
  return [
    { id: "home", label: "Home" }
    { id: "shows", label: "Series" }
    { id: "movies", label: "Movies" }
  ]
end function

function servicePlayLabel(layout as String, item as Object) as String
  if hasProgress(item) then return "Resume"
  if layout = "peacock" then return "Watch Now"
  if layout = "hulu" then return "Start Watching"
  return "Play"
end function

function serviceMoreLabel(layout as String) as String
  if layout = "appletv" then return "Info"
  if layout = "max" then return "Go to Series"
  return "More Info"
end function

function serviceKicker(layout as String, item as Object) as String
  kind = LCase(asText(aaGet(item, "kind", "")))
  if layout = "netflix"
    if kind = "series" then return "SERIES" else return "FILM"
  end if
  if layout = "prime" then return "Included with Prime"
  if layout = "max" then return "HBO ORIGINAL"
  if layout = "peacock" then return "STREAMING ON PEACOCK"
  if layout = "hulu" then return "Hulu Original"
  if layout = "disney" then return "Now Streaming"
  if layout = "appletv" then return "Apple Original"
  name = asText(aaGet(item, "network", ""))
  if name <> "" then return name
  return "TVM originals"
end function

function serviceUsesLandscape(layout as String) as Boolean
  return layout = "prime" or layout = "peacock" or layout = "appletv"
end function

function serviceLaneMatches(item as Object, lane as String) as Boolean
  if lane = "home" or lane = "list" then return true
  kind = LCase(asText(aaGet(item, "kind", "")))
  if lane = "shows" then return kind = "series"
  if lane = "movies" then return kind <> "series"
  if lane = "kids" then return itemLooksKids(item)
  if lane = "new"
    year = aaGet(item, "year", 0)
    if year = invalid then return true
    value = Int(year)
    return value >= 2020 or value = 0
  end if
  return true
end function

function itemLooksKids(item as Object) as Boolean
  genres = aaGet(item, "genres", [])
  if genres = invalid then return false
  for each genre in genres
    g = LCase(asText(genre))
    if g.Instr("family") > 0 or g.Instr("animation") > 0 or g.Instr("kids") > 0 or g.Instr("children") > 0
      return true
    end if
  end for
  return false
end function

function filterLaneItems(items as Object) as Object
  out = []
  if items = invalid then return out
  for each item in items
    if isMediaItem(item) and serviceLaneMatches(item, m.lane) then out.Push(item)
  end for
  return out
end function

sub onMode()
  mode = m.top.mode
  m.loading.visible = (mode = "loading")
  m.railsGroup.visible = (mode = "ready")
  paintEmpty()
  if mode = "empty"
    m.zone = "chrome"
    m.chromeCol = 0
  else if mode = "ready" and m.zone <> "rails" and m.zone <> "hero"
    if showHero()
      m.zone = "hero"
      m.heroCol = 0
    else if m.railNodes.Count() > 0
      m.zone = "rails"
      m.railRow = 0
      m.railCol = 0
    else
      m.zone = "chrome"
    end if
  end if
  paintHeroVisible()
  paintFocus()
end sub

sub onPayload()
  payload = m.top.payload
  app = tvmAppById(m.top.appId)
  name = asText(aaGet(payload, "name", ""))
  if name = "" and app <> invalid then name = app.name
  if name = "" then name = "App"
  wordmark = asText(aaGet(payload, "wordmark", ""))
  if wordmark = "" and app <> invalid then wordmark = asText(aaGet(app, "wordmark", name))
  if wordmark = "" then wordmark = name
  m.brand.text = wordmark
  brand = tvmAppBrand(m.top.appId)
  if brand.ink <> tvmText()
    m.brand.color = brand.ink
  else if app <> invalid
    m.brand.color = app.accent
  else
    m.brand.color = tvmText()
  end if
  if m.kicker <> invalid then m.kicker.color = m.brand.color
  layout = asText(aaGet(payload, "layout", "hub"))
  if layout <> m.layout or m.tabs.Count() = 0
    m.layout = layout
    m.tabs = serviceNavTabs(layout)
    if m.chromeCol > m.tabs.Count() then m.chromeCol = 0
    renderTabs()
  end if
  disclaimer = asText(aaGet(payload, "disclaimer", ""))
  if disclaimer = "" then disclaimer = "Titles play through TVM Stream."
  m.disclaimer.text = disclaimer
  m.watching = aaArray(payload, "continueWatching")
  m.watchlist = aaArray(payload, "watchlist")
  m.sourceRails = aaArray(payload, "rails")
  featured = aaGet(payload, "hero", invalid)
  if not isMediaItem(featured) and m.watching.Count() > 0 then featured = m.watching[0]
  if not isMediaItem(featured) and m.sourceRails.Count() > 0
    items = aaArray(m.sourceRails[0], "items")
    if items.Count() > 0 then featured = items[0]
  end if
  m.heroItem = featured
  rebuildRails()
  renderHero()
  paintHeroVisible()
  paintFocus()
end sub

sub renderTabs()
  if m.tabsGroup = invalid then return
  while m.tabsGroup.getChildCount() > 0
    m.tabsGroup.removeChildIndex(0)
  end while
  m.tabNodes = []
  i = 0
  while i < m.tabs.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "chromelink"
    btn.label = m.tabs[i].label
    btn.focusable = false
    btn.translation = [i * 300, 0]
    m.tabsGroup.appendChild(btn)
    m.tabNodes.Push(btn)
    i = i + 1
  end while
end sub

function showHero() as Boolean
  if m.top.mode <> "ready" then return false
  if m.lane = "list" then return false
  return isMediaItem(m.heroItem)
end function

sub paintHeroVisible()
  show = showHero()
  if m.heroCopy <> invalid then m.heroCopy.visible = show
  if m.heroArt <> invalid then m.heroArt.visible = (m.top.mode <> "empty")
  if m.heroArtB <> invalid then m.heroArtB.visible = (m.top.mode <> "empty")
end sub

sub paintEmpty()
  if m.empty = invalid then return
  mode = m.top.mode
  if mode = "empty"
    m.empty.visible = true
    m.empty.title = "No originals listed yet"
    m.empty.body = "TVM could not load this studio catalog. Retry from Apps."
    return
  end if
  if mode = "ready" and m.rails.Count() = 0
    m.empty.visible = true
    m.empty.title = "Nothing in this category yet"
    m.empty.body = "Titles still play through TVM Stream."
    return
  end if
  m.empty.visible = false
end sub

sub renderHero()
  if not isMediaItem(m.heroItem)
    m.heroTitle.text = ""
    m.heroMeta.text = ""
    m.kicker.text = ""
    if m.heroArt <> invalid then m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    if m.heroFallback <> invalid then m.heroFallback.visible = true
    m.shownUri = ""
    return
  end if
  m.kicker.text = serviceKicker(m.layout, m.heroItem)
  m.heroTitle.text = UCase(asText(aaGet(m.heroItem, "title", "TVM")))
  m.heroMeta.text = heroMetaLine(m.heroItem)
  m.playBtn.label = servicePlayLabel(m.layout, m.heroItem)
  m.infoBtn.label = serviceMoreLabel(m.layout)
  uri = preferHeroUri(m.heroItem)
  if uri <> ""
    showHeroUri(uri)
    if m.heroFallback <> invalid then m.heroFallback.visible = false
  else
    if m.heroArt <> invalid then m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    if m.heroFallback <> invalid then m.heroFallback.visible = true
    m.shownUri = ""
  end if
end sub

function heroMetaLine(item as Object) as String
  parts = []
  year = asText(aaGet(item, "year", ""))
  if year <> "" and year <> "0" then parts.Push(year)
  rating = certificateText(asText(aaGet(item, "rating", "")))
  if rating <> "" then parts.Push(rating)
  kind = LCase(asText(aaGet(item, "kind", "")))
  if kind = "series"
    parts.Push("TV Show")
  else if kind <> ""
    parts.Push("Movie")
  end if
  if parts.Count() = 0 then return ""
  line = parts[0]
  i = 1
  while i < parts.Count()
    line = line + " · " + parts[i]
    i = i + 1
  end while
  return line
end function

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

sub rebuildRails()
  m.rails = []
  if m.lane = "list"
    liked = filterLaneItems(m.watchlist)
    if liked.Count() = 0 then liked = filterLaneItems(m.watching)
    if liked.Count() = 0 and m.sourceRails.Count() > 0
      liked = filterLaneItems(aaArray(m.sourceRails[0], "items"))
    end if
    if liked.Count() > 0
      title = "My List"
      if m.layout = "netflix" then title = "TV Shows & Movies You've Liked"
      if m.layout = "hulu" or m.layout = "peacock" then title = "My Stuff"
      m.rails.Push({ id: "list", title: title, items: clipItems(liked, 16), layout: "landscape" })
    end if
  else
    watching = filterLaneItems(m.watching)
    if watching.Count() > 0 and m.lane <> "movies" and m.lane <> "kids"
      watchTitle = "Continue Watching"
      if m.layout = "appletv" then watchTitle = "Up Next"
      if m.layout = "peacock" then watchTitle = "Keep Watching"
      m.rails.Push({ id: "continue", title: watchTitle, items: clipItems(watching, 16), layout: "landscape" })
    end if
    i = 0
    while i < m.sourceRails.Count()
      items = filterLaneItems(aaArray(m.sourceRails[i], "items"))
      if items.Count() > 0
        railLayout = "portrait"
        if serviceUsesLandscape(m.layout) then railLayout = "landscape"
        m.rails.Push({
          id: asText(aaGet(m.sourceRails[i], "id", "rail"))
          title: asText(aaGet(m.sourceRails[i], "title", "Originals"))
          items: clipItems(items, 16)
          layout: railLayout
        })
      end if
      if m.rails.Count() >= 8 then exit while
      i = i + 1
    end while
  end if
  renderRails()
  clampRailFocus()
  paintEmpty()
end sub

sub renderRails()
  if m.railsGroup = invalid then return
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
    y = y + serviceRailPitch(m.rails[i].layout)
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
    i = i + 1
  end while
end sub

sub clampRailFocus()
  if m.railNodes.Count() = 0
    m.railRow = 0
    m.railCol = 0
    if m.zone = "rails"
      if showHero() then m.zone = "hero" else m.zone = "chrome"
    end if
    return
  end if
  if m.railRow >= m.railNodes.Count() then m.railRow = m.railNodes.Count() - 1
  if m.railRow < 0 then m.railRow = 0
  count = railItemCount(m.railRow)
  if count = 0
    m.railCol = 0
  else if m.railCol >= count
    m.railCol = count - 1
  else if m.railCol < 0
    m.railCol = 0
  end if
end sub

function railItemCount(row as Integer) as Integer
  if row < 0 or row >= m.rails.Count() then return 0
  items = m.rails[row].items
  if items = invalid then return 0
  return items.Count()
end function

function serviceRailGap() as Integer
  return 120
end function

function serviceRailPitch(layout as String) as Integer
  body = 620
  if layout = "landscape" then body = 430
  return body + serviceRailGap()
end function

function serviceRailsRestY() as Float
  return 1320
end function

function serviceRailsCamY() as Float
  return 960
end function

function serviceCameraY() as Float
  if m.zone <> "rails" then return serviceRailsRestY()
  offset = 0
  i = 0
  while i < m.railRow and i < m.railNodes.Count()
    layout = "portrait"
    node = m.railNodes[i]
    if node <> invalid then layout = node.layout
    offset = offset + serviceRailPitch(layout)
    i = i + 1
  end while
  return serviceRailsCamY() - offset
end function

sub wrapRailCol(delta as Integer)
  count = railItemCount(m.railRow)
  if count < 2 then return
  nextCol = m.railCol + delta
  if nextCol < 0 then nextCol = count - 1
  if nextCol >= count then nextCol = 0
  m.railCol = nextCol
end sub

function focusedItem() as Object
  if m.zone = "rails" and m.railRow >= 0 and m.railRow < m.rails.Count()
    items = m.rails[m.railRow].items
    if items <> invalid and m.railCol >= 0 and m.railCol < items.Count()
      return items[m.railCol]
    end if
  end if
  return m.heroItem
end function

sub paintFocus()
  m.back.hasFocusStyle = (m.zone = "chrome" and m.chromeCol = 0)
  t = 0
  while t < m.tabNodes.Count()
    on = (t < m.tabs.Count() and m.tabs[t].id = m.lane)
    m.tabNodes[t].active = on
    m.tabNodes[t].hasFocusStyle = (m.zone = "chrome" and m.chromeCol = t + 1)
    t = t + 1
  end while
  if m.playBtn <> invalid then m.playBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 0)
  if m.infoBtn <> invalid then m.infoBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 1)
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
    slideRails(serviceCameraY())
  else
    slideRails(serviceRailsRestY())
  end if
end sub

sub slideRails(y as Float)
  if m.railsGroup = invalid then return
  current = m.railsGroup.translation
  startY = serviceRailsRestY()
  if current <> invalid then startY = current[1]
  if Abs(startY - y) < 2
    m.railsGroup.translation = [0, y]
    return
  end if
  if m.railsAnim = invalid or m.railsInterp = invalid
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

sub playItem(item as Object)
  if isMediaItem(item) then emit("play", { item: item })
end sub

sub openItem(item as Object)
  if isMediaItem(item) then emit("details", { item: item })
end sub

sub activateChrome()
  if m.chromeCol = 0
    emit("back", invalid)
    return
  end if
  tabIndex = m.chromeCol - 1
  if tabIndex < 0 or tabIndex >= m.tabs.Count() then return
  nextLane = m.tabs[tabIndex].id
  if nextLane = m.lane then return
  m.lane = nextLane
  m.railRow = 0
  m.railCol = 0
  rebuildRails()
  paintHeroVisible()
end sub

sub activateHero()
  if m.heroCol = 0
    playItem(m.heroItem)
  else
    openItem(m.heroItem)
  end if
end sub

sub activateRail()
  item = focusedItem()
  if not isMediaItem(item) then return
  rowId = ""
  if m.railRow >= 0 and m.railRow < m.rails.Count() then rowId = asText(aaGet(m.rails[m.railRow], "id", ""))
  if rowId = "continue"
    playItem(item)
  else
    openItem(item)
  end if
end sub

function chromeLast() as Integer
  return m.tabs.Count()
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if intent = "play"
    playItem(focusedItem())
    return true
  end if
  if m.top.mode = "loading"
    if intent = "select" then emit("back", invalid)
    return true
  end if
  if m.zone = "chrome"
    if intent = "left" and m.chromeCol > 0 then m.chromeCol = m.chromeCol - 1
    if intent = "right" and m.chromeCol < chromeLast() then m.chromeCol = m.chromeCol + 1
    if intent = "down"
      if showHero()
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
    if intent = "left" and m.heroCol > 0 then m.heroCol = 0
    if intent = "right" and m.heroCol = 0 then m.heroCol = 1
    if intent = "down" and m.railNodes.Count() > 0
      m.zone = "rails"
      m.railRow = 0
      m.railCol = 0
    end if
    if intent = "select" then activateHero()
    paintFocus()
    return true
  end if
  if m.zone = "rails"
    if intent = "left" then wrapRailCol(-1)
    if intent = "right" then wrapRailCol(1)
    if intent = "up"
      if m.railRow > 0
        m.railRow = m.railRow - 1
        clampRailFocus()
      else if showHero()
        m.zone = "hero"
        m.heroCol = 1
      else
        m.zone = "chrome"
      end if
    end if
    if intent = "down" and m.railRow < m.railNodes.Count() - 1
      m.railRow = m.railRow + 1
      clampRailFocus()
    end if
    if intent = "select" then activateRail()
    paintFocus()
    return true
  end if
  paintFocus()
  return true
end function
