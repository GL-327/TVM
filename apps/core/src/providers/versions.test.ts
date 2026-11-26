import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../prefs.ts';
import { rankVersions } from './versions.ts';

const s = (title: string, cached = true) => ({ url: `https://x/${title}`, title, quality: 0, cached });

describe('rankVersions', () => {
  const streams = [s('Film 2160p UpScaled WEB-DL'), s('Film 1080p BluRay x264'), s('Film 2160p REMUX HEVC'), s('Film 2160p CAM')];
  it('drops cams and upscales and puts the best native version first', () => {
    const out = rankVersions(streams, { prefs: { ...DEFAULT_PREFS, quality: 'original' }, originalLanguage: null, runtime: null, maxHeight: 2160 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 2160p REMUX HEVC', 'Film 1080p BluRay x264']);
    expect(out[0]!.version.recommended).toBe(true);
  });
  it('respects the height cap', () => {
    const out = rankVersions(streams, { prefs: { ...DEFAULT_PREFS, quality: 'original' }, originalLanguage: null, runtime: null, maxHeight: 1080 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 1080p BluRay x264']);
  });
  it('prefers the original language when asked', () => {
    const out = rankVersions([s('Film 1080p ENGLISH'), s('Film 2160p FRENCH')],
      { prefs: { ...DEFAULT_PREFS, quality: 'original', audioLanguage: 'original' }, originalLanguage: 'fra', runtime: null, maxHeight: 2160 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 2160p FRENCH']);
  });
});
