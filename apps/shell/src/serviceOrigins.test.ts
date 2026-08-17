import { describe, expect, it } from 'vitest';
import { isAllowedServiceUrl } from './serviceOrigins';

describe('service allow-list', () => {
  it('accepts official https origins and their login hosts', () => {
    expect(isAllowedServiceUrl('https://www.netflix.com/browse')).toBe(true);
    expect(isAllowedServiceUrl('https://www.bbc.co.uk/iplayer')).toBe(true);
    expect(isAllowedServiceUrl('https://accounts.google.com/ServiceLogin')).toBe(true);
    expect(isAllowedServiceUrl('https://tv.apple.com/')).toBe(true);
    expect(isAllowedServiceUrl('https://www.hulu.com/search?q=Reacher')).toBe(true);
    expect(isAllowedServiceUrl('https://www.peacocktv.com/watch/search?q=Bel-Air')).toBe(true);
    expect(isAllowedServiceUrl('https://www.paramountplus.com/search/?q=Discovery')).toBe(true);
    expect(isAllowedServiceUrl('https://www.imdb.com/title/tt0111161/')).toBe(true);
    expect(isAllowedServiceUrl('https://seriesgraph.com/')).toBe(true);
  });

  it('rejects anything that is not an official https service', () => {
    expect(isAllowedServiceUrl('http://www.netflix.com/')).toBe(false);
    expect(isAllowedServiceUrl('https://evil.example/netflix.com')).toBe(false);
    expect(isAllowedServiceUrl('javascript:alert(1)')).toBe(false);
  });
});
