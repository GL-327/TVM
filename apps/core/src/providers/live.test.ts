import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveService, liveChannelId, looksLikePlaylistText, parseM3u } from './live.ts';
import { mintHop } from './hlsProxy.ts';

describe('parseM3u', () => {
  it('reads names, groups and http(s) URLs', () => {
    const bbc = 'https://example.com/bbc1.m3u8';
    const sky = 'https://example.com/sky.m3u8';
    const channels = parseM3u(`#EXTM3U
#EXTINF:-1 tvg-name="BBC One" group-title="UK",BBC One HD
${bbc}
#EXTINF:-1,Sky Sports
${sky}
#EXTINF:-1,Ignored
javascript:alert(1)
`);
    expect(channels).toEqual([
      { id: liveChannelId(bbc), name: 'BBC One', url: bbc, group: 'UK' },
      { id: liveChannelId(sky), name: 'Sky Sports', url: sky },
    ]);
  });

  it('reads logos and EXTGRP groups', () => {
    const url = 'https://example.com/news.m3u8';
    const channels = parseM3u(`#EXTM3U
#EXTGRP:News
#EXTINF:-1 tvg-logo="https://example.com/bbc.png",BBC News
${url}
`);
    expect(channels).toEqual([
      {
        id: liveChannelId(url),
        name: 'BBC News',
        url,
        group: 'News',
        logo: 'https://example.com/bbc.png',
      },
    ]);
  });

  it('accepts protocol-relative tvg-logo urls', () => {
    const url = 'https://example.com/news.m3u8';
    const channels = parseM3u(`#EXTM3U
#EXTINF:-1 tvg-logo="//cdn.example/bbc.png",BBC News
${url}
`);
    expect(channels[0]?.logo).toBe('https://cdn.example/bbc.png');
  });

  it('ignores comments and empty lines', () => {
    expect(parseM3u('#EXTM3U\n\n# comment\n')).toEqual([]);
  });
});

