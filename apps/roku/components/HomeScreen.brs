' Home: full-bleed hero, glass Play / Details pills, Continue Watching first,
' then the other rails. Zones: nav (NavStrip) | hero (0 Play, 1 Details) |
' rails (row, col) | error. Focus keys use ids, never indexes:
'   rails:<railId>:<itemId>, hero:<col>, nav:<col>
' so a restore after the 90 s poll, or after Continue Watching reorders because
' something was just played, lands on the same title. Rails are windowed and do
' not loop; only rows near focus keep live cards.
sub init()
  m.top.focusable = true
  m.heroArt = m.top.findNode("heroArt")
  m.heroArtB = m.top.findNode("heroArtB")
  m.heroFallback = m.top.findNode("heroFallback")
  m.heroTitle = m.top.findNode("heroTitle")
  m.heroMeta = m.top.findNode("heroMeta")
  m.heroFade = m.top.findNode("heroFade")
  m.heroFadeA = m.top.findNode("heroFadeA")
  m.heroFadeB = m.top.findNode("heroFadeB")
  m.railsAnim = m.top.findNode("railsAnim")
  m.railsInterp = m.top.findNode("railsInterp")
  m.playBtn = m.top.findNode("playBtn")
  m.detailsBtn = m.top.findNode("detailsBtn")
  m.dots = m.top.findNode("dots")
  m.nav = m.top.findNode("nav")
  m.railsGroup = m.top.findNode("rails")
  m.railScrim = m.top.findNode("railScrim")
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

  m.heroTitle.font = tvmFontHeroTitle()
  m.heroMeta.font = tvmFontSecondary()
  m.loading.font = tvmFontSecondary()

  m.playBtn.variant = "glassPill"
  m.playBtn.pillWidth = 420
  m.playBtn.accent = false
  m.playBtn.iconUri = "pkg:/images/icons/play.png"
  m.playBtn.label = "Play"
  m.playBtn.itemId = "hero-play"
  m.detailsBtn.variant = "glassPill"
  m.detailsBtn.pillWidth = 360
  m.detailsBtn.label = "Details"
  m.detailsBtn.itemId = "hero-info"
  m.detailsBtn.translation = [460, 456]

  m.nav.activeId = "home"
  m.nav.focusCol = 0

  m.zone = "nav"
  m.navCol = 0
  m.heroCol = 0
  m.railRow = 0
  m.railCol = 0
  m.focusRailId = ""
  m.focusItemId = ""
  m.pendingKey = ""
  m.wasReady = false
  m.heroItem = invalid
  m.heroes = []
  m.heroSlide = 0
  m.heroSig = ""
  m.rails = []
  m.railNodes = []
  m.railsSig = ""
  m.seq = 0
  m.heroFront = "a"
  m.fadeBusy = false
  m.loadingHeroUri = ""
  m.requestedHeroUri = ""
  m.heroLoadSide = ""
  m.shownUri = ""
  m.railsY = 1160

  m.empty.title = "Nothing to show yet"
  m.empty.body = "Core is reachable, but Home has no titles yet."
  m.heroDebounce = m.top.findNode("heroDebounce")
  m.heroDebounce.observeField("fire", "beginHeroLoad")
  m.heroArt.observeField("loadStatus", "onHeroArtLoad")
  m.heroArtB.observeField("loadStatus", "onHeroArtLoad")
  m.heroTimer.observeField("fire", "onHeroTick")
  if m.heroFade <> invalid then m.heroFade.observeField("state", "onHeroFadeState")
  onMode()
end sub

sub onProfileName()
  if m.nav <> invalid then m.nav.profileName = m.top.profileName
end sub

sub onMode()
  if m.playBtn = invalid then return
  mode = m.top.mode
  showHero = (mode = "ready")
  m.heroArt.visible = showHero
  m.heroArtB.visible = showHero
  m.heroFallback.visible = showHero and m.shownUri = ""
  if m.heroFallback.visible then m.heroFallback.uri = "pkg:/images/lighthouse.jpg"
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
    m.wasReady = false
  else if mode = "ready"
    if not m.wasReady
      m.wasReady = true
      if m.zone = "error" or m.zone = "nav"
        if isMediaItem(m.heroItem)
          m.zone = "hero"
        else if m.railNodes.Count() > 0
          m.zone = "rails"
        else
          m.zone = "nav"
        end if
      end if
    end if
  else
    m.zone = "nav"
    m.wasReady = false
  end if

  if mode = "ready" then startHeroTimer() else stopHeroTimer()
  paintFocus()
end sub

