import { describe, expect, it } from 'vitest';
import { hopMediaType, hopRecord, hopRemoteHls, hopTarget, isHlsPlaylist, looksLikeHlsBytes, looksLikeMpegTs, mintHop, probeContentLength, rewriteHlsPlaylist, browserMediaType, skipMediaSniff, totalFromContentRange } from './hlsProxy.ts';
import { fetchXtreamLive, normalizeXtreamHost, xtreamChannelId, xtreamStreamUrl } from './xtream.ts';

describe('normalizeXtreamHost', () => {
  it('adds http and strips player_api.php', () => {
    expect(normalizeXtreamHost('panel.example:8080/player_api.php')).toBe('http://panel.example:8080');
    expect(normalizeXtreamHost('https://tv.example.com/c/')).toBe('https://tv.example.com/c');
    expect(normalizeXtreamHost('')).toBeNull();
  });
});

describe('hls proxy rewrite', () => {
  it('rewrites media lines and URI attributes onto Core hops', () => {
    const playlist = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
#EXTINF:4,
segment.ts
#EXT-X-STREAM-INF:BANDWIDTH=800000
https://cdn.example/alt.m3u8
`;
    const hops: string[] = [];
    const rewritten = rewriteHlsPlaylist(playlist, 'https://cdn.example/live/u/p/1.m3u8', (url) => {
      hops.push(url);
      return `/api/live/hop/${hops.length}`;
    });
    expect(rewritten).toContain('URI="/api/live/hop/1"');
    expect(rewritten).toContain('/api/live/hop/2');
    expect(rewritten).toContain('/api/live/hop/3');
    expect(hops[0]).toBe('https://cdn.example/live/u/p/key.key');
    expect(hops[1]).toBe('https://cdn.example/live/u/p/segment.ts');
    expect(hops[2]).toBe('https://cdn.example/alt.m3u8');
    const stored = rewriteHlsPlaylist('#EXTM3U\n#EXTINF:4,\nhttps://cdn.example/seg.ts\n', 'https://cdn.example/live.m3u8');
    const token = /\/api\/live\/hop\/([a-f0-9]+)/.exec(stored)?.[1] ?? '';
    expect(hopRecord(token)?.mimeType).toBe('video/mp2t');
    expect(hopRecord(token)?.playlist).toBe(false);
    expect(isHlsPlaylist('https://x/a.m3u8', 'text/plain')).toBe(true);
    expect(looksLikeHlsBytes(new TextEncoder().encode('#EXTM3U\n#EXTINF:4'))).toBe(true);
    expect(looksLikeHlsBytes(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]))).toBe(false);
    expect(looksLikeMpegTs(new Uint8Array([0x47, 0x40, 0x11, 0x10]))).toBe(true);
    expect(browserMediaType('application/octet-stream', false)).toBe('video/mp4');
    expect(browserMediaType('video/mp2t', false)).toBe('video/mp2t');
    expect(browserMediaType('video/webm', false)).toBe('video/webm');
    expect(totalFromContentRange('bytes 0-511/9999')).toBe('9999');
    expect(totalFromContentRange('bytes 0-511/*')).toBeNull();
    expect(probeContentLength('512', 'bytes 0-511/10485760')).toBe('10485760');
    expect(probeContentLength('512', 'bytes 0-511/*')).toBeNull();
    expect(probeContentLength('512', null)).toBeNull();
    expect(probeContentLength('10485760', null)).toBe('10485760');
    expect(skipMediaSniff('video/mp2t', false)).toBe(true);
    expect(skipMediaSniff('video/mp4', true)).toBe(true);
    expect(skipMediaSniff('', false)).toBe(false);
    expect(hopMediaType('https://cdn.example/seg.ts', false)).toBe('video/mp2t');
    expect(hopMediaType('https://cdn.example/alt.m3u8', true)).toContain('mpegurl');
  });

  it('mints opaque hops that do not embed the upstream URL', () => {
    const path = mintHop('https://panel.example/live/user/secret/1.ts');
    expect(path.startsWith('/api/live/hop/')).toBe(true);
    expect(path).not.toContain('secret');
    const token = path.slice('/api/live/hop/'.length);
    expect(hopTarget(token)).toBe('https://panel.example/live/user/secret/1.ts');
  });

  it('hops remote HLS and leaves same-origin and MP4 URLs alone', () => {
    const remote = hopRemoteHls('https://cdn.example/a.m3u8', 'application/vnd.apple.mpegurl');
    expect(remote.startsWith('/api/live/hop/')).toBe(true);
    expect(hopRemoteHls('/api/live/stream/live%3A1', 'application/vnd.apple.mpegurl')).toBe(
      '/api/live/stream/live%3A1',
    );
    expect(hopRemoteHls('https://cdn.example/a.mp4', 'video/mp4')).toBe('https://cdn.example/a.mp4');
  });

  it('stores the playback mime on the hop so HEAD probes are not guessed as MP4', () => {
    const path = mintHop('https://panel.example/live/user/secret/1.ts', false, 'video/mp2t');
    const token = path.slice('/api/live/hop/'.length);
    expect(hopRecord(token)?.mimeType).toBe('video/mp2t');
    expect(hopRecord(token)?.playlist).toBe(false);
  });
});

describe('fetchXtreamLive', () => {
  it('maps categories and streams without putting credentials on the channel', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain('username=alice');
      expect(url).toContain('password=secret');
      if (!url.includes('action=')) {
        return new Response(JSON.stringify({ user_info: { username: 'alice', auth: 1, status: 'Active' } }), {
          status: 200,
        });
      }
      if (url.includes('get_live_categories')) {
        return new Response(JSON.stringify([{ category_id: '1', category_name: 'Sports' }]), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          { stream_id: 42, name: 'Match TV', category_id: '1', stream_icon: 'https://logo.example/a.png' },
        ]),
        { status: 200 },
      );
    };
    const loaded = await fetchXtreamLive(
      { host: 'http://panel.example', username: 'alice', password: 'secret' },
      fetchImpl,
    );
    expect(loaded.error).toBeNull();
    expect(loaded.channels).toEqual([
      {
        id: xtreamChannelId('42'),
        name: 'Match TV',
        url: '',
        group: 'Sports',
        logo: 'https://logo.example/a.png',
      },
    ]);
    expect(JSON.stringify(loaded.channels)).not.toContain('secret');
    expect(xtreamStreamUrl({ host: 'http://panel.example', username: 'alice', password: 'secret' }, '42')).toContain(
      '/live/alice/secret/42.m3u8',
    );
  });

  it('rejects a panel that refuses the password', async () => {
    const loaded = await fetchXtreamLive(
      { host: 'http://panel.example', username: 'alice', password: 'nope' },
      async () => new Response(JSON.stringify({ user_info: { auth: 0 } }), { status: 200 }),
    );
    expect(loaded).toMatchObject({ channels: [], error: 'needs-auth' });
  });
});
