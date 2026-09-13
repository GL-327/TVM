# TVM initial testing build

This build is for private, local desktop testing. It is not approved for a public paid launch.

## Start here

Close TVM and reopen `TVM-windowed.cmd` from the project directory. The launcher starts the local service, interface and desktop shell. If an older service is already running without watch mode, restart that service first. For a clean test profile, set `TVM_DATA_DIR` to a new absolute directory before starting; do not delete your existing data just to test.

1. In Settings, enable Colourcast using the existing Developer unlock, or choose its clearly labelled sandbox checkout. The existing developer code is unchanged.
2. Browse with arrows, OK and Back; test the mouse too. Change Motion to Reduced and check the calmer result. Minimise and restore the app; effects should resume without an animation jump or runaway loop.
3. Connect your own authorised IPTV or Real-Debrid account. Open a film and a concrete cloud episode, seek, pause, resume, retry a failed source and press Back while loading. A provider subscription or a working source is still required. Catalogue availability is not proof that a title can be played.
4. Open Plans. Complete a test transaction after selecting the acknowledgement. Try Success, Decline and Cancel outcomes. No card details are accepted or charged. The API rejects card payloads.
5. Check the plan, receipt and cancellation controls. Colourcast is a one-time £4.99 reference purchase and stays owned when changing/cancelling a test plan; it is excluded from the monthly price. Repeat a request with the same request ID to verify only one receipt is created.
6. Open Settings → Privacy & terms. Export data and inspect the downloaded JSON. Use deletion only on disposable test data: it wipes all profiles, viewing history, lists, credentials and test receipts and locks DEV mode. Other services’ accounts/cookies are separate.

## What changed

- Playback requests are bounded and cancellable. Concrete cloud episode IDs remain intact. Stale sign-in state no longer sends the viewer through a setup loop. The player handles initial stalls, freezes, seeking and HLS recovery with a way back.
- Retro beam/text movement uses transforms, animation loops join cleanly, artwork colour processing runs in a bounded worker with fallback, and background animation pauses in hidden windows. The intro cleans up its timers and keeps its lettering visible. Reduced motion follows the app/device preference.
- Checkout has an order summary, explicit test consent, decline/cancel outcomes, encrypted receipts, duplicate-request protection and test plan cancellation. Real charging is disabled; production-mode sandbox orders are rejected.
- Provider tokens, playlists, profiles, progress, watchlists and billing are encrypted with AES-256-GCM. Windows DPAPI protects master keys for the current Windows user. Existing plain credentials migrate on read; writes are atomic. On non-Windows systems keys use restrictive file permissions, not an OS keychain. Use disk encryption as well.
- Cross-site API access and untrusted Host headers are rejected. DEV unlock is rate limited and an unencrypted unlock flag no longer grants access. Valid encrypted DEV unlocks and the existing code remain supported.
- Privacy notice, export/deletion and clear source-rights information are available in the app. Third-party ad-network preroll requests are disabled for private testing.

## Payment setup after testing

There is no payment processor account or business identity configured in this repository. The checkout deliberately does not take money. Before accepting payments, implement processor-hosted checkout and a customer portal, verified signed webhooks, durable server-side entitlements, idempotent event handling, refunds and reconciliation. Set and validate real prices/tax treatment server-side, publish business/contact details and consumer terms, and test using that processor’s own sandbox. A client success redirect must never grant a paid entitlement. Local DEV access is a testing feature and cannot be a trusted commercial billing authority.

## Security and integration limits

Core still binds to `127.0.0.1` by default. LAN requests now need `Authorization: Bearer <TVM_LAN_TOKEN>` with at least 32 characters; admin/billing/privacy routes are local-only. Existing Roku clients need authentication integration before LAN testing. This work does not deploy HTTPS or provide remote multi-user authentication. Do not expose Core directly to the internet.

IPTV, debrid links and the existing resolver remain integrated. The current Torrentio resolver sends a Real-Debrid token in its request URL. This is disclosed in setup and privacy information; local encryption does not protect credentials from the remote resolver. Use a revocable test credential and confirm the providers permit the intended use. HTTP-only IPTV sources are not encrypted in transit. The preserved DEV code and locally controlled entitlements mean this remains a trusted-device test build, not a secure multi-tenant service.

Encryption does not protect against code already running as the same OS user. Browser search history remains local plain storage. Erasure does not promise forensic deletion of SSD blocks/backups and does not remove third-party browser cookies or provider-held data. Key loss can make saved data unreadable. Diagnostics and exports should be reviewed before sharing.

## Before a public release

The owner must confirm the legal operator, postal/support/privacy contacts, tester/customer territories, lawful bases and retention schedules, provider agreements and redistribution/content rights. Review branding of simulated service hubs, dependency/FFmpeg licensing, tax, accessibility, age suitability, complaints/refunds and any cross-border data transfers with qualified advisers. Preserving integrations is not a legal authorisation to distribute or watch third-party content. Do not describe this build as legally certified or fully compliant.

The UK private-test baseline was informed by [ICO privacy information guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/), [UK distance-selling requirements](https://www.gov.uk/online-and-distance-selling-for-businesses), and [PCI SSC guidance on sensitive authentication data](https://www.pcisecuritystandards.org/faqs/1139/). Check the rules and commencement dates applicable to the actual launch; no live consumer contract is created in this test build.

## Validation

Verified on 13 September 2026: compiler checks and production build pass; 596 unit/API tests pass. All 20 browser scenarios pass, with the focus-restoration case rerun successfully after correcting its asynchronous assertion. The production dependency audit reported zero known advisories. Checkout and Colourcast screenshots were inspected. Logs and previews are in the ignored `cache` directory.

The repository commands are `pnpm typecheck`, `pnpm build` and `pnpm test`. Tests use isolated temporary data and browser fixtures. Automated provider fixtures do not replace live testing on the intended television, remote, IPTV server, debrid account or native mpv setup. Build output retains the existing large lazy-loaded HLS chunk warning.
