sub init()
  m.heading = m.top.findNode("heading")
  m.track = m.top.findNode("track")
  m.slideAnim = m.top.findNode("slideAnim")
  m.slideInterp = m.top.findNode("slideInterp")
  m.heading.font = tvmFontBodyLg()
  m.cards = []
  m.count = 0
  m.copies = 1
  m.cursor = 0
  m.lastLogical = -1
  m.top.width = 3840
  m.top.height = 620
  if m.slideAnim <> invalid then m.slideAnim.observeField("state", "onSlideState")
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

function cardPitch() as Integer
  if m.top.layout = "landscape" then return 424
  return 302
end function

function looping() as Boolean
  return m.count >= 2
end function

sub onItems()
  if m.track = invalid then return
  while m.track.getChildCount() > 0
    m.track.removeChildIndex(0)
  end while
  m.cards = []
  m.lastLogical = -1
  m.cursor = 0

  items = m.top.items
  if items = invalid then return
  m.count = items.Count()
  m.copies = 1
  if looping() then m.copies = 3

  pitch = cardPitch()
  if m.top.layout = "landscape"
    m.top.height = 430
  else
    m.top.height = 620
  end if

  copy = 0
  while copy < m.copies
    i = 0
    while i < m.count
      card = CreateObject("roSGNode", "PosterCard")
      card.layout = m.top.layout
      card.item = items[i]
      card.translation = [(copy * m.count + i) * pitch, 0]
      m.track.appendChild(card)
      m.cards.Push(card)
      i = i + 1
    end while
    copy = copy + 1
  end while
  if looping() then m.cursor = m.count
  m.track.translation = [trackX(m.cursor), 88]
  onFocusCol()
end sub

function trackX(visualIndex as Integer) as Float
  pitch = cardPitch()
  artW = 275
  if m.top.layout = "landscape" then artW = 396
  return 160 + ((3840 - 160 - artW) / 2) - (visualIndex * pitch)
end function

sub slideTo(x as Float)
  if m.track = invalid then return
  current = m.track.translation
  startX = 160
  if current <> invalid then startX = current[0]
  if Abs(startX - x) < 2
    m.track.translation = [x, 88]
    normalizeCursor()
    return
  end if
  if m.slideAnim = invalid or m.slideInterp = invalid
    m.track.translation = [x, 88]
    normalizeCursor()
    return
  end if
  m.slideAnim.control = "stop"
  m.pendingX = x
  m.slideInterp.keyValue = [[startX, 88], [x, 88]]
  m.slideAnim.control = "start"
end sub

sub onSlideState()
  if m.slideAnim = invalid then return
  if m.slideAnim.state <> "stopped" then return
  normalizeCursor()
end sub

sub normalizeCursor()
  if not looping() then return
  shifted = false
  while m.cursor >= m.count * 2
    m.cursor = m.cursor - m.count
    shifted = true
  end while
  while m.cursor < m.count
    m.cursor = m.cursor + m.count
    shifted = true
  end while
  if shifted
    m.track.translation = [trackX(m.cursor), 88]
  end if
  paintCards()
end sub

sub paintCards()
  col = m.top.focusCol
  i = 0
  while i < m.cards.Count()
    focused = (col >= 0 and i = m.cursor)
    m.cards[i].hasFocusStyle = focused
    m.cards[i].dimmed = (col >= 0 and i <> m.cursor)
    i = i + 1
  end while
end sub

sub onFocusCol()
  if m.cards = invalid then return
  col = m.top.focusCol
  if col < 0
    paintCards()
    m.lastLogical = -1
    return
  end if

  prev = m.lastLogical
  wrapRight = (prev = m.count - 1 and col = 0)
  wrapLeft = (prev = 0 and col = m.count - 1)
  if wrapRight
    m.cursor = m.cursor + 1
  else if wrapLeft
    m.cursor = m.cursor - 1
  else if prev >= 0
    m.cursor = m.cursor + (col - prev)
  else if looping()
    m.cursor = m.count + col
  else
    m.cursor = col
  end if
  m.lastLogical = col
  paintCards()
  slideTo(trackX(m.cursor))
end sub
