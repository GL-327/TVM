import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerEngine, type EngineStream } from './engine';
import { html5CanAttach } from './desktopEngine';

afterEach(() => vi.unstubAllGlobals());

const events = {
  onTime: vi.fn(),
  onPlayState: vi.fn(),
  onBuffering: vi.fn(),
  onFirstFrame: vi.fn(),
  onEnded: vi.fn(),
  onClosed: vi.fn(),
  onError: vi.fn(),
};

describe('desktop native playback', () => {
  it('keeps browser formats in the page and sends Matroska to mpv', () => {
    expect(html5CanAttach({ mimeType: 'video/mp4', transport: 'file', url: 'http://127.0.0.1/a.mp4' })).toBe(true);
    expect(html5CanAttach({ mimeType: 'application/vnd.apple.mpegurl', transport: 'hls', url: 'http://127.0.0.1/a.m3u8' })).toBe(true);
    expect(html5CanAttach({ mimeType: 'video/x-matroska', transport: 'file', url: 'http://127.0.0.1/a.mkv' })).toBe(false);

    const start = vi.fn().mockResolvedValue({ ok: true });
    const setVolume = vi.fn();
    const setRate = vi.fn();
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/' },
      tvmDesktop: { nativePlayback: true },
      tvmNativePlayer: {
        start,
        command: vi.fn(),
        seekTo: vi.fn(),
        stop: vi.fn(),
        setVolume,
        setMuted: vi.fn(),
        setRate,
        onEvent: () => () => {},
      },
    });
    const mkv: EngineStream = {
      kind: 'stream',
      url: 'http://127.0.0.1:7345/film.mkv',
      title: 'Film',
      filename: 'film.mkv',
      mimeType: 'video/x-matroska',
      engine: 'html5',
    };
    const native = createPlayerEngine({} as HTMLVideoElement, mkv, { live: false, startAt: 12 }, events);
    native.attach();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ url: mkv.url, title: 'Film', startAt: 12 }));
    native.setVolume(0.4);
    native.setRate(1.5);
    expect(setVolume).toHaveBeenCalledWith(0.4);
    expect(setRate).toHaveBeenCalledWith(1.5);
    native.destroy();

    const video = { volume: 1, muted: false, playbackRate: 1 } as HTMLVideoElement;
    const mp4: EngineStream = { ...mkv, url: 'http://127.0.0.1:7345/film.mp4', mimeType: 'video/mp4', filename: 'film.mp4' };
    const page = createPlayerEngine(video, mp4, { live: false }, events);
    page.setVolume(0.25);
    expect(video.volume).toBe(0.25);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('leaves Matroska in the page when the shell cannot embed mpv', () => {
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/' },
      tvmDesktop: { nativePlayback: false },
      tvmNativePlayer: { start: vi.fn(), onEvent: () => () => {} },
    });
    const video = { volume: 1, muted: false, playbackRate: 1 } as HTMLVideoElement;
    const stream: EngineStream = {
      kind: 'stream',
      url: 'http://127.0.0.1:7345/film.mkv',
      title: 'Film',
      filename: 'film.mkv',
      mimeType: 'video/x-matroska',
      engine: 'html5',
    };
    const engine = createPlayerEngine(video, stream, { live: false }, events);
    engine.setVolume(0.5);
    expect(video.volume).toBe(0.5);
  });
});
