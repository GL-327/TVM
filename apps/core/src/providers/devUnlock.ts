import { scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { devUnlockFlagPath, devUnlockPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';

/** scrypt of the studio unlock code. The plaintext is not in this tree. */
const SALT = Buffer.from('74766d2d6465762d676c6f6769632d7631', 'hex');
const HASH = Buffer.from('a82246ec7f493b95c1affb96b88371797ba66eed05c669b159d151b0e61223e2', 'hex');
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;

export function verifyDeveloperPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) return false;
  try {
    const derived = scryptSync(password, SALT, HASH.length, SCRYPT);
    return timingSafeEqual(derived, HASH);
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
