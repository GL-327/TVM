import { describe, expect, it } from 'vitest';
import {
  capStreamsToHeight,
  extractImdb,
  fetchTorrentioStreams,
  isTorrentioHost,
  needsUnrestrict,
  parseDebridStream,
  parsePlayId,
  parseSeasonEpisode,
  pickDebridStream,
  rankDebridStreams,
  resolveTorrentioUrl,
  TORRENTIO_USER_AGENT,
  torrentioStreamPaths,
} from './torrentio.ts';

describe('torrentio stream pick', () => {
  it('parses an IMDb play id with an episode', () => {
    expect(parsePlayId('tt0944947:1:2')).toEqual({ imdb: 'tt0944947', season: 1, episode: 2 });
    expect(parsePlayId('tt0111161')).toEqual({ imdb: 'tt0111161' });
    expect(parsePlayId('rd:t:abc')).toBeNull();
    expect(extractImdb('show-tt0944947:1:2')).toBe('tt0944947');
    expect(parseSeasonEpisode('the-last-of-us:1:8')).toEqual({ season: 1, episode: 8 });
  });

  it('asks Torrentio for the episode path first', () => {
    expect(torrentioStreamPaths('tt0944947', 1, 1)[0]).toBe('stream/series/tt0944947:1:1.json');
  });

  it('drops CAM rips and prefers a cached 1080p', () => {
    const cam = parseDebridStream({ name: 'CAM', title: 'camrip', url: 'https://cdn.example/cam.mp4' });
    const cached = parseDebridStream({
      name: 'Torrentio\n1080p ⚡',
      title: 'Oppenheimer 1080p',
      url: 'https://real-debrid.com/d/OPP',
    });
    const hd = parseDebridStream({
      name: '720p',
      title: 'Oppenheimer 720p',
      url: 'https://real-debrid.com/d/LOW',
    });
    expect(cam).toBeNull();
    expect(pickDebridStream([hd!, cached!])?.url).toBe('https://real-debrid.com/d/OPP');
    expect(rankDebridStreams([hd!, cached!]).map((stream) => stream.url)).toEqual([
      'https://real-debrid.com/d/OPP',
      'https://real-debrid.com/d/LOW',
    ]);
    expect(capStreamsToHeight([cached!, hd!], 720).map((stream) => stream.url)).toEqual(['https://real-debrid.com/d/LOW']);
  });

  it('returns no streams when Torrentio fetch aborts', async () => {
    const streams = await fetchTorrentioStreams('token', 'tt0111161', undefined, undefined, async () => {
      const error = new Error('The operation was aborted');
      error.name = 'TimeoutError';
      throw error;
    });
    expect(streams).toEqual([]);
  });

  it('sends a user agent and treats a 403 as empty rather than throwing', async () => {
    let agent = '';
    const streams = await fetchTorrentioStreams('token', 'tt0111161', undefined, undefined, async (_input, init) => {
      agent = new Headers(init?.headers).get('user-agent') ?? '';
      return new Response('no', { status: 403 });
    });
    expect(streams).toEqual([]);
    expect(agent).toBe(TORRENTIO_USER_AGENT);
  });

  it('does not parse a video body when Torrentio resolve has no Location', async () => {
    const resolved = await resolveTorrentioUrl(
      'https://torrentio.strem.fun/realdebrid=token/resolve/realdebrid/abc/file',
      async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
    );
    expect(resolved).toBeNull();
  });

  it('follows a Torrentio resolve URL to a Real-Debrid hoster link', async () => {
    const resolved = await resolveTorrentioUrl(
      'https://torrentio.strem.fun/realdebrid=token/resolve/realdebrid/abc/file',
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://real-debrid.com/d/OPP' },
        }),
    );
    expect(resolved).toBe('https://real-debrid.com/d/OPP');
    expect(isTorrentioHost('https://torrentio.strem.fun/resolve/x')).toBe(true);
    expect(isTorrentioHost('https://real-debrid.com/d/OPP')).toBe(false);
  });

  it('unrestricts hoster and Real-Debrid /d/ links, not direct CDN files', () => {
    expect(needsUnrestrict('https://real-debrid.com/d/ABC')).toBe(true);
    expect(needsUnrestrict('https://hoster.example/file')).toBe(true);
    expect(needsUnrestrict('https://download.real-debrid.com/d/ABC.mp4')).toBe(false);
    expect(needsUnrestrict('https://cdn.example/file.mp4')).toBe(false);
  });
});
