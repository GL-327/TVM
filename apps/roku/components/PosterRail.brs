' Windowed, infinitely looping rail. Only the visible cards plus a small buffer
' exist as nodes; cards that scroll out of the window go to a pool and are
' reused. When count > visible, item indices wrap modularly around count.
' Setting live = false drops every card, so rows far from focus cost almost nothing.
sub init()
  m.heading = m.top.findNode("heading")
  m.track = m.top.findNode("track")
  m.slideAnim = m.top.findNode("slideAnim")
  m.slideInterp = m.top.findNode("slideInterp")
  m.heading.font = tvmFontLabel()
  m.heading.color = tvmText()
  m.liveCards = {}
  m.pool = []
  m.count = 0
  m.viewFirst = 0
  m.focusSlot = 0
  m.lastCol = -1
  m.wasFocused = false
  m.buffer = 2
  m.top.width = 3840
  m.top.height = railRowHeight("portrait")
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

function cardPitch() as Integer
  if m.top.layout = "landscape" then return 840
  return 600
end function

function cardWidth() as Integer
  if m.top.layout = "landscape" then return 800
  return 560
end function

function visibleCount() as Integer
  return railVisibleCount(cardPitch(), cardWidth())
end function

function trackX(first as Integer) as Float
  return tvmSafeLeft() - (first * cardPitch())
end function

sub clearCards()
  for each key in m.liveCards
    m.track.removeChild(m.liveCards[key])
  end for
  m.liveCards = {}
  m.pool = []
end sub

sub onItems()
  if m.track = invalid then return
  clearCards()
  m.viewFirst = 0
  m.focusSlot = 0
  m.lastCol = -1
  m.wasFocused = false
  items = m.top.items
  m.count = 0
  if items <> invalid then m.count = items.Count()
  m.top.height = railRowHeight(m.top.layout)
  m.track.translation = [trackX(0), 100]
  if m.top.live then syncWindow()
  onFocusCol()
end sub

sub onLive()
  if m.track = invalid then return
  if m.top.live
    syncWindow()
    paintCards()
  else
    clearCards()
  end if
end sub

sub syncWindow()
  items = m.top.items
  if items = invalid or m.count <= 0 then return
  win = railWindow(m.count, m.viewFirst, visibleCount(), m.buffer)

  stale = []
  for each key in m.liveCards
    idx = Int(Val(key))
    if idx < win.first or idx > win.last then stale.Push(key)
  end for
  for each key in stale
    card = m.liveCards[key]
    m.track.removeChild(card)
    m.pool.Push(card)
    m.liveCards.Delete(key)
  end for

  pitch = cardPitch()
  i = win.first
  while i <= win.last
    key = StrI(i).Trim()
    if not m.liveCards.DoesExist(key)
      card = invalid
      if m.pool.Count() > 0
        card = m.pool.Pop()
      else
        card = CreateObject("roSGNode", "PosterCard")
        card.layout = m.top.layout
      end if
      card.hasFocusStyle = false
      card.dimmed = false
      card.item = items[railWrapIndex(i, m.count)]
      card.translation = [i * pitch, 0]
      m.track.appendChild(card)
      m.liveCards[key] = card
    end if
    i = i + 1
  end while
end sub

sub paintCards()
  col = m.top.focusCol
  for each key in m.liveCards
    slot = Int(Val(key))
    card = m.liveCards[key]
    card.hasFocusStyle = (col >= 0 and slot = m.focusSlot)
    card.dimmed = (col >= 0 and slot <> m.focusSlot)
  end for
end sub

sub onFocusCol()
  if m.track = invalid then return
  col = m.top.focusCol
  if col >= 0 and m.count > 0
    if col > m.count - 1 then col = m.count - 1
    vis = visibleCount()
    slot = railLoopSlot(col, m.lastCol, m.focusSlot, m.viewFirst, m.count, vis, m.wasFocused)
    m.lastCol = col
    m.focusSlot = slot
    m.wasFocused = true
    first = railLoopViewFirst(m.count, slot, m.viewFirst, vis)
    if first <> m.viewFirst
      m.viewFirst = first
      if m.top.live then syncWindow()
      slideTo(trackX(first))
    else if m.top.live
      syncWindow()
    end if
  else
    m.wasFocused = false
  end if
  if m.top.live then paintCards()
end sub

sub slideTo(x as Float)
  current = m.track.translation
  startX = tvmSafeLeft()
  if current <> invalid then startX = current[0]
  if m.slideAnim = invalid or m.slideInterp = invalid
    m.track.translation = [x, 100]
    return
  end if
  if tvmReduceMotion() or Abs(startX - x) < 2
    m.slideAnim.control = "stop"
    m.track.translation = [x, 100]
    return
  end if
  m.slideAnim.control = "stop"
  m.slideAnim.duration = tvmMotionPanel()
  m.slideInterp.keyValue = [[startX, 100], [x, 100]]
  m.slideAnim.control = "start"
end sub
