# Server Side Live

A universal IPTV proxy inside Core. Every client — Roku, Android, iOS, the
Electron shell — plays Live TV from a Core-local URL, and no client ever sees
a provider address, a panel password or a session cookie.

```
apps/core/src/Server Side Live/
  headers.ts    what goes upstream, and what is refused
  tokens.ts     the opaque names clients see instead of URLs
  manifest.ts   HLS rewriting — the "reflect" half
  playlist.ts   M3U parsing, including the header hints inside it
  cache.ts      a short memory cache in front of the provider
  reflect.ts    one upstream request, one client response
  egress.ts     which address the world sees when Core fetches
  routes.ts     the /api/live/... surface and who may reach it
  index.ts      the assembled service
  deploy/       docker-compose, VPN egress, step-by-step
```

## Why it exists

Core already reflected HLS for the desktop player, but with one global
User-Agent, tokens that lived in a `Map` and died with the process, and no
cache. That is enough for one panel and one client. It is not enough for
"arbitrary IPTV providers across every TVM client", which needs three things
the old hop could not do:

- **Per-stream request headers.** Panels reject requests for reasons unrelated
  to the subscription: a missing `Referer`, an unexpected `Origin`, a
  `User-Agent` that is not the app they built for, a portal `Cookie`. One
  global guess is why some panels played and others returned 403 with no
  explanation.
- **URLs that survive a restart.** A Roku resuming a channel after the
  appliance reboots must not meet a 404.
- **Revocation.** A proxy URL that escapes is a free pass to someone else's
  subscription, and there was no way to close one without restarting.

## How a stream flows

Given a provider manifest at `https://panel.example/live/index.m3u8` that needs
`Referer: https://panel.example/` and `X-Panel-Key: abc`:

```
UI  ──GET /api/live/sources──▶ Core
    ◀── { channels: [ { id: "ch_1a2b3c4d", name: "Sky Sports",
                        play: "/api/live/proxy/9f86d081884c7d65…" } ] }
```

The UI has a name and a Core-local path. It has no idea a panel exists.

```
player ──GET /api/live/proxy/9f86d081…──▶ Core
                                          ──GET …/live/index.m3u8──▶ panel
                                            Referer: https://panel.example/
                                            X-Panel-Key: abc
                                            User-Agent: VLC/3.0.20 LibVLC/3.0.20
```

Core rewrites the manifest before serving it:

```
#EXTM3U                                  #EXTM3U
#EXT-X-KEY:URI="https://panel/key.bin"   #EXT-X-KEY:URI="/api/live/proxy/4b227777…"
#EXTINF:6,                          ──▶  #EXTINF:6,
seg1.ts                                  /api/live/proxy/ef2d127de37b…
```

Every URL in the body — segments, variant playlists, AES-128 key files, fMP4
init segments, alternate audio — comes back through Core under the same header
profile. A rewrite that misses one is not a partial success: the key URI alone
leaks the provider host on the first decryption.

## Routes

| Route | Method | Who |
| --- | --- | --- |
| `/api/live/proxy/<token>` | GET, HEAD, OPTIONS | Content route: loopback free, LAN needs the bearer token |
| `/api/live/sources` | GET | Same — opaque channels only |
| `/api/live/sources` | PUT | **Loopback only** — the body carries provider credentials |
| `/api/live/rotate` | POST | **Loopback only** — cuts off every client at once |
| `/api/live/egress` | GET | **Loopback only** — answers with an IP address |

Auth is inherited, not reinvented. Core's `accessError()` already decides the
hard part, and `/api/live` is not in its loopback-only list, so the proxy is a
content route and a Roku reaches it with `Authorization: Bearer <TVM_LAN_TOKEN>`
— exactly the header it already sends for Core-hosted streams. Admin, billing
and privacy stay loopback-only and nothing here changes that.

## Tokens: stable and revocable

A token is `HMAC-SHA256(secret, profileId ‖ url)`, truncated to 32 hex
characters. Deriving rather than randomising buys both properties at once:

- **Stable.** The same channel always mints the same token, so a URL a player
  is holding still resolves after Core restarts.
- **Revocable.** `POST /api/live/rotate` replaces the secret, so every token
  changes at once. Playback in flight stops, which is the point — a rotation
  that lets existing sessions finish is not a rotation.

The secret is the only thing stored, and it is stored the way every other TVM
credential is: sealed with the DPAPI-wrapped master key, under `secrets/`,
never in `config.json`, never in the UI bundle, never in the Roku zip.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `TVM_LIVE_USER_AGENT` | `VLC/3.0.20 LibVLC/3.0.20` | Global fallback UA |
| `TVM_LIVE_REFERER` | — | Global fallback `Referer` |
| `TVM_LIVE_ORIGIN` | — | Global fallback `Origin` |
| `TVM_LIVE_COOKIE` | — | Global fallback `Cookie` (a credential — env only) |
| `TVM_LIVE_CACHE` | on | `off` disables the cache entirely |
| `TVM_LIVE_CACHE_MANIFEST_MS` | `2000` | Manifest TTL. Keep below the target duration |
| `TVM_LIVE_CACHE_SEGMENT_MS` | `30000` | Segment TTL. Segments are immutable |
| `TVM_LIVE_CACHE_ENTRY_BYTES` | `4194304` | Largest body worth holding |
| `TVM_LIVE_CACHE_TOTAL_BYTES` | `268435456` | Total cache budget |
| `TVM_LIVE_EGRESS_PROXY` | — | Declares that provider traffic should be tunnelled |

Per-channel headers usually need none of these: `parseM3u` reads the
`#EXTVLCOPT:http-user-agent=` and `#EXTHTTP:{…}` lines providers already put in
their playlists, so a panel's own instructions become the header profile
without anyone transcribing them.

## Cache

Live HLS is the same few requests over and over — four clients in a household
asking a panel for the same media playlist several times a second is how a
subscription gets rate-limited. The TTLs are short on purpose and the manifest
one matters most: a live media playlist is a sliding window, and serving one
that is ten seconds stale hands the player segments that have already rolled
out of it. Two seconds is below the shortest target duration in normal use.

Ranged requests are never cached. A `Range` response is a window into a body,
and keying on URL alone would serve one client's window to another asking for
a different one — seeking would return the wrong bytes, which is worse than a
miss. When a channel misbehaves, `TVM_LIVE_CACHE=off` is the first thing to
try, because a cache is always the first suspect in "it played a minute ago".

## What this must not break

- **Core binds `127.0.0.1` by default.** Nothing here changes that.
  `TVM_CORE_BIND=0.0.0.0` remains an explicit opt-in for LAN clients, and it
  still requires `TVM_LAN_TOKEN`.
- **No secrets in the repo.** Header profiles containing a cookie or a signed
  referer live in the sealed store or the environment, never in `config.json`.
- **No torrent indexing or magnet scraping.** This module fetches URLs it was
  given and rewrites manifests. It discovers nothing.
- **D-pad only.** No new UI surface is introduced; Live TV renders through the
  screens that already exist, so arrows, OK and Back keep working unchanged.

See `deploy/` for the VPN egress design, `docker-compose.yml`, and the
step-by-step with its rollback path.
