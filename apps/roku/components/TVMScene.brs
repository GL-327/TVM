sub init()
  applyCanvasScale()
  m.screenHost = m.top.findNode("screenHost")
  m.overlayHost = m.top.findNode("overlayHost")
  m.bootLabel = m.top.findNode("bootLabel")
  if m.bootLabel <> invalid then m.bootLabel.font = tvmFontHero()
  m.coreUrl = loadCoreBaseUrl()
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
  m.catalogNode = invalid
  m.liveNode = invalid
  m.profilesNode = invalid
  m.profileNode = invalid
  m.appsNode = invalid
  m.infoNode = invalid
  m.detailsNode = invalid
  m.libraryNode = invalid
  m.serviceNode = invalid
  m.rdNode = invalid
  m.health = {}
  m.rd = {}
  m.detailsSaved = false
  m.profilesNext = ""
  m.pendingPlayItem = invalid
  m.homeSilent = false
  m.searchTimer = invalid
  m.top.setFocus(true)

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
  if isPlaceholderUrl(m.coreUrl) then m.coreUrl = ""
  if m.coreUrl = "" or not isValidCoreUrl(m.coreUrl)
    m.stack = createViewStack("setup")
    renderStack()
    return
  end if
  m.stack = createViewStack("home")
  renderStack()
  loadHealth(false)
  loadHome()
  loadProfiles(false)
end sub

function isPlaceholderUrl(url as String) as Boolean
  if url = invalid or url = "" then return true
  return LCase(url).Instr("your-pc-lan-ip") > 0
end function

sub rememberActiveFocus()
  screen = visibleScreen(m.stack)
  key = ""
  if screen.name = "home" and m.homeNode <> invalid then key = m.homeNode.focusKey
  if screen.name = "settings" and m.settingsNode <> invalid then key = m.settingsNode.focusKey
  if screen.name = "setup" and m.setupNode <> invalid then key = m.setupNode.focusKey
  if key <> invalid then m.stack = viewStackRememberFocus(m.stack, key)
end sub

sub navigate(kind as String, name as String, params as Object)
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
  if kind = "push"
    if name = "catalog" then loadCatalog(params)
    if name = "library" then loadLibrary()
    if name = "live" then loadLive()
    if name = "profiles" then
      m.profilesNext = aaGet(params, "next", "")
      loadProfiles(true)
    end if
    if name = "profile" then loadRdStatus()
    if name = "realdebrid" then loadRdStatus()
    if name = "service" then loadService(params)
    if name = "details" then loadDetails(params)
  end if
end sub

sub renderStack()
  m.bootLabel.visible = false
  screen = visibleScreen(m.stack)
  top = activeEntry(m.stack)

  hideScreens()
  if screen.name = "home"
    ensureHome()
    m.homeNode.visible = true
    if top.kind <> "modal"
      m.homeNode.setFocus(true)
      if screen.focusKey <> invalid and screen.focusKey <> ""
        m.homeNode.restoreKey = screen.focusKey
      end if
    end if
  else if screen.name = "settings"
    ensureSettings()
    m.settingsNode.visible = true
    m.settingsNode.coreUrl = m.coreUrl
    m.settingsNode.health = m.health
    if top.kind <> "modal" then m.settingsNode.setFocus(true)
  else if screen.name = "setup"
    ensureSetup()
    m.setupNode.visible = true
    if top.kind <> "modal" then m.setupNode.setFocus(true)
  else if screen.name = "catalog"
    ensureCatalog()
    applyCatalogCopy(screen.params)
    m.catalogNode.visible = true
    if top.kind <> "modal" then m.catalogNode.setFocus(true)
  else if screen.name = "live"
    ensureLive()
    m.liveNode.visible = true
    if top.kind <> "modal" then m.liveNode.setFocus(true)
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
    m.rdNode.status = m.rd
    m.rdNode.visible = true
    if top.kind <> "modal" then m.rdNode.setFocus(true)
  end if

  clearOverlays()
  if top.kind = "modal"
    if top.name = "notice" then showNotice(top.params)
    if top.name = "player" then showPlayer(top.params)
    if top.name = "confirm" then showConfirm(top.params)
    if top.name = "search" then showSearch()
  end if
