import { describe, expect, it } from 'vitest';
import type { Title } from './catalog';
import { episodeHeading, episodeKey, mergeEpisodes, packsToExpand, placeholderEpisodes, placeholderSeasons, torrentKey } from './episodes';
import { looksLikePack, type MediaItem } from './media';

const boys: Title = {
  id: 'the-boys',
  title: 'The Boys',
  year: 2019,
  kind: 'series',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: ['Action'],
  rating: '18',
  hue: 1,
};

function file(id: string, name: string, season?: number, episode?: number, episodeName?: string): MediaItem {
  return {
    id,
    title: 'The Boys',
    year: 2019,
    kind: 'series',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: true,
    filename: name,
    hue: 1,
    showTitle: 'The Boys',
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
    ...(episodeName !== undefined ? { episodeName } : {}),
  };
}

describe('episode helpers', () => {
  it('reads a torrent id out of a file id', () => {
    expect(torrentKey('rd:t:LECBWPLWJG6UE:2')).toBe('LECBWPLWJG6UE');
    expect(torrentKey('rd:d:1')).toBeNull();
  });

  it('treats episode ranges as packs', () => {
    expect(looksLikePack('The Boys', 'The.Boys.S01E01-08.mkv')).toBe(true);
    expect(looksLikePack('The Boys', 'The.Boys.S01E01.mkv')).toBe(false);
  });

  it('merges duplicate episodes from several packs and keeps season order', () => {
    const merged = mergeEpisodes([
      [file('rd:t:a:0', 'The.Boys.S02E01.mkv', 2, 1, 'The Big Ride')],
      [
        file('rd:t:b:0', 'The.Boys.S01E01.mkv', 1, 1, 'The Name of the Game'),
        file('rd:t:b:1', 'The.Boys.S01E02.mkv', 1, 2, 'Cherry'),
        file('rd:t:b:0-pack', 'The.Boys.S01.Complete.mkv'),
      ],
    ]);
    expect(merged.map((item) => episodeKey(item))).toEqual(['s1e1', 's1e2', 's2e1']);
    expect(episodeHeading(merged[0] as MediaItem)).toBe('The Name of the Game');
  });

  it('expands the owned torrent first', () => {
    const pack = file('rd:t:AAA:0', 'The.Boys.S01.Complete.mkv');
    const other = file('rd:t:BBB:0', 'The.Boys.S01.2160p.mkv');
    expect(packsToExpand({ ...boys, id: 'rd:t:AAA:0' }, [other, pack])[0]).toBe('rd:t:AAA:0');
  });

  it('builds a season and episode grid when metadata has not arrived', () => {
    expect(placeholderSeasons({ ...boys, seasons: 3 })).toEqual([1, 2, 3]);
    const episodes = placeholderEpisodes(boys, 2, 2);
    expect(episodes.map((item) => episodeKey(item))).toEqual(['s2e1', 's2e2']);
    expect(episodes[0]?.id).toBe('the-boys:2:1');
  });
});
