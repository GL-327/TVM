import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { absolutePosition, attachKindFor, createPlayerEngine, displayDuration, withinSessionWindow, STARTUP_TIMEOUT_MS, STALL_TIMEOUT_MS, STALLED_ERROR, type EngineStream } from './engine';
import { attachedHls } from './hlsBridge';

const fakeHls = vi.hoisted(() => {
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
    static isSupported = (): boolean => true;
    static instances: FakeHls[] = [];
    listeners = new Map<string, (...args: unknown[]) => void>();
    levels = [{ height: 480 }, { height: 720 }, { height: 1080 }];
    autoLevelCapping = -1;
    destroy = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    recoverMediaError = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    constructor(public config: Record<string, unknown>) { FakeHls.instances.push(this); }
    on(event: string, handler: (...args: unknown[]) => void): void { this.listeners.set(event, handler); }
  }
  return FakeHls;
});

vi.mock('hls.js', () => ({ default: fakeHls }));

class FakeVideo extends EventTarget {
  currentTime = 10;
  duration = 1800;
  paused = true;
  volume = 1;
  muted = false;
  videoWidth = 1920;
  src = '';
  error = null;
  seekable = { length: 1, start: () => 0, end: () => 100 };
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
}

const stream: EngineStream = {
  kind: 'stream', url: '/movie.mp4', title: 'Movie', filename: 'movie.mp4', mimeType: 'video/mp4', engine: 'html5', transport: 'file',
};
const sessionStream: EngineStream = { ...stream, transport: 'hls-session', sessionId: 'session', timeOffset: 600, durationSeconds: 1800 };

function setup(source = stream, options = {}) {
  const video = new FakeVideo();
  const events = { onTime: vi.fn(), onPlayState: vi.fn(), onBuffering: vi.fn(), onFirstFrame: vi.fn(), onEnded: vi.fn(), onError: vi.fn() };
  const engine = createPlayerEngine(video as unknown as HTMLVideoElement, source, { live: false, ...options }, events);
  return { video, events, engine };
}

beforeEach(() => { fakeHls.instances = []; });
afterEach(() => { vi.useRealTimers(); });

describe('attach kind', () => {
  it('routes by explicit transport first', () => {
    expect(attachKindFor({ mimeType: 'video/mp4', url: '/api/stream/hls/a/index.m3u8', transport: 'hls-session' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: '/api/live/stream/x', transport: 'ts-live' }, true)).toBe('ts-live');
    expect(attachKindFor({ mimeType: 'video/mp4', url: '/api/stream/direct/tok', transport: 'direct' }, false)).toBe('file');
  });

  it('falls back to mime and extension sniffing for older payloads', () => {
    expect(attachKindFor({ mimeType: 'application/vnd.apple.mpegurl', url: 'https://x/y' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: '', url: 'https://x/y.m3u8?token=1' }, false)).toBe('hls');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: 'https://x/y' }, true)).toBe('ts-live');
    expect(attachKindFor({ mimeType: 'video/mp2t', url: 'https://x/y' }, false)).toBe('file');
    expect(attachKindFor({ mimeType: 'video/mp4', url: 'https://x/y.mp4' }, false)).toBe('file');
  });
});

