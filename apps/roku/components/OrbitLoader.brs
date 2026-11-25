sub init()
  m.comet = m.top.findNode("comet")
  m.top.findNode("status").font = tvmFontBody()
  m.speed = 0.35 : m.velocity = 0.0 : m.angle = 0.0
  m.clock = CreateObject("roTimespan") : m.clock.Mark()
  m.arrivalClock = CreateObject("roTimespan") : m.arrivalClock.Mark()
  m.dots = []
  for i = 0 to 59
    dot = CreateObject("roSGNode", "Poster")
    dot.uri = "pkg:/images/glass/dot.png" : dot.width = 5 : dot.height = 5
    angle = (i / 60.0) * 6.283185 - 1.570796
    dot.translation = [157.5 + Cos(angle) * 132, 157.5 + Sin(angle) * 132]
    dot.blendColor = "0x7DA9FFFF" : dot.visible = false
    m.top.findNode("progress").appendChild(dot) : m.dots.Push(dot)
  end for
  m.top.findNode("tick").observeField("fire", "onTick")
  onActive()
end sub

sub onActive()
  m.top.visible = m.top.active
  if m.top.active
    m.clock.Mark()
    m.top.findNode("tick").control = "start"
  else
    m.top.findNode("tick").control = "stop"
  end if
end sub

sub onStatus()
  m.top.findNode("status").text = m.top.status
end sub

sub onPercentage()
  if m.dots = invalid then return
  count = Int(m.top.percentage * 0.6)
  for i = 0 to 59
    m.dots[i].visible = i < count
  end for
end sub

sub onRate()
  if m.arrivalClock <> invalid then m.arrivalClock.Mark()
end sub

sub onTick()
  dt = m.clock.TotalMilliseconds() / 1000.0 : m.clock.Mark()
  if dt > 0.1 then dt = 0.1
  target = m.top.rate
  if m.arrivalClock.TotalMilliseconds() > 1500 then target = 0.35
  if target < 0.35 then target = 0.35
  if target > 2.4 then target = 2.4
  ' Critically damped spring (~400 ms); arrival changes never snap the comet.
  omega = 10.0
  delta = m.speed - target
  decay = Exp(-omega * dt)
  temp = (m.velocity + omega * delta) * dt
  m.speed = target + (delta + temp) * decay
  m.velocity = (m.velocity - omega * temp) * decay
  m.angle = m.angle + 6.283185 * 0.45 * m.speed * dt
  if m.angle > 6.283185 then m.angle = m.angle - 6.283185
  if tvmReduceMotion()
    m.comet.rotation = 0
    m.comet.opacity = 0.65 + Sin(m.angle) * 0.25
  else
    m.comet.rotation = m.angle
    m.comet.opacity = 1.0
  end if
end sub
