' Scene-owned feature navigation. All I/O still runs on ApiTask.
function featureName(name as String) as Boolean
  return name = "services" or name = "changelog" or name = "reviews" or name = "profile-edit" or name = "avatar-sets" or name = "avatars" or name = "adult-profiles"
end function

function uiContent(name as String) as Object
  cached = ParseJson(ReadAsciiFile("tmp:/tvm_content_" + name + ".json"))
  if cached = invalid then cached = ParseJson(ReadAsciiFile("cachefs:/tvm_v11_content_" + name + ".json"))
  if cached <> invalid then return cached
  bundled = ParseJson(ReadAsciiFile("pkg:/source/data/content/" + name + ".json"))
  if bundled = invalid then return {}
  return bundled
end function

sub ensureFeature(name as String)
  if m.featureNodes.DoesExist(name) then return
  node = CreateObject("roSGNode", "FeatureScreen")
  node.observeField("action", "onFeatureAction")
  m.screenHost.appendChild(node)
  m.featureNodes[name] = node
end sub

sub loadFeature(name as String, params as Object)
  node = m.featureNodes[name]
  node.rows = [{ id: "loading", label: "Loading", body: "Loading…" }]
  if name = "services"
    node.heading = "Your services"
    m.servicesTitle = asText(aaGet(params, "title", ""))
    m.servicesTask = startApiGet(joinCorePath(m.coreUrl, "/api/services"), "onServicesLoaded")
  else if name = "changelog"
    node.heading = "What's new"
    m.changelogTask = startApiGet(joinCorePath(m.coreUrl, "/api/changelog"), "onChangelogLoaded")
  else if name = "reviews"
    node.heading = "IMDb and reviews"
    item = aaGet(params, "item", {})
    m.reviewId = asText(aaGet(item, "id", "")).Tokenize(":")[0]
    node.rows = [{ id: "imdb", label: "Read on IMDb", body: "IMDb " + asText(aaGet(item, "imdbRating", aaGet(item, "rating", ""))) + "/10" + Chr(10) + "imdb.com/title/" + m.reviewId + Chr(10) + "Read reviews on IMDb. Loading film reviews…" }]
    m.reviewsTask = startApiGet(joinCorePath(m.coreUrl, "/api/reviews?id=" + encodeQuery(m.reviewId)), "onReviewsLoaded")
  else if name = "profile-edit"
    paintProfileEditor()
  else if name = "avatar-sets"
    paintAvatarSets()
  else if name = "avatars"
    paintAvatars(asText(aaGet(params, "setId", "")))
  else if name = "adult-profiles"
    rows = []
    for each p in aaArray(m.profilesNode.registry, "profiles")
      if aaGet(p, "kind", "standard") = "standard" and aaGet(p, "locked", false) = true then rows.Push({ id: p.id, label: p.name, body: "Enter this adult profile's PIN to turn off the kids profile setting.", profile: p })
    end for
    node.heading = "Choose an adult profile"
    node.rows = rows
  end if
end sub

sub onServicesLoaded()
  task = m.servicesTask
  if task = invalid then return
  rows = []
  if task.ok
    m.servicesData = aaArray(task.json, "services")
    for each service in m.servicesData
      include = m.servicesTitle = "" or aaGet(service, "connected", false) = true
      if asText(aaGet(service, "roku", "")) <> "" and include
        state = "I use this: No"
        if aaGet(service, "connected", false) = true then state = "I use this: Yes"
        body = service.name + Chr(10) + state + Chr(10) + "Sign in inside the service's own Roku channel. TVM never sees your password." + Chr(10) + "Options (*) changes I use this. OK opens the channel."
        if m.servicesTitle <> "" then body = "Look for it on " + service.name + Chr(10) + m.servicesTitle + Chr(10) + "OK: Find on Roku. This searches Roku; availability depends on the service."
        rows.Push({ id: service.id, label: service.name, body: body, service: service })
      end if
    end for
  else
    rows.Push({ id: "retry-services", label: "Retry", body: "Services could not load. Press OK to try again." })
  end if
  if rows.Count() = 0 then rows.Push({ id: "none", label: "No services", body: "There are no Roku channels in the current service list." })
  m.featureNodes.services.rows = rows
end sub

sub launchService(service as Object, title = "" as String)
  m.ecpService = service
  m.ecpTask = startApiRequest("local:/api/roku/ecp", "POST", FormatJson({ id: service.id, title: title }), "onEcpDone")
end sub

