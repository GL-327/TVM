# TVM Hub — contract v1

## Changelog

- 17 Nov 2026 (Core): clarified storage for unauthenticated pairing starts: `unassignedPairs` holds requests until approval/denial assigns them to an account. The original account-only layout could not represent `POST /pair/start`.

Status: **draft v1**, the architect's decision of 17 Nov 2026. Core implements it in `apps/core/src/hub/`. Roku, web, Windows and mobile consume it. Changes must be additive within v1: new optional fields, new capability strings and new action strings. Anything breaking needs `/api/hub/v2`.

TVM Hub is the **device-management** product. It is unrelated to the catalogue "studio hubs" (`/api/apps`, `providers/hubSeeds.ts`), which stay as they are.

## 0. Conventions

- Base path: `/api/hub/v1`. Every response is a JSON **object**, never a top-level array, because Roku's `ApiTask.json` is an assocarray.
- Errors: `{ "error": "<code>", "message": "<human text>" }` with a fitting HTTP status. Codes are listed per route.
- Times are ISO-8601 UTC strings. Every response carries `serverTime` so clients compute ages against server time rather than their own clock.
- IDs are opaque and prefixed with 128-bit random base64url: `inst_…`, `cmd_…`, `pair_…`, `evt_…`. Existing account ids (`acc_…`) are used unchanged.
- Existing middleware still applies: the host allowlist, origin checks, the LAN gate (non-loopback callers need the LAN token or a LAN session) and `json_required` on non-GET.

## 1. Credentials

| Credential | How it is sent | Who has it |
|---|---|---|
| Account session | Existing `X-TVM-Account: <token>` or `Authorization: Bearer <token>` | A signed-in user on any client |
| Device credential | `X-TVM-Device: <installationId>.<secret>` | One TVM installation. The secret is 32 random bytes in base64url, stored server-side as sha256 only, and returned exactly once. |

A revoked installation's credential fails with `401 device_revoked` on its next call. Revocation also rejects that installation's pending commands.

## 2. Model

```
Device {
  id: "inst_…", name: string(1..40), room: string|null,
  platform: "roku"|"windows"|"web"|"android"|"android-tv"|"ios",
  model: string|null, appVersion: string, build: string|null,
  slot: integer,                 // persistent anchor: lowest free int ≥ 0 at creation; NEVER changes on heartbeat
  createdAt, lastSeenAt|null, lastSeenAgeSec: integer|null,
  presence: "online"|"offline",  // computed on read: online ⇔ now − lastSeenAt ≤ 2 × heartbeatSec
  state: "idle"|"playing"|"paused"|"offline"|"unknown"|"revoked",   // offline when presence is offline; unknown if never seen
  isCurrent: boolean,            // true when the request's X-TVM-Device is this installation
  capabilities: string[],
  physicalInput: boolean,        // has a remote/keyboard attached (capability "input.physical")
  nowPlaying: null | { mediaId, title, artworkUrl|null, positionSec, durationSec|null, profileId }
            | { restricted: true }   // playing, but for a profile the requester may not see
}
```

**Capability vocabulary (v1, additive):** `playback.pause_resume`, `playback.seek`, `playback.skip`, `nav.dpad`, `nav.select`, `nav.back`, `play.title`, `play.live_channel`, `handoff.receive`, `handoff.send`, `input.physical`. Clients ignore any string they don't recognise.

**nowPlaying scoping:** the full object is returned only when the requester's `X-TVM-Profile` equals `nowPlaying.profileId`, or the requester has the account role `dev` (owner). Anyone else gets `{restricted:true}` while `state` is still reported.

## 3. Routes

### Installations and presence
| Route | Auth | Body | Response |
|---|---|---|---|
| `POST /installations/register` | account | `{clientId, platform, name, model?, appVersion, build?, capabilities[]}` | `{installation: Device, deviceSecret, heartbeatSec}` |
| `POST /presence` | device | `{seq, state: idle\|playing\|paused, nowPlaying?, capabilities?}` | `{serverTime, heartbeatSec: 30, rev, pendingCommands}` |
| `GET /overview` | account (+ optional device) | n/a | `{v:1, rev, serverTime, heartbeatSec, account:{id,name,role}, currentInstallationId\|null, devices: Device[], visibleSpokes: 6}` |
| `POST /devices/:id/rename` | account | `{name}` | `{device}` |
| `POST /devices/:id/room` | account | `{room\|null}` | `{device}` |
| `POST /devices/:id/revoke` | account | `{}` | `{device}` (state `revoked`) |
| `POST /session/signout` | device | `{}` | `{ok:true}`: the installation revokes itself |