describe('playback lifecycle', () => {
  it('attaches once and detaches metadata resume listeners before a remount', () => {
    const { video, events, engine } = setup(stream, { startAt: 300 });
    engine.attach();
    engine.attach();
    video.dispatchEvent(new Event('timeupdate'));
    expect(events.onTime).toHaveBeenCalledTimes(1);
    engine.destroy();
    engine.destroy();
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(10);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(events.onTime).toHaveBeenCalledTimes(1);
  });

  it('keeps paused files paused when seeking and ignores invalid positions', () => {
    const { video, engine } = setup();
    engine.attach();
    engine.pause();
    video.play.mockClear();
    engine.seekTo(200);
    expect(video.currentTime).toBe(200);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    engine.seekTo(Number.NaN);
    engine.seekTo(Number.POSITIVE_INFINITY);
    expect(video.currentTime).toBe(200);
    engine.destroy();
  });

  it('does not create an HLS instance after unmounting during its lazy import', async () => {
    const { engine } = setup(sessionStream);
    engine.attach();
    engine.destroy();
    await vi.dynamicImportSettled();
    expect(fakeHls.instances).toHaveLength(0);
  });

  it('publishes and clears the actual HLS instance and enforces the quality cap', async () => {
    const { video, engine } = setup(sessionStream, { maxHeight: 720 });
    engine.attach();
    await vi.dynamicImportSettled();
    const instance = fakeHls.instances[0]!;
    expect(instance.config.startPosition).toBe(0);
    expect(attachedHls(video as unknown as HTMLVideoElement)).toBe(instance);
    instance.listeners.get('manifest')?.();
    expect(instance.autoLevelCapping).toBe(1);
    engine.destroy();
    expect(attachedHls(video as unknown as HTMLVideoElement)).toBeNull();
    expect(instance.destroy).toHaveBeenCalledOnce();
  });

  it('coalesces repeated remote seeks to the latest requested position and preserves pause', async () => {
    let finishFirst!: (response: Response) => void;
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, offset: 930 })));
    const { video, events, engine } = setup(sessionStream, { fetchImpl });
    engine.attach();
    await vi.dynamicImportSettled();
    engine.pause();
    engine.seekTo(900);
    engine.seekBy(10);
    engine.seekBy(20);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    finishFirst(new Response(JSON.stringify({ ok: true, offset: 900 })));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({ at: 930 });
    await vi.waitFor(() => expect(events.onTime).toHaveBeenCalledWith(930, 1800));
    await vi.dynamicImportSettled();
    fakeHls.instances.at(-1)!.listeners.get('manifest')?.();
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(fakeHls.instances).toHaveLength(2);
    engine.destroy();
  });

  it('restarts for a gap in a session seekable window and aborts its request on exit', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const { video, engine } = setup(sessionStream, { fetchImpl });
    video.seekable = { length: 1, start: () => 30, end: () => 100 };
    engine.attach();
    await vi.dynamicImportSettled();
    engine.seekTo(615);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const signal = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    engine.destroy();
    expect(signal.aborted).toBe(true);
  });

  it('surfaces a startup deadline even when canplay and waiting keep alternating', async () => {
    vi.useFakeTimers();
    const { video, events, engine } = setup();
    video.videoWidth = 0;
    video.currentTime = 0;
    engine.attach();
    for (let elapsed = 0; elapsed < STARTUP_TIMEOUT_MS; elapsed += 1000) {
      video.dispatchEvent(new Event('waiting'));
      video.dispatchEvent(new Event('canplay'));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(events.onError).toHaveBeenCalledExactlyOnceWith(STALLED_ERROR);
    expect(video.paused).toBe(true);
    video.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(STARTUP_TIMEOUT_MS);
    expect(events.onError).toHaveBeenCalledOnce();
    engine.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops an established stream that stops advancing and does not time out a user pause', async () => {
    vi.useFakeTimers();
    const { video, events, engine } = setup();
    engine.attach();
    video.dispatchEvent(new Event('playing'));
    engine.pause();
    await vi.advanceTimersByTimeAsync(STARTUP_TIMEOUT_MS * 2);
    expect(events.onError).not.toHaveBeenCalled();
    engine.play();
    for (let i = 0; i < 40; i += 1) {
      video.currentTime += 1;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(events.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith(STALLED_ERROR);
    engine.destroy();
  });

  it('surfaces a rejected browser play promise instead of leaving loading active', async () => {
    const { video, events, engine } = setup();
    video.play.mockRejectedValue(new DOMException('Unsupported source', 'NotSupportedError'));
    engine.attach();
    await vi.waitFor(() => expect(events.onError).toHaveBeenCalledOnce());
    expect(events.onBuffering).toHaveBeenLastCalledWith(false);
    engine.destroy();
  });

  it('bounds HLS network recovery to one retry and stops loading on fatal failure', async () => {
    const { events, engine } = setup(sessionStream);
    engine.attach();
    await vi.dynamicImportSettled();
    const instance = fakeHls.instances[0]!;
    const error = instance.listeners.get('error')!;
    error('error', { fatal: true, type: 'network' });
    error('error', { fatal: true, type: 'network' });
    error('error', { fatal: true, type: 'network' });
    expect(instance.startLoad).toHaveBeenCalledOnce();
    expect(instance.stopLoad).toHaveBeenCalledOnce();
    expect(events.onError).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('reports an expired seek session rather than silently getting stuck', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    const { events, engine } = setup(sessionStream, { fetchImpl });
    engine.attach();
    await vi.dynamicImportSettled();
    engine.seekTo(1000);
    await vi.waitFor(() => expect(events.onError).toHaveBeenCalledOnce());
    expect(events.onBuffering).toHaveBeenLastCalledWith(false);
    engine.destroy();
  });
});

describe('session time mapping', () => {
  it('adds the session offset to element time', () => {
    expect(absolutePosition(12.5, 600)).toBe(612.5);
    expect(absolutePosition(-1, 0)).toBe(0);
  });

  it('prefers the probed duration over a growing element duration', () => {
    expect(displayDuration(5400, 90, 600)).toBe(5400);
    expect(displayDuration(undefined, 90, 600)).toBe(690);
    expect(displayDuration(undefined, Number.NaN, 600)).toBe(0);
  });

  it('only seeks inside what ffmpeg has produced', () => {
    expect(withinSessionWindow(650, 600, 120)).toBe(true);
    expect(withinSessionWindow(590, 600, 120)).toBe(false);
    expect(withinSessionWindow(900, 600, 120)).toBe(false);
  });
});
