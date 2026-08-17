sub init()
  m.top.focusable = true
  m.kicker = m.top.findNode("kicker")
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.orbsHost = m.top.findNode("orbs")
  m.kicker.font = tvmFontCaption()
  m.heading.font = tvmFontTitle()
  m.lede.font = tvmFontBody()
  m.orbs = []
  m.profiles = []
  m.col = 0
  m.seq = 0
end sub

sub onRegistry()
  if m.orbsHost = invalid then return
  while m.orbsHost.getChildCount() > 0
    m.orbsHost.removeChildIndex(0)
  end while
  m.orbs = []
  m.profiles = []
  registry = m.top.registry
  profiles = aaArray(registry, "profiles")
  i = 0
  while i < profiles.Count()
    profile = profiles[i]
    orb = CreateObject("roSGNode", "ProfileOrb")
    orb.name = aaGet(profile, "name", "Profile")
    hue = aaGet(profile, "hue", 220)
    if hue <> invalid then orb.hue = Int(hue)
    orb.translation = [i * 400, 0]
    m.orbsHost.appendChild(orb)
    m.orbs.Push(orb)
    m.profiles.Push(profile)
    i = i + 1
  end while
  addOrb = CreateObject("roSGNode", "ProfileOrb")
  addOrb.name = "Add"
  addOrb.hue = 200
  addOrb.translation = [m.orbs.Count() * 400, 0]
  m.orbsHost.appendChild(addOrb)
  m.orbs.Push(addOrb)
  if m.col >= m.orbs.Count() then m.col = m.orbs.Count() - 1
  if m.col < 0 then m.col = 0
  paintFocus()
end sub

sub paintFocus()
  i = 0
  while i < m.orbs.Count()
    m.orbs[i].hasFocusStyle = (i = m.col)
    i = i + 1
  end while
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq }
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
  if intent = "" then return false
  if intent = "back" then return false
  if intent = "home"
    emit("home", invalid)
    return true
  end if
  if intent = "left" and m.col > 0
    m.col = m.col - 1
    paintFocus()
    return true
  end if
  if intent = "right" and m.col < m.orbs.Count() - 1
    m.col = m.col + 1
    paintFocus()
    return true
  end if
  if intent = "info" and m.col < m.profiles.Count()
    emit("remove", { id: aaGet(m.profiles[m.col], "id", "") })
    return true
  end if
  if intent = "select"
    if m.col < m.profiles.Count()
      emit("switch", { id: aaGet(m.profiles[m.col], "id", "") })
    else
      emit("create", invalid)
    end if
    return true
  end if
  return true
end function
