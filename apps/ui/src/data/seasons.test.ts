import { describe, expect, it } from 'vitest';
import { episodesForSeason, seasonNumbers } from './seasons';

describe('season and episode lists', () => {
  const files = [
    { id: 'tt1:2:1', season: 2, episode: 1 },
    { id: 'tt1:1:2', season: 1, episode: 2 },
    { id: 'tt1:1:1', season: 1, episode: 1 },
  ];

  it('lists seasons in order without inventing episodes', () => {
    expect(seasonNumbers(files)).toEqual([1, 2]);
    expect(seasonNumbers([])).toEqual([]);
  });

  it('shows only the chosen season until a season is picked', () => {
    expect(episodesForSeason(files, null)).toEqual([]);
    expect(episodesForSeason(files, 1).map((item) => item.id)).toEqual(['tt1:1:2', 'tt1:1:1']);
  });
});
