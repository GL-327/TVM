' "Add device" on the TV: approve another device that is signing in with a
' code. Phases:
'   entry    8 characters (XXXX-XXXX) picked from a D-pad grid of the 32
'            allowed characters, then "Check code" (GET /pair/lookup)
'   lookup   waiting for Core
'   confirm  shows the requesting device (name, platform, model, when) with
'            Approve and Deny (POST /pair/approve or /pair/deny)
'   done     the host closes the panel after a short message
' Wrong code, expired and rate-limited answers arrive as `message`.
' The panel owns its keys; the host sends the requests.
sub init()
  m.top.focusable = true
  m.title = m.top.findNode("title")
  m.lede = m.top.findNode("lede")
  m.entry = m.top.findNode("entry")
  m.confirm = m.top.findNode("confirm")
  m.slots = m.top.findNode("slots")
  m.grid = m.top.findNode("grid")
  m.cellRing = m.top.findNode("cellRing")
  m.btnDelete = m.top.findNode("btnDelete")
  m.btnClear = m.top.findNode("btnClear")
  m.btnCheck = m.top.findNode("btnCheck")
  m.btnApprove = m.top.findNode("btnApprove")
  m.btnDeny = m.top.findNode("btnDeny")
  m.reqName = m.top.findNode("reqName")
  m.reqPlatform = m.top.findNode("reqPlatform")
  m.reqWhen = m.top.findNode("reqWhen")
  m.reqWarn = m.top.findNode("reqWarn")
  m.msg = m.top.findNode("msg")
  m.title.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  m.title.color = tvmText()
  m.lede.font = tvmFontMeta()
  m.msg.font = tvmFontMeta()
  m.reqName.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  m.reqName.color = tvmText()
  m.reqPlatform.font = tvmFontSecondary()
  m.reqWhen.font = tvmFontMeta()
  m.reqWarn.font = tvmFontMeta()
  m.seq = 0
  m.code = ""
  m.cols = 8
  m.rows = 4
  m.row = 0
  m.col = 0
  m.zone = "grid"
  m.btn = 0
  m.choice = 0
  m.cells = []
  m.slotLabels = []
  buildGrid()
  buildSlots()
  paint()
end sub

sub buildSlots()
  font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  x = 0
  i = 0
  while i < 9
    if i = 4
      dash = CreateObject("roSGNode", "Label")
      dash.text = "-"
      dash.font = font
      dash.color = tvmMuted()
      dash.translation = [x, 0]
      dash.width = 80
      dash.height = 120
      dash.horizAlign = "center"
      dash.vertAlign = "center"
      m.slots.appendChild(dash)
      x = x + 80
    else
      slotBox = CreateObject("roSGNode", "Rectangle")
      slotBox.translation = [x, 0]
      slotBox.width = 120
      slotBox.height = 120
      slotBox.cornerRadius = 30
      slotBox.color = tvmGlassTint()
      label = CreateObject("roSGNode", "Label")
      label.font = font
      label.color = tvmText()
      label.translation = [x, 0]
      label.width = 120
      label.height = 120
      label.horizAlign = "center"
      label.vertAlign = "center"
      m.slots.appendChild(slotBox)
      m.slots.appendChild(label)
      m.slotLabels.Push(label)
      x = x + 140
    end if
    i = i + 1
  end while
end sub

sub buildGrid()
  alphabet = hubPairAlphabet()
  font = tvmFont("bold", tvmTypeSize(tvmTypeSecondary()))
  r = 0
  while r < m.rows
    c = 0
    while c < m.cols
      idx = (r * m.cols) + c
      ch = Mid(alphabet, idx + 1, 1)
      bg = CreateObject("roSGNode", "Rectangle")
      bg.translation = [c * 168, r * 128]
      bg.width = 148
      bg.height = 108
      bg.cornerRadius = 36
      bg.color = tvmGlassTint()
      label = CreateObject("roSGNode", "Label")
      label.text = ch
      label.font = font
      label.color = tvmText()
      label.translation = [c * 168, r * 128]
      label.width = 148
      label.height = 108
      label.horizAlign = "center"
      label.vertAlign = "center"
      m.grid.appendChild(bg)
      m.grid.appendChild(label)
      m.cells.Push({ bg: bg, ch: ch })
      c = c + 1
    end while
    r = r + 1
  end while
end sub

