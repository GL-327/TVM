sub init()
  m.body = m.top.findNode("body")
  m.ring = m.top.findNode("ring")
  m.fill = m.top.findNode("fill")
  m.art = m.top.findNode("art")
  m.logo = m.top.findNode("logo")
  m.initial = m.top.findNode("initial")
  m.nameLabel = m.top.findNode("nameLabel")
  m.groupLabel = m.top.findNode("groupLabel")
  m.badge = m.top.findNode("badge")
  m.badgeLabel = m.top.findNode("badgeLabel")
  m.nameLabel.font = tvmFont("bold", 34)
  m.groupLabel.font = tvmFontCaption()
  m.initial.font = tvmFont("bold", 72)
  m.badgeLabel.font = tvmFontCaption()
  layout()
end sub

sub layout()
  if m.ring = invalid then return
  picking = m.top.picking = true
  if picking
    w = 3520
    h = 176
    m.top.width = w
    m.top.height = h
    m.ring.width = w
    m.ring.height = h
    m.fill.width = 3504
    m.fill.height = 160
    m.fill.translation = [8, 8]
    m.art.width = 220
    m.art.height = 124
    m.art.translation = [28, 26]
    m.logo.width = 160
    m.logo.height = 72
    m.logo.translation = [58, 52]
    m.initial.width = 220
    m.initial.translation = [28, 48]
    m.nameLabel.width = 2800
    m.nameLabel.translation = [280, 36]
    m.groupLabel.width = 2800
    m.groupLabel.translation = [280, 96]
    m.badge.width = 140
    m.badge.height = 56
    m.badge.translation = [3280, 60]
    m.badgeLabel.width = 140
    m.badgeLabel.translation = [3280, 70]
  else
    w = 840
    h = 400
    m.top.width = w
    m.top.height = h
    m.ring.width = w
    m.ring.height = h
    m.fill.width = 816
    m.fill.height = 376
    m.fill.translation = [12, 12]
    m.art.width = 792
    m.art.height = 220
    m.art.translation = [24, 24]
    m.logo.width = 420
    m.logo.height = 110
    m.logo.translation = [210, 78]
    m.initial.width = 792
    m.initial.translation = [24, 80]
    m.nameLabel.width = 760
    m.nameLabel.translation = [40, 262]
    m.groupLabel.width = 760
    m.groupLabel.translation = [40, 318]
    m.badge.width = 132
    m.badge.height = 52
    m.badge.translation = [660, 40]
    m.badgeLabel.width = 132
    m.badgeLabel.translation = [660, 50]
  end if
  m.top.scaleRotateCenter = [m.top.width / 2, m.top.height / 2]
  onFocusStyle()
end sub

sub onItem()
  if m.nameLabel = invalid then return
  layout()
  item = m.top.item
  name = aaGet(item, "name", "Channel")
  group = aaGet(item, "group", "Live")
  logo = aaGet(item, "logo", "")
  picked = aaGet(item, "picked", false)
  m.nameLabel.text = name
  m.groupLabel.text = group
  letter = UCase(Left(name, 1))
  if letter = "" then letter = "#"
  m.initial.text = letter
  if logo <> ""
    m.logo.uri = logo
    m.logo.visible = true
    m.initial.visible = false
  else
    m.logo.uri = ""
    m.logo.visible = false
    m.initial.visible = true
  end if
  picking = m.top.picking = true
  m.badge.visible = picking
  m.badgeLabel.visible = picking
  if picked = true
    m.badgeLabel.text = "ON"
    m.badge.color = tvmFocus()
    m.badgeLabel.color = tvmAccentInk()
  else
    m.badgeLabel.text = "ADD"
    m.badge.color = "0x00000099"
    m.badgeLabel.color = tvmMuted()
  end if
end sub

sub onFocusStyle()
  if m.ring = invalid then return
  focused = m.top.hasFocusStyle = true
  if focused
    m.ring.color = tvmFocus()
    m.top.scale = [tvmFocusScale(), tvmFocusScale()]
  else
    m.ring.color = "0x00000000"
    m.top.scale = [1.0, 1.0]
  end if
end sub
