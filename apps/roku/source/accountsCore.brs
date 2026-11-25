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

function lcAccountsHttp(ctx as Object, path as String, method = "GET" as String, body = invalid as Dynamic) as Object
  headers = { Accept: "application/json" }
  token = lcAaText(ctx, "accountToken")
  if token <> "" then headers.Authorization = "Bearer " + token
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
  message = "Accounts could not be reached. Try again."
  if code = 401 then message = "Sign in again. Check your email and password."
  if code = 400 then message = "Check your details. Passwords need 10 to 200 characters."
  if code = 403 then message = "This account is waiting for access or is unavailable."
  if code = 429 then message = "Too many attempts. Please try again later."
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
  return { status: 200, json: { signedIn: true, account: lcPublicAccount(acc), usable: lcAccountUsable(acc), canSendEmail: false, standalone: true } }
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