sub paint()
  if m.title = invalid then return
  phase = m.top.phase
  m.entry.visible = (phase = "entry" or phase = "lookup")
  m.confirm.visible = (phase = "confirm" or phase = "done")
  if phase = "entry" or phase = "lookup"
    m.title.text = "Add a device"
    m.lede.text = "On the other device choose Sign in with a code, then enter the code it shows."
  else if phase = "confirm"
    m.title.text = "Approve this device?"
    m.lede.text = "Only approve a device you are looking at right now."
  else
    m.title.text = "Done"
    m.lede.text = ""
  end if
  m.msg.text = m.top.message
  request = m.top.request
  if request <> invalid and request.Count() > 0
    m.reqName.text = asText(aaGet(request, "name", "A device"))
    platform = hubPlatformName(asText(aaGet(request, "platform", "")))
    model = asText(aaGet(request, "model", ""))
    if model <> "" then platform = platform + " · " + model
    m.reqPlatform.text = platform
    when = ""
    asked = asText(aaGet(request, "requestedAt", ""))
    if asked <> "" and m.top.serverTime <> ""
      age = hubAgeSeconds(asked, m.top.serverTime)
      if age >= 0 then when = "Asked " + hubAgeText(age)
    end if
    m.reqWhen.text = when
    m.reqWarn.text = "Approving signs it in to this account. You can remove it later from TVM Hub."
  end if
  paintFocus()
end sub

sub paintCode()
  i = 0
  while i < m.slotLabels.Count()
    if i < Len(m.code)
      m.slotLabels[i].text = Mid(m.code, i + 1, 1)
    else
      m.slotLabels[i].text = ""
    end if
    i = i + 1
  end while
end sub

sub paintFocus()
  paintCode()
  phase = m.top.phase
  inGrid = (phase = "entry" and m.zone = "grid")
  m.cellRing.visible = inGrid
  i = 0
  while i < m.cells.Count()
    if inGrid and i = (m.row * m.cols) + m.col
      m.cells[i].bg.color = tvmGlassTintFocused()
      m.cellRing.translation = [m.grid.translation[0] + (m.col * 168) - 26, m.grid.translation[1] + (m.row * 128) - 14]
    else
      m.cells[i].bg.color = tvmGlassTint()
    end if
    i = i + 1
  end while
  onButtons = (phase = "entry" and m.zone = "buttons")
  m.btnDelete.hasFocusStyle = (onButtons and m.btn = 0)
  m.btnClear.hasFocusStyle = (onButtons and m.btn = 1)
  m.btnCheck.hasFocusStyle = (onButtons and m.btn = 2)
  m.btnCheck.disabled = not hubPairComplete(m.code)
  m.btnApprove.hasFocusStyle = (phase = "confirm" and m.choice = 0)
  m.btnDeny.hasFocusStyle = (phase = "confirm" and m.choice = 1)
end sub

sub emit(kind as String, extra as Object)
  m.seq = m.seq + 1
  action = { type: kind, seq: m.seq }
  for each key in extra
    action[key] = extra[key]
  end for
  m.top.action = action
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  phase = m.top.phase
  if phase = "lookup" or phase = "done"
    if intent = "back" then emit("close", {})
    return true
  end if
  if phase = "confirm" then return keyConfirm(intent)
  return keyEntry(intent)
end function

function keyEntry(intent as String) as Boolean
  if intent = "back"
    emit("close", {})
    return true
  end if
  if m.zone = "grid"
    if intent = "left" and m.col > 0 then m.col = m.col - 1
    if intent = "right" and m.col < m.cols - 1 then m.col = m.col + 1
    if intent = "up" and m.row > 0 then m.row = m.row - 1
    if intent = "down"
      if m.row < m.rows - 1
        m.row = m.row + 1
      else
        m.zone = "buttons"
        m.btn = 0
        if m.col >= 5 then m.btn = 2 else if m.col >= 3 then m.btn = 1
      end if
    end if
    if intent = "select" and Len(m.code) < 8
      m.code = m.code + m.cells[(m.row * m.cols) + m.col].ch
      m.top.message = ""
    end if
  else
    if intent = "left" and m.btn > 0 then m.btn = m.btn - 1
    if intent = "right" and m.btn < 2 then m.btn = m.btn + 1
    if intent = "up"
      m.zone = "grid"
      m.row = m.rows - 1
      m.col = m.btn * 3
      if m.col > m.cols - 1 then m.col = m.cols - 1
    end if
    if intent = "select"
      if m.btn = 0
        if Len(m.code) > 0 then m.code = Left(m.code, Len(m.code) - 1)
      else if m.btn = 1
        m.code = ""
      else if hubPairComplete(m.code)
        emit("lookup", { code: hubPairFormat(m.code) })
      else
        m.top.message = "Enter all 8 characters first."
      end if
    end if
  end if
  paintFocus()
  return true
end function

function keyConfirm(intent as String) as Boolean
  if intent = "back"
    m.top.phase = "entry"
    m.top.message = ""
    return true
  end if
  if intent = "left" and m.choice > 0 then m.choice = m.choice - 1
  if intent = "right" and m.choice < 1 then m.choice = m.choice + 1
  if intent = "select"
    if m.choice = 0 then emit("approve", { code: hubPairFormat(m.code) }) else emit("deny", { code: hubPairFormat(m.code) })
  end if
  paintFocus()
  return true
end function
