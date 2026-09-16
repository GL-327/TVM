import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_AGENT,
  buildUpstreamHeaders,
  describeProfile,
  forwardsFromClient,
  globalProfile,
  mergeProfiles,
  type HeaderProfile,
} from './headers.ts';

describe('what TVM sends upstream', () => {
  const profile: HeaderProfile = { id: 'panel' };

  it('sends the header set a panel asks for', () => {
    const headers = buildUpstreamHeaders({
      profile: {
        id: 'panel',
        userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
        referer: 'https://panel.example/',
        origin: 'https://panel.example',
        cookie: 'session=abc',
        extra: { 'X-Panel-Key': 'k1', 'X-Device': 'tvm' },
      },
    });
    expect(headers.get('user-agent')).toBe('VLC/3.0.20 LibVLC/3.0.20');
    expect(headers.get('referer')).toBe('https://panel.example/');
    expect(headers.get('origin')).toBe('https://panel.example');
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-panel-key')).toBe('k1');
    expect(headers.get('x-device')).toBe('tvm');
  });

  /*
   * The one that matters most.
   *
   * Every LAN client sends `Authorization: Bearer <TVM_LAN_TOKEN>` on each
   * proxy request. Forwarding the viewer's headers wholesale would hand TVM's
   * own LAN credential — and the viewer's session cookie — to whichever IPTV
   * provider happened to be upstream. The forward list is an allowlist for
   * exactly this reason.
   */
  it('never forwards the viewer credentials to a provider', () => {
    const headers = buildUpstreamHeaders({
      profile,
      incoming: {
        authorization: 'Bearer 0123456789abcdef0123456789abcdef',
        cookie: 'tvm_lan_session=secret',
        'x-forwarded-for': '192.168.1.44',
        'user-agent': 'Roku/DVP-14.0',
        referer: 'http://192.168.1.10:7345/',
      },
    });
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-forwarded-for')).toBeNull();
    // Not the Roku's own identity either: panels gate on the player string.
    expect(headers.get('user-agent')).not.toBe('Roku/DVP-14.0');
    expect(headers.get('referer')).not.toBe('http://192.168.1.10:7345/');

    expect(forwardsFromClient('authorization')).toBe(false);
    expect(forwardsFromClient('cookie')).toBe(false);
    expect(forwardsFromClient('range')).toBe(true);
    expect(forwardsFromClient('accept')).toBe(true);
  });

  it('carries a Range through for media and drops it for a manifest', () => {
    const media = buildUpstreamHeaders({ profile, incoming: { range: 'bytes=0-511' } });
    expect(media.get('range')).toBe('bytes=0-511');
    // Half a playlist is a broken playlist.
    const manifest = buildUpstreamHeaders({ profile, incoming: { range: 'bytes=0-511' }, playlist: true });
    expect(manifest.get('range')).toBeNull();
  });

  it('refuses profile headers that describe this hop rather than the request', () => {
    const headers = buildUpstreamHeaders({
      profile: {
        id: 'bad',
        extra: { Host: 'elsewhere.example', 'Content-Length': '99', Connection: 'close', 'X-Fine': 'yes' },
      },
    });
    expect(headers.get('host')).toBeNull();
    expect(headers.get('content-length')).toBeNull();
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('x-fine')).toBe('yes');
  });

  it('falls back field by field, so a channel need only override what differs', () => {
    const base: HeaderProfile = { id: 'global', userAgent: 'UA/1', referer: 'https://base/', extra: { 'X-A': '1' } };
    const merged = mergeProfiles(base, { id: 'chan', referer: 'https://chan/', extra: { 'X-B': '2' } });
    expect(merged.id).toBe('chan');
    expect(merged.userAgent).toBe('UA/1');
    expect(merged.referer).toBe('https://chan/');
    expect(merged.extra).toEqual({ 'X-A': '1', 'X-B': '2' });
    expect(mergeProfiles(base, null)).toBe(base);
  });

  it('reads the fallback profile from the environment, never from a config file', () => {
    const fromEnv = globalProfile({ TVM_LIVE_USER_AGENT: 'Custom/9', TVM_LIVE_REFERER: 'https://r/' });
    expect(fromEnv.userAgent).toBe('Custom/9');
    expect(fromEnv.referer).toBe('https://r/');
    expect(globalProfile({}).userAgent).toBe(DEFAULT_USER_AGENT);
    // Blank is absent, not an empty header.
    expect(globalProfile({ TVM_LIVE_REFERER: '   ' }).referer).toBeUndefined();
  });

  it('describes a profile by header name only, so a log cannot leak a cookie', () => {
    const names = describeProfile({ id: 'p', cookie: 'session=secret', extra: { 'X-Key': 'value' } });
    expect(names).toContain('Cookie');
    expect(names).toContain('X-Key');
    expect(names.join(' ')).not.toContain('secret');
    expect(names.join(' ')).not.toContain('value');
  });
});
