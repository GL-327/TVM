import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { LoopClone } from '../../../components/LoopClone';
import { Artwork } from '../../../components/Artwork';
import { EmptyState } from '../../../components/EmptyState';
import { FocusButton } from '../../../components/FocusButton';
import { HeroArt } from '../../../components/HeroArt';
import { Rail } from '../../../components/Rail';
import { Skeleton } from '../../../components/Skeleton';
import { preferBackdrop } from '../../../data/artwork';
import { fetchAppHub, type AppHubPayload } from '../../../data/apps';
import { TITLES, titlesByIds, type Title } from '../../../data/catalog';
import {
  addWatchlist,
  asTitle,
  fetchHome,
  fetchWatchlist,
  removeWatchlist,
  toMediaItem,
  type MediaItem,
} from '../../../data/media';
import { openDetails, openPlayback } from '../../../data/openDetails';
import { certificateLabel } from '../../../data/playId';
import { requestFocus } from '../../../nav/focusEngine';
import { revealFocused, rowCameraTop, scrollAxis, shouldNudgePageY } from '../../../nav/revealFocused';
import { useFocusScope, useNavigate, useScopedFocusKey, type Navigate } from '../../../nav/ViewStackContext';
import { wrapFocusId } from '../../../nav/wrapFocus';
import { laneMatches, navTabs, type Lane } from '../layouts';
import './netflix.css';

export type NetflixCatalogBag = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

export interface NetflixHubProps {
  appId?: string;
  hub?: AppHubPayload | null;
  catalog?: readonly Title[] | AppHubPayload | NetflixCatalogBag;
  items?: readonly Title[] | Array<MediaItem | Title>;
  rails?: AppHubPayload['rails'];
  watching?: readonly Title[];
  watchlist?: readonly Title[];
  hero?: Title;
  navigate?: Navigate;
  play?: (title: Title) => void;
  onPlay?: (title: Title) => void;
  onOpen?: (title: Title) => void;
  onBack?: () => void;
  lane?: Lane;
  category?: Lane | string;
  onLane?: (lane: Lane) => void;
}

export type NetflixRow = {
  id: string;
  title: string;
  titles: Title[];
  variant: 'standard' | 'top10';
};

const ORIGINAL_IDS = ['stranger-things', 'wednesday', 'squid-game', 'the-witcher'] as const;

export function netflixTabs(): Array<{ id: Lane; label: string }> {
  return navTabs('netflix');
}

export function laneFromCategory(value: string | undefined): Lane | undefined {
  if (value === 'home' || value === 'shows' || value === 'movies' || value === 'list' || value === 'new' || value === 'kids') {
    return value;
  }
  if (value === 'series' || value === 'tv' || value === 'tvshows') return 'shows';
  if (value === 'mylist' || value === 'my-list') return 'list';
  if (value === 'popular' || value === 'newandpopular') return 'new';
  return undefined;
}

export function uniqueNetflixTitles(titles: readonly Title[]): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const title of titles) {
    const idKey = title.id.trim().toLowerCase();
    const nameKey = title.title.trim().toLowerCase();
    if (idKey !== '' && seen.has(idKey)) continue;
    if (nameKey !== '' && seen.has(nameKey)) continue;
    if (idKey !== '') seen.add(idKey);
    if (nameKey !== '') seen.add(nameKey);
    out.push(title);
  }
  return out;
}

export function isNetflixStub(title: Title): boolean {
  const name = title.title.trim();
  if (name === '') return true;
  return /^tt\d+$/i.test(name) && title.synopsis === '';
}

export function isNetflixPlayable(title: Title): boolean {
  if (title.playable === false) return false;
  return !isNetflixStub(title);
}

export function netflixPlayTarget(title: Title): 'player' | 'details' | 'unavailable' {
  if (!isNetflixPlayable(title)) return 'unavailable';
  return title.kind === 'series' ? 'details' : 'player';
}

export function netflixDisplayTitle(title: Title): string {
  return isNetflixStub(title) ? 'Unavailable' : title.title;
}

export function netflixKicker(title: Title): string {
  return title.kind === 'series' ? 'SERIES' : 'FILM';
}

export function netflixSeasonLabel(title: Title): string {
  if (title.kind === 'series') {
    if (title.seasons === 1) return '1 Season';
    if (title.seasons !== undefined && title.seasons > 0) return `${title.seasons} Seasons`;
    return '';
  }
  return title.runtime ?? '';
}

