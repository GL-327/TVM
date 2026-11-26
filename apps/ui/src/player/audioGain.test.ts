import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBoostedVolume, applyNightMode } from './audioGain';

afterEach(() => vi.unstubAllGlobals());

describe('night mode Web Audio graph', () => {
  it('shares the source and gain with volume boost, bypasses compression when off, and reuses it when re-enabled', () => {
    const source = { connect: vi.fn() };
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
    const compressor = { connect: vi.fn(), disconnect: vi.fn(), threshold: { value: 0 }, knee: { value: 0 },
      ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } };
    const createMediaElementSource = vi.fn(() => source);
    const createDynamicsCompressor = vi.fn(() => compressor);
    const destination = {};
    class Context {
      state = 'running'; destination = destination;
      createMediaElementSource = createMediaElementSource;
      createGain = () => gain;
      createDynamicsCompressor = createDynamicsCompressor;
    }
    vi.stubGlobal('window', { location: { href: 'http://localhost/', origin: 'http://localhost' }, AudioContext: Context });
    const media = { src: 'http://localhost/stream.mp4', currentSrc: '', volume: 1, getAttribute: () => null } as unknown as HTMLMediaElement;
    applyBoostedVolume(media, 1.5, false);
    expect(applyNightMode(media, true)).toBe(true);
    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(gain.connect).toHaveBeenLastCalledWith(compressor);
    expect(compressor.connect).toHaveBeenCalledWith(destination);
    expect(gain.gain.value).toBe(1.5);
    expect(compressor.ratio.value).toBeGreaterThan(1);
    expect(applyNightMode(media, false)).toBe(false);
    expect(gain.connect).toHaveBeenLastCalledWith(destination);
    applyNightMode(media, true);
    expect(createDynamicsCompressor).toHaveBeenCalledTimes(1);
    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
  });
  it('does not route non-CORS cross-origin media through Web Audio', () => {
    const create = vi.fn();
    vi.stubGlobal('window', { location: { href: 'http://localhost/', origin: 'http://localhost' }, AudioContext: create });
    const media = { src: 'https://cdn.example/stream.mp4', currentSrc: '', volume: 1, crossOrigin: '', getAttribute: () => null } as unknown as HTMLMediaElement;
    expect(applyNightMode(media, true)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(media.volume).toBe(1);
  });
});