Notes:
- `register` is idempotent per (accountId, sha256(clientId)). A live installation gets a new secret, and the old one stays valid for 60 s. A revoked one makes a **new** installation with a new id and slot, because a fresh sign-in counts as consent.
- `presence` ignores a stale `seq` (≤ last seen) and returns `{ignored:true, …}`.
- `presence` is a delta. If `nowPlaying` is omitted, the previous value is kept. An explicit `null` clears it, and so does state `idle`. Omitting `capabilities` keeps the previous set.
- `overview` leaves out revoked devices unless the query has `includeRevoked=1`. Devices are sorted by `slot`.
- Errors: `401 auth_required`, `401 device_revoked`, `404 not_found` (including another account's device), `400 invalid_name`.

### Commands
```
Command {
  id:"cmd_…", idempotencyKey, actor:{accountId, installationId|null},
  target: "inst_…", action, payload, createdAt, expiresAt, seq,
  status: "pending"|"accepted"|"applied"|"rejected"|"timed_out", reason|null, updatedAt
}
```
| Route | Auth | Body | Response |
|---|---|---|---|
| `POST /commands` | account (+ optional device as actor) | `{v:1, idempotencyKey, target, action, payload?, ttlSec? (default 30, max 120), stateVersion?}` | `{command}` |
| `GET /commands/:id` | account | n/a | `{command}` |
| `GET /inbox?after=<seq>` | device | n/a | `{commands: Command[], serverTime}`: pending and unexpired, for this target only, `seq > after`, in ascending order |
| `POST /commands/:id/ack` | device (must be the target) | `{status: accepted\|applied\|rejected, reason?}` | `{command}` |

- Actions v1, with the capability each needs:
  - `playback.pause` and `playback.resume` need `playback.pause_resume`. Both are idempotent setters.
  - `playback.seek {positionSec}` needs `playback.seek`.
  - `playback.skip {deltaSec}` needs `playback.skip`.
  - `nav.dpad {direction: up|down|left|right}`, `nav.select` and `nav.back` need the `nav.*` capability of the same name.
  - `play.title {mediaId, positionSec?}` needs `play.title`.
  - `play.live_channel {channelId}` needs `play.live_channel`.
- Server checks before accepting a command:
  1. The target belongs to the actor's account and is not revoked. Otherwise `404 not_found`.
  2. The target has the capability. Otherwise `409 unsupported`.
  3. The target is online. Otherwise `409 target_offline`.
  4. The action is known. Otherwise `400 invalid_action`.
- Idempotency: the same `(accountId, idempotencyKey)` returns the original command unchanged.
- Expiry: a pending command past `expiresAt` becomes `timed_out` lazily when it is next read.
- Transitions are monotonic: `pending → accepted → applied`, and `pending|accepted → rejected`. Anything else returns `409 invalid_transition`.
- The **target** validates scope, entitlement and readiness itself (for example, no player open means reject `not_ready`). A handoff (`play.title` on another device) resolves its own entitlement and stream on the target.

### Pairing (RFC 8628 device flow)
| Route | Auth | Body | Response |
|---|---|---|---|
| `POST /pair/start` | none (LAN gate only) | `{clientId, platform, name, model?, appVersion}` | `{deviceCode, userCode:"ABCD-EFGH", verificationUri, verificationUriComplete, expiresIn:600, interval:5}` |
| `POST /pair/token` | none | `{deviceCode}` | `400 {error: authorization_pending\|slow_down\|access_denied\|expired_token}`, or `200 {installation, deviceSecret, accountToken, heartbeatSec}` |
| `GET /pair/lookup?userCode=` | account | n/a | `{request:{platform, name, model, requestedAt, expiresAt}}` or `404 not_found` |
| `POST /pair/approve` / `POST /pair/deny` | account | `{userCode}` | `{ok:true}` |

- The user code is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, displayed as `XXXX-XXXX` and accepted case-insensitively with or without the dash. It is stored as a salted sha256. The device code is 32 random bytes, stored as sha256.
- Polling faster than `interval` returns `slow_down` and adds 5 s to that pair's interval.
- Redemption is single-use and atomic. A second redemption returns `expired_token`.
- Rate limits are per key, not global: wrong user codes are capped at 5 per account session per 15 min and 10 per IP per 15 min. Past the limit the route returns `429 rate_limited`.
- Approving creates the installation, the same way `register` does, plus an ordinary account session (`accountToken`). The TV can then use content routes without anyone typing a password on it.

### Activity
`GET /activity?limit=50` (account) returns `{events:[{id, at, type, actor:{installationId|null, name}, target:{installationId|null, name}, detail|null}]}`.
- Types:
  - `device.linked`, `device.signed_in`, `device.renamed`, `device.room`, `device.revoked`, `device.signed_out`
  - `pair.approved`, `pair.denied`
  - `command.sent`, `command.applied`, `command.rejected`, `command.timed_out`
- **Titles and media ids are never logged.** Activity is not watch history.
- Retention is 90 days, capped at 500 events per account.

## 4. Storage and safety
- One sealed document, `secrets/hub.enc`, holds `{schema:1, rev, accounts:{[accountId]:{installations, sessions, commands, pairs, activity, nextSeq}}, unassignedPairs:{[pairId]:pair}}`, written through the existing vault seal helpers. Unauthenticated pairing starts live in `unassignedPairs` until approval/denial moves them to the deciding account's `pairs` bucket.
- Writes go to a temp file, then fsync, then rename. The previous revision is kept as `hub.enc.bak`.
- **Unreadable store fails closed:** throw and serve `503 hub_unavailable`. Never silently reset to empty.
- Retention: commands 24 h, finished pairs 1 h, activity 90 days / 500 events.

## 5. Client behaviour (all platforms)
- Register after the first successful sign-in. Keep `installationId` and the secret in the platform secure store. On Roku that is the registry section `tvm`, keys `hubInstallationId` and `hubDeviceSecret`.
- Send a heartbeat every `heartbeatSec` while the app is in the foreground, and immediately when the play state changes. Pause heartbeats in the background where the platform allows.
- Hub screens poll `overview` every 15 s while visible, update in place and never re-slot.
- Device targets poll `inbox` every 2–5 s while the app is in the foreground (Roku), or push where supported later, then ack.
- `hubFixture` (Roku registry / dev flag) loads the bundled fixture JSON instead of Core. It is clearly labelled "Demo data" in the UI and never sends commands.
