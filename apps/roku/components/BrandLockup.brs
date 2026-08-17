sub init()
  m.mark = m.top.findNode("mark")
  m.word = m.top.findNode("word")
  layout()
end sub

sub layout()
  if m.mark = invalid then return
  kind = m.top.kind
  if kind = "wordmark"
    m.mark.width = 28
    m.mark.height = 28
    m.mark.translation = [0, 10]
    m.word.text = "TVM"
    m.word.color = tvmText()
    m.word.font = tvmFont("bold", 48)
    m.word.translation = [44, 0]
    m.word.width = 280
    m.top.width = 324
    m.top.height = 56
  else
    m.mark.width = 22
    m.mark.height = 22
    m.mark.translation = [0, 14]
    m.word.text = "tvm stream"
    m.word.color = tvmAccentBlue()
    m.word.font = tvmFont("bold", 36)
    m.word.translation = [36, 4]
    m.word.width = 420
    m.top.width = 456
    m.top.height = 48
  end if
end sub
