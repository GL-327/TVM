' Pure geometry for the TVM Hub "Network" star. Nothing here touches a node,
' so apps/roku/scripts/spatial.test.mjs ports it to JS and runs the same
' fixture (scripts/fixtures/spatial-cases.json) through both.
'
' Devices keep a persistent slot assigned by Core ("slot", the lowest free
' integer at creation). Slot 0..5 are the six anchors on a tilted ellipse.
' A device with a slot >= 6 only takes a vacant anchor when one is free, so
' the layout depends on the set of slots and never on heartbeats. Devices
' that do not fit are counted by one focusable "More devices" node.
' Coordinates are 3840x2160 canvas units.

function spatialGeometry() as Object
  return { cx: 1340, cy: 1260, rx: 980, ratio: 0.58, depthMin: 0.84, depthMax: 1.0, maxSpokes: 6, orbR: 210, nodeR: 196 }
end function

' Anchor angles in degrees (0 = right, 90 = toward the viewer). Slot order
' reads upper-left, upper-right, lower-left, lower-right, top, left. 0 is
' reserved for the More node.
function spatialAnchors() as Object
  return [220, 320, 140, 40, 270, 180]
end function

function spatialMoreAngle() as Integer
  return 0
end function

function spatialVisibleSpokes(count as Integer) as Integer
  if count > 6 then return 6
  if count < 0 then return 0
  return count
end function

function spatialState(count as Integer) as String
  if count <= 0 then return "zero"
  if count = 1 then return "one"
  return "many"
end function

function spatialAtan2(y as Float, x as Float) as Float
  pi = 3.14159265
  if x > 0 then return Atn(y / x)
  if x < 0 and y >= 0 then return Atn(y / x) + pi
  if x < 0 and y < 0 then return Atn(y / x) - pi
  if y > 0 then return pi / 2
  if y < 0 then return 0 - (pi / 2)
  return 0
end function

' angle in degrees on the ellipse -> canvas position and depth scale.
' flat = Reduce Motion: same positions, every node at scale 1.0.
function spatialProject(angle as Float, geo as Object, flat as Boolean) as Object
  rad = angle * 3.14159265 / 180
  c = Cos(rad)
  s = Sin(rad)
  ry = geo.rx * geo.ratio
  scale = geo.depthMin + ((geo.depthMax - geo.depthMin) * (s + 1) / 2)
  if flat then scale = 1.0
  return { x: Int(geo.cx + (geo.rx * c) + 0.5), y: Int(geo.cy + (ry * s) + 0.5), scaleCenti: Int((scale * 100) + 0.5) }
end function

' [{ id, slot }] ascending by slot, then id. Missing slots sort last.
function spatialSorted(devices as Object) as Object
  out = []
  for each d in devices
    slot = aaGet(d, "slot", 9999)
    if Type(slot) <> "Integer" and Type(slot) <> "roInt" and Type(slot) <> "roInteger" then slot = 9999
    if slot < 0 then slot = 9999
    item = { id: asText(aaGet(d, "id", "")), slot: slot }
    at = out.Count()
    i = 0
    while i < out.Count()
      if item.slot < out[i].slot or (item.slot = out[i].slot and item.id < out[i].id)
        at = i
        exit while
      end if
      i = i + 1
    end while
    out.Push(item)
    j = out.Count() - 1
    while j > at
      out[j] = out[j - 1]
      j = j - 1
    end while
    out[at] = item
  end for
  return out
end function

' anchors[i] is a device id or "". overflow lists the ids that did not fit.
function spatialAssign(devices as Object) as Object
  sorted = spatialSorted(devices)
  maxN = 6
  anchors = []
  i = 0
  while i < maxN
    anchors.Push("")
    i = i + 1
  end while
  placed = {}
  for each item in sorted
    if item.slot < maxN and anchors[item.slot] = ""
      anchors[item.slot] = item.id
      placed[item.id] = true
    end if
  end for
  overflow = []
  for each item in sorted
    if not placed.DoesExist(item.id)
      free = -1
      k = 0
      while k < maxN
        if anchors[k] = ""
          free = k
          exit while
        end if
        k = k + 1
      end while
      if free >= 0
        anchors[free] = item.id
      else
        overflow.Push(item.id)
      end if
    end if
  end for
  return { anchors: anchors, overflow: overflow }
end function

