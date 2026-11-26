sub init()
  m.top.focusable = true
  m.nav = m.top.findNode("navigation")
  m.panel = m.top.findNode("panel")
  m.focusSide = true
  m.category = 0 : m.row = 0 : m.seq = 0
  if m.global <> invalid
    m.global.observeField("reduceMotion", "paintSettings")
    m.global.observeField("reduceTransparency", "paintSettings")
    m.global.observeField("background", "paintSettings")
    m.global.observeField("hubFixture", "paintSettings")
  end if
  paintSettings()
end sub

function categories() as Object
  data = [
    { name: "Account", icon: "profile", description: "Manage the TVM account on this television.", rows: [
      actionRow("signOut", "Sign out", "Remove your TVM session from this television.")
      actionRow("computerSettings", "Account management", "Manage billing and account data on your computer.")
    ] }
    { name: "Profiles", icon: "profile", description: "Choose who is watching and manage their controls.", rows: [
      actionRow("profiles", "Manage profiles", "Edit names, character pictures, age limits and PINs.")
    ] }
    { name: "Playback", icon: "play", description: "Choose how TVM picks and plays a stream.", rows: [
      settingRow("quality", "Quality", "Original picks the best native resolution this television supports.", "select", ["original", "2160", "1080", "720", "saver"], ["Original", "4K", "1080p", "720p", "Data saver"])
      settingRow("skipUpscaled", "Skip upscaled releases", "Prefer releases mastered at their stated resolution.", "switch", [true], [])
      settingRow("audioLanguage", "Audio language", "Use the film or show's original audio, or choose a preferred language.", "select", ["original", "eng", "spa", "fra", "deu", "ita", "por", "jpn", "kor", "zho", "hin"], ["Original", "English", "Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Korean", "Chinese", "Hindi"])
      settingRow("autoplayNext", "Autoplay next episode", "Start the next episode after the countdown.", "switch", [true], [])
      settingRow("skipSegments", "Skip intro and credits", "Choose what to do when TVM knows the segment timings.", "segments", ["button", "auto", "off"], ["Button", "Automatic", "Off"])
      settingRow("sleepDefault", "Default sleep timer", "Start a timer each time you play a title.", "select", ["off", "15", "30", "45", "60", "end"], ["Off", "15 min", "30 min", "45 min", "60 min", "End of episode"])
    ] }
    { name: "Audio & subtitles", icon: "pause", description: "Choose when captions appear and how they look.", rows: [
      settingRow("subtitleMode", "Subtitle mode", "In foreign-audio mode, subtitles follow your first preferred language.", "segments", ["foreign", "always", "off"], ["Foreign", "Always", "Off"])
      actionRow("subtitleLanguages", "Preferred subtitle languages", "Enter language codes in order of preference.")
      settingRow("size", "Caption size", "Caption preview below.", "style", ["s", "m", "l", "xl"], ["Small", "Medium", "Large", "Extra large"])
      settingRow("color", "Caption colour", "Caption preview below.", "style", ["white", "yellow", "cyan"], ["White", "Yellow", "Cyan"])
      settingRow("background", "Caption background", "Caption preview below. Roku system captions use device settings.", "style", ["shadow", "box", "none"], ["Shadow", "Box", "None"])
    ] }
    { name: "Appearance", icon: "settings", description: "Adjust typography, colour and motion for your TV.", rows: [
      settingRow("font", "Font", "Choose the interface typeface.", "device", ["Geist", "Inter", "System"], ["Geist", "Inter", "System"])
      actionRow("cycleTheme", "Colour theme", "Switch between the light and dark palettes.")
      switchAction("toggleTransparency", "Reduce transparency", "Use opaque panels with the same rim.")
      switchAction("toggleMotion", "Reduce motion", "Use fades and keep showcase artwork still.")
      switchAction("posterTitles", "Poster titles", "Show titles below every poster.")
      actionRow("toggleBackground", "Background", "Choose trending artwork or the lighthouse.")
    ] }
    { name: "Home screen", icon: "home", description: "Choose what appears and change the order of Home rows.", rows: [
      settingRow("spotlightEvents", "Spotlight events", "Show the event artwork and its catch-up row.", "switch", [true], [])
    ] }
    { name: "Extras", icon: "apps", description: "Choose which optional features TVM uses.", rows: [
      extraRow("onlineSubtitles", "Online subtitles", "Look for subtitle tracks on OpenSubtitles.", true)
      extraRow("collections", "Collections", "Show related films on a title's details page.", true)
      extraRow("comingUp", "Coming up", "Show upcoming episodes in Details and on Home.", true)
      extraRow("watchStats", "Watch stats", "Record watch time and history on this Roku.", true)
      extraRow("animeTitles", "Anime titles", "Show English titles from AniList.", true)
      extraRow("ratings", "IMDb ratings", "Show IMDb scores on Home and in Details.", true)
      extraRow("qualityBadges", "Quality badges", "Show resolution, HDR and Atmos when known.", true)
      extraRow("versionPicker", "Version picker", "Choose a release from Details or during playback.", true)
      extraRow("spoilerBlur", "Hide episode spoilers", "Hide images and descriptions of unwatched episodes.", false)
      extraRow("surpriseMe", "Surprise me", "Pick a title from recommendations or your watchlist.", true)
      extraRow("autoCollections", "Automatic collections", "Show related and genre-based rows on Home.", true)
      extraRow("sleepTimer", "Sleep timer", "Stop playback after a set time or at the episode end.", true)
      extraRow("announcements", "Announcements", "Show service updates on Home.", true)
    ] }
    { name: "Live TV", icon: "live", description: "Manage channel sources and your guide.", rows: [
      actionRow("openGuide", "TV guide", "Browse the programme grid.")
      actionRow("livePlaylist", "M3U playlist", "Add an M3U or M3U8 URL with optional XMLTV.")
      actionRow("xtream", "Xtream provider", "Enter your provider server, username and password.")
      actionRow("livePicks", "Choose channels", "Choose which playlist channels appear on this TV.")
    ] }
    { name: "Real-Debrid", icon: "watchlist", description: "Connect your own Real-Debrid account.", rows: [
      actionRow("realdebrid", "Manage Real-Debrid", "Check the service status and update your key.")
    ] }
    { name: "Updates", icon: "forward", description: "Check for a new Roku channel package.", rows: [
      actionRow("updates", "Check for updates", "See the latest sideload package and installation steps.")
      actionRow("changelog", "What's new", "Read the changes in this and previous releases.")
    ] }
    { name: "Your stats", icon: "watchlist", description: "See viewing time and recent activity for this profile.", rows: [
      actionRow("stats", "Open your stats", "View watch history and manage local statistics.")
    ] }
    { name: "About", icon: "settings", description: "Find information about TVM and this television.", rows: [
      actionRow("channelInfo", "This channel", "See the installed version and build.")
      actionRow("services", "Streaming services", "Manage the services you watch.")
      actionRow("network", "Network", "See connection details.")
      actionRow("display", "Display", "See Roku display information.")
      actionRow("editUrl", "Core API URL", "Pair with a Core server on your network.")
      actionRow("editToken", "Device access token", "Replace your paired Core credential.")
    ] }
  ]
  if m.top.admin
    data.Push({ name: "Developer", icon: "settings", description: "Troubleshoot TVM on this television.", rows: [
      actionRow("diagnostics", "Diagnostics", "See Core status and the installed build.")
      actionRow("cache", "Clear cache", "Refresh cached artwork and catalogues.")
      actionRow("reloadContent", "Reload shared content", "Fetch the latest channels, events and avatars.")
      actionRow("restart", "Reload Home", "Load the Home catalogue again.")
      switchAction("toggleHubDemo", "Hub demo data", "Show sample devices without sending commands.")
    ] })
  end if
  for each home in m.top.homeRows
    data[5].rows.Push({ id: "homeSection", section: home.id, label: home.title, body: "OK to show or hide. Left and Right move this row.", type: "home" })
  end for
  return data
