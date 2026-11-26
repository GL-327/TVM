sub init()
  m.top.focusable = true
  m.top.findNode("background").color = tvmBg()
  m.controls = m.top.findNode("controls")
  m.timeline = m.top.findNode("timeline")
  m.grid = m.top.findNode("grid")
  m.marker = m.top.findNode("nowMarker")
  m.info = m.top.findNode("info")
  m.nav = m.top.findNode("nav")
  m.navCol = 3
  m.zone = "grid"
  m.tool = 0
  m.row = 0 : m.first = 0 : m.day = 0 : m.group = 0
  m.digits = ""
  m.seq = 0
  m.window = 10800
  m.x = 640 : m.width = 3040 : m.height = 128
  m.now = CreateObject("roDateTime").AsSeconds()
  m.start = m.now - (m.now mod 1800)
  m.end = m.start + 86400
  m.left = m.start
  m.anchor = m.now
  m.rows = [] : m.groups = [] : m.data = []
  m.clock = m.top.findNode("clock")
  m.clock.observeField("fire", "onClock")
  m.tune = m.top.findNode("tune")
  m.tune.observeField("fire", "tuneChannel")
  m.top.observeField("visible", "onVisibility")
  onVisibility()
  paintGuide()
end sub

sub onVisibility()
  if m.top.visible then m.clock.control = "start" else m.clock.control = "stop"
end sub

sub onClock()
  if m.top.visible then paintGuide()
end sub

function epoch(value as String) as Integer
  date = CreateObject("roDateTime")
  if Len(value) < 19 then return 0
  date.FromSeconds(0)
  date.FromISO8601String(Left(value, 19))
  return date.AsSeconds()
end function

function iso(value as Integer) as String
  dt = CreateObject("roDateTime")
  dt.FromSeconds(value)
  return Left(dt.ToISOString(), 19) + "Z"
end function

function clockText(value as Integer) as String
  dt = CreateObject("roDateTime")
  dt.FromSeconds(value) : dt.ToLocalTime()
  return Mid(dt.ToISOString(), 12, 5)
end function

sub onChannels()
  if m.grid = invalid then return
  if m.top.guide = invalid or not m.top.guide.DoesExist("channels") then onFilter()
end sub

sub onGuide()
  doc = m.top.guide
  if m.grid = invalid or doc = invalid then return
  start = epoch(asText(aaGet(doc, "start", "")))
  finish = epoch(asText(aaGet(doc, "end", "")))
  if start > 0 and finish > start
    m.start = start : m.end = finish
    m.left = guideClamp(m.left, m.start, m.end - m.window)
    m.anchor = guideClamp(m.anchor, m.left, m.left + m.window - 1)
  end if
  m.groups = aaArray(doc, "groups")
  if m.group >= m.groups.Count() + 2 then m.group = 0
  onFilter()
end sub

sub onFilter()
  if m.grid = invalid then return
  oldId = ""
  if m.row < m.rows.Count() then oldId = asText(aaGet(m.rows[m.row], "id", ""))
  m.rows = []
  m.data = aaArray(m.top.guide, "channels")
  if m.data.Count() = 0 then m.data = m.top.channels
  if m.data = invalid then m.data = []
  search = LCase(m.top.query.Trim())
  m.row = 0
  for each channel in m.data
    name = asText(aaGet(channel, "name", aaGet(channel, "title", "")))
    group = asText(aaGet(channel, "group", ""))
    shown = m.group = 0
    if m.group = 1 then shown = aaGet(channel, "favourite", false) = true
    if m.group > 1 then shown = group = m.groups[m.group - 2]
    if shown and (search = "" or Instr(1, LCase(name), search) > 0)
      if channel.id = oldId then m.row = m.rows.Count()
      m.rows.Push(channel)
    end if
  end for
  m.first = guideClamp(m.first, 0, m.row)
  paintGuide()
end sub

function guideClamp(value as Integer, low as Integer, high as Integer) as Integer
  if value < low then return low
  if value > high then return high
  return value
end function

function guideChannelName(channel as Object) as String
  return asText(aaGet(channel, "name", aaGet(channel, "title", "Channel")))
end function

