' Plain-language account copy, validation, formatting, and device-flow helpers.
' Pure BrightScript (no SceneGraph nodes) so apps/roku/scripts/accountCopy.test.mjs
' can verify parity across JS and brs@0.45.0.

function acMinPasswordLength() as Integer
  return 10
end function

function validateEmailInput(value as Dynamic) as String
  trimmed = ""
  if value <> invalid then trimmed = asText(value).Trim()
  if trimmed = "" then return "Enter your email address."
  if Len(trimmed) > 254 then return "Check the email address. It should look like name@example.com."
  atIdx = Instr(1, trimmed, "@")
  if atIdx <= 1 then return "Check the email address. It should look like name@example.com."
  rest = Mid(trimmed, atIdx + 1)
  if Instr(1, rest, "@") > 0 then return "Check the email address. It should look like name@example.com."
  if Instr(1, trimmed, " ") > 0 or Instr(1, trimmed, Chr(9)) > 0 or Instr(1, trimmed, Chr(10)) > 0 or Instr(1, trimmed, Chr(13)) > 0
    return "Check the email address. It should look like name@example.com."
  end if
  dotIdx = Instr(1, rest, ".")
  lastDot = 0
  p = dotIdx
  while p > 0
    lastDot = p
    p = Instr(p + 1, rest, ".")
  end while
  if lastDot <= 1 or Len(rest) - lastDot < 2
    return "Check the email address. It should look like name@example.com."
  end if
  return ""
end function

function validatePasswordInput(value as Dynamic, requireLength = false as Boolean) as String
  pw = ""
  if value <> invalid then pw = asText(value)
  n = Len(pw)
  if n = 0
    if requireLength then return "Use at least " + StrI(acMinPasswordLength()).Trim() + " characters."
    return "Enter your password."
  end if
  if requireLength and n < acMinPasswordLength()
    return "Use at least " + StrI(acMinPasswordLength()).Trim() + " characters."
  end if
  if n > 200 then return "That password is too long."
  return ""
end function

function accountStatusLabel(state as Dynamic) as String
  if state = invalid then return "Signed out"
  if aaGet(state, "signedIn", false) <> true then return "Signed out"
  acc = aaGet(state, "account", invalid)
  if acc = invalid then return "Signed out"
  usable = aaGet(state, "usable", {})
  reason = LCase(asText(aaGet(usable, "reason", "")))
  if aaGet(acc, "suspended", false) = true or reason = "suspended" or LCase(asText(aaGet(acc, "status", ""))) = "suspended"
    return "Paused by the owner"
  end if
  if reason = "email_unverified" then return "Confirm your email to continue"
  if reason = "terms_required" then return "Accept the terms to continue"
  if aaGet(acc, "activated", false) <> true or reason = "awaiting_activation"
    return "Waiting for approval"
  end if
  return "Active"
end function

function friendlyPlanName(id as Dynamic) as String
  key = LCase(asText(id))
  if key = "stream" then return "Stream"
  if key = "stream-live" then return "Stream + Live"
  if key = "free" then return "TVM Free"
  if key = "basic" then return "TVM Basic"
  if key = "premium" then return "TVM Premium"
  if key = "ultra" then return "TVM Ultra"
  if key = "max" then return "TVM MAX"
  return "No active plan"
end function

function looksLikeRawCode(raw as String) as Boolean
  s = raw.Trim()
  if s = "" then return true
  if CreateObject("roRegex", "^[a-z0-9_.:-]+$", "i").IsMatch(s) then return true
  if CreateObject("roRegex", "^(?:http|status|error)\s*[:#]?\s*\d{3}$", "i").IsMatch(s) then return true
  if CreateObject("roRegex", "\b[45]\d{2}\b", "").IsMatch(s) then return true
  return false
end function

