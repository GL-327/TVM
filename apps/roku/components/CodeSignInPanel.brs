' "Sign in with a code": shows the short code and where to enter it while the
' scene polls pair/token (RFC 8628 device flow). Back or OK cancels. The scene
' owns the polling, the interval and the result; this panel only paints.
sub init()
  m.top.focusable = true
  m.title = m.top.findNode("title")
  m.step = m.top.findNode("step")
  m.code = m.top.findNode("code")
  m.uriLabel = m.top.findNode("uriLabel")
  m.status = m.top.findNode("status")
  m.hint = m.top.findNode("hint")
  m.seq = 0
  m.title.font = tvmFont("bold", tvmTypeSize(tvmTypePrimary()))
  m.title.color = tvmText()
  m.step.font = tvmFontSecondary()
  m.code.font = tvmFontHeroTitle()
  m.code.color = tvmText()
  m.uriLabel.font = tvmFontSecondary()
  m.status.font = tvmFontMeta()
  m.hint.font = tvmFontMeta()
  paint()
end sub

sub paint()
  if m.title = invalid then return
  m.step.text = "On your phone or computer, open the address below, sign in to TVM and enter this code."
  code = m.top.userCode
  if code = invalid or code = "" then code = "..."
  m.code.text = code
  m.uriLabel.text = m.top.uri
  m.status.text = m.top.message
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return false
  intent = intentFromKey(key)
  if intent = "back" or intent = "select"
    m.seq = m.seq + 1
    m.top.action = { type: "cancel", seq: m.seq }
  end if
  return true
end function
