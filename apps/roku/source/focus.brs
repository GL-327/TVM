' Pure focus-key and rail-window maths for Home rails. Nothing here touches a
' node, so apps/roku/scripts/focus.test.mjs ports it to JS and runs the same
' fixture (scripts/fixtures/focus-cases.json) through both.
'
' Focus keys are built from ids, never indexes:
'   rails:<railId>:<itemId>   a card on a rail (itemId may itself contain ":")
'   hero:<col>                0 Play, 1 Details
'   nav:<col>                 0..5 tabs, 6 profile orb

function sanitizeRailId(railId as String) as String
  out = ""
  i = 1
  while i <= Len(railId)
    ch = Mid(railId, i, 1)
    if ch = ":" then ch = "_"
    out = out + ch
    i = i + 1
  end while
  return out
end function

function railFocusKey(railId as String, itemId as String) as String
  return "rails:" + sanitizeRailId(railId) + ":" + itemId
end function

' Splits at the first two colons only, so item ids like "live:abc" stay whole.
function parseFocusKey(key as String) as Object
  out = { zone: "", a: "", b: "" }
  if key = "" then return out
  first = Instr(1, key, ":")
  if first = 0
    out.zone = key
    return out
  end if
  out.zone = Left(key, first - 1)
  rest = Mid(key, first + 1)
  if out.zone = "rails"
    second = Instr(1, rest, ":")
    if second = 0
      out.a = rest
    else
      out.a = Left(rest, second - 1)
      out.b = Mid(rest, second + 1)
    end if
  else
    out.a = rest
  end if
  return out
end function

' rails: [{ id, items: [{ id }] }]. Finds the item by id; when the rail or the
' item has moved or vanished, falls back to the clamped previous position.
function resolveRailFocus(rails as Object, railId as String, itemId as String, fallbackRow as Integer, fallbackCol as Integer) as Object
  count = rails.Count()
  if count = 0 then return { row: 0, col: 0, found: false }
  wanted = sanitizeRailId(railId)
  row = -1
  i = 0
  while i < count
    if sanitizeRailId(asText(rails[i].id)) = wanted
      row = i
      exit while
    end if
    i = i + 1
  end while
  if row >= 0 and itemId <> ""
    items = rails[row].items
    j = 0
    while j < items.Count()
      if asText(items[j].id) = itemId then return { row: row, col: j, found: true }
      j = j + 1
    end while
  end if
  if row < 0
    row = fallbackRow
    if row > count - 1 then row = count - 1
    if row < 0 then row = 0
  end if
  size = rails[row].items.Count()
  col = fallbackCol
  if col > size - 1 then col = size - 1
  if col < 0 then col = 0
  return { row: row, col: col, found: false }
end function

' Smallest scroll that keeps `focus` inside the visible span of `visible` cards.
function railViewFirst(count as Integer, focus as Integer, prevFirst as Integer, visible as Integer) as Integer
  first = prevFirst
  if focus >= 0
    if focus < first then first = focus
    if focus > first + visible - 1 then first = focus - visible + 1
  end if
  maxFirst = count - visible
  if maxFirst < 0 then maxFirst = 0
  if first > maxFirst then first = maxFirst
  if first < 0 then first = 0
  return first
end function

' Live card span: the visible cards plus `buffer` each side.
function railWindow(count as Integer, viewFirst as Integer, visible as Integer, buffer as Integer) as Object
  if count <= 0 then return { first: 0, last: -1 }
  first = viewFirst - buffer
  if first < 0 then first = 0
  last = viewFirst + visible - 1 + buffer
  if last > count - 1 then last = count - 1
  return { first: first, last: last }
end function

' Rows that keep live cards: the focused row, one above and two below.
function railRowLive(row as Integer, focusRow as Integer) as Boolean
  anchor = focusRow
  if anchor < 0 then anchor = 0
  return row >= anchor - 1 and row <= anchor + 2
end function

' Cards visible across the safe width at the given pitch (rails don't loop).
function railVisibleCount(pitch as Integer, cardW as Integer) as Integer
  usable = tvmSafeRight() - tvmSafeLeft()
  n = Int((usable + (pitch - cardW)) / pitch)
  if n < 1 then n = 1
  return n
end function

' A cheap change signature so the 90 s poll only rebuilds rails whose
' contents changed (ids, order and progress).
function railsSignature(rails as Object) as String
  sig = ""
  for each rail in rails
    sig = sig + "|" + asText(rail.id) + "#"
    for each item in rail.items
      sig = sig + asText(item.id)
      progress = aaGet(item, "progress", invalid)
      if progress <> invalid then sig = sig + "@" + StrI(Int(progress * 100)).Trim()
      sig = sig + ","
    end for
  end for
  return sig
end function

' Vertical room one rail takes on Home (heading + cards + caption + focus lift).
function railRowHeight(layout as String) as Integer
  if layout = "landscape" then return 640
  return 1040
end function

' Live-node estimate includes the card, body, glow, rim, fill, mask, artwork,
' progress, fallback/caption and its animation with four interpolators.
function railLiveNodeEstimate(count as Integer, visible as Integer, buffer as Integer, live as Boolean) as Integer
  base = 5
  if not live then return base
  cards = visible + (buffer * 2)
  if cards > count then cards = count
  return base + (cards * 16)
end function

' Left/Right across the strip (6 tabs + the profile orb). Hard stops, no wrap.
function navStep(col as Integer, intent as String, count as Integer) as Integer
  result = col
  if intent = "left" and result > 0 then result = result - 1
  if intent = "right" and result < count - 1 then result = result + 1
  return result
end function

' Hero buttons: 0 Play, 1 Details.
function heroStep(col as Integer, intent as String) as Integer
  result = col
  if intent = "left" and result > 0 then result = result - 1
  if intent = "right" and result < 1 then result = result + 1
  return result
end function
