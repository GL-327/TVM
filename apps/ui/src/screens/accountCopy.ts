import type { AccountBlock, AccountState, AccountTier } from '../data/account';

export type ErrorContext = 'signin' | 'register' | 'verify' | 'terms' | 'admin' | 'billing' | 'plans' | 'general';

export const MIN_PASSWORD_LENGTH = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validates email input for sign-in and account creation. */
export function validateEmailInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > 254) {
    return 'Check the email address. It should look like name@example.com.';
  }
  return null;
}

/** Validates password input for sign-in or account creation. */
export function validatePasswordInput(value: string, requireLength = false): string | null {
  if (value.length === 0) return requireLength ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : 'Enter your password.';
  if (requireLength && value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > 200) return 'That password is too long.';
  return null;
}

/** Maps backend account states to calm, plain-language labels (never raw codes). */
export function accountStatusLabel(state: Pick<AccountState, 'signedIn' | 'account' | 'usable'> | null | undefined): string {
  if (!state || !state.signedIn || state.account === null) return 'Signed out';
  const reason: AccountBlock | null = state.usable.reason;
  if (state.account.suspended || reason === 'suspended') return 'Paused by the owner';
  if (reason === 'email_unverified') return 'Confirm your email to continue';
  if (reason === 'terms_required') return 'Accept the terms to continue';
  if (!state.account.activated || reason === 'awaiting_activation') return 'Waiting for approval';
  return 'Active';
}

/** Maps a tier or plan identifier to a plain human-readable name. */
export function friendlyPlanName(id: AccountTier | string | null | undefined): string {
  switch (id) {
    case 'stream':
      return 'Stream';
    case 'stream-live':
      return 'Stream + Live';
    case 'free':
      return 'TVM Free';
    case 'basic':
      return 'TVM Basic';
    case 'premium':
      return 'TVM Premium';
    case 'ultra':
      return 'TVM Ultra';
    case 'max':
      return 'TVM MAX';
    default:
      return 'No active plan';
  }
}

/** Maps Stripe processor configuration reasons to plain sentences. */
export function friendlyProcessorReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'absent':
      return "Card billing isn't set up on this device yet.";
    case 'malformed':
      return 'The saved payment keys look incomplete. Check Settings on this device.';
    case 'mismatched_mode':
      return 'The payment keys mix test and live modes. Use matching keys to continue.';
    case 'stripe_test':
      return 'Test card billing is active.';
    case 'stripe_live':
      return 'Live card billing is active.';
    default:
      if (reason && !/^[a-z0-9_:-]+$/i.test(reason) && !/^\d{3}$/.test(reason)) return reason;
      return "Card billing isn't connected on this device.";
  }
}

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  accounts_unavailable: "We couldn't reach TVM. Check your connection and try again.",
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  forbidden: "You don't have permission to do that.",
  developer_required: 'Sign in with the owner account to manage accounts.',
  admin_required: 'Sign in with the owner account and admin key to continue.',
  account_required: 'Please sign in first.',
  not_found: 'This copy of TVM needs an update before it can do that.',
  moved: 'Email codes are handled by the account service now. Check back shortly.',
  local_access_required: 'Billing details can only be opened on this device.',
  live_tv_not_orderable: "Live TV isn't available to add right now.",
  live_tv_not_entitled: "Live TV isn't active on this account.",
  live_tv_unavailable: "Live TV isn't available right now. Try again shortly.",
  quote_invalid: 'Plan pricing changed while you were reviewing. Refresh and try again.',
  quote_expired: 'That pricing summary expired. Refresh and try again.',
  price_changed: 'Plan pricing updated. Review the current prices and try again.',
  invalid_quote_input: 'That plan selection could not be processed. Try again.',
  not_configured: "Card billing isn't connected on this device.",
  missing_token: 'No saved card was found on this device.',
  no_processor: "Card billing isn't connected on this device.",
  payment_failed: 'The card payment was declined. Try another card.',
  card_declined: 'The card payment was declined. Try another card.',
  invalid_flags: 'Those settings were not valid.',
  unauthorized: 'Please sign in again to continue.',
  bad_request: 'Check what you entered and try again.',
  conflict: 'An account already exists for this email. Sign in instead.',
  service_unavailable: "We couldn't reach TVM. Check your connection and try again.",
};

const HTTP_STATUS_MESSAGES: Readonly<Record<string, string>> = {
  '400': 'Check what you entered and try again.',
  '401': 'That password doesn’t match this email. Try again or ask the owner to reset it.',
  '403': "You don't have permission to do that.",
  '404': 'That feature is not available on this copy of TVM.',
  '409': 'That action conflicts with the current state. Refresh and try again.',
  '410': 'That step is no longer used. Refresh and try again.',
  '429': 'Too many attempts. Wait a few minutes, then try again.',
  '500': "Something went wrong on TVM's side. Try again shortly.",
  '502': "We couldn't reach TVM. Check your connection and try again.",
  '503': "We couldn't reach TVM. Check your connection and try again.",
  '504': 'TVM took too long to respond. Try again shortly.',
};

function looksLikeRawCode(raw: string): boolean {
  return /^[a-z0-9_.:-]+$/i.test(raw) || /^(?:http|status|error)\s*[:#]?\s*\d{3}$/i.test(raw) || /\b[45]\d{2}\b/.test(raw);
}

/**
 * Maps any thrown error, status code, or backend token into a plain sentence
 * suitable for display. Raw status numbers and snake_case tokens are never returned.
 */
export function friendlyAccountError(error: unknown, context: ErrorContext = 'general'): string {
  const raw = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim();
  if (raw === '') return 'Something went wrong. Please try again.';

  const lower = raw.toLowerCase();

  if (lower === 'invalid' || lower === 'invalid_credentials') {
    if (context === 'signin') return "That password doesn't match this email. Try again or ask the owner to reset it.";
    if (context === 'register') return 'An account already exists for this email, or one of the fields needs checking.';
    if (context === 'admin') return "That change couldn't be saved. Check the input and try again.";
    return 'Check what you entered and try again.';
  }

  if (lower === 'that email address and password do not match.') {
    return "That password doesn't match this email. Try again or ask the owner to reset it.";
  }

  if (lower.includes('already exists') || lower.includes('could not be created')) {
    return 'An account already exists for this email. Sign in instead.';
  }

  if (lower === 'failed to fetch' || lower === 'load failed' || lower.includes('networkerror') || lower.includes('network request failed')) {
    return "We couldn't reach TVM. Check your connection and try again.";
  }

  if (lower.includes('took too long') || lower.includes('timed out') || lower.includes('abort')) {
    return 'TVM took too long to respond. Check your connection and try again.';
  }

  const mappedCode = CODE_MESSAGES[lower];
  if (mappedCode !== undefined) return mappedCode;

  const statusDigits = raw.match(/\b([45]\d{2})\b/)?.[1];
  if (statusDigits !== undefined && HTTP_STATUS_MESSAGES[statusDigits] !== undefined) {
    if (statusDigits === '401' && context !== 'signin') return 'Please sign in again to continue.';
    return HTTP_STATUS_MESSAGES[statusDigits]!;
  }

  if (HTTP_STATUS_MESSAGES[raw] !== undefined) return HTTP_STATUS_MESSAGES[raw]!;

  if (looksLikeRawCode(raw)) {
    return 'Something went wrong. Please try again.';
  }

  return raw;
}