end sub

sub hideScreens()
  if m.homeNode <> invalid then m.homeNode.visible = false
  if m.settingsNode <> invalid then m.settingsNode.visible = false
  if m.setupNode <> invalid then m.setupNode.visible = false
  if m.catalogNode <> invalid then m.catalogNode.visible = false
  if m.liveNode <> invalid then m.liveNode.visible = false
  if m.profilesNode <> invalid then m.profilesNode.visible = false
  if m.profileNode <> invalid then m.profileNode.visible = false
  if m.appsNode <> invalid then m.appsNode.visible = false
  if m.infoNode <> invalid then m.infoNode.visible = false
  if m.detailsNode <> invalid then m.detailsNode.visible = false
  if m.libraryNode <> invalid then m.libraryNode.visible = false
  if m.serviceNode <> invalid then m.serviceNode.visible = false
  if m.rdNode <> invalid then m.rdNode.visible = false
end sub

sub clearOverlays()
  while m.overlayHost.getChildCount() > 0
    m.overlayHost.removeChildIndex(0)
  end while
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
  m.overlayHost.appendChild(panel)
  panel.streamTitle = aaGet(params, "title", "")
  panel.streamFormat = aaGet(params, "format", "mp4")
  panel.mediaId = aaGet(params, "mediaId", "")
  startAt = aaGet(params, "startAt", 0)
  if startAt <> invalid then panel.startAt = startAt
  panel.message = "Starting..."
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
    navigate("push", "settings", {})
    return true
  end if
  return false
end function

sub handleScreenAction(action as Object)
  kind = aaGet(action, "type", "")
  if handleRibbonKind(action) then return
  if kind = "retry" then loadHome()
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
  if kind = "play" then startPlayback(aaGet(action, "item", {}))
end sub

sub onSettingsAction()
  action = m.settingsNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "editUrl" then showUrlKeyboard()
  if kind = "realdebrid" then navigate("push", "realdebrid", {})
  if kind = "livePlaylist" then showLiveKeyboard()
  if kind = "profiles" then navigate("push", "profiles", {})
  if kind = "updates" then loadUpdates()
  if kind = "network" then showNetworkInfo()
  if kind = "display" then showDisplayInfo()
  if kind = "diagnostics" then showDiagnostics()
  if kind = "linux"
    navigate("modal", "notice", {
      title: "Linux desktop"
      body: "The Linux desktop lives on the TVM USB stick. TVM still boots fullscreen; this setting opens the OS behind it when you need files or a terminal. On this Windows PC the stick is prepared with os/scripts/prepare-usb.ps1."
    })
  end if
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
  if aaGet(action, "type", "") = "editUrl" then showUrlKeyboard()
end sub

sub onCatalogAction()
  action = m.catalogNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if handleRibbonKind(action) then return
  if kind = "home" then navigate("home", "home", {})
  if kind = "retry" then loadCatalog(visibleScreen(m.stack).params)
  if kind = "details" then navigate("push", "details", { item: aaGet(action, "item", {}) })
end sub

sub onLiveAction()
  action = m.liveNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if handleRibbonKind(action) then return
  if kind = "home" then navigate("home", "home", {})
  if kind = "retry" then loadLive()
  if kind = "playlist" then showLiveKeyboard()
  if kind = "play" then startPlayback(aaGet(action, "item", {}))
end sub

