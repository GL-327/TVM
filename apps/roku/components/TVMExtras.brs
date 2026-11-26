' Scene integration: optional data never replaces the main loading/error state.
sub loadDetailsExtras(item as Object)
  if not isMediaItem(item) then return
  m.detailsNode.extras = {}
  query = "?id=" + encodeQuery(asText(item.id))
  if asText(aaGet(item, "kind", "")) = "series"
    m.upcomingTask = startApiGet("local:/api/extras/upcoming" + query, "onDetailsUpcoming")
  else
    m.collectionTask = startApiGet("local:/api/extras/collection" + query, "onDetailsCollection")
  end if
  for each genre in aaArray(item, "genres")
    if LCase(genre) = "anime"
      m.animeTitleTask = startApiGet("local:/api/extras/anime-title?title=" + encodeQuery(asText(item.title)), "onDetailsAnime")
      exit for
    end if
  end for
end sub

function detailsExtrasCurrent(task as Object) as Boolean
  if m.detailsNode = invalid or task.profileId <> m.profileId or not task.ok then return false
  id = asText(aaGet(m.detailsNode.item, "id", ""))
  return Instr(1, task.requestUrl, "id=" + encodeQuery(id)) > 0
end function

sub onDetailsCollection(event as Object)
  task = event.GetRoSGNode()
  if not detailsExtrasCurrent(task) then return
  extras = m.detailsNode.extras
  extras.collection = task.json
  m.detailsNode.extras = extras
end sub

sub onDetailsUpcoming(event as Object)
  task = event.GetRoSGNode()
  if not detailsExtrasCurrent(task) then return
  extras = m.detailsNode.extras
  extras.next = aaGet(task.json, "next", invalid)
  m.detailsNode.extras = extras
end sub

sub onDetailsAnime(event as Object)
  task = event.GetRoSGNode()
  if m.detailsNode = invalid or not task.ok or task.profileId <> m.profileId then return
  if task.requestUrl <> "local:/api/extras/anime-title?title=" + encodeQuery(asText(aaGet(m.detailsNode.item, "title", ""))) then return
  extras = m.detailsNode.extras : extras.english = aaGet(task.json, "english", "")
  m.detailsNode.extras = extras
end sub

sub loadHomeExtras(payload as Object)
  candidates = []
  candidates.Append(aaArray(payload, "continueWatching"))
  candidates.Append(aaArray(payload, "watchlist"))
  m.homeExtrasTask = startApiRequest("local:/api/extras/upcoming/home", "POST", FormatJson({ items: candidates }), "onHomeExtras")
  if tvmExtraEnabled("surpriseMe")
    m.homeSurpriseTask = startApiGet("local:/api/extras/surprise", "onHomeSurprise")
  else if m.homeNode <> invalid
    m.homeNode.surpriseItem = invalid
  end if
end sub

sub onHomeSurprise(event as Object)
  task = event.GetRoSGNode()
  if task <> m.homeSurpriseTask or m.homeNode = invalid or task.profileId <> m.profileId then return
  if task.ok
    m.homeNode.surpriseItem = aaGet(task.json, "item", invalid)
  else
    m.homeNode.surpriseItem = invalid
  end if
end sub

sub onHomeExtras(event as Object)
  task = event.GetRoSGNode()
  if task <> m.homeExtrasTask or not task.ok or task.profileId <> m.profileId or m.homeNode = invalid then return
  payload = m.homeNode.payload
  rails = []
  for each rail in aaArray(payload, "rails")
    if rail.id <> "new-episodes" then rails.Push(rail)
  end for
  items = aaArray(task.json, "items")
  if items.Count() > 0 then rails.Unshift({ id: "new-episodes", title: "New episodes this week", items: items })
  payload.rails = rails
  m.homeNode.payload = payload
end sub

sub loadExtrasSettings()
  if m.prefsWrite <> invalid and not m.prefsWrite.done then return
  m.extrasSettingsTask = startApiGet("local:/api/prefs", "onExtrasSettings")
end sub

sub onExtrasSettings(event as Object)
  task = event.GetRoSGNode()
  if task <> m.extrasSettingsTask or task.profileId <> m.profileId then return
  if not task.ok
    m.settingsPrefsDeferred = invalid
    return
  end if
  previous = m.rokuExtrasPrefs
  m.rokuExtrasPrefs = task.json
  m.global.rokuPrefs = task.json
  if m.settingsNode <> invalid then m.settingsNode.extrasPrefs = task.json
  if m.homeNode <> invalid
    m.homeNode.callFunc("refreshHomePrefs")
    if tvmExtraEnabled("surpriseMe") and m.homeNode.surpriseItem = invalid then m.homeSurpriseTask = startApiGet("local:/api/extras/surprise", "onHomeSurprise")
    if aaGet(previous, "spotlightEvents", true) <> aaGet(task.json, "spotlightEvents", true) then loadEvents()
  end if
  if m.settingsPrefsDeferred <> invalid
    pending = m.settingsPrefsDeferred : m.settingsPrefsDeferred = invalid
    saveRokuPreference(pending)
  end if
end sub

