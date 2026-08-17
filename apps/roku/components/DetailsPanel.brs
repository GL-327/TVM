sub init()
  m.top.focusable = true
  m.backdrop = m.top.findNode("backdrop")
  m.backdropFill = m.top.findNode("backdropFill")
  m.poster = m.top.findNode("poster")
  m.posterFill = m.top.findNode("posterFill")
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
  m.kicker.font = tvmFontCaption()
  m.title.font = tvmFontDisplay()
  m.imdb.font = tvmFont("bold", 36)
  m.meta.font = tvmFontCaption()
  m.synopsis.font = tvmFontBody()
  m.play.variant = "primary"
  m.play.label = "Play"
  m.imdbBtn.variant = "glass"
  m.imdbBtn.label = "IMDb"
  m.save.variant = "glass"
  m.save.label = "Add to My List"
  m.back.variant = "glass"
  m.back.label = "Back"
  m.seq = 0
  m.zone = "actions"
  m.col = 0
  m.seasonCol = 0
  m.episodeCol = 0
  m.season = 0
  m.seasons = []
  m.episodes = []
  m.seasonBtns = []
  m.seriesLike = false
  paintFocus()
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

  kind = LCase(asText(aaGet(item, "kind", "movie")))
  m.seriesLike = (kind = "series")
  if m.seriesLike
    m.kicker.text = "SERIES"
    m.play.visible = false
    m.imdbBtn.label = "Series Graph"
    m.imdbBtn.translation = [584, 780]
    m.save.translation = [1120, 780]
    m.back.translation = [1656, 780]
  else
    m.kicker.text = "FILM"
    m.play.visible = true
    if hasProgress(item)
      m.play.label = "Resume"
    else
      m.play.label = "Play"
    end if
    m.imdbBtn.label = "IMDb"
    m.imdbBtn.translation = [1120, 780]
    m.save.translation = [1656, 780]
    m.back.translation = [2192, 780]
  end if

  m.title.text = aaGet(item, "title", "Title")
  rating = asText(aaGet(item, "rating", ""))
  score = imdbScoreText(rating)
  if score <> ""
    m.imdb.text = "IMDb " + score
    m.imdb.visible = true
    m.meta.translation = [1024, 680]
  else
    m.imdb.text = ""
    m.imdb.visible = false
    m.meta.translation = [584, 680]
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

  poster = aaGet(item, "poster", "")
  if poster = "" then poster = aaGet(item, "backdrop", "")
  if poster <> ""
    m.poster.uri = poster
    m.poster.visible = true
    m.posterFill.visible = false
  else
    m.poster.uri = ""
    m.poster.visible = false
    m.posterFill.visible = true
  end if
  onSaved()
  onChildren()
end sub

sub onSaved()
  if m.save = invalid then return
  if m.top.saved = true
    m.save.label = "Remove from My List"
  else
    m.save.label = "Add to My List"
  end if
end sub

sub onChildren()
  if m.picker = invalid then return
  while m.picker.getChildCount() > 0
    m.picker.removeChildIndex(0)
  end while
  m.seasonBtns = []
  m.episodeRail = invalid
  items = m.top.children
  m.seasons = seasonNumbers(items)
  if m.seriesLike <> true or m.seasons.Count() = 0 then return

  heading = CreateObject("roSGNode", "Label")
  heading.text = "Seasons"
  heading.color = tvmText()
  heading.font = tvmFontBodyLg()
  m.picker.appendChild(heading)

  i = 0
  while i < m.seasons.Count()
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "season"
    btn.label = "Season " + StrI(m.seasons[i]).Trim()
    btn.translation = [0, 48 + (i * 76)]
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

function actionCount() as Integer
  if m.seriesLike then return 3
  return 4
end function

sub paintFocus()
  count = actionCount()
  if m.seriesLike
    m.play.hasFocusStyle = false
    m.imdbBtn.hasFocusStyle = (m.zone = "actions" and m.col = 0)
    m.save.hasFocusStyle = (m.zone = "actions" and m.col = 1)
    m.back.hasFocusStyle = (m.zone = "actions" and m.col = 2)
  else
    m.play.hasFocusStyle = (m.zone = "actions" and m.col = 0)
    m.imdbBtn.hasFocusStyle = (m.zone = "actions" and m.col = 1)
    m.save.hasFocusStyle = (m.zone = "actions" and m.col = 2)
    m.back.hasFocusStyle = (m.zone = "actions" and m.col = 3)
  end if

  i = 0
  while i < m.seasonBtns.Count()
    m.seasonBtns[i].hasFocusStyle = (m.zone = "seasons" and m.seasonCol = i)
    i = i + 1
  end while
  if m.episodeRail <> invalid
    if m.zone = "episodes"
      m.episodeRail.focusCol = m.episodeCol
    else
      m.episodeRail.focusCol = -1
    end if
  end if
end sub

sub showEpisodes(season as Integer)
  m.season = season
  m.episodes = episodesForSeason(m.top.children, season)
  while m.picker.getChildCount() > 0
    m.picker.removeChildIndex(0)
  end while
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
  rail.translation = [0, 90]
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
    if m.zone = "episodes"
      onChildren()
      m.zone = "seasons"
      paintFocus()
      return true
    end if
    return false
  end if

  if m.zone = "actions"
    maxCol = actionCount() - 1
    if intent = "left" and m.col > 0 then m.col = m.col - 1
    if intent = "right" and m.col < maxCol then m.col = m.col + 1
    if intent = "down" and m.seriesLike and m.seasonBtns.Count() > 0
      m.zone = "seasons"
      m.seasonCol = 0
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
      if m.seasonsBack <> invalid then m.seasonsBack.hasFocusStyle = true
      if m.episodeRail <> invalid then m.episodeRail.focusCol = -1
      return true
    end if
    if intent = "left" and count > 0
      if m.episodeCol > 0 then m.episodeCol = m.episodeCol - 1 else m.episodeCol = count - 1
    end if
    if intent = "right" and count > 0
      if m.episodeCol < count - 1 then m.episodeCol = m.episodeCol + 1 else m.episodeCol = 0
    end if
    if intent = "select" and count > 0
      emit("play", { item: m.episodes[m.episodeCol] })
    end if
    paintFocus()
    return true
  end if

  if m.zone = "seasonsBack"
    if intent = "down"
      m.zone = "episodes"
      if m.seasonsBack <> invalid then m.seasonsBack.hasFocusStyle = false
    end if
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
  if m.seriesLike
    if m.col = 0 then emit("notice", { title: "Series Graph", body: "Open Series Graph on the TVM computer. This Roku catalog is TVM Stream, not the licensed site." })
    if m.col = 1 then emit("save", invalid)
    if m.col = 2 then emit("close", invalid)
    return
  end if
  if m.col = 0 then emit("play", invalid)
  if m.col = 1 then emit("notice", { title: "IMDb", body: "Title pages open in the TVM computer browser. This Roku stays in TVM." })
  if m.col = 2 then emit("save", invalid)
  if m.col = 3 then emit("close", invalid)
end sub
