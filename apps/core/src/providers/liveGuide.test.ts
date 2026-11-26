import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGuideCache, epgFeeds, guideWindow, matchGuide, parseXmlTv, programmeWindow } from './liveGuide.ts';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="BBCOne.uk"><display-name>BBC One</display-name></channel>
  <channel id="Other.uk"><display-name>Other</display-name></channel>
  <programme start="20261126093000 +0000" stop="20261126104500 +0000" channel="BBCOne.uk">
    <title>Morning Live</title><desc>Tips &amp; stories.</desc><category>Magazine</category>
  </programme>
  <programme start="20261126104500 +0000" stop="20261126111500 +0000" channel="BBCOne.uk">
    <title><![CDATA[Homes Under the Hammer]]></title>
  </programme>
  <programme start="20261126100000 +0000" stop="20261126110000 +0000" channel="Other.uk">
    <title>Not wanted</title>
  </programme>
</tv>`;

async function* chunks(bytes: Uint8Array, size = 64): AsyncIterable<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
const NOW = Date.parse('2026-11-26T10:10:00Z');

describe('parseXmlTv', () => {
  it('keeps only the wanted channels and decodes text, entities and CDATA', async () => {
    const schedule = await parseXmlTv(chunks(new TextEncoder().encode(XML)), [{ id: 'BBCOne.uk' }], NOW);
    const rows = matchGuide(schedule, { id: 'BBCOne.uk' });
    expect(rows.map((row) => row.title)).toEqual(['Morning Live', 'Homes Under the Hammer']);
    expect(rows[0]).toMatchObject({ start: '2026-11-26T09:30:00.000Z', end: '2026-11-26T10:45:00.000Z',
      description: 'Tips & stories.', category: 'Magazine' });
    expect(matchGuide(schedule, { id: 'Other.uk' })).toEqual([]);
  });

  it('reads gzip feeds', async () => {
    const schedule = await parseXmlTv(chunks(gzipSync(XML)), [{ id: 'BBCOne.uk' }], NOW);
    expect(matchGuide(schedule, { id: 'BBCOne.uk' })).toHaveLength(2);
  });
});

describe('guide windows', () => {
  it('starts on the half hour and rejects bad spans', () => {
    expect(guideWindow(null, null, NOW)).toMatchObject({ start: '2026-11-26T10:00:00.000Z', end: '2026-11-26T13:00:00.000Z' });
    expect(guideWindow(null, '25', NOW)).toBeNull();
    expect(guideWindow('yesterday', '3', NOW)).toBeNull();
  });

  it('gives channels without listings one "No guide information" block', () => {
    const window = guideWindow(null, '3', NOW)!;
    expect(programmeWindow([], window)).toEqual([{ start: window.start, end: window.end, title: 'No guide information' }]);
  });

  it('only accepts https feeds from content files', () => {
    expect(epgFeeds([{ id: 'a', url: 'https://example.com/a.xml' }, { id: 'b', url: 'http://example.com/b.xml' }, { url: 'https://x' }]))
      .toEqual([{ id: 'a', url: 'https://example.com/a.xml' }]);
  });
});

describe('createGuideCache', () => {
  const dirs: string[] = [];
  afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it('answers at once, says it is refreshing, then serves the downloaded feed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tvm-guide-'));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => { await gate; return new Response(XML); }) as unknown as typeof fetch;
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const cache = createGuideCache(dir, fetchImpl);

    const first = await cache.xml('https://192.0.2.1/epg.xml', [{ id: 'BBCOne.uk' }]);
    expect(first.size).toBe(0);
    expect(cache.busy()).toBe(true);

    release();
    await vi.waitFor(() => expect(cache.busy()).toBe(false));
    const second = await cache.xml('https://192.0.2.1/epg.xml', [{ id: 'BBCOne.uk' }]);
    expect(matchGuide(second, { id: 'BBCOne.uk' }).map((row) => row.title)).toContain('Morning Live');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
