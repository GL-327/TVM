sub onExtras()
  if m.picker = invalid then return
  extras = m.top.extras
  label = m.top.findNode("comingUp")
  label.font = tvmFontMeta()
  label.text = "" : label.visible = false
  nextEp = aaGet(extras, "next", invalid)
  if nextEp <> invalid
    stamp = asText(aaGet(nextEp, "airstamp", ""))
    if stamp <> ""
      dt = CreateObject("roDateTime") : dt.FromISO8601String(stamp) : dt.ToLocalTime()
      weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      label.text = "Coming up: New episode " + weekdays[dt.GetDayOfWeek()] + ", " + dt.GetDayOfMonth().ToStr() + " " + months[dt.GetMonth() - 1]
      label.visible = true
    end if
  end if
  english = asText(aaGet(extras, "english", ""))
  if english <> "" and english <> asText(aaGet(m.top.item, "title", "")) then m.kicker.text = "ANIME  " + english
  m.collectionItems = []
  collection = aaGet(extras, "collection", {})
  if not m.seriesLike then m.collectionItems = aaArray(collection, "items")
  if m.collectionRail <> invalid then m.top.findNode("collectionHost").removeChild(m.collectionRail)
  m.collectionRail = invalid
  if m.collectionItems.Count() >= 1
    rail = CreateObject("roSGNode", "PosterRail")
    rail.title = "Collection: " + asText(aaGet(collection, "name", ""))
    rail.layout = "portrait" : rail.loop = false
    rail.items = m.collectionItems
    rail.translation = [0, 0]
    rail.focusCol = -1
    m.top.findNode("collectionHost").appendChild(rail)
    m.collectionRail = rail
    if m.collectionCol = invalid then m.collectionCol = 0
    if m.collectionCol >= m.collectionItems.Count() then m.collectionCol = 0
    if m.pendingCollectionId <> invalid and m.pendingCollectionId <> ""
      for i = 0 to m.collectionItems.Count() - 1
        if m.collectionItems[i].id = m.pendingCollectionId then m.zone = "collection" : m.collectionCol = i
      end for
      m.pendingCollectionId = ""
    end if
    if m.zone = "collection" then rail.focusCol = m.collectionCol
    paintFocus()
  else if m.zone = "collection"
    m.zone = "actions" : paintFocus()
  end if
end sub

function handleCollectionIntent(intent as String) as Boolean
  if m.collectionRail = invalid then return false
  if m.zone = "actions" and intent = "down"
    m.zone = "collection" : m.collectionCol = 0 : paintFocus()
    m.collectionRail.focusCol = m.collectionCol
    m.top.focusKey = "collection:" + m.collectionItems[m.collectionCol].id
    return true
  end if
  if m.zone <> "collection" then return false
  if intent = "back" or intent = "up"
    m.collectionRail.focusCol = -1
    m.zone = "actions" : paintFocus()
    return true
  end if
  if intent = "left" and m.collectionCol > 0 then m.collectionCol = m.collectionCol - 1
  if intent = "right" and m.collectionCol < m.collectionItems.Count() - 1 then m.collectionCol = m.collectionCol + 1
  m.collectionRail.focusCol = m.collectionCol
  m.top.focusKey = "collection:" + m.collectionItems[m.collectionCol].id
  if intent = "select" then emit("collection-details", { item: m.collectionItems[m.collectionCol] })
  return true
end function
