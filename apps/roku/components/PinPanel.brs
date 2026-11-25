sub init()
  m.top.focusable = true
  m.pin = "" : m.col = 0 : m.seq = 0 : m.busy = false
  m.heading = m.top.findNode("heading") : m.heading.font = tvmFontTitle()
  m.dots = m.top.findNode("dots") : m.dots.font = tvmFontTitle()
  m.message = m.top.findNode("message") : m.message.font = tvmFontBody()
  m.keys = [] : m.labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Delete", "0", "Done"]
  for i = 0 to 11
    btn = CreateObject("roSGNode", "FocusButton")
    btn.variant = "glassPill" : btn.pillWidth = 400 : btn.label = m.labels[i]
    btn.translation = [(i mod 3) * 440, Int(i / 3) * 220]
    m.top.findNode("keys").appendChild(btn) : m.keys.Push(btn)
  end for
  m.top.findNode("tick").observeField("fire", "onTick")
  paint()
end sub

sub onWrong()
  m.pin = "" : m.busy = false
  if not tvmReduceMotion() then m.top.findNode("shake").control = "start"
  paint()
end sub

sub onCooldown()
  m.remaining = m.top.cooldown
  m.top.findNode("tick").control = "start"
  m.pin = "" : m.busy = false
  paint()
end sub

sub onTick()
  if m.remaining > 0 then m.remaining = m.remaining - 1
  if m.remaining <= 0 then m.top.findNode("tick").control = "stop"
  paint()
end sub

sub paint()
  if m.heading = invalid then return
  m.heading.text = m.top.heading
  m.message.text = m.top.message
  if m.remaining <> invalid and m.remaining > 0 then m.message.text = "Try again in " + StrI(m.remaining).Trim() + " seconds"
  dots = ""
  for i = 1 to 4
    if i <= Len(m.pin) then dots = dots + "●  " else dots = dots + "○  "
  end for
  m.dots.text = dots
  for i = 0 to 11
    m.keys[i].hasFocusStyle = (i = m.col)
  end for
end sub

sub digit(value as String)
  if m.busy then return
  if m.remaining <> invalid and m.remaining > 0 then return
  if value = "Delete"
    if Len(m.pin) > 0 then m.pin = Left(m.pin, Len(m.pin) - 1)
  else if value = "Done"
    if Len(m.pin) = 4
      m.busy = true : m.seq = m.seq + 1
      m.top.action = { pin: m.pin, seq: m.seq }
    end if
  else if Len(m.pin) < 4
    m.pin = m.pin + value
  end if
  paint()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "back" then return false
  ch = typedCharFromKey(key)
  if Len(ch) = 1 and Instr(1, "0123456789", ch) > 0 then digit(ch)
  if intent = "left" and m.col mod 3 > 0 then m.col = m.col - 1
  if intent = "right" and m.col mod 3 < 2 then m.col = m.col + 1
  if intent = "up" and m.col >= 3 then m.col = m.col - 3
  if intent = "down" and m.col < 9 then m.col = m.col + 3
  if intent = "select" then digit(m.labels[m.col])
  paint()
  return true
end function
