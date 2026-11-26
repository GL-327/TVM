sub initQuality()
  m.manualQuality = m.top.chosenQuality
  m.variants = [] : m.variantIndex = 0 : m.playUrl = ""
  m.qualityOpen = false : m.versionPanel = false
  m.qualityPanel = m.top.findNode("qualityPanel")
  m.qualityPanel.observeField("action", "onQualityAction")
  m.orbit = m.top.findNode("orbit")
  m.bufferClock = CreateObject("roTimespan") : m.bufferClock.Mark()
  m.lastBufferPercent = 0
  m.video.observeField("bufferingStatus", "onBufferingStatus")
  if m.video.hasField("downloadedSegment") then m.video.observeField("downloadedSegment", "onDownloadedSegment")
  m.stallTimer = m.top.findNode("qualityStall")
  m.recoverTimer = m.top.findNode("qualityRecover")
  m.stallTimer.observeField("fire", "onQualityStall")
  m.recoverTimer.observeField("fire", "onQualityRecover")
end sub

sub planStream()
  if m.top.streamUrl = "" then return
  startPlayerExtras()
  m.manualQuality = m.top.chosenQuality
  m.orbit.active = true : m.orbit.status = "Connecting"
  task = CreateObject("roSGNode", "ApiTask")
  task.requestUrl = "local:/api/roku/quality"
  task.requestMethod = "POST"
  task.requestBody = FormatJson({ url: m.top.streamUrl, format: m.top.streamFormat, headers: m.top.streamHeaders })
  task.observeField("done", "onQualityPlan")
  m.planTask = task
  task.control = "RUN"
end sub

sub onQualityPlan(event as Object)
  task = event.GetRoSGNode()
  if m.closing or task.requestBody <> m.planTask.requestBody then return
  m.variants = aaArray(task.json, "variants")
  m.qualityCap = aaGet(task.json, "cap", 1080)
  m.playUrl = m.top.streamUrl
  m.variantIndex = 0
  if m.variants.Count() > 0
    if m.manualQuality > 0
      for i = 0 to m.variants.Count() - 1
        if m.variants[i].height <= m.manualQuality
          m.variantIndex = i
          exit for
        end if
      end for
    end if
    m.playUrl = m.variants[m.variantIndex].url
  end if
  beginStream()
end sub

sub onBufferingStatus()
  status = m.video.bufferingStatus
  if status = invalid then return
  percent = aaGet(status, "percentage", 0)
  dt = m.bufferClock.TotalMilliseconds() / 1000.0 : m.bufferClock.Mark()
  if dt > 0
    gained = percent - m.lastBufferPercent
    rate = gained / dt / 25.0
    if rate < 0.35 then rate = 0.35
    if rate > 2.4 then rate = 2.4
    m.orbit.rate = rate
  end if
  m.lastBufferPercent = percent
  m.orbit.percentage = percent
  m.orbit.status = "Buffering " + StrI(Int(percent)).Trim() + "%"
  m.orbit.active = true
  if aaGet(status, "isUnderrun", false) = true and m.manualQuality = 0
    if m.stallTimer.control <> "start" then m.stallTimer.control = "start"
  end if
end sub

sub onDownloadedSegment()
  segment = m.video.downloadedSegment
  duration = aaGet(segment, "downloadDuration", 0)
  mediaDuration = aaGet(segment, "segDuration", 0)
  if duration > 0 and mediaDuration > 0 then m.orbit.rate = mediaDuration / duration
end sub

sub onQualityStall()
  if m.manualQuality <> 0 or m.video.state <> "buffering" then return
  if m.variantIndex < m.variants.Count() - 1
    height = m.variants[m.variantIndex].height
    while m.variantIndex < m.variants.Count() - 1
      m.variantIndex = m.variantIndex + 1
      if m.variants[m.variantIndex].height < height then exit while
    end while
    restartVariant()
  end if
end sub

