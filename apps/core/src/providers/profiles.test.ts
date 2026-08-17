import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProfileService, MAX_PROFILES } from './profiles.ts';

describe('profiles', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-profiles-'));
    dirs.push(dir);
    return dir;
  }

  it('creates a default profile and migrates leftover progress', async () => {
    const dir = await dataDir();
    await writeFile(join(dir, 'progress.json'), JSON.stringify({ 'rd:1': { position: 90, duration: 3600, updated: '2026-01-01' } }));
    const profiles = createProfileService(dir);
    expect(profiles.list().profiles).toHaveLength(1);
    expect(profiles.activeId()).toBe('profile-1');
    const moved = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'profiles', 'profile-1', 'progress.json'), 'utf8')) as {
      'rd:1': { position: number };
    };
    expect(moved['rd:1']?.position).toBe(90);
  });

  it('caps the household at ten profiles', async () => {
    const profiles = createProfileService(await dataDir());
    for (let index = 0; index < MAX_PROFILES - 1; index += 1) {
      profiles.create(`Kid ${index + 1}`);
    }
    expect(profiles.list().profiles).toHaveLength(MAX_PROFILES);
    expect(() => profiles.create('Extra')).toThrow(/10 profiles/);
  });

  it('will not delete the last profile', async () => {
    const profiles = createProfileService(await dataDir());
    expect(() => profiles.remove(profiles.activeId())).toThrow(/at least one/);
  });
});
