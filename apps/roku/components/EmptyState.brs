sub init()
  m.heading = m.top.findNode("heading")
  m.lede = m.top.findNode("lede")
end sub

sub onTitle()
  m.heading.text = m.top.title
end sub

sub onBody()
  m.lede.text = m.top.body
end sub