sub changeExtrasSetting(kind as String)
  prefs = m.rokuExtrasPrefs
  if prefs = invalid then return
  body = {}
  if kind = "skipSegments"
    mode = asText(aaGet(prefs, "skipSegments", "button"))
    nextMode = "auto"
    if mode = "auto" then nextMode = "off"
    if mode = "off" then nextMode = "button"
    body.skipSegments = nextMode
  else if kind = "autoplayNext"
    body.autoplayNext = not aaGet(prefs, "autoplayNext", true)
  else if kind = "subtitleLanguages"
    showKeyboard("subtitleLanguages", "Subtitle languages (e.g. eng,spa,fra)", aaArray(prefs, "subtitleLanguages").Join(","), "Save")
    return
  end if
  saveRokuPreference(body)
end sub

sub saveExtrasLanguages(text as String)
  languages = []
  for each language in LCase(text).Tokenize(", ")
    if CreateObject("roRegex", "^[a-z]{3}$", "").IsMatch(language) then languages.Push(language)
    if languages.Count() >= 8 then exit for
  end for
  if languages.Count() = 0 then languages = ["eng"]
  saveRokuPreference({ subtitleLanguages: languages, subtitleLanguage: languages[0] })
end sub

sub loadYourStats()
  m.statsTask = startApiGet("local:/api/extras/stats", "onYourStats")
end sub

function statsHours(seconds as Dynamic) as String
  return (Int(seconds / 360) / 10.0).ToStr() + " hours"
end function

sub onYourStats(event as Object)
  task = event.GetRoSGNode()
  if not task.ok or task.profileId <> m.profileId or not m.featureNodes.DoesExist("stats") then return
  data = task.json
  summary = "This week: " + statsHours(aaGet(data, "week", 0)) + Chr(10) + "This month: " + statsHours(aaGet(data, "month", 0)) + Chr(10) + "All time: " + statsHours(aaGet(data, "all", 0)) + Chr(10) + asText(aaGet(data, "finished", 0)) + " titles finished" + Chr(10) + "Current streak: " + asText(aaGet(data, "streakDays", 0)) + " days"
  genres = []
  for each genre in aaArray(data, "topGenres")
    genres.Push(genre.genre + ": " + statsHours(genre.seconds))
    if genres.Count() >= 5 then exit for
  end for
  rows = [{ id: "summary", label: "Your stats", body: summary + Chr(10) + Chr(10) + "Top genres" + Chr(10) + genres.Join(Chr(10)) + Chr(10) + Chr(10) + "Only on this Roku, for this profile. Dates use UTC. Week: last 7 days. Month: last 30 days." }]
  for each history in aaArray(data, "history")
    dt = CreateObject("roDateTime") : dt.FromSeconds(history.at)
    rows.Push({ id: history.item.id, label: history.item.title, body: history.item.title + Chr(10) + Left(dt.ToISOString(), 10) + Chr(10) + statsHours(history.seconds) })
  end for
  rows.Push({ id: "clear-history", label: "Clear history", body: "Clear this profile's watch history and statistics on this Roku. OK: review and confirm." })
  m.featureNodes.stats.rows = rows
end sub

sub clearYourStats()
  m.statsTask = startApiRequest("local:/api/extras/stats/clear", "POST", "{}", "onYourStats")
end sub

sub saveRokuPreference(body as Object)
  if m.prefsWrite <> invalid and not m.prefsWrite.done
    if m.settingsPrefsDeferred = invalid then m.settingsPrefsDeferred = {}
    for each key in body
      if (key = "extras" or key = "subtitleStyle") and m.settingsPrefsDeferred.DoesExist(key)
        for each name in body[key]
          m.settingsPrefsDeferred[key][name] = body[key][name]
        end for
      else
        m.settingsPrefsDeferred[key] = body[key]
      end if
    end for
    return
  end if
  m.prefsWrite = startApiRequest("local:/api/prefs", "PUT", FormatJson(body), "onExtrasSettings")
  m.extrasSettingsTask = m.prefsWrite
  if m.coreUrl <> "" then m.pairedPrefsWrite = startApiRequest(joinCorePath(m.coreUrl, "/api/prefs"), "PUT", FormatJson(body), "onPairedPrefs")
end sub

sub onPairedPrefs()
end sub

sub choosePreference(row as Object)
  choices = []
  for i = 0 to row.values.Count() - 1
    choices.Push({ id: row.id, label: row.labels[i], body: row.body, value: row.values[i], scope: row.type })
  end for
  navigate("push", "setting-options", { heading: row.label, rows: choices })
end sub

sub setPreferenceFromAction(action as Object)
  key = asText(aaGet(action, "key", ""))
  if key = "" then return
  value = action.value
  fields = {} : fields[key] = value
  scope = asText(aaGet(action, "scope", ""))
  if scope = "extras" or scope = "subtitleStyle"
    body = {} : body[scope] = fields
    saveRokuPreference(body)
  else
    saveRokuPreference(fields)
  end if
end sub

sub changeHomeSection(id as String, delta as Integer)
  rows = m.settingsNode.homeRows
  saved = {}
  for each row in aaArray(m.rokuExtrasPrefs, "homeSections")
    saved[row.id] = aaGet(row, "visible", true)
  end for
  flags = [] : index = -1
  for each row in rows
    if row.id = id then index = flags.Count()
    flags.Push({ id: row.id, visible: aaGet(saved, row.id, true) })
  end for
  if index < 0 then return
  if delta = 0
    flags[index].visible = not flags[index].visible
  else
    target = index + delta
    if target < 0 or target >= flags.Count() then return
    value = flags[target] : flags[target] = flags[index] : flags[index] = value
  end if
  saveRokuPreference({ homeSections: flags })
end sub