sub onPayload()
  payload = m.top.payload
  heroes = homeHeroes(payload)
  heroSig = ""
  for each item in heroes
    heroSig = heroSig + asText(aaGet(item, "id", "")) + ","
  end for
  if heroSig <> m.heroSig or not isMediaItem(m.heroItem)
    m.heroSig = heroSig
    m.heroes = heroes
    m.heroSlide = 0
    if m.heroes.Count() > 0
      m.heroItem = m.heroes[0]
    else
      m.heroItem = homeHero(payload)
    end if
    renderHero()
  end if

  newRails = homeContentRails(payload)
  sig = railsSignature(newRails)
  if sig <> m.railsSig
    m.railsSig = sig
    m.rails = newRails
    renderRails()
    reapplyFocus()
  end if
  if m.top.mode = "ready"
    startHeroTimer()
    paintFocus()
  end if
end sub

' After the rails were rebuilt (poll, or a reorder after playback), put focus
' back on the same ids. A pending restore key from before the data arrived
' wins; otherwise the remembered rail/item ids are resolved again.
sub reapplyFocus()
  if m.pendingKey <> ""
    key = m.pendingKey
    m.pendingKey = ""
    applyFocusKey(key)
    return
  end if
  if m.zone = "rails"
    found = resolveRailFocus(m.rails, m.focusRailId, m.focusItemId, m.railRow, m.railCol)
    m.railRow = found.row
    m.railCol = found.col
  else
    clampRails()
  end if
end sub

sub clampRails()
  if m.rails.Count() = 0
    m.railRow = 0
    m.railCol = 0
    return
  end if
  if m.railRow > m.rails.Count() - 1 then m.railRow = m.rails.Count() - 1
  clampRailCol()
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
  if m.zone = "rails" or m.top.visible = false then return
  if m.fadeBusy or m.loadingHeroUri <> "" then return
  m.heroSlide = (m.heroSlide + 1) mod m.heroes.Count()
  m.heroItem = m.heroes[m.heroSlide]
  renderHero()
end sub

sub renderHero()
  item = m.heroItem
  if not isMediaItem(item)
    m.heroTitle.text = "TVM"
    m.heroMeta.text = ""
    clearHeroArt()
    showHeroFallback()
    m.playBtn.visible = false
    m.detailsBtn.visible = false
    paintDots()
    return
  end if

  uri = preferHeroUri(item)
  if uri <> ""
    m.requestedHeroItem = item
    if uri = m.shownUri
      m.displayedHeroItem = item
      paintHeroCopy(item)
    else if m.shownUri = ""
      paintHeroCopy(item)
    end if
    showHeroUri(uri)
    if m.shownUri = "" then showHeroFallback()
  else
    clearHeroArt()
    m.displayedHeroItem = item
    paintHeroCopy(item)
    showHeroFallback()
  end if
  paintDots()
end sub

sub showHeroFallback()
  m.heroFallback.uri = "pkg:/images/lighthouse.jpg"
  m.heroFallback.visible = true
end sub

sub paintHeroCopy(item as Object)
  m.playBtn.visible = true
  m.detailsBtn.visible = true
  m.heroTitle.text = asText(aaGet(item, "title", "TVM"))
  wordmark = asText(aaGet(item, "wordmark", ""))
  if wordmark = "ember"
    m.heroTitle.color = tvmEmber()
  else
    m.heroTitle.color = tvmText()
  end if
  m.heroMeta.text = homeHeroMeta(item)
  if hasProgress(item)
    m.playBtn.label = "Resume"
  else
    m.playBtn.label = "Play"
  end if

end sub

sub clearHeroArt()
  m.fadeBusy = false
  m.loadingHeroUri = ""
  m.requestedHeroUri = ""
  m.heroDebounce.control = "stop"
  m.heroFade.control = "stop"
  m.heroArt.uri = ""
  m.heroArtB.uri = ""
  m.heroArt.opacity = 1
  m.heroArtB.opacity = 0
  m.heroFront = "a"
  m.shownUri = ""
  m.displayedHeroItem = invalid
  m.global.trendingHeroUri = ""
end sub

' Crossfade between two hero posters. Once the fade is done the hidden one is
' released, so only one hero texture is held while Home sits idle.
sub showHeroUri(uri as String)
  if uri = m.shownUri or uri = m.loadingHeroUri then return
  m.requestedHeroUri = uri
  m.heroDebounce.control = "stop"
  m.heroDebounce.control = "start"
end sub