describe('live service', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('serves the MAX mock pack when entitled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-max-'));
    dirs.push(dir);
    const live = createLiveService({ dataDir: dir, includeMock: () => true, fetch: async () => new Response('no', { status: 404 }) });
    const status = await live.status();
    expect(status.channels.map((channel) => channel.name)).toEqual([
      'Sample sports 1',
      'Sample sports 2',
      'Sample sports 3',
      'Sample entertainment',
    ]);
    const play = await live.play('live:mock:sky-sports');
    expect(play.kind).toBe('stream');
    if (play.kind === 'stream') expect(play.engine).toBe('html5');
  });

  it('returns an empty status until a playlist is stored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-'));
    dirs.push(dir);
    const live = createLiveService({ dataDir: dir, fetch: async () => new Response('no', { status: 404 }) });
    expect(await live.status()).toMatchObject({
      url: null,
      host: null,
      username: null,
      configured: false,
      channels: [],
      error: null,
      picked: 0,
      total: 0,
      needsPicks: false,
    });
  });

  it('plays a channel from a stored playlist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-'));
    dirs.push(dir);
    const url = 'https://example.com/bbc1.m3u8';
    const live = createLiveService({
      dataDir: dir,
      fetch: async () => new Response(`#EXTM3U\n#EXTINF:-1,BBC One\n${url}\n`, { status: 200 }),
    });
    const status = await live.setPlaylist('https://example.com/playlist.m3u');
    expect(status.channels).toHaveLength(1);
    expect(status.channels[0]).toMatchObject({ name: 'BBC One' });
    expect(status.channels[0]).not.toHaveProperty('url');
    expect(status.configured).toBe(true);
    const id = liveChannelId(url);
    expect(await live.play(id)).toEqual({
      kind: 'stream',
      url: `/api/live/stream/${encodeURIComponent(id)}`,
      title: 'BBC One',
      filename: 'BBC One',
      mimeType: 'application/vnd.apple.mpegurl',
      engine: 'html5',
      transport: 'hls',
    });
    expect(await live.upstreamUrl(id)).toBe(url);
  });

  it('plays an MPEG-TS channel as video/mp2t so the desktop player uses mpegts.js', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-ts-'));
    dirs.push(dir);
    const url = 'https://example.com/news.ts';
    const live = createLiveService({
      dataDir: dir,
      fetch: async () => new Response(`#EXTM3U\n#EXTINF:-1,News\n${url}\n`, { status: 200 }),
    });
    await live.setPlaylist('https://example.com/playlist.m3u');
    const id = liveChannelId(url);
    expect(await live.play(id)).toMatchObject({
      kind: 'stream',
      mimeType: 'video/mp2t',
      engine: 'html5',
    });
  });

  it('keeps a large playlist off Live TV until channels are picked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-picks-'));
    dirs.push(dir);
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 60; i += 1) {
      const group = i < 10 ? 'UK' : 'World';
      lines.push(`#EXTINF:-1 group-title="${group}",Channel ${i}`);
      lines.push(`https://example.com/ch${i}.m3u8`);
    }
    const live = createLiveService({
      dataDir: dir,
      fetch: async () => new Response(lines.join('\n'), { status: 200 }),
    });
    const loaded = await live.setPlaylist('https://example.com/big.m3u');
    expect(loaded.total).toBe(60);
    expect(loaded.needsPicks).toBe(true);
    expect(loaded.channels).toEqual([]);

    const first = liveChannelId('https://example.com/ch0.m3u8');
    const picked = await live.togglePick(first, true);
    expect(picked.needsPicks).toBe(false);
    expect(picked.picked).toBe(1);
    expect(picked.channels.map((channel) => channel.id)).toEqual([first]);

    const page = await live.catalog({ group: 'UK', offset: 0, limit: 24 });
    expect(page.matched).toBe(10);
    expect(page.items[0]?.picked).toBe(true);

    const grouped = await live.setGroupPicks('UK', true);
    expect(grouped.picked).toBe(10);

    const catalog = await live.catalog({ q: 'channel 0' });
    expect(catalog.matched).toBe(1);
    expect(catalog.items[0]?.name).toBe('Channel 0');
  });

  it('accepts pasted M3U text and a single HLS URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-text-'));
    dirs.push(dir);
    const one = 'https://example.com/one.m3u8';
    const two = 'https://example.com/two.m3u8';
    expect(looksLikePlaylistText(`#EXTM3U\n#EXTINF:-1,One\n${one}`)).toBe(true);
    const live = createLiveService({ dataDir: dir, fetch: async () => new Response('no', { status: 404 }) });
    const pasted = await live.setPlaylist(`#EXTM3U\n#EXTINF:-1 group-title="Home",Tuner\n${one}\n#EXTINF:-1,Camera\n${two}\n`);
    expect(pasted.error).toBeNull();
    expect(pasted.total).toBe(2);
    expect(pasted.channels.map((channel) => channel.name)).toEqual(['Tuner', 'Camera']);
    expect(pasted.channels.every((channel) => !('url' in channel) || channel.url === undefined)).toBe(true);
    expect(pasted.url).toBe('local:playlist');

    const again = createLiveService({ dataDir: dir, fetch: async () => new Response('no', { status: 404 }) });
    const restored = await again.status();
    expect(restored.total).toBe(2);
    expect(restored.channels[0]?.name).toBe('Tuner');

    const single = await live.setPlaylist('https://example.com/only.m3u8');
    expect(single.url).toBe('https://example.com/only.m3u8');
  });

  it('stores Xtream credentials and plays through a Core path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-xtream-'));
    dirs.push(dir);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/live/')) {
        return new Response('#EXTM3U\n#EXTINF:4,\nseg.ts\n', {
          status: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        });
      }
      if (!url.includes('action=')) {
        return new Response(JSON.stringify({ user_info: { username: 'alice', auth: 1 } }), { status: 200 });
      }
      if (url.includes('get_live_categories')) {
        return new Response(JSON.stringify([{ category_id: '9', category_name: 'News' }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ stream_id: 7, name: 'World News', category_id: '9' }]), { status: 200 });
    };
    const live = createLiveService({ dataDir: dir, fetch: fetchImpl });
    const rejected = await live.setXtream({ host: 'panel.example:8080', username: 'alice', password: 'secret' });
    expect(rejected.configured).toBe(true);
    expect(rejected.host).toBe('http://panel.example:8080');
    expect(rejected.username).toBe('alice');
    expect(rejected.channels[0]).toMatchObject({ id: 'live:xtream:7', name: 'World News', group: 'News' });
    expect(JSON.stringify(rejected)).not.toContain('secret');
    expect(rejected.channels[0]).not.toHaveProperty('url');

    const play = await live.play('live:xtream:7');
    expect(play.kind).toBe('stream');
    if (play.kind === 'stream') {
      expect(play.url).toBe('/api/live/stream/live%3Axtream%3A7');
      expect(play.url).not.toContain('secret');
    }
    const proxied = await live.proxyChannel('live:xtream:7');
    expect(proxied.kind).toBe('playlist');
    expect(String(proxied.body)).toContain('/api/live/hop/');
    expect(String(proxied.body)).not.toContain('secret');
  });

  it('does not store a rejected Xtream password', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-xtream-bad-'));
    dirs.push(dir);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () => new Response(JSON.stringify({ user_info: { auth: 0 } }), { status: 200 }),
    });
    const status = await live.setXtream({ host: 'http://panel.example', username: 'alice', password: 'nope' });
    expect(status.configured).toBe(false);
    expect(status.error).toBe('needs-auth');
    expect((await live.status()).configured).toBe(false);
  });

  it('sniffs Real-Debrid HLS hops that have no file extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-hls-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/ABC', false);
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4,\nhttps://cdn.real-debrid.com/seg.ts\n', {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    });
    const result = await live.proxyHop(token);
    expect(result.kind).toBe('playlist');
    expect(result.contentType).toContain('mpegurl');
    expect(String(result.body)).toContain('#EXTM3U');
    expect(String(result.body)).toContain('/api/live/hop/');
    expect(String(result.body)).not.toContain('cdn.real-debrid.com/seg');
  });

  it('keeps progressive Debrid downloads as media and forwards Range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-mp4-'));
    dirs.push(dir);
    const path = mintHop('https://download.real-debrid.com/d/XYZ', false);
    const token = path.slice('/api/live/hop/'.length);
    let seenRange = '';
    const live = createLiveService({
      dataDir: dir,
      fetch: async (_input, init) => {
        seenRange = new Headers(init?.headers).get('range') ?? '';
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), {
          status: 206,
          headers: {
            'content-type': 'application/octet-stream',
            'content-range': 'bytes 0-11/1000',
            'content-length': '12',
          },
        });
      },
    });
    const result = await live.proxyHop(token, { range: 'bytes=0-11' });
    expect(seenRange).toBe('bytes=0-11');
    expect(result.kind).toBe('media');
    expect(result.contentType).toBe('video/mp4');
    expect(result.status).toBe(206);
  });

  it('sniffs MPEG-TS hops even when Real-Debrid labels them as MP4', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-ts-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/LIVE', false);
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10, 0x00, 0x00, 0x00, 0x00]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    });
    const result = await live.proxyHop(token);
    expect(result.kind).toBe('media');
    expect(result.contentType).toBe('video/mp2t');
  });

  it('HEADs without a Range GET so Chromium sees the entity size, not a 512-byte slice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-head-ts-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/LIVE', false, 'video/mp2t');
    const token = path.slice('/api/live/hop/'.length);
    let seenRange = '';
    let seenMethod = '';
    const live = createLiveService({
      dataDir: dir,
      fetch: async (_input, init) => {
        seenMethod = init?.method ?? '';
        seenRange = new Headers(init?.headers).get('range') ?? '';
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': '9999',
            'accept-ranges': 'bytes',
          },
        });
      },
    });
    const result = await live.proxyHop(token, { range: 'bytes=0-511' }, 'HEAD');
    expect(seenMethod).toBe('HEAD');
    expect(seenRange).toBe('');
    expect(result.kind).toBe('media');
    expect(result.contentType).toBe('video/mp2t');
    expect(result.status).toBe(200);
    expect(result.contentLength).toBe('9999');
    expect(result.contentRange == null || result.contentRange === '').toBe(true);
    expect(result.acceptRanges).toBe('bytes');
  });

  it('does not invent Accept-Ranges when HEAD fails or upstream omits it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-head-norange-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/LIVE', false, 'video/mp2t');
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () => new Response(null, { status: 405 }),
    });
    const result = await live.proxyHop(token, {}, 'HEAD');
    expect(result.kind).toBe('media');
    expect(result.acceptRanges == null || result.acceptRanges === '').toBe(true);
    expect(result.contentLength == null || result.contentLength === '').toBe(true);
  });

  it('does not advertise Accept-Ranges on GET when upstream sent none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-get-norange-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/LIVE', false, 'video/mp2t');
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10]), {
          status: 200,
          headers: { 'content-type': 'video/mp2t' },
        }),
    });
    const result = await live.proxyHop(token);
    expect(result.kind).toBe('media');
    expect(result.acceptRanges == null || result.acceptRanges === '').toBe(true);
  });

  it('does not advertise a 512-byte HEAD Content-Length as the file size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-head-512-'));
    dirs.push(dir);
    const path = mintHop('https://download.real-debrid.com/d/XYZ', false, 'video/mp4');
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-length': '512' },
        }),
    });
    const result = await live.proxyHop(token, {}, 'HEAD');
    expect(result.kind).toBe('media');
    expect(result.contentType).toBe('video/mp4');
    expect(result.contentLength == null || result.contentLength === '').toBe(true);
  });

  it('pipes a hinted MP4 GET without sniffing so HLS-looking bytes are not rewritten', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-skip-sniff-'));
    dirs.push(dir);
    const path = mintHop('https://download.real-debrid.com/d/XYZ', false, 'video/mp4');
    const token = path.slice('/api/live/hop/'.length);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response('#EXTM3U\n#EXTINF:4,\nseg.ts\n', {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '24' },
        }),
    });
    const result = await live.proxyHop(token);
    expect(result.kind).toBe('media');
    expect(result.contentType).toBe('video/mp4');
    expect(result.contentLength).toBe('24');
  });

  it('does not rewrite a player Range GET into a HEAD sniff range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-hop-range-pass-'));
    dirs.push(dir);
    const path = mintHop('https://cdn.real-debrid.com/d/LIVE', false, 'video/mp2t');
    const token = path.slice('/api/live/hop/'.length);
    let seenRange = '';
    const live = createLiveService({
      dataDir: dir,
      fetch: async (_input, init) => {
        seenRange = new Headers(init?.headers).get('range') ?? '';
        return new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10]), {
          status: 206,
          headers: {
            'content-type': 'video/mp2t',
            'content-range': 'bytes 1024-1027/9999',
            'content-length': '4',
          },
        });
      },
    });
    const result = await live.proxyHop(token, { range: 'bytes=1024-2047' });
    expect(seenRange).toBe('bytes=1024-2047');
    expect(result.kind).toBe('media');
    expect(result.status).toBe(206);
    expect(result.contentType).toBe('video/mp2t');
    expect(result.contentRange).toBe('bytes 1024-1027/9999');
  });
});