export function netflixPlayLabel(title: Title): string {
  if (!isNetflixPlayable(title)) return 'Unavailable';
  return title.progress !== undefined ? 'Resume' : 'Play';
}

export function activateNetflixTitle(
  title: Title,
  playFn: (title: Title) => void,
  openFn: (title: Title) => void,
): 'player' | 'details' | 'unavailable' {
  const target = netflixPlayTarget(title);
  if (target === 'player') playFn(title);
  else openFn(title);
  return target;
}

export function inNetflixLane(title: Title, lane: Lane): boolean {
  if (lane === 'list') return true;
  return laneMatches(title, lane);
}

export function isNetflixOriginal(title: Title): boolean {
  if ((ORIGINAL_IDS as readonly string[]).includes(title.id)) return true;
  return /netflix/i.test(title.network ?? '');
}

export function wrapNetflixFocus(direction: string, index: number, ids: readonly string[]): string | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (first === undefined || last === undefined) return null;
  return wrapFocusId(direction, index, ids.length, first, last);
}

/** Left/right along a FocusButton row, including wrap at both ends. */
export function stepNetflixFocus(direction: string, index: number, ids: readonly string[]): string | null {
  if (ids.length < 2) return null;
  if (direction === 'right') return ids[(index + 1) % ids.length] ?? null;
  if (direction === 'left') return ids[index <= 0 ? ids.length - 1 : index - 1] ?? null;
  return null;
}

export function netflixNavIds(tabs: readonly { id: string }[]): string[] {
  return ['service-back', ...tabs.map((tab) => `service-tab-${tab.id}`), 'service-search', 'service-profile'];
}

export function netflixHeroActionIds(): string[] {
  return ['service-play', 'service-info', 'service-watchlist'];
}

export function netflixCardIds(prefix: string, titles: readonly Title[]): string[] {
  return titles.map((title) => `${prefix}-${title.id}`);
}

export function netflixCardId(prefix: string, titleId: string, loopCopy = 1): string {
  return loopCopy !== 1 ? `${prefix}-${titleId}--${loopCopy}` : `${prefix}-${titleId}`;
}

/** Billboard / first row stay at 0. Later rows lock under the sticky nav. */
export function netflixCameraTarget(input: {
  zone: 'top' | 'row';
  scrollTop: number;
  railTop: number;
  viewTop: number;
  navHeight: number;
}): number {
  if (input.zone === 'top') return 0;
  return Math.max(0, rowCameraTop(input.scrollTop, input.railTop, input.viewTop, input.navHeight + 10));
}

let lockedNetflixRail: HTMLElement | null = null;

export function lockNetflixRailCamera(node: HTMLElement): void {
  const scroller = node.closest<HTMLElement>('.nf-hub');
  if (scroller === null) return;
  if (lockedNetflixRail !== null && !lockedNetflixRail.isConnected) lockedNetflixRail = null;

  if (node.closest('.nf-hub__nav, .nf-hub__hero') !== null) {
    lockedNetflixRail = null;
    if (shouldNudgePageY(scroller.scrollTop, 0)) scrollAxis(scroller, 'y', 0);
    return;
  }

  const rail = node.closest<HTMLElement>('.rail');
  if (rail === null) return;

  const view = scroller.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  const nav = scroller.querySelector<HTMLElement>('.nf-hub__nav');
  const navHeight = nav?.getBoundingClientRect().height ?? 72;
  const firstRail = scroller.querySelector<HTMLElement>('.nf-hub__rails > .rail');
  const overHero = firstRail === rail && scroller.querySelector('.nf-hub__hero') !== null;
  const target = netflixCameraTarget({
    zone: overHero ? 'top' : 'row',
    scrollTop: scroller.scrollTop,
    railTop: railBox.top,
    viewTop: view.top,
    navHeight,
  });
  if (lockedNetflixRail === rail && !shouldNudgePageY(scroller.scrollTop, target)) return;
  lockedNetflixRail = rail;
  scrollAxis(scroller, 'y', target);
}

export function netflixRailLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('original')) return 'Netflix Originals';
  if (lower.includes('film')) return 'Popular Movies';
  if (lower.includes('series') || lower.includes('shows')) return 'Popular TV Shows';
  if (lower.includes('because')) return 'Because you watched';
  return title;
}

