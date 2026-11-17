' Details: full-bleed hero art with glass Play/Resume, IMDb, My List and Back
' pills, then synopsis, and for series a season picker and episode rail.
' The panel is a singleton, so onItem resets zone and columns whenever the item
' id changes. focusKey/restoreKey use ids so Back from the player (or from an
' episode list) lands on the same control:
'   actions:<actionId>, seasons:<n>, seasonsBack:<n>, episodes:<n>:<episodeId>
sub init()
  m.top.focusable = true
  m.backdrop = m.top.findNode("backdrop")
  m.backdropFill = m.top.findNode("backdropFill")
  m.kicker = m.top.findNode("kicker")
  m.title = m.top.findNode("title")
  m.imdb = m.top.findNode("imdb")
  m.meta = m.top.findNode("meta")
  m.synopsis = m.top.findNode("synopsis")
  m.play = m.top.findNode("play")
  m.imdbBtn = m.top.findNode("imdbBtn")
  m.save = m.top.findNode("save")
  m.back = m.top.findNode("back")
  m.picker = m.top.findNode("picker")
  m.kicker.font = tvmFontMeta()
  m.title.font = tvmFontScreenTitle()
  m.imdb.font = tvmFont("bold", tvmTypeSize(tvmTypeSecondary()))
  m.meta.font = tvmFontSecondary()
  m.synopsis.font = tvmFontSecondary()
  m.play.variant = "glassPill"
  m.play.accent = true
  m.play.pillWidth = 400
  m.play.label = "Play"
  m.imdbBtn.variant = "glassPill"
  m.imdbBtn.pillWidth = 380
  m.imdbBtn.label = "IMDb"
  m.save.variant = "glassPill"
  m.save.pillWidth = 520
  m.save.label = "My List"
  m.back.variant = "glassPill"
  m.back.pillWidth = 340
  m.back.label = "Back"
  m.seq = 0
  m.itemId = ""
  m.zone = "actions"
  m.col = 0
  m.seasonCol = 0
  m.episodeCol = 0
  m.season = 0
  m.seasons = []
  m.episodes = []
  m.seasonBtns = []
  m.seasonsBack = invalid
  m.episodeRail = invalid
  m.seriesLike = false
  m.actions = []
  buildActions()
  paintFocus()
end sub

sub buildActions()
  m.actions = []
  if not m.seriesLike then m.actions.Push({ id: "play", node: m.play })
  m.actions.Push({ id: "imdb", node: m.imdbBtn })
  m.actions.Push({ id: "save", node: m.save })
  m.actions.Push({ id: "back", node: m.back })
  m.play.visible = not m.seriesLike
  x = 160
  for each entry in m.actions
    entry.node.translation = [x, 830]
    x = x + entry.node.pillWidth + 40
  end for
  if m.col > m.actions.Count() - 1 then m.col = m.actions.Count() - 1
end sub

sub resetForItem()
  m.zone = "actions"
  m.col = 0
  m.seasonCol = 0
  m.episodeCol = 0
  m.season = 0
  m.episodes = []
  m.seasons = []
  m.seasonBtns = []
  m.seasonsBack = invalid
  m.episodeRail = invalid
  clearPicker()
end sub

sub clearPicker()
  if m.picker = invalid then return
  while m.picker.getChildCount() > 0
    m.picker.removeChildIndex(0)
  end while
  m.picker.translation = [160, 1330]
end sub

