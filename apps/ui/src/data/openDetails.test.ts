import { describe, expect, it } from 'vitest';
import { detailsParams, titleFromDetailsParams } from './openDetails';
import type { Title } from './catalog';

const mentalist: Title = {
  id: 'tt1196946',
  title: 'The Mentalist',
  year: 2008,
  kind: 'series',
  synopsis: 'Patrick Jane.',
  poster: 'https://example/p.jpg',
  backdrop: 'https://example/b.jpg',
  genres: ['Crime'],
  rating: '8.2',
  hue: 12,
  seasons: 7,
};

describe('details params', () => {
  it('keeps a series a series so the season list can show before Cinemeta returns', () => {
    const title = titleFromDetailsParams(detailsParams(mentalist), undefined);
    expect(title?.kind).toBe('series');
    expect(title?.title).toBe('The Mentalist');
    expect(title?.id).toBe('tt1196946');
  });
});