export function pickNetflixHero(lane: Lane, candidates: readonly Title[]): Title | undefined {
  const ready = candidates.filter((title) => !isNetflixStub(title));
  const matched = ready.filter((title) => inNetflixLane(title, lane === 'list' ? 'home' : lane));
  if (lane === 'list') return ready[0] ?? candidates[0];
  return (
    matched.find((title) => title.backdrop !== '') ??
    matched[0] ??
    ready.find((title) => title.backdrop !== '') ??
    ready[0] ??
    candidates[0]
  );
}

export function toHubTitle(value: MediaItem | Title): Title {
  const next = asTitle({
    id: value.id,
    title: value.title,
    year: typeof value.year === 'number' ? value.year : 0,
    kind: value.kind === 'series' ? 'series' : 'movie',
    synopsis: value.synopsis,
    poster: value.poster,
    backdrop: value.backdrop,
    genres: [...value.genres],
    rating: value.rating,
    runtime: value.runtime,
    playable: !('playable' in value) || value.playable !== false,
    hue: value.hue,
    progress: value.progress,
  });
  return {
    ...next,
    seasons: 'seasons' in value ? value.seasons : next.seasons,
    network: 'network' in value ? value.network : next.network,
    episodeLabel: 'episodeLabel' in value ? value.episodeLabel : next.episodeLabel,
  };
}

export function isNetflixCatalogBag(value: unknown): value is AppHubPayload | NetflixCatalogBag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function titlesFromNetflixCatalog(
  catalog?: readonly Title[] | AppHubPayload | NetflixCatalogBag,
  items?: readonly Title[] | Array<MediaItem | Title>,
): Title[] {
  const extra = (items ?? []).map(toHubTitle);
  if (Array.isArray(catalog)) {
    return uniqueNetflixTitles([...catalog.map(toHubTitle), ...extra]);
  }
  if (isNetflixCatalogBag(catalog)) {
    const bag = catalog;
    const fromHero = bag.hero !== null && bag.hero !== undefined ? [asTitle(bag.hero)] : [];
    const fromWatching = (bag.continueWatching ?? []).map(asTitle);
    const fromRails = (bag.rails ?? []).flatMap((rail) => rail.items.map(asTitle));
    const fromItems = ('items' in bag && bag.items !== undefined ? bag.items : []).map(toHubTitle);
    const fromList = ('watchlist' in bag && bag.watchlist !== undefined ? bag.watchlist : []).map(toHubTitle);
    return uniqueNetflixTitles([...fromHero, ...fromWatching, ...fromRails, ...fromItems, ...fromList, ...extra]);
  }
  return uniqueNetflixTitles(extra);
}

export function netflixFallbackHub(): AppHubPayload {
  const originals = titlesByIds([...ORIGINAL_IDS]);
  const films = TITLES.filter((title) => title.kind === 'movie');
  const shows = TITLES.filter((title) => title.kind === 'series');
  const lead = originals[0] ?? TITLES[0];
  return {
    id: 'netflix',
    name: 'Netflix',
    accent: '#e50914',
    layout: 'netflix',
    wordmark: 'NETFLIX',
    logo: '/apps/netflix.svg',
    disclaimer: 'Not the licensed Netflix app. Playback uses TVM Stream / Real-Debrid.',
    hero: lead === undefined ? null : toMediaItem(lead),
    continueWatching: [],
    rails: [
      { id: 'netflix-series', title: 'Netflix Originals', items: originals.map(toMediaItem) },
      { id: 'netflix-films', title: 'Popular Movies', items: films.slice(0, 16).map(toMediaItem) },
      { id: 'netflix-shows', title: 'Popular TV Shows', items: shows.slice(0, 16).map(toMediaItem) },
      { id: 'netflix-trending', title: 'Trending Now', items: TITLES.slice(0, 16).map(toMediaItem) },
    ],
  };
}

