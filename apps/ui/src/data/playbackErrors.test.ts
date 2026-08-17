import { describe, expect, it } from 'vitest';
import { playbackErrorMessage } from './playbackErrors';

describe('playback errors', () => {
  it('maps every unavailable reason to a real sentence', () => {
    expect(playbackErrorMessage('not-in-library')).toMatch(/Real-Debrid/);
    expect(playbackErrorMessage('empty')).toMatch(/Torrentio/);
    expect(playbackErrorMessage('needs-auth')).toMatch(/token/);
    expect(playbackErrorMessage('network')).toMatch(/core/);
    expect(playbackErrorMessage('unsupported')).toMatch(/Real-Debrid/);
    expect(playbackErrorMessage('hours-cap')).toMatch(/watch hours/);
  });

  it('shows core error text instead of a generic unavailable line', () => {
    expect(playbackErrorMessage('Torrentio timed out')).toBe('Torrentio timed out');
    expect(playbackErrorMessage('')).not.toMatch(/unavailable/i);
  });
});
