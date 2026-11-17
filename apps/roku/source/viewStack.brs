' View stack rules match packages/nav: Back never empties the stack, Home
' returns to the root, and each entry can remember where focus was.

function makeEntry(keyNum as Integer, name as String, kind as String, params as Object) as Object
  entry = {}
  entry.key = name + "#" + StrI(keyNum).Trim()
  entry.name = name
  if params = invalid then params = {}
  entry.params = params
  entry.kind = kind
  entry.transient = false
  entry.focusKey = ""
  return entry
end function

function createViewStack(rootName as String) as Object
  state = {}
  state.entries = []
  state.entries.Push(makeEntry(0, rootName, "screen", {}))
  state.nextKey = 1
  return state
end function

function activeEntry(state as Object) as Object
  return state.entries[state.entries.Count() - 1]
end function

function canGoBack(state as Object) as Boolean
  return state.entries.Count() > 1
end function

function visibleScreen(state as Object) as Object
  i = state.entries.Count() - 1
  while i >= 0
    if state.entries[i].kind = "screen" then return state.entries[i]
    i = i - 1
  end while
  return state.entries[0]
end function

function copyEntries(entries as Object) as Object
  out = []
  for each entry in entries
    out.Push(entry)
  end for
  return out
end function

function dropTrailingModals(entries as Object) as Object
  last = entries.Count()
  while last > 1 and entries[last - 1].kind = "modal"
    last = last - 1
  end while
  out = []
  i = 0
  while i < last
    out.Push(entries[i])
    i = i + 1
  end while
  return out
end function

function viewStackPush(state as Object, name as String, params as Object) as Object
  nextState = {}
  nextState.nextKey = state.nextKey + 1
  entries = dropTrailingModals(state.entries)
  entries.Push(makeEntry(state.nextKey, name, "screen", params))
  nextState.entries = entries
  return nextState
end function

function viewStackPushModal(state as Object, name as String, params as Object) as Object
  nextState = {}
  nextState.nextKey = state.nextKey + 1
  entries = copyEntries(state.entries)
  entries.Push(makeEntry(state.nextKey, name, "modal", params))
  nextState.entries = entries
  return nextState
end function

function viewStackPop(state as Object) as Object
  if state.entries.Count() <= 1 then return state
  nextState = {}
  nextState.nextKey = state.nextKey
  entries = []
  last = state.entries.Count() - 1
  i = 0
  while i < last
    entries.Push(state.entries[i])
    i = i + 1
  end while
  while entries.Count() > 1 and entries[entries.Count() - 1].transient = true
    entries.Pop()
  end while
  nextState.entries = entries
  return nextState
end function

function viewStackHome(state as Object) as Object
  nextState = {}
  nextState.nextKey = state.nextKey
  nextState.entries = []
  nextState.entries.Push(state.entries[0])
  return nextState
end function

function viewStackReset(state as Object, name as String) as Object
  nextState = {}
  nextState.nextKey = state.nextKey + 1
  nextState.entries = []
  nextState.entries.Push(makeEntry(state.nextKey, name, "screen", {}))
  return nextState
end function

' Focus belongs to the screen the user is looking at, which is the last
' "screen" entry even when a modal (player, You menu) sits on top of it.
function viewStackRememberFocus(state as Object, focusKey as String) as Object
  target = state.entries.Count() - 1
  while target > 0 and state.entries[target].kind <> "screen"
    target = target - 1
  end while
  entries = []
  i = 0
  while i < state.entries.Count()
    if i = target
      src = state.entries[i]
      copy = {}
      copy.key = src.key
      copy.name = src.name
      copy.params = src.params
      copy.kind = src.kind
      copy.transient = src.transient
      copy.focusKey = focusKey
      entries.Push(copy)
    else
      entries.Push(state.entries[i])
    end if
    i = i + 1
  end while
  nextState = {}
  nextState.nextKey = state.nextKey
  nextState.entries = entries
  return nextState
end function
