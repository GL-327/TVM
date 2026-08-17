export const SERVICE_HOST_SUFFIXES = [
  'netflix.com',
  'primevideo.com',
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.co.jp',
  'disneyplus.com',
  'disney.com',
  'max.com',
  'play.max.com',
  'hbomax.com',
  'youtube.com',
  'youtu.be',
  'google.com',
  'bbc.co.uk',
  'bbc.com',
  'tv.apple.com',
  'apple.com',
  'hulu.com',
  'peacocktv.com',
  'paramountplus.com',
  'tubitv.com',
  'pluto.tv',
  'starz.com',
  'fox.com',
  'imdb.com',
  'seriesgraph.com',
] as const;

export function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isAllowedServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hostAllowed(parsed.hostname);
  } catch {
    return false;
  }
}
