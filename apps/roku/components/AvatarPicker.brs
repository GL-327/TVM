sub init()
  m.top.focusable = true
  m.host = m.top.findNode("content")
  m.top.findNode("background").color = tvmBg()
  m.setIndex = 0 : m.avatarIndex = 0 : m.zone = "sets" : m.seq = 0
  m.sets = []
end sub

sub onSets()
  m.sets = m.top.rows
  if m.sets = invalid then m.sets = []
  m.setIndex = 0 : m.avatarIndex = 0 : m.zone = "sets"
  for i = 0 to m.sets.Count() - 1
    for j = 0 to aaArray(aaGet(m.sets[i], "set", {}), "avatars").Count() - 1
      avatar = m.sets[i].set.avatars[j]
      if m.top.selectedAvatar = m.sets[i].id + "/" + avatar.id then m.setIndex = i : m.avatarIndex = j
    end for
  end for
  paintAvatars()
end sub

function pickerLabel(text as String, x as Integer, y as Integer, width as Integer, height as Integer, size as Integer, color as String) as Object
  label = CreateObject("roSGNode", "Label")
  label.text = text : label.font = tvmFont("medium", size) : label.color = color
  label.translation = [x, y] : label.width = width : label.height = height
  label.wrap = true : label.maxLines = 2
  m.host.appendChild(label)
  return label
end function

function pickerPlate(x as Integer, y as Integer, width as Integer, height as Integer, focused as Boolean) as Object
  panel = CreateObject("roSGNode", "GlassPanel")
  panel.translation = [x, y] : panel.width = width : panel.height = height : panel.focused = focused
  m.host.appendChild(panel)
  return panel
end function

function currentAvatars() as Object
  if m.sets.Count() = 0 then return []
  return aaArray(aaGet(m.sets[m.setIndex], "set", {}), "avatars")
end function

sub paintAvatars()
  if m.host = invalid then return
  m.host.removeChildren(m.host.getChildren(-1, 0))
  pickerLabel("Character picture", 0, 0, 3520, 120, 88, tvmText())
  pickerLabel("Left / Right: browse sets    Down: characters    OK: choose    Back: return", 0, 150, 3520, 100, 48, tvmMuted())
  if m.sets.Count() = 0 then return
  first = m.setIndex - 2
  if first < 0 then first = 0
  last = first + 4
  if last >= m.sets.Count() then last = m.sets.Count() - 1
  for i = first to last
    row = m.sets[i] : x = (i - first) * 700
    tile = pickerPlate(x, 340, 640, 480, m.zone = "sets" and i = m.setIndex)
    if i = m.setIndex then tile.tintColor = tvmAccentBlue()
    avatars = aaArray(aaGet(row, "set", {}), "avatars")
    if avatars.Count() > 0
      art = CreateObject("roSGNode", "Poster")
      art.uri = asText(aaGet(row.set, "cover", aaGet(row.set, "image", avatars[0].image)))
      art.translation = [x + 24, 364] : art.width = 592 : art.height = 310
      art.loadWidth = 592 : art.loadHeight = 310 : art.loadDisplayMode = "scaleToFill"
      m.host.appendChild(art)
    else
      pickerLabel("Aa", x + 40, 414, 560, 180, 96, tvmText())
    end if
    pickerLabel(row.label, x + 30, 700, 580, 110, 48, tvmText())
  end for
  avatars = currentAvatars()
  if avatars.Count() = 0
    pickerLabel("OK uses the profile colour and initial.", 0, 1000, 3520, 120, 56, tvmMuted())
  else
    pickerLabel(m.sets[m.setIndex].label, 0, 940, 3520, 120, 64, tvmText())
    firstAvatar = m.avatarIndex - 4
    if firstAvatar < 0 then firstAvatar = 0
    lastAvatar = firstAvatar + 9
    if lastAvatar >= avatars.Count() then lastAvatar = avatars.Count() - 1
    for j = firstAvatar to lastAvatar
      avatar = avatars[j] : x = (j - firstAvatar) * 352
      id = m.sets[m.setIndex].id + "/" + avatar.id
      ring = CreateObject("roSGNode", "GlassPanel")
      ring.shape = "pill" : ring.width = 224 : ring.height = 224 : ring.translation = [x + 48, 1168]
      ring.focused = (m.zone = "avatars" and j = m.avatarIndex)
      if id = m.top.selectedAvatar then ring.tintColor = tvmAccentBlue()
      m.host.appendChild(ring)
      mask = CreateObject("roSGNode", "MaskGroup")
      mask.maskUri = "pkg:/images/glass/mask-avatar.png" : mask.maskSize = [192, 192]
      mask.translation = [x + 64, 1184]
      image = CreateObject("roSGNode", "Poster")
      image.uri = avatar.image : image.width = 192 : image.height = 192
      image.loadWidth = 192 : image.loadHeight = 192 : image.loadDisplayMode = "scaleToFill"
      mask.appendChild(image) : m.host.appendChild(mask)
      label = pickerLabel(avatar.name, x, 1430, 320, 150, 44, tvmText())
      label.horizAlign = "center"
    end for
    pickerLabel(avatars[m.avatarIndex].name, 0, 1690, 3520, 120, 64, tvmText())
  end if
  m.top.focusKey = m.zone + ":" + m.setIndex.ToStr() + ":" + m.avatarIndex.ToStr()
end sub

sub restoreAvatarFocus()
  parts = m.top.restoreKey.Split(":")
  if parts.Count() <> 3 then return
  index = Int(Val(parts[1]))
  if index < 0 or index >= m.sets.Count() then return
  m.setIndex = index : m.avatarIndex = 0 : m.zone = "sets"
  index = Int(Val(parts[2]))
  if index >= 0 and index < currentAvatars().Count()
    m.avatarIndex = index
    if parts[0] = "avatars" then m.zone = "avatars"
  end if
  paintAvatars()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "back"
    if m.zone = "sets" then return false
    m.zone = "sets"
  else if m.sets.Count() > 0
    avatars = currentAvatars()
    if m.zone = "sets"
      old = m.setIndex
      if intent = "left" and m.setIndex > 0 then m.setIndex = m.setIndex - 1
      if intent = "right" and m.setIndex < m.sets.Count() - 1 then m.setIndex = m.setIndex + 1
      if old <> m.setIndex then m.avatarIndex = 0
      if (intent = "down" or intent = "select") and currentAvatars().Count() > 0 then m.zone = "avatars"
      if intent = "select" and currentAvatars().Count() = 0
        m.seq = m.seq + 1 : m.top.action = { type: "select", row: m.sets[m.setIndex], seq: m.seq }
      end if
    else
      if intent = "up" then m.zone = "sets"
      if intent = "left" and m.avatarIndex > 0 then m.avatarIndex = m.avatarIndex - 1
      if intent = "right" and m.avatarIndex < avatars.Count() - 1 then m.avatarIndex = m.avatarIndex + 1
      if intent = "select"
        m.seq = m.seq + 1
        m.top.action = { type: "avatar", row: { id: m.sets[m.setIndex].id + "/" + avatars[m.avatarIndex].id }, seq: m.seq }
      end if
    end if
  end if
  paintAvatars()
  return true
end function

sub onRemoteIntent()
  key = keyFromIntent(m.top.remoteIntent)
  if key <> "" then onKeyEvent(key, true)
end sub