sub onProfilesAction()
  action = m.profilesNode.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  if kind = "home" then navigate("home", "home", {})
  if kind = "create" then showProfileKeyboard()
  if kind = "switch" then switchProfile(aaGet(action, "id", ""))
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
  if kind = "openApp" then openServiceHub(aaGet(action, "id", ""), aaGet(action, "name", "App"))
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
  if kind = "save" then toggleWatchlist(item)
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
  if kind = "progress"
    postProgress(action)
    return
  end if
  navigate("pop", "", {})
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
  if confirmId = "clear-cache"
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
  dialog = CreateObject("roSGNode", "KeyboardDialog")
  dialog.title = title
  dialog.text = text
  dialog.buttons = [confirmLabel, "Cancel"]
  dialog.observeField("buttonSelected", "onKeyboardButton")
  m.top.dialog = dialog
end sub

sub onKeyboardButton()
  dialog = m.top.dialog
  if dialog = invalid then return
  index = dialog.buttonSelected
  text = dialog.text
  mode = m.keyboardMode
  m.top.dialog = invalid
  if index <> 0
    restoreScreenFocus()
    return
  end if

  if mode = "coreUrl"
    applyCoreUrl(text)
    return
  end if
  if mode = "search"
    query = text.Trim()
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
  if mode = "profileName"
    createProfile(text.Trim())
    return
  end if
  restoreScreenFocus()
end sub

sub applyCoreUrl(text as String)
  url = normalizeCoreUrl(text)
  if isPlaceholderUrl(url) or not isValidCoreUrl(url)
    restoreScreenFocus()
    navigate("modal", "notice", {
      title: "That URL will not work"
      body: "Use http:// followed by this computer's LAN address and Core port. Copy apps/roku/config.example.json to config.json for sideload defaults."
    })
    return
  end if

  saveCoreBaseUrl(url)
  m.coreUrl = url
  if m.setupNode <> invalid then m.setupNode.message = "Connecting..."
  if m.settingsNode <> invalid then m.settingsNode.coreUrl = url
  loadHealth(true)
end sub

sub restoreScreenFocus()
  top = activeEntry(m.stack)
  screen = visibleScreen(m.stack)
  if top.kind = "modal" then return
  if screen.name = "home" and m.homeNode <> invalid then m.homeNode.setFocus(true)
  if screen.name = "settings" and m.settingsNode <> invalid then m.settingsNode.setFocus(true)
  if screen.name = "setup" and m.setupNode <> invalid then m.setupNode.setFocus(true)
  if screen.name = "catalog" and m.catalogNode <> invalid then m.catalogNode.setFocus(true)
  if screen.name = "live" and m.liveNode <> invalid then m.liveNode.setFocus(true)
  if screen.name = "profiles" and m.profilesNode <> invalid then m.profilesNode.setFocus(true)
  if screen.name = "profile" and m.profileNode <> invalid then m.profileNode.setFocus(true)
  if screen.name = "apps" and m.appsNode <> invalid then m.appsNode.setFocus(true)
  if screen.name = "info" and m.infoNode <> invalid then m.infoNode.setFocus(true)
  if screen.name = "details" and m.detailsNode <> invalid then m.detailsNode.setFocus(true)
  if screen.name = "library" and m.libraryNode <> invalid then m.libraryNode.setFocus(true)
  if screen.name = "service" and m.serviceNode <> invalid then m.serviceNode.setFocus(true)
  if screen.name = "realdebrid" and m.rdNode <> invalid then m.rdNode.setFocus(true)
end sub

sub loadHealth(thenHome as Boolean)
  if m.coreUrl = "" then return
  m.healthWaitHome = thenHome
  m.healthTask = startApiGet(joinCorePath(m.coreUrl, "/api/health"), "onHealthDone")
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
      screen = visibleScreen(m.stack)
      if screen.name = "setup"
        navigate("reset", "home", {})
      end if
      loadHome()
      loadProfiles(false)
    else
      if m.setupNode <> invalid
        m.setupNode.message = "Could not reach Core. Check TVM_CORE_BIND, the Windows firewall, and that this Roku is on the same network."
      end if
      restoreScreenFocus()
      if visibleScreen(m.stack).name = "home" then showHomeError()
    end if
  else
    restoreScreenFocus()
  end if
