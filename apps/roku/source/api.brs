function newRequestId() as String
  if m.requestSeq = invalid then m.requestSeq = 0
  m.requestSeq = m.requestSeq + 1
  return StrI(m.requestSeq).Trim()
end function

function encodeQuery(value as String) as String
  xfer = CreateObject("roUrlTransfer")
  return xfer.Escape(value)
end function

function startApiGet(url as String, callback as String) as Object
  return startApiRequest(url, "GET", "", callback)
end function

function startApiRequest(url as String, method as String, body as String, callback as String) as Object
  id = newRequestId()
  task = CreateObject("roSGNode", "ApiTask")
  task.requestUrl = url
  task.requestId = id
  task.requestMethod = method
  task.requestBody = body
  if m.profileId <> invalid then task.profileId = m.profileId
  task.observeField("done", callback)
  task.control = "RUN"
  return task
end function
