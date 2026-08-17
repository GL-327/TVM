function tvmFont(weight as String, size as Integer) as Object
  font = CreateObject("roSGNode", "Font")
  uri = "pkg:/fonts/Inter-Regular.otf"
  fallback = "font:SystemFontFile"
  if LCase(weight) = "bold"
    uri = "pkg:/fonts/Inter-Bold.otf"
    fallback = "font:BoldSystemFontFile"
  end if
  font.uri = uri
  if font.uri = invalid or font.uri = "" then font.uri = fallback
  font.size = size
  return font
end function

function tvmFontCaption() as Object
  return tvmFont("regular", 26)
end function

function tvmFontBody() as Object
  return tvmFont("regular", 34)
end function

function tvmFontBodyLg() as Object
  return tvmFont("bold", 40)
end function

function tvmFontTitle() as Object
  return tvmFont("bold", 56)
end function

function tvmFontDisplay() as Object
  return tvmFont("bold", 88)
end function

function tvmFontHero() as Object
  return tvmFont("bold", 144)
end function
