export type Lane = 'home' | 'shows' | 'movies' | 'list' | 'new' | 'kids';

export function navTabs(layout: string): Array<{ id: Lane; label: string }> {
  if (layout === 'netflix') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'shows', label: 'TV Shows' },
      { id: 'movies', label: 'Movies' },
      { id: 'new', label: 'New & Popular' },
      { id: 'list', label: 'My List' },
    ];
  }
  if (layout === 'prime') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV' },
      { id: 'new', label: 'New' },
    ];
  }
  if (layout === 'disney') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'Series' },
      { id: 'kids', label: 'Kids' },
    ];
  }
  if (layout === 'hulu') {
    return [
      { id: 'home', label: 'For You' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'Series' },
      { id: 'list', label: 'My Stuff' },
    ];
  }
  if (layout === 'peacock') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV Shows' },
      { id: 'list', label: 'My Stuff' },
    ];
  }
  if (layout === 'appletv') {
    return [
      { id: 'home', label: 'Watch Now' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV Shows' },
    ];
  }
  if (layout === 'max') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'shows', label: 'Series' },
      { id: 'movies', label: 'Movies' },
      { id: 'new', label: 'New & Notable' },
    ];
  }
  return [
    { id: 'home', label: 'Home' },
    { id: 'shows', label: 'Series' },
    { id: 'movies', label: 'Movies' },
  ];
}

export function playLabel(layout: string): string {
  if (layout === 'peacock') return 'Watch Now';
  if (layout === 'hulu') return 'Start Watching';
  return 'Play';
}

export function moreLabel(layout: string): string {
  if (layout === 'appletv') return 'Info';
  if (layout === 'max') return 'Go to Series';
  return 'More Info';
}

export function laneMatches(
  title: { kind: string; year: number; genres: readonly string[] },
  lane: Lane,
): boolean {
  const genres = title.genres.map((genre) => genre.toLowerCase());
  if (lane === 'shows') return title.kind === 'series';
  if (lane === 'movies') return title.kind === 'movie';
  if (lane === 'kids') return genres.some((genre) => /family|animation|kids|children/.test(genre));
  if (lane === 'new') return title.year >= 2020 || title.year === 0;
  return true;
}
