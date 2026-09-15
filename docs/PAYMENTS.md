# Payments

How TVM takes money, why it is built this way, and what you have to do by hand
to switch it from test payments to real ones.

## The short version

A card number never reaches TVM. The browser loads Stripe's own script, the
card is typed into an iframe served by Stripe, and it goes straight from the
buyer's browser to Stripe. TVM only ever handles a payment reference that looks
like `pi_3Q...`.

That is deliberate, and it is the single most important thing in this document.

## Why not just store the card?

An earlier version of this code took the card number, encrypted it with
AES-256-GCM, and kept it in `secrets/billing.enc` for "a future processor".
That has been removed, for two reasons.

**It was not legal to keep.** Storing a Primary Account Number puts you in
scope for PCI DSS. The obligations that come with it — network segmentation,
quarterly scanning, annual attestation, key ceremonies, an incident response
plan — are not things a single-developer project can satisfy. The only
achievable tier here is **SAQ-A**, which is available precisely *because* the
card never touches your systems.

**Encryption would not have saved it.** The application has to be able to
decrypt the number to use it, so the key ships with the application. Anyone who
has the app has the key. Encrypting a secret that travels with its own key is
obfuscation, not protection — it raises the effort required, and that is all.
This is the same reason there is no bank account number hidden anywhere in this
repository: a value the code can read is a value an attacker can read.

Under UK GDPR a card number is personal data, and Article 5(1)(f) asks for
security appropriate to the risk. For payment card data, "appropriate" means
not holding it.

## What TVM does hold

| Stored | Where | Why it is safe |
|---|---|---|
| Last 4 digits, brand, expiry | `secrets/billing.enc` | Not sufficient to charge a card. Printed on every receipt in the country. |
| Cardholder name, postcode | `secrets/billing.enc` | Personal data, encrypted at rest. |
| Stripe payment reference | `secrets/payments.enc` | An identifier. Useless without your Stripe secret key. |
| Stripe secret key | `secrets/stripe.enc` or environment | Encrypted with the master key, which on Windows is itself wrapped with DPAPI so only your Windows account can unwrap it. |

Everything in `secrets/` is AES-256-GCM sealed. Nothing in that table is a card
number, because no card number exists to store.

## How a payment runs

```
browser                     TVM core                      Stripe
   │                            │                            │
   │  POST /api/billing/intent  │                            │
   │───────────────────────────>│                            │
   │                            │  create PaymentIntent      │
   │                            │  (amount from the          │
   │                            │   catalogue, not the       │
   │                            │   browser)                 │
   │                            │───────────────────────────>│
   │   clientSecret             │<───────────────────────────│
   │<───────────────────────────│                            │
   │                            │                            │
   │  card details, direct to Stripe — never through TVM     │
   │────────────────────────────────────────────────────────>│
   │                            │                            │
   │                            │   payment_intent.succeeded │
   │                            │<───────────────────────────│
   │                            │   (signature verified)     │
   │                            │                            │
   │  POST /api/billing/confirm │                            │
   │───────────────────────────>│  re-read the intent        │
   │                            │───────────────────────────>│
   │   plan is active           │                            │
   │<───────────────────────────│                            │
```

Three things are worth noticing.

**The price is decided on the server.** `/api/billing/intent` ignores any
amount the browser sends and prices the order from the plan catalogue through
`priceOrder`, the same function the sandbox checkout uses. A buyer cannot name
their own total.

**Nothing is granted until Stripe confirms it.** The browser saying "that
worked" is not evidence. Both the webhook and the buyer's return trip cause the
server to re-read the PaymentIntent from Stripe, and the plan is granted only
against a status of `succeeded` with `amount_received` at least equal to the
order. A partial capture grants nothing.

**It cannot grant twice.** The webhook and the browser both land on `settle()`,
which returns immediately for an order already marked paid. Stripe event ids
are recorded, so a redelivered webhook is a no-op, and `Idempotency-Key` is
sent on every write to Stripe so a retried HTTP call cannot double charge.

## Running it in test mode

This works today and needs no company, no bank account and no identity checks.

