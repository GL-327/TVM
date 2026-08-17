export type Lane = 'home' | 'shows' | 'movies' | 'list';

export function navTabs(layout: string): Array<{ id: Lane; label: string }> {
  if (layout === 'netflix') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'shows', label: 'TV Shows' },
      { id: 'movies', label: 'Movies' },
      { id: 'list', label: 'My List' },
    ];
  }
  if (layout === 'prime') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV' },
    ];
  }
  if (layout === 'disney') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'Series' },
    ];
  }
  if (layout === 'hulu') {
    return [
      { id: 'home', label: 'For You' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'Series' },
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
    ];
  }
  return [
    { id: 'home', label: 'Home' },
    { id: 'shows', label: 'Series' },
    { id: 'movies', label: 'Movies' },
  ];
}

export function playLabel(layout: string): string {
  if (layout === 'prime') return 'Play';
  if (layout === 'max') return 'Go to Series';
  if (layout === 'peacock') return 'Watch Now';
  if (layout === 'hulu') return 'Start Watching';
  return 'Play';
}

export function moreLabel(layout: string): string {
  return layout === 'appletv' ? 'Info' : 'More Info';
}