end function

function actionRow(id as String, label as String, description as String) as Object
  return { id: id, label: label, body: description, type: "action" }
end function

function switchAction(id as String, label as String, description as String) as Object
  return { id: id, label: label, body: description, type: "deviceSwitch" }
end function

function settingRow(id as String, label as String, description as String, control as String, values as Object, labels as Object) as Object
  return { id: id, label: label, body: description, type: control, values: values, labels: labels }
end function

function extraRow(id as String, label as String, description as String, enabled as Boolean) as Object
  return settingRow(id, label, description, "extra", [enabled], [])
end function

function activeSetting(row as Object) as Dynamic
  prefs = m.top.extrasPrefs
  if row.type = "extra" then return aaGet(aaGet(prefs, "extras", {}), row.id, row.values[0])
  if row.type = "device" then return tvmFontFamily()
  if row.type = "style"
    defaults = { size: "m", color: "white", background: "shadow" }
    return aaGet(aaGet(prefs, "subtitleStyle", {}), row.id, defaults[row.id])
  end if
  if row.type = "home"
    for each section in aaArray(prefs, "homeSections")
      if section.id = row.section then return aaGet(section, "visible", true)
    end for
    return true
  end if
  if row.id = "toggleMotion" then return tvmReduceMotion()
  if row.id = "toggleTransparency" then return tvmReduceTransparency()
  if row.id = "toggleHubDemo" then return loadFlag("hubFixture")
  if row.id = "posterTitles" then return loadFlag("posterTitles")
  if row.values <> invalid then return aaGet(prefs, row.id, row.values[0])
  return invalid
