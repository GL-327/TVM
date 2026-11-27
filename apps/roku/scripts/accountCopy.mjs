// JS reference mirror of apps/roku/source/accountCopy.brs.
export const MIN_PASSWORD_LENGTH = 10;

export function validateEmailInput(value) {
  const trimmed = value == null ? '' : String(value).trim();
  if (trimmed === '') return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) || trimmed.length > 254) {
    return 'Check the email address. It should look like name@example.com.';
  }
  return '';
}

export function validatePasswordInput(value, requireLength = false) {
  const pw = value == null ? '' : String(value);
  if (pw.length === 0) return requireLength ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : 'Enter your password.';
  if (requireLength && pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  return '';
}

export function accountStatusLabel(state) {
  if (!state || state.signedIn !== true || !state.account) return 'Signed out';
  const reason = String(state.usable?.reason ?? '').toLowerCase();
  if (state.account.suspended === true || reason === 'suspended' || String(state.account.status ?? '').toLowerCase() === 'suspended') {
    return 'Paused by the owner';
  }
  if (reason === 'email_unverified') return 'Confirm your email to continue';
  if (reason === 'terms_required') return 'Accept the terms to continue';
  if (state.account.activated !== true || reason === 'awaiting_activation') return 'Waiting for approval';
  return 'Active';
}

export function friendlyPlanName(id) {
  switch (String(id ?? '').toLowerCase()) {
    case 'stream': return 'Stream';
    case 'stream-live': return 'Stream + Live';
    case 'free': return 'TVM Free';
    case 'basic': return 'TVM Basic';
    case 'premium': return 'TVM Premium';
    case 'ultra': return 'TVM Ultra';
    case 'max': return 'TVM MAX';
    default: return 'No active plan';
  }
}

export function looksLikeRawCode(raw) {
  const s = String(raw).trim();
  if (s === '') return true;
  return /^[a-z0-9_.:-]+$/i.test(s) || /^(?:http|status|error)\s*[:#]?\s*\d{3}$/i.test(s) || /\b[45]\d{2}\b/.test(s);
}

const CODE_MESSAGES = {
  accounts_unavailable: "We couldn't reach TVM. Check your connection and try again.",
  service_unavailable: "We couldn't reach TVM. Check your connection and try again.",
  unavailable: "We couldn't reach TVM. Check your connection and try again.",
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  slow_down: 'Waiting for you…',
  pending: 'Waiting for you…',
  expired: 'Your code expired. Here is a new one.',
  forbidden: "You don't have permission to do that.",
  account_required: 'Please sign in again to continue.',
  unauthorized: 'Please sign in again to continue.',
  not_found: 'This copy of TVM needs an update before it can do that.',
  invalid_invite: 'That invite code is invalid or has already been used.',
  bad_request: 'Check what you entered and try again.',
  too_large: 'Check what you entered and try again.',
  https_required: 'Check what you entered and try again.',
  conflict: 'An account already exists for this email. Sign in instead.',
  invalid_json: 'TVM received an unexpected reply. Try again.',
};

const STATUS_MESSAGES = {
  400: 'Check what you entered and try again.',
  401: "That password doesn't match this email. Try again or ask the owner to reset it.",
  403: "You don't have permission to do that.",
  404: 'That feature is not available on this copy of TVM.',
  409: 'That action conflicts with the current state. Refresh and try again.',
  410: 'Your code expired. Here is a new one.',
  428: 'Waiting for you…',
  429: 'Too many attempts. Wait a few minutes, then try again.',
  500: "Something went wrong on TVM's side. Try again shortly.",
  502: "We couldn't reach TVM. Check your connection and try again.",
  503: "We couldn't reach TVM. Check your connection and try again.",
  504: 'TVM took too long to respond. Try again shortly.',
};

export function friendlyAccountError(rawError, statusCode = 0, context = 'general') {
  const raw = rawError == null ? '' : String(rawError).trim();
  const lower = raw.toLowerCase();

  if (lower === 'invalid' || lower === 'invalid_credentials') {
    if (context === 'signin') return "That password doesn't match this email. Try again or ask the owner to reset it.";
    if (context === 'register') return 'An account already exists for this email, or one of the fields needs checking.';
    return 'Check what you entered and try again.';
  }
  if (lower === 'that email address and password do not match.') {
    return "That password doesn't match this email. Try again or ask the owner to reset it.";
  }
  if (lower.includes('already exists') || lower.includes('could not be created')) {
    return 'An account already exists for this email. Sign in instead.';
  }
  if (lower === 'failed to fetch' || lower === 'load failed' || lower === 'request_failed' || lower.includes('network')) {
    return "We couldn't reach TVM. Check your connection and try again.";
  }
  if (lower.includes('took too long') || lower.includes('timed out') || lower === 'timeout' || lower === 'abort') {
    return 'TVM took too long to respond. Check your connection and try again.';
  }
  if (CODE_MESSAGES[lower]) return CODE_MESSAGES[lower];
  if (statusCode === 401 && context !== 'signin') return 'Please sign in again to continue.';
  if (STATUS_MESSAGES[statusCode]) return STATUS_MESSAGES[statusCode];
  if (raw === '' || looksLikeRawCode(raw)) return 'Something went wrong. Please try again.';
  return raw;
}

export function devicePollAction(statusCode, errorCode, interval) {
  const waitSec = interval < 5 ? 5 : interval;
  const err = String(errorCode ?? '').trim().toLowerCase();
  if (statusCode === 200 && err === '') return { action: 'approved', interval: waitSec, message: '' };
  if (statusCode === 428 || err === 'pending') return { action: 'wait', interval: waitSec, message: 'Waiting for you…' };
  if (statusCode === 429 && err === 'rate_limited') return { action: 'stop', interval: waitSec, message: 'Too many attempts. Wait a few minutes, then try again.' };
  if (statusCode === 429 || err === 'slow_down') return { action: 'wait', interval: waitSec + 5, message: 'Waiting for you…' };
  if (statusCode === 410 || err === 'expired') return { action: 'refresh', interval: waitSec, message: 'Your code expired. Here is a new one.' };
  if (statusCode <= 0 || statusCode === 502 || statusCode === 503 || statusCode === 504 || err === 'timeout' || err === 'request_failed' || err === 'unavailable') {
    return { action: 'wait', interval: waitSec, message: 'Checking connection…' };
  }
  return { action: 'stop', interval: waitSec, message: friendlyAccountError(errorCode, statusCode, 'signin') };
}

export function sanitizeDeviceClient(name) {
  const raw = name == null ? '' : String(name);
  let clean = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 32 && code !== 127) clean += raw[i];
  }
  clean = clean.trim();
  if (!clean) return 'TVM Roku';
  if (clean.length > 200) clean = clean.slice(0, 200).trim();
  return clean || 'TVM Roku';
}

