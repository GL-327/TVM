import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveService, liveGroups, parseM3u } from './live.ts';

describe('parseM3u', () => {
  it('reads names, groups and http(s) URLs', () => {
    const channels = parseM3u(`#EXTM3U
#EXTINF:-1 tvg-name="BBC One" group-title="UK",BBC One HD
https://example.com/bbc1.m3u8
#EXTINF:-1,Sky Sports
https://example.com/sky.m3u8
#EXTINF:-1,Ignored
javascript:alert(1)
`);
    expect(channels).toEqual([
      { id: 'live:0', name: 'BBC One', url: 'https://example.com/bbc1.m3u8', group: 'UK' },
      { id: 'live:1', name: 'Sky Sports', url: 'https://example.com/sky.m3u8', group: undefined },
    ]);
  });

  it('reads unquoted attributes, EXTGRP, relative URLs and VLC headers', () => {
    const channels = parseM3u(
      `#EXTM3U
#EXTINF:-1 tvg-name=CNN group-title=News tvg-logo=https://example.com/cnn.png,CNN HD
https://cdn.example.com/cnn.m3u8
#EXTGRP:Sports
#EXTVLCOPT:http-user-agent=VLC/3.0
#EXTINF:-1,Local Match
/live/match.ts
#EXTINF:-1 group-title="UK",BBC
https://example.com/bbc.ts|User-Agent=TVM&Referer=https://example.com/
`,
      'https://provider.example/playlist.m3u',
    );
    expect(channels).toEqual([
      {
        id: 'live:0',
        name: 'CNN',
        url: 'https://cdn.example.com/cnn.m3u8',
        group: 'News',
        logo: 'https://example.com/cnn.png',
      },
      {
        id: 'live:1',
        name: 'Local Match',
        url: 'https://provider.example/live/match.ts',
        group: 'Sports',
        headers: { 'User-Agent': 'VLC/3.0' },
      },
      {
        id: 'live:2',
        name: 'BBC',
        url: 'https://example.com/bbc.ts',
        group: 'UK',
        headers: { 'User-Agent': 'TVM', Referer: 'https://example.com/' },
      },
    ]);
    expect(liveGroups(channels)).toEqual(['All', 'News', 'Sports', 'UK']);
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
      'Sky Sports',
      'TNT Sports',
      'beIN Sports',
      'USA Network',
    ]);
    const play = await live.play('live:mock:sky-sports');
    expect(play.kind).toBe('stream');
    if (play.kind === 'stream') expect(play.engine).toBe('html5');
  });

  it('returns an empty status until a playlist is stored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-'));
    dirs.push(dir);
    const live = createLiveService({ dataDir: dir, fetch: async () => new Response('no', { status: 404 }) });
    expect(await live.status()).toEqual({ url: null, channels: [], error: null });
  });

  it('plays a channel from a stored playlist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-live-'));
    dirs.push(dir);
    const live = createLiveService({
      dataDir: dir,
      fetch: async () =>
        new Response('#EXTM3U\n#EXTINF:-1,BBC One\nhttps://example.com/bbc1.m3u8\n', { status: 200 }),
    });
    const status = await live.setPlaylist('https://example.com/playlist.m3u');
    expect(status.channels).toHaveLength(1);
    expect(await live.play('live:0')).toEqual({
      kind: 'stream',
      url: 'https://example.com/bbc1.m3u8',
      title: 'BBC One',
      filename: 'BBC One',
      mimeType: 'application/vnd.apple.mpegurl',
      engine: 'html5',
    });
  });
});
