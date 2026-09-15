import { describe, expect, it } from 'vitest';
import {
  classify,
  looksLikeManifest,
  looksLikeTransportStream,
  runChecks,
  summarize,
  verdictLine,
  TS_PACKET,
  TS_SYNC,
  type CheckTarget,
  type ProbeOutcome,
} from './liveCheck.ts';

/**
 * A handful of well-formed MPEG-TS packets.
 *
 * The header has to be realistic, not just start with 0x47: byte 3 carries the
 * adaptation field control, and 00 there is reserved, so filler bytes would
 * produce packets no decoder would accept.
 */
function tsBytes(packets = 4): Uint8Array {
  const bytes = new Uint8Array(TS_PACKET * packets);
  for (let i = 0; i < packets; i += 1) {
    const at = i * TS_PACKET;
    bytes[at] = TS_SYNC;
    bytes[at + 1] = 0x01;             // no transport error, PID high bits
    bytes[at + 2] = 0x00;             // PID low bits
    bytes[at + 3] = 0x10 | (i & 0x0f); // payload only, continuity counter
    for (let j = 4; j < TS_PACKET; j += 1) bytes[at + j] = (i + j) % 251;
  }
  return bytes;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const MANIFEST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6,\nseg1.ts\n';

describe('recognising real video', () => {
  it('accepts a genuine transport stream', () => {
    expect(looksLikeTransportStream(tsBytes())).toBe(true);
  });

  it('does not mistake text that merely starts with G for MPEG-TS', () => {
    // 0x47 is the letter "G". A provider's error page beginning "GET" or
    // "Gateway timeout" would otherwise be reported as a working channel.
    expect(looksLikeTransportStream(text('Gateway Timeout'.padEnd(400, ' ')))).toBe(false);
    expect(looksLikeTransportStream(text('G'.repeat(400)))).toBe(false);
  });

  it('needs the sync byte to recur at the packet interval', () => {
    const broken = tsBytes();
    broken[TS_PACKET] = 0x00;
    expect(looksLikeTransportStream(broken)).toBe(false);
  });

  it('will not call a few bytes a stream', () => {
    expect(looksLikeTransportStream(new Uint8Array([TS_SYNC]))).toBe(false);
    expect(looksLikeTransportStream(new Uint8Array(0))).toBe(false);
  });

  it('recognises an HLS manifest', () => {
    expect(looksLikeManifest(text(MANIFEST))).toBe(true);
    expect(looksLikeManifest(text('<html><body>blocked</body></html>'))).toBe(false);
  });
});

describe('verdicts', () => {
  const check = (outcome: ProbeOutcome) => classify(outcome);

  it('calls streaming MPEG-TS working, with no second request needed', () => {
    const result = check({ status: 200, head: tsBytes() });
    expect(result).toMatchObject({ verdict: 'working', ok: true, transport: 'mpegts' });
  });

  it('calls HLS working only once a segment actually returns video', () => {
    expect(check({ status: 200, head: text(MANIFEST), segmentStatus: 200, segmentBytes: 4096 }))
      .toMatchObject({ verdict: 'working', ok: true, transport: 'hls' });
  });

  it('does not call a manifest working when its video is refused', () => {
    // The case that makes a channel look fine in a listing and fail on play.
    const result = check({ status: 200, head: text(MANIFEST), segmentStatus: 403 });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('unauthorized');
    expect(result.detail).toMatch(/subscription/i);
  });

  it('separates a refused subscription from a dead channel', () => {
    expect(check({ status: 403 })).toMatchObject({ verdict: 'unauthorized', ok: false });
    expect(check({ status: 401 })).toMatchObject({ verdict: 'unauthorized', ok: false });
    expect(check({ status: 404 })).toMatchObject({ verdict: 'missing', ok: false });
    expect(check({ status: 410 })).toMatchObject({ verdict: 'missing', ok: false });
  });

  it('reports a channel that is listed but not broadcasting', () => {
    expect(check({ status: 200, head: text('#EXTM3U\n'), manifestEmpty: true }))
      .toMatchObject({ verdict: 'offline', ok: false });
    expect(check({ status: 200, head: text(MANIFEST), segmentStatus: 200, segmentBytes: 0 }))
      .toMatchObject({ verdict: 'offline', ok: false });
    expect(check({ status: 200, head: text(MANIFEST), segmentStatus: 500 }))
      .toMatchObject({ verdict: 'offline', ok: false });
  });

  it('names the device limit when a page arrives instead of video', () => {
    const result = check({ status: 200, head: text('<!DOCTYPE html><html><body>Too many connections</body></html>') });
    expect(result.verdict).toBe('unplayable');
    expect(result.detail).toMatch(/device limit|blocked/i);
  });

  it('reports an empty body and a network failure distinctly', () => {
    expect(check({ status: 200, head: new Uint8Array(0) })).toMatchObject({ verdict: 'empty', ok: false });
    expect(check({ status: null, networkError: 'ECONNREFUSED' })).toMatchObject({ verdict: 'unreachable', ok: false });
  });

  it('does not blame the connection for a channel that simply never sends video', () => {
    // A pay-per-view slot with no event on behaves exactly like this. Calling
    // it "could not reach the provider" sends the viewer after the wrong fault
    // while other channels in the same sweep are playing fine.
    const result = check({ status: null, timedOut: true });
    expect(result.verdict).toBe('silent');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not broadcasting/i);
    expect(result.detail).not.toMatch(/could not reach/i);
  });

  it('never reports ok without having seen video', () => {
    const outcomes: ProbeOutcome[] = [
      { status: 403 }, { status: 404 }, { status: 500 },
      { status: 200, head: new Uint8Array(0) },
      { status: 200, head: text('<html>nope</html>') },
      { status: 200, head: text(MANIFEST) },
      { status: 200, head: text(MANIFEST), segmentStatus: 403 },
      { status: null, networkError: 'refused' },
    ];
    for (const outcome of outcomes) expect(classify(outcome).ok).toBe(false);
  });
});