sub onQualityRecover()
  if m.manualQuality <> 0 or m.video.state <> "playing" or m.variantIndex = 0 then return
  m.variantIndex = 0
  restartVariant()
end sub

sub restartVariant()
  position = m.position
  m.video.control = "stop"
  m.playUrl = m.variants[m.variantIndex].url
  m.top.startAt = position
  if Left(m.top.mediaId, 5) = "live:" then m.top.startAt = 0
  beginStream()
end sub

sub openQuality()
  m.versionPanel = false
  m.hideTimer.control = "stop"
  rows = []
  best = m.qualityCap
  if best = invalid then best = 1080
  if m.variants.Count() > 0 then best = m.variants[0].height
  resolution = m.top.resolution
  if m.variants.Count() = 0 and resolution > 0 then best = resolution
  rows.Push({ id: "auto", label: "Auto (best: " + StrI(best).Trim() + "p)", body: "Starts at the best supported quality for this TV. Drops after a real stall and retries the best quality after stable playback.", quality: 0 })
  available = m.top.qualities
  if m.variants.Count() > 0
    available = [] : seen = {}
    for each variant in m.variants
      key = StrI(variant.height).Trim()
      if not seen.DoesExist(key) then available.Push(variant.height) : seen[key] = true
    end for
  end if
  if available <> invalid
    for each height in available
      rows.Push({ id: "quality-" + StrI(height).Trim(), label: StrI(height).Trim() + "p", body: "Keep this quality for this playback. A new title starts in Auto.", quality: height })
    end for
  end if
  rows.Push({ id: "control-centre", label: "Control Centre", body: "Audio, subtitles and playback controls." })
  rows.Push({ id: "volume", label: "TV volume", body: "Use the TV volume buttons" })
  m.qualityPanel.heading = "Playback options"
  m.qualityPanel.rows = rows
  m.qualityPanel.visible = true : m.qualityOpen = true
  m.qualityPanel.setFocus(true)
end sub

sub openPlayerVersions()
  rows = []
  for each version in aaArray(m.top, "versions")
    rows.Push({ id: version.id, label: version.label, body: version.label + Chr(10) + "OK: play this version    Back: player menu", version: version })
  end for
  if rows.Count() = 0 then rows.Push({ id: "none", label: "No versions available", body: "This source has no other compatible versions. Back returns to the player menu." })
  m.versionPanel = true
  m.hideTimer.control = "stop"
  m.qualityPanel.heading = "Choose version" : m.qualityPanel.rows = rows
  m.qualityPanel.visible = true : m.qualityOpen = true
  m.qualityPanel.setFocus(true)
end sub

sub closeQuality()
  returnToMenu = m.versionPanel
  m.versionPanel = false
  m.qualityPanel.visible = false : m.qualityOpen = false
  claimOverlayFocus()
  if returnToMenu then openCC()
end sub

sub onQualityAction()
  if aaGet(m.qualityPanel.action, "type", "") <> "select" then return
  row = aaGet(m.qualityPanel.action, "row", {})
  id = asText(aaGet(row, "id", ""))
  if m.versionPanel
    if aaGet(row, "version", invalid) = invalid then closeQuality() : return
    m.versionPanel = false
    saveProgress(true)
    emit("version", { versionId: row.id, position: m.position })
    return
  end if
  if id = "volume" then return
  closeQuality()
  if id = "control-centre" then openCC() : return
  quality = aaGet(row, "quality", 0)
  m.manualQuality = quality
  if m.variants.Count() > 0
    m.variantIndex = 0
    if quality > 0
      for i = 0 to m.variants.Count() - 1
        if m.variants[i].height <= quality then m.variantIndex = i : exit for
      end for
    end if
    restartVariant()
  else if m.top.qualities <> invalid and m.top.qualities.Count() > 0
    emit("quality", { quality: quality, position: m.position })
  else
    showTransient("This stream has no selectable quality variants.")
  end if
end sub