end sub

sub loadHome()
  ensureHome()
  if m.homeSilent <> true then m.homeNode.mode = "loading"
  if m.coreUrl = "" or not isValidCoreUrl(m.coreUrl)
    showHomeError()
    return
  end if
  m.homeTask = startApiGet(joinCorePath(m.coreUrl, "/api/home"), "onHomeDone")
end sub

sub onHomePoll()
  if m.coreUrl = "" or not isValidCoreUrl(m.coreUrl) then return
  if m.stack = invalid then return
  if visibleScreen(m.stack).name <> "home" then return
  if m.homeNode = invalid then return
  if m.homeNode.mode <> "ready" then return
  m.homeSilent = true
  loadHome()
end sub

sub onHomeDone()
  task = m.homeTask
  if task = invalid then return
  if not task.ok
    silent = m.homeSilent
    m.homeSilent = false
    if silent = true then return
    showHomeError()
    return
  end if

  payload = task.json
  m.homeSilent = false
  m.homeNode.payload = payload
  if m.libraryNode <> invalid
    m.libraryNode.payload = payload
    m.libraryNode.mode = "ready"
  end if
  if homeIsEmpty(payload)
    m.homeNode.mode = "empty"
  else
    m.homeNode.mode = "ready"
  end if
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
  path = "/api/library"
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
  m.liveTask = startApiGet(joinCorePath(m.coreUrl, "/api/live"), "onLiveDone")
end sub

sub onLiveDone()
  task = m.liveTask
  if task = invalid then return
  if not task.ok
    m.liveNode.mode = "error"
    restoreScreenFocus()
    return
  end if
  m.liveNode.status = task.json
  m.liveNode.mode = "ready"
  restoreScreenFocus()
end sub

sub loadProfiles(show as Boolean)
  if m.coreUrl = "" then return
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
  m.profileId = asText(aaGet(json, "activeId", ""))
  if m.profilesNode <> invalid then m.profilesNode.registry = json
  if m.libraryNode <> invalid
    profiles = aaArray(json, "profiles")
    i = 0
    while i < profiles.Count()
      if asText(aaGet(profiles[i], "id", "")) = m.profileId then m.libraryNode.profile = profiles[i]
      i = i + 1
    end while
  end if
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
  loadHome()
  navigate("modal", "notice", { title: "Real-Debrid", body: "The token is stored on the computer. Home will refresh with that account." })
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
  m.updateTask = startApiGet(joinCorePath(m.coreUrl, "/api/update/status"), "onUpdatesDone")
end sub

sub onUpdatesDone()
  task = m.updateTask
  restoreScreenFocus()
  if task = invalid or not task.ok
    navigate("modal", "notice", { title: "Updates unavailable", body: "Core did not return update status." })
    return
  end if
  json = task.json
  current = asText(aaGet(json, "current", ""))
  available = aaGet(json, "available", invalid)
  body = "This Core is " + current + ". Apply updates from the TVM app on the computer, not this Roku."
  if available <> invalid and GetInterface(available, "ifAssociativeArray") <> invalid
    version = asText(aaGet(available, "version", ""))
    if version <> ""
      body = "Core " + current + " can update to " + version + ". Apply it from the TVM app on the computer."
    end if
  end if
  navigate("modal", "notice", { title: "Updates", body: body })
end sub

sub loadRdStatus()
  m.rdTask = startApiGet(joinCorePath(m.coreUrl, "/api/rd/status"), "onRdStatusDone")
end sub

sub onRdStatusDone()
  task = m.rdTask
  if task = invalid or not task.ok then return
  m.rd = task.json
  if m.profileNode <> invalid then m.profileNode.rd = m.rd
  if m.rdNode <> invalid then m.rdNode.status = m.rd
end sub

