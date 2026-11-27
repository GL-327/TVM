' Franchise intro rules. Pure logic, no nodes: it mirrors apps/ui/src/intros/introLogic.ts
' and reads the shared packages/content/intros.json (bundled copy in source/data/content).
' The scene asks introPlan when playback starts and introMarkPlayed when the intro ends.

function introIsString(value as Dynamic) as Boolean
  kind = Type(value)
  return kind = "roString" or kind = "String"
end function

function introIsNumber(value as Dynamic) as Boolean
  kind = Type(value)
  return kind = "roInt" or kind = "Integer" or kind = "roFloat" or kind = "Float" or kind = "Double" or kind = "roDouble" or kind = "LongInteger"
end function

function introMinMs() as Integer
  return 2500
end function

function introMaxMs() as Integer
  return 4000
end function

function introClampMs(ms as Dynamic) as Integer
  if not introIsNumber(ms) then return introMaxMs()
  value = Int(ms + 0.5)
  if value < introMinMs() then return introMinMs()
  if value > introMaxMs() then return introMaxMs()
  return value
end function

function introIsDef(value as Dynamic) as Boolean
  if Type(value) <> "roAssociativeArray" then return false
  if not introIsString(value.id) then return false
  if value.style <> "mockingjay" and value.style <> "doom" then return false
  if Type(value.imdbIds) <> "roArray" then return false
  if not introIsString(value.titlePattern) then return false
  if not introIsString(value.accent) or not introIsString(value.glow) then return false
  if not introIsNumber(value.durationMs) then return false
  if Type(value.titles) <> "roAssociativeArray" then return false
  return true
end function

' The usable intro definitions from the parsed intros.json document.
function introDefs(doc as Dynamic) as Object
  out = []
  if Type(doc) <> "roAssociativeArray" then return out
  if Type(doc.intros) <> "roArray" then return out
  for each def in doc.intros
    if introIsDef(def) then out.Push(def)
  end for
  return out
end function

' tt0371746:1:2, tt0371746 and /tt0371746 all give tt0371746. "" when there is no id.
function introBaseImdb(id as Dynamic) as String
  if not introIsString(id) then return ""
  found = CreateObject("roRegex", "tt[0-9]+", "i").Match(id.Trim())
  if found.Count() = 0 then return ""
  return LCase(found[0])
end function

' "#E8A33D" -> "0xE8A33DFF" (alpha is a two-digit hex string). Bad input gives white.
function introColor(hex as Dynamic, alpha = "FF" as String) as String
  if introIsString(hex) and CreateObject("roRegex", "^#[0-9a-fA-F]{6}$", "").IsMatch(hex) then return "0x" + UCase(Mid(hex, 2)) + alpha
  return "0xFFFFFF" + alpha
end function

function introCardTitle(def as Object, imdb as String, played as String) as String
  if imdb <> "" and def.titles.DoesExist(imdb) and introIsString(def.titles[imdb]) then return def.titles[imdb]
  if def.style = "mockingjay"
    return CreateObject("roRegex", "^the hunger games:?\s*", "i").ReplaceAll(played, "").Trim()
  end if
  return played.Trim()
end function

' The first definition matching by IMDb id, else by title pattern; invalid when none.
function introMatch(id as Dynamic, title as Dynamic, defs as Object) as Object
  imdb = introBaseImdb(id)
  name = ""
  if introIsString(title) then name = title.Trim()
  for each def in defs
    byId = false
    if imdb <> ""
      for each known in def.imdbIds
        if introIsString(known) and LCase(known) = imdb then byId = true
      end for
    end if
    byTitle = false
    if not byId and name <> ""
      byTitle = CreateObject("roRegex", def.titlePattern, "i").IsMatch(name)
    end if
    if byId or byTitle
      intro = {}
      for each key in def
        intro[key] = def[key]
      end for
      intro.durationMs = introClampMs(def.durationMs)
      titleKey = imdb
      if titleKey = "" then titleKey = def.id + ":" + LCase(name)
      return { intro: intro, titleKey: titleKey, title: introCardTitle(def, imdb, name) }
    end if
  end for
  return invalid
end function

' The intro to play now, or invalid: live, switched off, automated, unmatched or already seen.
' input = { id, title, live, enabled, automation }; played = the session's AA of title keys.
function introPlan(input as Object, defs as Object, played as Object) as Object
  if input.live = true or input.enabled <> true or input.automation = true then return invalid
  pick = introMatch(input.id, input.title, defs)
  if pick = invalid then return invalid
  if played.DoesExist(pick.titleKey) then return invalid
  return pick
end function

sub introMarkPlayed(played as Object, titleKey as String)
  played[titleKey] = true
end sub

' A static title card instead of the animation: Reduce motion, or a TV with an SD-class UI.
function introStaticCard(reduceMotion as Boolean, uiHeight as Integer) as Boolean
  return reduceMotion or uiHeight < 720
end function

function introHoldMs(isStatic as Boolean, durationMs as Integer) as Integer
  if isStatic then return 1500
  return durationMs
end function
