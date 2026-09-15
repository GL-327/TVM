import { pbkdf2Sync, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { devUnlockFlagPath, devUnlockPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';

/** scrypt of the studio unlock code. The plaintext is not in this tree. */
const SALT = Buffer.from('74766d2d6465762d676c6f6769632d7631', 'hex');
const HASH = Buffer.from('a82246ec7f493b95c1affb96b88371797ba66eed05c669b159d151b0e61223e2', 'hex');
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;

/**
 * The second unlock code, accepted by every build rather than only the desktop
 * Core.
 *
 * It uses PBKDF2-HMAC-SHA256 instead of scrypt for one reason: scrypt has no
 * implementation in Apple's CryptoKit or the Android platform libraries, so a
 * scrypt credential could never have been checked on the phones without
 * vendoring a crypto library into both. PBKDF2 ships in the standard library
 * of all three runtimes, which is what makes a single shared credential
 * possible at all.
 *
 * 600,000 iterations is the OWASP floor for this construction, and is what
 * makes a stolen digest expensive rather than trivial to attack. The salt is
 * public by design — its only job is to stop one precomputed table serving
 * every install. The password itself appears nowhere in this repository, and
 * a digest cannot be run backwards to recover it.
 */
export const PBKDF2_SALT = Buffer.from('f80d2573b5a64e22beac1d5146baa2bc', 'hex');
export const PBKDF2_HASH = Buffer.from('15add22bda5d479cb1b3fb9caf874c112e84d589582164624b89d00ca79e22a7', 'hex');
export const PBKDF2_ITERATIONS = 600_000;

function matchesScrypt(password: string): boolean {
  try {
    return timingSafeEqual(scryptSync(password, SALT, HASH.length, SCRYPT), HASH);
  } catch {
    return false;
  }
}

function matchesPbkdf2(password: string): boolean {
  try {
    const derived = pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_HASH.length, 'sha256');
    return timingSafeEqual(derived, PBKDF2_HASH);
  } catch {
    return false;
  }
}

/**
 * Both codes are always checked, and both comparisons are constant time, so
 * neither the time taken nor an early return can tell an attacker which code
 * they were close to.
 */
export function verifyDeveloperPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) return false;
  const scrypt = matchesScrypt(password);
  const pbkdf2 = matchesPbkdf2(password);
  return scrypt || pbkdf2;
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

  return {
    unlocked(): boolean {
      return load();
    },
    unlock(password: string): boolean {
      if (!verifyDeveloperPassword(password)) return false;
      const at = new Date().toISOString();
      writeSealed(options.dataDir, devUnlockPath(options.dataDir), {
        unlocked: true,
        at,
      } satisfies DevUnlockRecord);
      memory = true;
      deleteSecret(devUnlockFlagPath(options.dataDir));
      return true;
    },
    lock(): void {
      memory = false;
      deleteSecret(devUnlockPath(options.dataDir));
      deleteSecret(devUnlockFlagPath(options.dataDir));
    },
  };
}

export type DevUnlockService = ReturnType<typeof createDevUnlockService>;
