sub init()
  m.top.focusable = true
  m.heroArt = m.top.findNode("heroArt")
  m.heroArtB = m.top.findNode("heroArtB")
  m.heroFallback = m.top.findNode("heroFallback")
  m.heroTitle = m.top.findNode("heroTitle")
  m.heroSource = m.top.findNode("heroSource")
  m.heroBrand = m.top.findNode("heroBrand")
  m.heroRule = m.top.findNode("heroRule")
  m.heroFade = m.top.findNode("heroFade")
  m.heroFadeA = m.top.findNode("heroFadeA")
  m.heroFadeB = m.top.findNode("heroFadeB")
  m.railsAnim = m.top.findNode("railsAnim")
  m.railsInterp = m.top.findNode("railsInterp")
  m.watchNow = m.top.findNode("watchNow")
  m.learnMore = m.top.findNode("learnMore")
  m.dots = m.top.findNode("dots")
  m.ribbon = m.top.findNode("ribbon")
  m.railsGroup = m.top.findNode("rails")
  m.status = m.top.findNode("status")
  m.error = m.top.findNode("error")
  m.empty = m.top.findNode("empty")
  m.loading = m.top.findNode("loading")
  m.heroCopy = m.top.findNode("heroCopy")
  m.heroTimer = m.top.findNode("heroTimer")
  m.dotNodes = [
    m.top.findNode("dot0")
    m.top.findNode("dot1")
    m.top.findNode("dot2")
    m.top.findNode("dot3")
  ]

  m.heroTitle.font = tvmFontHero()
  m.heroSource.font = tvmFont("bold", 40)
  m.heroRule.font = tvmFont("bold", 40)
  m.loading.font = tvmFontBody()

  m.watchNow.variant = "watchnow"
  m.watchNow.label = "WATCH NOW"
  m.watchNow.itemId = "hero-play"
  m.learnMore.variant = "pill"
  m.learnMore.label = "Learn More"
  m.learnMore.itemId = "hero-info"

  m.ribbonSpec = tvmRibbonSpec()
  m.homeIndex = 3
  m.ribbon.activeId = "home"
  m.ribbon.focusCol = 3
  m.ribbon.hasBarFocus = true

  m.zone = "ribbon"
  m.heroCol = 0
  m.ribbonCol = 3
  m.railRow = 0
  m.railCol = 0
  m.heroItem = invalid
  m.heroes = []
  m.heroSlide = 0
  m.rails = []
  m.railNodes = []
  m.seq = 0
  m.heroFront = "a"
  m.shownUri = ""

  m.empty.title = "Nothing to show yet"
  m.empty.body = "Core is reachable, but Home has no titles yet."
  m.heroTimer.observeField("fire", "onHeroTick")
  onMode()
end sub

sub onMode()
  if m.watchNow = invalid then return
  mode = m.top.mode
  showHero = (mode = "ready")
  m.heroArt.visible = showHero
  m.heroFallback.visible = false
  m.heroCopy.visible = showHero
  m.railsGroup.visible = (mode = "ready")
  m.status.visible = (mode <> "ready")
  m.error.visible = (mode = "error")
  m.empty.visible = (mode = "empty")
  m.loading.visible = (mode = "loading")

  if mode = "error"
    m.error.title = m.top.errorTitle
    m.error.body = m.top.errorBody
    m.zone = "error"
  else if mode = "loading"
    m.zone = "ribbon"
  else if mode = "empty"
    m.zone = "ribbon"
  else
    if m.zone = "error" then m.zone = "ribbon"
  end if

  if mode = "ready" then startHeroTimer() else stopHeroTimer()
  paintFocus()
end sub

sub onPayload()
  payload = m.top.payload
  m.heroes = homeHeroes(payload)
  m.heroSlide = 0
  if m.heroes.Count() > 0
    m.heroItem = m.heroes[0]
  else
    m.heroItem = homeHero(payload)
  end if
  m.rails = homeContentRails(payload)
  renderHero()
  renderRails()
  if m.top.mode = "ready"
    startHeroTimer()
    paintFocus()
  end if
