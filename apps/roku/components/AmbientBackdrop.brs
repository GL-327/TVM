' Decode only 96x54, then let the sampler stretch the art into a soft wash.
sub init()
  m.wash = m.top.findNode("wash")
  m.wash.observeField("loadStatus", "onLoad")
  m.bindTimer = m.top.findNode("bindTimer")
  m.bindTimer.observeField("fire", "bindGlobals")
  m.bindTimer.control = "start"
  updateArt()
end sub

sub bindGlobals()
  if m.global <> invalid
    if m.global.hasField("trendingHeroUri") then m.global.observeField("trendingHeroUri", "updateArt")
    if m.global.hasField("background") then m.global.observeField("background", "updateArt")
  end if
  updateArt()
end sub

sub updateArt()
  uri = "pkg:/images/lighthouse.jpg"
  if m.global <> invalid
    if m.global.background <> "lighthouse" and m.global.trendingHeroUri <> "" then uri = m.global.trendingHeroUri
  end if
  if m.wash.uri <> uri then m.wash.uri = uri
end sub

sub onLoad()
  if m.wash.loadStatus = "failed"
    if m.wash.uri <> "pkg:/images/lighthouse.jpg" then m.wash.uri = "pkg:/images/lighthouse.jpg"
  end if
end sub
