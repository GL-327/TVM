sub init()
  m.body = m.top.findNode("body")
  m.ring = m.top.findNode("ring")
  m.plate = m.top.findNode("plate")
  m.glow = m.top.findNode("glow")
  m.sheen = m.top.findNode("sheen")
  m.art = m.top.findNode("art")
  m.mark = m.top.findNode("mark")
  m.word = m.top.findNode("word")
  m.playBg = m.top.findNode("playBg")
  m.lockBg = m.top.findNode("lockBg")
  m.lockLabel = m.top.findNode("lockLabel")
  m.focusAnim = m.top.findNode("focusAnim")
  m.scaleInterp = m.top.findNode("scaleInterp")
  m.bars = []
  i = 0
  while i < 5
    m.bars.Push(m.top.findNode("bar" + StrI(i).Trim()))
    i = i + 1
  end while
  m.bits = []
  i = 0
  while i < 16
    m.bits.Push(m.top.findNode("bit" + StrI(i).Trim()))
    i = i + 1
  end while
  m.cuts = []
  i = 0
  while i < 3
    m.cuts.Push(m.top.findNode("cut" + StrI(i).Trim()))
    i = i + 1
  end while
  m.chips = []
  m.chipLs = []
  i = 0
  while i < 4
    m.chips.Push(m.top.findNode("chip" + StrI(i).Trim()))
    i = i + 1
  end while
  i = 0
  while i < 3
    m.chipLs.Push(m.top.findNode("chipL" + StrI(i).Trim()))
    i = i + 1
  end while
  m.top.focusable = true
  m.top.width = 284
  m.top.height = 155
  if m.body <> invalid then m.body.scaleRotateCenter = [142, 78]
  m.ring.width = 300
  m.ring.height = 171
  m.ring.translation = [-8, -8]
  if m.word <> invalid then m.word.font = tvmFont("bold", 36)
  if m.lockBg <> invalid
    m.lockBg.width = 92
    m.lockBg.height = 32
    m.lockBg.translation = [184, 10]
  end if
  if m.lockLabel <> invalid
    m.lockLabel.width = 92
    m.lockLabel.height = 32
    m.lockLabel.translation = [184, 10]
    m.lockLabel.font = tvmFontCaption()
  end if
  hideDecor()
  onLocked()
  if m.top.appId <> "" then paintPlate()
end sub

sub onLocked()
  m.top.focusable = true
  show = m.top.locked = true
  if m.lockBg <> invalid then m.lockBg.visible = show
  if m.lockLabel <> invalid then m.lockLabel.visible = show
end sub

sub onAppId()
  paintPlate()
end sub

sub hideNode(node)
  if node = invalid then return
  node.visible = false
  node.rotation = 0
end sub

sub hideDecor()
  hideNode(m.art)
  hideNode(m.mark)
  hideNode(m.glow)
  hideNode(m.sheen)
  hideNode(m.playBg)
  i = 0
  while i < m.bars.Count()
    hideNode(m.bars[i])
    i = i + 1
  end while
  i = 0
  while i < m.bits.Count()
    hideNode(m.bits[i])
    i = i + 1
  end while
  i = 0
  while i < m.cuts.Count()
    hideNode(m.cuts[i])
    i = i + 1
  end while
  i = 0
  while i < m.chips.Count()
    hideNode(m.chips[i])
    i = i + 1
  end while
  i = 0
  while i < m.chipLs.Count()
    hideNode(m.chipLs[i])
    i = i + 1
  end while
end sub

sub clearPosters()
  if m.art <> invalid
    m.art.uri = ""
    m.art.visible = false
  end if
  if m.mark <> invalid
    m.mark.uri = ""
    m.mark.visible = false
  end if
end sub

sub placeRect(node, color as String, x as Integer, y as Integer, w as Integer, h as Integer, radius as Integer)
  if node = invalid then return
  node.visible = true
  node.color = color
  node.width = w
  node.height = h
  node.translation = [x, y]
  node.cornerRadius = radius
  node.rotation = 0
end sub

sub placeRot(node, color as String, x as Integer, y as Integer, w as Integer, h as Integer, radius as Integer, rot as Float)
  placeRect(node, color, x, y, w, h, radius)
  if node = invalid then return
  node.scaleRotateCenter = [w * 0.5, h * 0.5]
  node.rotation = rot
end sub

