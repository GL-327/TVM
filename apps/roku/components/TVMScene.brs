sub init()
  applyCanvasScale()
  m.global.addFields({
    reduceMotion: loadReduceMotion()
    reduceTransparency: loadReduceTransparency()
    background: loadBackground()
    trendingHeroUri: ""
    hubFixture: loadFlag("hubFixture")
    inputSerial: 0
    kidsProfile: false
    uiScale: m.uiMetrics.scale
  })
  applyCurrentTheme()
  m.featureNodes = {}
  m.pageTasks = {}
  m.kidsProfile = false
  m.profileMaxAge = 18
  m.screenHost = m.top.findNode("screenHost")
  m.overlayHost = m.top.findNode("overlayHost")
  m.bootLabel = m.top.findNode("bootLabel")
  if m.bootLabel <> invalid then m.bootLabel.font = tvmFontHero()
  m.coreUrl = loadCoreBaseUrl()
  m.coreToken = loadCoreToken()
  m.accountToken = loadAccountToken()
  m.profileName = ""
  m.catalogFilter = ""
  m.youNode = invalid
  m.accountEmail = ""
  m.accountPassword = ""
  m.accountName = ""
  m.accountMode = "signin"
  m.accountState = {}
  m.requestSeq = 0
  m.profileId = ""
  m.keyboardMode = "coreUrl"
  m.catalogKind = ""
  m.catalogQuery = ""
  m.homeTask = invalid
  m.healthTask = invalid
  m.catalogTask = invalid
  m.playTask = invalid
  m.liveTask = invalid
  m.livePicksTask = invalid
  m.profilesTask = invalid
  m.mutateTask = invalid
  m.childrenTask = invalid
  m.updateTask = invalid
  m.rdTask = invalid
  m.watchlistTask = invalid
  m.detailsTask = invalid
  m.searchTask = invalid
  m.appsTask = invalid
  m.progressTask = invalid
  m.homeNode = invalid
  m.settingsNode = invalid
  m.setupNode = invalid
  m.accountNode = invalid
  m.catalogNode = invalid
  m.liveNode = invalid
  m.livePicksNode = invalid
  m.profilesNode = invalid
  m.profileNode = invalid
  m.appsNode = invalid
  m.infoNode = invalid
  m.detailsNode = invalid
  m.libraryNode = invalid
  m.serviceNode = invalid
  m.rdNode = invalid
  m.hubNode = invalid
  m.deviceCredential = ""
  m.hubPlayCmd = ""
  m.health = {}
  m.rd = {}
  m.rdPromptedOnce = false
  m.rdBootCheck = false
  m.detailsSaved = false
  m.profilesNext = ""
  m.pendingPlayItem = invalid
  m.nextPlayItem = invalid
  m.homeSilent = false
  m.searchTimer = invalid
  m.livePicksQuery = ""
  m.livePicksGroup = ""
  m.livePicksOffset = 0
  m.top.setFocus(true)
  initReleaseFeatures()
  initHubAgent()

  timer = CreateObject("roSGNode", "Timer")
  timer.duration = 0.2
  timer.repeat = false
  timer.observeField("fire", "onBoot")
  m.bootTimer = timer
  timer.control = "start"

  poll = CreateObject("roSGNode", "Timer")
  poll.duration = 90
  poll.repeat = true
  poll.observeField("fire", "onHomePoll")
  m.homePoll = poll
  poll.control = "start"
end sub

sub applyCurrentTheme()
  key = currentThemeId()
  applyThemeColorsToScene(m.top, key)
  raw = ReadAsciiFile("pkg:/source/themeGlass.brs")
  if raw = invalid or raw = "" then return
  if tvmIsGlassTheme(key)
    applyGlassTheme(m.top)
  else
    clearGlassTheme(m.top)
  end if
end sub

sub applyAndSaveTheme(id as Dynamic)
  previous = tvmThemePalette(currentThemeId())
  key = normalizeThemeId(id)
  saveThemeId(key)
  applyCurrentTheme()
  repaintThemeNodes(m.screenHost, tvmPalettePairs(previous, tvmThemePalette(key)))
  if m.settingsNode <> invalid then m.settingsNode.themeId = key
end sub

sub applyCanvasScale()
  metrics = tvmUiMetrics()
  m.uiMetrics = metrics
  letterbox = m.top.findNode("letterbox")
  if letterbox <> invalid
    letterbox.width = metrics.width
    letterbox.height = metrics.height
  end if
  root = m.top.findNode("uiRoot")
  if root <> invalid
    root.scale = [metrics.scale, metrics.scale]
    root.translation = [metrics.x, metrics.y]
  end if
end sub

sub onBoot()
  if isValidCoreUrl(m.coreUrl) and not isCoreToken(m.coreToken)
    m.stack = createViewStack("setup")
    renderStack()
    showTokenKeyboard()
    return
  end if
  refreshRokuContent()
  loadAccount(true)
end sub

' Screen name -> node. Every screen that exposes a focusKey field is remembered
' on the view stack and, if it also has a restoreKey field, restored on return.
function screenNode(name as String) as Object
  if m.featureNodes.DoesExist(name) then return m.featureNodes[name]
  if name = "home" then return m.homeNode
  if name = "settings" then return m.settingsNode
  if name = "setup" then return m.setupNode
  if name = "account" then return m.accountNode
  if name = "catalog" then return m.catalogNode
  if name = "live" then return m.liveNode
  if name = "live-picks" then return m.livePicksNode
  if name = "profiles" then return m.profilesNode
  if name = "profile" then return m.profileNode
  if name = "apps" then return m.appsNode
  if name = "info" then return m.infoNode
  if name = "details" then return m.detailsNode
  if name = "library" then return m.libraryNode
  if name = "service" then return m.serviceNode
  if name = "realdebrid" then return m.rdNode
  if name = "hub" then return m.hubNode
  return invalid
end function

sub rememberActiveFocus()
  screen = visibleScreen(m.stack)
  node = screenNode(screen.name)
  if node = invalid then return
  if not node.hasField("focusKey") then return
  key = node.focusKey
  if key = invalid or key = "" then return
  m.stack = viewStackRememberFocus(m.stack, key)
end sub

sub applyRestoreKey(screen as Object)
  node = screenNode(screen.name)
  if node = invalid then return
  if not node.hasField("restoreKey") then return
  if screen.focusKey = invalid or screen.focusKey = "" then return
  node.restoreKey = screen.focusKey
end sub

sub navigate(kind as String, name as String, params as Object)
  dismissReleaseCards()
  rememberActiveFocus()
  if kind = "push"
    m.stack = viewStackPush(m.stack, name, params)
  else if kind = "modal"
    m.stack = viewStackPushModal(m.stack, name, params)
  else if kind = "home"
    m.stack = viewStackHome(m.stack)
  else if kind = "reset"
    m.stack = viewStackReset(m.stack, name)
  else if kind = "pop"
    m.stack = viewStackPop(m.stack)
  end if
  renderStack()
  if kind = "pop"
    restored = visibleScreen(m.stack)
    if restored.name = "details" and activeEntry(m.stack).kind <> "modal" then loadDetails(restored.params)
  end if
  updateBackHint()
  maybeShowReleaseCards()
  if kind = "push"
    if name = "catalog" then loadCatalog(params)
    if name = "library" then loadLibrary()
    if name = "live" then loadLive()
    if name = "live-picks"
      m.livePicksQuery = ""
      m.livePicksGroup = ""
      m.livePicksOffset = 0
      loadLivePicks()
    end if
    if name = "profiles" then
      m.profilesNext = aaGet(params, "next", "")
      loadProfiles(true)
    end if
    if name = "profile" then loadRdStatus()
    if name = "realdebrid" then loadRdStatus()
    if name = "service" then loadService(params)
    if name = "details" then loadDetails(params)
    if name = "hub" then m.hubNode.reset = true
    if featureName(name) then loadFeature(name, params)
  end if
end sub

sub renderStack()
  if m.releaseCard <> invalid then m.releaseCard.visible = false
  if m.updateCard <> invalid then m.updateCard.visible = false
  m.bootLabel.visible = false
  screen = visibleScreen(m.stack)
  top = activeEntry(m.stack)

  hideScreens()
  if featureName(screen.name)
    ensureFeature(screen.name)
    m.featureNodes[screen.name].visible = true
    if top.kind <> "modal" then m.featureNodes[screen.name].setFocus(true)
  else if screen.name = "home"
    ensureHome()
    m.homeNode.visible = true
    m.homeNode.profileName = m.profileName
    if top.kind <> "modal" then m.homeNode.setFocus(true)
  else if screen.name = "settings"
    ensureSettings()
    m.settingsNode.visible = true
    m.settingsNode.coreUrl = m.coreUrl
    m.settingsNode.health = m.health
    loadExtrasSettings()
    m.settingsNode.themeId = currentThemeId()
    if top.kind <> "modal" then m.settingsNode.setFocus(true)
  else if screen.name = "setup"
    ensureSetup()
    m.setupNode.coreUrl = m.coreUrl
    m.setupNode.visible = true
    if top.kind <> "modal" then m.setupNode.setFocus(true)
  else if screen.name = "account"
    ensureAccount()
    m.accountNode.visible = true
    if top.kind <> "modal" then m.accountNode.setFocus(true)
  else if screen.name = "catalog"
    ensureCatalog()
    applyCatalogCopy(screen.params)
    m.catalogNode.profileName = m.profileName
    m.catalogNode.visible = true
    if top.kind <> "modal" then m.catalogNode.setFocus(true)
  else if screen.name = "live"
    ensureLive()
    m.liveNode.visible = true
    if top.kind <> "modal" then m.liveNode.setFocus(true)
  else if screen.name = "live-picks"
    ensureLivePicks()
    m.livePicksNode.visible = true
    if top.kind <> "modal" then m.livePicksNode.setFocus(true)
  else if screen.name = "profiles"
    ensureProfiles()
    m.profilesNode.visible = true
    if top.kind <> "modal" then m.profilesNode.setFocus(true)
  else if screen.name = "profile"
    ensureProfile()
    m.profileNode.visible = true
    m.profileNode.rd = m.rd
    if top.kind <> "modal" then m.profileNode.setFocus(true)
  else if screen.name = "apps"
    ensureApps()
    m.appsNode.visible = true
    if top.kind <> "modal" then m.appsNode.setFocus(true)
  else if screen.name = "info"
    ensureInfo()
    applyInfo(screen.params)
    m.infoNode.visible = true
    if top.kind <> "modal" then m.infoNode.setFocus(true)
  else if screen.name = "details"
    ensureDetails()
    if screen.params <> invalid and screen.params.DoesExist("item") then m.detailsNode.item = screen.params.item
    m.detailsNode.saved = m.detailsSaved
    m.detailsNode.visible = true
    if top.kind <> "modal" then m.detailsNode.setFocus(true)
  else if screen.name = "library"
    ensureLibrary()
    m.libraryNode.visible = true
    if top.kind <> "modal" then m.libraryNode.setFocus(true)
  else if screen.name = "service"
    ensureService()
    m.serviceNode.appId = aaGet(screen.params, "id", "")
    m.serviceNode.visible = true
    if top.kind <> "modal" then m.serviceNode.setFocus(true)
  else if screen.name = "realdebrid"
    ensureRealDebrid()
    m.rdNode.firstLoad = (aaGet(screen.params, "firstLoad", false) = true)
    m.rdNode.status = m.rd
    m.rdNode.visible = true
    if top.kind <> "modal" then m.rdNode.setFocus(true)
  else if screen.name = "hub"
    ensureHub()
    syncHubNode()
    m.hubNode.visible = true
    if top.kind <> "modal" then m.hubNode.setFocus(true)
  end if

  if top.kind <> "modal" then applyRestoreKey(screen)

  clearOverlays()
  if top.kind = "modal"
    if top.name = "you" then showYouMenu()
    if top.name = "notice" then showNotice(top.params)
    if top.name = "player" then showPlayer(top.params)
    if top.name = "confirm" then showConfirm(top.params)
    if top.name = "codesignin" then showCodePanel()
    if top.name = "search" then showSearch()
    if top.name = "pin" then showPin(top.params)
    if top.name = "loading" then showLoadingOrbit()
  end if
  if currentThemeId() = "light"
    repaintThemeNodes(m.screenHost, tvmPalettePairs(tvmThemePalette("dark"), tvmThemePalette("light")))
  end if
  updateBackHint()
