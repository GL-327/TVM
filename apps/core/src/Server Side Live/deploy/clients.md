# Client touchpoints

Checked against the code rather than assumed. Three of the four needed no
change; the fourth needs a decision, not a patch.

## Roku — no change needed ✅

`apps/roku/components/TVMScene.brs:1478` already does the right thing:

```brightscript
if coreOwnsUrl(m.coreUrl, url) and isCoreToken(m.coreToken)
  headers["Authorization"] = "Bearer " + m.coreToken
end if
```

A proxy URL *is* a Core URL, so `coreOwnsUrl()` matches and the bearer token is
attached to the video node automatically. That only holds if the URL handed to
the Roku is absolute, which is why `/api/live/sources` builds it from the
request's own `Host` — a Roku asking at `192.168.1.10:7345` gets that address
back, not a relative path it would have to reassemble. `routes.test.ts` pins
that.

LAN only, bearer token, unchanged. The VPN is not on this path. Not reachable
off-LAN, which is accepted.

## Android — no change needed ✅

`SessionClient.kt` posts to `/api/lan/session` with
`Authorization: Bearer <TVM_LAN_TOKEN>` and thereafter carries the HttpOnly
`tvm_lan_session` cookie. Core's `accessError()` accepts either an
authenticated session or a bearer token for content routes, and
`/api/live/proxy/…` is a content route, so the existing contract covers it with
nothing to change.

The VPN is not on this path.

## iOS — read this one

**Standalone: the proxy is not there at all.** ⚠️

`apps/ios/TVM/TVMLocalCore.swift` is a second, independent Core written in
Swift. It implements `/api/live`, `/api/live/xtream`, `/api/live/catalog` and
`/api/live/picks` — and **no** stream, hop or proxy route:

```
$ grep -c "api/live/hop|api/live/proxy|api/live/stream" apps/ios/TVM/TVMLocalCore.swift
0
```

So Server Side Live, which is TypeScript in `apps/core`, does not exist on a
standalone iPhone. This is not a regression — the old hop was not there either
— but it does mean "IPTV works everywhere" is not true of standalone iOS today,
and since you have not tested IPTV on iOS yet, that is the thing to verify
first.

Three ways forward, in order of effort:

1. **Point iOS at the home Core.** It then uses the LAN contract exactly like
   Android and gets the proxy for free. Nothing to build. LAN only.
2. **Port the module to Swift.** `headers`, `manifest` and `tokens` are small
   and pure; `reflect` is the only piece that touches the network. The Swift
   core would need the same HMAC secret handling.
3. **Leave standalone iOS without IPTV** and say so in the UI, rather than
   letting it fail with a generic playback error.

Also worth verifying on iOS specifically, whichever route you take:

- **AVPlayer will not play an `.m3u8` served as `application/octet-stream`.**
  The reflector normalises to `application/vnd.apple.mpegurl`, but a panel that
  redirects mid-manifest can still surprise it.
- **ATS.** iOS blocks plaintext HTTP by default. A LAN Core on `http://` needs
  the existing exception; a provider on `http://` is fetched by Core, not by
  the phone, so it is not affected — that is one thing the proxy improves.
- **MobileVLCKit vs AVPlayer.** The bundled player handles raw MPEG-TS that
  AVPlayer refuses. Which one opens a proxy URL matters more than the URL does.

**iOS "home Core" mode: no change needed ✅** — same LAN contract as Android.

## apps/ui — works, with one optional improvement

The UI calls `/api/live`, `/api/live/catalog` and `/api/live/picks`, and the
existing catalogue already resolves playback to `/api/live/stream/<id>`, so no
provider URL reaches the browser bundle today.

`/api/live/sources` is additive: it is the route that serves an arbitrary M3U
with per-channel headers, which the Xtream-shaped catalogue cannot. Wiring the
Live TV screen to prefer it when a playlist has been loaded is a small
follow-up and deliberately not done here — the Live TV screen is the one the
channel check and picks both hang off, and changing its data source in the same
commit as a new network layer would make a playback bug ambiguous between the
two.

Whichever it uses, the UI hands the player an opaque Core path and nothing else.

## Electron shell / appliance — no change needed ✅

Loopback, no token, no VPN dependency. `accessError()` returns `null` for
loopback and always has.
