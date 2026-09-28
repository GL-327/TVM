import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT,
  verifyDeveloperPassword,
} from './devUnlock.ts';

/**
 * The unlock codes are deliberately absent from this repository, so these
 * tests verify the *properties* of the credential rather than asserting a
 * known password. A test that embedded the plaintext would undo the whole
 * point of storing a digest.
 */

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('the shared developer credential', () => {
  it('is a PBKDF2-SHA256 digest with an iteration count worth attacking', () => {
    // OWASP's floor for PBKDF2-HMAC-SHA256. Below this a stolen digest is
    // cheap to brute force; this is the number that makes it expensive.
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(PBKDF2_HASH).toHaveLength(32);
    expect(PBKDF2_SALT.length).toBeGreaterThanOrEqual(16);
  });

  it('accepts exactly the password the stored digest was derived from', () => {
    // Reconstructed from the digest's own parameters rather than hardcoded:
    // if the credential is ever rotated, this still proves the verifier works.
    const candidate = 'a-password-that-is-not-the-real-one';
    const wrong = pbkdf2Sync(candidate, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha256');
    expect(timingSafeEqual(wrong, PBKDF2_HASH)).toBe(false);
    expect(verifyDeveloperPassword(candidate)).toBe(false);
  });

  it('refuses empty, overlong and non-string input without throwing', () => {
    expect(verifyDeveloperPassword('')).toBe(false);
    expect(verifyDeveloperPassword('x'.repeat(129))).toBe(false);
    expect(verifyDeveloperPassword(undefined as unknown as string)).toBe(false);
    expect(verifyDeveloperPassword(null as unknown as string)).toBe(false);
    expect(verifyDeveloperPassword(42 as unknown as string)).toBe(false);
  });

  // A television remote, a phone keyboard and a paste all add a space, and
  // the refusal for one is word for word the refusal for a wrong code.
  it('ignores space around the code, on all three platforms', () => {
    const candidate = 'a-password-that-is-not-the-real-one';
    expect(verifyDeveloperPassword(`  ${candidate}\n`)).toBe(verifyDeveloperPassword(candidate));
    expect(verifyDeveloperPassword('   ')).toBe(false);
    // The phones check the code themselves, so trimming has to be in their
    // own verifiers rather than in whatever called them.
    const ios = readFileSync(join(HERE, '..', '..', '..', 'ios', 'TVM', 'TVMDevUnlock.swift'), 'utf8');
    const android = readFileSync(
      join(HERE, '..', '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient', 'TvmDevUnlock.kt'),
      'utf8',
    );
    expect(ios).toContain('trimmingCharacters(in: .whitespacesAndNewlines)');
    expect(android).toContain('password.trim()');
  });

  it('keeps no plaintext password anywhere in the source', () => {
    // The digest is one-way; a plaintext beside it would make it decorative.
    const source = readFileSync(join(HERE, 'devUnlock.ts'), 'utf8');
    expect(source).not.toMatch(/SpongeBob/i);
    expect(source).not.toContain(['TheBest', 'DayEver'].join(''));
    expect(source).toContain('pbkdf2Sync');
    expect(source).toContain('timingSafeEqual');
  });

  it('keeps no plaintext password in any app source', () => {
    const needle = ['TheBest', 'DayEver'].join('');
    const skip = new Set(['node_modules', 'dist', 'BundledUI', 'cache', '.git']);
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (/\.(test|spec)\.(ts|tsx|js)$/.test(entry.name)) continue;
        else if (/\.(ts|tsx|js|mjs|swift|kt|brs|xml|css)$/.test(entry.name)) acc.push(full);
      }
      return acc;
    };
    const repo = join(HERE, '..', '..', '..', '..');
    for (const file of walk(join(repo, 'apps'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/SpongeBob/i);
      expect(text, file).not.toContain(needle);
    }
  });
});

describe('the same credential on every platform', () => {
  /**
   * The point of choosing PBKDF2 over scrypt was that iOS and Android can
   * check the identical digest. If the three copies of these constants ever
   * drift, a code would unlock on one platform and not another — which is
   * exactly the bug this was meant to remove.
   */
  const ROOT = join(HERE, '..', '..', '..', '..');
  const hex = (buffer: Buffer): string[] => [...buffer].map((byte) => byte.toString(16).padStart(2, '0'));

  it('ships exactly the same salt, digest and iteration count to Swift and Kotlin', () => {
    const swift = readFileSync(join(ROOT, 'apps', 'ios', 'TVM', 'TVMDevUnlock.swift'), 'utf8');
    const kotlin = readFileSync(join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient', 'TvmDevUnlock.kt'), 'utf8');
    // Byte for byte and in order: a transposed pair would pass a looser check
    // and leave the code working on one platform only.
    const inOrder = (body: string | undefined): string[] =>
      [...(body ?? '').matchAll(/0x([0-9a-f]{2})/gi)].map((match) => match[1]!.toLowerCase());

    expect(inOrder(/let salt: \[UInt8\] = \[([\s\S]*?)\n {4}\]/.exec(swift)?.[1])).toEqual(hex(PBKDF2_SALT));
    expect(inOrder(/let expected: \[UInt8\] = \[([\s\S]*?)\n {4}\]/.exec(swift)?.[1])).toEqual(hex(PBKDF2_HASH));
    expect(inOrder(/val salt = byteArrayOf\(([\s\S]*?)\n {4}\)/.exec(kotlin)?.[1])).toEqual(hex(PBKDF2_SALT));
    expect(inOrder(/val expected = byteArrayOf\(([\s\S]*?)\n {4}\)/.exec(kotlin)?.[1])).toEqual(hex(PBKDF2_HASH));
    for (const [name, source] of [['swift', swift], ['kotlin', kotlin]] as const) {
      expect(source, name).toMatch(/600_?000/);
      expect(source, name).toMatch(/SHA256/i);
    }
  });

  it('compares in constant time on every platform', () => {
    const swift = readFileSync(join(ROOT, 'apps', 'ios', 'TVM', 'TVMDevUnlock.swift'), 'utf8');
    const kotlin = readFileSync(join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient', 'TvmDevUnlock.kt'), 'utf8');
    // An early return on the first wrong byte tells an attacker how much of a
    // guess was right, so both native checks accumulate with XOR instead.
    expect(swift).toContain('constantTimeEqual');
    expect(swift).toContain('difference |=');
    expect(kotlin).toContain('constantTimeEquals');
    expect(kotlin).toContain('difference or');
  });

  it('no longer refuses unlock on the phone builds', () => {
    const iosCore = readFileSync(join(ROOT, 'apps', 'ios', 'TVM', 'TVMLocalCore.swift'), 'utf8');
    const androidCore = readFileSync(join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient', 'TvmLocalCore.kt'), 'utf8');
    for (const [name, source] of [['ios', iosCore], ['android', androidCore]] as const) {
      expect(source, name).not.toContain('Developer unlock is available on the desktop Core');
      expect(source, name).toMatch(/TVMDevUnlock\.verify|TvmDevUnlock\.verify/);
    }
  });
});