export function buildNetflixRows(input: {
  lane: Lane;
  watching: readonly Title[];
  watchlist: readonly Title[];
  hubRails: ReadonlyArray<{ id: string; title: string; titles: readonly Title[] }>;
  catalog: readonly Title[];
}): NetflixRow[] {
  const { lane, watching, watchlist, hubRails, catalog } = input;
  const rows: NetflixRow[] = [];
  const used = new Set<string>();

  const take = (titles: readonly Title[], limit = 16): Title[] =>
    uniqueNetflixTitles(titles.filter((title) => inNetflixLane(title, lane === 'list' ? 'home' : lane))).slice(0, limit);

  const push = (id: string, title: string, titles: readonly Title[], variant: NetflixRow['variant'] = 'standard'): void => {
    const next = take(titles, variant === 'top10' ? 10 : 16);
    if (next.length === 0 || used.has(id)) return;
    used.add(id);
    rows.push({ id, title, titles: next, variant });
  };

  if (lane === 'list') {
    const mine = uniqueNetflixTitles([...watchlist, ...watching]);
    push('nf-mylist', 'My List', mine, 'standard');
    const saved = new Set(mine.map((title) => title.id));
    push(
      'nf-suggested',
      'Suggested for you',
      catalog.filter((title) => !saved.has(title.id)),
    );
    return rows;
  }

  if (lane !== 'movies') {
    push('nf-continue', 'Continue Watching', watching);
  }
  if (lane === 'home' && watchlist.length > 0) {
    push('nf-list-home', 'My List', watchlist);
  }
  if (lane === 'home' || lane === 'new') {
    push('nf-top10', lane === 'new' ? 'Top 10 Today' : 'Top 10 in Your Region Today', catalog, 'top10');
  }

  for (const rail of hubRails) {
    push(rail.id, netflixRailLabel(rail.title), rail.titles);
  }

  if (lane === 'home') {
    push('nf-originals', 'Netflix Originals', catalog.filter(isNetflixOriginal));
    push('nf-shows', 'TV Shows', catalog.filter((title) => title.kind === 'series'));
    push('nf-movies', 'Movies', catalog.filter((title) => title.kind === 'movie'));
  } else if (lane === 'shows') {
    push('nf-originals', 'Netflix Originals', catalog.filter((title) => title.kind === 'series' && isNetflixOriginal(title)));
    push('nf-shows', 'Popular on Netflix', catalog.filter((title) => title.kind === 'series'));
  } else if (lane === 'movies') {
    push('nf-movies', 'Popular Movies', catalog.filter((title) => title.kind === 'movie'));
    push('nf-new-movies', 'New Movies', catalog.filter((title) => title.kind === 'movie' && (title.year >= 2020 || title.year === 0)));
  } else if (lane === 'new') {
    push('nf-everyone', "Everyone's Watching", catalog);
    push('nf-recent', 'New on Netflix', catalog.filter((title) => title.year >= 2022 || title.year === 0));
  }

  return rows;
}

function bindWrap(scope: string, index: number, ids: readonly string[]) {
  return (direction: string): boolean => {
    const next = stepNetflixFocus(direction, index, ids);
    if (next === null) return true;
    requestFocus(`${scope}/${next}`);
    return false;
  };
}

function NetflixN({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 28 40" aria-hidden="true">
      <path fill="#b20710" d="M0 0h7.4v40H0z" />
      <path fill="#b20710" d="M20.6 0H28v40h-7.4z" />
      <path fill="#e50914" d="M0 0h7.4L28 40h-7.4L0 0z" />
      <path fill="#000" opacity="0.28" d="M7.4 0 28 40h-3.6L7.4 6.4z" />
    </svg>
  );
}

function NetflixWordmark(): React.JSX.Element {
  return (
    <div className="nf-hub__brand" aria-hidden="true">
      <svg className="nf-hub__wordmark" viewBox="0 0 168 28">
        <g fill="#e50914">
          <polygon points="0,0 5.4,0 5.4,28 0,28" />
          <polygon points="15.2,0 20.6,0 20.6,28 15.2,28" />
          <polygon points="0,0 5.4,0 20.6,28 15.2,28" />
          <path d="M24.2 0h13.4v3.9h-8V12h6.8v3.8h-6.8V24h8.2V28H24.2z" />
          <path d="M40.2 0h15.2v3.9h-4.7V28h-5.8V3.9h-4.7z" />
          <path d="M58.2 0h13v3.9h-7.6V12h6.4v3.8h-6.4V28h-5.4z" />
          <path d="M74.4 0h5.4v24.1h8.4V28H74.4z" />
          <path d="M91.4 0h5.4v28h-5.4z" />
          <polygon points="99.6,0 105.4,0 125,28 119.2,28" />
          <polygon points="119.2,0 125,0 105.4,28 99.6,28" />
        </g>
        <polygon fill="#000" opacity="0.28" points="5.4,0 20.6,28 17.6,28 5.4,5.6" />
      </svg>
    </div>
  );
}