sub onEcpDone()
  task = m.ecpTask
  if task = invalid then return
  if not task.ok
    navigate("modal", "notice", { title: "Open " + m.ecpService.name, body: task.error })
  else if not aaGet(m.ecpService, "connected", false)
    navigate("modal", "confirm", { title: "Signed in to " + m.ecpService.name + "?", body: "TVM remembers your choice for this profile.", confirmLabel: "Yes, I use this", cancelLabel: "Not yet", confirmId: "service-connected:" + m.ecpService.id })
  end if
end sub

sub markService(id as String, connected as Boolean)
  m.servicesTask = startApiRequest(joinCorePath(m.coreUrl, "/api/services/connected"), "POST", FormatJson({ id: id, connected: connected }), "onServicesLoaded")
end sub

sub onChangelogLoaded()
  task = m.changelogTask
  if task = invalid then return
  releases = aaArray(task.json, "releases")
  if not task.ok then releases = aaArray(uiContent("changelog"), "releases")
  rows = []
  for each release in releases
    lines = [release.title, asText(aaGet(release, "date", "")), ""]
    for each highlight in aaArray(release, "highlights")
      lines.Push(highlight)
    end for
    areas = [] : grouped = {}
    for each change in aaArray(release, "changes")
      platforms = aaGet(change, "platforms", invalid)
      show = (platforms = invalid)
      if Type(platforms) = "roArray"
        for each platform in platforms
          if LCase(platform) = "roku" then show = true
        end for
      end if
      if show
        area = asText(aaGet(change, "area", "TVM"))
        if not grouped.DoesExist(area)
          areas.Push(area) : grouped[area] = []
        end if
        grouped[area].Push(change.text)
      end if
    end for
    for each area in areas
      lines.Push(Chr(10) + area)
      lines.Append(grouped[area])
    end for
    rows.Push({ id: release.version, label: release.version, body: lines.Join(Chr(10)) })
  end for
  m.featureNodes.changelog.rows = rows
end sub

sub onReviewsLoaded()
  task = m.reviewsTask
  if task = invalid or not m.featureNodes.DoesExist("reviews") then return
  rows = [{ id: "imdb", label: "Read on IMDb", body: "imdb.com/title/" + m.reviewId + Chr(10) + "Read reviews on IMDb." }]
  if task.ok
    for each review in aaArray(task.json, "reviews")
      score = ""
      stars = aaGet(review, "stars", invalid)
      if stars <> invalid then score = stars.ToStr() + " / 5 stars"
      rows.Push({ id: "review" + StrI(rows.Count()).Trim(), label: asText(aaGet(review, "author", "Review")), body: "Letterboxd review" + Chr(10) + score + Chr(10) + asText(aaGet(review, "text", "")) + Chr(10) + "More reviews: imdb.com/title/" + m.reviewId })
      if rows.Count() >= 4 then exit for
    end for
  end if
  m.featureNodes.reviews.rows = rows
end sub

sub chooseProfile(kind as String, id as String)
  profile = invalid
  for each p in aaArray(m.profilesNode.registry, "profiles")
    if p.id = id then profile = p
  end for
  if profile = invalid then return
  if aaGet(profile, "locked", false) = true
    m.pinContext = { mode: kind, profile: profile }
    navigate("modal", "pin", { title: "PIN for " + profile.name })
  else if kind = "switch"
    switchProfile(id)
  else
    openProfileEditor(profile, "")
  end if
end sub

sub showPin(params as Object)
  panel = CreateObject("roSGNode", "PinPanel")
  panel.heading = asText(aaGet(params, "title", "Profile PIN"))
  panel.message = "Enter four digits, then choose Done. Back cancels."
  panel.observeField("action", "onPinAction")
  m.overlayHost.appendChild(panel)
  m.pinNode = panel
  panel.setFocus(true)
end sub

sub onPinAction()
  if m.pinNode = invalid then return
  pin = asText(aaGet(m.pinNode.action, "pin", ""))
  if m.pinContext.mode = "set"
    m.editorPin = pin
    m.editorPinChanged = true
    navigate("pop", "", {})
    paintProfileEditor()
    return
  end if
  ctx = m.pinContext
  ctx.pin = pin
  path = "/api/profiles/verify-pin"
  if ctx.mode = "switch" then path = "/api/profiles/active"
  m.pinTask = startApiRequest(joinCorePath(m.coreUrl, path), "POST", FormatJson({ id: ctx.profile.id, pin: pin }), "onProfilePinDone")
end sub