function spatialSlotOf(devices as Object, id as String) as Integer
  for each d in devices
    if asText(aaGet(d, "id", "")) = id
      slot = aaGet(d, "slot", 9999)
      if Type(slot) = "Integer" or Type(slot) = "roInt" or Type(slot) = "roInteger" then return slot
      return 9999
    end if
  end for
  return 9999
end function

' The whole star: orb, up to six anchored nodes, an optional More node, and
' the back-to-front split used once to order the draw (behind the orb first).
function spatialLayout(devices as Object, geo as Object, flat as Boolean) as Object
  assign = spatialAssign(devices)
  anchorAngles = spatialAnchors()
  nodes = []
  i = 0
  while i < assign.anchors.Count()
    id = assign.anchors[i]
    if id <> ""
      p = spatialProject(anchorAngles[i], geo, flat)
      nodes.Push({ id: id, slot: spatialSlotOf(devices, id), anchor: i, x: p.x, y: p.y, scaleCenti: p.scaleCenti })
    end if
    i = i + 1
  end while
  more = invalid
  if assign.overflow.Count() > 0
    mp = spatialProject(spatialMoreAngle(), geo, flat)
    more = { id: "more", count: assign.overflow.Count(), x: mp.x, y: mp.y, scaleCenti: mp.scaleCenti, ids: assign.overflow }
  end if
  behind = []
  front = []
  for each n in nodes
    if n.y < geo.cy
      behind.Push(n.id)
    else
      front.Push(n.id)
    end if
  end for
  behind = spatialOrderByY(behind, nodes)
  front = spatialOrderByY(front, nodes)
  return { state: spatialState(devices.Count()), orb: { id: "account", x: geo.cx, y: geo.cy }, nodes: nodes, more: more, overflow: assign.overflow, behind: behind, front: front, flat: flat }
end function

function spatialNodeById(layout as Object, id as String) as Object
  if id = "account" then return { id: "account", slot: -1, x: layout.orb.x, y: layout.orb.y }
  for each n in layout.nodes
    if n.id = id then return n
  end for
  if layout.more <> invalid and id = "more" then return { id: "more", slot: 1000, x: layout.more.x, y: layout.more.y }
  return invalid
end function

' Ascending y (farthest first), ties by anchor.
function spatialOrderByY(ids as Object, nodes as Object) as Object
  out = []
  for each id in ids
    node = invalid
    for each n in nodes
      if n.id = id then node = n
    end for
    at = out.Count()
    i = 0
    while i < out.Count()
      other = invalid
      for each n in nodes
        if n.id = out[i] then other = n
      end for
      if node.y < other.y or (node.y = other.y and node.anchor < other.anchor)
        at = i
        exit while
      end if
      i = i + 1
    end while
    out.Push(id)
    j = out.Count() - 1
    while j > at
      out[j] = out[j - 1]
      j = j - 1
    end while
    out[at] = id
  end for
  return out
end function

' Focusable points in projected screen space: orb (slot -1), nodes (their
' slot) and the More node (slot 1000, so it loses every tie).
function spatialPoints(layout as Object) as Object
  pts = [{ id: "account", slot: -1, x: layout.orb.x, y: layout.orb.y }]
  for each n in layout.nodes
    pts.Push({ id: n.id, slot: n.slot, x: n.x, y: n.y })
  end for
  if layout.more <> invalid then pts.Push({ id: "more", slot: 1000, x: layout.more.x, y: layout.more.y })
  return pts
end function

' Nearest neighbour inside a 90 degree cone around the direction. score =
' distance + 0.5 * lateral offset; scores within 0.01 tie and the lower slot
' wins. Returns "" when nothing is in the cone.
function spatialNeighbour(points as Object, fromId as String, dir as String) as String
  from = invalid
  for each p in points
    if p.id = fromId then from = p
  end for
  if from = invalid then return ""
  best = ""
  bestScore = 0.0
  bestSlot = 0
  for each p in points
    if p.id <> fromId
      dx = p.x - from.x
      dy = p.y - from.y
      along = 0
      lateral = 0
      if dir = "right"
        along = dx
        lateral = Abs(dy)
      else if dir = "left"
        along = 0 - dx
        lateral = Abs(dy)
      else if dir = "down"
        along = dy
        lateral = Abs(dx)
      else if dir = "up"
        along = 0 - dy
        lateral = Abs(dx)
      end if
      if along > 0 and lateral <= along
        score = Sqr((dx * dx) + (dy * dy)) + (0.5 * lateral)
        take = false
        if best = ""
          take = true
        else if score < bestScore - 0.01
          take = true
        else if Abs(score - bestScore) <= 0.01 and p.slot < bestSlot
          take = true
        end if
        if take
          best = p.id
          bestScore = score
          bestSlot = p.slot
        end if
      end if
    end if
  end for
  return best
