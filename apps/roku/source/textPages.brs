' Conservative TV line lengths keep wide glyphs and unbroken URLs inside the sheet.
function tvmTextPages(text as String, columns as Integer, pageLines as Integer) as Object
  lines = []
  for each paragraph in text.Replace(Chr(13), "").Split(Chr(10))
    line = ""
    for each word in paragraph.Split(" ")
      if line <> "" and Len(line) + Len(word) + 1 > columns
        lines.Push(line) : line = ""
      end if
      while Len(word) > columns
        lines.Push(Left(word, columns))
        word = Mid(word, columns + 1)
      end while
      if word <> ""
        if line <> "" then line = line + " "
        line = line + word
      end if
    end for
    lines.Push(line)
  end for
  pages = [] : chunk = []
  for each line in lines
    chunk.Push(line)
    if chunk.Count() = pageLines
      pages.Push(chunk.Join(Chr(10))) : chunk = []
    end if
  end for
  if chunk.Count() > 0 then pages.Push(chunk.Join(Chr(10)))
  if pages.Count() = 0 then pages.Push("")
  return pages
end function
