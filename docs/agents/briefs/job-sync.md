Job: SYNC, account data across devices. TVM 1.4.4. The owner asked that a person's TVM data follows their account to every device.

Repos:
- C:\Users\Gathe\Desktop\TVM-accounts (private Cloudflare Worker + D1; read README.md). You own all of it.
- C:\Users\Gathe\Desktop\TVM. You own ONLY apps/core/** there. Other engineers are editing apps/ui and native/ right now.

Read first: TVM's CLAUDE.md, HANDOFF.md and docs/1.4/spec.md (sections 1, 11, 12, 13).
Rules:
- Do not deploy.
- Do not run wrangler against the remote database or account.
- Never print or touch .dev.vars.secret.
- No git commands that change state.
- Write new D1 migrations as new numbered files.

Service (TVM-accounts):
- Add per-account synced data: profiles, watch progress (Continue Watching and watched state), watchlist, and the account-level preferences that should follow the person: subtitle languages and style, audio language, skip-segments mode, autoplay next, the extras map, and home sections.
- Device-only settings stay local: window or quality caps and appearance.
- Design:
  - A table keyed by (account_id, kind, item_key) holding the JSON value, updated_at (ms, client-supplied, validated as not more than 5 min in the future) and a deleted tombstone.
  - Session-authenticated endpoints:
    - `GET /v1/me/data?since=<ms>` returns `{ items: [...], now }`, paginated.
    - `PUT /v1/me/data` takes `{ items: [{ kind, key, value, updatedAt, deleted? }] }`. Last writer wins per item by updatedAt.
- Strict limits:
  - kinds allow-listed
  - key ≤ 200 characters
  - value ≤ 16 KB
  - ≤ 200 items per request
  - ≤ 20,000 rows per account
- Rate limits.
- Never store or accept Real-Debrid keys, passwords or session tokens in this data. Profile PINs may only be synced as the existing salted hash, never plaintext.
- Admin: add the item count per account to the account drawer, and a "Clear synced data" button (audited).
- Tests for every rule. `npx tsc --noEmit` and `npm test` must pass.

Core (apps/core):
- A sync module for the signed-in remote account: pull on sign-in and every 60 s, and push local changes debounced 3 s after any change to those stores.
- Merge item by item with last-writer-wins.
- On the first sync for an account on a device, merge local data into the account rather than overwrite either side.
- Keep working offline and retry with backoff.
- Expose `GET /api/sync/status` returning `{ enabled, lastSyncAt, pending, error }` and `POST /api/sync/now`.
- Respect section 13: no keys in synced data.
- Old services without the endpoint (404) mean sync is silently off.
- Vitest tests for:
  - merge and conflict rules
  - first-sync merge
  - tombstones
  - backoff
  - the 404 path
- Typecheck plus the full Core suite must pass:
  - corepack pnpm -r run typecheck
  - the apps/core tests via npx vitest run in apps/core

Report to <scratch>/reports/sync.md. Include:
- the API shapes, exactly
- the migration file name
- what phones and Roku must do to join sync (the lead will brief them later)
- the exact deploy steps
