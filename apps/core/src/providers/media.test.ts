import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMediaService } from './media.ts';
import { createRealDebrid } from './realdebrid.ts';
import { pickTranscode } from './realdebrid.ts';
import { episodeLabel, hueFor, isDisplayTitle, isHttpUrl, isVideoFile, looksLikePack, parseEpisode, parseEpisodeTitle, parseFilename, parseSeason } from './title.ts';
import { artworkQueries } from './artwork.ts';

describe('filename parsing', () => {
  it('pulls a title and year out of a release name', () => {
    expect(parseFilename('Dune.Part.Two.2024.1080p.BluRay.x264.mkv')).toEqual({
      title: 'Dune Part Two',
      year: 2024,
    });
  });

  it('keeps a plain name', () => {
    expect(parseFilename('holiday-video.mp4').title).toBe('holiday-video');
  });

  it('recognises video files', () => {
    expect(isVideoFile('a.mkv')).toBe(true);
    expect(isVideoFile('notes.txt')).toBe(false);
    expect(isVideoFile('clip.bin', 'video/mp4')).toBe(true);
  });

  it('accepts only http(s) links', () => {
    expect(isHttpUrl('https://example.com/a.mp4')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('hashes a stable hue', () => {
    expect(hueFor('Dune')).toBe(hueFor('Dune'));
  });

  it('rejects release-style names for the hero', () => {
    expect(isDisplayTitle('The Devil Wears Prada')).toBe(true);
    expect(isDisplayTitle('[ OxTorrent com ] Le Diable')).toBe(false);
    expect(isDisplayTitle('A')).toBe(false);
  });

  it('treats season packs as folders, not a single play', () => {
    expect(looksLikePack('The Boys', 'The.Boys.S01.2160p.mkv')).toBe(true);
    expect(looksLikePack('The Boys', 'The.Boys.S01E01.mkv')).toBe(false);
    expect(looksLikePack('The Boys', 'The.Boys.S01.E01.mkv')).toBe(false);
    expect(looksLikePack('The Boys', 'The.Boys.S01E01-08.mkv')).toBe(true);
    expect(looksLikePack('Breaking Bad', 'Breaking.Bad.S01-S05.1080p.mkv')).toBe(true);
  });

  it('reads season and episode from a release name', () => {
    expect(parseEpisode('The.Boys.S01E05.1080p.mkv')).toEqual({ season: 1, episode: 5 });
    expect(parseEpisode('The.Boys.S01.E05.1080p.mkv')).toEqual({ season: 1, episode: 5 });
    expect(parseEpisode('Show 2x09.mp4')).toEqual({ season: 2, episode: 9 });
    expect(parseEpisode('Movie.2024.mkv')).toBeNull();
    expect(parseSeason('The.Boys.S01.Complete.mkv')).toBe(1);
    expect(episodeLabel(1, 5)).toBe('S1 E5');
    expect(parseEpisode('The.Boys.S01E01-08.mkv')).toBeNull();
    expect(parseEpisodeTitle('The Boys S01E01 The Name of the Game.mkv')).toBe('The Name of the Game');
  });

  it('drops episode titles from the parsed show name', () => {
    expect(parseFilename('Stranger.Things.S04E01.Chapter.One.The.Hellfire.Club.1080p.mkv')).toEqual({
      title: 'Stranger Things',
      year: null,
    });
    expect(parseFilename('The.Boys.S01.Complete.1080p.mkv').title).toBe('The Boys');
  });

  it('shortens artwork queries for episode-style names', () => {
    expect(artworkQueries('The Boys The Name of the Game')[0]).toBe('The Boys The Name of the Game');
    expect(artworkQueries('The Boys The Name of the Game')).toContain('The Boys');
  });
});

describe('transcode picker', () => {
  it('prefers a live MP4 over HLS', () => {
    expect(
      pickTranscode({
        apple: { full: 'https://cdn.example/a.m3u8' },
        liveMP4: { '1080': 'https://cdn.example/a.mp4' },
      }),
    ).toEqual({ url: 'https://cdn.example/a.mp4', mimeType: 'video/mp4' });
  });
});

describe('media service', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-rd-'));
    dirs.push(dir);
    return dir;
  }

  it('refuses playback when no token is stored', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({ dataDir: dir, env: {} }),
    });
    expect(await media.play({ id: 'rd:1' })).toEqual({ kind: 'unavailable', reason: 'not-configured' });
  });

  it('refuses playback when Real-Debrid rejects the token', async () => {
    const dir = await dataDir();
    let torrentioHits = 0;
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => {
        torrentioHits += 1;
        return new Response(JSON.stringify({ streams: [] }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'bad-token' },
        fetch: async () => new Response('no', { status: 401 }),
      }),
    });
    expect(await media.play({ id: 'tt15398776' })).toEqual({ kind: 'unavailable', reason: 'needs-auth' });
    expect(torrentioHits).toBe(0);
  });

  it('refuses playback when the Real-Debrid account is not premium', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async () =>
          new Response(JSON.stringify({ username: 'ada', premium: 0, expiration: '' }), { status: 200 }),
      }),
    });
    expect(await media.play({ id: 'tt15398776' })).toEqual({ kind: 'unavailable', reason: 'needs-auth' });
  });

  it('never returns a token from status', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async () =>
          new Response(JSON.stringify({ username: 'ada', premium: 1, expiration: '' }), { status: 200 }),
      }),
    });
    const status = await media.status();
    expect(status.configured).toBe(true);
    expect(status.username).toBe('ada');
    expect(JSON.stringify(status)).not.toContain('secret-token');
  });

  it('unrestricts a user-supplied link', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            const body = String(init.body);
            expect(body).toContain('https%3A%2F%2Fhoster.example%2Ffile');
            return new Response(
              JSON.stringify({
                id: 'u1',
                filename: 'Dune.Part.Two.2024.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/stream.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });

    const result = await media.play({ link: 'https://hoster.example/file' });
    expect(result).toEqual({
      kind: 'stream',
      url: 'https://cdn.example/stream.mp4',
      title: 'Dune Part Two',
      filename: 'Dune.Part.Two.2024.mp4',
      mimeType: 'video/mp4',
      engine: 'html5',
    });
  });

  it('does not play a title that is not in the user cloud', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/downloads') || url.includes('/torrents')) return new Response('[]', { status: 200 });
          return new Response('no', { status: 404 });
        },
      }),
    });
    expect(await media.play({ id: 'rd:missing' })).toEqual({ kind: 'unavailable', reason: 'not-in-library' });
    expect(await media.play({ id: 'tmdb:dune' })).toEqual({ kind: 'unavailable', reason: 'not-in-library' });
  });

  it('plays an IMDb title through Torrentio then Real-Debrid', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('torrentio.strem.fun') && url.includes('tt15398776')) {
          return new Response(
            JSON.stringify({
              streams: [
                { name: 'CAM', title: 'camrip', url: 'https://cdn.example/cam.mp4' },
                { name: 'Torrentio\n1080p ⚡', title: 'Oppenheimer 1080p', url: 'https://real-debrid.com/d/OPP' },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('cinemeta')) return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            expect(String(init.body)).toContain('OPP');
            return new Response(
              JSON.stringify({
                id: 'u9',
                filename: 'Oppenheimer.2023.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/opp.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'tt15398776' });
    expect(result.kind).toBe('stream');
    if (result.kind === 'stream') {
      expect(result.url).toBe('https://cdn.example/opp.mp4');
      expect(result.title).toBe('Oppenheimer');
    }
  });

  it('plays an episode when the IMDb id is buried in a slug', async () => {
    const dir = await dataDir();
    let torrentioPath = '';
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('torrentio.strem.fun')) {
          torrentioPath = url;
          return new Response(
            JSON.stringify({
              streams: [{ name: 'Torrentio\n1080p ⚡', title: 'GoT 1080p', url: 'https://real-debrid.com/d/GOT' }],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                id: 'u-got',
                filename: 'GoT.S01E02.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/got.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'show-tt0944947:1:2' });
    expect(result.kind).toBe('stream');
    expect(torrentioPath).toContain('tt0944947:1:2');
  });

  it('searches Cinemeta by title when the play id is not IMDb', async () => {
    const dir = await dataDir();
    let torrentioPath = '';
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/catalog/series/top/search=')) {
          return new Response(
            JSON.stringify({ metas: [{ id: 'tt1230051', name: 'The Last of Us', type: 'series' }] }),
            { status: 200 },
          );
        }
        if (url.includes('torrentio.strem.fun')) {
          torrentioPath = url;
          return new Response(
            JSON.stringify({
              streams: [{ name: 'Torrentio\n1080p ⚡', title: 'TLOU 1080p', url: 'https://real-debrid.com/d/TLOU' }],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.includes('/downloads') || url.includes('/torrents')) {
            return new Response('[]', { status: 200 });
          }
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                id: 'u-tlou',
                filename: 'TLOU.S01E01.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/tlou.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({
      id: 'the-last-of-us:1:1',
      title: 'The Last of Us',
      season: 1,
      episode: 1,
    });
    expect(result.kind).toBe('stream');
    expect(torrentioPath).toContain('tt1230051:1:1');
  });

  it('reports empty when Torrentio returns no streams', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('torrentio.strem.fun')) {
          return new Response(JSON.stringify({ streams: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async () => new Response('no', { status: 404 }),
      }),
    });
    expect(await media.play({ id: 'tt15398776' })).toEqual({ kind: 'unavailable', reason: 'empty' });
  });

  it('reports empty when Torrentio fetch aborts', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('torrentio.strem.fun')) {
          const error = new Error('The operation was aborted');
          error.name = 'TimeoutError';
          throw error;
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async () => new Response('no', { status: 404 }),
      }),
    });
    expect(await media.play({ id: 'tt15398776' })).toEqual({ kind: 'unavailable', reason: 'empty' });
  });

  it('tries the next cached stream when the first Real-Debrid unrestrict fails', async () => {
    const dir = await dataDir();
    const unrestricted: string[] = [];
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('torrentio.strem.fun') && url.includes('.json')) {
          return new Response(
            JSON.stringify({
              streams: [
                { name: 'Torrentio\n1080p ⚡', title: 'Dead 1080p', url: 'https://real-debrid.com/d/DEAD' },
                { name: 'Torrentio\n1080p ⚡', title: 'Live 1080p', url: 'https://real-debrid.com/d/LIVE' },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            const body = String(init.body);
            unrestricted.push(body);
            if (body.includes('DEAD')) return new Response('gone', { status: 503 });
            return new Response(
              JSON.stringify({
                id: 'u-live',
                filename: 'Oppenheimer.2023.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/live.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'tt15398776' });
    expect(unrestricted.some((body) => body.includes('DEAD'))).toBe(true);
    expect(result.kind).toBe('stream');
    if (result.kind === 'stream') expect(result.url).toBe('https://cdn.example/live.mp4');
  });

  it('resolves a Torrentio URL before unrestricting the Real-Debrid link', async () => {
    const dir = await dataDir();
    let resolved = false;
    const media = createMediaService({
      dataDir: dir,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/resolve/')) {
          resolved = true;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://real-debrid.com/d/OPP' },
          });
        }
        if (url.includes('torrentio.strem.fun') && url.includes('.json')) {
          return new Response(
            JSON.stringify({
              streams: [
                {
                  name: 'Torrentio\n1080p ⚡',
                  title: 'Oppenheimer 1080p',
                  url: 'https://torrentio.strem.fun/realdebrid=token/resolve/realdebrid/abc/file',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ metas: [], meta: {} }), { status: 200 });
      },
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            expect(String(init.body)).toContain('OPP');
            expect(String(init.body)).not.toContain('torrentio');
            return new Response(
              JSON.stringify({
                id: 'u9',
                filename: 'Oppenheimer.2023.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/opp.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'tt15398776' });
    expect(resolved).toBe(true);
    expect(result.kind).toBe('stream');
  });

  it('lists a finished torrent as a playable file', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/downloads')) return new Response('[]', { status: 200 });
          if (url.includes('/torrents?')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'abc',
                  filename: 'The.Batman.2022.1080p.mkv',
                  status: 'downloaded',
                  progress: 100,
                  links: ['https://real-debrid.com/d/XYZ'],
                },
              ]),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const items = await media.library();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('rd:t:abc:0');
    expect(items[0]?.playable).toBe(true);
    expect(items[0]?.title).toBe('The Batman');
  });

  it('lists a season pack as a series folder, not episode 1', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/downloads')) return new Response('[]', { status: 200 });
          if (url.includes('/torrents?')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'pack',
                  filename: 'The.Boys.S01E01-08.2160p',
                  status: 'downloaded',
                  progress: 100,
                  links: ['https://real-debrid.com/d/A', 'https://real-debrid.com/d/B'],
                },
              ]),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const items = await media.library();
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('series');
    expect(items[0]?.episode).toBeUndefined();
    expect(items[0]?.title).toBe('The Boys');
  });

  it('plays a catalog title by matching the owned Real-Debrid file', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.includes('/downloads')) return new Response('[]', { status: 200 });
          if (url.includes('/torrents/info/abc')) {
            return new Response(
              JSON.stringify({
                id: 'abc',
                filename: 'The.Batman.2022.1080p.mkv',
                status: 'downloaded',
                progress: 100,
                links: ['https://real-debrid.com/d/XYZ'],
                files: [{ id: 1, path: '/The.Batman.2022.1080p.mkv', bytes: 1, selected: 1 }],
              }),
              { status: 200 },
            );
          }
          if (url.includes('/torrents?')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'abc',
                  filename: 'The.Batman.2022.1080p.mkv',
                  status: 'downloaded',
                  progress: 100,
                  links: ['https://real-debrid.com/d/XYZ'],
                },
              ]),
              { status: 200 },
            );
          }
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                id: 'u3',
                filename: 'The.Batman.2022.1080p.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/batman.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'the-batman', title: 'The Batman' });
    expect(result.kind).toBe('stream');
    if (result.kind === 'stream') {
      expect(result.url).toBe('https://cdn.example/batman.mp4');
      expect(result.title).toBe('The Batman');
    }
  });

  it('plays a torrent file by unrestricting the matching link', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.includes('/downloads')) return new Response('[]', { status: 200 });
          if (url.includes('/torrents/info/abc')) {
            return new Response(
              JSON.stringify({
                id: 'abc',
                filename: 'The.Batman.2022.1080p.mkv',
                status: 'downloaded',
                progress: 100,
                links: ['https://real-debrid.com/d/XYZ'],
                files: [{ id: 1, path: '/The.Batman.2022.1080p.mkv', bytes: 1, selected: 1 }],
              }),
              { status: 200 },
            );
          }
          if (url.includes('/torrents?')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'abc',
                  filename: 'The.Batman.2022.1080p.mkv',
                  status: 'downloaded',
                  progress: 100,
                  links: ['https://real-debrid.com/d/XYZ'],
                },
              ]),
              { status: 200 },
            );
          }
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            const body = String(init.body);
            expect(body).toContain('https%3A%2F%2Freal-debrid.com%2Fd%2FXYZ');
            return new Response(
              JSON.stringify({
                id: 'u3',
                filename: 'The.Batman.2022.1080p.mp4',
                mimeType: 'video/mp4',
                download: 'https://cdn.example/batman.mp4',
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const result = await media.play({ id: 'rd:t:abc:0' });
    expect(result.kind).toBe('stream');
    if (result.kind === 'stream') {
      expect(result.url).toBe('https://cdn.example/batman.mp4');
      expect(result.engine).toBe('html5');
      expect(result.title).toBe('The Batman');
    }
  });

  it('keeps downloads if the torrent list fails', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/downloads')) {
            return new Response(
              JSON.stringify([
                {
                  id: 'dl1',
                  filename: 'Arrival.2016.1080p.mp4',
                  mimeType: 'video/mp4',
                  link: 'https://real-debrid.com/d/ARR',
                },
              ]),
              { status: 200 },
            );
          }
          if (url.includes('/torrents')) return new Response('no', { status: 500 });
          return new Response('no', { status: 404 });
        },
      }),
    });
    const items = await media.library();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('rd:d:dl1');
  });

  it('lists selected files inside a torrent pack', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/torrents/info/pack1')) {
            return new Response(
              JSON.stringify({
                id: 'pack1',
                filename: 'Show.S01',
                status: 'downloaded',
                progress: 100,
                links: ['https://real-debrid.com/d/A', 'https://real-debrid.com/d/B'],
                files: [
                  { id: 1, path: '/Show.S01E01.mkv', bytes: 1, selected: 1 },
                  { id: 2, path: '/Show.S01E02.mkv', bytes: 1, selected: 1 },
                  { id: 3, path: '/sample.mkv', bytes: 1, selected: 0 },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const items = await media.children('rd:t:pack1:0');
    expect(items.map((item) => item.id)).toEqual(['rd:t:pack1:0', 'rd:t:pack1:1']);
    expect(items[1]?.filename).toBe('Show.S01E02.mkv');
    expect(items[1]?.season).toBe(1);
    expect(items[1]?.episode).toBe(2);
  });

  it('reads dotted episode names and numbers files in a season pack', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/torrents/info/pack2')) {
            return new Response(
              JSON.stringify({
                id: 'pack2',
                filename: 'The.Boys.S02.Complete',
                status: 'downloaded',
                progress: 100,
                links: ['https://real-debrid.com/d/A', 'https://real-debrid.com/d/B', 'https://real-debrid.com/d/C'],
                files: [
                  { id: 1, path: '/The.Boys.S02.E01.mkv', bytes: 1, selected: 1 },
                  { id: 2, path: '/Episode 2.mkv', bytes: 1, selected: 1 },
                  { id: 3, path: '/The.Boys.S02 E03.mkv', bytes: 1, selected: 1 },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response('no', { status: 404 });
        },
      }),
    });
    const items = await media.children('rd:t:pack2');
    expect(items.map((item) => [item.season, item.episode])).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
  });

  it('clears a stored token even if an env token is set', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async () => new Response(JSON.stringify({ username: 'ada', premium: 1, expiration: '' }), { status: 200 }),
      }),
    });
    expect((await media.status()).configured).toBe(true);
    expect((await media.setToken('')).configured).toBe(false);
    expect((await media.status()).configured).toBe(false);
  });

  it('stores a watchlist item without a token', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({ dataDir: dir, env: {} }),
    });
    const items = media.addToWatchlist({
      id: 'dune-part-two',
      title: 'Dune: Part Two',
      year: 2024,
      kind: 'movie',
      synopsis: '',
      poster: '',
      backdrop: '',
      genres: ['Sci-Fi'],
      rating: '12',
      playable: false,
      hue: 32,
    });
    expect(items).toHaveLength(1);
    expect(media.watchlist()[0]?.id).toBe('dune-part-two');
    expect(media.removeFromWatchlist('dune-part-two')).toEqual([]);
  });

  it('plays an MKV through a Real-Debrid HTML5 transcode', async () => {
    const dir = await dataDir();
    const media = createMediaService({
      dataDir: dir,
      rd: createRealDebrid({
        dataDir: dir,
        env: { TVM_RD_TOKEN: 'secret-token' },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith('/unrestrict/link') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                id: 'u2',
                filename: 'The.Boys.S01E01.mkv',
                mimeType: 'video/x-matroska',
                download: 'https://cdn.example/raw.mkv',
                streamable: 1,
              }),
              { status: 200 },
            );
          }
          if (url.includes('/streaming/transcode/u2')) {
            return new Response(JSON.stringify({ liveMP4: { '720': 'https://cdn.example/boys.mp4' } }), { status: 200 });
          }
          return new Response('no', { status: 404 });
        },
      }),
    });

    const result = await media.play({ link: 'https://real-debrid.com/d/BOYS' });
    expect(result).toEqual({
      kind: 'stream',
      url: 'https://cdn.example/boys.mp4',
      title: 'The Boys · S1 E1',
      filename: 'The.Boys.S01E01.mkv',
      mimeType: 'video/mp4',
      engine: 'html5',
      fallbackUrl: 'https://cdn.example/raw.mkv',
      fallbackEngine: 'native',
    });
  });
});