1. Create a free account at [dashboard.stripe.com/register](https://dashboard.stripe.com/register).
2. Leave the **Test mode** toggle on.
3. Copy the two keys from **Developers → API keys**: `pk_test_...` and `sk_test_...`.
4. Start TVM, unlock developer mode, then store them:

```bash
curl -X PUT http://localhost:8788/api/billing/stripe/keys \
  -H 'content-type: application/json' \
  -d '{"secretKey":"sk_test_...","publishableKey":"pk_test_..."}'
```

Or set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in the environment,
which takes precedence over the stored file.

5. Open checkout. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.

Other useful test cards: `4000 0000 0000 0002` always declines,
`4000 0025 0000 3155` demands 3-D Secure, `4000 0000 0000 9995` fails for
insufficient funds. The full list is in Stripe's testing documentation.

### Webhooks on a laptop

Stripe cannot reach `localhost`. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and forward them:

```bash
stripe listen --forward-to localhost:8788/api/billing/webhook
```

It prints a `whsec_...` secret — store it as `webhookSecret` the same way you
stored the keys. Without it, webhook delivery is rejected as unsigned, and
settlement falls back to the `/api/billing/confirm` path, which works fine for
a demo.

## Going live

These are the steps **only you can do**. They involve creating an account,
proving your identity, and entering your bank details — none of which anyone
should do on your behalf.

1. **Activate the account.** Stripe dashboard → **Activate payments**. You will
   need your name, date of birth, home address, and what you are selling.
   Stripe is legally required to verify you before it will settle money to
   anyone; this is anti-money-laundering law, not a Stripe policy.

2. **Add your payout bank account.** Dashboard → **Settings → Bank accounts and
   scheduling** → add your Revolut account by sort code and account number.

   **This is the only place those digits belong.** They are not in this
   repository, they are not in any config file, and they should not be: no code
   path can move money using a destination account number, so putting them in
   the app would add risk and achieve nothing. Stripe holds them, Stripe pays
   you.

3. **Swap the keys.** Turn off **Test mode**, take the `pk_live_...` and
   `sk_live_...` keys, and store them the same way. TVM refuses a live secret
   key paired with a test publishable key — that mismatch would otherwise
   charge nobody while the interface claimed a payment succeeded.

4. **Create the webhook endpoint.** Dashboard → **Developers → Webhooks → Add
   endpoint**, pointing at `https://your-host/api/billing/webhook`, subscribed
   to `payment_intent.succeeded`, `payment_intent.payment_failed` and
   `charge.refunded`. Store the `whsec_...` it gives you.

   The endpoint must be HTTPS and reachable from the internet. Until it is,
   settlement relies on the buyer's browser returning to `/api/billing/confirm`,
   which is fine for a demonstration and not fine for a real shop — a buyer who
   closes the tab mid-payment would be charged without being granted anything.

5. **Check it end to end** with one real payment to yourself, then refund it:

```bash
curl -X POST http://localhost:8788/api/billing/refund \
  -H 'content-type: application/json' \
  -d '{"paymentIntentId":"pi_..."}'
```

Refunding returns the money and takes the entitlement back with it. Stripe
keeps its fee on a refunded payment, so a £12.99 test costs you roughly 50p.

## What taking real money commits you to

Worth understanding before you switch the keys on, and worth writing up for the
NEA, because it is the part most projects miss.

- **Consumer Contracts Regulations 2013** — a buyer who purchases online has 14
  days to cancel and get their money back. Digital content is exempt *only if*
  they expressly agreed to immediate delivery and acknowledged losing the
  right. If you sell to real people, checkout has to say so.
- **Refunds** — `/api/billing/refund` exists and works. It is developer-gated,
  which is right for a private build and wrong for a shop.
- **Records** — receipts are kept in `secrets/billing.enc` and in the Stripe
  dashboard. HMRC expects business records kept for six years.
- **Strong Customer Authentication** — handled by Stripe. The 3-D Secure
  redirect path is already wired through `confirmPayment`.
- **UK GDPR** — buyers can ask what you hold about them and ask you to delete
  it. `clearBilling()` covers the local side; Stripe has its own process.

For an NEA demonstration where you are the only buyer, none of this is a
practical problem. It matters the moment anyone else pays.

## Testing

`apps/core/src/providers/payments.test.ts` covers the parts that would lose
money or grant something unpaid:

- the charged amount comes from the catalogue, not the request body
- a repeated request id reuses one intent instead of opening a second
- webhook and browser-return together grant exactly once
- a redelivered webhook grants nothing
- a short `amount_received` grants nothing
- an unsigned, wrongly signed, tampered or replayed webhook grants nothing
- a refund reverses the entitlement, and cannot exceed what was charged
- the secret key is encrypted on disk and never appears in any API response

None of them reach the network: Stripe is injected through `clientFactory`.
