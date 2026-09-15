# Access, accounts and Live TV

How somebody gets into TVM, where their account lives, and why Live TV works
the way it does.

## Access

There are two tiers and no free one.

| Tier | What it is | Indicative price |
|---|---|---|
| `stream` | Movies and TV shows | £9.99/month |
| `stream-live` | Movies and TV shows + Live TV | £9.99/month + Live TV term |

Live TV is priced separately at the upstream panel's own three terms: £39.99
for 3 months, £89.99 for a year, £599 once. Those are the panel's dollar
figures charged in pounds, which is the margin — sterling is worth more than
the dollar.

**Nothing is sold inside the app.** There is no checkout, no card form for
access, and no route from any screen to a purchase. Somebody signs up, you
switch them on from **Settings → Developer → Accounts**, and the tier you
switch them on at is what they get.

A new account is inert. It can sign in, and it can see that it is waiting.
It cannot watch anything.

## The four states

| State | What the person sees |
|---|---|
| Signed out | Sign in, or ask for an account |
| `awaiting_activation` | "Almost there" — their address, and to send it to you |
| `terms_required` | The terms, with an agree button |
| `suspended` | "This account is switched off" |

The gate is rendered *instead of* the app, not as a screen inside it, so no
route, back gesture or deep link reaches the catalogue without a usable
account. The server enforces the same rule independently on every request.

## What is stored, and what is not

| Stored | Where |
|---|---|
| Email, display name | `secrets/accounts.enc`, AES-256-GCM sealed |
| Password **digest** | Same file — salted scrypt, per account |
| Signed up, last seen, sign-in count, last device | Same file |
| Session tokens | Only as sha256 digests |

**No password is stored and none can be recovered.** Not by a user, not by
you, not by anyone with the data folder. scrypt allows checking a password and
never reading one, which is why the admin screen shows everything about an
account *except* that, and why there is no "reveal password" anywhere: nothing
stored could produce one.

Session tokens are stored hashed for the same reason — a stolen data folder
yields no live sessions.

### Under UK GDPR

You are the data controller once real people have accounts. The obligations
that follow are not optional:

- **Access** — someone can ask what you hold. The admin screen shows all of it.
- **Erasure** — the *Erase account* button deletes the record and every session
  it owns, immediately. It asks once, because it cannot be undone.
- **Accuracy** — you can correct a display name or note.

Erasing an account cuts its live sessions on the next request rather than
waiting for a token to expire.

## Where accounts live

Today: **on the machine running the core**, sealed in the data directory.

For a single-owner appliance that is the right answer — the accounts are where
the app is, nothing leaves the machine, and there is no server to pay for,
patch or lose.

It is *not* the right answer if you want one account to work across several
independent installs without you activating each one. That needs a server, and
it needs to be a real one: accounts are the thing worth attacking, so it wants
HTTPS, backups, and somewhere the data is not simply a file on a laptop.

`createAccountsService` is deliberately the only thing that touches the store,
so a hosted backend is a matter of giving it a different implementation rather
than rewriting the callers. What it would need:

```
POST /accounts            create (returns the inert record)
POST /accounts/signin     verify, issue a session
GET  /accounts/session    resolve a token
POST /accounts/activate   owner only
GET  /accounts            owner only, search and filter
```

That server does not exist and is not scaffolded here, because untested
scaffolding for a service nobody is running is worse than nothing — it looks
finished and is not. Stand the server up, then swap the backend.

## Live TV

**Each person supplies their own IPTV subscription.** TVM stores the Xtream
login per install and connects to it directly from that device.

That is the architecture, and it is deliberate. The alternative — one
subscription on a server, re-streamed to every copy of TVM — is redistributing
Sky Sports, BBC, ITV and ESPN to third parties from a single account. In the UK
that is copyright infringement, and running it as a service has brought
criminal prosecutions under s.297A of the Copyright, Designs and Patents Act
1988 and the Fraud Act 2006. Putting a VPN in front of it does not change what
it is; it only describes an intention to avoid being traced.

So: Live TV is a tier that lets somebody use **their own** provider, and the
terms make each account responsible for having the right to whatever they
connect. That is also what makes the disclaimer in section 3 of the terms
true rather than decorative.

If the goal is simply that Live TV works away from home on your *own*
subscription, that is a different thing and it is legitimate — it is remote
access to a service you hold, like Plex remote access. It needs the core
reachable over the network with authentication, not a public relay.

## Developer mode

Two unlock codes. Both work on desktop, iOS and Android — the phone builds
used to refuse developer unlock outright, so a code was never actually
universal.

The newer code uses PBKDF2-HMAC-SHA256 at 600,000 iterations rather than
scrypt, because scrypt is in neither CryptoKit nor the Android platform
libraries, and a credential that cannot be checked on a phone is not a
universal credential. Neither password is in this repository, and a digest
does not run backwards.

Developer mode gates the accounts admin, the billing probe and the Stripe key
routes, checked on the server on every call rather than by hiding a route.