sub onItem()
  item = m.top.item
  if not isMediaItem(item)
    m.kicker.text = ""
    m.title.text = "Title"
    m.imdb.text = ""
    m.meta.text = ""
    m.synopsis.text = ""
    return
  end if

  newId = asText(aaGet(item, "id", ""))
  idChanged = (newId <> m.itemId)
  if idChanged
    m.itemId = newId
    resetForItem()
  end if

  kind = LCase(asText(aaGet(item, "kind", "movie")))
  wasSeries = m.seriesLike
  m.seriesLike = (kind = "series")
  if m.seriesLike
    m.kicker.text = "SERIES"
    m.imdbBtn.pillWidth = 640
    m.imdbBtn.label = "Series Graph"
  else
    m.kicker.text = "FILM"
    if hasProgress(item)
      m.play.label = "Resume"
    else
      m.play.label = "Play"
    end if
    m.imdbBtn.pillWidth = 380
    m.imdbBtn.label = "IMDb"
  end if
  buildActions()

  m.title.text = aaGet(item, "title", "Title")
  rating = asText(aaGet(item, "rating", ""))
  score = imdbScoreText(rating)
  if score <> ""
    m.imdb.text = "IMDb " + score
    m.imdb.visible = true
    m.meta.translation = [600, 710]
  else
    m.imdb.text = ""
    m.imdb.visible = false
    m.meta.translation = [160, 710]
  end if

  year = aaGet(item, "year", invalid)
  runtime = asText(aaGet(item, "runtime", ""))
  bits = []
  cert = certificateText(rating)
  if cert <> "" then bits.Push(cert)
  yearText = asText(year)
  if yearText <> "" and yearText <> "0" then bits.Push(yearText)
  if score = "" and rating <> "" then bits.Push(rating)
  if runtime <> "" then bits.Push(runtime)
  m.meta.text = joinBits(bits)
  m.synopsis.text = aaGet(item, "synopsis", "")

  art = preferHeroUri(item)
  if art <> ""
    m.backdrop.uri = art
    m.backdrop.visible = true
    m.backdropFill.visible = false
  else
    m.backdrop.uri = ""
    m.backdrop.visible = false
    m.backdropFill.visible = true
  end if
  onSaved()
  ' The picker is only rebuilt for a new title or when the kind flips, so a
  ' re-delivered item (renderStack after the player closes) keeps its episodes.
  if idChanged or wasSeries <> m.seriesLike then onChildren()
  paintFocus()
end sub

sub onSaved()
  if m.save = invalid then return
  if m.top.saved = true
    m.save.label = "In My List"
  else
    m.save.label = "My List"
  end if
end sub

sub onChildren()
  if m.picker = invalid then return
  clearPicker()
  m.seasonBtns = []
  m.episodeRail = invalid
  m.seasonsBack = invalid
  items = m.top.children
  m.seasons = seasonNumbers(items)
  if m.seriesLike <> true or m.seasons.Count() = 0 then return

  heading = CreateObject("roSGNode", "Label")
  heading.text = "Seasons"
  heading.color = tvmText()
  heading.font = tvmFontLabel()
  m.picker.appendChild(heading)

  i = 0
  while i < m.seasons.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "season"
    btn.label = "Season " + StrI(m.seasons[i]).Trim()
    btn.translation = [0, 100 + (i * 160)]
    m.picker.appendChild(btn)
    m.seasonBtns.Push(btn)
    i = i + 1
  end while
  paintFocus()
end sub

function joinBits(bits as Object) as String
  if bits.Count() = 0 then return ""
  text = bits[0]
  i = 1
  while i < bits.Count()
    text = text + "  ·  " + bits[i]
    i = i + 1
  end while
  return text
end function

function currentActionId() as String
  if m.col < 0 or m.col >= m.actions.Count() then return ""
  return m.actions[m.col].id
end function

sub paintFocus()
  i = 0
  while i < m.actions.Count()
    m.actions[i].node.hasFocusStyle = (m.zone = "actions" and m.col = i)
    i = i + 1
  end while

  i = 0
  while i < m.seasonBtns.Count()
    m.seasonBtns[i].hasFocusStyle = (m.zone = "seasons" and m.seasonCol = i)
    i = i + 1
  end while
  if m.zone = "seasons" and m.seasonCol > 3
    m.picker.translation = [160, 1330 - ((m.seasonCol - 3) * 160)]
  else if m.zone <> "episodes" and m.zone <> "seasonsBack"
    m.picker.translation = [160, 1330]
  end if
  if m.seasonsBack <> invalid then m.seasonsBack.hasFocusStyle = (m.zone = "seasonsBack")
  if m.episodeRail <> invalid
    if m.zone = "episodes"
      m.episodeRail.focusCol = m.episodeCol
    else
      m.episodeRail.focusCol = -1
    end if
  end if
  rememberFocus()
end sub

