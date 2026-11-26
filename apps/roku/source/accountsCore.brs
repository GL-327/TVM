' Called only in ApiTask. Never persist account records, passwords or RD tokens.
sub lcPurgeLegacyAccounts()
  sec = lcReg()
  changed = false
  for each key in ["localAccounts", "localSessions", "localRdToken"]
    if sec.Exists(key)
      sec.Delete(key)
      changed = true
    end if
  end for
  if changed then sec.Flush()
end sub

function lcAccountsHttp(ctx as Object, path as String, method = "GET" as String, body = invalid as Dynamic, sendAuth = true as Boolean) as Object
  headers = { Accept: "application/json" }
  token = lcAaText(ctx, "accountToken")
  if sendAuth and token <> "" then headers.Authorization = "Bearer " + token
  payload = ""
  if body <> invalid
    headers["Content-Type"] = "application/json"
    payload = FormatJson(body)
  end if
  return lcHttp("https://tvm-accounts.tvm-accounts.workers.dev" + path, method, payload, headers, 6000)
end function

function lcAccountsError(res as Object) as Object
  code = res.status
  if code <= 0 then code = 503
  message = "We couldn't reach TVM. Check your connection and try again."
  if code = 401 then message = "Wrong email or password. Try again."
  if code = 400 then message = "Check your details. Passwords need 10 to 200 characters."
  if code = 403 then message = "This account is waiting for access or is unavailable."
  if code = 409 then message = "An account with that email already exists. Try signing in instead."
  if code = 410 then message = "Your code expired. Here is a new one."
  if code = 429 then message = "Too many attempts. Wait a few minutes, then try again."
  return { status: code, json: { error: message } }
end function

function lcPublicAccount(acc as Object) as Object
  if acc = invalid then return invalid
  result = {}
  for each key in acc
    result[key] = acc[key]
  end for
  result.activated = lcAaText(acc, "status") = "active"
  result.suspended = lcAaText(acc, "status") = "suspended"
  result.acceptedTermsVersion = lcAaText(acc, "termsVersion")
  result.rdKey = lcAaBool(acc, "hasRdToken")
  result.rdKeyHint = ""
  return result
end function

function lcAccountUsable(acc as Dynamic) as Object
  if acc = invalid then return { ok: false, reason: "no_account" }
  status = lcAaText(acc, "status")
  if status = "suspended" then return { ok: false, reason: "suspended" }
  if status <> "active" then return { ok: false, reason: "awaiting_activation" }
  if lcAaText(acc, "termsVersion") <> lcTermsVersion() then return { ok: false, reason: "terms_required" }
  return { ok: true, reason: "ok" }
end function

function lcResolveAccount(ctx as Object) as Dynamic
  if lcAaText(ctx, "accountToken") = "" then return invalid
  res = lcAccountsHttp(ctx, "/v1/me")
  if not res.ok then return invalid
  return lcAaGet(res.json, "account", invalid)
end function

function lcHasLiveTv(ctx as Object) as Boolean
  acc = lcResolveAccount(ctx)
  return lcAccountUsable(acc).ok and lcAaBool(acc, "liveTv")
end function

function lcGetAccount(ctx as Object) as Object
  if ctx.accountToken = "" then return { status: 200, json: { signedIn: false, usable: { ok: false, reason: "no_account" } } }
  res = lcAccountsHttp(ctx, "/v1/me")
  if not res.ok
    if res.status = 401
      sec = lcReg() : sec.Delete("accountToken") : sec.Flush()
      return { status: 200, json: { signedIn: false, usable: { ok: false, reason: "no_account" } } }
    end if
    return lcAccountsError(res)
  end if
  acc = lcAaGet(res.json, "account", invalid)
  return { status: 200, json: { signedIn: true, account: lcPublicAccount(acc), usable: lcAccountUsable(acc), canSendEmail: true, standalone: true } }
end function

function lcResendVerify(ctx as Object) as Object
  token = lcAaText(ctx, "accountToken")
  if token <> ""
    res = lcAccountsHttp(ctx, "/v1/me/verify/resend", "POST", {})
  else
    email = lcAaText(ctx.body, "email").Trim().LCase()
    res = lcAccountsHttp(ctx, "/v1/verify/resend", "POST", { email: email }, false)
  end if
  if not res.ok and res.status <> 202 then return lcAccountsError(res)
  return { status: 202, json: { ok: true } }
end function

function lcForgotPassword(ctx as Object) as Object
  email = lcAaText(ctx.body, "email").Trim()
  res = lcAccountsHttp(ctx, "/v1/password/forgot", "POST", { email: email }, false)
  if not res.ok and res.status <> 202 then return lcAccountsError(res)
  return { status: 202, json: { ok: true, linkUrl: "https://tvm-accounts.tvm-accounts.workers.dev/link" } }