end function

function settingIndex(values as Object, value as Dynamic) as Integer
  for i = 0 to values.Count() - 1
    if values[i] = value then return i
  end for
  return 0
end function

function settingsLabel(parent as Object, value as String, x as Integer, y as Integer, w as Integer, h as Integer, font as Object, ink as String) as Object
  node = CreateObject("roSGNode", "Label")
  node.text = value : node.translation = [x, y] : node.width = w : node.height = h
  node.font = font : node.color = ink : node.vertAlign = "center"
  parent.appendChild(node)
  return node
end function

sub settingPlate(parent as Object, x as Integer, y as Integer, w as Integer, h as Integer, tint as String, shape = "card" as String)
  node = CreateObject("roSGNode", "Poster")
  node.uri = "pkg:/images/glass/" + shape + "-fill.9.png"
  node.width = w : node.height = h : node.translation = [x, y] : node.blendColor = tint
  parent.appendChild(node)
  rim = CreateObject("roSGNode", "Poster")
  rim.uri = "pkg:/images/glass/" + shape + ".9.png"
  rim.width = w : rim.height = h : rim.translation = [x, y]
  parent.appendChild(rim)
end sub

sub settingsIcon(parent as Object, name as String, x as Integer, y as Integer, color as String)
  node = CreateObject("roSGNode", "Poster")
  node.uri = "pkg:/images/icons/" + name + ".png"
  node.width = 52 : node.height = 52 : node.translation = [x, y] : node.blendColor = color
  parent.appendChild(node)
end sub

