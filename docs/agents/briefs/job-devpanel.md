Job: DEV PANEL, more owner tools on the accounts dashboard. Repo: the PRIVATE accounts service checkout (`Desktop/TVM-accounts`), branch main. Its README lists the API, migrations and deploy steps. Never copy `.dev.vars.secret`, keys or account data into the public TVM repo.

Owner: "add more features to the DEV panel." The dashboard at `/admin` already has Accounts, Activity, Announcements and Settings (open sign-ups, minimum version, flags, patch-notes pop-up, the universal Real-Debrid key, mail).

## Add, in this order (each must be admin-only and logged to Activity)
1. **Overview page (new first tab):**
   - accounts by status and plan
   - active in the last 24 h and 7 d (from `last_seen_at`)
   - new sign-ups this week
   - app versions in use (record the client and version on each `/v1/me` call; add a column if needed)
   - sync usage (items per kind)
2. **Devices:** every signed-in session across all accounts, with client, version and last used. Sign one out, or "Sign out everywhere" for an account.
3. **Synced data per account,** in the account drawer:
   - counts and a read-only list of profiles, Continue Watching, watchlist and preferences from `/v1/me/data` storage
   - reset one kind, and export that account's synced data as JSON
   - never show secrets (there are none in sync by design; keep it that way)
4. **Plan expiry:** an optional end date per account. After it, the account drops to "suspended" automatically, checked on `/v1/me`. Show "expires in N days" in the list, plus a filter for expiring soon.
5. **Invite codes:** generate single-use or N-use codes with a plan and an expiry. A sign-up with a valid code is approved straight away even while open sign-ups is off; codes never grant the universal Real-Debrid key unless the owner ticks that on the code. The list shows the uses.
6. **Maintenance mode:** a switch and message in Settings, exposed in the public config (`maintenance: {on, message}`). The apps show it as a banner; it does not block playback.
7. **Per-account feature flags:** override any app-wide flag for one account (for testing).
8. **Real-Debrid status per account:** own key / universal / none, the last check result and when. A "check now" button (best-effort, because Real-Debrid refuses Cloudflare IPs; say so in the UI).
9. **Announcements:** target all, one plan or one account, with an end date.
10. **Security:**
    - the admin session locks after 30 minutes idle
    - the sign-in failure view lists locked-out emails and IPs, with "unlock"
    - CSV export of Activity

## Rules
- Use TVM's look, as the current dashboard does (dark, Geist, centred solid nav, drawers). Plain short copy; no AI-ish filler.
- Use D1 migrations as `migrations/0006_*.sql` (and onward). Apply them remotely only after tests pass.
- Tests for every new route, including that non-admins get 401/403. Run `npx tsc --noEmit` and `npm test`.
- The dashboard's browser script is embedded as a string: parse it separately before deploying, as before, and watch for apostrophes breaking it.
- Deploy: `npx wrangler d1 migrations apply tvm-accounts --remote`, then `npx wrangler deploy`. Then check that `/admin` loads, the public config answers, and existing members still sign in.

## App side (public TVM repo)
The apps need small changes for items 5 and 6:
- an optional "Invite code" field on sign-up (Core `remoteAccounts.ts`, the React AccountGate, Windows native sign-up, the phone engines and Roku)
- the maintenance banner, read from config

Do those as a separate commit in the TVM repo following CLAUDE.md, with a version bump and changelog. Commit as GL327 with no Co-Authored-By lines. Push only if the owner has said so in this chat.

Report what landed and what's untested.