end function

function lcRegisterAccount(ctx as Object) as Object
  body = { email: lcAaText(ctx.body, "email"), password: lcAaText(ctx.body, "password"), displayName: lcAaText(ctx.body, "displayName"), client: "TVM Roku" }
  res = lcAccountsHttp(ctx, "/v1/register", "POST", body)
  if not res.ok then return lcAccountsError(res)
  return { status: 201, json: { account: lcPublicAccount(lcAaGet(res.json, "account", invalid)) } }
end function

function lcSignInAccount(ctx as Object) as Object
  body = { email: lcAaText(ctx.body, "email"), password: lcAaText(ctx.body, "password"), client: "TVM Roku" }
  res = lcAccountsHttp(ctx, "/v1/signin", "POST", body)
  if not res.ok then return lcAccountsError(res)
  acc = lcAaGet(res.json, "account", invalid)
  return { status: 200, json: { token: lcAaText(res.json, "session"), account: lcPublicAccount(acc), usable: lcAccountUsable(acc) } }
end function

function lcAcceptTerms(ctx as Object) as Object
  res = lcAccountsHttp(ctx, "/v1/me/terms", "POST", { version: lcTermsVersion() })
  if not res.ok then return lcAccountsError(res)
  acc = lcAaGet(res.json, "account", invalid)
  return { status: 200, json: { account: lcPublicAccount(acc), usable: lcAccountUsable(acc) } }
end function

function lcSignOut(ctx as Object) as Object
  res = lcAccountsHttp(ctx, "/v1/signout", "POST")
  sec = lcReg() : sec.Delete("accountToken") : sec.Flush()
  if not res.ok and res.status <> 401 then return lcAccountsError(res)
  return { status: 200, json: { ok: true } }
end function

function lcSanitizeDeviceClient(raw as String) as String
  clean = ""
  for i = 1 to Len(raw)
    ch = Mid(raw, i, 1)
    code = Asc(ch)
    if code >= 32 and code <> 127 then clean = clean + ch
  end for
  clean = clean.Trim()
  if clean = "" then return "TVM Roku"
  if Len(clean) > 200 then clean = Left(clean, 200).Trim()
  if clean = "" then return "TVM Roku"
  return clean
end function

function lcGetPublicConfig(ctx as Object) as Object
  fallback = { announcement: invalid, minVersion: invalid, flags: {}, openSignups: false, mail: false }
  cached = lcReadTmpJson("tvm_public_config.json", 60)
  if cached <> invalid then return { status: 200, json: cached }
  res = lcAccountsHttp(ctx, "/v1/config", "GET", invalid, false)
  if not res.ok or res.json = invalid then return { status: 200, json: fallback }
  cfg = {
    announcement: lcAaGet(res.json, "announcement", invalid)
    minVersion: lcAaGet(res.json, "minVersion", invalid)
    flags: lcAaGet(res.json, "flags", {})
    openSignups: lcAaBool(res.json, "openSignups", false)
    mail: lcAaBool(res.json, "mail", false)
  }
  lcWriteTmpJson("tvm_public_config.json", cfg)
  return { status: 200, json: cfg }
end function

function lcDeviceStart(ctx as Object) as Object
  client = lcSanitizeDeviceClient(lcAaText(ctx.body, "client", "TVM Roku"))
  res = lcAccountsHttp(ctx, "/v1/device/start", "POST", { client: client }, false)
  if not res.ok or res.json = invalid
    return lcAccountsError(res)
  end if
  return { status: 200, json: res.json }
end function

function lcDevicePoll(ctx as Object) as Object
  deviceCode = lcAaText(ctx.body, "deviceCode", "").Trim()
  if Len(deviceCode) <> 43
    return { status: 400, json: { state: "error", error: "invalid" } }
  end if
  res = lcAccountsHttp(ctx, "/v1/device/poll", "POST", { deviceCode: deviceCode }, false)
  if res.ok and res.json <> invalid
    session = lcAaText(res.json, "session", "")
    acc = lcAaGet(res.json, "account", invalid)
    if session = "" or acc = invalid
      return { status: 502, json: { state: "error", error: "unavailable" } }
    end if
    return {
      status: 200
      json: {
        state: "approved"
        token: session
        account: lcPublicAccount(acc)
        usable: lcAccountUsable(acc)
      }
    }
  end if
  code = res.status
  if code <= 0 then code = 503
  errCode = lcAaText(res.json, "error", "")
  if errCode = ""
    if code = 428 then errCode = "pending"
    if code = 410 then errCode = "expired"
    if code = 429 then errCode = "slow_down"
  end if
  return { status: code, json: { state: errCode, error: errCode } }
end function
