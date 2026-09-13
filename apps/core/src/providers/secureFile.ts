import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Replace atomically: a power loss must not leave a half-written credential. */
export function writePrivateFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Only the current Windows account can unwrap a copied master key. */
export function windowsProtect(value: string, decrypt = false): string {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  // Secret material goes through stdin, never command arguments or console logs.
  const script = `Add-Type -AssemblyName System.Security; $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $resultBytes = [Security.Cryptography.ProtectedData]::${operation}($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($resultBytes))`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: value, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
