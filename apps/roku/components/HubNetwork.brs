' Network tab: the account orb at the centre, up to six devices anchored on a
' tilted ellipse, spokes drawn as rotated spoke.png Posters, and one focusable
' "More devices" node. All geometry comes from source/spatial.brs.
'
' Updates are in place: a poll finds nodes by device id and rewrites their
' fields, so nothing is rebuilt or re-slotted on a heartbeat. Nodes are only
' added, removed or moved when the set of ids and slots changes. Draw order is
' fixed once per change: plane, spokes, nodes behind the orb, orb, nodes in
' front. Labels are never rotated.
sub init()
  m.top.focusable = false
  m.plane = m.top.findNode("plane")
  m.spokes = m.top.findNode("spokes")
  m.backNodes = m.top.findNode("backNodes")
  m.frontNodes = m.top.findNode("frontNodes")
  m.orbNode = m.top.findNode("orbNode")
  m.hint = m.top.findNode("hint")
  m.hint.font = tvmFontSecondary()
  m.geo = spatialGeometry()
  m.nodes = {}
  m.spokeNodes = {}
  m.devData = {}
  m.moreNode = invalid
  m.layout = spatialLayout([], m.geo, tvmReduceMotion())
  m.order = ""
  m.focusId = "account"
  m.orbNode.translation = [m.geo.cx - 210, m.geo.cy - 210]
  if m.global <> invalid
    if m.global.hasField("reduceMotion") then m.global.observeField("reduceMotion", "onDevices")
  end if
  paintFocus()
end sub

sub onAccount()
  if m.orbNode = invalid then return
  name = m.top.accountName
  if name = "" then name = "Your"
  m.orbNode.name = name + " account"
end sub

sub applyDevice(node as Object, d as Object)
  node.name = asText(aaGet(d, "name", "Device"))
  node.platform = asText(aaGet(d, "platform", ""))
  node.state = asText(aaGet(d, "state", "unknown"))
end sub

sub onDevices()
  if m.nodes = invalid then return
  devices = m.top.devices
  if devices = invalid then devices = []
  flat = tvmReduceMotion()
  old = m.layout
  fresh = spatialLayout(devices, m.geo, flat)
  m.devData = {}
  for each d in devices
    m.devData[asText(aaGet(d, "id", ""))] = d
  end for

  ' Remove nodes that are gone.
  keep = {}
  for each n in fresh.nodes
    keep[n.id] = true
  end for
  gone = []
  for each id in m.nodes
    if not keep.DoesExist(id) then gone.Push(id)
  end for
  for each id in gone
    node = m.nodes[id]
    if node.getParent() <> invalid then node.getParent().removeChild(node)
    spoke = m.spokeNodes[id]
    if spoke <> invalid and spoke.getParent() <> invalid then spoke.getParent().removeChild(spoke)
    m.nodes.Delete(id)
    m.spokeNodes.Delete(id)
  end for

  ' Add new nodes, rewrite existing ones in place, move only what moved.
  for each n in fresh.nodes
    node = m.nodes[n.id]
    if node = invalid
      node = CreateObject("roSGNode", "HubNode")
      node.kind = "device"
      node.deviceId = n.id
      m.nodes[n.id] = node
      spoke = CreateObject("roSGNode", "Poster")
      spoke.uri = "pkg:/images/glass/spoke.png"
      spoke.height = 24
      spoke.scaleRotateCenter = [0, 12]
      m.spokes.appendChild(spoke)
      m.spokeNodes[n.id] = spoke
      m.order = "dirty"
    end if
    applyDevice(node, m.devData[n.id])
    placeNode(node, n)
    placeSpoke(m.spokeNodes[n.id], n)
  end for

  ' The More node.
  if fresh.more <> invalid
    if m.moreNode = invalid
      m.moreNode = CreateObject("roSGNode", "HubNode")
      m.moreNode.kind = "more"
      m.moreNode.deviceId = "more"
      m.order = "dirty"
    end if
    m.moreNode.count = fresh.more.count
    placeNode(m.moreNode, fresh.more)
  else if m.moreNode <> invalid
    if m.moreNode.getParent() <> invalid then m.moreNode.getParent().removeChild(m.moreNode)
    m.moreNode = invalid
  end if

  ' Draw order only changes when the set of ids behind or in front changes.
  order = ""
  for each id in fresh.behind
    order = order + id + ","
  end for
  order = order + "|"
  for each id in fresh.front
    order = order + id + ","
  end for
  if fresh.more <> invalid then order = order + "|more"
  if order <> m.order
    m.order = order
    reorder(fresh)
  end if

  m.layout = fresh
  m.focusId = spatialReconcileFocus(old, fresh, m.focusId)
  m.top.focusId = m.focusId
  paintHint(devices.Count())
  paintFocus()
