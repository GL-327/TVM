import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describePlaybackError, PLAYBACK_ERROR_CASES } from './PlaybackError';

const dir = dirname(fileURLToPath(import.meta.url));

/*
 * A live channel that ends did not finish; it stopped.
 *
 * Both halves of that were wrong. The player treated `ended` the same on live
 * as on a film — persist and pop — so the viewer was returned to the channel
 * list with no explanation, which reads as a crash. And the generic copy
 * called it a failure, which sends someone to check their own setup over
 * something that happened at the broadcaster.
 *
 * It is reachable, not theoretical: "Back to live" lands three seconds short
 * of the edge, and where the feed is not really advancing — an off-air
 * channel, a dead upstream, or a provider serving a finite file as a
 * channel — those three seconds run out and the stream ends. That is exactly
 * how it was found.
 */
describe('a channel that stops broadcasting', () => {
  it('is its own case, not a playback failure', () => {
    expect(PLAYBACK_ERROR_CASES).toContain('off-air');
    const copy = describePlaybackError('This channel stopped broadcasting. Try it again, or choose another channel.');
    expect(copy).not.toBeNull();
    expect(copy!.kind).toBe('off-air');
    expect(copy!.title).toBe('Channel off air');
    expect(copy!.title.toLowerCase()).not.toContain('failed');
    expect(copy!.showPlans).toBe(false);
  });

  it('keeps the viewer in the player instead of popping the screen', () => {
    const src = readFileSync(join(dir, '../../screens/Player.tsx'), 'utf8');
    const ended = src.slice(src.indexOf('onEnded:'), src.indexOf('onClosed:'));
    expect(ended).toContain('if (live)');
    expect(ended).toContain('stopped broadcasting');
    // The live branch returns before the pop that ends a film.
    expect(ended.indexOf('return;')).toBeLessThan(ended.indexOf('navigate.pop()'));
  });

  it('still ends a film the way a film ends', () => {
    const src = readFileSync(join(dir, '../../screens/Player.tsx'), 'utf8');
    const ended = src.slice(src.indexOf('onEnded:'), src.indexOf('onClosed:'));
    expect(ended).toContain('persist(durationRef.current, durationRef.current)');
    expect(ended).toContain('navigate.pop()');
  });
});
