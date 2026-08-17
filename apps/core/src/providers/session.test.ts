import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionService } from './session.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('session switch', () => {
  it('is unavailable on Windows and when the appliance helper is missing', () => {
    const service = createSessionService({ dataDir: tmpdir(), platform: 'win32', helperPath: '/nope' });
    expect(service.status()).toEqual({ appliance: false, mode: 'unknown' });
    expect(service.request('desktop')).toEqual({ ok: false, reason: 'not_appliance' });
  });

  it('writes a desktop request when the helper exists', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tvm-session-'));
    dirs.push(dataDir);
    const helperPath = join(dataDir, 'switch-session');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(helperPath, '#!/bin/sh\n');
    const service = createSessionService({ dataDir, helperPath, platform: 'linux' });
    expect(service.status().appliance).toBe(true);
    expect(service.request('desktop')).toEqual({ ok: true, mode: 'desktop' });
    expect(service.status().mode).toBe('desktop');
    expect(existsSync(join(dataDir, 'session-request'))).toBe(true);
  });

  it('rejects nonsense modes', () => {
    const service = createSessionService({ dataDir: tmpdir(), platform: 'linux', helperPath: '/nope' });
    expect(service.request('rescue')).toEqual({ ok: false, reason: 'invalid_mode' });
  });
});