sub paintSettings()
  if m.panel = invalid then return
  m.top.findNode("settingsBg").color = tvmBg()
  for each layer in [m.nav, m.panel]
    layer.removeChildren(layer.getChildren(-1, 0))
  end for
  m.sections = categories()
  if m.category >= m.sections.Count() then m.category = 0
  settingsLabel(m.nav, "Settings", 0, 0, 960, 116, tvmFontScreenTitle(), tvmText())
  searchColor = tvmSurface()
  if m.focusSide and m.category = -1 then searchColor = tvmSurfaceHover()
  settingPlate(m.nav, 0, 158, 960, 112, searchColor)
  settingsIcon(m.nav, "search", 28, 186, tvmMuted())
  query = m.top.query.Trim()
  search = "Search settings"
  if query <> "" then search = query
  settingsLabel(m.nav, search, 105, 158, 817, 112, tvmFontLabel(), tvmText())
  first = 0
  if m.category > 11 then first = m.category - 11
  lastCategory = first + 11
  if lastCategory >= m.sections.Count() then lastCategory = m.sections.Count() - 1
  for i = first to lastCategory
    y = 310 + (i - first) * 125
    color = tvmMuted()
    if i = m.category
      tint = tvmSurfaceHover()
      if m.focusSide then tint = "0xF5F7FAFF" : color = "0x12141AFF"
      settingPlate(m.nav, 0, y, 960, 109, tint)
      if not m.focusSide then color = tvmText()
    end if
    settingsIcon(m.nav, m.sections[i].icon, 28, y + 28, color)
    settingsLabel(m.nav, m.sections[i].name, 105, y, 825, 109, tvmFontLabel(), color)
  end for
  rows = []
  heading = "Search settings"
  description = "Find a setting by name or description."
  if query <> ""
    heading = "Search results"
    description = "Settings matching “" + query + "”"
    for each category in m.sections
      for each row in category.rows
        haystack = LCase(category.name + " " + row.label + " " + row.body)
        if Instr(1, haystack, LCase(query)) > 0
          row.area = category.name
          rows.Push(row)
        end if
      end for
    end for
  else if m.category >= 0
    section = m.sections[m.category]
    heading = section.name : description = section.description : rows = section.rows
  end if
  if m.movedSection <> invalid
    for i = 0 to rows.Count() - 1
      if aaGet(rows[i], "section", "") = m.movedSection then m.row = i
    end for
  end if
  m.rows = rows
  if m.row >= rows.Count() then m.row = 0
  settingsLabel(m.panel, heading, 0, 0, 2410, 108, tvmFontScreenTitle(), tvmText())
  settingsLabel(m.panel, description, 0, 110, 2410, 92, tvmFontSecondary(), tvmMuted())
  if rows.Count() = 0
    if query <> "" then settingsLabel(m.panel, "No settings match that search.", 0, 246, 2370, 110, tvmFontLabel(), tvmMuted())
    return
  end if
  first = 0
  if m.row > 7 then first = m.row - 7
  last = first + 7
  if last >= rows.Count() then last = rows.Count() - 1
  card = CreateObject("roSGNode", "GlassPanel")
  if m.global <> invalid then card.backdropUri = asText(m.global.trendingHeroUri)
  card.width = 2420 : card.height = (last - first + 1) * 176 : card.translation = [0, 252]
  m.panel.appendChild(card)
  for i = first to last
    y = 252 + (i - first) * 176
    paintSetting(rows[i], y, not m.focusSide and i = m.row, i <> first)
  end for
  if heading = "Audio & subtitles" then paintSubtitlePreview(266 + (last - first + 1) * 176)
  m.top.focusKey = "settings:" + m.category.ToStr() + ":" + m.row.ToStr()
end sub

sub paintSetting(row as Object, y as Integer, focused as Boolean, divider as Boolean)
  if divider
    line = CreateObject("roSGNode", "Rectangle")
    line.color = "0xFFFFFF15" : line.width = 2340 : line.height = 2 : line.translation = [40, y]
    m.panel.appendChild(line)
  end if
  if focused then settingPlate(m.panel, 12, y + 7, 2396, 162, tvmSurfaceHover())
  label = row.label
  if row.area <> invalid and m.top.query <> "" then label = row.area + "  ·  " + label
  settingsLabel(m.panel, label, 56, y + 16, 1420, 74, tvmFontLabel(), tvmText())
  description = settingsLabel(m.panel, row.body, 56, y + 80, 1530, 90, tvmFont("regular", 36), tvmMuted())
  description.wrap = true : description.maxLines = 2
  value = activeSetting(row)
  if row.type = "switch" or row.type = "extra" or row.type = "deviceSwitch" or row.type = "home"
    if row.type = "home" then settingsLabel(m.panel, "< Up    Down >", 1620, y + 46, 550, 88, tvmFontMeta(), tvmMuted())
    track = tvmSurfaceHover()
    if value = true then track = tvmAccentBlue()
    settingPlate(m.panel, 2180, y + 50, 138, 76, track, "pill")
    offset = 2189
    if value = true then offset = 2255
    dot = CreateObject("roSGNode", "Poster")
    dot.uri = "pkg:/images/glass/dot.png"
    dot.width = 58 : dot.height = 58 : dot.translation = [offset, y + 59]
    m.panel.appendChild(dot)
    return
  end if
  if row.type = "segments" or row.type = "device"
    selected = settingIndex(row.values, value)
    count = row.labels.Count()
    width = 240
    settingPlate(m.panel, 2340 - count * width, y + 46, count * width, 88, tvmBg())
    for j = 0 to count - 1
      segmentX = 2340 - (count - j) * width
      color = tvmMuted()
      if j = selected
        settingPlate(m.panel, segmentX + 4, y + 50, width - 8, 80, "0xF5F7FAFF")
        color = "0x12141AFF"
      end if
      item = settingsLabel(m.panel, row.labels[j], segmentX, y + 46, width, 88, tvmFontMeta(), color)
      item.horizAlign = "center"
    end for
    return
  end if
  control = "›"
  if row.values <> invalid then control = row.labels[settingIndex(row.values, value)] + "  ›"
  if row.id = "cycleTheme" then control = tvmThemeLabel(m.top.themeId) + "  ›"
  if row.id = "toggleBackground" then control = loadBackground() + "  ›"
  if row.id = "subtitleLanguages" then control = aaArray(m.top.extrasPrefs, "subtitleLanguages").Join(", ") + "  ›"
  valueLabel = settingsLabel(m.panel, control, 1580, y + 22, 755, 128, tvmFontLabel(), tvmText())
  valueLabel.horizAlign = "right"