sub placeBar(index as Integer, color as String, x as Integer, y as Integer, w as Integer, h as Integer, radius as Integer)
  if index < 0 or index >= m.bars.Count() then return
  placeRect(m.bars[index], color, x, y, w, h, radius)
end sub

sub placeBit(index as Integer, color as String, x as Integer, y as Integer, w as Integer, h as Integer, radius as Integer)
  if index < 0 or index >= m.bits.Count() then return
  placeRect(m.bits[index], color, x, y, w, h, radius)
end sub

sub placeCut(index as Integer, color as String, x as Integer, y as Integer, w as Integer, h as Integer, radius as Integer)
  if index < 0 or index >= m.cuts.Count() then return
  placeRect(m.cuts[index], color, x, y, w, h, radius)
end sub

sub placeWord(text as String, ink as String, size as Integer, x as Integer, y as Integer, w as Integer, h as Integer, align as String)
  if m.word = invalid then return
  m.word.visible = true
  m.word.text = text
  m.word.color = ink
  m.word.font = tvmFont("bold", size)
  m.word.translation = [x, y]
  m.word.width = w
  m.word.height = h
  m.word.horizAlign = align
  m.word.vertAlign = "center"
  m.word.rotation = 0
end sub

sub hideWord()
  if m.word <> invalid then m.word.visible = false
end sub

sub paintSheen(color as String)
  placeRect(m.sheen, color, 0, 0, 284, 52, 0)
end sub

sub paintPlate()
  if m.plate = invalid or m.word = invalid then return
  appId = m.top.appId
  if appId = invalid then appId = ""
  brand = tvmAppBrand(appId)
  app = tvmAppById(appId)
  hideDecor()
  clearPosters()

  m.plate.color = brand.plate
  word = appId
  if app <> invalid then word = app.wordmark
  placeWord(word, brand.ink, brand.wordSize, 0, 42, 284, 72, "center")

  key = LCase(appId)
  if key = "netflix"
    paintNetflix()
  else if key = "prime"
    paintPrime()
  else if key = "max"
    paintMax()
  else if key = "appletv"
    paintApple()
  else if key = "disney"
    paintDisney()
  else if key = "hulu"
    paintHulu()
  else if key = "peacock"
    paintPeacock()
  else if key = "youtube"
    paintYoutube()
  else if key = "iplayer"
    paintIplayer()
  else if key = "paramount"
    paintParamount()
  else if key = "tvm-stream"
    paintTvm()
  else if key = "tubi"
    paintTubi()
  else if key = "pluto"
    paintPluto()
  else if key = "starz"
    paintStarz()
  else if key = "fox"
    paintFox()
  else if key = "freevee"
    paintFreevee()
  else
    paintSheen("0xFFFFFF1A")
  end if
end sub

sub paintNetflix()
  m.plate.color = "0xE50914FF"
  paintSheen("0xFFFFFF14")
  hideWord()
  placeBar(0, "0xF5F5F5D1", 106, 20, 22, 116, 1)
  placeBar(1, "0xF5F5F5D1", 156, 20, 22, 116, 1)
  if m.bars.Count() > 3
    placeRot(m.bars[2], "0x00000038", 116, 28, 18, 100, 1, 0.54)
    placeRot(m.bars[3], "0xFFFFFFFF", 118, 16, 24, 122, 1, 0.54)
  end if
end sub

sub paintPrime()
  m.plate.color = "0x0F171EFF"
  placeRect(m.glow, "0x1A242DFF", 0, 0, 284, 72, 0)
  paintSheen("0xFFFFFF10")
  placeWord("prime video", "0xF5F5F5FF", 28, 12, 28, 260, 52, "center")
  placeBar(0, "0x00A8E1FF", 36, 102, 212, 38, 19)
  placeCut(0, "0x0F171EFF", 36, 92, 212, 30, 18)
end sub

