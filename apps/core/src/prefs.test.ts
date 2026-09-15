import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, readPrefs, writePrefs } from './prefs.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('core prefs', () => {
  it('defaults to English with automatic updates on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-prefs-'));
    dirs.push(dir);
    expect(readPrefs(dir)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(dir).language).toBe('en');
    expect(readPrefs(dir).autoUpdate).toBe(true);
  });

  it('stores a Settings language override and auto-update off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-prefs-'));
    dirs.push(dir);
    expect(writePrefs(dir, { language: 'fr', autoUpdate: false })).toEqual({ language: 'fr', autoUpdate: false });
    expect(JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'))).toEqual({ language: 'fr', autoUpdate: false });
    expect(writePrefs(dir, { language: 'zz' }).language).toBe('fr');
  });
});