function friendlyAccountError(rawError as Dynamic, statusCode = 0 as Integer, context = "general" as String) as String
  raw = ""
  if rawError <> invalid then raw = asText(rawError).Trim()
  lower = LCase(raw)

  if lower = "invalid" or lower = "invalid_credentials"
    if context = "signin" then return "That password doesn't match this email. Try again or ask the owner to reset it."
    if context = "register" then return "An account already exists for this email, or one of the fields needs checking."
    return "Check what you entered and try again."
  end if
  if lower = "that email address and password do not match."
    return "That password doesn't match this email. Try again or ask the owner to reset it."
  end if
  if Instr(1, lower, "already exists") > 0 or Instr(1, lower, "could not be created") > 0
    return "An account already exists for this email. Sign in instead."
  end if
  if lower = "failed to fetch" or lower = "load failed" or lower = "request_failed" or Instr(1, lower, "network") > 0
    return "We couldn't reach TVM. Check your connection and try again."
  end if
  if Instr(1, lower, "took too long") > 0 or Instr(1, lower, "timed out") > 0 or lower = "timeout" or lower = "abort"
    return "TVM took too long to respond. Check your connection and try again."
  end if

  if lower = "accounts_unavailable" or lower = "service_unavailable" or lower = "unavailable"
    return "We couldn't reach TVM. Check your connection and try again."
  end if
  if lower = "rate_limited" then return "Too many attempts. Wait a few minutes, then try again."
  if lower = "slow_down" then return "Waiting for you…"
  if lower = "pending" then return "Waiting for you…"
  if lower = "expired" then return "Your code expired. Here is a new one."
  if lower = "forbidden" then return "You don't have permission to do that."
  if lower = "account_required" or lower = "unauthorized" then return "Please sign in again to continue."
  if lower = "not_found" then return "This copy of TVM needs an update before it can do that."
  if lower = "invalid_invite" then return "That invite code is invalid or has already been used."
  if lower = "bad_request" or lower = "too_large" or lower = "https_required" then return "Check what you entered and try again."
  if lower = "conflict" then return "An account already exists for this email. Sign in instead."
  if lower = "invalid_json" then return "TVM received an unexpected reply. Try again."

  if statusCode = 400 then return "Check what you entered and try again."
  if statusCode = 401
    if context = "signin" then return "That password doesn't match this email. Try again or ask the owner to reset it."
    return "Please sign in again to continue."
  end if
  if statusCode = 403 then return "You don't have permission to do that."
  if statusCode = 404 then return "That feature is not available on this copy of TVM."
  if statusCode = 409 then return "That action conflicts with the current state. Refresh and try again."
  if statusCode = 410 then return "Your code expired. Here is a new one."
  if statusCode = 428 then return "Waiting for you…"
  if statusCode = 429 then return "Too many attempts. Wait a few minutes, then try again."
  if statusCode = 500 then return "Something went wrong on TVM's side. Try again shortly."
  if statusCode = 502 or statusCode = 503 then return "We couldn't reach TVM. Check your connection and try again."
  if statusCode = 504 then return "TVM took too long to respond. Try again shortly."

  if raw = "" or looksLikeRawCode(raw)
    return "Something went wrong. Please try again."
  end if
  return raw
end function

function devicePollAction(statusCode as Integer, errorCode as String, interval as Integer) as Object
  waitSec = interval
  if waitSec < 5 then waitSec = 5
  err = LCase(errorCode.Trim())

  if statusCode = 200 and err = ""
    return { action: "approved", interval: waitSec, message: "" }
  end if
  if statusCode = 428 or err = "pending"
    return { action: "wait", interval: waitSec, message: "Waiting for you…" }
  end if
  if statusCode = 429 and err = "rate_limited"
    return { action: "stop", interval: waitSec, message: "Too many attempts. Wait a few minutes, then try again." }
  end if
  if statusCode = 429 or err = "slow_down"
    return { action: "wait", interval: waitSec + 5, message: "Waiting for you…" }
  end if
  if statusCode = 410 or err = "expired"
    return { action: "refresh", interval: waitSec, message: "Your code expired. Here is a new one." }
  end if
  if statusCode <= 0 or statusCode = 502 or statusCode = 503 or statusCode = 504 or err = "timeout" or err = "request_failed" or err = "unavailable"
    return { action: "wait", interval: waitSec, message: "Checking connection…" }
  end if
  return { action: "stop", interval: waitSec, message: friendlyAccountError(errorCode, statusCode, "signin") }
end function

function sanitizeDeviceClient(name as Dynamic) as String
  raw = ""
  if name <> invalid then raw = asText(name)
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

function shortDisplayUrl(url as String) as String
  s = url.Trim()
  lower = LCase(s)
  if Left(lower, 8) = "https://"
    s = Mid(s, 9)
  else if Left(lower, 7) = "http://"
    s = Mid(s, 8)
  end if
  while Len(s) > 0 and Right(s, 1) = "/"
    s = Left(s, Len(s) - 1)
  end while
  return s
end function

function shortDateText(iso as Dynamic) as String
  s = asText(iso).Trim()
  if Len(s) < 10 then return "-"
  if Mid(s, 5, 1) <> "-" or Mid(s, 8, 1) <> "-" then return "-"
  y = Int(Val(Mid(s, 1, 4)))
  mIdx = Int(Val(Mid(s, 6, 2)))
  d = Int(Val(Mid(s, 9, 2)))
  months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  if y < 1970 or mIdx < 1 or mIdx > 12 or d < 1 or d > 31 then return "-"
  return StrI(d).Trim() + " " + months[mIdx - 1] + " " + StrI(y).Trim()
end function

function formatPence(pence as Integer) as String
  if (pence mod 100) = 0
    return "£" + StrI(Int(pence / 100)).Trim()
  end if
  pounds = Int(pence / 100)
  remPence = pence mod 100
  pStr = StrI(remPence).Trim()
  if Len(pStr) < 2 then pStr = "0" + pStr
  return "£" + StrI(pounds).Trim() + "." + pStr
