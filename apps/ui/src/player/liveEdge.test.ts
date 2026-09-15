import { describe, expect, it } from 'vitest';
import {
  catchUpTarget,
  driftFromLive,
  formatDrift,
  isBehindLive,
  liveEdgeOf,
  LIVE_EDGE_MARGIN_SECONDS,
} from './liveEdge';

/** A stand-in for the browser's TimeRanges, which cannot be constructed directly. */
function ranges(...pairs: Array<[number, number]>): TimeRanges {
  return {
    length: pairs.length,
    start: (i: number) => pairs[i]![0],
    end: (i: number) => pairs[i]![1],
  } as TimeRanges;
}

describe('finding the live edge', () => {
  it('prefers seekable, which is what HLS publishes', () => {
    expect(liveEdgeOf(ranges([0, 120]), ranges([0, 60]))).toBe(120);
  });

  it('falls back to buffered, which is all the MPEG-TS reader offers', () => {
    // The TS reader exposes no seekable range at all, so without this fallback
    // every MPEG-TS channel would report an edge of zero and never offer the jump.
    expect(liveEdgeOf(ranges(), ranges([0, 95]))).toBe(95);
    expect(liveEdgeOf(null, ranges([0, 95]))).toBe(95);
  });

  it('takes the last range, not the first, when a stream has gaps', () => {
    expect(liveEdgeOf(ranges([0, 30], [50, 140]), null)).toBe(140);
  });

  it('reports no edge rather than a wrong one', () => {
    expect(liveEdgeOf(ranges(), ranges())).toBe(0);
    expect(liveEdgeOf(null, null)).toBe(0);
    expect(liveEdgeOf(ranges([0, Number.POSITIVE_INFINITY]), null)).toBe(0);
  });
});

describe('how far behind', () => {
  it('measures the gap', () => {
    expect(driftFromLive(100, 160)).toBe(60);
  });

  it('never reports a negative gap when sitting at or past the edge', () => {
    expect(driftFromLive(160, 160)).toBe(0);
    expect(driftFromLive(161, 160)).toBe(0);
  });

  it('reports nothing when there is no edge to measure against', () => {
    expect(driftFromLive(100, 0)).toBe(0);
    expect(driftFromLive(Number.NaN, 160)).toBe(0);
  });
});

describe('when to offer the jump', () => {
  it('stays quiet during untouched playback', () => {
    // A live stream always trails its own edge slightly. A button that showed
    // up for that would read as a fault rather than an offer.
    expect(isBehindLive(0)).toBe(false);
    expect(isBehindLive(3)).toBe(false);
    expect(isBehindLive(11)).toBe(false);
  });

  it('offers once the gap is worth correcting', () => {
    expect(isBehindLive(12)).toBe(true);
    expect(isBehindLive(600)).toBe(true);
  });
});

describe('where to land', () => {
  it('stops short of the edge so the decoder does not stall', () => {
    // The last fragment is usually still being written; seeking onto it
    // rebuffers immediately, which looks worse than the delay being fixed.
    expect(catchUpTarget(200)).toBe(200 - LIVE_EDGE_MARGIN_SECONDS);
  });

  it('never seeks before the start of a short stream', () => {
    expect(catchUpTarget(1)).toBe(0);
    expect(catchUpTarget(0)).toBe(0);
    expect(catchUpTarget(Number.NaN)).toBe(0);
  });
});

describe('describing the gap', () => {
  it('reads naturally at every scale', () => {
    expect(formatDrift(0)).toBe('0s behind');
    expect(formatDrift(45)).toBe('45s behind');
    expect(formatDrift(60)).toBe('1 min behind');
    expect(formatDrift(605)).toBe('10 min behind');
    expect(formatDrift(3600)).toBe('1h behind');
    expect(formatDrift(3900)).toBe('1h 5m behind');
  });

  it('does not produce a negative duration', () => {
    expect(formatDrift(-5)).toBe('0s behind');
  });
});
