import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readSecret(path: string): string | null {
  try {
    const value = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export function hasSecretFile(path: string): boolean {
  return existsSync(path);
}

export function writeSecret(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { encoding: 'utf8' });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows cannot honour 0600; the file still lives outside the repo.
  }
}

export function deleteSecret(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing is fine.
  }
}
