sub init()
  m.top.focusable = true
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
  m.retry = m.top.findNode("retry")
  m.retry.variant = "primary"
  m.retry.label = "Retry"
  m.retry.itemId = "retry"
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

sub onBody()
  m.lede.text = m.top.body
end sub

sub onFocusStyle()
  m.retry.hasFocusStyle = m.top.hasFocusStyle
end sub