function guideButton(parent as Object, x as Integer, y as Integer, w as Integer, label as String, focused as Boolean) as Object
  node = CreateObject("roSGNode", "GlassPanel")
  node.shape = "card" : node.width = w : node.height = 104 : node.translation = [x, y]
  node.tintColor = tvmSurface()
  if focused then node.tintColor = "0xF5F7FAFF"
  parent.appendChild(node)
  ink = tvmText()
  if focused then ink = "0x12141AFF"
  text = guideLabel(parent, label, x + 12, y, w - 24, 104, tvmFontLabel(), ink)
  text.horizAlign = "center"
  return node
end function

function guideLabel(parent as Object, value as String, x as Integer, y as Integer, w as Integer, h as Integer, font as Object, ink as String) as Object
  node = CreateObject("roSGNode", "Label")
  node.text = value : node.translation = [x, y] : node.width = w : node.height = h
  node.font = font : node.color = ink : node.vertAlign = "center"
  parent.appendChild(node)
  return node
end function

sub guideRect(parent as Object, x as Integer, y as Integer, w as Integer, h as Integer, color as String)
  rect = CreateObject("roSGNode", "Rectangle")
  rect.translation = [x, y] : rect.width = w : rect.height = h : rect.color = color
  parent.appendChild(rect)
end sub

sub guideLogo(parent as Object, uri as String, x as Integer, y as Integer, w as Integer, h as Integer)
  if uri = "" then return
  logo = CreateObject("roSGNode", "Poster")
  logo.uri = uri : logo.translation = [x, y] : logo.width = w : logo.height = h
  logo.loadWidth = 160 : logo.loadHeight = 90 : logo.loadDisplayMode = "scaleToFit"
  parent.appendChild(logo)
end sub

function guideProgrammes(channel as Object) as Object
  blocks = aaArray(channel, "programmes")
  if blocks.Count() = 0 then return [{ title: "No guide information", from: m.start, until: m.end }]
  out = []
  for each block in blocks
    start = epoch(asText(aaGet(block, "start", "")))
    finish = epoch(asText(aaGet(block, "end", "")))
    if finish > start then out.Push({ title: asText(aaGet(block, "title", "")), from: start, until: finish, meta: block })
  end for
  return out
end function

function guideFocused(blocks as Object) as Object
  for each block in blocks
    if m.anchor >= block.from and m.anchor < block.until then return block
  end for
  start = m.left
  finish = m.left + m.window
  for each block in blocks
    if block.until <= m.anchor and block.until > start then start = block.until
    if block.from > m.anchor and block.from < finish then finish = block.from
  end for
  return { title: "No guide information", from: start, until: finish }
end function

function positionX(value as Integer) as Integer
  return Int((value - m.left) * m.width / m.window)
end function

sub drawBlock(block as Object, y as Integer, selected as Boolean)
  x = positionX(guideClamp(block.from, m.left, m.left + m.window))
  w = positionX(guideClamp(block.until, m.left, m.left + m.window)) - x - 4
  if w < 5 then return
  color = tvmSurface()
  ink = tvmText()
  airing = m.now >= block.from and m.now < block.until and block.meta <> invalid
  if airing then color = tvmSurfaceHover()
  if block.until <= m.now then ink = tvmMuted()
  if selected and m.zone = "grid" then color = "0xF5F7FAFF" : ink = "0x12141AFF"
  plate = CreateObject("roSGNode", "Poster")
  plate.uri = "pkg:/images/glass/card-fill.9.png"
  plate.blendColor = color : plate.width = w : plate.height = m.height - 4
  plate.translation = [480 + x, y]
  m.grid.appendChild(plate)
  if airing
    guideRect(m.grid, 480 + x + 4, y + 12, 4, m.height - 28, tvmAccentBlue())
    progress = guideClamp(positionX(m.now) - x, 0, w - 8)
    if progress > 0 then guideRect(m.grid, 480 + x + 4, y + m.height - 9, progress, 4, tvmAccentBlue())
  end if
  if w > 56 then guideLabel(m.grid, block.title, 500 + x, y, w - 40, m.height - 4, tvmFontSecondary(), ink)
end sub