export function shortDisplayUrl(url) {
  let s = String(url).trim();
  if (s.toLowerCase().startsWith('https://')) s = s.slice(8);
  else if (s.toLowerCase().startsWith('http://')) s = s.slice(7);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function shortDateText(iso) {
  const s = String(iso ?? '').trim();
  if (s.length < 10 || s[4] !== '-' || s[7] !== '-') return '-';
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(5, 7), 10);
  const d = parseInt(s.slice(8, 10), 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!(y >= 1970) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '-';
  return `${d} ${months[m - 1]} ${y}`;
}

export function formatPence(pence) {
  if (pence % 100 === 0) return `£${Math.floor(pence / 100)}`;
  const pounds = Math.floor(pence / 100);
  const rem = String(pence % 100).padStart(2, '0');
  return `£${pounds}.${rem}`;
}

export function tierDisplayName(id) {
  return String(id).toLowerCase() === 'stream-live' ? 'Stream + Live' : 'Stream';
}

export function yearlySavingsPercent(tiers) {
  if (!tiers || tiers.length === 0) return 0;
  const base = tiers[0];
  if (typeof base.monthlyPence !== 'number' || base.monthlyPence <= 0 || typeof base.yearlyPence !== 'number' || base.yearlyPence <= 0) return 0;
  const annual = base.monthlyPence * 12;
  if (base.yearlyPence >= annual) return 0;
  return Math.round(((annual - base.yearlyPence) * 100) / annual);
}

export function isRecommendedTier(tier, tiers) {
  const streamLive = (tiers ?? []).find((t) => t.id === 'stream-live');
  const liveOrderable = streamLive !== undefined && streamLive.orderable !== false && streamLive.availability !== 'Coming soon';
  if (liveOrderable) return tier.id === 'stream-live';
  return tier.id === 'stream';
}
