import { describe, expect, it } from 'vitest';
import { heartbeat } from './presence.ts';
import type { Installation } from './store.ts';

function device(): Installation {
  return {
    id: 'inst_x', clientHash: 'h', platform: 'roku', name: 'TV', model: null, appVersion: '1', build: null,
    capabilities: [], slot: 0, room: null, createdAt: new Date(0).toISOString(), lastSeenAt: null,
    lastSeq: -1, state: 'idle', nowPlaying: null, revokedAt: null,
  } as Installation;
}
const playing = { mediaId: 'm1', title: 'Fixture', artworkUrl: null, positionSec: 5, durationSec: 60, profileId: 'p1' };

describe('presence heartbeats are deltas', () => {
  it('keeps nowPlaying when a later heartbeat omits it', () => {
    const d = device();
    heartbeat(d, { seq: 1, state: 'playing', nowPlaying: playing }, 1000);
    heartbeat(d, { seq: 2, state: 'paused' }, 2000);
    expect(d.state).toBe('paused');
    expect(d.nowPlaying).toMatchObject({ mediaId: 'm1', profileId: 'p1' });
  });

  it('clears nowPlaying on explicit null or when idle', () => {
    const d = device();
    heartbeat(d, { seq: 1, state: 'playing', nowPlaying: playing }, 1000);
    heartbeat(d, { seq: 2, state: 'playing', nowPlaying: null }, 2000);
    expect(d.nowPlaying).toBeNull();
    heartbeat(d, { seq: 3, state: 'playing', nowPlaying: playing }, 3000);
    heartbeat(d, { seq: 4, state: 'idle' }, 4000);
    expect(d.nowPlaying).toBeNull();
  });

  it('ignores a stale seq without touching state', () => {
    const d = device();
    heartbeat(d, { seq: 5, state: 'playing', nowPlaying: playing }, 1000);
    expect(heartbeat(d, { seq: 5, state: 'idle' }, 2000)).toEqual({ ignored: true });
    expect(d.state).toBe('playing');
  });
});
