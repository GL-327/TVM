import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { mobilePlaybackBlocked } from './mobileAccess.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCoreServer } from './server.ts';
import { createPlanService } from './providers/plans.ts';
describe('mobile playback entitlement', () => {
  it('enforces the gate at the HTTP boundary and accepts a paid test entitlement', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tvm-mobile-access-'));
    const plans = createPlanService({ dataDir, env: {} });
    const core = await startCoreServer(0, { dataDir, env: {}, plans });
    const base = `http://127.0.0.1:${core.port}`;
    const headers = { 'user-agent': 'TVM-iOS', 'content-type': 'application/json' };
    try {
      const denied = await fetch(`${base}/api/playback`, { method: 'POST', headers, body: JSON.stringify({ id: 'fixture' }) });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ reason: 'mobile-plan-required' });
      expect((await fetch(`${base}/api/plan`, { headers })).status).toBe(200);
      plans.checkout({ planId: 'premium', consent: true, requestId: 'mobile-upgrade-test' });
      const allowed = await fetch(`${base}/api/playback`, { method: 'POST', headers, body: JSON.stringify({ id: 'fixture' }) });
      expect(allowed.status).not.toBe(403);
      expect(await allowed.json()).not.toMatchObject({ reason: 'mobile-plan-required' });
    } finally {
      await core.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  const request = (ua: string) => ({ headers: { 'user-agent': ua } }) as IncomingMessage;
  it('blocks playback and existing streams after a downgrade, while allowing plan/setup routes', () => {
    for (const ua of ['TVM-iOS', 'TVM-Android', 'Mozilla iPhone']) {
      for (const path of ['/api/playback', '/api/stream/hls/session/index.m3u8', '/api/stream/direct/token']) {
        expect(mobilePlaybackBlocked(request(ua), path, { id: 'free', maxHeight: 720 })).toBe(true);
        expect(mobilePlaybackBlocked(request(ua), path, { id: 'premium', maxHeight: 1080 })).toBe(false);
        // Basic is a television and desktop tier now, not a phone one.
        expect(mobilePlaybackBlocked(request(ua), path, { id: 'basic', maxHeight: 1080 })).toBe(true);
      }
      expect(mobilePlaybackBlocked(request(ua), '/api/plan', { id: 'free', maxHeight: 720 })).toBe(false);
      expect(mobilePlaybackBlocked(request(ua), '/api/playback', { id: 'premium', maxHeight: 720 })).toBe(true);
    }
    expect(mobilePlaybackBlocked(request('Windows'), '/api/playback', { id: 'free', maxHeight: 720 })).toBe(false);
    expect(mobilePlaybackBlocked(request('Roku'), '/api/playback', { id: 'free', maxHeight: 720 })).toBe(false);
  });
});
