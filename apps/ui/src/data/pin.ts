import { getParentalContent } from './content';

export interface PinRecord {
  salt: string;
  hash: string;
  iter?: number;
}

export interface PinLockoutState {
  wrongCount: number;
  lockedUntilMs: number;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim().toLowerCase();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateSaltHex(byteLength = getParentalContent().pin.saltBytes): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function derivePinHashHex(
  pin: string,
  saltHex: string,
  iterations = getParentalContent().pin.iterations,
  keyBytes = getParentalContent().pin.keyBytes,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('WebCrypto subtle API is unavailable.');
  }
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations,
    },
    baseKey,
    keyBytes * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function createPinRecord(pin: string): Promise<Required<PinRecord>> {
  const policy = getParentalContent().pin;
  const salt = generateSaltHex(policy.saltBytes);
  const hash = await derivePinHashHex(pin, salt, policy.iterations, policy.keyBytes);
  return { salt, hash, iter: policy.iterations };
}

export async function verifyPinRecord(pin: string, record: PinRecord): Promise<boolean> {
  const policy = getParentalContent().pin;
  const computed = await derivePinHashHex(pin, record.salt, record.iter ?? policy.iterations, policy.keyBytes);
  if (computed.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i += 1) {
    diff |= computed.charCodeAt(i) ^ record.hash.charCodeAt(i);
  }
  return diff === 0;
}

export function isValidPinFormat(pin: string): boolean {
  const digits = getParentalContent().pin.digits;
  return new RegExp(`^\\d{${digits}}$`).test(pin);
}

export function remainingLockoutSeconds(state: PinLockoutState, nowMs = Date.now()): number {
  if (state.lockedUntilMs <= nowMs) return 0;
  return Math.max(1, Math.ceil((state.lockedUntilMs - nowMs) / 1000));
}

export function recordPinAttempt(state: PinLockoutState, ok: boolean, nowMs = Date.now()): PinLockoutState {
  if (ok) return { wrongCount: 0, lockedUntilMs: 0 };
  const policy = getParentalContent().pin;
  const nextCount = state.wrongCount + 1;
  if (nextCount >= policy.maxTries) {
    return {
      wrongCount: 0,
      lockedUntilMs: nowMs + policy.lockoutSeconds * 1000,
    };
  }
  return {
    wrongCount: nextCount,
    lockedUntilMs: state.lockedUntilMs,
  };
}