function NetflixAvatar(): React.JSX.Element {
  return (
    <svg className="nf-hub__avatar" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#54b9c5" />
      <circle cx="16" cy="13" r="5.1" fill="#14343a" />
      <path d="M5.6 27.2c2.6-6.2 18.8-6.2 21.4 0" fill="#14343a" />
    </svg>
  );
}

function NetflixSearchIcon(): React.JSX.Element {
  return (
    <svg className="nf-hub__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.4" cy="10.4" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.85" />
      <path d="M15 15.1 21 21" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    </svg>
  );
}

function NetflixPlayIcon(): React.JSX.Element {
  return (
    <svg className="nf-hub__play-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.2 3.6v12.8L16.8 10 6.2 3.6z" fill="currentColor" />
    </svg>
  );
}

function NetflixInfoIcon(): React.JSX.Element {
  return (
    <svg className="nf-hub__info-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.4V17M12 7.2h.01" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function NetflixListIcon({ saved }: { saved: boolean }): React.JSX.Element {
  return (
    <svg className="nf-hub__list-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      {saved ? (
        <path d="M8 12.2 10.7 15 16.2 9.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function NetflixBackIcon(): React.JSX.Element {
  return (
    <svg className="nf-hub__back-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.8 5.2 8.2 12l6.6 6.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NetflixCardFace({ title, rank, clone = false }: { title: Title; rank?: number; clone?: boolean }): React.JSX.Element {
  const locked = !isNetflixPlayable(title);
  const original = isNetflixOriginal(title);
  return (
    <>
      {rank !== undefined && <span className="nf-card__num">{rank}</span>}
      <span className="nf-card__frame">
        <Artwork title={title} kind="backdrop" className="poster__art nf-card__art" decorative={clone} />
        {original && !locked && (
          <span className="nf-card__mark" aria-hidden="true">
            <NetflixN className="nf-card__mark-n" />
          </span>
        )}
        {title.progress !== undefined && (
          <span className="poster__progress nf-card__progress" aria-hidden="true">
            <span className="poster__progress-bar" style={{ width: `${Math.round(title.progress * 100)}%` }} />
          </span>
        )}
        {locked && <span className="nf-card__lock">{isNetflixStub(title) ? 'Unavailable' : 'Not playable'}</span>}
        <span className="poster__meta nf-card__meta">
          <span className="poster__title">{netflixDisplayTitle(title)}</span>
          <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
        </span>
      </span>
    </>
  );
}

const NetflixCard = memo(function NetflixCard(props: {
  title: Title;
  prefix: string;
  rank?: number;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  if ((props.loopCopy ?? 1) !== 1) return <NetflixCardClone {...props} />;
  return <NetflixCardLive {...props} />;
});

function NetflixCardClone({
  title,
  prefix,
  rank,
  loopCopy = 0,
  onActivate,
}: {
  title: Title;
  prefix: string;
  rank?: number;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const id = netflixCardId(prefix, title.id, loopCopy);
  const locked = !isNetflixPlayable(title);
  const className = `tvm-button tvm-button--standard poster poster--landscape nf-card${rank !== undefined ? ' nf-card--rank' : ''}${locked ? ' nf-card--locked' : ''}`;
  return (
    <LoopClone className={className} focusId={id} loopCopy={loopCopy} onClick={() => onActivate(title)}>
      <span className="tvm-button__label">
        <NetflixCardFace title={title} rank={rank} clone />
      </span>
    </LoopClone>
  );
}

const NetflixCardLive = memo(function NetflixCardLive({
  title,
  prefix,
  rank,
  onActivate,
  onPreview,
}: {
  title: Title;
  prefix: string;
  rank?: number;
  loopCopy?: number;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  const id = netflixCardId(prefix, title.id, 1);
  const focusKey = useScopedFocusKey(id);
  const locked = !isNetflixPlayable(title);
  const className = `tvm-button tvm-button--standard poster poster--landscape nf-card${rank !== undefined ? ' nf-card--rank' : ''}${locked ? ' nf-card--locked' : ''}`;
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onArrowPress: () => true,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
      onPreview(title);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-copy="1"
      onClick={() => onActivate(title)}
    >
      <span className="tvm-button__label">
        <NetflixCardFace title={title} rank={rank} />
      </span>
    </button>
  );
});

function mapNetflixCards(
  titles: readonly Title[],
  prefix: string,
  onActivate: (title: Title) => void,
  onPreview: (title: Title) => void,
  ranked = false,
): React.JSX.Element[] {
  return titles.map((title, index) => (
    <NetflixCard
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      rank={ranked ? index + 1 : undefined}
      onActivate={onActivate}
      onPreview={onPreview}
    />
  ));
}

const NetflixRowView = memo(function NetflixRowView({
  row,
  onActivate,
  onPreview,
}: {
  row: NetflixRow;
  onActivate: (title: Title) => void;
  onPreview: (title: Title) => void;
}): React.JSX.Element {
  return (
    <Rail id={row.id} title={row.title}>
      {mapNetflixCards(row.titles, row.id, onActivate, onPreview, row.variant === 'top10')}
    </Rail>
  );
});

export function NetflixHub({
  appId = 'netflix',
  hub: hubProp,
  catalog: catalogProp,
  items,
  rails: railsProp,
  watching: watchingProp,
  watchlist: watchlistProp,
  hero: heroProp,
  navigate: navigateProp,
  play,
  onPlay,
  onOpen,
  onBack,
  lane: laneProp,
  category,
  onLane,
}: NetflixHubProps): React.JSX.Element {
  const stackNavigate = useNavigate();
  const navigate = navigateProp ?? stackNavigate;
  const scope = useFocusScope();
  const tabs = netflixTabs();
  const navIds = netflixNavIds(tabs);
  const actionIds = netflixHeroActionIds();
  const incoming = laneFromCategory(laneProp ?? category);
  const catalog = useMemo(() => titlesFromNetflixCatalog(catalogProp, items), [catalogProp, items]);

  const [laneState, setLaneState] = useState<Lane>(incoming ?? 'home');
  const lane = incoming ?? laneState;
  const [fetchedHub, setFetchedHub] = useState<AppHubPayload | null | undefined>(hubProp);
  const [watching, setWatching] = useState<Title[]>(() => [...(watchingProp ?? [])]);
  const [watchlist, setWatchlist] = useState<Title[]>(() => [...(watchlistProp ?? [])]);
  const [preview, setPreview] = useState<Title | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (incoming !== undefined) setLaneState(incoming);
  }, [incoming]);

  useEffect(() => {
    if (hubProp !== undefined) setFetchedHub(hubProp);
  }, [hubProp]);

  useEffect(() => {
    if (watchingProp !== undefined) setWatching([...watchingProp]);
  }, [watchingProp]);

  useEffect(() => {
    if (watchlistProp !== undefined) setWatchlist([...watchlistProp]);
  }, [watchlistProp]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const tasks: Array<Promise<void>> = [];
      if (hubProp === undefined) {
        tasks.push(
          fetchAppHub(appId).then((payload) => {
            if (cancelled) return;
            setFetchedHub(payload);
            if (payload === null) setFailed(true);
          }),
        );
      }
      if (watchlistProp === undefined) {
        tasks.push(
          fetchWatchlist().then((list) => {
            if (!cancelled) setWatchlist(list.map(asTitle));
          }),
        );
      }
      if (watchingProp === undefined) {
        tasks.push(
          fetchHome().then((home) => {
            if (cancelled || home === null) return;
            setWatching(home.continueWatching.map(asTitle));
            if (watchlistProp === undefined && home.watchlist.length > 0) {
              setWatchlist(home.watchlist.map(asTitle));
            }
          }),
        );
      }
      await Promise.all(tasks);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [appId, hubProp, watchingProp, watchlistProp]);

  const hub = hubProp === undefined ? fetchedHub : hubProp;
  const hubWatching = useMemo(() => (hub?.continueWatching ?? []).map(asTitle), [hub]);
  const hubRails = useMemo(() => {
    const source = railsProp ?? hub?.rails ?? [];
    return source.map((rail) => ({
      id: rail.id,
      title: rail.title,
      titles: rail.items.map(asTitle),
    }));
  }, [hub, railsProp]);

  const mergedWatching = useMemo(
    () => uniqueNetflixTitles([...(watchingProp ?? []), ...hubWatching, ...watching]),
    [hubWatching, watching, watchingProp],
  );
  const mergedWatchlist = useMemo(
    () => uniqueNetflixTitles([...(watchlistProp ?? []), ...watchlist]),
    [watchlist, watchlistProp],
  );
  const bagHero =
    isNetflixCatalogBag(catalogProp) && catalogProp.hero !== null && catalogProp.hero !== undefined
      ? asTitle(catalogProp.hero)
      : undefined;
  const hubHero = heroProp ?? (hub?.hero !== null && hub?.hero !== undefined ? asTitle(hub.hero) : bagHero);

  const rows = useMemo(
    () =>
      buildNetflixRows({
        lane,
        watching: mergedWatching,
        watchlist: mergedWatchlist,
        hubRails,
        catalog: uniqueNetflixTitles([
          ...hubRails.flatMap((rail) => rail.titles),
          ...mergedWatching,
          ...mergedWatchlist,
          ...catalog,
          ...(failed || hub === null || catalog.length === 0 ? TITLES : []),
        ]),
      }),
    [catalog, failed, hub, hubRails, lane, mergedWatching, mergedWatchlist],
  );

  const featured = useMemo(
    () =>
      pickNetflixHero(lane, [
        ...(hubHero !== undefined ? [hubHero] : []),
        ...mergedWatching,
        ...mergedWatchlist,
        ...rows.flatMap((row) => row.titles),
        ...catalog,
      ]),
    [catalog, hubHero, lane, mergedWatching, mergedWatchlist, rows],
  );
  const hero =
    preview !== undefined && inNetflixLane(preview, lane === 'list' ? 'home' : lane) ? preview : featured;
  const loading = hub === undefined && featured === undefined;

  const playTitle = useCallback(
    (title: Title): void => {
      if (!isNetflixPlayable(title)) {
        if (onOpen !== undefined) {
          onOpen(title);
          return;
        }
        openDetails(navigate, title);
        return;
      }
      if (play !== undefined) {
        play(title);
        return;
      }
      if (onPlay !== undefined) {
        onPlay(title);
        return;
      }
      openPlayback(navigate, title);
    },
    [navigate, onOpen, onPlay, play],
  );

  const openTitle = useCallback(
    (title: Title): void => {
      if (onOpen !== undefined) {
        onOpen(title);
        return;
      }
      openDetails(navigate, title);
    },
    [navigate, onOpen],
  );

  const onActivate = useCallback(
    (title: Title): void => {
      activateNetflixTitle(title, playTitle, openTitle);
    },
    [openTitle, playTitle],
  );

  const onPreview = useCallback((title: Title): void => {
    setPreview((current) => (current !== undefined && current.id === title.id ? current : title));
  }, []);

  const goBack = useCallback((): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    navigate.home();
  }, [navigate, onBack]);

  const changeLane = (next: Lane): void => {
    if (next === lane) return;
    setPreview(undefined);
    if (incoming === undefined) setLaneState(next);
    onLane?.(next);
    window.setTimeout(() => requestFocus(`${scope}/service-tab-${next}`), 0);
  };

  const saved = hero !== undefined && mergedWatchlist.some((item) => item.id === hero.id || item.title === hero.title);

  const toggleWatchlist = (): void => {
    if (hero === undefined || !isNetflixPlayable(hero)) return;
    if (saved) {
      void removeWatchlist(hero.id).then((list) => setWatchlist(list.map(asTitle)));
      return;
    }
    void addWatchlist(toMediaItem(hero)).then((list) => setWatchlist(list.map(asTitle)));
  };

  const cert = hero === undefined ? null : certificateLabel(hero.rating);
  const run = hero === undefined ? '' : netflixSeasonLabel(hero);
  const playText = hero === undefined ? 'Play' : netflixPlayLabel(hero);
  const kicker = hero === undefined ? '' : netflixKicker(hero);

  return (
    <main
      className={`service service--netflix nf-hub${lane === 'list' ? ' nf-hub--list' : ''}`}
      aria-label="Netflix"
      onFocusCapture={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.getAttribute('data-focus-id') === null) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => lockNetflixRailCamera(target));
        });
      }}
    >
      <nav className="service-nav nf-hub__nav" aria-label="Netflix" data-wrap="row">
        <FocusButton id="service-back" className="nf-hub__back" onSelect={goBack} onArrowPress={bindWrap(scope, 0, navIds)}>
          <NetflixBackIcon />
          <span className="nf-hub__vh">Back</span>
        </FocusButton>
        <NetflixWordmark />
        {tabs.map((tab, index) => (
          <FocusButton
            key={tab.id}
            id={`service-tab-${tab.id}`}
            className={`service-nav__tab nf-hub__tab${lane === tab.id ? ' service-nav__tab--on nf-hub__tab--on' : ''}`}
            onSelect={() => changeLane(tab.id)}
            onArrowPress={bindWrap(scope, index + 1, navIds)}
          >
            {tab.label}
          </FocusButton>
        ))}
        <FocusButton
          id="service-search"
          className="nf-hub__icon nf-hub__icon--search"
          onSelect={() => navigate.pushModal('search')}
          onArrowPress={bindWrap(scope, navIds.length - 2, navIds)}
        >
          <NetflixSearchIcon />
          <span className="nf-hub__vh">Search</span>
        </FocusButton>
        <FocusButton
          id="service-profile"
          className="nf-hub__icon nf-hub__icon--avatar"
          onSelect={() => navigate.push('profiles')}
          onArrowPress={bindWrap(scope, navIds.length - 1, navIds)}
        >
          <NetflixAvatar />
          <span className="nf-hub__vh">Profile</span>
        </FocusButton>
      </nav>

      {loading && <Skeleton className="nf-hub__skeleton" />}

      {failed && featured === undefined && (
        <EmptyState
          eyebrow="Netflix"
          title="This app could not load"
          body="TVM could not reach the local catalog for Netflix."
          actions={
            <FocusButton id="close" onSelect={goBack}>
              Back
            </FocusButton>
          }
        />
      )}

      {hero !== undefined && lane !== 'list' && (
        <section className="service-hero nf-hub__hero">
          <HeroArt src={preferBackdrop(hero.id, hero.backdrop, hero.poster)} hue={hero.hue} />
          <div className="service-hero__veil nf-hub__veil" aria-hidden="true" />
          <div className="nf-hub__copy" key={hero.id}>
            <p className="nf-hub__kicker">
              <NetflixN className="nf-hub__kicker-n" />
              <span>{kicker}</span>
            </p>
            <h1 className="nf-hub__title">{netflixDisplayTitle(hero)}</h1>
            <p className="nf-hub__meta">
              {hero.year > 0 && <span>{hero.year}</span>}
              {cert !== null && <span className="nf-hub__cert">{cert}</span>}
              {run !== '' && <span>{run}</span>}
              <span className="nf-hub__badge">HD</span>
              {hero.genres[0] !== undefined && <span>{hero.genres[0]}</span>}
            </p>
            {hero.synopsis !== '' && <p className="nf-hub__syn">{hero.synopsis}</p>}
            {!isNetflixPlayable(hero) && (
              <p className="nf-hub__warn">This title is not ready in TVM Stream yet. Open details for more.</p>
            )}
            <div className="service-hero__actions nf-hub__actions" data-wrap="row">
              <FocusButton
                id="service-play"
                variant="primary"
                className="nf-hub__play"
                onSelect={() => playTitle(hero)}
                onArrowPress={bindWrap(scope, 0, actionIds)}
              >
                <NetflixPlayIcon />
                {playText}
              </FocusButton>
              <FocusButton
                id="service-info"
                className="nf-hub__more"
                onSelect={() => openTitle(hero)}
                onArrowPress={bindWrap(scope, 1, actionIds)}
              >
                <NetflixInfoIcon />
                More Info
              </FocusButton>
              <FocusButton
                id="service-watchlist"
                className="nf-hub__more nf-hub__listbtn"
                onSelect={toggleWatchlist}
                onArrowPress={bindWrap(scope, 2, actionIds)}
              >
                <NetflixListIcon saved={saved} />
                My List
              </FocusButton>
            </div>
          </div>
        </section>
      )}

      {lane === 'list' && (
        <header className="nf-hub__listhead">
          <h1 className="nf-hub__listtitle">My List</h1>
          <p className="nf-hub__listlede">
            {mergedWatchlist.length > 0
              ? 'Titles you save from details stay on this device.'
              : 'Add a title from More Info. Suggested rows below still play through TVM Stream.'}
          </p>
        </header>
      )}

      <div className="service-rails nf-hub__rails">
        {rows.map((rail) => (
          <NetflixRowView key={rail.id} row={rail} onActivate={onActivate} onPreview={onPreview} />
        ))}
        {rows.length === 0 && !loading && (
          <p className="nf-hub__empty">Nothing in this category yet. Titles still play through TVM Stream.</p>
        )}
      </div>
      {hub?.disclaimer !== undefined && hub.disclaimer !== '' && <p className="nf-hub__note">{hub.disclaimer}</p>}
    </main>
  );
}
