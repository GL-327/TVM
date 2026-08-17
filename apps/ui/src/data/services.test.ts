import { describe, expect, it } from 'vitest';
import type { Title } from './catalog';
import type { MediaItem } from './media';
import { resolveWatch, watchSource } from './services';

const wilds: Title = {
  id: 'the-wilds',
  title: 'The Wilds',
  year: 2020,
  kind: 'series',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: ['Drama'],
  rating: '15',
  hue: 160,
  network: 'prime video',
};

function file(id: string, name: string, progress?: number): MediaItem {
  return {
    id,
    title: 'The Wilds',
    year: 2020,
    kind: 'series',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: true,
    filename: name,
    hue: 1,
    showTitle: 'The Wilds',
    season: 1,
    episode: 1,
    progress,
  };
}

describe('resolveWatch', () => {
  it('plays a Cinemeta title from TVM Stream', () => {
    const oppenheimer: Title = {
      ...wilds,
      id: 'tt15398776',
      title: 'Oppenheimer',
      kind: 'movie',
      network: undefined,
    };
    expect(resolveWatch(oppenheimer, [])).toEqual({ kind: 'play', id: 'tt15398776' });
    expect(watchSource(oppenheimer, [])).toBe('TVM Stream');
  });

  it('opens the advertised service when the title is not in the cloud', () => {
    expect(resolveWatch(wilds, [])).toEqual({
      kind: 'service',
      appId: 'prime',
    });
    expect(watchSource(wilds, [])).toBe('prime video');
  });

  it('plays the owned episode from TVM Stream', () => {
    const owned = file('rd:t:1:0', 'The.Wilds.S01E01.mkv');
    expect(resolveWatch(wilds, [owned])).toEqual({ kind: 'play', id: 'rd:t:1:0' });
    expect(watchSource(wilds, [owned])).toBe('TVM Stream');
  });

  it('matches a catalog series to an episode that still has a chapter title', () => {
    const stranger: Title = {
      ...wilds,
      id: 'stranger-things',
      title: 'Stranger Things',
      network: undefined,
    };
    const owned: MediaItem = {
      ...file('rd:t:st:3', 'Stranger.Things.S04E01.Chapter.One.The.Hellfire.Club.1080p.mkv'),
      title: 'Stranger Things',
      showTitle: 'Stranger Things',
      filename: 'Stranger.Things.S04E01.Chapter.One.The.Hellfire.Club.1080p.mkv',
    };
    expect(resolveWatch(stranger, [owned])).toEqual({ kind: 'play', id: 'rd:t:st:3' });
  });

  it('resumes the in-progress episode', () => {
    const first = file('rd:t:1:0', 'The.Wilds.S01E01.mkv');
    const mid = file('rd:t:1:4', 'The.Wilds.S01E05.mkv', 0.4);
    mid.episode = 5;
    expect(resolveWatch(wilds, [first, mid])).toEqual({ kind: 'play', id: 'rd:t:1:4' });
  });
});
