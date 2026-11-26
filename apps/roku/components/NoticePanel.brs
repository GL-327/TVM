sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.close = m.top.findNode("close")
  if m.global <> invalid then m.top.findNode("card").backdropUri = asText(m.global.trendingHeroUri)
  m.seq = 0 : m.page = 0 : m.pages = [""]
  m.heading.font = tvmFont("bold", 64)
  m.lede.font = tvmFont("regular", 52)
  m.top.findNode("pageHint").font = tvmFont("medium", 40)
  m.close.variant = "primary"
  m.close.label = "Close"
  m.close.itemId = "close"
  m.close.hasFocusStyle = true
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

sub onBody()
  m.page = 0
  paginateNotice()
end sub

sub onButtonLabel()
  if m.top.buttonLabel <> "" then m.close.label = m.top.buttonLabel
end sub

' Patch notes: a taller card with room for the title, highlights, changes and known issues.
sub onTall()
  if not m.top.tall then return
  card = m.top.findNode("card")
  card.translation = [940, 260] : card.height = 1640
  m.heading.translation = [1060, 340]
  m.lede.translation = [1060, 580] : m.lede.maxLines = 12 : m.lede.height = 900
  m.top.findNode("pageHint").translation = [1640, 1680]
  m.close.translation = [1060, 1660]
  paginateNotice()
end sub

sub paginateNotice()
  if m.lede = invalid then return
  count = 4
  if m.top.tall then count = 12
  m.pages = tvmTextPages(m.top.body, 30, count)
  if m.page >= m.pages.Count() then m.page = m.pages.Count() - 1
  paintNoticePage()
end sub

sub paintNoticePage()
  m.lede.text = m.pages[m.page]
  hint = ""
  if m.pages.Count() > 1 then hint = "Up / Down: page " + (m.page + 1).ToStr() + " of " + m.pages.Count().ToStr()
  m.top.findNode("pageHint").text = hint
end sub

sub emit(kind as String)
  m.seq = m.seq + 1
  m.top.action = { type: kind, seq: m.seq }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "" then return true
  if intent = "back" then return false
  if intent = "up" and m.page > 0 then m.page = m.page - 1 : paintNoticePage()
  if intent = "down" and m.page < m.pages.Count() - 1 then m.page = m.page + 1 : paintNoticePage()
  if intent = "select"
    emit("close")
    return true
  end if
  return true
end function

' TVM Hub nav command: the same key a physical remote would send.
sub onRemoteIntent()
  intent = m.top.remoteIntent
  if intent = invalid or intent = "" then return
  keyName = keyFromIntent(intent)
  if keyName <> "" then onKeyEvent(keyName, true)
end sub
