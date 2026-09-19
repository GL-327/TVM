# Access, accounts and Live TV

How people get into TVM, where accounts live, and how Live TV is served.

## Access

Two tiers, no free one.

| Tier | What it is | Indicative price |
|---|---|---|
| `stream` | Movies and TV shows | £9.99/month |
| `stream-live` | Movies and TV shows + Live TV | £9.99/month + Live TV term |

Live TV is priced at the upstream panel's own terms: £39.99 for 3 months,
£89.99 for a year, £599 once.

Nothing is sold inside the app. Somebody signs up, you switch them on from
**Account → Accounts** (signed in as the dev account), and the tier you pick
is what they get. You can turn Live TV on or off for them later from the same
screen.

## The dev account

Every TVM has one built-in dev account. On the sign-in screen choose
**I'm a dev** and enter the developer code. That signs you in to the dev
account and turns dev mode on; signing out turns it off again. There is no
password to set, and nobody can register it, suspend it or erase it.

It works the same on the desktop, iPhone and Android. The code is checked by
Core (scrypt or PBKDF2-HMAC-SHA256 at 600,000 iterations); neither code is in
this repository.

Dev mode unlocks the Accounts screen, Email settings, the Developer screen,
the billing probe and the Stripe key routes. On every call Core checks that
the request carries the dev account's own session, not just that dev mode is
on somewhere. The desktop only serves other devices while you are signed in
as dev, so a machine-wide switch would have let anyone on the network use
these routes at exactly that time. The phones check the same way, since any
app on a phone can reach its local server.

Tapping the TVM logo seven times inside the app still opens the code screen;
it now switches you to the dev account. On a Roku, the owner code on the
waiting screen signs in as dev for one request, switches that account on,
and signs the dev session out again.

## Signing up

| State | What the person sees |
|---|---|
| Signed out | Sign in, ask for an account, or I'm a dev |
| `email_unverified` | "Check your email": a box for the six-digit code |
| `awaiting_activation` | "Almost there": their address, and to send it to you |
| `terms_required` | The terms, with an agree button |
| `suspended` | "This account is switched off" |

The sign-in screen is rendered instead of the app, so no route, back gesture
or deep link reaches the catalogue without a usable account.

### Email codes

When **Account → Email** is set up on the desktop TVM, everyone who signs up is
emailed a six-digit code and cannot go further until they type it in. The code
lasts 15 minutes, five wrong tries cancel it, and a new one can be sent once a
minute. Only a salted digest of the code is stored.

Any SMTP account works. Use an app password, not your real one:

| Provider | Server | Port | Security |
|---|---|---|---|
| iCloud Mail | smtp.mail.me.com | 587 | STARTTLS |
| Gmail | smtp.gmail.com | 465 | TLS |

TVM refuses to send a password over an unencrypted connection, except to a
relay on the same machine. The settings are sealed in `secrets/mail.enc` and
the password is never sent back to the interface.

Phones do not send email, so accounts made on a phone are never asked for a
code. The mail password would otherwise have to sit on every phone TVM is
installed on. From Accounts you can mark any address verified by hand.

Without email set up, nobody is asked for a code and accounts go straight to
waiting for you.

## What is stored

| Stored | Where |
|---|---|
| Email, display name | `secrets/accounts.enc`, AES-256-GCM sealed |
| Password digest | Same file, salted scrypt per account |
| Email code | Same file, salted SHA-256 digest, until used or expired |
| Account's Real-Debrid key | Same file |
| Signed up, last seen, sign-in count, last device | Same file |
| Session tokens | Only as SHA-256 digests |

No password is stored and none can be recovered, by anyone. The Accounts
screen shows everything about an account except that, and shows a Real-Debrid
key only as its last four characters.

On the phones the same ledger is `accounts.json` in the app's private
container.

### Under UK GDPR

You are the data controller once real people have accounts:

- **Access**: the Accounts screen shows everything held.
- **Erasure**: *Erase account* deletes the record and its sessions at once. It
  asks first, because it cannot be undone.
- **Accuracy**: you can correct a display name or note.

## Real-Debrid keys

Each account can have its own Real-Debrid key. You can paste one for them from
Accounts, or they can paste their own on the Real-Debrid screen. An account's
own key is used for everything that account plays. Accounts without one use
the key saved on the machine, which is the one the dev account saves.

## Where accounts live

On the machine running Core, sealed in the data directory. That suits a
single-owner appliance: nothing leaves the machine and there is no server to
run.

It does not suit one account working across several separate installs. That
needs a real hosted server with HTTPS and backups. `createAccountsService` is
the only thing that touches the store, so a hosted backend would be a new
implementation of it rather than a rewrite of its callers. No such server
exists yet.

## Live TV

**Each person supplies their own IPTV subscription.** TVM stores the provider
login per install and fetches from it through Core's proxy.

The alternative, one subscription on a server re-streamed to other people, is
redistributing channels to third parties. In the UK that is copyright
infringement, and running it as a service has led to prosecutions under
s.297A of the Copyright, Designs and Patents Act 1988 and the Fraud Act 2006.
Live TV is a tier that lets someone use their own provider, and the terms make
each account responsible for what they connect.

### Serving other devices

The desktop Core can relay Live TV to other devices on the LAN (a Roku, or a
phone in home-Core mode). It only does that while the dev account is signed in
on that Core. Otherwise other devices get `403 dev_account_required` from the
proxy routes, and the Live TV screen says why. The machine's own player is
never refused. Phones only listen on loopback, so they never serve anyone.

### Test channel

While the dev account is signed in on a TVM, Live TV there lists **DW News**,
Deutsche Welle's free English channel, even before a provider is added. It is
a real live broadcast (five renditions, relative paths, a subtitle track) and
plays through the proxy, so it is a quick check that proxy reflection works.
Every device using that TVM sees it, so the relay can be tested from a Roku
or a phone as well as the machine itself. BBC channels are
UK-only and need a TV licence, so they are not used. For offline, repeatable
checks use the IPTV tester in `apps/core/src/Server Side Live/tester`.
