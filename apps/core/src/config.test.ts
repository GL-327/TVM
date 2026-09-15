import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION, DEFAULT_CORE_PORT, resolveBindHost, resolvePort } from './config.ts';

/**
 * The version a user sees comes from CORE_VERSION, which is a separate literal
 * from package.json because the core is bundled and cannot read its own
 * manifest at runtime. Two literals drift: the app reported 0.1.0 in its
 * status badge for the whole of the 1.0.0 release preparation, because a
 * version bump touched npm, Xcode, Gradle and Roku and missed this one.
 */
describe('the version the app reports', () => {
  it('matches the package it ships as', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CORE_VERSION).toBe(manifest.version);
  });

  it('looks like a release version', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('core binding', () => {
  it('defaults to the documented port and loopback', () => {
    expect(DEFAULT_CORE_PORT).toBe(7345);
    expect(resolvePort({})).toBe(DEFAULT_CORE_PORT);
    expect(resolvePort({ TVM_CORE_PORT: '8123' })).toBe(8123);
    // A typo'd port throws rather than falling back, so a misconfigured
    // install fails loudly instead of listening somewhere nobody expects.
    expect(() => resolvePort({ TVM_CORE_PORT: 'banana' })).toThrow(/between 0 and 65535/);
    expect(() => resolvePort({ TVM_CORE_PORT: '99999' })).toThrow();
    expect(resolveBindHost({})).toBe('127.0.0.1');
  });
});
