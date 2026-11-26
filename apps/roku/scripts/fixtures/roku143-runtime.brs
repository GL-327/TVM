' Production functions above; only SceneGraph, registry, clock and HTTP edges below.
sub Main()
  for each key in ["up", "down", "left", "right", "OK", "back", "play", "pause", "stop", "replay", "rewind", "fastforward", "info"]
    expect(keyFromIntent(intentFromKey(key)) = key, "remote intent round-trip")
  end for
  m.seq = 0 : m.top = { extrasPrefs: { quality: "original", skipUpscaled: true }, query: "" }
  m.focusSide = true : m.category = 0 : m.row = 0 : m.sections = [{}, {}]
  m.rows = [{ id: "quality", type: "select", values: ["original", "1080"], labels: ["Original", "1080p"] }]
  settingsKey("right", true)
  expect(not m.focusSide, "Right enters settings panel")
  serial = m.seq : settingsKey("left", true)
  expect(m.seq = serial, "value rows do not change on Left")
  settingsKey("OK", true)
  expect(m.top.action.type = "prefOptions", "OK opens a value list")
  settingsKey("back", true)
  expect(m.focusSide, "Back returns to settings categories")
  expect(not settingsKey("back", true), "second Back leaves settings")
  settingsKey("up", true) : settingsKey("OK", true)
  expect(m.top.action.type = "settingsSearch", "search row opens keyboard")
  m.focusSide = false : m.rows = [{ id: "skipUpscaled", type: "switch", values: [true] }]
  settingsKey("OK", true)
  expect(m.top.action.value = false, "OK toggles switches")
  m.rows = [{ id: "skipSegments", type: "segments", values: ["off", "button", "auto"] }]
  m.top.extrasPrefs.skipSegments = "button"
  settingsKey("left", true)
  expect(m.top.action.value = "off", "Left changes segmented choice")
  settingsKey("right", true)
  expect(m.top.action.value = "auto", "Right changes segmented choice")

  m.zone = "grid" : m.row = 0 : m.rows = [] : m.digits = ""
  guideKey("down", true)
  expect(m.row = 0 and m.zone = "tools", "empty guide escapes to tools without negative row")
  m.rows = []
  for i = 0 to 19
    m.rows.Push({ id: "live:" + i.ToStr(), name: "Channel " + i.ToStr(), programmes: [] })
  end for
  m.zone = "grid" : m.row = 0 : m.anchor = 5000 : m.start = 0 : m.end = 86400 : m.left = 1800 : m.window = 10800
  guideKey("fastforward", true)
  expect(m.row = 8 and m.anchor = 5000, "FastForward jumps eight channels at the same time")
  guideKey("rewind", true)
  expect(m.row = 0 and m.anchor = 5000, "Rewind jumps back eight channels at the same time")
  guideKey("down", true) : guideKey("up", true)
  expect(m.row = 0 and m.anchor = 5000, "Up and Down preserve time anchor")
  guideKey("left", true)
  expect(m.left = 0, "Left at first visible cell scrolls thirty minutes")
  guideKey("left", true)
  expect(m.left = -1800 and m.top.action.type = "guideWindow", "Left fetches an earlier guide window")
  guideKey("OK", true)
  expect(m.top.action.type = "play" and m.top.action.item.id = "live:0", "OK tunes selected channel")
  guideKey("info", true)
  expect(m.zone = "info", "Options focuses Watch")
  guideKey("up", true)
  expect(m.zone = "grid", "Up returns from Watch to grid")
  expect(not guideKey("back", true), "Back closes guide")

  m.page = 0 : m.pages = ["one", "two"] : m.closed = false
  noticeKey("up", true) : expect(m.page = 0, "notes stop at first page")
  noticeKey("down", true) : noticeKey("down", true)
  expect(m.page = 1, "notes stop at last page")
  noticeKey("OK", true) : expect(m.closed, "OK dismisses notes from any page")
  pages = tvmTextPages(String(100, "W") + Chr(10) + "last words", 30, 2)
  expect(pages.Count() = 3, "long words and paragraphs paginate")
  for each page in pages
    for each line in page.Split(Chr(10))
      expect(Len(line) <= 30, "every line fits the modal")
    end for
  end for

  m.sets = [{ id: "initial" }, { id: "show", set: { avatars: [{ id: "one" }, { id: "two" }] } }]
  m.setIndex = 0 : m.avatarIndex = 0 : m.zone = "sets"
  avatarKey("right", true) : avatarKey("down", true) : avatarKey("right", true) : avatarKey("OK", true)
  expect(m.top.action.row.id = "show/two", "set tiles reach and choose character circles")
  avatarKey("back", true) : expect(m.zone = "sets", "Back from characters returns to sets")
  expect(not avatarKey("back", true), "Back from sets leaves picker")

  m.installedVersion = "1.4.3" : m.releasePending = true : m.patchNotesShown = false
  m.homeNode = { mode: "ready", releaseShortcut: true } : m.releaseCard = { visible: true }
  m.stack = {} : m.current = "settings" : m.entry = "screen" : m.rokuUpdate = {}
  m.releases = [{ version: "9.0.0", title: "Future" }, { version: "1.4.3", title: "This update", changes: [] }]
  for i = 1 to 30
    m.releases[1].changes.Push({ text: "Change " + i.ToStr() })
  end for
  m.releases[1].changes.Push({ text: "Other platform", platforms: ["windows"] })
  m.patchNotesFlags = {} : m.patchNotesConfigLoaded = false
  m.releaseClock = { TotalMilliseconds: fakeReleaseElapsed }
  dismissReleaseCards()
  expect(m.releasePending, "small card cannot consume notes before config arrives")
  m.patchNotesConfigLoaded = true
  maybeShowPatchNotes({ patchNotesPopup: true })
  expect(m.releasePending and not m.patchNotesShown and not m.releaseCard.visible, "off-Home config queues notes and hides small card")
  m.current = "home" : m.entry = "modal" : maybeShowReleaseCards()
  expect(m.releasePending, "another modal does not consume pending notes")
  m.entry = "screen" : maybeShowReleaseCards()
  expect(m.patchNotesShown and not m.releasePending, "Home opens queued notes")
  expect(Instr(1, m.navigation.title, "1.4.3") > 0, "notes match installed version")
  expect(Instr(1, m.navigation.body, "Change 30") > 0, "all changes remain readable")
  expect(Instr(1, m.navigation.body, "Other platform") = 0, "notes only show applicable platforms")

  ctx = { accountToken: "fixture-session" } : m.rdAvailable = false : m.accountCalls = 0
  expect(lcRdTokenInfo(ctx).token = "", "missing RD key")
  m.rdAvailable = true
  expect(lcResolveAccount(ctx).hasRdToken, "account reports assigned key")
  expect(lcRdTokenInfo(ctx).token = "fixture-rd", "newly assigned key is available immediately")
  expect(m.accountCalls = 3, "RD result is never cached across requests")

  m.videoMode = "2160p60" : m.hevc = true : m.dts = false : m.display = { Hdr10: true, DolbyVision: false }
  streams = [
    release(1, "2160p HEVC REMUX eng 50 GB")
    release(2, "2160p HEVC WEB-DL eng 8 GB")
    release(3, "1080p H264 REMUX eng 30 GB")
    release(4, "2160p HEVC REMUX fra 60 GB")
    release(5, "2160p HEVC REMUX eng UPS 70 GB")
    release(6, "2160p HEVC CAM eng 2 GB")
    release(7, "2160p HEVC REMUX eng TrueHD 60 GB")
    release(8, "2160p HEVC REMUX eng DTS 60 GB")
    release(9, "1080p Xvid eng 5 GB")
    release(10, "1080p H264 eng movie.avi 5 GB")
    release(11, "2160p HEVC REMUX MULTI fra spa 80 GB")
  ]
  ranked = lcRankVersions(streams, "eng", 7200, {}, {})
  expect(ranked.Count() = 3, "ranking rejects dubs, upscales, cams and unsupported audio/video")
  expect(ranked[0].version.height = 2160 and ranked[0].version.source = "remux", "native 4K original-language remux wins")
  expect(ranked[0].version.bitrateMbps > 50, "original file bitrate is measured from size and runtime")
  limited = lcRankVersions(streams, "eng", 7200, {}, { maxHeight: 1080 })
  expect(limited.Count() = 1 and limited[0].version.height = 1080, "client height limits selection")
  m.videoMode = "1080p60"
  limited = lcRankVersions(streams, "eng", 7200, {}, { maxHeight: 2160 })
  expect(limited.Count() = 1, "client cannot exceed connected TV resolution")
  expect(lcRankVersions(streams, "eng", 7200, { quality: "original", skipUpscaled: false }, {}).Count() = 1, "Original still rejects upscales on HD TV")
  m.videoMode = "2160p60" : m.hevc = false
  limited = lcRankVersions(streams, "eng", 7200, {}, {})
  expect(limited.Count() = 1, "device codec capability limits selection")
  m.hevc = true
  first = release(12, "1080p H264 WEB-DL eng 8 GB")
  second = release(13, "1080p H264 WEB-DL eng 16 GB")
  ranked = lcRankVersions([first, second], "eng", 7200, {}, {})
  expect(ranked[0].version.sizeBytes > ranked[1].version.sizeBytes, "higher bitrate wins within a source")
  first.name = "RD" : second.title = first.title : second.cached = true
  ranked = lcRankVersions([first, second], "eng", 7200, {}, {})
  expect(ranked[0].version.cached, "cached copy wins otherwise equal versions")
  first.title = "2160p HEVC REMUX eng HDR10 50 GB"
  expect(lcRankVersions([first], "eng", 7200, {}, { hdr: false }).Count() = 0, "SDR client rejects HDR")
  expect(lcRankVersions([first], "eng", 7200, {}, { mkv: false }).Count() = 0, "client container limits are honoured")
  print "ROKU143_RUNTIME_OK"