end function

' D-pad move from a node. kind is "focus" (id), "edge" (tabs / inspector /
' add) or "none" (left is a hard stop).
function spatialMove(layout as Object, fromId as String, dir as String) as Object
  target = spatialNeighbour(spatialPoints(layout), fromId, dir)
  if target <> "" then return { kind: "focus", id: target, edge: "" }
  if dir = "up" then return { kind: "edge", id: "", edge: "tabs" }
  if dir = "right" then return { kind: "edge", id: "", edge: "inspector" }
  if dir = "down" then return { kind: "edge", id: "", edge: "add" }
  return { kind: "none", id: "", edge: "" }
end function

' Focus after the graph changed. A focus that still exists stays put. Otherwise
' the closest stable neighbour (measured from where the focused node used to
' be) wins, ties to the lower slot; with nothing left, the account orb.
function spatialReconcileFocus(oldLayout as Object, newLayout as Object, focusId as String) as String
  if focusId = "account" then return "account"
  if spatialNodeById(newLayout, focusId) <> invalid then return focusId
  gone = spatialNodeById(oldLayout, focusId)
  if gone = invalid then return "account"
  best = "account"
  bestDist = -1.0
  bestSlot = 0
  for each p in spatialPoints(newLayout)
    if p.id <> "account"
      px = p.x
      py = p.y
      old = spatialNodeById(oldLayout, p.id)
      if old <> invalid
        px = old.x
        py = old.y
      end if
      dx = px - gone.x
      dy = py - gone.y
      dist = Sqr((dx * dx) + (dy * dy))
      take = false
      if bestDist < 0
        take = true
      else if dist < bestDist - 0.01
        take = true
      else if Abs(dist - bestDist) <= 0.01 and p.slot < bestSlot
        take = true
      end if
      if take
        best = p.id
        bestDist = dist
        bestSlot = p.slot
      end if
    end if
  end for
  return best
end function

' A spoke from the orb edge to the node edge: start point, length and angle
' (milliradians) for a rotated Poster.
function spatialSpoke(node as Object, geo as Object) as Object
  dx = node.x - geo.cx
  dy = node.y - geo.cy
  dist = Sqr((dx * dx) + (dy * dy))
  angle = spatialAtan2(dy, dx)
  ux = 0.0
  uy = 0.0
  if dist > 0
    ux = dx / dist
    uy = dy / dist
  end if
  length = dist - geo.orbR - ((geo.nodeR * node.scaleCenti) / 100)
  if length < 0 then length = 0
  return { x: Int(geo.cx + (ux * geo.orbR) + 0.5), y: Int(geo.cy + (uy * geo.orbR) + 0.5), length: Int(length + 0.5), milliRad: Int((angle * 1000) + 0.5) }
end function

' Two-line upright label, perLine characters wide (at least 4).
function spatialLabel(name as String, perLine as Integer) as Object
  text = name.Trim()
  if Len(text) <= perLine then return { l1: text, l2: "", cut: false }
  breakAt = 0
  p = perLine + 1
  while p >= 2
    if Mid(text, p, 1) = " "
      breakAt = p
      exit while
    end if
    p = p - 1
  end while
  l1 = ""
  rest = ""
  if breakAt > 0
    l1 = Left(text, breakAt - 1)
    rest = Mid(text, breakAt + 1)
  else
    l1 = Left(text, perLine)
    rest = Mid(text, perLine + 1)
  end if
  l1 = l1.Trim()
  rest = rest.Trim()
  if Len(rest) <= perLine then return { l1: l1, l2: rest, cut: false }
  return { l1: l1, l2: Left(rest, perLine - 3) + "...", cut: true }
end function

' Live node estimate for the Hub screen (HubScreen + tabs + Network + inspector).
' Used by the budget test; the Devices and Activity hosts are built lazily.
function spatialNodeEstimate(deviceCount as Integer) as Integer
  visible = spatialVisibleSpokes(deviceCount)
  nodes = 6 + (visible * 14)
  if deviceCount > 6 then nodes = nodes + 14
  return 120 + nodes
end function
