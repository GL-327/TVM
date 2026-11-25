sub init()
  m.plate = m.top.findNode("plate")
  m.host = m.top.findNode("modulesHost")
  m.renderedValue = ""
  m.renderedSize = 0
  onValue()
end sub

sub onValue()
  if m.plate = invalid or m.host = invalid then return
  boxSize = m.top.boxSize
  if boxSize <= 0 then boxSize = 620
  m.plate.width = boxSize
  m.plate.height = boxSize
  m.plate.color = m.top.plateColor
  m.top.width = boxSize
  m.top.height = boxSize

  val = m.top.value
  if val = invalid then val = ""
  if val = ""
    if m.renderedValue <> ""
      m.host.removeChildren(m.host.getChildren(-1, 0))
      m.renderedValue = ""
      m.renderedSize = 0
    end if
    return
  end if
  if val = m.renderedValue and boxSize = m.renderedSize then return

  encoded = qrEncode(val)
  if encoded = invalid then return
  m.host.removeChildren(m.host.getChildren(-1, 0))

  quiet = m.top.quietModules
  if quiet < 2 then quiet = 4
  totalModules = encoded.size + (2 * quiet)
  cell = Int(boxSize / totalModules)
  if cell >= 12
    cell = Int(cell / 6) * 6
  else if cell >= 4
    cell = Int(cell / 2) * 2
  end if
  if cell < 2 then cell = 2

  qrPx = encoded.size * cell
  offset = Int(((boxSize - qrPx) / 2) / 6) * 6
  if offset < quiet * cell then offset = Int((boxSize - qrPx) / 2)

  modColor = m.top.moduleColor
  runs = qrDarkRuns(encoded.modules)
  for each qrRun in runs
    rect = CreateObject("roSGNode", "Rectangle")
    rect.translation = [offset + (qrRun.x * cell), offset + (qrRun.y * cell)]
    rect.width = qrRun.w * cell
    rect.height = cell
    rect.color = modColor
    m.host.appendChild(rect)
  end for

  m.renderedValue = val
  m.renderedSize = boxSize
end sub
