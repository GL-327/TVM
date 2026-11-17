import { bad } from './errors.ts';
import { bodyObject, capabilities, nonnegative, optionalText, text } from './validation.ts';
import type { Installation } from './store.ts';
import type { NowPlaying } from './vocab.ts';

function nowPlaying(value: unknown): NowPlaying | null {
  if (value === undefined || value === null) return null;
  const input = bodyObject(value);
  if (!nonnegative(input['positionSec']) || (input['durationSec'] !== null && !nonnegative(input['durationSec']))) bad();
  return {
    mediaId: text(input['mediaId'], 1024), title: text(input['title'], 1000),
    artworkUrl: optionalText(input['artworkUrl'], 4096), positionSec: input['positionSec'],
    durationSec: input['durationSec'] as number | null, profileId: text(input['profileId'], 200),
  };
}
export function heartbeat(device: Installation, value: unknown, now: number): { ignored?: true } {
  const input = bodyObject(value);
  if (!Number.isSafeInteger(input['seq']) || (input['seq'] as number) < 0) bad();
  // Stale heartbeats cannot change metadata or extend liveness.
  if ((input['seq'] as number) <= device.lastSeq) return { ignored: true };
  if (!['idle', 'playing', 'paused'].includes(input['state'] as string)) bad();
  // Delta heartbeat: an omitted nowPlaying keeps the last one; explicit null clears it.
  const omitted = !('nowPlaying' in input);
  const playing = omitted ? device.nowPlaying : nowPlaying(input['nowPlaying']);
  const caps = input['capabilities'] === undefined ? device.capabilities : capabilities(input['capabilities']);
  device.lastSeq = input['seq'] as number;
  device.state = input['state'] as Installation['state'];
  device.lastSeenAt = new Date(now).toISOString();
  device.nowPlaying = device.state === 'idle' ? null : playing;
  device.capabilities = caps;
  return {};
}
