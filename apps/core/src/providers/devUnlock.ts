import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { devUnlockFlagPath, devUnlockPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';

/**
 * The developer code: one code, the same on the desktop, iPhone and Android.
 * Only a PBKDF2-HMAC-SHA256 digest is kept, because PBKDF2 is in the standard
 * library of all three (scrypt is not). The same salt and digest are in
 * TVMDevUnlock.swift and TvmDevUnlock.kt, and a test checks they match.
 *
 * 600,000 iterations is the OWASP floor. The salt is public by design. The
 * code itself is not in this repository.
 */
export const PBKDF2_SALT = Buffer.from('ff00d19a49bac718676167cc32599b88', 'hex');
export const PBKDF2_HASH = Buffer.from('520f9e3aad671dec8b28798877f2966eb197fd7df5e1c0a492db2dcb428eb4ff', 'hex');
export const PBKDF2_ITERATIONS = 600_000;

/**
 * Constant time, so how long it takes says nothing about how close a guess was.
 *
 * Surrounding space is dropped first. A television remote, a phone keyboard
 * and a paste all add one easily, and "that code is not valid" for a space is
 * indistinguishable from the wrong code.
 */
export function verifyDeveloperPassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  password = password.trim();
  if (password.length === 0 || password.length > 128) return false;
  try {
    const derived = pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_HASH.length, 'sha256');
    return timingSafeEqual(derived, PBKDF2_HASH);
  } catch {
    return false;
  }
}

export interface DevUnlockRecord {
  unlocked: boolean;
  at: string;
}

export function createDevUnlockService(options: { dataDir: string }) {
  let memory = false;

  const load = (): boolean => {
    if (memory) return true;
    const path = devUnlockPath(options.dataDir);
    if (existsSync(path)) {
      try {
        const record = readSealed<DevUnlockRecord>(options.dataDir, path);
        if (record?.unlocked === true) {
          deleteSecret(devUnlockFlagPath(options.dataDir));
          memory = true;
          return true;
        }
      } catch {
        // A damaged vault must not grant developer access.
      }
    }
    return memory;
  };

  load();

  /** Developer mode without a code. Only for the dev account, whose sign-in already checked one. */
  const grant = (): void => {
    writeSealed(options.dataDir, devUnlockPath(options.dataDir), {
      unlocked: true,
      at: new Date().toISOString(),
    } satisfies DevUnlockRecord);
    memory = true;
    deleteSecret(devUnlockFlagPath(options.dataDir));
  };

  return {
    unlocked(): boolean {
      return load();
    },
    unlock(password: string): boolean {
      if (!verifyDeveloperPassword(password)) return false;
      grant();
      return true;
    },
    grant,
    lock(): void {
      memory = false;
      deleteSecret(devUnlockPath(options.dataDir));
      deleteSecret(devUnlockFlagPath(options.dataDir));
    },
  };
}

export type DevUnlockService = ReturnType<typeof createDevUnlockService>;
