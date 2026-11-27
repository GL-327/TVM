import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIOSPlayerEngine,
  NATIVE_SLEEP_EVENT,
  NATIVE_STATS_EVENT,
  sendNativePlayerCommand,
  type NativeSleepSnapshot,
  type NativeStatsSnapshot,
} from './iosEngine';
import { formatRemainingSleep, formatStats, sleepDeadline, sleepFadeFactor, sleepShouldStart } from './extrasLogic';

type Listener = (event: Event) => void;

function mockBridgeRuntime(): {
  posted: Record<string, unknown>[];
  emitNative: (detail: Record<string, unknown>) => void;
  cleanup: () => void;
} {
  const listeners = new Map<string, Set<Listener>>();
  const posted: Record<string, unknown>[] = [];
  const win = {
    location: { href: 'http://127.0.0.1:4173/player' },
    webkit: {
      messageHandlers: {
        tvmPlayer: {
          postMessage: (msg: Record<string, unknown>) => {
            posted.push(msg);
          },
        },
      },
    },
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (event: Event) => {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('CustomEvent', class MockCustomEvent<T> {
    type: string;
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      this.type = type;
      this.detail = init?.detail as T;
    }
  });
  return {
    posted,
    emitNative: (detail) => {
      win.dispatchEvent(new CustomEvent('tvm:native-player', { detail }) as unknown as Event);
    },
    cleanup: () => {
      vi.unstubAllGlobals();
    },
  };
}

const sampleStream = {
  kind: 'stream' as const,
  url: '/proxy/stream.mkv',
  title: 'Example Show · S01E01',
  filename: 'example.mkv',
  mimeType: 'video/x-matroska',
  engine: 'native' as const,
};

describe('native playback extras bridge', () => {
  let cleanRuntime: (() => void) | null = null;
  afterEach(() => {
    cleanRuntime?.();
    cleanRuntime = null;
  });

  it('keeps audioLanguage on open and flushes queued nightMode and sleepTimer commands', () => {
    const rt = mockBridgeRuntime();
    cleanRuntime = rt.cleanup;

    const engine = createIOSPlayerEngine(
      sampleStream,
      { live: false, startAt: 42, initialVolume: 0.8, initialMuted: false, audioLanguage: 'jpn' },
      {
        onTime: () => {},
        onPlayState: () => {},
        onBuffering: () => {},
        onFirstFrame: () => {},
        onEnded: () => {},
        onError: () => {},
      },
    );

    sendNativePlayerCommand('nightMode', { enabled: true });
    sendNativePlayerCommand('sleepTimer', { choice: '30' });
    expect(rt.posted).toEqual([]);

    engine.attach();
    expect(rt.posted[0]).toEqual({
      id: expect.any(String),
      command: 'open',
      url: 'http://127.0.0.1:4173/proxy/stream.mkv',
      title: 'Example Show · S01E01',
      startAt: 42,
      live: false,
      initialVolume: 0.8,
      initialMuted: false,
      audioLanguage: 'jpn',
    });
    const sessionId = rt.posted[0]!['id'];
    expect(rt.posted[1]).toEqual({ id: sessionId, command: 'nightMode', enabled: true });
    expect(rt.posted[2]).toEqual({ id: sessionId, command: 'sleepTimer', choice: '30' });

    sendNativePlayerCommand('stats', { visible: true });
    expect(rt.posted[3]).toEqual({ id: sessionId, command: 'stats', visible: true });

    engine.destroy();
    sendNativePlayerCommand('nightMode', { enabled: false });
    expect(rt.posted[rt.posted.length - 1]).toEqual({ id: sessionId, command: 'stop' });
  });

  it('forwards native stats and sleep events only for the matching session id', () => {
    const rt = mockBridgeRuntime();
    cleanRuntime = rt.cleanup;
    const statsEvents: Array<{ visible?: boolean; stats?: NativeStatsSnapshot }> = [];
    const sleepEvents: NativeSleepSnapshot[] = [];

    window.addEventListener(NATIVE_STATS_EVENT, (ev) => {
      statsEvents.push((ev as CustomEvent<{ visible?: boolean; stats?: NativeStatsSnapshot }>).detail);
    });
    window.addEventListener(NATIVE_SLEEP_EVENT, (ev) => {
      sleepEvents.push((ev as CustomEvent<{ sleep: NativeSleepSnapshot }>).detail.sleep);
    });

    const engine = createIOSPlayerEngine(
      sampleStream,
      { live: false },
      {
        onTime: () => {},
        onPlayState: () => {},
        onBuffering: () => {},
        onFirstFrame: () => {},
        onEnded: () => {},
        onError: () => {},
      },
    );
    engine.attach();
    const id = rt.posted[0]!['id'] as string;

    rt.emitNative({ id: 'wrong-id', command: 'stats', visible: true });
    rt.emitNative({
      id,
      command: 'stats',
      visible: true,
      stats: { resolution: '3840 × 2160', videoCodec: 'HEVC', audioCodec: 'EAC3', source: 'REMUX' },
    });
    rt.emitNative({ id, command: 'sleep', choice: '15', remainingMs: 895_000, fading: false, expired: false });
    rt.emitNative({
      id,
      command: 'state',
      position: 100,
      duration: 2400,
      paused: false,
      buffering: false,
      hasFrame: true,
      sleep: { choice: '15', remainingMs: 0, fading: false, expired: true },
    });

    expect(statsEvents).toEqual([
      {
        id,
        visible: true,
        stats: { resolution: '3840 × 2160', videoCodec: 'HEVC', audioCodec: 'EAC3', source: 'REMUX' },
      },
    ]);
    expect(sleepEvents).toEqual([
      { choice: '15', remainingMs: 895_000, fading: false, expired: false },
      { choice: '15', remainingMs: 0, fading: false, expired: true },
    ]);
    engine.destroy();
  });
});

describe('formatStats and sleep formatting', () => {
  it('formats full native telemetry fields while keeping HTML5 fallback compatible', () => {
    const htmlRows = formatStats(null, { mimeType: 'video/mp4' }, 1200);
    expect(htmlRows.map(([k]) => k)).toEqual([
      'Resolution',
      'Container / MIME',
      'Codec',
      'HDR',
      'Frames dropped / total',
      'Estimated bitrate',
      'Version',
      'Buffer ahead',
    ]);

    const nativeRows = Object.fromEntries(
      formatStats(
        null,
        {
          mimeType: 'video/x-matroska',
          version: {
            id: 'v1',
            label: '2160p REMUX',
            source: 'remux',
            codec: 'HEVC',
            hdr: 'dv',
            sizeBytes: 10_000_000_000,
            bitrateMbps: 42.5,
            languages: ['eng'],
            upscaled: false,
            cached: true,
            recommended: true,
          },
        },
        3600,
        {
          resolution: '3840 × 2160',
          videoCodec: 'HEVC',
          audioCodec: 'EAC3',
          audioLanguage: 'eng',
          audioChannels: '5.1',
          hdr: 'dv',
          subtitles: 'English (SRT)',
          droppedFrames: 2,
          totalFrames: 4200,
          bitrateMbps: 44.2,
          bufferSeconds: 9.5,
          source: 'REMUX',
        },
      ),
    );

    expect(nativeRows).toEqual({
      Resolution: '3840 × 2160',
      'Container / MIME': 'video/x-matroska',
      Codecs: 'HEVC · EAC3',
      HDR: 'Dolby Vision',
      Audio: 'eng · 5.1',
      Subtitles: 'English (SRT)',
      'Frames dropped / total': '2 / 4200',
      Bitrate: '44.2 Mb/s',
      Source: 'REMUX',
      Version: '2160p REMUX',
      'Buffer ahead': '9.5 s',
    });
  });

  it('formats remaining sleep time and validates deadline and fade curves', () => {
    expect(formatRemainingSleep(null)).toBeNull();
    expect(formatRemainingSleep(-10)).toBeNull();
    expect(formatRemainingSleep(4200)).toBe('0:05');
    expect(formatRemainingSleep(900_000)).toBe('15:00');
    expect(formatRemainingSleep(3_665_000)).toBe('1:01:05');
    expect(sleepDeadline('45', 1000)).toBe(1000 + 45 * 60_000);
    expect(sleepFadeFactor(2500)).toBe(0.5);
    expect(sleepShouldStart('end', null, 0, 595, 600, false)).toBe(true);
    expect(sleepShouldStart('end', null, 0, 595, 600, true)).toBe(false);
  });
});
