sub init()
  m.top.functionName = "exec"
end sub

sub exec()
  result = {}
  result.ok = false
  result.statusCode = 0
  result.json = {}
  result.error = ""
  result.requestId = m.top.requestId

  url = m.top.requestUrl
  if url = invalid or url = ""
    result.error = "missing_url"
    applyResult(result)
    return
  end if

  method = m.top.requestMethod
  if method = invalid or method = "" then method = "GET"
  method = UCase(method)

  transfer = CreateObject("roUrlTransfer")
  port = CreateObject("roMessagePort")
  transfer.SetPort(port)
  transfer.SetUrl(url)
  transfer.EnableEncodings(true)
  transfer.RetainBodyOnError(true)
  transfer.AddHeader("Accept", "application/json")
  if m.top.profileId <> invalid and m.top.profileId <> ""
    transfer.AddHeader("X-TVM-Profile", m.top.profileId)
  end if

  if LCase(Left(url, 8)) = "https://"
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
  end if

  sent = false
  if method = "GET"
    sent = transfer.AsyncGetToString()
  else
    transfer.AddHeader("Content-Type", "application/json")
    transfer.SetRequest(method)
    body = m.top.requestBody
    if body = invalid then body = ""
    sent = transfer.AsyncPostFromString(body)
  end if

  if not sent
    result.error = "request_failed"
    applyResult(result)
    return
  end if

  msg = wait(20000, port)
  if msg = invalid
    transfer.AsyncCancel()
    result.error = "timeout"
    applyResult(result)
    return
  end if

  if type(msg) <> "roUrlEvent"
    result.error = "request_failed"
    applyResult(result)
    return
  end if

  code = msg.GetResponseCode()
  result.statusCode = code
  body = msg.GetString()
  parsed = ParseJson(body)
  if parsed <> invalid then result.json = parsed

  if code < 200 or code >= 300
    result.error = "http_" + StrI(code).Trim()
    applyResult(result)
    return
  end if

  if parsed = invalid
    result.error = "invalid_json"
    applyResult(result)
    return
  end if

  result.ok = true
  applyResult(result)
end sub

sub applyResult(result as Object)
  m.top.requestId = result.requestId
  m.top.statusCode = result.statusCode
  m.top.json = result.json
  m.top.error = result.error
  m.top.ok = result.ok
  m.top.done = true
end sub
