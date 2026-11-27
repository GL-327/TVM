' Franchise intro drawn over the playback loading phase: a glow, two expanding
' rings, a light beam, a few rising embers and the title in type, all from shapes
' made in images/intro (no logos or film imagery). It ends on its own after the
' intro's length (2.5 to 4 s) with a short fade; any key skips. When the TV should
' not animate (Reduce motion, SD UI) it shows a still title card for 1.5 s.
' The scene sets pick (and staticCard) after the node is in the tree.
sub init()
  m.top.focusable = true
  m.stage = m.top.findNode("stage")
  m.embers = m.top.findNode("embers")
  m.glow = m.top.findNode("glow")
  m.ring1 = m.top.findNode("ring1")
  m.ring2 = m.top.findNode("ring2")
  m.beam = m.top.findNode("beam")
  m.card = m.top.findNode("card")
  m.mainTitle = m.top.findNode("mainTitle")
  m.subTitle = m.top.findNode("subTitle")
  m.rule = m.top.findNode("rule")
  m.skipHint = m.top.findNode("skipHint")
  m.endTimer = m.top.findNode("endTimer")
  m.fadeOut = m.top.findNode("fadeOut")
  m.mainTitle.font = tvmFont("bold", 168)
  m.subTitle.font = tvmFont("medium", 72)
  m.skipHint.font = tvmFontMeta()
  m.endTimer.observeField("fire", "onEnd")
  m.leaving = false
  m.finished = false
  m.skipped = false
end sub

sub onPick()
  pick = m.top.pick
  if pick = invalid or not pick.DoesExist("intro") then return
  def = pick.intro
  accent = introColor(def.accent)
  glow = introColor(def.glow)
  mainText = pick.title
  subText = ""
  if def.style = "mockingjay"
    mainText = "THE HUNGER GAMES"
    subText = pick.title
  else
    mainText = UCase(pick.title)
  end if
  m.mainTitle.text = mainText
  m.subTitle.text = subText
  m.rule.color = accent
  m.glow.blendColor = introColor(def.glow, "CC")
  m.ring1.blendColor = accent
  m.ring2.blendColor = glow
  m.beam.blendColor = accent
  hold = introHoldMs(m.top.staticCard, def.durationMs)
  m.endTimer.duration = hold / 1000.0
  m.fadeOut.delay = (hold / 1000.0) - 0.45
  if m.top.staticCard
    m.card.opacity = 1
    m.rule.opacity = 1
    m.glow.opacity = 0.5
    m.glow.scale = [0.9, 0.9]
  else
    buildEmbers(def, hold)
    for each name in ["glowIn", "ring1Go", "ring2Go", "beamGo", "cardIn", "ruleIn", "hintIn"]
      node = m.top.findNode(name)
      if node <> invalid then node.control = "start"
    end for
  end if
  m.fadeOut.control = "start"
  m.endTimer.control = "start"
end sub

' Eight embers rise from the lower half and fade. Fixed positions, no random state.
sub buildEmbers(def as Object, holdMs as Integer)
  i = 0
  while i < 8
    ember = CreateObject("roSGNode", "Poster")
    ember.id = "ember" + i.toStr()
    ember.uri = "pkg:/images/intro/ember.png"
    size = 36 + ((i * 7) mod 4) * 10
    ember.width = size
    ember.height = size
    if (i mod 2) = 0
      ember.blendColor = introColor(def.accent)
    else
      ember.blendColor = introColor(def.glow)
    end if
    x = 900 + ((i * 331) mod 2040)
    y0 = 1500 + ((i * 97) mod 300)
    ember.translation = [x, y0]
    ember.opacity = 0
    m.embers.appendChild(ember)
    anim = CreateObject("roSGNode", "Animation")
    anim.delay = 0.1 + (i * 0.17)
    anim.duration = 2.4 + ((i mod 3) * 0.3)
    anim.easeFunction = "outQuad"
    move = CreateObject("roSGNode", "Vector2DFieldInterpolator")
    move.key = [0.0, 1.0]
    move.keyValue = [[x, y0], [x + 120 - ((i * 53) mod 240), y0 - 800 - ((i * 41) mod 300)]]
    move.fieldToInterp = ember.id + ".translation"
    anim.appendChild(move)
    fade = CreateObject("roSGNode", "FloatFieldInterpolator")
    fade.key = [0.0, 0.25, 1.0]
    fade.keyValue = [0.0, 0.9, 0.0]
    fade.fieldToInterp = ember.id + ".opacity"
    anim.appendChild(fade)
    m.top.appendChild(anim)
    anim.control = "start"
    i = i + 1
  end while
end sub

sub onEnd()
  if m.finished then return
  m.finished = true
  m.top.action = { type: "done", skipped: m.skipped }
end sub

' Any key skips: a quick fade, then the same done action.
function onKeyEvent(key as String, press as Boolean) as Boolean
  if not press then return true
  if m.leaving or m.finished then return true
  m.leaving = true
  m.skipped = true
  m.endTimer.control = "stop"
  m.fadeOut.control = "stop"
  m.fadeOut.delay = 0
  m.fadeOut.duration = 0.22
  m.fadeOut.control = "start"
  m.endTimer.duration = 0.22
  m.endTimer.control = "start"
  return true
end function
