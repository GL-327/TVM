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
  ' Accounts always use the private service through the on-device Task adapter.
  for each route in ["/api/account", "/api/rd/"]
    at = Instr(1, url, route)
    if at > 0 then url = "local:" + Mid(url, at)
  end for
  id = newRequestId()
  task = CreateObject("roSGNode", "ApiTask")
  task.requestUrl = url
  task.requestId = id
  task.requestMethod = method
  task.requestBody = body
  if Left(url, 6) = "local:"
    account = m.accountToken
    if isAccountToken(account) then task.accountToken = account.Trim()
  else if m.coreUrl <> invalid and m.coreUrl <> "" and coreOwnsUrl(m.coreUrl, url)
    token = m.coreToken
    if isCoreToken(token) then task.authToken = token.Trim()
    account = m.accountToken
    if isAccountToken(account) then task.accountToken = account.Trim()
    if m.deviceCredential <> invalid and m.deviceCredential <> "" and Instr(1, url, "/api/hub/") > 0 then task.deviceCredential = m.deviceCredential
  end if
  ' Hoster resolution can take longer than an ordinary catalog request.
  if Right(url, 13) = "/api/playback" then task.timeoutMs = 65000
  if m.profileMaxAge <> invalid then task.profileMaxAge = m.profileMaxAge
  if m.profileId <> invalid then task.profileId = m.profileId
  task.observeField("done", callback)
  task.control = "RUN"
  return task
end function