end sub

sub expect(ok as Boolean, message as String)
  if not ok then print "FAIL: " + message : stop
end sub

function release(index as Integer, title as String) as Object
  return { infoHash: "000000000000000000000000000000000000" + Right("0000" + index.ToStr(), 4), fileIdx: 0, name: "RD+", title: title }
end function

sub paintSettings()
end sub
sub paintGuide()
end sub
sub paintNoticePage()
end sub
sub paintAvatars()
end sub
sub emit(kind as String)
  m.closed = true
end sub
function tvmFontFamily() as String
  return "Geist"
end function
function tvmReduceMotion() as Boolean
  return false
end function
function tvmReduceTransparency() as Boolean
  return false
end function
function loadFlag(key as String) as Boolean
  return false
end function
function visibleScreen(stack as Object) as Object
  return { name: m.current }
end function
function activeEntry(stack as Object) as Object
  return { kind: m.entry }
end function
function uiContent(name as String) as Object
  return { releases: m.releases }
end function
function registrySection() as Object
  return { Write: fakeWrite, Flush: fakeFlush }
end function
sub fakeWrite(key as String, value as String)
end sub
sub fakeFlush()
end sub
sub navigate(kind as String, name as String, params as Object)
  m.navigation = params : m.entry = "modal"
end sub
function lcAccountsHttp(ctx as Object, path as String) as Object
  m.accountCalls = m.accountCalls + 1
  if path = "/v1/me" then return { ok: true, json: { account: { hasRdToken: m.rdAvailable } } }
  token = ""
  if m.rdAvailable then token = "fixture-rd"
  return { ok: true, json: { token: token } }
end function
function fakeDeviceInfo() as Object
  return { videoMode: m.videoMode, hevc: m.hevc, dts: m.dts, display: m.display, GetVideoMode: fakeVideoMode, CanDecodeVideo: fakeVideo, GetDisplayProperties: fakeDisplay, CanDecodeAudio: fakeAudio }
end function
function fakeVideoMode() as String
  return m.videoMode
end function
function fakeDisplay() as Object
  return m.display
end function
function fakeVideo(spec as Object) as Object
  return { result: spec.codec <> "hevc" or m.hevc }
end function
function fakeAudio(spec as Object) as Object
  return { result: spec.codec <> "dts" or m.dts }
end function

function fakeReleaseElapsed() as Integer
  return 2000
end function
