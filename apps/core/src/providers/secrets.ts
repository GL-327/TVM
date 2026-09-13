import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { openJson, sealJson } from './vault.ts';
import { writePrivateFile } from './secureFile.ts';

const PREFIX = 'tvm-secret-v1:';
const secretRoot = (path: string): string => basename(dirname(path)) === 'secrets' ? dirname(dirname(path)) : dirname(path);

export function readSecret(path: string): string | null {
  try {
    const value = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
    if (value === '') return null;
    if (value.startsWith(PREFIX)) {
      const clear = openJson<unknown>(secretRoot(path), value.slice(PREFIX.length));
      return typeof clear === 'string' && clear !== '' ? clear : null;
    }
    // Existing installations migrate in place on their first successful read.
    writeSecret(path, value);
    return value;
  } catch {
    return null;
  }
}

export function hasSecretFile(path: string): boolean {
  return existsSync(path);
}

export function writeSecret(path: string, value: string): void {
  writePrivateFile(path, `${PREFIX}${sealJson(secretRoot(path), value)}`);
}

export function deleteSecret(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing is fine.
  }
}