sub paintGuide()
  m.now = CreateObject("roDateTime").AsSeconds()
  m.nav.hasBarFocus = m.zone = "nav" : m.nav.focusCol = m.navCol
  for each layer in [m.controls, m.timeline, m.grid, m.marker, m.info]
    layer.removeChildren(layer.getChildren(-1, 0))
  end for
  guideLabel(m.controls, "Guide", 0, 0, 400, 108, tvmFontScreenTitle(), tvmText())
  day = ["Yesterday", "Today", "Tomorrow"][m.day + 1]
  group = "All channels"
  if m.group = 1 then group = "Favourites"
  if m.group > 1 then group = m.groups[m.group - 2]
  search = "Search"
  if m.top.query <> "" then search = m.top.query
  labels = [day + " ▾", group + " ▾", search, "Channels", "Sources"]
  widths = [390, 510, 640, 340, 340]
  x = 480
  for i = 0 to labels.Count() - 1
    guideButton(m.controls, x, 4, widths[i], labels[i], m.zone = "tools" and m.tool = i)
    x = x + widths[i] + 24
  end for
  clock = clockText(m.now)
  if m.digits <> "" then clock = "Channel " + m.digits
  clockLabel = guideLabel(m.controls, clock, 2880, 0, 640, 104, tvmFont("medium", 54), tvmText())
  clockLabel.horizAlign = "right"
  for i = 0 to 5
    x = positionX(m.left + i * 1800)
    guideLabel(m.timeline, clockText(m.left + i * 1800), x + 12, 0, 220, 66, tvmFont("medium", 48), tvmMuted())
    guideRect(m.timeline, x, 54, 2, 26, tvmMuted())
  end for
  if m.rows.Count() = 0
    guideLabel(m.grid, "No channels match this selection.", 0, 32, 3000, 100, tvmFontBodyLg(), tvmMuted())
    return
  end if
  if m.row < m.first then m.first = m.row
  if m.row > m.first + 7 then m.first = m.row - 7
  last = guideClamp(m.first + 7, m.first, m.rows.Count() - 1)
  for i = m.first to last
    channel = m.rows[i]
    y = (i - m.first) * m.height
    number = asText(aaGet(channel, "number", i + 1))
    guideLabel(m.grid, number, 0, y, 116, m.height, tvmFont("medium", 44), tvmMuted())
    guideLogo(m.grid, asText(aaGet(channel, "logo", "")), 112, y + 31, 108, 62)
    name = guideLabel(m.grid, guideChannelName(channel), 236, y, 225, m.height, tvmFontSecondary(), tvmText())
    name.wrap = true : name.maxLines = 2
    guideRect(m.grid, 0, y + m.height - 3, 460, 2, "0xFFFFFF18")
    blocks = guideProgrammes(channel)
    selected = invalid
    if i = m.row then selected = guideFocused(blocks)
    found = false
    previous = m.left
    for each block in blocks
      if block.until > m.left and block.from < m.left + m.window
        active = (selected <> invalid and selected.from = block.from and selected.until = block.until)
        if active then found = true
        if block.from > previous then drawBlock({ title: "", from: previous, until: block.from }, y, false)
        drawBlock(block, y, active)
        if block.until > previous then previous = block.until
      end if
    end for
    if previous < m.left + m.window then drawBlock({ title: "", from: previous, until: m.left + m.window }, y, false)
    if selected <> invalid
      if not found then drawBlock(selected, y, true)
      drawGuideInfo(channel, selected)
    end if
  end for
  if m.now >= m.left and m.now < m.left + m.window
    x = m.x + positionX(m.now)
    guideRect(m.marker, x, 570, 4, 20 + (last - m.first + 1) * m.height, "0xE5484DFF")
    dot = CreateObject("roSGNode", "Poster")
    dot.uri = "pkg:/images/glass/dot.png" : dot.blendColor = "0xE5484DFF"
    dot.width = 24 : dot.height = 24 : dot.translation = [x - 10, 566]
    m.marker.appendChild(dot)
  end if
end sub

sub drawGuideInfo(channel as Object, block as Object)
  guideRect(m.info, 0, 0, 3520, 2, "0xFFFFFF22")
  guideLogo(m.info, asText(aaGet(channel, "logo", "")), 12, 96, 300, 180)
  guideLabel(m.info, block.title, 350, 28, 2660, 98, tvmFont("bold", 72), tvmText())
  range = clockText(block.from) + " – " + clockText(block.until)
  if m.now >= block.from and m.now < block.until and block.meta <> invalid then range = "NOW  ·  " + range
  category = asText(aaGet(block.meta, "category", ""))
  if category <> "" then range = range + "  ·  " + category
  guideLabel(m.info, range, 350, 126, 2250, 64, tvmFontLabel(), tvmMuted())
  desc = asText(aaGet(block.meta, "description", guideChannelName(channel)))
  description = guideLabel(m.info, desc, 350, 194, 2500, 160, tvmFontSecondary(), tvmMuted())
  description.wrap = true : description.maxLines = 2
  guideButton(m.info, 3000, 94, 520, "Watch", false)