sub onProfilePinDone()
  task = m.pinTask
  if task = invalid or not overlayIs("PinPanel") then return
  if not task.ok
    retry = aaGet(task.json, "retryAfter", 0)
    m.pinNode.message = "That PIN is incorrect. Try again."
    if retry > 0 then m.pinNode.cooldown = retry
    m.pinNode.wrong = true
    return
  end if
  ctx = m.pinContext
  navigate("pop", "", {})
  if ctx.mode = "switch"
    m.mutateTask = task
    onSwitchProfileDone()
  else if ctx.mode = "adult"
    m.editorAdultPin = ctx.pin : m.editorAdultId = ctx.profile.id
    m.editorProfile.kind = "standard"
    navigate("pop", "", {})
    paintProfileEditor()
  else
    openProfileEditor(ctx.profile, ctx.pin)
  end if
end sub

sub openProfileEditor(profile as Object, pin as String)
  m.editorProfile = {}
  for each key in profile
    m.editorProfile[key] = profile[key]
  end for
  m.editorCurrentPin = pin
  m.editorPin = invalid : m.editorPinChanged = false
  m.editorAdultPin = "" : m.editorAdultId = ""
  navigate("push", "profile-edit", {})
end sub

sub paintProfileEditor()
  p = m.editorProfile
  if p = invalid then return
  node = m.featureNodes["profile-edit"]
  node.heading = "Edit profile"
  kids = "Off"
  if aaGet(p, "kind", "standard") = "kids" then kids = "On"
  age = aaGet(p, "maxAge", 18)
  ageLabel = "No limit"
  if age < 18 then ageLabel = "Up to " + asText(age)
  pinLabel = "Set PIN"
  if aaGet(p, "locked", false) = true then pinLabel = "Change PIN"
  rows = [
    { id: "name", label: "Name: " + p.name, body: "Choose the name shown on the profile chooser." }
    { id: "avatar", label: "Character picture", body: "Pick a character, or keep the colour and initial." }
    { id: "kids", label: "Kids: " + kids, body: "Kids profiles start at Up to 7. Settings and Account are hidden. Switching profile stays available." }
    { id: "age", label: ageLabel, body: "Filters by genre. Choose Up to 7, Up to 12, Up to 15 or No limit. These are genre filters, not official age certificates." }
    { id: "pin", label: pinLabel, body: "Four digits protect switching to and editing this profile. Five wrong PINs pause entry for 60 seconds." }
    { id: "remove-pin", label: "Remove PIN", body: "Removes the lock when you save this profile." }
    { id: "save-profile", label: "Save profile", body: "Save the changes on this Roku, or on the paired Core when one is in use." }
    { id: "delete-profile", label: "Delete profile", body: "Delete this profile and its saved progress. You must keep at least one profile." }
  ]
  node.rows = rows
end sub

sub paintAvatarSets()
  featured = ""
  dt = CreateObject("roDateTime") : dt.ToLocalTime() : today = Left(dt.ToISOString(), 10)
  for each event in aaArray(uiContent("events"), "events")
    if today >= event.start and today <= event.end then featured = event.avatarSet
  end for
  rows = [{ id: "initial", label: "Colour and initial", body: "Use the profile colour and its first letter." }]
  sets = aaArray(uiContent("avatars"), "sets")
  for each set in sets
    row = { id: set.id, label: set.title, body: "Choose a character from " + set.title, set: set }
    if set.id = featured
      row.label = "Featured: " + set.title
      rows.Unshift(row)
    else
      rows.Push(row)
    end if
  end for
  m.featureNodes["avatar-sets"].heading = "Avatar sets"
  m.featureNodes["avatar-sets"].rows = rows
end sub

sub paintAvatars(setId as String)
  rows = []
  for each set in aaArray(uiContent("avatars"), "sets")
    if set.id = setId
      for each avatar in set.avatars
        rows.Push({ id: set.id + "/" + avatar.id, label: avatar.name, body: avatar.name + Chr(10) + "OK: use this character picture", image: avatar.image })
      end for
    end if
  end for
  m.featureNodes.avatars.heading = "Choose a character"
  m.featureNodes.avatars.rows = rows
end sub

sub saveProfileEditor()
  p = m.editorProfile
  body = { name: p.name, avatar: aaGet(p, "avatar", invalid), kind: aaGet(p, "kind", "standard"), maxAge: aaGet(p, "maxAge", 18), currentPin: m.editorCurrentPin, adultPin: m.editorAdultPin, adultId: m.editorAdultId }
  method = "POST"
  if asText(aaGet(p, "id", "")) <> ""
    method = "PUT" : body.id = p.id
  end if
  if m.editorPinChanged then body.pin = m.editorPin
  m.editorTask = startApiRequest(joinCorePath(m.coreUrl, "/api/profiles"), method, FormatJson(body), "onProfileEditorSaved")
