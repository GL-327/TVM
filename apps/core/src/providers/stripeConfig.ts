import { stripeKeysPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';

/**
 * Where the Stripe keys live.
 *
 * Never the repository. A secret committed to git is public the moment the
 * repository is, and rewriting history does not un-publish it. Two sources are
 * accepted, in order:
 *
 *   1. The environment (STRIPE_SECRET_KEY and friends), which is how a server
 *      or CI runner supplies them.
 *   2. secrets/stripe.enc in the data directory, AES-256-GCM sealed by the
 *      same master key as the entitlement store, which on Windows is itself
 *      wrapped with DPAPI so only this user account can unwrap it.
 *
 * The secret key is never returned to a browser. Only the publishable key is,
 * and that one is designed to be public: it can create nothing and read
 * nothing on its own.
 */

/** Test keys move no money. Live keys move real money. Tell them apart by prefix. */
export type StripeMode = 'test' | 'live';

export interface StripeKeys {
  secretKey: string;
  publishableKey: string;
  /** Verifies that a webhook really came from Stripe. Absent until a webhook endpoint is created. */
  webhookSecret: string | null;
}

export interface StripeConfig extends StripeKeys {
  mode: StripeMode;
}

export type StripeConfigState =
  | { configured: true; config: StripeConfig }
  | { configured: false; reason: 'absent' | 'mismatched_mode' | 'malformed'; detail: string };

const SECRET_KEY = /^sk_(test|live)_[A-Za-z0-9]{16,}$/;
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=_-]{16,}$/;

export function keyMode(key: string): StripeMode | null {
  if (key.startsWith('sk_test_') || key.startsWith('pk_test_')) return 'test';
  if (key.startsWith('sk_live_') || key.startsWith('pk_live_')) return 'live';
  return null;
}

/**
 * A secret key in a log or an error message is a compromised key. Anything that
 * might carry one goes through here first.
 */
export function redact(value: string): string {
  return value
    .replace(/\b(sk|rk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_***')
    .replace(/\bwhsec_[A-Za-z0-9+/=_-]+/g, 'whsec_***');
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validate(raw: { secretKey: string; publishableKey: string; webhookSecret: string }): StripeConfigState {
  const { secretKey, publishableKey, webhookSecret } = raw;
  if (secretKey === '' && publishableKey === '') {
    return { configured: false, reason: 'absent', detail: 'No Stripe keys are configured.' };
  }
  if (!SECRET_KEY.test(secretKey)) {
    return { configured: false, reason: 'malformed', detail: 'The Stripe secret key should look like sk_test_... or sk_live_...' };
  }
  if (!PUBLISHABLE_KEY.test(publishableKey)) {
    return { configured: false, reason: 'malformed', detail: 'The Stripe publishable key should look like pk_test_... or pk_live_...' };
  }
  if (webhookSecret !== '' && !WEBHOOK_SECRET.test(webhookSecret)) {
    return { configured: false, reason: 'malformed', detail: 'The Stripe webhook secret should look like whsec_...' };
  }
  const mode = keyMode(secretKey);
  if (mode === null || mode !== keyMode(publishableKey)) {
    // Mixing a live secret with a test publishable key silently charges nobody
    // while the interface claims it charged someone. Refuse the pair outright.
    return {
      configured: false,
      reason: 'mismatched_mode',
      detail: 'The secret key and publishable key are from different Stripe modes. Use two test keys or two live keys.',
    };
  }
  return {
    configured: true,
    config: { secretKey, publishableKey, webhookSecret: webhookSecret === '' ? null : webhookSecret, mode },
  };
}

interface SealedStripeKeys {
  secretKey?: unknown;
  publishableKey?: unknown;
  webhookSecret?: unknown;
}

/**
 * The environment wins over the sealed file, so a server can override whatever
 * a laptop stored without anyone having to clear the file first.
 */
export function loadStripeConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): StripeConfigState {
  const sealed = readSealed<SealedStripeKeys>(dataDir, stripeKeysPath(dataDir)) ?? {};
  return validate({
    secretKey: trimmed(env['STRIPE_SECRET_KEY']) || trimmed(sealed.secretKey),
    publishableKey: trimmed(env['STRIPE_PUBLISHABLE_KEY']) || trimmed(sealed.publishableKey),
    webhookSecret: trimmed(env['STRIPE_WEBHOOK_SECRET']) || trimmed(sealed.webhookSecret),
  });
}

/** Validates before writing, so a typo cannot lock checkout into a broken state. */
export function saveStripeConfig(
  dataDir: string,
  input: { secretKey?: unknown; publishableKey?: unknown; webhookSecret?: unknown },
): StripeConfigState {
  const candidate = {
    secretKey: trimmed(input.secretKey),
    publishableKey: trimmed(input.publishableKey),
    webhookSecret: trimmed(input.webhookSecret),
  };
  const state = validate(candidate);
  if (!state.configured) return state;
  writeSealed(dataDir, stripeKeysPath(dataDir), candidate);
  return state;
}

export function clearStripeConfig(dataDir: string): void {
  deleteSecret(stripeKeysPath(dataDir));
}

/** What the interface and the billing API may know. Never includes the secret key. */
export interface PublicStripeStatus {
  configured: boolean;
  mode: StripeMode | null;
  publishableKey: string | null;
  webhookConfigured: boolean;
  reason: string | null;
}

export function publicStripeStatus(state: StripeConfigState): PublicStripeStatus {
  if (!state.configured) {
    return { configured: false, mode: null, publishableKey: null, webhookConfigured: false, reason: state.detail };
  }
  return {
    configured: true,
    mode: state.config.mode,
    publishableKey: state.config.publishableKey,
    webhookConfigured: state.config.webhookSecret !== null,
    reason: null,
  };
}