sub paintMax()
  m.plate.color = "0x002BE7FF"
  paintSheen("0xFFFFFF14")
  hideWord()
  ink = "0xFFFFFFFF"
  hole = "0x002BE7FF"
  placeBit(0, ink, 38, 56, 12, 58, 6)
  placeBit(1, ink, 38, 46, 38, 30, 15)
  placeBit(2, ink, 64, 62, 12, 52, 6)
  placeBit(3, ink, 70, 56, 12, 58, 6)
  placeBit(4, ink, 70, 46, 38, 30, 15)
  placeBit(5, ink, 96, 62, 12, 52, 6)
  placeCut(0, hole, 50, 66, 16, 48, 6)
  placeCut(1, hole, 82, 66, 16, 48, 6)
  placeRect(m.playBg, ink, 118, 48, 54, 54, 27)
  placeCut(2, hole, 132, 62, 26, 26, 13)
  if m.bits.Count() > 13
    placeRot(m.bits[12], ink, 178, 48, 12, 60, 4, 0.64)
    placeRot(m.bits[13], ink, 178, 48, 12, 60, 4, -0.64)
  end if
end sub

sub paintApple()
  m.plate.color = "0x111111FF"
  placeRect(m.glow, "0x2C2C2CFF", 0, 0, 284, 70, 0)
  paintSheen("0xFFFFFF12")
  placeBit(0, "0xF5F5F5FF", 72, 48, 42, 50, 21)
  placeBit(1, "0xF5F5F5FF", 76, 62, 34, 36, 17)
  placeBit(2, "0xF5F5F5FF", 98, 36, 16, 10, 5)
  if m.bits.Count() > 2
    m.bits[2].scaleRotateCenter = [8, 5]
    m.bits[2].rotation = -0.6
  end if
  placeBit(3, "0xF5F5F5FF", 92, 40, 6, 10, 3)
  placeCut(0, "0x1A1A1AFF", 106, 64, 18, 20, 9)
  placeWord("tv", "0xF5F5F5FF", 52, 124, 42, 140, 72, "left")
end sub

sub paintDisney()
  m.plate.color = "0x0A1860FF"
  placeRect(m.glow, "0x1C4ED68C", 18, 6, 248, 104, 52)
  paintSheen("0xFFFFFF14")
  placeBar(0, "0xFFFFFFFF", 20, 40, 14, 74, 2)
  placeBar(1, "0xFFFFFFFF", 26, 40, 54, 74, 30)
  placeCut(0, "0x0A1860FF", 40, 54, 26, 46, 16)
  placeBit(0, "0xFFFFFFFF", 16, 30, 22, 22, 11)
  starsX = [22, 54, 118, 168, 214, 248, 86, 196]
  starsY = [18, 70, 14, 26, 16, 74, 122, 114]
  starsS = [5, 3, 4, 3, 5, 3, 3, 4]
  i = 0
  while i < 7
    placeBit(i + 1, "0xFFFFFFF2", starsX[i], starsY[i], starsS[i], starsS[i], 2)
    i = i + 1
  end while
  placeWord("isney+", "0xFFFFFFFF", 36, 84, 48, 186, 56, "left")
end sub

sub paintHulu()
  m.plate.color = "0x0B0B0BFF"
  hideWord()
  ink = "0x1CE783FF"
  ox = 40
  oy = 42
  placeBit(0, ink, ox, oy, 16, 68, 1)
  placeBit(1, ink, ox + 14, oy + 22, 10, 18, 1)
  placeBit(2, ink, ox + 20, oy + 22, 16, 46, 8)
  ux = ox + 50
  placeBit(3, ink, ux, oy + 22, 16, 34, 1)
  placeBit(4, ink, ux + 6, oy + 46, 36, 16, 8)
  placeBit(5, ink, ux + 28, oy + 22, 16, 46, 8)
  placeBit(6, ink, ox + 118, oy, 16, 68, 1)
  u2 = ox + 146
  placeBit(7, ink, u2, oy + 22, 16, 34, 1)
  placeBit(8, ink, u2 + 6, oy + 46, 36, 16, 8)
  placeBit(9, ink, u2 + 28, oy + 22, 16, 46, 8)
end sub

sub paintPeacock()
  m.plate.color = "0x000000FF"
  paintSheen("0xFFFFFF10")
  placeWord("peacock", "0xFFFFFFFF", 32, 12, 44, 220, 68, "left")
  colors = ["0xFCCC12FF", "0xFF7112FF", "0xEF1541FF", "0x6E55DCFF", "0x069DE0FF", "0x05AC3FFF"]
  i = 0
  while i < 6
    placeBit(i, colors[i], 248, 30 + i * 16, 14, 14, 7)
    i = i + 1
  end while
end sub