end sub

sub hideScreens()
  for each name in m.featureNodes
    m.featureNodes[name].visible = false
  end for
  if m.homeNode <> invalid then m.homeNode.visible = false
  if m.settingsNode <> invalid then m.settingsNode.visible = false
  if m.setupNode <> invalid then m.setupNode.visible = false
  if m.accountNode <> invalid then m.accountNode.visible = false
  if m.catalogNode <> invalid then m.catalogNode.visible = false
  if m.liveNode <> invalid then m.liveNode.visible = false
  if m.livePicksNode <> invalid then m.livePicksNode.visible = false
  if m.profilesNode <> invalid then m.profilesNode.visible = false
  if m.profileNode <> invalid then m.profileNode.visible = false
  if m.appsNode <> invalid then m.appsNode.visible = false
  if m.infoNode <> invalid then m.infoNode.visible = false
  if m.detailsNode <> invalid then m.detailsNode.visible = false
  if m.libraryNode <> invalid then m.libraryNode.visible = false
  if m.serviceNode <> invalid then m.serviceNode.visible = false
  if m.rdNode <> invalid then m.rdNode.visible = false
  if m.hubNode <> invalid then m.hubNode.visible = false
end sub

sub clearOverlays()
  hadPlayer = playerOverlayOpen()
  while m.overlayHost.getChildCount() > 0
    m.overlayHost.removeChildIndex(0)
  end while
  if hadPlayer then hubPlayerClosed()
end sub

sub ensureHome()
  if m.homeNode <> invalid then return
  node = CreateObject("roSGNode", "HomeScreen")
  node.observeField("action", "onHomeAction")
  m.screenHost.appendChild(node)
  m.homeNode = node
end sub

sub ensureSettings()
  if m.settingsNode <> invalid then return
  node = CreateObject("roSGNode", "SettingsScreen")
  node.observeField("action", "onSettingsAction")
  node.themeId = currentThemeId()
  m.screenHost.appendChild(node)
  m.settingsNode = node
end sub

sub ensureSetup()
  if m.setupNode <> invalid then return
  node = CreateObject("roSGNode", "SetupScreen")
  node.observeField("action", "onSetupAction")
  m.screenHost.appendChild(node)
  m.setupNode = node
end sub

sub ensureAccount()
  if m.accountNode <> invalid then return
  node = CreateObject("roSGNode", "AccountScreen")
  node.observeField("action", "onAccountAction")
  m.screenHost.appendChild(node)
  m.accountNode = node
end sub

sub ensureCatalog()
  if m.catalogNode <> invalid then return
  node = CreateObject("roSGNode", "CatalogScreen")
  node.observeField("action", "onCatalogAction")
  m.screenHost.appendChild(node)
  m.catalogNode = node
end sub

sub ensureLive()
  if m.liveNode <> invalid then return
  node = CreateObject("roSGNode", "LiveScreen")
  node.observeField("action", "onLiveAction")
  m.screenHost.appendChild(node)
  m.liveNode = node
end sub

sub ensureLivePicks()
  if m.livePicksNode <> invalid then return
  node = CreateObject("roSGNode", "LivePicksScreen")
  node.observeField("action", "onLivePicksAction")
  m.screenHost.appendChild(node)
  m.livePicksNode = node
end sub

sub ensureProfiles()
  if m.profilesNode <> invalid then return
  node = CreateObject("roSGNode", "ProfilesScreen")
  node.observeField("action", "onProfilesAction")
  m.screenHost.appendChild(node)
  m.profilesNode = node
end sub

sub ensureProfile()
  if m.profileNode <> invalid then return
  node = CreateObject("roSGNode", "ProfileScreen")
  node.observeField("action", "onProfileAction")
  m.screenHost.appendChild(node)
  m.profileNode = node
end sub

sub ensureApps()
  if m.appsNode <> invalid then return
  node = CreateObject("roSGNode", "AppsScreen")
  node.observeField("action", "onAppsAction")
  m.screenHost.appendChild(node)
  m.appsNode = node
end sub

sub ensureInfo()
  if m.infoNode <> invalid then return
  node = CreateObject("roSGNode", "InfoScreen")
  node.observeField("action", "onInfoAction")
  m.screenHost.appendChild(node)
  m.infoNode = node
end sub

sub ensureDetails()
  if m.detailsNode <> invalid then return
  node = CreateObject("roSGNode", "DetailsPanel")
  node.observeField("action", "onDetailsAction")
  m.screenHost.appendChild(node)
  m.detailsNode = node
end sub

sub ensureLibrary()
  if m.libraryNode <> invalid then return
  node = CreateObject("roSGNode", "LibraryScreen")
  node.observeField("action", "onLibraryAction")
  m.screenHost.appendChild(node)
  m.libraryNode = node
end sub

sub ensureService()
  if m.serviceNode <> invalid then return
  node = CreateObject("roSGNode", "ServiceScreen")
  node.observeField("action", "onServiceAction")
  m.screenHost.appendChild(node)
  m.serviceNode = node
end sub

sub ensureRealDebrid()
  if m.rdNode <> invalid then return
  node = CreateObject("roSGNode", "RealDebridScreen")
  node.observeField("action", "onRdScreenAction")
  m.screenHost.appendChild(node)
  m.rdNode = node
end sub

sub ensureHub()
  if m.hubNode <> invalid then return
  node = CreateObject("roSGNode", "HubScreen")
  node.observeField("action", "onHubAction")
  m.screenHost.appendChild(node)
  m.hubNode = node
end sub

sub syncHubNode()
  m.hubNode.coreUrl = m.coreUrl
  m.hubNode.coreToken = m.coreToken
  m.hubNode.accountToken = m.accountToken
  m.hubNode.profileId = m.profileId
  m.hubNode.accountName = m.profileName
  m.hubNode.deviceCredential = m.deviceCredential
  m.hubNode.installationId = m.hubAgent.installationId
  m.hubNode.fixture = hubFixtureEnabled()
end sub

' Actions from the Hub screen: back, notice, signedOut, revoked.
sub onHubAction()
  action = m.hubNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "back"
    navigate("pop", "", {})
  else if kind = "notice"
    navigate("modal", "notice", { title: aaGet(action, "title", "TVM Hub"), body: aaGet(action, "body", "") })
  else if kind = "signedOut"
    signOutAccount()
  else if kind = "revoked"
    hubForgetThisRoku()
    m.accountToken = ""
    saveAccountToken("")
    body = {}
    body.signedIn = false
    showAccountGate(body)
  end if
end sub

sub applyCatalogCopy(params as Object)
  kind = aaGet(params, "kind", "library")
  m.catalogNode.kind = kind
  if kind = "watchlist"
    m.catalogNode.heading = "Watchlist"
    m.catalogNode.emptyTitle = "Watchlist is empty"
    m.catalogNode.emptyBody = "Save a title from details to keep it here."
  else if kind = "search"
    m.catalogNode.heading = "Search"
    m.catalogNode.emptyTitle = "No titles matched"
    m.catalogNode.emptyBody = "Try a shorter name."
  else if kind = "children"
    m.catalogNode.heading = "Episodes"
    m.catalogNode.emptyTitle = "No episodes yet"
    m.catalogNode.emptyBody = "Core did not return episodes for this series."
  else
    m.catalogNode.heading = "Library"
    m.catalogNode.emptyTitle = "Library is empty"
    m.catalogNode.emptyBody = "Add files on the computer, then open Library again."
  end if
  navId = "library"
  if kind = "search" then navId = "search"
  navId = aaGet(params, "navId", navId)
  m.catalogNode.navId = navId
  heading = aaGet(params, "heading", "")
  if heading <> ""
    m.catalogNode.heading = heading
    m.catalogNode.emptyTitle = "No " + LCase(heading) + " yet"
    m.catalogNode.emptyBody = "Nothing in your library matches this view."
  end if
end sub

sub applyInfo(params as Object)
  m.infoNode.kicker = aaGet(params, "kicker", "Device status")
  m.infoNode.heading = aaGet(params, "heading", "Info")
  m.infoNode.body = aaGet(params, "body", "")
end sub