end sub

sub guideEmit(kind as String, data = {} as Object)
  m.seq = m.seq + 1
  data.type = kind : data.seq = m.seq
  m.top.action = data
end sub

sub watchChannel(channel as Object)
  item = { id: channel.id, title: guideChannelName(channel), kind: "live", playable: true, source: aaGet(channel, "source", "") }
  guideEmit("play", { item: item })
end sub

sub guideDay(delta as Integer)
  m.day = m.day + delta
  if m.day > 1 then m.day = -1
  if m.day < -1 then m.day = 1
  m.start = m.now - (m.now mod 1800) + m.day * 86400
  m.end = m.start + 86400 : m.left = m.start : m.anchor = m.start
  guideEmit("guideWindow", { start: iso(m.start) })
end sub

sub guideHorizontal(direction as Integer)
  if m.rows.Count() = 0 then return
  selected = guideFocused(guideProgrammes(m.rows[m.row]))
  if direction < 0
    if selected.from <= m.left
      m.left = guideClamp(m.left - 1800, m.start, m.end - m.window)
      m.anchor = m.left
    else
      m.anchor = selected.from - 1
    end if
  else
    if selected.until >= m.left + m.window
      m.left = guideClamp(m.left + 1800, m.start, m.end - m.window)
      m.anchor = m.left + m.window - 1
    else
      m.anchor = selected.until
    end if
  end if
end sub

sub tuneChannel()
  number = Int(Val(m.digits))
  m.digits = ""
  for i = 0 to m.data.Count() - 1
    if aaGet(m.data[i], "number", i + 1) = number then watchChannel(m.data[i]) : exit for
  end for
  paintGuide()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  char = typedCharFromKey(key)
  if Len(char) = 1 and Instr(1, "0123456789", char) > 0
    m.digits = Right(m.digits + char, 4)
    m.tune.control = "stop" : m.tune.control = "start"
    paintGuide()
    return true
  end if
  intent = intentFromKey(key)
  if intent = "back" then return false
  if m.zone = "nav"
    if intent = "left" or intent = "right" then m.navCol = navStep(m.navCol, intent, tvmNavSpec().Count() + 1)
    if intent = "down" then m.zone = "tools"
    if intent = "select"
      if m.navCol >= tvmNavSpec().Count() then guideEmit("you") else guideEmit("nav", { id: tvmNavSpec()[m.navCol].id })
    end if
  else if m.zone = "tools"
    if intent = "up" then m.zone = "nav"
    if intent = "down" then m.zone = "grid"
    delta = 0
    if intent = "left" then delta = -1
    if intent = "right" then delta = 1
    m.tool = guideClamp(m.tool + delta, 0, 4)
    if intent = "select"
      if m.tool = 0 then guideDay(1)
      if m.tool = 1 then m.group = (m.group + 1) mod (m.groups.Count() + 2) : onFilter()
      if m.tool = 2 then guideEmit("guideSearch")
      if m.tool = 3 then guideEmit("channels")
      if m.tool = 4 then guideEmit("playlist")
    end if
  else
    if intent = "up" and m.row = 0 then m.zone = "tools"
    if intent = "up" and m.row > 0 then m.row = m.row - 1
    if intent = "down" then m.row = guideClamp(m.row + 1, 0, m.rows.Count() - 1)
    if intent = "rewind" or key = "channelup" or LCase(key) = "pageup" then m.row = guideClamp(m.row - 8, 0, m.rows.Count() - 1)
    if intent = "fastForward" or key = "channeldown" or LCase(key) = "pagedown" then m.row = guideClamp(m.row + 8, 0, m.rows.Count() - 1)
    if intent = "left" then guideHorizontal(-1)
    if intent = "right" then guideHorizontal(1)
    if (intent = "select" or intent = "play") and m.row < m.rows.Count() then watchChannel(m.rows[m.row])
    if intent = "previous" then m.day = -1 : guideDay(1)
  end if
  paintGuide()
  return true
end function

sub onRemoteIntent()
  key = keyFromIntent(m.top.remoteIntent)
  if key <> "" then onKeyEvent(key, true)
end sub
