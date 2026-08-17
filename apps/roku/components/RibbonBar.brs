sub init()
  m.items = m.top.findNode("items")
  m.slideAnim = m.top.findNode("slideAnim")
  m.slideInterp = m.top.findNode("slideInterp")
  m.seq = 0
  m.spec = tvmRibbonSpec()
  m.buttons = []
  x = 0
  i = 0
  while i < m.spec.Count()
    spec = m.spec[i]
    if spec.kind = "app"
      btn = CreateObject("roSGNode", "AppTile")
      btn.appId = spec.appId
      btn.translation = [x, 48]
      x = x + 308
    else
      btn = CreateObject("roSGNode", "FocusButton")
      btn.variant = "ribbon"
      btn.label = spec.label
      btn.itemId = spec.id
      btn.iconUri = spec.icon
      btn.translation = [x, 16]
      x = x + 224
    end if
    m.items.appendChild(btn)
    m.buttons.Push(btn)
    i = i + 1
  end while
  m.top.width = 3840
  m.top.height = 248
  if m.slideAnim <> invalid then m.slideAnim.observeField("state", "onSlideState")
  paint()
end sub

sub paint()
  if m.buttons = invalid then return
  i = 0
  while i < m.buttons.Count()
    focused = (m.top.hasBarFocus = true and m.top.focusCol = i)
    m.buttons[i].hasFocusStyle = focused
    if m.spec[i].kind <> "app"
      m.buttons[i].active = (m.spec[i].id = m.top.activeId)
    end if
    i = i + 1
  end while
  ensureVisible()
end sub

sub ensureVisible()
  col = m.top.focusCol
  if col < 0 or col >= m.buttons.Count() then return
  node = m.buttons[col]
  if node = invalid then return
  nx = node.translation[0]
  groupX = m.items.translation[0]
  screenX = nx + groupX
  target = groupX
  if screenX > 3000 then target = 3000 - nx - 284
  if screenX < 80 then target = 80 - nx
  if Abs(target - groupX) < 2 then return
  slideItems(target)
end sub

sub slideItems(x as Float)
  current = m.items.translation[0]
  if m.slideAnim = invalid or m.slideInterp = invalid
    m.items.translation = [x, 16]
    return
  end if
  m.slideAnim.control = "stop"
  m.slideInterp.keyValue = [[current, 16], [x, 16]]
  m.slideAnim.control = "start"
end sub

sub onSlideState()
end sub

function currentAction() as String
  spec = m.spec[m.top.focusCol]
  if spec = invalid then return ""
  return spec.action
end function

sub emit(kind as String)
  m.seq = m.seq + 1
  spec = m.spec[m.top.focusCol]
  action = { type: kind, seq: m.seq }
  if spec <> invalid and spec.DoesExist("appId") then action.appId = spec.appId
  m.top.action = action
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return false
  if intent = "left" and m.top.focusCol > 0
    m.top.focusCol = m.top.focusCol - 1
    return true
  end if
  if intent = "right" and m.top.focusCol < m.buttons.Count() - 1
    m.top.focusCol = m.top.focusCol + 1
    return true
  end if
  if intent = "select"
    emit(currentAction())
    return true
  end if
  if intent = "home"
    emit("home")
    return true
  end if
  return false
end function