describe('running a sweep', () => {
  const targets: CheckTarget[] = Array.from({ length: 9 }, (_, i) => ({
    id: `live:${i}`, name: `Channel ${i}`, group: 'Sport',
  }));

  it('checks every channel and keeps the order stable', async () => {
    const results = await runChecks(targets, async (target) => ({
      status: 200,
      head: target.id.endsWith('3') ? text('<html>no</html>') : tsBytes(),
    }), { concurrency: 3 });

    expect(results).toHaveLength(9);
    expect(results.map((entry) => entry.id)).toEqual(targets.map((entry) => entry.id));
    expect(results.filter((entry) => entry.ok)).toHaveLength(8);
    expect(results.find((entry) => entry.id === 'live:3')?.verdict).toBe('unplayable');
  });

  it('never opens more connections at once than it was told to', async () => {
    // A provider counts simultaneous streams against the device limit, so a
    // sweep that ignored this would make working channels report as refused.
    let open = 0;
    let peak = 0;
    await runChecks(targets, async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open -= 1;
      return { status: 200, head: tsBytes() };
    }, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('survives a probe that throws', async () => {
    const results = await runChecks(targets.slice(0, 3), async (target) => {
      if (target.id === 'live:1') throw new Error('socket hang up');
      return { status: 200, head: tsBytes() };
    });
    expect(results).toHaveLength(3);
    expect(results[1]).toMatchObject({ verdict: 'unreachable', ok: false });
    expect(results[1]?.detail).toContain('socket hang up');
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runChecks(targets.slice(0, 4), async () => ({ status: 200, head: tsBytes() }), {
      concurrency: 2,
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe('the one-line answer', () => {
  const entry = (verdict: string, ok: boolean) => ({
    id: 'x', name: 'x', group: 'g', verdict, ok, status: 200, transport: null, detail: '', ms: 1,
  }) as never;

  it('says it works when anything streams, and says how many', () => {
    expect(verdictLine({ checked: 10, working: 10, results: Array.from({ length: 10 }, () => entry('working', true)) }))
      .toMatch(/Live TV is working\. All 10/);
    expect(verdictLine({
      checked: 10,
      working: 4,
      results: [...Array.from({ length: 4 }, () => entry('working', true)), ...Array.from({ length: 6 }, () => entry('missing', false))],
    })).toMatch(/working\. 4 of 10/);
  });

  it('blames the subscription when everything was refused', () => {
    const line = verdictLine({ checked: 5, working: 0, results: Array.from({ length: 5 }, () => entry('unauthorized', false)) });
    expect(line).toMatch(/not working/);
    expect(line).toMatch(/subscription, username or password/);
  });

  it('says nothing is on air rather than blaming the setup', () => {
    const line = verdictLine({ checked: 6, working: 0, results: Array.from({ length: 6 }, () => entry('silent', false)) });
    expect(line).toMatch(/None of the 6 channels checked are broadcasting right now/);
    expect(line).toMatch(/connection and subscription are fine/);
  });

  it('blames the connection when nothing could be reached', () => {
    expect(verdictLine({ checked: 5, working: 0, results: Array.from({ length: 5 }, () => entry('unreachable', false)) }))
      .toMatch(/could not be reached at all/);
  });

  it('counts each verdict', () => {
    const counts = summarize([entry('working', true), entry('working', true), entry('missing', false)]);
    expect(counts.working).toBe(2);
    expect(counts.missing).toBe(1);
    expect(counts.offline).toBe(0);
  });
});
