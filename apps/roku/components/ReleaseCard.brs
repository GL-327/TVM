sub init()
  m.title = m.top.findNode("title") : m.title.font = tvmFont("semibold", 60)
  m.body = m.top.findNode("body") : m.body.font = tvmFont("regular", 44)
  paint()
end sub

sub paint()
  if m.title = invalid then return
  m.title.text = m.top.title
  m.body.text = m.top.body
end sub