end sub

sub onProfileEditorSaved()
  if not m.editorTask.ok
    navigate("modal", "notice", { title: "Profile not saved", body: m.editorTask.error })
    return
  end if
  navigate("pop", "", {})
  m.editorPin = invalid : m.editorCurrentPin = "" : m.editorAdultPin = ""
  loadProfiles(true)
  loadHome()
end sub

sub onFeatureAction(event as Object)
  node = event.GetRoSGNode()
  action = node.action
  row = aaGet(action, "row", {})
  id = asText(aaGet(row, "id", ""))
  name = visibleScreen(m.stack).name
  if name = "services"
    if id = "retry-services" then loadFeature("services", {}) : return
    service = aaGet(row, "service", invalid)
    if service = invalid then return
    if aaGet(action, "type", "") = "options"
      markService(id, not aaGet(service, "connected", false))
    else
      launchService(service, m.servicesTitle)
    end if
  else if name = "avatar-sets"
    if id = "initial"
      m.editorProfile.avatar = invalid
      navigate("pop", "", {}) : paintProfileEditor()
    else
      navigate("push", "avatars", { setId: id })
    end if
  else if name = "avatars"
    m.editorProfile.avatar = id
    navigate("pop", "", {}) : navigate("pop", "", {}) : paintProfileEditor()
  else if name = "adult-profiles"
    m.pinContext = { mode: "adult", profile: row.profile }
    navigate("modal", "pin", { title: "Adult profile PIN" })
  else if name = "profile-edit"
    if id = "name" then showKeyboard("editorName", "Profile name", m.editorProfile.name, "Done")
    if id = "avatar" then navigate("push", "avatar-sets", {})
    if id = "kids"
      if aaGet(m.editorProfile, "kind", "standard") = "kids"
        hasAdult = false
        for each p in aaArray(m.profilesNode.registry, "profiles")
          if aaGet(p, "kind", "standard") = "standard" and aaGet(p, "locked", false) = true then hasAdult = true
        end for
        if hasAdult
          navigate("push", "adult-profiles", {})
        else
          m.editorProfile.kind = "standard"
        end if
      else
        m.editorProfile.kind = "kids" : m.editorProfile.maxAge = 7
      end if
      paintProfileEditor()
    end if
    if id = "age"
      ages = [7, 12, 15, 18]
      index = 0
      for i = 0 to 3
        if ages[i] = aaGet(m.editorProfile, "maxAge", 18) then index = i
      end for
      m.editorProfile.maxAge = ages[(index + 1) mod 4]
      paintProfileEditor()
    end if
    if id = "pin"
      m.pinContext = { mode: "set" }
      navigate("modal", "pin", { title: "Choose a four-digit PIN" })
    end if
    if id = "remove-pin"
      m.editorPinChanged = true : m.editorPin = invalid
      paintProfileEditor()
    end if
    if id = "save-profile" then saveProfileEditor()
    if id = "delete-profile" and asText(aaGet(m.editorProfile, "id", "")) <> "" then navigate("modal", "confirm", { title: "Delete this profile?", body: "Its history and saved services will be removed.", confirmLabel: "Delete", confirmId: "editor-delete" })
  end if
end sub

sub onDetailsServices()
  if m.detailsNode = invalid or m.detailsServicesTask = invalid then return
  connected = []
  if m.detailsServicesTask.ok
    for each service in aaArray(m.detailsServicesTask.json, "services")
      if aaGet(service, "connected", false) = true then connected.Push(service)
    end for
  end if
  m.detailsNode.connectedServices = connected
end sub

sub loadReviewPreview(item as Object)
  id = asText(aaGet(item, "id", "")).Tokenize(":")[0]
  m.previewReviewId = id
  m.previewReviewTask = startApiGet(joinCorePath(m.coreUrl, "/api/reviews?id=" + encodeQuery(id)), "onPreviewReviewDone")
end sub

sub onPreviewReviewDone()
  if m.detailsNode = invalid or m.previewReviewTask = invalid then return
  if asText(aaGet(m.detailsNode.item, "id", "")) <> m.previewReviewId then return
  if m.previewReviewTask.ok then m.detailsNode.reviewPreview = m.previewReviewTask.json
end sub
