import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contentRemoteUrl, createContentService, validContent } from './content.ts';
import { eventKicker, interleave, liveEvents, localDay, railPageFor, railSources } from './media.ts';
import { letterboxdAverage, parseLetterboxdReviews, starsFromLabel, clampReview, decodeEntities } from './reviews.ts';
import type { MediaItem } from './types.ts';

describe('shared content', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-content-'));
    dirs.push(dir);
    return dir;
  }

  it('reads the files TVM ships with', async () => {
    const content = createContentService({ dataDir: await dataDir(), remote: false });
    expect(content.list('changelog').length).toBeGreaterThan(0);
    expect(content.list('free-channels').length).toBeGreaterThan(10);
    expect(content.list('parental')).toHaveLength(4);
  });

  it('takes a good refresh from GitHub and keeps it for next time', async () => {
    const dir = await dataDir();
    const next = { schema: 1, events: [{ id: 'next-big-film', start: '2027-01-01', end: '2027-01-31' }] };
    const fetchImpl = (async (url: string) => {
      expect(url).toBe(contentRemoteUrl('events'));
      return new Response(JSON.stringify(next), { status: 200 });
    }) as typeof fetch;
    const content = createContentService({ dataDir: dir, fetch: fetchImpl, remote: true });
    const fresh = await content.fresh('events');
    expect(fresh).toEqual(next);
    expect(JSON.parse(await readFile(join(dir, 'content', 'events.json'), 'utf8'))).toEqual(next);
  });

  it('ignores a refresh that does not look like the file', async () => {
    const fetchImpl = (async () => new Response('{"schema":2,"events":[]}', { status: 200 })) as typeof fetch;
    const content = createContentService({ dataDir: await dataDir(), fetch: fetchImpl, remote: true });
    const events = await content.fresh('events');
    expect(validContent('events', events)).toBe(true);
    expect((events['events'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('never refreshes the changelog from the network', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}');
    }) as typeof fetch;
    const content = createContentService({ dataDir: await dataDir(), fetch: fetchImpl, remote: true });
    await content.fresh('changelog');
    expect(calls).toBe(0);
  });
});

describe('release events', () => {
  const events = [
    { id: 'sunrise', start: '2026-11-13', end: '2026-12-08' },
    { id: 'doomsday', start: '2026-12-09', end: '2027-01-31' },
  ];

  it('shows each event only between its dates', () => {
    expect(liveEvents(events, '2026-11-25').map((event) => event.id)).toEqual(['sunrise']);
    expect(liveEvents(events, '2026-12-09').map((event) => event.id)).toEqual(['doomsday']);
    expect(liveEvents(events, '2027-02-01')).toEqual([]);
  });

  it('says when it opens, then that it is out', () => {
    expect(eventKicker('2026-12-16', '2026-12-10')).toBe('In cinemas 16 December');
    expect(eventKicker('2026-12-16', '2026-12-16')).toBe('In cinemas now');
  });

  it('uses the local date', () => {
    expect(localDay(new Date(2026, 11, 9, 0, 30))).toBe('2026-12-09');
  });
});

describe('rows that keep loading', () => {
  it('knows where each row pages from', () => {
    expect(railSources('films')).toEqual([{ kind: 'movie', list: 'top', genre: null }]);
    expect(railSources('action').length).toBeGreaterThanOrEqual(2);
    expect(railSources('for-you')).toEqual([]);
  });

  it('asks for the next page exactly, or maps a count to one', () => {
    expect(railPageFor(40, 1)).toBe(1);
    expect(railPageFor(90, 1)).toBe(2);
    expect(railPageFor(135, 2)).toBe(2);
    expect(railPageFor(0, 2, 3)).toBe(4);
  });

  it('alternates films and series without repeats', () => {
    const item = (id: string): MediaItem => ({ id, title: id, year: null, kind: 'movie', synopsis: '', poster: '', backdrop: '', genres: [], rating: '', playable: true, hue: 0 });
    expect(interleave([item('a'), item('b')], [item('x'), item('a')]).map((entry) => entry.id)).toEqual(['a', 'x', 'b']);
  });
});

describe('reviews', () => {
  const article = (name: string, stars: string, text: string, likes: number): string =>
    `<article class="production-viewing -viewing"><span class="inline-rating"><svg class="glyph -rating" aria-label="${stars}"></svg></span>` +
    `<a href="/${name}/film/interstellar/" class="context"> Review by <strong class="displayname">${name}</strong></a>` +
    `<div class="body-text -prose js-review-body js-collapsible-text" lang="en"><p>${text}</p></div>` +
    `<p class="like-link-target" data-count="${likes}"></p></article>`;

  it('takes the most liked reviews with something to say', () => {
    const html = article('ann', '★★★★½', 'A long and thoughtful look at time, love and what we owe our kids.', 10) +
      article('bob', '★★★★★', 'wow', 999) +
      article('cat', '★★★', 'Beautiful to look at, though the third act drags on far too long for me.', 50);
    const reviews = parseLetterboxdReviews(html);
    expect(reviews.map((review) => review.author)).toEqual(['cat', 'ann']);
    expect(reviews[1]).toMatchObject({ stars: 4.5, likes: 10, url: 'https://letterboxd.com/ann/film/interstellar/' });
  });

  it('reads stars, the average, entities and long text', () => {
    expect(starsFromLabel('★★½')).toBe(2.5);
    expect(starsFromLabel('')).toBeNull();
    expect(letterboxdAverage('<meta name="twitter:data2" content="4.46 out of 5" />')).toBe(4.46);
    expect(decodeEntities('doesn&#039;t &amp; won&rsquo;t')).toBe('doesn\'t & won’t');
    expect(clampReview('word '.repeat(200), 50).endsWith('…')).toBe(true);
  });
});