sub rememberFocus()
  if m.zone = "actions"
    m.top.focusKey = "actions:" + currentActionId()
  else if m.zone = "seasons" and m.seasonCol < m.seasons.Count()
    m.top.focusKey = "seasons:" + StrI(m.seasons[m.seasonCol]).Trim()
  else if m.zone = "seasonsBack"
    m.top.focusKey = "seasonsBack:" + StrI(m.season).Trim()
  else if m.zone = "episodes" and m.episodeCol < m.episodes.Count()
    episodeId = asText(aaGet(m.episodes[m.episodeCol], "id", ""))
    m.top.focusKey = "episodes:" + StrI(m.season).Trim() + ":" + episodeId
  end if
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  parsed = parseFocusKey(key)
  if parsed.zone = "actions"
    i = 0
    while i < m.actions.Count()
      if m.actions[i].id = parsed.a
        m.zone = "actions"
        m.col = i
      end if
      i = i + 1
    end while
  else if parsed.zone = "seasons"
    i = 0
    while i < m.seasons.Count()
      if StrI(m.seasons[i]).Trim() = parsed.a
        m.zone = "seasons"
        m.seasonCol = i
      end if
      i = i + 1
    end while
  else if parsed.zone = "episodes" or parsed.zone = "seasonsBack"
    seasonNo = Int(Val(parsed.a))
    if parsed.zone = "episodes"
      second = Instr(1, parsed.a, ":")
      if second > 0 then seasonNo = Int(Val(Left(parsed.a, second - 1)))
    end if
    if m.seriesLike and m.seasons.Count() > 0
      if m.zone <> "episodes" and m.zone <> "seasonsBack" or m.season <> seasonNo then showEpisodes(seasonNo)
      if parsed.zone = "episodes"
        second = Instr(1, parsed.a, ":")
        wanted = Mid(parsed.a, second + 1)
        j = 0
        while j < m.episodes.Count()
          if asText(aaGet(m.episodes[j], "id", "")) = wanted then m.episodeCol = j
          j = j + 1
        end while
        m.zone = "episodes"
      else
        m.zone = "seasonsBack"
      end if
    end if
  end if
  paintFocus()
end sub

sub showEpisodes(season as Integer)
  m.season = season
  m.episodes = episodesForSeason(m.top.children, season)
  clearPicker()
  m.seasonBtns = []
  back = CreateObject("roSGNode", "FocusButton")
  back.variant = "glass"
  back.label = "All seasons"
  m.picker.appendChild(back)
  m.seasonsBack = back
  rail = CreateObject("roSGNode", "PosterRail")
  rail.title = "Season " + StrI(season).Trim()
  rail.layout = "landscape"
  rail.items = m.episodes
  rail.translation = [0, 190]
  m.picker.appendChild(rail)
  m.episodeRail = rail
  m.zone = "episodes"
  m.episodeCol = 0
  paintFocus()
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq, item: m.top.item }
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
  if intent = "" then return true
  if intent = "back"
    if m.zone = "episodes" or m.zone = "seasonsBack"
      onChildren()
      m.zone = "seasons"
      paintFocus()
      return true
    end if
    return false
  end if

  if m.zone = "actions"
    maxCol = m.actions.Count() - 1
    if intent = "left" and m.col > 0 then m.col = m.col - 1
    if intent = "right" and m.col < maxCol then m.col = m.col + 1
    if intent = "down" and m.seriesLike and m.seasonBtns.Count() > 0
      m.zone = "seasons"
    end if
    if intent = "select" then activateAction()
    paintFocus()
    return true
  end if

  if m.zone = "seasons"
    if intent = "up"
      if m.seasonCol > 0
        m.seasonCol = m.seasonCol - 1
      else
        m.zone = "actions"
      end if
    end if
    if intent = "down" and m.seasonCol < m.seasonBtns.Count() - 1 then m.seasonCol = m.seasonCol + 1
    if intent = "select" then showEpisodes(m.seasons[m.seasonCol])
    paintFocus()
    return true
  end if

  if m.zone = "episodes"
    count = m.episodes.Count()
    if intent = "up"
      m.zone = "seasonsBack"
      paintFocus()
      return true
    end if
    if intent = "left" and m.episodeCol > 0 then m.episodeCol = m.episodeCol - 1
    if intent = "right" and m.episodeCol < count - 1 then m.episodeCol = m.episodeCol + 1
    if intent = "select" and count > 0
      emit("play", { item: m.episodes[m.episodeCol] })
    end if
    paintFocus()
    return true
  end if

  if m.zone = "seasonsBack"
    if intent = "down" then m.zone = "episodes"
    if intent = "select"
      onChildren()
      m.zone = "seasons"
    end if
    paintFocus()
    return true
  end if
  return true
end function

sub activateAction()
  id = currentActionId()
  if id = "" then return
  m.actions[m.col].node.pressed = true
  if id = "play" then emit("play", invalid)
  if id = "imdb"
    if m.seriesLike
      emit("notice", { title: "Series Graph", body: "Open Series Graph on the TVM computer. This Roku catalog is TVM Stream, not the licensed site." })
    else
      emit("notice", { title: "IMDb", body: "Title pages open in the TVM computer browser. This Roku stays in TVM." })
    end if
  end if
  if id = "save" then emit("save", invalid)
  if id = "back" then emit("close", invalid)
end sub

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