sub loadDetails(params as Object)
  loadDetailsSaved(params)
  item = aaGet(params, "item", {})
  id = asText(aaGet(item, "id", ""))
  ensureDetails()
  m.detailsNode.item = item
  if id = "" then return
  m.detailsTask = startApiGet(joinCorePath(m.coreUrl, "/api/media?id=" + encodeQuery(id)), "onDetailsMedia")
  m.detailsChildrenTask = startApiGet(joinCorePath(m.coreUrl, "/api/media/children?id=" + encodeQuery(id)), "onDetailsChildren")
end sub

sub onDetailsMedia()
  task = m.detailsTask
  if task = invalid or not task.ok then return
  if m.detailsNode <> invalid then m.detailsNode.item = task.json
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
  navigate("push", "info", {
    kicker: "Device status"
    heading: "Network"
    body: "Status: " + connected + chr(10) + "Core: " + m.coreUrl + chr(10) + "TVM reports the active connection. Wi-Fi selection is handled by the appliance or this Roku, not a fake web control."
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
  if id = "tvm-stream"
    navigate("push", "profiles", { next: "library" })
    return
  end if
  navigate("push", "service", { id: id, name: name })
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
  m.playItem = item
  m.playTask = startApiRequest(joinCorePath(m.coreUrl, "/api/playback"), "POST", playbackBody(item), "onPlayDone")
end sub

sub onPlayDone()
  task = m.playTask
  json = {}
  if task <> invalid then json = task.json
  kind = asText(aaGet(json, "kind", ""))
  if kind = "stream"
    url = asText(aaGet(json, "url", ""))
    if url = ""
      navigate("modal", "notice", { title: "No stream URL", body: "Core returned a stream with no address." })
      return
    end if
    title = asText(aaGet(json, "title", ""))
    if title = "" then title = asText(aaGet(m.playItem, "title", ""))
    if title = "" then title = asText(aaGet(m.playItem, "name", ""))
    mimeType = asText(aaGet(json, "mimeType", ""))
    startAt = aaGet(json, "startAt", 0)
    mediaId = asText(aaGet(m.playItem, "id", ""))
    navigate("modal", "player", {
      url: url
      title: title
      format: streamFormatFor(url, mimeType)
      mediaId: mediaId
      startAt: startAt
    })
    return
  end if
  reason = asText(aaGet(json, "reason", ""))
  navigate("modal", "notice", { title: "Can't play yet", body: playbackNotice(reason) })
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
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

sub showSearch()
  panel = CreateObject("roSGNode", "SearchPanel")
  panel.observeField("action", "onSearchAction")
  m.overlayHost.appendChild(panel)
  panel.setFocus(true)
end sub

sub onSearchAction()
  if m.overlayHost.getChildCount() = 0 then return
  panel = m.overlayHost.getChild(0)
  action = panel.action
  if action = invalid then return
  kind = aaGet(action, "type", "")
  query = asText(aaGet(action, "query", ""))
  if kind = "close"
    navigate("pop", "", {})
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
    scheduleSearch(query)
  end if
end sub

sub scheduleSearch(query as String)
  if m.searchTimer <> invalid then m.searchTimer.control = "stop"
  if query = "" or Len(query) < 2 then return
  timer = CreateObject("roSGNode", "Timer")
  timer.duration = 0.35
  timer.repeat = false
  timer.observeField("fire", "onSearchDebounce")
  m.pendingSearch = query
  m.searchTimer = timer
  timer.control = "start"
end sub

sub onSearchDebounce()
  runSearch(asText(m.pendingSearch))
end sub

sub runSearch(query as String)
  if query = "" then return
  m.searchTask = startApiGet(joinCorePath(m.coreUrl, "/api/search?q=" + encodeQuery(query)), "onSearchDone")
end sub

sub onSearchDone()
  task = m.searchTask
  if task = invalid or m.overlayHost.getChildCount() = 0 then return
  panel = m.overlayHost.getChild(0)
  if not task.ok
    panel.message = "Search failed. Check Core, then retry."
    return
  end if
  panel.results = itemsFromJson(task.json)
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
  if rails.Count() = 0
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