sub showNotice(params as Object)
  panel = CreateObject("roSGNode", "NoticePanel")
  if params <> invalid
    if params.DoesExist("title") then panel.title = params.title
    if params.DoesExist("body") then panel.body = params.body
  end if
  panel.observeField("action", "onNoticeAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
end sub

sub showPlayer(params as Object)
  panel = CreateObject("roSGNode", "PlayerScreen")
  panel.observeField("action", "onPlayerAction")
  panel.observeField("playState", "onHubPlayerState")
  m.overlayHost.appendChild(panel)
  m.hubAgent.player = panel
  panel.chosenQuality = aaGet(params, "chosenQuality", 0)
  panel.qualities = aaGet(params, "qualities", [])
  panel.resolution = aaGet(params, "resolution", 0)
  panel.geo = aaGet(params, "geo", "")
  panel.streamTitle = aaGet(params, "title", "")
  panel.streamFormat = aaGet(params, "format", "mp4")
  panel.mediaId = aaGet(params, "mediaId", "")
  panel.mediaKind = aaGet(params, "mediaKind", "")
  panel.mediaItem = m.playItem
  panel.nextItem = m.nextPlayItem
  panel.coreUrl = m.coreUrl
  panel.coreToken = m.coreToken
  panel.accountToken = m.accountToken
  panel.profileId = m.profileId
  panel.profileMaxAge = m.profileMaxAge
  panel.deviceCredential = m.deviceCredential
  recapEnd = aaGet(params, "recapEnd", 0)
  if recapEnd <> invalid then panel.recapEnd = recapEnd
  startAt = aaGet(params, "startAt", 0)
  if startAt <> invalid then panel.startAt = startAt
  if params <> invalid
    if params.DoesExist("showNext") then panel.showNext = params.showNext
    if params.DoesExist("nextTitle") then panel.nextTitle = params.nextTitle
    if params.DoesExist("nextMediaId") then panel.nextMediaId = params.nextMediaId
  end if
  panel.message = "Starting..."
  panel.streamHeaders = aaGet(params, "headers", {})
  panel.streamUrl = aaGet(params, "url", "")
  panel.setFocus(true)
end sub

sub showConfirm(params as Object)
  panel = CreateObject("roSGNode", "ConfirmPanel")
  if params <> invalid
    if params.DoesExist("title") then panel.title = params.title
    if params.DoesExist("body") then panel.body = params.body
    if params.DoesExist("confirmLabel") then panel.confirmLabel = params.confirmLabel
    if params.DoesExist("confirmId") then panel.confirmId = params.confirmId
  end if
  panel.observeField("action", "onConfirmAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
end sub

sub onHomeAction()
  action = m.homeNode.action
  if action = invalid then return
  if aaGet(action, "type", "") = "changelog"
    navigate("push", "changelog", {})
    return
  end if
  handleScreenAction(action)
end sub

function handleRibbonKind(action as Object) as Boolean
  kind = aaGet(action, "type", "")
  if kind = "profile"
    navigate("push", "profile", {})
    return true
  end if
  if kind = "inputs"
    navigate("modal", "notice", {
      title: "Inputs"
      body: "This computer outputs over HDMI. Switch the television input to this device to watch TVM."
    })
    return true
  end if
  if kind = "search"
    navigate("modal", "search", {})
    return true
  end if
  if kind = "home"
    navigate("home", "home", {})
    return true
  end if
  if kind = "live"
    navigate("push", "live", {})
    return true
  end if
  if kind = "watchlist"
    navigate("push", "catalog", { kind: "watchlist" })
    return true
  end if
  if kind = "stream"
    navigate("push", "profiles", { next: "library" })
    return true
  end if
  if kind = "service"
    navigate("push", "service", { id: aaGet(action, "appId", "") })
    return true
  end if
  if kind = "apps"
    navigate("push", "apps", {})
    return true
  end if
  if kind = "settings"
    if m.kidsProfile then return true
    navigate("push", "settings", {})
    return true
  end if
  return false
end function

' NavStrip actions: a tab id, or the profile orb ("you" menu).
function handleNavAction(action as Object) as Boolean
  kind = aaGet(action, "type", "")
  if kind = "you"
    navigate("modal", "you", {})
    return true
  end if
  if kind = "nav"
    openTab(asText(aaGet(action, "id", "")))
    return true
  end if
  return false
end function

' Tabs replace each other instead of stacking: go back to Home, then push.
sub openTab(id as String)
  if id = "search"
    navigate("modal", "search", {})
    return
  end if
  if id = "home"
    if m.stack.entries.Count() > 0 then m.stack.entries[0].focusKey = "hero:0"
    navigate("home", "home", {})
    return
  end if
  if visibleScreen(m.stack).name <> "home" then navigate("home", "home", {})
  if id = "movies" then navigate("push", "catalog", { kind: "library", filter: "movie", navId: "movies", heading: "Movies" })
  if id = "series" then navigate("push", "catalog", { kind: "library", filter: "series", navId: "series", heading: "Series" })
  if id = "live" then navigate("push", "live", {})
  if id = "library" then navigate("push", "library", {})
end sub

sub showYouMenu()
  panel = CreateObject("roSGNode", "YouMenu")
  panel.observeField("action", "onYouAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
end sub

sub onYouAction()
  if m.overlayHost.getChildCount() = 0 then return
  action = m.overlayHost.getChild(0).action
  if action = invalid then return
  id = asText(aaGet(action, "id", ""))
  navigate("pop", "", {})
  if m.kidsProfile and id <> "profiles" then return
  if id = "services" then navigate("push", "services", {})
  if id = "hub"
    navigate("push", "hub", {})
  else if id = "profiles"
    navigate("push", "profiles", {})
  else if id = "settings"
    navigate("push", "settings", {})
  else if id = "account"
    navigate("push", "profile", {})
  else if id = "apps"
    navigate("push", "apps", {})
  else if id = "realdebrid"
    navigate("push", "realdebrid", {})
  else if id = "live-picks"
    navigate("push", "live-picks", {})
  else if id = "live-playlist"
    showLiveKeyboard()
  else if id = "inputs"
    navigate("modal", "notice", { title: "Inputs", body: "This computer outputs over HDMI. Switch the television input to this device to watch TVM." })
  end if
end sub

sub handleScreenAction(action as Object)
  kind = aaGet(action, "type", "")
  if handleNavAction(action) then return
  if handleRibbonKind(action) then return
  if kind = "more" then loadMoreRail(action)
  if kind = "retry" then loadHome()
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
  if kind = "play" then startPlayback(aaGet(action, "item", {}))
end sub

sub onSettingsAction()
  action = m.settingsNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "stats" then navigate("push", "stats", {})
  if kind = "skipSegments" or kind = "autoplayNext" or kind = "subtitleLanguages" then changeExtrasSetting(kind)
  if kind = "home" then navigate("home", "home", {})
  if kind = "cycleTheme"
    delta = aaGet(action, "delta", 1)
    kindType = Type(delta)
    if kindType <> "Integer" and kindType <> "roInt" and kindType <> "roInteger" then delta = 1
    applyAndSaveTheme(nextThemeId(currentThemeId(), delta))
  end if
  if kind = "setTheme" then applyAndSaveTheme(aaGet(action, "themeId", tvmThemeDefault()))
  if kind = "toggleBackground"
    background = "trending"
    if m.global.background = "trending" then background = "lighthouse"
    saveBackground(background)
    m.global.background = background
  end if
  if kind = "editUrl" then showUrlKeyboard()
  if kind = "editToken" then showTokenKeyboard()
  ' The account screen offers Sign out only while it is showing, which it
  ' stops doing once the account is usable. Without this row a Roku that had
  ' reached Home had no way back out to hand the television to someone else.
  if kind = "signOut"
    navigate("modal", "confirm", {
      title: "Sign out of TVM?"
      body: "This television will need an account email address and password again before it shows anything. Its connection to your computer is kept."
      confirmLabel: "Sign out"
      confirmId: "sign-out"
    })
  end if
  if kind = "computerSettings"
    navigate("modal", "notice", { title: "Manage on your computer", body: "Open TVM on the computer for billing, updates, diagnostics, clearing caches and deleting data. These controls are restricted to that computer." })
  end if
  if kind = "channelInfo" then showChannelInfo()
  if kind = "realdebrid" then navigate("push", "realdebrid", {})
  if kind = "livePlaylist" then showLiveKeyboard()
  if kind = "profiles" then navigate("push", "profiles", {})
  if kind = "updates" then loadUpdates()
  if kind = "services" then navigate("push", "services", {})
  if kind = "changelog" then navigate("push", "changelog", {})
  if kind = "toggleMotion"
    enabled = not tvmReduceMotion()
    saveReduceMotion(enabled)
    m.global.reduceMotion = enabled
  end if
  if kind = "toggleTransparency"
    enabled = not tvmReduceTransparency()
    saveReduceTransparency(enabled)
    m.global.reduceTransparency = enabled
  end if
  if kind = "toggleHubDemo"
    enabled = not loadFlag("hubFixture")
    saveFlag("hubFixture", enabled)
    m.global.hubFixture = enabled
    m.hubAgent.fixture = enabled
    startHubAgent()
  end if
  if kind = "network" then showNetworkInfo()
  if kind = "display" then showDisplayInfo()
  if kind = "diagnostics" then showDiagnostics()
  if kind = "cache"
    navigate("modal", "confirm", {
      title: "Clear cache?"
      body: "Artwork and catalog caches are deleted. Your Real-Debrid token, profiles and watch history stay."
      confirmLabel: "Clear cache"
      confirmId: "clear-cache"
    })
  end if
  if kind = "reset"
    navigate("modal", "confirm", {
      title: "Fully reset TVM?"
      body: "Profiles, watch history, My List, Live TV playlist, caches and the Real-Debrid token are removed. You will need to paste the token again."
      confirmLabel: "Fully reset"
      confirmId: "factory-reset"
    })
  end if
  if kind = "restart"
    navigate("home", "home", {})
    loadHome()
  end if
end sub

sub onSetupAction()
  action = m.setupNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "editUrl" then showUrlKeyboard()
  if kind = "editToken" then showTokenKeyboard()
end sub

sub onAccountAction()
  action = m.accountNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "editEmail" then showKeyboard("accountEmail", "Email", m.accountEmail, "Next")
  if kind = "editPassword" then showKeyboard("accountPassword", "Password", "", "Next")
  if kind = "editName" then showKeyboard("accountName", "Your name", m.accountName, "Next")
  if kind = "codeSignIn" then startCodeSignIn()
  if kind = "switchMode"
    if m.accountMode = "register" then m.accountMode = "signin" else m.accountMode = "register"
    paintAccountGate(m.accountState)
  end if
  if kind = "submit" then submitAccount()
  if kind = "recheck" then loadAccount(true)
  if kind = "signout" then signOutAccount()
  if kind = "agree" then agreeAccountTerms()
  if kind = "editEmailCode" then showKeyboard("emailCode", "Six-digit code", "", "Check")
  if kind = "resendCode" then resendEmailCode()
end sub

sub onCatalogAction()
  action = m.catalogNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if handleNavAction(action) then return
  if handleRibbonKind(action) then return
  if kind = "home" then navigate("home", "home", {})
  if kind = "more" then loadMoreRail(action)
  if kind = "retry" then loadCatalog(visibleScreen(m.stack).params)
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
end sub

sub onLiveAction()
  action = m.liveNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if handleNavAction(action) then return
  if handleRibbonKind(action) then return
  if kind = "home" then navigate("home", "home", {})
  if kind = "retry" then loadLive()
  if kind = "playlist" then showLiveKeyboard()
  if kind = "picks" then navigate("push", "live-picks", {})
  if kind = "play" then startPlayback(aaGet(action, "item", {}))
end sub

sub onProfilesAction()
  action = m.profilesNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "create" then openProfileEditor({ name: "New profile", kind: "standard", maxAge: 18, hue: 220 }, "")
  if kind = "switch" then chooseProfile("switch", asText(aaGet(action, "id", "")))
  if kind = "edit" then chooseProfile("edit", asText(aaGet(action, "id", "")))
  if kind = "remove"
    navigate("modal", "confirm", {
      title: "Remove this profile?"
      body: "Watch history for this profile is deleted on the computer."
      confirmLabel: "Remove"
      confirmId: "remove-profile:" + aaGet(action, "id", "")
    })
  end if
end sub

sub onProfileAction()
  action = m.profileNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "back" then navigate("pop", "", {})
  if kind = "realdebrid" then navigate("push", "realdebrid", {})
end sub

sub onAppsAction()
  action = m.appsNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if handleRibbonKind(action) then return
  if kind = "home" then navigate("home", "home", {})
  if kind = "openApp"
    appId = asText(aaGet(action, "id", ""))
    if appId = "" then appId = asText(aaGet(action, "appId", ""))
    name = asText(aaGet(action, "name", "App"))
    openServiceHub(appId, name)
  end if
end sub

sub onInfoAction()
  action = m.infoNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "back" then navigate("pop", "", {})
end sub

sub onDetailsAction()
  action = m.detailsNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  item = aaGet(action, "item", {})
  if not isMediaItem(item) and m.detailsNode <> invalid then item = m.detailsNode.item
  if kind = "close" then navigate("pop", "", {})
  if kind = "play" then startPlayback(item)
  if kind = "review-preview" then loadReviewPreview(item)
  if kind = "reviews" then navigate("push", "reviews", { item: item })
  if kind = "watch-on" then navigate("push", "services", { title: asText(aaGet(item, "title", "")) })
  if kind = "save" then toggleWatchlist(item)
  if kind = "collection-details" then navigate("push", "details", { item: item })
  if kind = "notice"
    navigate("modal", "notice", {
      title: aaGet(action, "title", "TVM")
      body: aaGet(action, "body", "")
    })
  end if
end sub

sub onNoticeAction()
  navigate("pop", "", {})
end sub

sub onPlayerAction()
  if m.overlayHost.getChildCount() = 0 then return
  action = m.overlayHost.getChild(0).action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "quality"
    m.selectedQuality = aaGet(action, "quality", 0)
    m.qualityResume = aaGet(action, "position", 0)
    navigate("pop", "", {})
    postPlayback(m.playItem)
    return
  end if
  if kind = "next-channel" then playNextChannel() : return
  if kind = "progress"
    postProgress(action)
    return
  end if
  if kind = "skipRecap" then return
  if kind = "openHub"
    navigate("pop", "", {})
    navigate("push", "hub", {})
    return
  end if
  if kind = "next"
    if isMediaItem(aaGet(action, "item", invalid)) then m.nextPlayItem = action.item
    playNextFromPlayer()
    return
  end if
  navigate("pop", "", {})
end sub

sub playNextFromPlayer()
  item = m.nextPlayItem
  if not isMediaItem(item) then return
  navigate("pop", "", {})
  postPlayback(item)
end sub

sub onConfirmAction()
  if m.overlayHost.getChildCount() = 0 then return
  action = m.overlayHost.getChild(0).action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind <> "confirm"
    navigate("pop", "", {})
    return
  end if
  confirmId = aaGet(action, "confirmId", "")
  navigate("pop", "", {})
  if Left(confirmId, 18) = "service-connected:" then markService(Mid(confirmId, 19), true)
  if confirmId = "editor-delete"
    body = { id: m.editorProfile.id, pin: m.editorCurrentPin }
    m.editorTask = startApiRequest(joinCorePath(m.coreUrl, "/api/profiles/remove"), "POST", FormatJson(body), "onProfileEditorSaved")
  end if
  if confirmId = "clear-stats" then clearYourStats()
  if confirmId = "sign-out"
    signOutAccount()
  else if confirmId = "clear-cache"
    m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/maintenance/clear-cache"), "POST", "{}", "onCacheDone")
  else if confirmId = "factory-reset"
    m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/maintenance/factory-reset"), "POST", "{}", "onResetDone")
  else if Left(confirmId, 15) = "remove-profile:"
    body = {}
    body.id = Mid(confirmId, 16)
    m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/profiles/remove"), "POST", FormatJson(body), "onRemoveProfileDone")
  end if
end sub

sub showUrlKeyboard()
  text = m.coreUrl
  if text = "" then text = "http://"
  showKeyboard("coreUrl", "Core API URL", text, "Connect")
end sub

sub showTokenKeyboard()
  showKeyboard("coreToken", "TVM device access token", "", "Connect")
end sub

sub showSearchKeyboard()
  navigate("modal", "search", {})
end sub

sub showRdKeyboard()
  showKeyboard("rdToken", "Real-Debrid token", "", "Save")
end sub

sub showLiveKeyboard()
  showKeyboard("liveUrl", "Live playlist URL", "https://", "Save")
end sub

sub showProfileKeyboard()
  showKeyboard("profileName", "Profile name", "", "Add")
end sub

sub showKeyboard(mode as String, title as String, text as String, confirmLabel as String)
  m.keyboardMode = mode
  dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
  dialog.title = title
  dialog.text = text
  dialog.buttons = [confirmLabel, "Cancel"]
  if mode = "coreToken" or mode = "rdToken" or mode = "accountPassword"
    dialog.keyboardDomain = "password"
    dialog.textEditBox.secureMode = true
  end if
  if mode = "accountEmail"
    dialog.keyboardDomain = "email"
  end if
  dialog.observeField("buttonSelected", "onKeyboardButton")
  m.top.dialog = dialog
  if mode = "search" then dialog.observeField("text", "onSearchDialogTyping")
end sub

sub onKeyboardButton()
  dialog = m.top.dialog
  if dialog = invalid then return
  index = dialog.buttonSelected
  text = dialog.text
  mode = m.keyboardMode
  m.top.dialog = invalid
  if index <> 0
    if mode = "search" and searchPanelOpen()
      focusSearchPanel()
    else
      restoreScreenFocus()
    end if
    return
  end if

  if mode = "subtitleLanguages"
    saveExtrasLanguages(text)
    restoreScreenFocus()
    return
  end if
  if mode = "editorName"
    if text.Trim() <> "" then m.editorProfile.name = Left(text.Trim(), 24)
    paintProfileEditor()
  end if
  if mode = "coreUrl"
    applyCoreUrl(text)
    return
  end if
  if mode = "coreToken"
    token = text.Trim()
    if not isCoreToken(token)
      restoreScreenFocus()
      navigate("modal", "notice", { title: "Check the access token", body: "Use the full TVM_LAN_TOKEN created on your computer (32 to 512 characters). Settings lets you try again." })
      return
    end if
    if not saveCoreToken(token)
      navigate("modal", "notice", { title: "Could not save token", body: "The Roku could not save its settings. Restart the channel and try again." })
      return
    end if
    m.coreToken = token
    loadHealth(true)
    return
  end if
  if mode = "search"
    applySearchDialogText(text)
    return
  end if
  if mode = "rdToken"
    saveRdToken(text.Trim())
    return
  end if
  if mode = "liveUrl"
    saveLiveUrl(text.Trim())
    return
  end if
  if mode = "liveSearch"
    m.livePicksQuery = text.Trim()
    m.livePicksOffset = 0
    loadLivePicks()
    return
  end if
  if mode = "profileName"
    createProfile(text.Trim())
    return
  end if
  if mode = "accountEmail"
    m.accountEmail = text.Trim()
    if m.accountNode <> invalid then m.accountNode.emailDetail = m.accountEmail
    restoreScreenFocus()
    return
  end if
  if mode = "accountPassword"
    m.accountPassword = text
    restoreScreenFocus()
    return
  end if
  if mode = "accountName"
    m.accountName = text.Trim()
    restoreScreenFocus()
    return
  end if
  if mode = "emailCode"
    submitEmailCode(text)
    return
  end if
  restoreScreenFocus()
end sub

sub applyCoreUrl(text as String)
  url = normalizeCoreUrl(text)
  if url = "" or LCase(url) = "standalone"
    saveCoreBaseUrl("")
    saveCoreToken("")
    saveAccountToken("")
    m.coreUrl = ""
    m.coreToken = ""
    m.accountToken = ""
    if m.settingsNode <> invalid then m.settingsNode.coreUrl = ""
    loadAccount(true)
    return
  end if
  if not isValidCoreUrl(url)
    restoreScreenFocus()
    navigate("modal", "notice", {
      title: "That URL will not work"
      body: "Use http:// followed by your computer's LAN IP and Core port, or leave blank for Standalone mode."
    })
    return
  end if

  if not saveCoreBaseUrl(url)
    navigate("modal", "notice", { title: "Could not save address", body: "Restart the channel and try again." })
    return
  end if
  if LCase(url) <> LCase(m.coreUrl)
    m.coreToken = ""
    saveCoreToken("")
    m.accountToken = ""
    saveAccountToken("")
  end if
  m.coreUrl = url
  if m.setupNode <> invalid
    m.setupNode.coreUrl = url
    m.setupNode.message = "Connecting..."
  end if
  if m.settingsNode <> invalid then m.settingsNode.coreUrl = url
  if not isCoreToken(m.coreToken)
    showTokenKeyboard()
  else
    loadHealth(true)
  end if
end sub

sub restoreScreenFocus()
  if m.stack = invalid then return
  top = activeEntry(m.stack)
  screen = visibleScreen(m.stack)
  if top.kind = "modal" then return
  node = screenNode(screen.name)
  if node <> invalid then node.setFocus(true)
end sub

sub loadHealth(thenHome as Boolean)
  m.healthWaitHome = thenHome
  ' Health is public; profiles verifies both connectivity AND authentication.
  m.healthTask = startApiGet(joinCorePath(m.coreUrl, "/api/profiles"), "onHealthDone")
end sub

sub onHealthDone()
  task = m.healthTask
  if task = invalid then return

  health = {}
  health.ok = task.ok
  if task.ok
    json = task.json
    health.version = aaGet(json, "version", "")
    health.status = aaGet(json, "status", "")
  else
    health.version = ""
    health.status = task.error
  end if
  m.health = health
  if m.settingsNode <> invalid then m.settingsNode.health = health

  if m.healthWaitHome = true
    m.healthWaitHome = false
    if task.ok
      loadAccount(true)
    else
      if task.error = "lan_authentication_required"
        m.coreToken = ""
        saveCoreToken("")
      end if
      if m.setupNode <> invalid
        m.setupNode.message = "Could not connect. Check the LAN address, access token, Windows firewall and that Core is running with LAN access enabled."
      end if
      restoreScreenFocus()
      if visibleScreen(m.stack).name = "home" then showHomeError()
    end if
  else
    restoreScreenFocus()
  end if
end sub

sub loadAccount(thenHome as Boolean)
  m.accountWaitHome = thenHome
  if m.coreUrl <> "" and not isValidCoreUrl(m.coreUrl)
    body = {}
    body.signedIn = false
    showAccountGate(body)
    return
  end if
  m.accountTask = startApiGet(joinCorePath(m.coreUrl, "/api/account"), "onAccountDone")
end sub

sub onAccountDone()
  task = m.accountTask
  if task = invalid then return
  json = task.json
  if json = invalid then json = {}
  if task.ok
    if aaGet(json, "signedIn", false) <> true
      m.accountToken = ""
      saveAccountToken("")
    end if
    usable = aaGet(json, "usable", {})
    if aaGet(usable, "ok", false) = true and m.accountWaitHome = true
      m.accountState = json
      enterHome()
      return
    end if
    showAccountGate(json)
    return
  end if
  body = {}
  body.signedIn = isAccountToken(m.accountToken)
  body.usable = { ok: false, reason: "unreachable" }
  body.error = task.error
  showAccountGate(body)
end sub

sub enterHome()
  m.stack = createViewStack("home")
  renderStack()
  startHubAgent()
  loadHealth(false)
  loadHome()
  loadProfiles(false)
  account = aaGet(m.accountState, "account", {})
  if aaGet(account, "rdKey", false) <> true and m.rdPromptedOnce <> true
    m.rdBootCheck = true
    loadRdStatus()
  end if
end sub

sub showAccountGate(json as Object)
  if json = invalid then json = {}
  m.accountState = json
  ensureAccount()
  paintAccountGate(json)
  m.stack = createViewStack("account")
  renderStack()
end sub

sub paintAccountGate(json as Object)
  if m.accountNode = invalid then return
  if json = invalid then json = {}
  signedIn = aaGet(json, "signedIn", false)
  usable = aaGet(json, "usable", {})
  reason = asText(aaGet(usable, "reason", "no_account"))
  account = aaGet(json, "account", {})
  email = asText(aaGet(account, "email", m.accountEmail))
  m.accountNode.signedAs = email
  m.accountNode.emailDetail = m.accountEmail
  err = asText(aaGet(json, "error", ""))
  if signedIn = true and reason = "unreachable"
    m.accountNode.phase = "waiting"
    m.accountNode.heading = "Accounts unavailable"
    m.accountNode.lede = "Your sign-in is saved. Check your connection and choose Check again."
  else if signedIn = true and reason = "awaiting_activation"
    m.accountNode.phase = "waiting"
    m.accountNode.heading = "Almost there"
    m.accountNode.lede = "Your account is signed in and waiting for activation."
  else if signedIn = true and reason = "email_unverified"
    m.accountNode.phase = "verify"
    m.accountNode.heading = "Check your email"
    m.accountNode.lede = "Enter the six-digit code sent to " + email + "."
  else if signedIn = true and reason = "suspended"
    m.accountNode.phase = "suspended"
    m.accountNode.heading = "Account paused"
    m.accountNode.lede = "This account is currently unavailable."
  else if signedIn = true and reason = "terms_required"
    m.accountNode.phase = "terms"
    m.accountNode.heading = "Before you start"
    m.accountNode.lede = "Review and accept the current terms to continue."
  else if m.accountMode = "register"
    m.accountNode.phase = "register"
    m.accountNode.heading = "Create an account"
    m.accountNode.lede = "Enter your details below to get started on this television."
  else
    m.accountNode.phase = "signin"
    m.accountNode.heading = "Welcome to TVM"
    m.accountNode.lede = "Sign in with a code on your phone, or enter your account below."
  end if
  m.accountNode.status = err
end sub

sub submitAccount()
  email = m.accountEmail.Trim()
  password = m.accountPassword
  if email = "" or password = ""
    if m.accountNode <> invalid then m.accountNode.status = "Enter your email and password."
    restoreScreenFocus()
    return
  end if
  body = {}
  body.email = email
  body.password = password
  if m.accountMode = "register"
    body.displayName = m.accountName
    m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/register"), "POST", FormatJson(body), "onAccountRegisterDone")
    return
  end if
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/signin"), "POST", FormatJson(body), "onAccountSignInDone")
end sub

sub onAccountRegisterDone()
  task = m.accountTask
  if task = invalid then return
  if not task.ok
    err = asText(aaGet(task.json, "error", "That account could not be created."))
    if m.accountNode <> invalid then m.accountNode.status = err
    restoreScreenFocus()
    return
  end if
  body = {}
  body.email = m.accountEmail.Trim()
  body.password = m.accountPassword
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/signin"), "POST", FormatJson(body), "onAccountSignInDone")
end sub

sub onAccountSignInDone()
  task = m.accountTask
  if task = invalid then return
  if not task.ok
    err = asText(aaGet(task.json, "error", "Sign in failed."))
    if m.accountNode <> invalid then m.accountNode.status = err
    restoreScreenFocus()
    return
  end if
  json = task.json
  token = asText(aaGet(json, "token", ""))
  if not isAccountToken(token)
    if m.accountNode <> invalid then m.accountNode.status = "Sign in did not return a session."
    restoreScreenFocus()
    return
  end if
  if not saveAccountToken(token)
    navigate("modal", "notice", { title: "Could not save sign-in", body: "The Roku could not save its settings. Restart the channel and try again." })
    return
  end if
  m.accountToken = token
  m.accountPassword = ""
  ' The sign-in body is token, account and usable. It has no signedIn flag.
  ' Painting that as the gate made a successful sign-in look like the form
  ' again whenever a step was still left: the email code, activation or terms.
  loadAccount(true)
end sub

sub signOutAccount()
  hubSignOutQuiet()
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/signout"), "POST", "{}", "onAccountSignOutDone")
end sub

sub onAccountSignOutDone()
  m.accountToken = ""
  saveAccountToken("")
  m.accountEmail = ""
  m.accountPassword = ""
  m.accountName = ""
  m.accountMode = "signin"
  body = {}
  body.signedIn = false
  showAccountGate(body)
end sub

' A Roku cannot replace a sideloaded channel by itself, so say plainly what
' to do about it instead of pretending there is a button for it.
sub showChannelInfo()
  info = CreateObject("roAppInfo")
  build = info.GetValue("tvm_commit")
  line = "Channel version " + info.GetVersion()
  if build <> invalid and build <> "" then line = line + ", build " + build + "."
  mode = "Running standalone on this Roku (no PC server required)."
  if m.coreUrl <> "" then mode = "Connected to Core at " + m.coreUrl + "."
  navigate("modal", "notice", {
    title: "This channel"
    body: line + " " + mode + " To update the channel, download TVM-roku.zip from GitHub Releases and upload it at http://" + rokuAddress() + "."
  })
end sub

function rokuAddress() as String
  device = CreateObject("roDeviceInfo")
  address = device.GetIPAddrs()
  for each name in address
    value = address[name]
    if value <> invalid and value <> "" then return value
  end for
  return "your Roku's address"
end function

sub agreeAccountTerms()
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/terms"), "POST", "{}", "onAccountTermsDone")
end sub

sub onAccountTermsDone()
  loadAccount(true)
end sub

' The six digits from the sign-up email. Before this a Roku could only wait
' for somebody to type them on another device.
sub submitEmailCode(text as String)
  code = text.Trim()
  if code = ""
    restoreScreenFocus()
    return
  end if
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/email/verify"), "POST", FormatJson({ code: code }), "onEmailCodeDone")
end sub

sub onEmailCodeDone()
  restoreScreenFocus()
  task = m.accountTask
  if task = invalid then return
  if not task.ok
    err = asText(aaGet(task.json, "error", "That code was not accepted."))
    if m.accountNode <> invalid then m.accountNode.status = err
    return
  end if
  loadAccount(true)
end sub

sub resendEmailCode()
  m.accountTask = startApiRequest(joinCorePath(m.coreUrl, "/api/account/email/send"), "POST", "{}", "onResendEmailCodeDone")
end sub

sub onResendEmailCodeDone()
  task = m.accountTask
  if task = invalid or m.accountNode = invalid then return
  if not task.ok
    m.accountNode.status = asText(aaGet(task.json, "error", "That code could not be sent. Try again in a minute."))
    return
  end if
  m.accountNode.status = "A new code is on its way."
end sub

sub loadHome()
  ensureHome()
  if m.homeSilent <> true then m.homeNode.mode = "loading"
  if m.coreUrl <> "" and not isValidCoreUrl(m.coreUrl)
    showHomeError()
    return
  end if
  m.homeTask = startApiGet(joinCorePath(m.coreUrl, "/api/home"), "onHomeDone")
end sub

sub onHomePoll()
  if m.coreUrl <> "" and not isValidCoreUrl(m.coreUrl) then return
  if m.stack = invalid then return
  if visibleScreen(m.stack).name <> "home" then return
  if m.homeNode = invalid then return
  if m.homeNode.mode <> "ready" then return
  m.homeSilent = true
  loadHome()
end sub

sub onHomeDone(event as Object)
  task = event.GetRoSGNode()
  if task <> m.homeTask then return
  if not task.ok
    silent = m.homeSilent
    m.homeSilent = false
    if silent = true then return
    if task.error = "lan_authentication_required"
      m.coreToken = ""
      saveCoreToken("")
      navigate("reset", "setup", {})
      if m.setupNode <> invalid then m.setupNode.message = "Access token was rejected. Enter the Core address, then update the token to match your computer."
      return
    end if
    showHomeError()
    return
  end if

  payload = task.json
  m.homeSilent = false
  m.homeNode.payload = payload
  loadHomeExtras(payload)
  if m.eventProfile <> m.profileId
    m.homeNode.event = {}
    loadEvents()
  else if m.eventsTask = invalid or m.eventDate <> sceneLocalDate()
    loadEvents()
  end if
  if m.libraryNode <> invalid
    m.libraryNode.payload = payload
    m.libraryNode.mode = "ready"
  end if
  if homeIsEmpty(payload)
    m.homeNode.mode = "empty"
  else
    m.homeNode.mode = "ready"
  end if
  maybeShowReleaseCards()
  if visibleScreen(m.stack).name = "home" and activeEntry(m.stack).kind <> "modal"
    m.homeNode.setFocus(true)
  end if
end sub

sub showHomeError()
  ensureHome()
  m.homeNode.errorTitle = "Home could not load"
  m.homeNode.errorBody = "TVM could not reach the local core. Check that the app is running, then retry."
  m.homeNode.mode = "error"
  m.homeNode.setFocus(true)
end sub

sub loadCatalog(params as Object)
  ensureCatalog()
  applyCatalogCopy(params)
  m.catalogNode.mode = "loading"
  m.catalogNode.items = []
  kind = aaGet(params, "kind", "library")
  m.catalogKind = kind
  m.catalogQuery = aaGet(params, "query", "")
  m.catalogFilter = aaGet(params, "filter", "")
  path = "/api/library"
  m.catalogNode.railId = ""
  m.catalogNode.more = false
  if m.catalogFilter = "movie" or m.catalogFilter = "series"
    railId = "films"
    if m.catalogFilter = "series" then railId = "series"
    m.catalogNode.railId = railId
    path = "/api/rails/more?id=" + railId + "&skip=0"
  end if
  if kind = "watchlist" then path = "/api/watchlist"
  if kind = "search" then path = "/api/search?q=" + encodeQuery(m.catalogQuery)
  if kind = "children" then path = "/api/media/children?id=" + encodeQuery(aaGet(params, "id", ""))
  m.catalogTask = startApiGet(joinCorePath(m.coreUrl, path), "onCatalogDone")
end sub

sub onCatalogDone()
  task = m.catalogTask
  if task = invalid then return
  if not task.ok
    m.catalogNode.errorTitle = "Could not load this list"
    m.catalogNode.errorBody = "Core did not return titles. Check the connection in Settings, then retry."
    m.catalogNode.mode = "error"
    restoreScreenFocus()
    return
  end if
  items = itemsFromJson(task.json)
  if m.catalogFilter <> "" then items = filterItemsByKind(items, m.catalogFilter)
  m.catalogNode.more = aaGet(task.json, "more", false)
  m.catalogNode.nextSkip = aaGet(task.json, "nextSkip", items.Count())
  m.catalogNode.items = items
  if items.Count() = 0
    m.catalogNode.mode = "empty"
  else
    m.catalogNode.mode = "ready"
  end if
  restoreScreenFocus()
end sub

sub loadLive()
  ensureLive()
  m.liveNode.mode = "loading"
  m.liveRemoteData = {} : m.liveFreeData = [] : m.liveFailed = false
  m.freeLiveTask = startApiRequest("local:/api/roku/free-fallback", "POST", FormatJson({ maxAge: m.profileMaxAge }), "onFreeLiveDone")
  m.liveTask = startApiGet(joinCorePath(m.coreUrl, "/api/live"), "onLiveDone")
end sub

sub onLiveDone(event as Object)
  task = event.GetRoSGNode()
  if task <> m.liveTask or task.profileId <> m.profileId then return
  m.liveFailed = not task.ok
  if task.ok then m.liveRemoteData = task.json
  paintLiveChannels()
end sub

sub onFreeLiveDone(event as Object)
  task = event.GetRoSGNode()
  if task <> m.freeLiveTask or task.profileId <> m.profileId then return
  if task.ok then m.liveFreeData = aaArray(task.json, "channels")
  paintLiveChannels()
end sub

sub paintLiveChannels()
  channels = [] : seen = {}
  ' Prefer the Core's current list; bundled channels cover a failed Core.
  remote = aaArray(m.liveRemoteData, "channels")
  for each source in [remote, m.liveFreeData]
    for each channel in source
      id = asText(aaGet(channel, "id", ""))
      if not seen.DoesExist(id) then channels.Push(channel) : seen[id] = true
    end for
  end for
  data = {}
  for each key in m.liveRemoteData
    data[key] = m.liveRemoteData[key]
  end for
  data.channels = channels
  m.liveNode.status = data
  m.liveNode.mode = "ready"
  if m.liveFailed then m.liveNode.mode = "error"
end sub

sub loadLivePicks()
  ensureLivePicks()
  m.livePicksNode.mode = "loading"
  url = joinCorePath(m.coreUrl, "/api/live/catalog") + "?limit=8"
  if m.livePicksQuery <> "" then url = url + "&q=" + encodeQuery(m.livePicksQuery)
  if m.livePicksGroup <> "" then url = url + "&group=" + encodeQuery(m.livePicksGroup)
  if m.livePicksOffset > 0 then url = url + "&offset=" + StrI(m.livePicksOffset).Trim()
  m.livePicksTask = startApiGet(url, "onLivePicksDone")
end sub

sub onLivePicksDone()
  task = m.livePicksTask
  if task = invalid then return
  if not task.ok
    m.livePicksNode.mode = "ready"
    restoreScreenFocus()
    navigate("modal", "notice", { title: "Channels unavailable", body: "Core did not return the playlist. Check the connection, then retry." })
    return
  end if
  m.livePicksNode.page = task.json
  m.livePicksNode.mode = "ready"
  restoreScreenFocus()
end sub

sub onLivePicksAction()
  action = m.livePicksNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "done"
    navigate("pop", "", {})
    loadLive()
  end if
  if kind = "search" then showKeyboard("liveSearch", "Search channels", m.livePicksQuery, "Search")
  if kind = "group"
    m.livePicksGroup = aaGet(action, "group", "")
    m.livePicksOffset = 0
    loadLivePicks()
  end if
  if kind = "toggle" then saveLivePick(aaGet(action, "id", ""), aaGet(action, "picked", false))
  if kind = "addGroup"
    group = aaGet(action, "group", "")
    if group = ""
      navigate("modal", "notice", { title: "Pick a group", body: "Highlight a group such as Sports, then add it." })
    else
      saveLiveGroup(group, true)
    end if
  end if
  if kind = "page"
    delta = aaGet(action, "delta", 0)
    pageSize = 8
    if Type(delta) <> "Integer" and Type(delta) <> "roInt" and Type(delta) <> "roInteger" then delta = 0
    nextOffset = m.livePicksOffset + (delta * pageSize)
    if nextOffset < 0 then nextOffset = 0
    m.livePicksOffset = nextOffset
    loadLivePicks()
  end if
end sub

sub saveLivePick(id as String, picked as Dynamic)
  if id = "" then return
  body = {}
  body.id = id
  body.picked = (picked = true)
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/live/picks"), "POST", FormatJson(body), "onLivePickSaveDone")
end sub

sub saveLiveGroup(group as String, picked as Boolean)
  body = {}
  body.group = group
  body.picked = picked
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/live/picks/group"), "POST", FormatJson(body), "onLivePickSaveDone")
end sub

sub onLivePickSaveDone()
  task = m.mutateTask
  if task = invalid then return
  if not task.ok
    restoreScreenFocus()
    navigate("modal", "notice", { title: "Could not update", body: "Live TV holds 48 channels. Remove one to add another." })
    return
  end if
  loadLivePicks()
end sub

sub loadProfiles(show as Boolean)
  m.profilesShow = show
  if show then ensureProfiles()
  m.profilesTask = startApiGet(joinCorePath(m.coreUrl, "/api/profiles"), "onProfilesDone")
end sub

sub onProfilesDone()
  task = m.profilesTask
  if task = invalid then return
  if not task.ok
    if m.profilesShow = true
      navigate("modal", "notice", {
        title: "Profiles unavailable"
        body: "Core did not return profiles. Check the Core URL and retry."
      })
    end if
    return
  end if
  json = task.json
  m.profilesRegistry = json
  m.profileId = asText(aaGet(json, "activeId", ""))
  if m.profilesNode <> invalid then m.profilesNode.registry = json
  profiles = aaArray(json, "profiles")
  i = 0
  while i < profiles.Count()
    if asText(aaGet(profiles[i], "id", "")) = m.profileId
      m.profileName = asText(aaGet(profiles[i], "name", ""))
      m.kidsProfile = (aaGet(profiles[i], "kind", "standard") = "kids")
      m.profileMaxAge = aaGet(profiles[i], "maxAge", 18)
      m.global.kidsProfile = m.kidsProfile
      if m.libraryNode <> invalid then m.libraryNode.profile = profiles[i]
    end if
    i = i + 1
  end while
  if m.homeNode <> invalid then m.homeNode.profileName = m.profileName
  if m.catalogNode <> invalid then m.catalogNode.profileName = m.profileName
  if m.profilesShow = true then restoreScreenFocus()
end sub

sub switchProfile(id as String)
  if id = "" then return
  body = {}
  body.id = id
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/profiles/active"), "POST", FormatJson(body), "onSwitchProfileDone")
end sub

sub onSwitchProfileDone()
  task = m.mutateTask
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Could not switch", body: "Core rejected that profile." })
    return
  end if
  m.profileId = asText(aaGet(task.json, "activeId", ""))
  if m.profilesNode <> invalid then m.profilesNode.registry = task.json
  for each profile in aaArray(task.json, "profiles")
    if asText(aaGet(profile, "id", "")) = m.profileId
      m.kidsProfile = aaGet(profile, "kind", "standard") = "kids"
      m.profileMaxAge = aaGet(profile, "maxAge", 18)
      m.global.kidsProfile = m.kidsProfile
    end if
  end for
  loadProfiles(false)
  if m.homeNode <> invalid
    m.homeNode.event = {}
    m.homeNode.payload = {}
  end if
  loadHome()
  nextName = m.profilesNext
  m.profilesNext = ""
  if nextName = "library"
    navigate("home", "home", {})
    navigate("push", "library", {})
  else
    navigate("pop", "", {})
  end if
end sub

sub createProfile(name as String)
  if name = ""
    restoreScreenFocus()
    navigate("modal", "notice", { title: "Name required", body: "Type a profile name, then add it." })
    return
  end if
  body = {}
  body.name = name
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/profiles"), "POST", FormatJson(body), "onCreateProfileDone")
end sub

sub onCreateProfileDone()
  task = m.mutateTask
  if task = invalid then return
  if not task.ok
    restoreScreenFocus()
    navigate("modal", "notice", { title: "Profile not added", body: "Core allows up to five profiles." })
    return
  end if
  m.profileId = asText(aaGet(task.json, "activeId", ""))
  if m.profilesNode <> invalid then m.profilesNode.registry = task.json
  restoreScreenFocus()
end sub

sub saveRdToken(token as String)
  body = {}
  body.token = token
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/rd/token"), "PUT", FormatJson(body), "onRdTokenDone")
end sub

sub onRdTokenDone()
  task = m.mutateTask
  restoreScreenFocus()
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Token not stored", body: "Core rejected the token. Check it and try again." })
    return
  end if
  if task.json <> invalid
    m.rd = task.json
    if m.rdNode <> invalid then m.rdNode.status = m.rd
    if m.profileNode <> invalid then m.profileNode.rd = m.rd
  end if
  loadHome()
  if visibleScreen(m.stack).name = "realdebrid" and aaGet(m.rd, "configured", false) = true
    navigate("pop", "", {})
  end if
  where = "on this Roku"
  if m.coreUrl <> "" then where = "on the computer"
  navigate("modal", "notice", { title: "Real-Debrid", body: "The token is stored " + where + ". Home will refresh with that account." })
end sub

sub saveLiveUrl(url as String)
  body = {}
  body.url = url
  m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/live"), "PUT", FormatJson(body), "onLiveSaveDone")
end sub

sub onLiveSaveDone()
  task = m.mutateTask
  restoreScreenFocus()
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Playlist not saved", body: "Use an http or https M3U / M3U8 URL you are allowed to use." })
    return
  end if
  if m.liveNode <> invalid
    m.liveNode.status = task.json
    m.liveNode.mode = "ready"
  end if
  if visibleScreen(m.stack).name <> "live"
    navigate("push", "live", {})
  end if
end sub

sub loadUpdates()
  m.updateTask = startApiGet("local:/api/roku/update", "onUpdatesDone")
end sub

sub onUpdatesDone()
  task = m.updateTask
  restoreScreenFocus()
  if task = invalid or not task.ok
    navigate("modal", "notice", { title: "Updates unavailable", body: "Could not check Roku channel updates. Try again later." })
    return
  end if
  json = task.json
  body = "Installed Roku channel: " + m.installedVersion
  if aaGet(json, "available", false) = true
    body = body + Chr(10) + "Update available: " + asText(aaGet(json, "version", "")) + Chr(10) + releaseHighlights(aaGet(json, "notes", {}), 2)
  else
    if asText(aaGet(json, "version", "")) <> ""
      body = body + Chr(10) + "No newer channel was found in the last update check."
    else
      body = body + Chr(10) + "Could not reach the update feed. Try again later."
    end if
  end if
  body = body + Chr(10) + Chr(10) + "github.com/GL-327/TVM/releases/tag/devices" + Chr(10) + "Install the new TVM-roku.zip from your PC. TVM on your PC can install it for you: Settings > Roku on the Windows app"
  navigate("modal", "notice", { title: "Updates", body: body })
end sub

sub loadRdStatus()
  m.rdTask = startApiGet(joinCorePath(m.coreUrl, "/api/rd/status"), "onRdStatusDone")
end sub

sub onRdStatusDone()
  task = m.rdTask
  if task = invalid or not task.ok
    m.rdBootCheck = false
    return
  end if
  m.rd = task.json
  if m.profileNode <> invalid then m.profileNode.rd = m.rd
  if m.rdNode <> invalid then m.rdNode.status = m.rd
  if m.rdBootCheck = true
    m.rdBootCheck = false
    if aaGet(m.rd, "configured", false) <> true and m.rdPromptedOnce <> true
      m.rdPromptedOnce = true
      navigate("push", "realdebrid", { firstLoad: true })
    end if
  end if
end sub

sub loadDetails(params as Object)
  m.detailsServicesTask = startApiGet(joinCorePath(m.coreUrl, "/api/services"), "onDetailsServices")
  loadDetailsSaved(params)
  item = aaGet(params, "item", {})
  id = asText(aaGet(item, "id", ""))
  ensureDetails()
  m.detailsNode.item = item
  loadDetailsExtras(item)
  if id = "" then return
  m.detailsTask = startApiGet(joinCorePath(m.coreUrl, "/api/media?id=" + encodeQuery(id)), "onDetailsMedia")
  m.detailsChildrenTask = startApiGet(joinCorePath(m.coreUrl, "/api/media/children?id=" + encodeQuery(id)), "onDetailsChildren")
end sub

sub onDetailsMedia()
  task = m.detailsTask
  if task = invalid or not task.ok then return
  if m.detailsNode <> invalid
    if asText(aaGet(m.detailsNode.item, "id", "")) <> asText(aaGet(task.json, "id", "")) then return
    m.detailsNode.item = task.json
    loadDetailsExtras(task.json)
  end if
end sub

sub onDetailsChildren()
  task = m.detailsChildrenTask
  if task = invalid or not task.ok then return
  if m.detailsNode <> invalid then m.detailsNode.children = itemsFromJson(task.json)
end sub

sub loadDetailsSaved(params as Object)
  m.detailsSaved = false
  m.pendingDetailsItem = aaGet(params, "item", {})
  m.watchlistTask = startApiGet(joinCorePath(m.coreUrl, "/api/watchlist"), "onDetailsWatchlist")
end sub

sub onDetailsWatchlist()
  task = m.watchlistTask
  item = m.pendingDetailsItem
  id = asText(aaGet(item, "id", ""))
  saved = false
  if task <> invalid and task.ok
    items = itemsFromJson(task.json)
    i = 0
    while i < items.Count()
      if asText(aaGet(items[i], "id", "")) = id then saved = true
      i = i + 1
    end while
  end if
  m.detailsSaved = saved
  if m.detailsNode <> invalid then m.detailsNode.saved = saved
end sub

sub showNetworkInfo()
  connected = "Offline"
  if m.health <> invalid and m.health.ok = true then connected = "Connected"
  modeLine = "Mode: Standalone (on this Roku)"
  if m.coreUrl <> "" then modeLine = "Core: " + m.coreUrl
  navigate("push", "info", {
    kicker: "Device status"
    heading: "Network"
    body: "Status: " + connected + chr(10) + modeLine + chr(10) + "TVM runs directly on this Roku without a PC server. You can optionally set a Core URL in Settings."
  })
end sub

sub showDisplayInfo()
  metrics = m.uiMetrics
  if metrics = invalid then metrics = tvmUiMetrics()
  display = StrI(metrics.width).Trim() + " × " + StrI(metrics.height).Trim()
  navigate("push", "info", {
    kicker: "Device status"
    heading: "Display"
    body: "Panel UI: " + display + chr(10) + "Design canvas: 3840 × 2160" + chr(10) + "Scale: " + asText(metrics.scale) + chr(10) + "Mode: Fullscreen. HD and FHD boxes scale this 4K layout down so nothing clips."
  })
end sub

sub showDiagnostics()
  version = asText(aaGet(m.health, "version", "unknown"))
  status = "Offline"
  if m.health <> invalid and m.health.ok = true then status = "ok"
  navigate("push", "info", {
    kicker: "Device and services"
    heading: "Diagnostics"
    body: "Core: " + status + " " + version + chr(10) + "URL: " + m.coreUrl + chr(10) + "Channel: TVM on Roku" + chr(10) + "This channel talks to the same Core as the TVM app on the computer."
  })
end sub

sub openServiceHub(id as String, name as String)
  appId = asText(id)
  if appId = "" then return
  if appId = "tvm-stream"
    navigate("push", "profiles", { next: "library" })
    return
  end if
  label = asText(name)
  app = tvmAppById(appId)
  if label = "" or label = "App"
    if app <> invalid then label = app.name
  end if
  navigate("push", "service", { id: appId, name: label })
end sub

sub onCacheDone()
  restoreScreenFocus()
  navigate("modal", "notice", { title: "Cache cleared", body: "Artwork and catalog caches were deleted. Your Real-Debrid token stayed." })
end sub

sub onResetDone()
  m.profileId = ""
  loadHome()
  navigate("home", "home", {})
  navigate("modal", "notice", { title: "TVM reset", body: "Profiles, watch history, My List, Live TV playlist, caches and the Real-Debrid token were removed." })
end sub

sub toggleWatchlist(item as Object)
  if not isMediaItem(item)
    navigate("modal", "notice", { title: "Nothing to save", body: "This card has no title." })
    return
  end if
  if m.detailsSaved = true
    body = {}
    body.id = asText(aaGet(item, "id", ""))
    m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/watchlist/remove"), "POST", FormatJson(body), "onWatchlistDone")
  else
    m.mutateTask = startApiRequest(joinCorePath(m.coreUrl, "/api/watchlist"), "PUT", watchlistBody(item), "onWatchlistDone")
  end if
end sub

sub onWatchlistDone()
  task = m.mutateTask
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Not saved", body: "Core did not add this title to the watchlist." })
    return
  end if
  m.detailsSaved = (m.detailsSaved <> true)
  if m.detailsNode <> invalid then m.detailsNode.saved = m.detailsSaved
  if visibleScreen(m.stack).name = "catalog" and m.catalogKind = "watchlist"
    loadCatalog({ kind: "watchlist" })
  end if
end sub

sub startPlayback(item as Object)
  m.selectedQuality = 0
  m.qualityResume = invalid
  if item = invalid
    navigate("modal", "notice", { title: "Nothing to play", body: "This card has no title." })
    return
  end if
  mediaKind = asText(aaGet(item, "kind", ""))
  id = asText(aaGet(item, "id", ""))
  if mediaKind = "series" and id <> "" and Left(id, 5) <> "live:"
    m.pendingPlayItem = item
    m.childrenTask = startApiGet(joinCorePath(m.coreUrl, "/api/media/children?id=" + encodeQuery(id)), "onChildrenForPlay")
    return
  end if
  postPlayback(item)
end sub

sub onChildrenForPlay()
  task = m.childrenTask
  item = m.pendingPlayItem
  m.pendingPlayItem = invalid
  if task <> invalid and task.ok
    items = itemsFromJson(task.json)
    if items.Count() > 0
      parentId = asText(aaGet(item, "id", ""))
      navigate("push", "catalog", { kind: "children", id: parentId })
      return
    end if
  end if
  postPlayback(item)
end sub

sub postPlayback(item as Object)
  if m.playTask <> invalid
    if not m.playTask.done
      if activeEntry(m.stack).name = "loading" then return
      m.playTask.control = "STOP"
    end if
  end if
  m.playItem = item
  body = ParseJson(playbackBody(item))
  if m.selectedQuality <> invalid then body.quality = m.selectedQuality
  navigate("modal", "loading", {})
  url = joinCorePath(m.coreUrl, "/api/playback")
  if aaGet(item, "source", "") = "free" and m.liveFailed = true
    url = "local:/api/roku/free-playback" : body.maxAge = m.profileMaxAge
  end if
  m.playTask = startApiRequest(url, "POST", FormatJson(body), "onPlayDone")
end sub

sub onPlayDone(event as Object)
  task = event.GetRoSGNode()
  if task <> m.playTask then return
  if activeEntry(m.stack).name <> "loading" then return
  navigate("pop", "", {})
  json = {}
  if task <> invalid then json = task.json
  kind = asText(aaGet(json, "kind", ""))
  hubFinishPlayCommand(kind = "stream")
  if kind = "stream"
    url = absoluteCoreUrl(m.coreUrl, asText(aaGet(json, "url", "")))
    if url = ""
      navigate("modal", "notice", { title: "No stream URL", body: "Core returned a stream with no address." })
      return
    end if
    title = asText(aaGet(json, "title", ""))
    if title = "" then title = asText(aaGet(m.playItem, "title", ""))
    if title = "" then title = asText(aaGet(m.playItem, "name", ""))
    mimeType = asText(aaGet(json, "mimeType", ""))
    if not isHttpUrl(url)
      navigate("modal", "notice", { title: "Unsupported stream address", body: "Core must return an HTTP or HTTPS stream for this Roku." })
      return
    end if
    headers = aaGet(json, "headers", {})
    if m.coreUrl <> "" and coreOwnsUrl(m.coreUrl, url) and isCoreToken(m.coreToken)
      headers["Authorization"] = "Bearer " + m.coreToken
    end if
    startAt = aaGet(json, "startAt", 0)
    if m.qualityResume <> invalid then startAt = m.qualityResume
    mediaId = asText(aaGet(m.playItem, "id", ""))
    mediaKind = asText(aaGet(m.playItem, "kind", ""))
    if playItemIsLive(m.playItem)
      mediaKind = "live"
    else if playItemIsSeries(m.playItem)
      mediaKind = "series"
    end if
    recapEnd = recapEndSeconds(json)
    if recapEnd <= 0 then recapEnd = recapEndSeconds(m.playItem)
    nextItem = aaGet(json, "next", invalid)
    if not isMediaItem(nextItem) then nextItem = aaGet(m.playItem, "next", invalid)
    if not isMediaItem(nextItem) then nextItem = aaGet(m.playItem, "nextEpisode", invalid)
    m.nextPlayItem = nextItem
    nextTitle = ""
    nextMediaId = ""
    showNext = false
    if isMediaItem(nextItem)
      showNext = true
      nextTitle = asText(aaGet(nextItem, "title", ""))
      nextMediaId = asText(aaGet(nextItem, "id", ""))
    end if
    navigate("modal", "player", {
      url: url
      title: title
      format: streamFormatFor(url, mimeType)
      headers: headers
      mediaId: mediaId
      mediaKind: mediaKind
      recapEnd: recapEnd
      startAt: startAt
      showNext: showNext
      nextTitle: nextTitle
      nextMediaId: nextMediaId
      qualities: aaGet(json, "qualities", [])
      resolution: aaGet(json, "resolution", 0)
      geo: aaGet(json, "geo", aaGet(m.playItem, "geo", ""))
      chosenQuality: m.selectedQuality
    })
    return
  end if
  reason = asText(aaGet(json, "reason", ""))
  if task <> invalid and not task.ok and reason = ""
    navigate("modal", "notice", { title: "Could not start playback", body: "Check the Core connection and access token, then try again. If the stream is unavailable, choose another title." })
    return
  end if
  navigate("modal", "notice", { title: "Can't play yet", body: playbackNotice(reason) })
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  if playerOverlayOpen() then focusPlayerOverlay()
  intent = intentFromKey(key)
  if intent = "back"
    if canGoBack(m.stack)
      navigate("pop", "", {})
      return true
    end if
    return true
  end if
  return false
end function

function overlayIs(name as String) as Boolean
  if m.overlayHost = invalid then return false
  if m.overlayHost.getChildCount() = 0 then return false
  node = m.overlayHost.getChild(0)
  if node = invalid then return false
  return node.subtype() = name
end function

function playerOverlayOpen() as Boolean
  return overlayIs("PlayerScreen")
end function

sub focusPlayerOverlay()
  if not playerOverlayOpen() then return
  m.overlayHost.getChild(0).setFocus(true)
end sub

function searchPanelOpen() as Boolean
  return overlayIs("SearchPanel")
end function

sub focusSearchPanel()
  if not searchPanelOpen() then return
  m.overlayHost.getChild(0).setFocus(true)
end sub

sub applySearchDialogText(text as String)
  query = text.Trim()
  if searchPanelOpen()
    panel = m.overlayHost.getChild(0)
    panel.query = query
    if query = ""
      focusSearchPanel()
      return
    end if
    if isHttpUrl(query)
      navigate("pop", "", {})
      postPlayback({ title: "Link", link: query })
      return
    end if
    runSearch(query)
    focusSearchPanel()
    return
  end if
  if query = ""
    restoreScreenFocus()
    navigate("modal", "notice", { title: "Type a search", body: "Enter a title, then press Search." })
    return
  end if
  if isHttpUrl(query)
    postPlayback({ title: "Link", link: query })
    return
  end if
  navigate("push", "catalog", { kind: "search", query: query })
end sub

sub showSearch()
  panel = CreateObject("roSGNode", "SearchPanel")
  panel.observeField("action", "onSearchAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
  if m.searchKbTimer <> invalid
    m.searchKbTimer.control = "stop"
    parent = m.searchKbTimer.getParent()
    if parent <> invalid then parent.removeChild(m.searchKbTimer)
  end if
  timer = CreateObject("roSGNode", "Timer")
  timer.duration = 0.08
  timer.repeat = false
  timer.observeField("fire", "onSearchKeyboardOpen")
  m.searchKbTimer = timer
  m.top.appendChild(timer)
  timer.control = "start"
end sub

sub onSearchKeyboardOpen()
  if not searchPanelOpen() then return
  query = asText(m.overlayHost.getChild(0).query)
  showKeyboard("search", "Search", query, "Search")
end sub

sub onSearchAction()
  if not searchPanelOpen() then return
  panel = m.overlayHost.getChild(0)
  action = panel.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  query = asText(aaGet(action, "query", ""))
  if kind = "close"
    navigate("pop", "", {})
    return
  end if
  if kind = "keyboard"
    showKeyboard("search", "Search", query, "Search")
    return
  end if
  if kind = "details"
    navigate("pop", "", {})
    navigate("push", "details", { item: aaGet(action, "item", {}) })
    return
  end if
  if kind = "submit"
    if query = "" then return
    if isHttpUrl(query)
      navigate("pop", "", {})
      postPlayback({ title: "Link", link: query })
      return
    end if
    runSearch(query)
    return
  end if
  if kind = "query"
    if isHttpUrl(query) then return
    scheduleSearch(query)
  end if
end sub

sub scheduleSearch(query as String)
  if m.searchTimer <> invalid
    m.searchTimer.control = "stop"
    parent = m.searchTimer.getParent()
    if parent <> invalid then parent.removeChild(m.searchTimer)
  end if
  m.pendingSearch = query
  if query = "" or Len(query) < 2
    if searchPanelOpen()
      m.overlayHost.getChild(0).results = []
      m.overlayHost.getChild(0).message = "Type at least two letters."
    end if
    return
  end if
  timer = CreateObject("roSGNode", "Timer")
  timer.duration = 0.25
  timer.repeat = false
  timer.observeField("fire", "onSearchDebounce")
  m.pendingSearch = query
  m.searchTimer = timer
  m.top.appendChild(timer)
  timer.control = "start"
end sub

sub onSearchDebounce()
  runSearch(asText(m.pendingSearch))
end sub

sub runSearch(query as String)
  if query = "" then return
  m.pendingSearch = query
  m.searchRequestQuery = query
  m.searchTask = startApiGet(joinCorePath(m.coreUrl, "/api/search?q=" + encodeQuery(query)), "onSearchDone")
end sub

sub onSearchDone(event as Object)
  task = event.GetRoSGNode()
  if m.searchTask = invalid then return
  if task.requestId <> m.searchTask.requestId then return
  if not task.done then return
  if task = invalid or not searchPanelOpen() then return
  panel = m.overlayHost.getChild(0)
  if panel.query <> m.searchRequestQuery or panel.query <> m.pendingSearch then return
  if not task.ok
    panel.message = "Search failed. Check Core, then retry."

    return
  end if
  items = itemsFromJson(task.json)
  panel.results = items
  if items.Count() = 0
    panel.message = "Nothing matched that search."
  else
    panel.message = StrI(items.Count()).Trim() + " titles"
  end if

end sub

sub onLibraryAction()
  action = m.libraryNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "search" then navigate("modal", "search", {})
  if kind = "profiles" then navigate("push", "profiles", {})
  if kind = "rdToken" then navigate("push", "realdebrid", {})
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
end sub

sub onServiceAction()
  action = m.serviceNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "back" then navigate("pop", "", {})
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
  if kind = "play" then startPlayback(aaGet(action, "item", {}))
end sub

sub onRdScreenAction()
  action = m.rdNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "back" then navigate("pop", "", {})
  if kind = "paste" then showRdKeyboard()
end sub

sub loadLibrary()
  ensureLibrary()
  m.libraryNode.mode = "loading"
  if m.homeNode <> invalid then m.libraryNode.payload = m.homeNode.payload
  m.homeSilent = true
  loadHome()
  loadProfiles(false)
end sub

sub loadService(params as Object)
  ensureService()
  id = aaGet(params, "id", "")
  m.serviceNode.appId = id
  m.serviceNode.mode = "loading"
  m.appsTask = startApiGet(joinCorePath(m.coreUrl, "/api/apps/" + encodeQuery(id)), "onServiceDone")
end sub

sub onServiceDone()
  task = m.appsTask
  if task = invalid then return
  if not task.ok
    m.serviceNode.mode = "empty"
    restoreScreenFocus()
    return
  end if
  m.serviceNode.payload = task.json
  rails = aaArray(task.json, "rails")
  watching = aaArray(task.json, "continueWatching")
  hero = aaGet(task.json, "hero", invalid)
  if rails.Count() = 0 and watching.Count() = 0 and not isMediaItem(hero)
    m.serviceNode.mode = "empty"
  else
    m.serviceNode.mode = "ready"
  end if
  restoreScreenFocus()
end sub

sub postProgress(action as Object)
  id = asText(aaGet(action, "id", ""))
  if id = "" then return
  position = aaGet(action, "position", 0)
  duration = aaGet(action, "duration", 0)
  m.progressTask = startApiRequest(joinCorePath(m.coreUrl, "/api/progress"), "POST", progressBody(id, position, duration), "onProgressDone")
end sub

sub onProgressDone()
end sub

sub onRemoveProfileDone()
  task = m.mutateTask
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Could not remove", body: "Keep at least one profile, or check Core." })
    return
  end if
  if m.profilesNode <> invalid then m.profilesNode.registry = task.json
  m.profileId = asText(aaGet(task.json, "activeId", ""))
  restoreScreenFocus()
end sub

' ---- TVM Hub: this Roku as an installation and a command target ----

sub initHubAgent()
  m.hubAgent = CreateObject("roSGNode", "HubAgent")
  m.hubAgent.observeField("deviceCredential", "onHubCredential")
  m.hubAgent.observeField("status", "onHubStatus")
  m.hubAgent.observeField("effect", "onHubEffect")
  m.top.appendChild(m.hubAgent)
end sub

' After a usable sign-in: register (or resume) and start heartbeats. Demo data
' never registers.
sub startHubAgent()
  m.hubAgent.coreUrl = m.coreUrl
  m.hubAgent.coreToken = m.coreToken
  m.hubAgent.accountToken = m.accountToken
  m.hubAgent.profileId = m.profileId
  m.hubAgent.fixture = hubFixtureEnabled()
  m.hubAgent.mayNavigate = true
  m.hubAgent.active = false
  if m.coreUrl <> "" or hubFixtureEnabled()
    m.hubAgent.active = true
  end if
end sub

sub onHubCredential()
  m.deviceCredential = m.hubAgent.deviceCredential
  if m.hubNode <> invalid then m.hubNode.deviceCredential = m.deviceCredential
end sub

sub onHubStatus()
  if m.hubAgent.status = "revoked"
    m.accountToken = ""
    saveAccountToken("")
    body = {}
    body.signedIn = false
    showAccountGate(body)
    navigate("modal", "notice", { title: "This Roku was removed", body: "It was removed from your TVM devices. Sign in again to link it." })
  end if
end sub

' Play state changed: tell the Hub now instead of waiting for the next beat.
sub onHubPlayerState()
  m.hubAgent.callFunc("heartbeatNow", invalid)
end sub

sub hubPlayerClosed()
  m.hubAgent.player = invalid
  m.hubAgent.callFunc("heartbeatNow", invalid)
end sub

' Sign out of this Roku's installation (fire and forget), then forget it.
sub hubSignOutQuiet()
  if hubFixtureEnabled() then return
  if m.deviceCredential <> ""
    m.hubSignOutTask = startApiRequest(hubUrl(m.coreUrl, "/session/signout"), "POST", "{}", "onHubSignOutDone")
  end if
  hubForgetThisRoku()
end sub

sub onHubSignOutDone()
end sub

sub hubForgetThisRoku()
  m.hubAgent.active = false
  m.hubAgent.callFunc("forget", invalid)
  m.deviceCredential = ""
end sub

' A command another device sent (already decided by hubDecide and acked by
' the agent). effect.kind: pause, resume, seek, skip, intent, play.
sub onHubEffect()
  effect = m.hubAgent.effect
  if effect = invalid then return
  kind = asText(aaGet(effect, "kind", ""))
  if kind = "pause" or kind = "resume" or kind = "seek" or kind = "skip"
    if playerOverlayOpen() then m.overlayHost.getChild(0).callFunc("applyRemote", effect)
  else if kind = "intent"
    hubInjectIntent(asText(aaGet(effect, "intent", "")))
  else if kind = "play"
    hubPlayTitle(effect)
  end if
end sub

' nav.* becomes the key a physical remote would send: the top overlay gets
' it, otherwise the visible screen. Back falls through to the view stack.
sub hubInjectIntent(intent as String)
  if intent = "" then return
  target = invalid
  if m.overlayHost.getChildCount() > 0
    target = m.overlayHost.getChild(0)
  else if m.stack <> invalid
    target = screenNode(visibleScreen(m.stack).name)
  end if
  if target <> invalid
    if target.hasField("remoteIntent")
      target.remoteIntent = intent
      return
    end if
  end if
  if intent = "back" and m.stack <> invalid
    if canGoBack(m.stack) then navigate("pop", "", {})
  end if
end sub

' play.title: close any open player, then start the title the usual way. The
' command is acked applied once the stream is ready, rejected if not.
sub hubPlayTitle(effect as Object)
  id = asText(aaGet(effect, "mediaId", ""))
  if id = "" then return
  m.hubPlayCmd = asText(aaGet(effect, "commandId", ""))
  if playerOverlayOpen() then navigate("pop", "", {})
  startPlayback({ id: id, title: id, kind: "movie" })
end sub

sub hubFinishPlayCommand(ok as Boolean)
  if m.hubPlayCmd = "" then return
  id = m.hubPlayCmd
  m.hubPlayCmd = ""
  if ok
    m.hubAgent.callFunc("report", { id: id, status: "applied" })
  else
    m.hubAgent.callFunc("report", { id: id, status: "rejected", reason: "not_ready" })
  end if
end sub

' ---- Sign in with a code (RFC 8628 device flow against the Hub) ----
' pair/start gives a short code; the user approves it on a signed-in device;
' pair/token is polled at the server interval (slow_down adds 5 s). The result
' is an account token and this Roku's device credential.

sub startCodeSignIn()
  if m.coreUrl = ""
    if m.accountNode <> invalid
      m.accountNode.status = "Sign in with a code requires a PC Core server in Settings. Use your email and password on this Roku."
    end if
    restoreScreenFocus()
    return
  end if
  stopCodeSignIn()
  m.pair = { userCode: "", uri: "", message: "Getting a code...", deviceCode: "", interval: 5, expiresIn: 600 }
  navigate("modal", "codesignin", {})
  info = CreateObject("roDeviceInfo")
  app = CreateObject("roAppInfo")
  name = info.GetFriendlyName()
  if name = invalid or name = "" then name = "Roku"
  version = app.GetVersion()
  if version = invalid or version = "" then version = "1.0.0"
  body = { clientId: hubClientId(), platform: "roku", name: name, appVersion: version }
  model = info.GetModelDisplayName()
  if model <> invalid and model <> "" then body.model = model
  m.pairStartTask = startApiRequest(hubUrl(m.coreUrl, "/pair/start"), "POST", FormatJson(body), "onPairStartDone")
end sub

sub onPairStartDone()
  task = m.pairStartTask
  if task = invalid or m.pair = invalid then return
  if not task.ok
    kind = hubErrorKind(task.statusCode, task.error)
    m.pair.message = "Could not get a code. " + hubErrorText(kind)
    paintCodePanel()
    return
  end if
  json = task.json
  m.pair.userCode = asText(aaGet(json, "userCode", ""))
  m.pair.deviceCode = asText(aaGet(json, "deviceCode", ""))
  uri = asText(aaGet(json, "verificationUri", ""))
  if uri = "" then uri = asText(aaGet(json, "verificationUriComplete", ""))
  m.pair.uri = uri
  interval = hubNum(aaGet(json, "interval", 5))
  if interval < 1 then interval = 5
  m.pair.interval = Int(interval)
  expires = hubNum(aaGet(json, "expiresIn", 600))
  if expires < 30 then expires = 600
  m.pair.expiresIn = Int(expires)
  m.pair.message = "Waiting for approval..."
  paintCodePanel()
  if m.pair.deviceCode = "" then return
  m.pairClock = CreateObject("roTimespan")
  m.pairClock.Mark()
  if m.pairTimer = invalid
    m.pairTimer = CreateObject("roSGNode", "Timer")
    m.pairTimer.repeat = true
    m.pairTimer.observeField("fire", "onPairTick")
  end if
  m.pairTimer.duration = m.pair.interval
  m.pairTimer.control = "start"
end sub

sub onPairTick()
  if m.pair = invalid then return
  if m.pairClock.TotalSeconds() > m.pair.expiresIn
    stopPairPolling()
    m.pair.message = hubPairStopText("expired")
    paintCodePanel()
    return
  end if
  if m.pairTokenTask <> invalid
    if not m.pairTokenTask.done then return
  end if
  m.pairTokenTask = startApiRequest(hubUrl(m.coreUrl, "/pair/token"), "POST", FormatJson({ deviceCode: m.pair.deviceCode }), "onPairTokenDone")
end sub

sub onPairTokenDone()
  task = m.pairTokenTask
  if task = invalid or m.pair = invalid then return
  if task.ok
    finishCodeSignIn(task.json)
    return
  end if
  pollNext = hubPairPollNext(m.pair.interval, task.error)
  if pollNext.action = "wait"
    if pollNext.interval <> m.pair.interval
      m.pair.interval = pollNext.interval
      m.pairTimer.duration = pollNext.interval
    end if
    return
  end if
  stopPairPolling()
  m.pair.message = hubPairStopText(pollNext.reason)
  paintCodePanel()
end sub

sub finishCodeSignIn(json as Object)
  token = asText(aaGet(json, "accountToken", ""))
  installation = aaGet(json, "installation", {})
  id = asText(aaGet(installation, "id", ""))
  secret = asText(aaGet(json, "deviceSecret", ""))
  if not isAccountToken(token) or id = "" or secret = ""
    stopPairPolling()
    m.pair.message = hubPairStopText("error")
    paintCodePanel()
    return
  end if
  saveAccountToken(token)
  m.accountToken = token
  saveHubInstallation(id, secret)
  stopCodeSignIn()
  navigate("pop", "", {})
  loadAccount(true)
end sub

sub stopPairPolling()
  if m.pairTimer <> invalid then m.pairTimer.control = "stop"
end sub

sub stopCodeSignIn()
  stopPairPolling()
  m.pair = invalid
end sub

sub showCodePanel()
  panel = CreateObject("roSGNode", "CodeSignInPanel")
  panel.observeField("action", "onCodeSignInAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
  paintCodePanel()
end sub

sub paintCodePanel()
  if m.pair = invalid then return
  if m.overlayHost.getChildCount() = 0 then return
  panel = m.overlayHost.getChild(0)
  if panel.subtype() <> "CodeSignInPanel" then return
  panel.userCode = m.pair.userCode
  panel.uri = m.pair.uri
  panel.message = m.pair.message
end sub

sub onCodeSignInAction()
  stopCodeSignIn()
  navigate("pop", "", {})
end sub

sub loadMoreRail(action as Object)
  target = asText(aaGet(action, "target", "home"))
  railId = asText(aaGet(action, "railId", ""))
  key = target + ":" + railId
  if m.pageTasks.DoesExist(key)
    if not m.pageTasks[key].done and m.pageTasks[key].profileId = m.profileId then return
  end if
  task = CreateObject("roSGNode", "ApiTask")
  task.railId = railId : task.pageTarget = target
  task.requestUrl = joinCorePath(m.coreUrl, "/api/rails/more?id=" + encodeQuery(railId) + "&skip=" + asText(aaGet(action, "skip", 0)))
  task.profileId = m.profileId
  task.authToken = m.coreToken
  task.accountToken = m.accountToken
  task.appendItems = aaGet(action, "items", [])
  task.observeField("done", "onMoreRailDone")
  m.pageTasks[key] = task
  task.control = "RUN"
end sub

sub onMoreRailDone(event as Object)
  task = event.GetRoSGNode()
  key = task.pageTarget + ":" + task.railId
  if not m.pageTasks.DoesExist(key) then return
  if task <> m.pageTasks[key] or task.profileId <> m.profileId then return
  m.pageTasks.Delete(key)
  page = task.json
  page.railId = task.railId
  page.ok = task.ok
  if task.pageTarget = "home" and m.homeNode <> invalid then m.homeNode.appendPage = page
  if task.pageTarget = "catalog" and m.catalogNode <> invalid then m.catalogNode.appendPage = page
end sub

sub onSearchDialogTyping()
  dialog = m.top.dialog
  if dialog = invalid or not searchPanelOpen() then return
  panel = m.overlayHost.getChild(0)
  panel.query = dialog.text
  scheduleSearch(dialog.text)
end sub

sub showLoadingOrbit()
  node = CreateObject("roSGNode", "Group")
  node.focusable = true
  scrim = CreateObject("roSGNode", "Rectangle")
  scrim.width = 3840 : scrim.height = 2160 : scrim.color = "0x000000DD"
  node.appendChild(scrim)
  orbit = CreateObject("roSGNode", "OrbitLoader")
  orbit.translation = [1400, 760] : orbit.status = "Finding the best stream" : orbit.active = true
  node.appendChild(orbit)
  m.overlayHost.appendChild(node) : node.setFocus(true)
end sub

sub playNextChannel()
  nextItem = invalid
  if m.liveNode <> invalid
    channels = aaArray(m.liveNode.status, "channels")
    for i = 0 to channels.Count() - 1
      if channels[i].id = aaGet(m.playItem, "id", "") then nextItem = channels[(i + 1) mod channels.Count()]
    end for
  end if
  navigate("pop", "", {})
  if nextItem <> invalid then startPlayback(nextItem)
end sub
