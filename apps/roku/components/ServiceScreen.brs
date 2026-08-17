sub init()
  m.top.focusable = true
  m.bg = m.top.findNode("bg")
  m.heroArt = m.top.findNode("heroArt")
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.disclaimer = m.top.findNode("disclaimer")
  m.back = m.top.findNode("back")
  m.railsGroup = m.top.findNode("rails")
  m.empty = m.top.findNode("empty")
  m.loading = m.top.findNode("loading")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontHero()
  m.disclaimer.font = tvmFontCaption()
  m.loading.font = tvmFontBody()
  m.back.variant = "glass"
  m.back.label = "Back"
  m.empty.title = "No originals listed yet"
  m.empty.body = "TVM could not load this studio catalog. Retry from Apps."
  m.zone = "back"
  m.railRow = 0
  m.railCol = 0
  m.rails = []
  m.railNodes = []
  m.seq = 0
end sub

sub onMode()
  mode = m.top.mode
  m.loading.visible = (mode = "loading")
  m.railsGroup.visible = (mode = "ready")
  m.empty.visible = (mode = "empty")
  paintFocus()
end sub

sub onPayload()
  payload = m.top.payload
  app = tvmAppById(m.top.appId)
  name = asText(aaGet(payload, "name", ""))
  if name = "" and app <> invalid then name = app.name
  if name = "" then name = "App"
  m.heading.text = name
  layout = asText(aaGet(payload, "layout", "hub"))
  m.kicker.text = name
  disclaimer = asText(aaGet(payload, "disclaimer", ""))
  if disclaimer <> "" then m.disclaimer.text = disclaimer else m.disclaimer.text = "Titles play through TVM Stream."
  if app <> invalid then m.bg.color = app.accent
  m.rails = aaArray(payload, "rails")
  featured = aaGet(payload, "hero", invalid)
  watching = aaArray(payload, "continueWatching")
  if not isMediaItem(featured) and watching.Count() > 0 then featured = watching[0]
  if not isMediaItem(featured) and m.rails.Count() > 0
    items = aaArray(m.rails[0], "items")
    if items.Count() > 0 then featured = items[0]
  end if
  if isMediaItem(featured)
    art = asText(aaGet(featured, "backdrop", ""))
    if art = "" then art = asText(aaGet(featured, "poster", ""))
    m.heroArt.uri = art
  end if
  while m.railsGroup.getChildCount() > 0
    m.railsGroup.removeChildIndex(0)
  end while
  m.railNodes = []
  i = 0
  y = 0
  landscape = (layout = "prime" or layout = "peacock" or layout = "appletv")
  if watching.Count() > 0
    rail = CreateObject("roSGNode", "PosterRail")
    rail.title = "Continue Watching"
    rail.items = watching
    rail.layout = "landscape"
    rail.translation = [0, y]
    y = y + 520
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
  end if
  while i < m.rails.Count()
    rail = CreateObject("roSGNode", "PosterRail")
    rail.title = aaGet(m.rails[i], "title", "Originals")
    rail.items = aaArray(m.rails[i], "items")
    if landscape then rail.layout = "landscape" else rail.layout = "portrait"
    rail.translation = [0, y]
    y = y + 720
    m.railsGroup.appendChild(rail)
    m.railNodes.Push(rail)
    i = i + 1
  end while
  paintFocus()
end sub

sub paintFocus()
  m.back.hasFocusStyle = (m.zone = "back")
  r = 0
  while r < m.railNodes.Count()
    if m.zone = "rails" and r = m.railRow
      m.railNodes[r].focusCol = m.railCol
    else
      m.railNodes[r].focusCol = -1
    end if
    r = r + 1
  end while
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
  if m.zone = "back"
    if intent = "down" and m.railNodes.Count() > 0
      m.zone = "rails"
      m.railRow = 0
      m.railCol = 0
    end if
    if intent = "select" then emit("back", invalid)
    paintFocus()
    return true
  end if
  row = invalid
  if m.railRow < m.rails.Count() then row = m.rails[m.railRow]
  count = 0
  if row <> invalid then count = aaArray(row, "items").Count()
  if intent = "left" and count > 0
    if m.railCol > 0 then m.railCol = m.railCol - 1 else m.railCol = count - 1
  end if
  if intent = "right" and count > 0
    if m.railCol < count - 1 then m.railCol = m.railCol + 1 else m.railCol = 0
  end if
  if intent = "up"
    if m.railRow > 0 then m.railRow = m.railRow - 1 else m.zone = "back"
  end if
  if intent = "down" and m.railRow < m.railNodes.Count() - 1 then m.railRow = m.railRow + 1
  if intent = "select" and count > 0
    emit("details", { item: aaArray(row, "items")[m.railCol] })
  end if
  paintFocus()
  return true
end function