end sub

sub paintSubtitlePreview(y as Integer)
  style = aaGet(m.top.extrasPrefs, "subtitleStyle", {})
  size = { s: 42, m: 54, l: 66, xl: 78 }
  colors = { white: "0xFFFFFFFF", yellow: "0xFFE473FF", cyan: "0x73E8FFFF" }
  if aaGet(style, "background", "shadow") = "box" then settingPlate(m.panel, 570, y + 32, 1280, 130, "0x000000FF")
  font = tvmFont("medium", aaGet(size, aaGet(style, "size", "m"), 54))
  if aaGet(style, "background", "shadow") = "shadow"
    shadow = settingsLabel(m.panel, "Subtitle preview", 5, y + 5, 2420, 194, font, "0x000000FF")
    shadow.horizAlign = "center"
  end if
  preview = settingsLabel(m.panel, "Subtitle preview", 0, y, 2420, 194, font, aaGet(colors, aaGet(style, "color", "white"), tvmText()))
  preview.horizAlign = "center"
end sub

sub onSettingsQuery()
  m.row = 0
  m.focusSide = m.top.query.Trim() = ""
  paintSettings()
end sub

sub settingsEmit(kind as String, data = {} as Object)
  m.seq = m.seq + 1
  data.type = kind : data.seq = m.seq
  m.top.action = data
end sub

sub changeSetting(row as Object, direction as Integer, selectKey as Boolean)
  control = row.type
  if control = "home"
    if selectKey then direction = 0
    m.movedSection = row.section
    settingsEmit("homeSection", { id: row.section, delta: direction })
  else if control = "action" or control = "deviceSwitch"
    if selectKey or row.id = "cycleTheme" then settingsEmit(row.id, { delta: direction })
  else if control = "extra"
    if selectKey then settingsEmit("changePreference", { key: row.id, scope: "extras", value: not activeSetting(row) })
  else if control = "switch"
    if selectKey then settingsEmit("changePreference", { key: row.id, value: not activeSetting(row) })
  else if control = "device"
    index = settingIndex(row.values, activeSetting(row))
    settingsEmit("font", { family: row.values[(index + direction + row.values.Count()) mod row.values.Count()] })
  else if control = "select" or control = "style"
    if selectKey then settingsEmit("prefOptions", { row: row })
  else
    index = settingIndex(row.values, activeSetting(row))
    scope = ""
    if control = "style" then scope = "subtitleStyle"
    settingsEmit("changePreference", { key: row.id, scope: scope, value: row.values[(index + direction + row.values.Count()) mod row.values.Count()] })
  end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "up" or intent = "down" or intent = "back" then m.movedSection = invalid
  if intent = "back"
    if m.focusSide then return false
    m.focusSide = true
  else if m.focusSide
    if intent = "up" and m.category > -1
      m.category = m.category - 1 : m.row = 0
      if m.category >= 0 then m.top.query = ""
    end if
    if intent = "down" and m.category < m.sections.Count() - 1
      m.category = m.category + 1 : m.row = 0 : m.top.query = ""
    end if
    if intent = "select" and m.category = -1
      settingsEmit("settingsSearch")
    else if (intent = "right" or intent = "select") and m.rows.Count() > 0
      m.focusSide = false
    end if
  else if m.rows.Count() > 0
    if intent = "up" and m.row > 0 then m.row = m.row - 1
    if intent = "down" and m.row < m.rows.Count() - 1 then m.row = m.row + 1
    if intent = "select" or intent = "left" or intent = "right"
      direction = 1
      if intent = "left" then direction = -1
      changeSetting(m.rows[m.row], direction, intent = "select")
    end if
  end if
  paintSettings()
  return true
end function

sub onRemoteIntent()
  key = keyFromIntent(m.top.remoteIntent)
  if key <> "" then onKeyEvent(key, true)
end sub