end sub

sub startHeroTimer()
  if m.heroTimer = invalid then return
  m.heroTimer.control = "stop"
  if m.top.mode = "ready" and m.heroes.Count() > 1
    m.heroTimer.control = "start"
  end if
end sub

sub stopHeroTimer()
  if m.heroTimer = invalid then return
  m.heroTimer.control = "stop"
end sub

sub onHeroTick()
  if m.heroes.Count() < 2 then return
  m.heroSlide = (m.heroSlide + 1) mod m.heroes.Count()
  m.heroItem = m.heroes[m.heroSlide]
  renderHero()
end sub

sub renderHero()
  item = m.heroItem
  if not isMediaItem(item)
    m.heroTitle.text = "TVM"
    m.heroSource.text = "tvm"
    m.heroSource.visible = true
    if m.heroBrand <> invalid then m.heroBrand.visible = false
    m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    m.heroFallback.visible = true
    m.shownUri = ""
    paintDots()
    return
  end if

  m.heroTitle.text = UCase(asText(aaGet(item, "title", "TVM")))
  wordmark = asText(aaGet(item, "wordmark", ""))
  if wordmark = "ember"
    m.heroTitle.color = tvmEmber()
  else
    m.heroTitle.color = tvmText()
  end if
  source = watchSourceLabel(item)
  m.heroSource.text = source
  if source = "tvm stream"
    m.heroSource.visible = false
    if m.heroBrand <> invalid then m.heroBrand.visible = true
  else
    m.heroSource.visible = true
    if m.heroBrand <> invalid then m.heroBrand.visible = false
  end if

  uri = preferHeroUri(item)
  if uri <> ""
    showHeroUri(uri)
    m.heroFallback.visible = false
  else
    m.heroArt.uri = ""
    if m.heroArtB <> invalid then m.heroArtB.uri = ""
    m.heroFallback.visible = true
    m.shownUri = ""
  end if
  paintDots()
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

sub paintDots()
  count = m.heroes.Count()
  show = count > 1
  m.dots.visible = show
  i = 0
  while i < 4
    node = m.dotNodes[i]
    if node <> invalid
      node.visible = (show and i < count)
      if i = m.heroSlide
        node.color = "0xFFFFFFFF"
      else
        node.color = "0xFFFFFF59"
      end if
    end if
    i = i + 1
  end while
end sub

sub renderRails()
  while m.railsGroup.getChildCount() > 0
    m.railsGroup.removeChildIndex(0)
  end while
  m.railNodes = []

  i = 0
  y = 0
  while i < m.rails.Count()
    rail = CreateObject("roSGNode", "PosterRail")
    rail.title = m.rails[i].title
    rail.layout = "portrait"
    rail.items = m.rails[i].items
    rail.translation = [0, y]
    if rail.layout = "landscape"
      y = y + 430
    else
      y = y + 620
    end if
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
    i = i + 1
  end while
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  parts = splitFocusKey(key)
  if parts.Count() = 0 then return
  m.zone = parts[0]
  if m.zone = "hero" and parts.Count() > 1 then m.heroCol = Int(Val(parts[1]))
  if m.zone = "ribbon" and parts.Count() > 1 then m.ribbonCol = Int(Val(parts[1]))
  if m.zone = "rails" and parts.Count() > 2
    m.railRow = Int(Val(parts[1]))
    m.railCol = Int(Val(parts[2]))
  end if
  paintFocus()
end sub

function splitFocusKey(key as String) as Object
  out = []
  remaining = key
  while remaining <> ""
    idx = Instr(1, remaining, ":")
    if idx = 0
      out.Push(remaining)
      exit while
    end if
    out.Push(Left(remaining, idx - 1))
    remaining = Mid(remaining, idx + 1)
  end while
  return out
end function

sub rememberFocus()
  if m.zone = "rails"
    m.top.focusKey = "rails:" + StrI(m.railRow).Trim() + ":" + StrI(m.railCol).Trim()
  else if m.zone = "hero"
    m.top.focusKey = "hero:" + StrI(m.heroCol).Trim()
  else
    m.top.focusKey = "ribbon:" + StrI(m.ribbonCol).Trim()
  end if