sub paintYoutube()
  m.plate.color = "0xFFFFFFFF"
  hideNode(m.sheen)
  placeRect(m.playBg, "0xFF0000FF", 22, 58, 52, 38, 10)
  placeBit(0, "0xFFFFFFFF", 40, 66, 8, 22, 1)
  placeBit(1, "0xFFFFFFFF", 48, 70, 8, 14, 1)
  placeBit(2, "0xFFFFFFFF", 56, 74, 8, 6, 1)
  placeWord("YouTube", "0x0F0F0FFF", 30, 84, 44, 188, 68, "left")
end sub

sub paintIplayer()
  m.plate.color = "0xFF4C98FF"
  paintSheen("0xFFFFFF22")
  letters = ["B", "B", "C"]
  startX = 76
  i = 0
  while i < 3
    x = startX + i * 46
    if i < m.chips.Count() then placeRect(m.chips[i], "0x111111FF", x, 24, 38, 38, 4)
    if i < m.chipLs.Count()
      lab = m.chipLs[i]
      if lab <> invalid
        lab.visible = true
        lab.text = letters[i]
        lab.color = "0xFFFFFFFF"
        lab.font = tvmFont("bold", 26)
        lab.width = 38
        lab.height = 38
        lab.translation = [x, 24]
      end if
    end if
    i = i + 1
  end while
  placeWord("iPlayer", "0xFFFFFFFF", 32, 0, 78, 284, 56, "center")
end sub

sub paintParamount()
  m.plate.color = "0x0064FFFF"
  paintSheen("0xFFFFFF1A")
  if m.bars.Count() > 1
    placeRot(m.bars[0], "0xFFFFFFFF", 122, 12, 14, 52, 1, 0.52)
    placeRot(m.bars[1], "0xFFFFFFFF", 148, 12, 14, 52, 1, -0.52)
  end if
  placeBit(0, "0xFFFFFFFF", 136, 10, 12, 12, 6)
  placeBit(1, "0xFFF5E6CC", 132, 18, 6, 6, 3)
  placeWord("paramount+", "0xFFFFFFFF", 26, 0, 72, 284, 56, "center")
end sub

sub paintTvm()
  m.plate.color = "0x5B3DFFFF"
  placeRect(m.glow, "0xB4DCFF5A", 70, 8, 144, 64, 32)
  paintSheen("0xFFFFFF1F")
  placeWord("TVM", "0xFFFFFFFF", 44, 0, 42, 284, 72, "center")
end sub

sub paintTubi()
  m.plate.color = "0xFA382FFF"
  paintSheen("0xFFFFFF1A")
  placeWord("tubi", "0xFFFFFFFF", 48, 0, 42, 284, 72, "center")
end sub

sub paintPluto()
  m.plate.color = "0x000000FF"
  paintSheen("0xFFFFFF10")
  placeWord("Pluto TV", "0xFFD400FF", 30, 0, 42, 284, 72, "center")
end sub

sub paintStarz()
  m.plate.color = "0x121212FF"
  paintSheen("0xFFFFFF10")
  placeWord("S T A R Z", "0xFFFFFFFF", 34, 0, 42, 284, 72, "center")
end sub

sub paintFox()
  m.plate.color = "0x000000FF"
  paintSheen("0xFFFFFF10")
  placeWord("FOX", "0xFFFFFFFF", 56, 0, 40, 284, 76, "center")
end sub

sub paintFreevee()
  m.plate.color = "0x111111FF"
  paintSheen("0xFFFFFF10")
  placeWord("freevee", "0xFFFFFFFF", 32, 0, 36, 284, 64, "center")
  placeBar(0, "0x00A8E1FF", 92, 104, 100, 6, 3)
end sub

sub onFocusStyle()
  focused = m.top.hasFocusStyle = true
  fromScale = [1.0, 1.0]
  toScale = [1.0, 1.0]
  if m.body <> invalid
    current = m.body.scale
    if current <> invalid then fromScale = current
  end if
  if focused
    m.ring.color = tvmFocus()
    toScale = [1.1, 1.1]
  else
    m.ring.color = "0x00000000"
    toScale = [1.0, 1.0]
  end if
  if m.body = invalid or m.focusAnim = invalid or m.scaleInterp = invalid
    m.top.scale = toScale
    return
  end if
  if Abs(fromScale[0] - toScale[0]) < 0.005
    m.body.scale = toScale
    return
  end if
  m.focusAnim.control = "stop"
  m.scaleInterp.keyValue = [fromScale, toScale]
  m.focusAnim.control = "start"
end sub
