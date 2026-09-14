import { randomUUID } from 'node:crypto';
import { cvcOk, digitsOnly, expiryOk, lastFour, luhnOk } from './card.ts';
import { openJson, sealJson } from './vault.ts';

export const CARD_DATA_NOT_SUPPORTED = 'card_data_not_supported';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'jcb' | 'diners' | 'unknown';

export interface CardIntake {
  name: string;
  number: string;
  expiry: string;
  cvc: string;
  zip?: string;
}

export interface PublicCardToken {
  tokenId: string;
  last4: string;
  brand: CardBrand;
  expiry: string;
  name: string;
  zip: string | null;
  createdAt: string;
}

export interface CardVaultState {
  version: 1;
  tokens: PublicCardToken[];
  /** tokenId → AES-256-GCM blob of `{ pan }`. Never returned by GET billing. */
  instruments: Record<string, string>;
}

export interface CardFieldInput {
  name?: unknown;
  number?: unknown;
  expiry?: unknown;
  cvc?: unknown;
  zip?: unknown;
}

export function emptyCardVault(): CardVaultState {
  return { version: 1, tokens: [], instruments: {} };
}

export function cardFieldsPresent(input: CardFieldInput): boolean {
  return input.name !== undefined || input.number !== undefined || input.expiry !== undefined || input.cvc !== undefined;
}

export function cardBrand(number: string): CardBrand {
  const digits = digitsOnly(number);
  if (/^4/.test(digits)) return 'visa';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^3(?:0[0-5]|[68])/.test(digits)) return 'diners';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  if (/^35/.test(digits)) return 'jcb';
  const prefix2 = Number(digits.slice(0, 2));
  const prefix4 = Number(digits.slice(0, 4));
  if ((prefix2 >= 51 && prefix2 <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) return 'mastercard';
  return 'unknown';
}

export function normalizeExpiry(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/);
  if (match === null || match[1] === undefined || match[2] === undefined) return value.trim();
  const month = String(Number(match[1])).padStart(2, '0');
  let year = Number(match[2]);
  if (year >= 100) year = year % 100;
  return `${month}/${String(year).padStart(2, '0')}`;
}

function nameOk(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= 80 && /[A-Za-z]/.test(name);
}

function zipOk(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 \-]{1,11}$/.test(value.trim());
}

export function parseCardIntake(input: CardFieldInput): { ok: true; intake: CardIntake } | { ok: false; reason: 'absent' | 'invalid' } {
  if (!cardFieldsPresent(input)) return { ok: false, reason: 'absent' };
  if (typeof input.name !== 'string' || typeof input.number !== 'string' || typeof input.expiry !== 'string' || typeof input.cvc !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  if (!nameOk(input.name) || !luhnOk(input.number) || !expiryOk(input.expiry) || !cvcOk(input.cvc)) {
    return { ok: false, reason: 'invalid' };
  }
  const zip = typeof input.zip === 'string' ? input.zip.trim() : '';
  if (input.zip !== undefined && input.zip !== '' && (typeof input.zip !== 'string' || !zipOk(zip))) {
    return { ok: false, reason: 'invalid' };
  }
  return {
    ok: true,
    intake: {
      name: input.name.trim(),
      number: digitsOnly(input.number),
      expiry: normalizeExpiry(input.expiry),
      cvc: input.cvc.trim(),
      zip: zip === '' ? undefined : zip,
    },
  };
}

/** Replace PAN with a token. CVC is validated by the caller and never stored. */
export function tokenizeCard(dataDir: string, intake: CardIntake, now = new Date()): { token: PublicCardToken; sealedPan: string } {
  const pan = digitsOnly(intake.number);
  const token: PublicCardToken = {
    tokenId: `tok_${randomUUID().replace(/-/g, '')}`,
    last4: lastFour(pan),
    brand: cardBrand(pan),
    expiry: normalizeExpiry(intake.expiry),
    name: intake.name.trim(),
    zip: intake.zip?.trim() ? intake.zip.trim() : null,
    createdAt: now.toISOString(),
  };
  return { token, sealedPan: sealJson(dataDir, { pan }) };
}

export function rememberToken(state: CardVaultState, token: PublicCardToken, sealedPan: string): CardVaultState {
  return {
    version: 1,
    tokens: [token, ...state.tokens.filter((entry) => entry.tokenId !== token.tokenId)].slice(0, 8),
    instruments: { ...state.instruments, [token.tokenId]: sealedPan },
  };
}

export function publicCardToken(token: PublicCardToken): PublicCardToken {
  return {
    tokenId: token.tokenId,
    last4: token.last4,
    brand: token.brand,
    expiry: token.expiry,
    name: token.name,
    zip: token.zip,
    createdAt: token.createdAt,
  };
}

export function publicPaymentMethod(state: CardVaultState): PublicCardToken | null {
  const token = state.tokens[0];
  return token === undefined ? null : publicCardToken(token);
}

export function findToken(state: CardVaultState, tokenId: string | undefined): PublicCardToken | null {
  if (tokenId === undefined || tokenId === '') return state.tokens[0] ?? null;
  return state.tokens.find((token) => token.tokenId === tokenId) ?? null;
}

/** Opens the sealed PAN for a future processor. Callers must not return or log it. */
export function readSealedPan(dataDir: string, sealed: string | undefined): string | null {
  if (sealed === undefined || sealed === '') return null;
  const opened = openJson<{ pan?: unknown }>(dataDir, sealed);
  return typeof opened?.pan === 'string' && luhnOk(opened.pan) ? opened.pan : null;
}

export function hydrateCardVault(raw: unknown): CardVaultState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyCardVault();
  const value = raw as { version?: unknown; tokens?: unknown; instruments?: unknown };
  if (value.version !== 1 || !Array.isArray(value.tokens) || value.instruments === null || typeof value.instruments !== 'object' || Array.isArray(value.instruments)) {
    return emptyCardVault();
  }
  const tokens: PublicCardToken[] = [];
  for (const entry of value.tokens) {
    if (entry === null || typeof entry !== 'object') continue;
    const token = entry as Partial<PublicCardToken>;
    if (typeof token.tokenId !== 'string' || typeof token.last4 !== 'string' || typeof token.brand !== 'string' || typeof token.expiry !== 'string') continue;
    tokens.push(publicCardToken({
      tokenId: token.tokenId,
      last4: token.last4,
      brand: token.brand as CardBrand,
      expiry: token.expiry,
      name: typeof token.name === 'string' ? token.name : '',
      zip: typeof token.zip === 'string' ? token.zip : null,
      createdAt: typeof token.createdAt === 'string' ? token.createdAt : '',
    }));
  }
  const instruments: Record<string, string> = {};
  for (const [id, blob] of Object.entries(value.instruments as Record<string, unknown>)) {
    if (typeof blob === 'string' && blob !== '') instruments[id] = blob;
  }
  return { version: 1, tokens, instruments };
}
