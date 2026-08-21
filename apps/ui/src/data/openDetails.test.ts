import { describe, expect, it } from 'vitest';
import { detailsParams, openPlayback, titleFromDetailsParams } from './openDetails';
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

  it('sends films to the player and series to details', () => {
    const pushed: Array<{ name: string; modal?: boolean; id?: string }> = [];
    const navigate = {
      push: (name: string, options?: { params?: Record<string, unknown> }) => {
        pushed.push({ name, id: typeof options?.params?.['id'] === 'string' ? options.params['id'] : undefined });
      },
      pushModal: (name: string, options?: { params?: Record<string, unknown> }) => {
        pushed.push({
          name,
          modal: true,
          id: typeof options?.params?.['id'] === 'string' ? options.params['id'] : undefined,
        });
      },
    };
    openPlayback(navigate as never, mentalist);
    expect(pushed).toEqual([{ name: 'details', id: 'tt1196946' }]);
    openPlayback(navigate as never, { ...mentalist, id: 'tt0816692', title: 'Dune', kind: 'movie' });
    expect(pushed[1]).toEqual({ name: 'player', modal: true, id: 'tt0816692' });
  });
});
