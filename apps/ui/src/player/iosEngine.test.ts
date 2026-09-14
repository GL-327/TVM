import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerEngine, type EngineStream } from './engine';

afterEach(() => vi.unstubAllGlobals());

describe('iOS native playback', () => {
  it('opens MKV natively, preserves progress, ignores stale events and stops on unmount', () => {
    const postMessage = vi.fn();
    const win = Object.assign(new EventTarget(), {
      location: { href: 'http://127.0.0.1:7345/' },
      webkit: { messageHandlers: { tvmPlayer: { postMessage } } },
    });
    vi.stubGlobal('window', win);
    const events = { onTime: vi.fn(), onPlayState: vi.fn(), onBuffering: vi.fn(), onFirstFrame: vi.fn(), onEnded: vi.fn(), onClosed: vi.fn(), onError: vi.fn() };
    const stream: EngineStream = { kind: 'stream', url: 'https://cdn.example/film.mkv', title: 'Film', filename: 'film.mkv', mimeType: 'video/x-matroska', engine: 'native' };
    // No HTML element API is required or touched by the native engine.
    const engine = createPlayerEngine({} as HTMLVideoElement, stream, { live: false, startAt: 128 }, events);
    engine.attach(); engine.attach();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const open = postMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(open).toMatchObject({ command: 'open', url: stream.url, startAt: 128 });
    const state = { id: open['id'], command: 'state', position: 140, duration: 7200, paused: false, buffering: false, hasFrame: true };
    const emit = (data: Record<string, unknown>): void => { win.dispatchEvent(new CustomEvent('tvm:native-player', { detail: data })); };
    emit({ ...state, id: 'old-session' });
    expect(events.onTime).not.toHaveBeenCalled();
    emit(state); emit({ ...state, position: 141 });
    expect(engine.position()).toBe(141);
    expect(engine.duration()).toBe(7200);
    expect(events.onFirstFrame).toHaveBeenCalledTimes(1);
    expect(events.onPlayState).toHaveBeenCalledTimes(1);
    engine.seekBy(10);
    expect(postMessage).toHaveBeenLastCalledWith({ id: open['id'], command: 'seek', seconds: 151 });
    emit({ id: open['id'], command: 'closed' });
    expect(events.onClosed).toHaveBeenCalledOnce();
    expect(events.onEnded).not.toHaveBeenCalled();
    engine.destroy();
    expect(postMessage).toHaveBeenLastCalledWith({ id: open['id'], command: 'stop' });
    emit(state);
    expect(events.onTime).toHaveBeenCalledTimes(2);
  });
});
