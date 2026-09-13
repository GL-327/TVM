import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { masterKeyPath } from '../update/paths.ts';
import { windowsProtect, writePrivateFile } from './secureFile.ts';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_PREFIX = 'tvm-dpapi-v1:';
const keyCache = new Map<string, { stored: string; key: Buffer }>();

function loadOrCreateKey(dataDir: string): Buffer {
  const path = masterKeyPath(dataDir);
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
    const cached = keyCache.get(path);
    if (cached?.stored === raw) return cached.key;
    const encoded = raw.startsWith(KEY_PREFIX) ? windowsProtect(raw.slice(KEY_PREFIX.length), true) : raw;
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length === KEY_BYTES) {
      const stored = process.platform === 'win32' && !raw.startsWith(KEY_PREFIX)
        ? `${KEY_PREFIX}${windowsProtect(encoded)}` : raw;
      if (stored !== raw) writePrivateFile(path, stored);
      keyCache.set(path, { stored, key: decoded });
      return decoded;
    }
    // Never rotate a damaged key — sealed entitlements would silently reset to Free.
    throw new Error('master key is unreadable');
  }
  const key = randomBytes(KEY_BYTES);
  const encoded = key.toString('base64');
  const stored = process.platform === 'win32' ? `${KEY_PREFIX}${windowsProtect(encoded)}` : encoded;
  writePrivateFile(path, stored);
  keyCache.set(path, { stored, key });
  return key;
}

export function sealJson(dataDir: string, value: unknown): string {
  const key = loadOrCreateKey(dataDir);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function openJson<T>(dataDir: string, blob: string): T | null {
  try {
    const key = loadOrCreateKey(dataDir);
    const packed = Buffer.from(blob, 'base64');
    if (packed.length < IV_BYTES + AUTH_TAG_BYTES + 1) return null;
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function writeSealed(dataDir: string, path: string, value: unknown): void {
  writePrivateFile(path, sealJson(dataDir, value));
}

export function readSealed<T>(dataDir: string, path: string): T | null {
  try {
    const blob = readFileSync(path, 'utf8').trim();
    if (blob === '') return null;
    return openJson<T>(dataDir, blob);
  } catch {
    return null;
  }
}
