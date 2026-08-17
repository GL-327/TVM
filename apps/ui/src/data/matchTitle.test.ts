import { describe, expect, it } from 'vitest';
import { titlesMatch } from './matchTitle';

describe('titlesMatch', () => {
  it('matches a release name to the advertised title', () => {
    expect(titlesMatch('The Wilds', 'The.Wilds.S01E01.1080p.mkv')).toBe(true);
    expect(titlesMatch('Dune Part Two', 'Dune.Part.Two.2024.BluRay.mkv')).toBe(true);
    expect(titlesMatch('Reacher', 'Reacher.S02E03.mkv')).toBe(true);
    expect(titlesMatch('Reacher', 'Jack.Reacher.2012.mkv')).toBe(true);
  });

  it('does not treat a short word as the whole title', () => {
    expect(titlesMatch('The Last of Us', 'Last.Christmas.2020.mkv')).toBe(false);
    expect(titlesMatch('The Boys', 'The.Boys.in.the.Boat.2023.mkv')).toBe(false);
    expect(titlesMatch('The Boys', 'The.Boys.S01E01.mkv')).toBe(true);
    expect(titlesMatch('Reacher', 'Preacher.S01E01.mkv')).toBe(false);
    expect(titlesMatch('Silo', 'The.Silo.S01E01.mkv')).toBe(true);
    expect(titlesMatch('Silo', 'The.Silo.House.mkv')).toBe(false);
    expect(titlesMatch('Dune Part Two', 'Dune.2021.mkv')).toBe(false);
    expect(titlesMatch('Stranger Things', 'Stranger.Things.S04E01.Chapter.One.The.Hellfire.Club.1080p.mkv')).toBe(
      true,
    );
    expect(titlesMatch('Stranger Things', 'Stranger.Things.S04.Complete.mkv')).toBe(true);
  });
});