sub beginHeroLoad()
  if m.fadeBusy or m.loadingHeroUri <> "" then return
  uri = m.requestedHeroUri
  if uri = "" or uri = m.shownUri then return
  m.requestedHeroUri = ""
  m.loadingHeroUri = uri
  m.loadingHeroItem = m.requestedHeroItem
  m.heroLoadSide = "b"
  if m.shownUri = "" or m.heroFront = "b" then m.heroLoadSide = "a"
  poster = m.heroArtB
  if m.heroLoadSide = "a" then poster = m.heroArt
  poster.opacity = 0
  poster.uri = uri
end sub

sub onHeroArtLoad()
  if m.loadingHeroUri = "" then return
  poster = m.heroArtB
  if m.heroLoadSide = "a" then poster = m.heroArt
  if poster.uri <> m.loadingHeroUri then return
  if poster.loadStatus = "failed"
    poster.uri = ""
    m.loadingHeroUri = ""
    beginHeroLoad()
    return
  end if
  if poster.loadStatus <> "ready" then return
  first = m.shownUri = ""
  m.shownUri = m.loadingHeroUri
  m.loadingHeroUri = ""
  m.heroFront = m.heroLoadSide
  m.displayedHeroItem = m.loadingHeroItem
  paintHeroCopy(m.displayedHeroItem)
  m.heroFallback.visible = false
  m.heroFallback.uri = ""
  m.global.trendingHeroUri = m.shownUri
  if first or tvmReduceMotion()
    m.heroArt.opacity = 0
    m.heroArtB.opacity = 0
    poster.opacity = 1
    if m.heroFront = "a" then m.heroArtB.uri = "" else m.heroArt.uri = ""
    beginHeroLoad()
    return
  end if
  if m.heroFront = "b"
    m.heroFadeA.keyValue = [1.0, 0.0]
    m.heroFadeB.keyValue = [0.0, 1.0]
  else
    m.heroFadeA.keyValue = [0.0, 1.0]
    m.heroFadeB.keyValue = [1.0, 0.0]
  end if
  m.fadeBusy = true
  m.heroFade.control = "start"
end sub

sub onHeroFadeState()
  if m.heroFade.state <> "stopped" then return
  if not m.fadeBusy then return
  m.fadeBusy = false
  if m.heroFront = "a"
    m.heroArtB.uri = ""
    m.heroArtB.opacity = 0
  else
    m.heroArt.uri = ""
    m.heroArt.opacity = 0
  end if
  beginHeroLoad()
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
        node.blendColor = "0xFFFFFFFF"
      else
        node.blendColor = "0xFFFFFF59"
      end if
    end if
    i = i + 1
  end while
end sub

function railLayoutFor(rail as Object) as String
  if asText(rail.id) = "continue" then return "landscape"
  return "portrait"
end function

sub renderRails()
  while m.railsGroup.getChildCount() > 0
    m.railsGroup.removeChildIndex(0)
  end while
  m.railNodes = []

  anchor = 0
  if m.zone = "rails" then anchor = m.railRow
  i = 0
  y = 0
  while i < m.rails.Count()
    layout = railLayoutFor(m.rails[i])
    rail = CreateObject("roSGNode", "PosterRail")
    rail.live = railRowLive(i, anchor)
    rail.layout = layout
    rail.title = m.rails[i].title
    rail.items = m.rails[i].items
    rail.translation = [0, y]
    y = y + railRowHeight(layout)
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
    i = i + 1
  end while
end sub

function railOffset(row as Integer) as Integer
  offset = 0
  i = 0
  while i < row and i < m.rails.Count()
    offset = offset + railRowHeight(railLayoutFor(m.rails[i]))
    i = i + 1
  end while
  return offset
end function

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  if m.rails.Count() = 0 and Left(key, 6) = "rails:"
    m.pendingKey = key
    return
  end if
  applyFocusKey(key)
  paintFocus()
end sub

sub applyFocusKey(key as String)
  parsed = parseFocusKey(key)
  if parsed.zone = "rails"
    found = resolveRailFocus(m.rails, parsed.a, parsed.b, m.railRow, m.railCol)
    if m.rails.Count() > 0
      m.zone = "rails"
      m.railRow = found.row
      m.railCol = found.col
    end if
  else if parsed.zone = "hero"
    m.zone = "hero"
    m.heroCol = Int(Val(parsed.a))
    if m.heroCol < 0 or m.heroCol > 1 then m.heroCol = 0
  else if parsed.zone = "nav"
    m.zone = "nav"
    m.navCol = Int(Val(parsed.a))
    if m.navCol < 0 or m.navCol > tvmNavSpec().Count() then m.navCol = 0
  end if
end sub

