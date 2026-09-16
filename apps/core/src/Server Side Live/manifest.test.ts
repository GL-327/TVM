import { describe, expect, it } from 'vitest';
import {
  guessMediaType,
  isHlsPlaylistUrl,
  looksLikeManifest,
  remainingAbsoluteUrls,
  rewriteManifest,
} from './manifest.ts';
import { parseM3u, publicView } from './playlist.ts';

const mint = (url: string, playlist: boolean): string =>
  `/api/live/proxy/${playlist ? 'P' : 'S'}${Buffer.from(url).toString('hex').slice(0, 8)}`;

describe('reflecting an HLS manifest', () => {
  it('rewrites variants, segments, keys and init segments together', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://panel.example/key.bin",IV=0x0',
      '#EXT-X-MAP:URI="https://panel.example/init.mp4"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/stream.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000',
      'variant/720.m3u8',
      '#EXTINF:6.0,',
      'segment-1.ts',
      '#EXTINF:6.0,',
      'https://cdn.panel.example/segment-2.ts',
    ].join('\n');

    const out = rewriteManifest(body, 'https://panel.example/live/index.m3u8', mint);

    // Nothing upstream survives anywhere in the body — line or attribute.
    expect(remainingAbsoluteUrls(out)).toEqual([]);
    expect(out).not.toContain('panel.example');
    expect(out).not.toContain('cdn.panel.example');

    // The key is proxied too. Missing it leaks the host on first decryption.
    expect(out).toMatch(/#EXT-X-KEY:METHOD=AES-128,URI="\/api\/live\/proxy\/S[0-9a-f]+",IV=0x0/);
    expect(out).toMatch(/#EXT-X-MAP:URI="\/api\/live\/proxy\/S[0-9a-f]+"/);
    // A variant named by EXT-X-STREAM-INF is a playlist; a segment is not.
    expect(out).toMatch(/\/api\/live\/proxy\/P[0-9a-f]+/);
    expect(out.split('\n').filter((l) => l.startsWith('/api/live/proxy/S')).length).toBe(2);
    // Tags and their attributes survive intact.
    expect(out).toContain('#EXT-X-VERSION:3');
    expect(out).toContain('BANDWIDTH=1200000');
  });

  it('resolves relative paths against the manifest, not against Core', () => {
    const seen: string[] = [];
    rewriteManifest('#EXTM3U\n#EXTINF:6,\n../chunks/a.ts', 'https://panel.example/live/hd/index.m3u8', (url) => {
      seen.push(url);
      return '/api/live/proxy/x';
    });
    expect(seen).toEqual(['https://panel.example/live/chunks/a.ts']);
  });

  it('follows a redirect when resolving, so segments are not chased to the wrong host', () => {
    const seen: string[] = [];
    // The caller passes the *final* URL; this proves relative resolution uses it.
    rewriteManifest('#EXTM3U\n#EXTINF:6,\na.ts', 'https://edge2.panel.example/x/index.m3u8', (url) => {
      seen.push(url);
      return '/p';
    });
    expect(seen).toEqual(['https://edge2.panel.example/x/a.ts']);
  });

  it('leaves a body it cannot parse alone rather than corrupting it', () => {
    const body = '#EXTM3U\n#EXTINF:6,\nsegment.ts';
    expect(rewriteManifest(body, 'not a url', mint)).toBe(body);
  });

  it('knows a manifest from a segment', () => {
    expect(isHlsPlaylistUrl('https://x/y.m3u8')).toBe(true);
    expect(isHlsPlaylistUrl('https://x/y.ts?a=1')).toBe(false);
    expect(isHlsPlaylistUrl('https://x/y', 'application/vnd.apple.mpegurl')).toBe(true);
    expect(looksLikeManifest('#EXTM3U\n')).toBe(true);
    expect(looksLikeManifest('GGGG')).toBe(false);
    expect(guessMediaType('https://x/a.ts')).toBe('video/mp2t');
    expect(guessMediaType('https://x/a.mp4')).toBe('video/mp4');
    expect(guessMediaType('https://x/a.m3u8')).toBe('application/vnd.apple.mpegurl');
  });
});

describe('reading a provider playlist', () => {
  it('picks up the header hints providers bury in the file', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="sky.uk" tvg-logo="https://panel.example/logo.png" group-title="Sports",Sky Sports',
      '#EXTVLCOPT:http-user-agent=SpecialPlayer/2.0',
      '#EXTVLCOPT:http-referrer=https://panel.example/portal',
      'https://panel.example/live/1.m3u8',
      '#EXTINF:-1 group-title="News",BBC News',
      '#EXTHTTP:{"User-Agent":"Other/1","X-Token":"abc"}',
      'https://panel.example/live/2.m3u8',
      '#EXTINF:-1,Plain Channel',
      'https://panel.example/live/3.ts',
    ].join('\n');

    const channels = parseM3u(m3u);
    expect(channels).toHaveLength(3);

    expect(channels[0]?.name).toBe('Sky Sports');
    expect(channels[0]?.group).toBe('Sports');
    expect(channels[0]?.tvgId).toBe('sky.uk');
    expect(channels[0]?.profile?.userAgent).toBe('SpecialPlayer/2.0');
    expect(channels[0]?.profile?.referer).toBe('https://panel.example/portal');

    expect(channels[1]?.profile?.userAgent).toBe('Other/1');
    expect(channels[1]?.profile?.extra).toEqual({ 'X-Token': 'abc' });

    // No hints, no profile — it falls back to the global one at request time.
    expect(channels[2]?.profile).toBeUndefined();
  });

  it('gives every channel a stable id across reloads of the same playlist', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,One\nhttps://p/1.ts\n#EXTINF:-1,Two\nhttps://p/2.ts';
    expect(parseM3u(m3u).map((c) => c.id)).toEqual(parseM3u(m3u).map((c) => c.id));
    expect(new Set(parseM3u(m3u).map((c) => c.id)).size).toBe(2);
  });

  it('survives a malformed EXTHTTP line instead of failing the playlist', () => {
    const channels = parseM3u('#EXTM3U\n#EXTINF:-1,X\n#EXTHTTP:{not json}\nhttps://p/1.ts');
    expect(channels).toHaveLength(1);
    expect(channels[0]?.profile).toBeUndefined();
  });

  /*
   * The UI must never receive an upstream URL or a credential. The public
   * shape has nowhere to put one, so a future change cannot quietly add it
   * back by forgetting to redact a field.
   */
  it('hands the UI a shape with no room for a provider URL', () => {
    const channel = parseM3u('#EXTM3U\n#EXTINF:-1 tvg-logo="https://panel.example/l.png",X\n#EXTVLCOPT:http-cookie=session=s3cret\nhttps://panel.example/secret/1.m3u8')[0];
    expect(channel).toBeDefined();
    const view = publicView(channel!, '/api/live/proxy/abc');
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('panel.example/secret');
    expect(serialised).not.toContain('s3cret');
    expect(Object.keys(view).sort()).toEqual(['id', 'logo', 'name', 'play'].sort());
    expect(view.play).toBe('/api/live/proxy/abc');
    // Even the logo goes through Core rather than the provider host.
    expect(view.logo?.startsWith('/api/art?src=')).toBe(true);
  });
});
