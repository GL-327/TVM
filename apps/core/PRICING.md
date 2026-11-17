# Core pricing and Live TV

New purchase surfaces use `/api/pricing`; `/api/billing` remains the legacy,
loopback-only engine. Account activation by the owner remains authoritative.
No payment adapter is connected to pricing acceptance, including when the
self-serve flag is enabled.

- `GET /api/pricing/book`: `{book, flags:{liveTvVisible, liveTvOrderable, selfServeBilling}}`.
  GBP prices are integer pence. Append immutable versions to `PRICE_BOOKS` with
  explicit `effectiveFrom` dates. Bundles sum the base and optional add-on lines.
- `POST /api/pricing/quote`: account required; body `{cadence:'month'|'year', liveTv:boolean}`.
  Returns a quote with `signature`, line quantities/periods, total and next billing date.
  Both lines share the cadence. Quotes last 15 minutes and are bound to the account.
- `POST /api/pricing/accept`: account required; body `{quote}` (the complete signed quote).
  Returns `{status:'manual_activation',message}` and records intent only. It never
  charges, starts a subscription or grants access. Retries deduplicate by account/quote ID.
- Invalid, expired and superseded quotes return `409` with `error` and a fresh `quote`.
  Clients must display and reconfirm the replacement; never automatically accept it.
  Live TV ordering disabled returns `409 live_tv_not_orderable`.
- `GET/PUT /api/admin/flags`: signed-in dev only, including on the LAN. PUT accepts
  a partial object with dotted keys, for example `{"liveTv.orderable":true}`.

Flags default to Live TV visible, unorderable, health from `TVM_LIVE_TV_ONLINE !== '0'`,
and self-serve billing disabled. Sealed operator overrides live in `secrets/flags.enc`.
Environment overrides take precedence: `TVM_FLAG_LIVE_TV_VISIBLE`,
`TVM_FLAG_LIVE_TV_ORDERABLE`, `TVM_FLAG_LIVE_TV_HEALTHY`, `TVM_FLAG_SELF_SERVE_BILLING`.
Use `1`/`0` or `true`/`false`. Provider IDs use the separate server-only map in
`providerPriceIds.ts`, with `TVM_PRICE_{TEST|LIVE}_{BASE|LIVETV}_{MONTH|YEAR}` variables.

Accepted snapshots are individually sealed records appended to `secrets/quotes.enc`
(one encrypted record per line). The HMAC secret is sealed in `secrets/quote-signing.enc`.
Damaged flag, quote-secret or acceptance stores fail closed instead of resetting.

`PlanStatus.liveTv` now means entitled; `liveTvHealthy` means operational health.
Unentitled live requests return `403 live_tv_not_entitled`; entitled requests during
an outage return `503 live_tv_unavailable` with a service message. Dev callers also
observe health. Visibility and orderability never revoke existing grants.
The gate checks the interim machine entitlement on catalogs, tune and every proxy/
segment request. Account-scoped entitlement and token ownership are a later migration.
LAN source writes require the requesting dev account, with loopback also permitted.

`/api/tiers` keeps `stream` and `stream-live`, advertises book-derived base/add-on
month/year amounts and marks unorderable Live TV as `Coming soon`. Legacy `catalog`
and `liveTvTerms` fields remain present but empty in plan status. Clients should
adopt the pricing book/quotes instead of the legacy purchase catalogs.

Sign-in allows five attempts per normalized email and thirty per socket IP in a
15-minute sliding window; excess requests return `429 rate_limited`.

Run the read-only migration report with Node 24 or later:

```powershell
node apps/core/scripts/entitlement-migration-report.mjs "C:\path\to\TVM-data"
```

The optional directory defaults to Core's data directory. The CLI never constructs
services, creates a vault key, upgrades DPAPI storage or writes a report file. It
prints JSON with mappings, legacy grant classifications and operator-verification
warnings. Exit code 2 means an existing store could not be read or recognized.
Machine grant ownership, unknown tiers, historical Live TV receipts and subscription
cadences require operator verification before any migration. Nothing is migrated,
repriced, rebilled or replayed by this report.