end function

function tierDisplayName(id as String) as String
  if LCase(id) = "stream-live" then return "Stream + Live"
  return "Stream"
end function

function yearlySavingsPercent(tiers as Object) as Integer
  if tiers = invalid or tiers.Count() = 0 then return 0
  base = tiers[0]
  monthly = aaGet(base, "monthlyPence", invalid)
  yearly = aaGet(base, "yearlyPence", invalid)
  if monthly = invalid or yearly = invalid then return 0
  if monthly <= 0 or yearly <= 0 then return 0
  annual = monthly * 12
  if yearly >= annual then return 0
  return Int((((annual - yearly) * 100.0) / annual) + 0.5)
end function

function isRecommendedTier(tier as Object, tiers as Object) as Boolean
  liveOrderable = false
  if tiers <> invalid
    for each item in tiers
      if asText(aaGet(item, "id", "")) = "stream-live"
        if aaGet(item, "orderable", true) <> false and asText(aaGet(item, "availability", "")) <> "Coming soon"
          liveOrderable = true
        end if
      end if
    end for
  end if
  if liveOrderable then return asText(aaGet(tier, "id", "")) = "stream-live"
  return asText(aaGet(tier, "id", "")) = "stream"
end function

function tvmAccountValidateEmail(value as Dynamic) as String
  return validateEmailInput(value)
end function

function tvmAccountValidatePassword(value as Dynamic, requireLength = false as Boolean) as String
  return validatePasswordInput(value, requireLength)
end function

function tvmCleanAccountError(rawError as Dynamic, fallback = "" as String) as String
  raw = ""
  if rawError <> invalid then raw = asText(rawError).Trim()
  if raw = "" then return fallback
  cleaned = friendlyAccountError(raw, 0, "signin")
  if fallback <> "" and cleaned = "Something went wrong. Please try again." then return fallback
  return cleaned
end function

function tvmFormatVerifyUrl(url as Dynamic) as String
  return shortDisplayUrl(asText(url))
end function

function tvmFormatDeviceCode(code as Dynamic) as String
  s = UCase(asText(code).Trim())
  if s = "" then return ""
  if Instr(1, s, "-") = 0 and Len(s) = 8
    return Left(s, 4) + "-" + Right(s, 4)
  end if
  return s
end function

function tvmAccountStatusText(account as Dynamic, usable as Dynamic) as String
  return accountStatusLabel({ signedIn: true, account: account, usable: usable })
end function

function tvmShortDateText(iso as Dynamic) as String
  return shortDateText(iso)
end function

function tvmPlanName(id as Dynamic) as String
  return tierDisplayName(asText(id))
end function

function tvmHasLiveEntitlement(ent as Dynamic) as Boolean
  lower = LCase(asText(ent))
  return Instr(1, lower, "live") > 0
end function

function tvmTermsPages(doc as Dynamic) as Object
  pages = []
  if doc = invalid or GetInterface(doc, "ifAssociativeArray") = invalid
    return ["Review TVM's Terms of Service and privacy practices. Nothing here is sold inside the app, and access is arranged directly with the owner."]
  end if
  first = ""
  intro = asText(aaGet(doc, "intro", ""))
  if intro <> "" then first = intro
  summary = aaGet(doc, "summary", invalid)
  if summary <> invalid and Type(summary) = "roArray" and summary.Count() > 0
    if first <> "" then first = first + Chr(10) + Chr(10)
    first = first + "In plain English:"
    for each bullet in summary
      line = asText(bullet)
      if line <> "" then first = first + Chr(10) + "•  " + line
    end for
  end if
  if first <> "" then pages.Push(first)

  sections = aaGet(doc, "sections", invalid)
  if sections <> invalid and Type(sections) = "roArray"
    chunk = ""
    countInChunk = 0
    for each sec in sections
      heading = asText(aaGet(sec, "heading", ""))
      bodyText = asText(aaGet(sec, "body", ""))
      if heading <> "" or bodyText <> ""
        entry = ""
        if heading <> "" then entry = heading
        if bodyText <> ""
          if entry <> "" then entry = entry + Chr(10)
          entry = entry + bodyText
        end if
        if chunk <> "" then chunk = chunk + Chr(10) + Chr(10)
        chunk = chunk + entry
        countInChunk = countInChunk + 1
        if countInChunk >= 2 or Len(chunk) >= 520
          pages.Push(chunk)
          chunk = ""
          countInChunk = 0
        end if
      end if
    end for
    if chunk <> "" then pages.Push(chunk)
  end if

  if pages.Count() = 0
    pages.Push("Review TVM's Terms of Service and privacy practices.")
  end if
  return pages
end function