end sub

sub paintFocus()
  m.watchNow.hasFocusStyle = (m.zone = "hero" and m.heroCol = 0)
  m.learnMore.hasFocusStyle = (m.zone = "hero" and m.heroCol = 1)
  m.ribbon.hasBarFocus = (m.zone = "ribbon")
  m.ribbon.focusCol = m.ribbonCol
  m.ribbon.activeId = "home"

  r = 0
  while r < m.railNodes.Count()
    if m.zone = "rails" and r = m.railRow
      m.railNodes[r].focusCol = m.railCol
    else
      m.railNodes[r].focusCol = -1
    end if
    r = r + 1
  end while

  m.error.hasFocusStyle = (m.zone = "error")

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
    slideRails(1504 - offset)
  else
    slideRails(1504)
  end if

  rememberFocus()
end sub

sub slideRails(y as Float)
  if m.railsGroup = invalid then return
  current = m.railsGroup.translation
  startY = 1504
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

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if isDirectional(intent)
    moveFocus(intent)
    return true
  end if
  if intent = "select"
    activate()
    return true
  end if
  return true
end function

sub moveFocus(intent as String)
  mode = m.top.mode
  if mode = "loading" then return

  if m.zone = "error"
    if intent = "up" then m.zone = "ribbon"
    paintFocus()
    return
  end if

  if m.zone = "hero"
    if intent = "down"
      if m.heroCol = 0
        m.heroCol = 1
      else
        m.zone = "ribbon"
      end if
    end if
    if intent = "up" and m.heroCol = 1 then m.heroCol = 0
  else if m.zone = "ribbon"
    if intent = "left" and m.ribbonCol > 0 then m.ribbonCol = m.ribbonCol - 1
    if intent = "right" and m.ribbonCol < m.ribbonSpec.Count() - 1 then m.ribbonCol = m.ribbonCol + 1
    if intent = "up" and m.top.mode = "ready" and isMediaItem(m.heroItem)
      m.zone = "hero"
      m.heroCol = 1
    end if
    if intent = "down" and m.top.mode = "ready" and m.railNodes.Count() > 0
      m.zone = "rails"
      m.railRow = 0
      m.railCol = 0
    else if intent = "down" and m.top.mode = "error"
      m.zone = "error"
    end if
  else if m.zone = "rails"
    row = m.rails[m.railRow]
    count = 0
    if row <> invalid then count = row.items.Count()
    if intent = "left"
      if m.railCol > 0
        m.railCol = m.railCol - 1
      else if count > 0
        m.railCol = count - 1
      end if
    end if
    if intent = "right"
      if count = 0
        ' stay
      else if m.railCol < count - 1
        m.railCol = m.railCol + 1
      else
        m.railCol = 0
      end if
    end if
    if intent = "up"
      if m.railRow > 0
        m.railRow = m.railRow - 1
        clampRailCol()
      else
        m.zone = "ribbon"
      end if
    end if
    if intent = "down" and m.railRow < m.railNodes.Count() - 1
      m.railRow = m.railRow + 1
      clampRailCol()
    end if
  end if

  paintFocus()
end sub

sub clampRailCol()
  row = m.rails[m.railRow]
  count = 0
  if row <> invalid then count = row.items.Count()
  if count = 0
    m.railCol = 0
  else if m.railCol >= count
    m.railCol = count - 1
  end if
end sub

sub activate()
  if m.zone = "error"
    emit("retry", invalid)
    return
  end if

  if m.zone = "hero"
    emit("details", { item: m.heroItem })
    return
  end if

  if m.zone = "ribbon"
    spec = m.ribbonSpec[m.ribbonCol]
    emit(spec.action, spec)
    return
  end if

  if m.zone = "rails"
    row = m.rails[m.railRow]
    if row = invalid then return
    item = row.items[m.railCol]
    emit("details", { item: item })
  end if
end sub
