import { describe, expect, it } from 'vitest';
import { certificateLabel, formatAired, imdbIdFrom, imdbScore, imdbTitleUrl, playIdFor, seriesGraphUrl } from './playId';

describe('play ids and scores', () => {
  it('builds an episode play id from an IMDb title', () => {
    expect(playIdFor('tt0944947', 1, 2)).toBe('tt0944947:1:2');
    expect(playIdFor('tt0111161:1:2', 1, 2)).toBe('tt0111161:1:2');
    expect(playIdFor('the-last-of-us', 1, 1)).toBe('the-last-of-us:1:1');
    expect(imdbIdFrom('tt0111161:1:2')).toBe('tt0111161');
  });

  it('treats 8.4 as an IMDb score and 15 as a certificate', () => {
    expect(imdbScore('8.4')).toBe('8.4');
    expect(imdbScore('15')).toBeNull();
    expect(certificateLabel('15')).toBe('15');
    expect(certificateLabel('8.4')).toBeNull();
  });

  it('builds an IMDb title URL when the id contains tt', () => {
    expect(imdbTitleUrl('tt0111161')).toBe('https://www.imdb.com/title/tt0111161/');
    expect(imdbTitleUrl('dune-part-two')).toBeNull();
    expect(seriesGraphUrl()).toBe('https://seriesgraph.com/');
  });

  it('formats an episode air date for the details row', () => {
    expect(formatAired('2012-05-18')).toBe('18 May 2012');
    expect(formatAired('2023-01-15T00:00:00.000Z')).toBe('15 Jan 2023');
    expect(formatAired('not-a-date')).toBeNull();
  });
});