sub rememberFocus()
  if m.zone = "rails" and m.rails.Count() > 0
    row = m.rails[m.railRow]
    itemId = ""
    if row <> invalid and m.railCol < row.items.Count()
      itemId = asText(aaGet(row.items[m.railCol], "id", ""))
      m.focusRailId = asText(row.id)
      m.focusItemId = itemId
      m.top.focusKey = railFocusKey(m.focusRailId, itemId)
    end if
  else if m.zone = "hero"
    m.top.focusKey = "hero:" + StrI(m.heroCol).Trim()
  else
    m.top.focusKey = "nav:" + StrI(m.navCol).Trim()
  end if
end sub

sub paintFocus()
  m.nav.hasBarFocus = (m.zone = "nav")
  m.nav.focusCol = m.navCol
  m.nav.activeId = "home"
  m.playBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 0)
  m.detailsBtn.hasFocusStyle = (m.zone = "hero" and m.heroCol = 1)

  inRails = (m.zone = "rails")
  anchor = 0
  if inRails then anchor = m.railRow
  r = 0
  while r < m.railNodes.Count()
    m.railNodes[r].live = railRowLive(r, anchor)
    if inRails and r = m.railRow
      m.railNodes[r].focusCol = m.railCol
    else
      m.railNodes[r].focusCol = -1
    end if
    r = r + 1
  end while

  m.error.hasFocusStyle = (m.zone = "error")
  m.heroCopy.visible = (m.top.mode = "ready" and not inRails)
  m.railScrim.visible = inRails

  if inRails
    slideRails(1000 - railOffset(m.railRow))
  else
    slideRails(1160)
  end if

  rememberFocus()
end sub

sub slideRails(y as Float)
  if m.railsGroup = invalid then return
  if Abs(m.railsY - y) < 2
    m.railsGroup.translation = [0, y]
    return
  end if
  startY = m.railsY
  m.railsY = y
  if m.railsAnim = invalid or m.railsInterp = invalid or tvmReduceMotion()
    m.railsGroup.translation = [0, y]
    return
  end if
  m.railsAnim.control = "stop"
  m.railsAnim.duration = tvmMotionPanel()
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
  if intent = "info"
    if m.ownerTaps = invalid then m.ownerTaps = 0
    m.ownerTaps = m.ownerTaps + 1
    if m.ownerTaps >= 7
      m.ownerTaps = 0
      emit("ownerDoor", invalid)
    end if
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
    if intent = "up" then m.zone = "nav"
    paintFocus()
    return
  end if

  if m.zone = "nav"
    if intent = "left" or intent = "right"
      m.navCol = navStep(m.navCol, intent, tvmNavSpec().Count() + 1)
    else if intent = "down"
      if mode = "ready" and isMediaItem(m.heroItem)
        m.zone = "hero"
      else if mode = "ready" and m.railNodes.Count() > 0
        m.zone = "rails"
        m.railRow = 0
        clampRailCol()
      else if mode = "error"
        m.zone = "error"
      end if
    end if
  else if m.zone = "hero"
    if intent = "left" or intent = "right"
      m.heroCol = heroStep(m.heroCol, intent)
    else if intent = "up"
      m.zone = "nav"
    else if intent = "down" and m.railNodes.Count() > 0
      m.zone = "rails"
      m.railRow = 0
      clampRailCol()
    end if
  else if m.zone = "rails"
    row = m.rails[m.railRow]
    count = 0
    if row <> invalid then count = row.items.Count()
    if intent = "left" and m.railCol > 0 then m.railCol = m.railCol - 1
    if intent = "right" and m.railCol < count - 1 then m.railCol = m.railCol + 1
    if intent = "up"
      if m.railRow > 0
        m.railRow = m.railRow - 1
        clampRailCol()
      else if isMediaItem(m.heroItem)
        m.zone = "hero"
      else
        m.zone = "nav"
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
  if m.railRow < 0 or m.railRow >= m.rails.Count()
    m.railCol = 0
    return
  end if
  count = m.rails[m.railRow].items.Count()
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

  if m.zone = "nav"
    specs = tvmNavSpec()
    if m.navCol >= specs.Count()
      emit("you", invalid)
    else
      emit("nav", { id: specs[m.navCol].id })
    end if
    return
  end if

  if m.zone = "hero"
    item = m.heroItem
    if isMediaItem(m.displayedHeroItem) then item = m.displayedHeroItem
    if m.heroCol = 0
      m.playBtn.pressed = true
      emit("play", { item: item })
    else
      m.detailsBtn.pressed = true
      emit("details", { item: item })
    end if
    return
  end if

  if m.zone = "rails"
    row = m.rails[m.railRow]
    if row = invalid then return
    item = row.items[m.railCol]
    emit("details", { item: item })
  end if
end sub

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
