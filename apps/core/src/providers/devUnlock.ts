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
export const PBKDF2_SALT = Buffer.from('7318f8167254137fe74ca4b6682c1aaa', 'hex');
export const PBKDF2_HASH = Buffer.from('8e144ed529289b3b617e50ee6c4f0ffb3e9890a1bbd224fb2a339cac7aaabca2', 'hex');
export const PBKDF2_ITERATIONS = 600_000;

/** Constant time, so how long it takes says nothing about how close a guess was. */
export function verifyDeveloperPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) return false;
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
