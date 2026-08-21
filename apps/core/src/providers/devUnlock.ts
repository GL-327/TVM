import { scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function readFlag(dataDir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(devUnlockFlagPath(dataDir), 'utf8')) as { unlocked?: unknown };
    return raw.unlocked === true;
  } catch {
    return false;
  }
}

function writeFlag(dataDir: string, unlocked: boolean, at: string): void {
  if (!unlocked) {
    deleteSecret(devUnlockFlagPath(dataDir));
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(devUnlockFlagPath(dataDir), JSON.stringify({ unlocked: true, at }));
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
          memory = true;
          return true;
        }
      } catch {
        // Fall through to the plain flag if the vault cannot be opened.
      }
    }
    memory = readFlag(options.dataDir);
    return memory;
  };

  load();

  return {
    unlocked(): boolean {
      return load();
    },
    unlock(password: string): boolean {
      if (!verifyDeveloperPassword(password)) return false;
      memory = true;
      const at = new Date().toISOString();
      try {
        writeSealed(options.dataDir, devUnlockPath(options.dataDir), {
          unlocked: true,
          at,
        } satisfies DevUnlockRecord);
      } catch {
        // The flag still keeps developer mode across restart.
      }
      writeFlag(options.dataDir, true, at);
      return true;
    },
    lock(): void {
      memory = false;
      deleteSecret(devUnlockPath(options.dataDir));
      writeFlag(options.dataDir, false, '');
    },
  };
}

export type DevUnlockService = ReturnType<typeof createDevUnlockService>;