end sub

sub placeNode(node as Object, n as Object)
  d = node.diameter
  x = n.x - (d / 2)
  y = n.y - (d / 2)
  current = node.translation
  if current = invalid or current[0] <> x or current[1] <> y then node.translation = [x, y]
  depth = n.scaleCenti / 100.0
  if node.depth <> depth then node.depth = depth
end sub

sub placeSpoke(spoke as Object, n as Object)
  s = spatialSpoke(n, m.geo)
  spoke.width = s.length
  spoke.translation = [s.x, s.y - 12]
  ' spatialSpoke gives a screen-space angle (y down, clockwise); SceneGraph
  ' rotation is counter-clockwise, so negate it or every spoke mirrors vertically.
  spoke.rotation = -s.milliRad / 1000.0
end sub

' Z order: spokes sit under everything; nodes are re-appended back to front
' into the group on the right side of the orb.
sub reorder(fresh as Object)
  while m.backNodes.getChildCount() > 0
    m.backNodes.removeChildIndex(0)
  end while
  while m.frontNodes.getChildCount() > 0
    m.frontNodes.removeChildIndex(0)
  end while
  for each id in fresh.behind
    m.backNodes.appendChild(m.nodes[id])
  end for
  for each id in fresh.front
    m.frontNodes.appendChild(m.nodes[id])
  end for
  if m.moreNode <> invalid then m.frontNodes.appendChild(m.moreNode)
end sub

sub paintHint(count as Integer)
  state = spatialState(count)
  if state = "zero"
    m.hint.text = "No devices are linked yet. Choose Add device to link one."
    m.hint.visible = true
  else if state = "one"
    m.hint.text = "Only this device is linked. Add another to see it here."
    m.hint.visible = true
  else
    m.hint.visible = false
  end if
end sub

sub paintFocus()
  if m.orbNode = invalid then return
  has = (m.top.hasFocus = true)
  focusId = m.focusId
  selectedId = m.top.selectedId
  m.orbNode.focused = (has and focusId = "account")
  m.orbNode.selected = (not has and selectedId = "account")
  for each id in m.nodes
    node = m.nodes[id]
    node.focused = (has and focusId = id)
    node.selected = (not has and selectedId = id)
    spoke = m.spokeNodes[id]
    if focusId = id
      spoke.opacity = 1.0
      spoke.blendColor = "0xBFE0FFFF"
    else
      spoke.opacity = 0.65
      spoke.blendColor = "0xFFFFFFFF"
    end if
  end for
  if m.moreNode <> invalid
    m.moreNode.focused = (has and focusId = "more")
    m.moreNode.selected = (not has and selectedId = "more")
  end if
  m.top.focusKey = "network:" + focusId
end sub

sub onRestoreKey()
  key = m.top.restoreKey
  if key = invalid or key = "" then return
  id = key
  if Left(key, 8) = "network:" then id = Mid(key, 9)
  if id = "" then return
  if spatialNodeById(m.layout, id) <> invalid
    m.focusId = id
    m.top.focusId = id
    paintFocus()
  end if
end sub

' Focus lands on this device first (the node marked isCurrent), else the orb.
function focusFirst(arg as Dynamic) as String
  target = "account"
  for each d in m.top.devices
    if aaGet(d, "isCurrent", false) = true
      id = asText(aaGet(d, "id", ""))
      if spatialNodeById(m.layout, id) <> invalid then target = id
    end if
  end for
  m.focusId = target
  m.top.focusId = target
  paintFocus()
  return target
end function

' D-pad and OK. { type: "focus"|"edge"|"select"|"back"|"none", id, edge }.
function handleIntent(intent as String) as Object
  if intent = "up" or intent = "down" or intent = "left" or intent = "right"
    move = spatialMove(m.layout, m.focusId, intent)
    if move.kind = "focus"
      m.focusId = move.id
      m.top.focusId = move.id
      paintFocus()
      return { type: "focus", id: move.id, edge: "" }
    end if
    if move.kind = "edge" then return { type: "edge", id: "", edge: move.edge }
    return { type: "none", id: "", edge: "" }
  end if
  if intent = "select" then return { type: "select", id: m.focusId, edge: "" }
  if intent = "back" then return { type: "back", id: "", edge: "" }
  return { type: "none", id: "", edge: "" }
end function
