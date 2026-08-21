import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { artworkCachePath } from '../update/paths.ts';
import { artworkFor, type ArtworkUrls } from './artwork.ts';
import { createCatalogService, dedupeItems, GENRE_RAILS, seriesGenresForRail, type CatalogService } from './cinemeta.ts';
import { clearCacheDir, factoryResetDir } from './maintenance.ts';
import { createProfileService, MAX_PROFILES, type ProfileRegistry, type ProfileService } from './profiles.ts';
import { pickContinueWatching, ratio, readProgress, resumePosition, writeProgress } from './progress.ts';
import type { RdDownload, RdTorrent, RealDebrid } from './realdebrid.ts';
import type { StreamerService } from './streamer.ts';
import { becauseYouWatched, interleaveUnused, pickYouMightLike, takeUnused } from './recommend.ts';
import {
  episodeLabel,
  hueFor,
  isDisplayTitle,
  isHttpUrl,
  isPlayableFile,
  looksLikePack,
  parseEpisode,
  parseEpisodeTitle,
  parseFilename,
  parseSeason,
  titlesMatch,
} from './title.ts';
import {
  extractImdb,
  fetchTorrentioStreams,
  isTorrentioHost,
  needsUnrestrict,
  parsePlayId,
  parseSeasonEpisode,
  PLAYABLE_STREAM_LIMIT,
  capStreamsToHeight,
  rankDebridStreams,
  resolveTorrentioUrl,
} from './torrentio.ts';
import type { CatalogRail, HomePayload, MediaItem, PlaybackResolution, RdStatus } from './types.ts';
import { addWatchlist, readWatchlist, removeWatchlist, type WatchlistItem } from './watchlist.ts';

export interface MediaService {
  configured(): boolean;
  status(): Promise<RdStatus>;
  setToken(token: string): Promise<RdStatus>;
  home(): Promise<HomePayload>;
  library(): Promise<MediaItem[]>;
  item(id: string): Promise<MediaItem | null>;
  children(id: string): Promise<MediaItem[]>;
  search(query: string): Promise<MediaItem[]>;
  play(input: {
    id?: string;
    link?: string;
    title?: string;
    season?: number;
    episode?: number;
  }): Promise<PlaybackResolution>;
  saveProgress(id: string, position: number, duration: number): void;
  watchlist(): WatchlistItem[];
  addToWatchlist(item: unknown): WatchlistItem[];
  removeFromWatchlist(id: string): WatchlistItem[];
  profiles(): ProfileRegistry;
  createProfile(name: string): ProfileRegistry;
  renameProfile(id: string, name: string): ProfileRegistry;
  removeProfile(id: string): ProfileRegistry;
  switchProfile(id: string): ProfileRegistry;
  clearCache(): void;
  factoryReset(): void;
}

export interface MediaServiceOptions {
  dataDir: string;
  rd: RealDebrid;
  streamer?: StreamerService;
  fetch?: typeof fetch;
  plan?: () => { id: string; maxHeight: number; profilesMax: number };
  poolToken?: () => string | null;
}

const artCache = new Map<string, ArtworkUrls>();

function loadArtDisk(dataDir: string): void {
  if (artCache.size > 0) return;
  try {
    const raw = JSON.parse(readFileSync(artworkCachePath(dataDir), 'utf8')) as Record<string, ArtworkUrls>;
    for (const [title, art] of Object.entries(raw)) {
      if (art.poster !== '' || art.backdrop !== '') artCache.set(title, art);
    }
  } catch {
    // First run, or a corrupt cache — look artwork up again.
  }
}

function saveArtDisk(dataDir: string): void {
  try {
    const path = artworkCachePath(dataDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(Object.fromEntries(artCache)), 'utf8');
  } catch {
    // Artwork is optional; a failed write must not break Home.
  }
}

async function decorate(item: MediaItem, fetchImpl: typeof fetch, dataDir: string): Promise<MediaItem> {
  const cached = artCache.get(item.title);
  if (cached !== undefined) return { ...item, ...cached };
  const art = await artworkFor(item.title, fetchImpl);
  if (art === null) return item;
  artCache.set(item.title, art);
  saveArtDisk(dataDir);
  return { ...item, ...art };
}

async function mapPool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index] as T);
      }
    }),
  );
  return out;
}

function itemFromName(
  id: string,
  filename: string,
  progress: ReturnType<typeof readProgress>,
  mimeType?: string,
): MediaItem | null {
  if (!isPlayableFile(filename, mimeType)) return null;
  const parsed = parseFilename(filename);
  const episode = parseEpisode(filename);
  const episodeName = parseEpisodeTitle(filename);
  return {
    id,
    title: parsed.title,
    year: parsed.year,
    kind: episode !== null ? 'series' : 'file',
    synopsis: filename,
    poster: '',
    backdrop: '',
    genres: ['Your files'],
    rating: '',
    playable: true,
    progress: ratio(progress[id]),
    filename,
    hue: hueFor(parsed.title),
    mimeType,
    showTitle: parsed.title,
    ...(episode !== null ? { season: episode.season, episode: episode.episode } : {}),
    ...(episodeName !== null ? { episodeName } : {}),
  };
}

function fromDownload(download: RdDownload, progress: ReturnType<typeof readProgress>): MediaItem | null {
  return itemFromName(`rd:d:${download.id}`, download.filename, progress, download.mimeType);
}

function fromTorrent(torrent: RdTorrent, progress: ReturnType<typeof readProgress>): MediaItem | null {
  const links = torrent.links ?? [];
  const ready = torrent.status === 'downloaded' || torrent.progress === 100;
  if (!ready || links.length === 0) return null;
  const item = itemFromName(`rd:t:${torrent.id}:0`, torrent.filename, progress);
  if (item === null) return null;
  if (looksLikePack(item.title, torrent.filename) || links.length > 1) {
    return {
      ...item,
      kind: 'series',
      season: undefined,
      episode: undefined,
      episodeName: undefined,
    };
  }
  return item;
}

export function torrentIdFrom(id: string): string | null {
  if (!id.startsWith('rd:t:')) return null;
  const rest = id.slice('rd:t:'.length);
  const cut = rest.lastIndexOf(':');
  if (cut === -1) return rest === '' ? null : rest;
  const maybeIndex = rest.slice(cut + 1);
  return /^\d+$/.test(maybeIndex) ? rest.slice(0, cut) : rest;
}

export function torrentIndexFrom(id: string): number {
  if (!id.startsWith('rd:t:')) return 0;
  const rest = id.slice('rd:t:'.length);
  const cut = rest.lastIndexOf(':');
  if (cut === -1) return 0;
  const maybeIndex = rest.slice(cut + 1);
  return /^\d+$/.test(maybeIndex) ? Number(maybeIndex) : 0;
}

function sortByEpisode(items: readonly MediaItem[]): MediaItem[] {
  return [...items].sort((left, right) => {
    const season = (left.season ?? 99) - (right.season ?? 99);
    if (season !== 0) return season;
    return (left.episode ?? 99) - (right.episode ?? 99);
  });
}

function itemMatchesTitle(item: MediaItem, title: string): boolean {
  return [item.title, item.showTitle ?? '', item.filename ?? ''].some(
    (name) => name !== '' && titlesMatch(title, name),
  );
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

const LIBRARY_TTL_MS = 45_000;
const STATUS_TTL_MS = 20_000;

function applyProgress(items: readonly MediaItem[], progress: ReturnType<typeof readProgress>): MediaItem[] {
  return items.map((item) => {
    const direct = ratio(progress[item.id]);
    if (direct !== undefined) return { ...item, progress: direct };
    let best: number | undefined;
    for (const [key, entry] of Object.entries(progress)) {
      if (key !== item.id && !key.startsWith(`${item.id}:`)) continue;
      const value = ratio(entry);
      if (value !== undefined && (best === undefined || value > best)) best = value;
    }
    return best !== undefined ? { ...item, progress: best } : item;
  });
}

function markUsed(used: Set<string>, items: readonly MediaItem[]): void {
  for (const item of items) {
    used.add(item.id);
    used.add(item.title);
  }
}

export function createMediaService(options: MediaServiceOptions): MediaService {
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir, rd } = options;
  let profiles: ProfileService = createProfileService(dataDir);
  const catalog: CatalogService = createCatalogService({ dataDir, fetch: fetchImpl });
  const scope = (): string => profiles.scope();
  let libraryCache: { at: number; torrents: RdTorrent[]; downloads: RdDownload[]; items: MediaItem[] } | null = null;
  let statusCache: { at: number; value: RdStatus } | null = null;

  const loadLibrary = async (force = false): Promise<MediaItem[]> => {
    if (!rd.configured()) return [];
    if (!force && libraryCache !== null && Date.now() - libraryCache.at < LIBRARY_TTL_MS) {
      return libraryCache.items;
    }
    const progress = readProgress(scope());
    const [downloadResult, torrentResult] = await Promise.allSettled([rd.downloads(), rd.torrents()]);
    const downloads = downloadResult.status === 'fulfilled' ? downloadResult.value : [];
    const torrents = torrentResult.status === 'fulfilled' ? torrentResult.value : [];
    if (downloadResult.status === 'rejected' && torrentResult.status === 'rejected') {
      if (libraryCache !== null) return libraryCache.items;
      throw downloadResult.reason;
    }
    const fromDownloads = downloads
      .map((download) => fromDownload(download, progress))
      .filter((item): item is MediaItem => item !== null);
    const fromTorrents = torrents
      .map((torrent) => fromTorrent(torrent, progress))
      .filter((item): item is MediaItem => item !== null);
    const items = [...fromTorrents, ...fromDownloads];
    console.log(`tvm-core: rd library torrents=${torrents.length} downloads=${downloads.length} playable=${items.length}`);
    loadArtDisk(dataDir);
    const eager = items.slice(0, 24);
    const rest = items.slice(24);
    const decoratedEager = await mapPool(eager, 6, (item) => decorate(item, fetchImpl, dataDir));
    const next = [...decoratedEager, ...rest];
    libraryCache = { at: Date.now(), torrents, downloads, items: next };
    if (rest.length > 0) {
      void mapPool(rest, 4, (item) => decorate(item, fetchImpl, dataDir)).then((decoratedRest) => {
        if (libraryCache === null) return;
        libraryCache.items = [...decoratedEager, ...decoratedRest];
      });
    }
    return next;
  };

  const cachedStatus = async (): Promise<RdStatus> => {
    if (statusCache !== null && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
    const value = await rd.status();
    statusCache = { at: Date.now(), value };
    return value;
  };

  const probePlaybackAuth = async (): Promise<PlaybackResolution | null> => {
    if (!rd.configured()) return { kind: 'unavailable', reason: 'not-configured' };
    statusCache = null;
    const status = await rd.status();
    statusCache = { at: Date.now(), value: status };
    if (status.error === 'needs-auth') return { kind: 'unavailable', reason: 'needs-auth' };
    if (status.error === null && !status.premium) return { kind: 'unavailable', reason: 'needs-auth' };
    return null;
  };

    const loadChildren = async (id: string): Promise<MediaItem[]> => {
      const torrentId = torrentIdFrom(id);
      if (torrentId === null || !rd.configured()) return [];
      const progress = readProgress(scope());
      try {
        const info = await rd.torrentInfo(torrentId);
        const selected = info.files.filter((file) => file.selected === 1);
        const fromFiles = selected
          .map((file, index) => {
            const name = fileNameFromPath(file.path);
            const item = itemFromName(`rd:t:${torrentId}:${index}`, name, progress);
            if (item === null) return null;
            if (item.season !== undefined && item.episode !== undefined) return item;
            const season = parseSeason(name) ?? parseSeason(info.filename);
            if (season === null && selected.length < 2) return item;
            return { ...item, kind: 'series' as const, season: season ?? 1, episode: item.episode ?? index + 1 };
          })
          .filter((item): item is MediaItem => item !== null);
        const listed =
          fromFiles.length > 0
            ? fromFiles
            : (info.links ?? [])
                .map((_, index) => itemFromName(`rd:t:${torrentId}:${index}`, `${info.filename} · ${index + 1}`, progress))
                .filter((item): item is MediaItem => item !== null);
        loadArtDisk(dataDir);
        return mapPool(listed, 4, (item) => decorate(item, fetchImpl, dataDir));
      } catch {
        return [];
      }
    };

    const resolveOwnedLink = async (id: string): Promise<string | null> => {
    await loadLibrary();
    const torrents = libraryCache?.torrents ?? [];
    const downloads = libraryCache?.downloads ?? [];
    if (id.startsWith('rd:t:')) {
      const torrentId = torrentIdFrom(id);
      const index = torrentIndexFrom(id);
      if (torrentId !== null && rd.configured()) {
        try {
          const info = await rd.torrentInfo(torrentId);
          const link = info.links?.[index];
          if (link !== undefined && link !== '') return link;
        } catch {
          // Fall back to the cached torrent list if info is unavailable.
        }
      }
      const torrent = torrents.find((entry) => entry.id === torrentId);
      const link = torrent?.links?.[index];
      return link !== undefined && link !== '' ? link : null;
    }

    const downloadId = id.startsWith('rd:d:') ? id.slice(5) : id.startsWith('rd:') ? id.slice(3) : '';
    if (downloadId === '') return null;
    return downloads.find((download) => download.id === downloadId)?.link ?? null;
  };

  const pickEpisode = (
    items: readonly MediaItem[],
    season?: number,
    episode?: number,
  ): MediaItem | undefined => {
    const playable = items.filter((item) => item.playable);
    if (season !== undefined && episode !== undefined) {
      const exact = playable.find((item) => item.season === season && item.episode === episode);
      if (exact !== undefined) return exact;
    }
    return sortByEpisode(playable.filter((item) => item.season !== undefined))[0] ?? playable[0];
  };

  const findLibraryPlayback = async (
    title: string,
    season?: number,
    episode?: number,
  ): Promise<string | null> => {
    const library = await loadLibrary();
    const matches = library.filter((item) => itemMatchesTitle(item, title));
    if (matches.length === 0) return null;

    const direct = pickEpisode(
      matches.filter((item) => !looksLikePack(item.title, item.filename ?? '')),
      season,
      episode,
    );
    if (direct !== undefined && (direct.season !== undefined || !looksLikePack(direct.title, direct.filename ?? ''))) {
      return direct.id;
    }

    const packs = matches.filter((item) => item.id.startsWith('rd:t:')).slice(0, 8);
    for (const pack of packs) {
      const kids = await loadChildren(pack.id);
      const picked = pickEpisode(kids, season, episode);
      if (picked !== undefined) return picked.id;
    }

    return matches.find((item) => item.playable)?.id ?? null;
  };

  /**
   * From a raw file URL to a guaranteed-playable stream. ffprobe decides
   * direct / remux / transcode; nothing is guessed from filenames, and the
   * player never sees an upstream URL (Range proxy or local HLS only).
   */
  const resolveFileStream = async (
    downloadUrl: string,
    filename: string,
    title: string,
    startAt: number | undefined,
  ): Promise<PlaybackResolution> => {
    const streamer = options.streamer;
    if (streamer === undefined) {
      const mime = /\.webm(\?|$)/i.test(filename) ? 'video/webm' : 'video/mp4';
      return {
        kind: 'stream', url: downloadUrl, title, filename, mimeType: mime, engine: 'html5', transport: 'file',
        ...(startAt !== undefined ? { startAt } : {}),
      };
    }
    const maxHeight = options.plan?.().maxHeight ?? 2160;
    const resolved = await streamer.resolveFile(downloadUrl, { maxHeight, filename, ...(startAt !== undefined ? { startAt } : {}) });
    if (resolved === null) return { kind: 'unavailable', reason: 'unsupported' };
    console.log(`tvm-core: play transport=${resolved.transport} mime=${resolved.mimeType} file=${filename}`);
    return {
      kind: 'stream',
      url: resolved.url,
      title,
      filename,
      mimeType: resolved.mimeType,
      engine: 'html5',
      transport: resolved.transport,
      ...(resolved.sessionId !== undefined ? { sessionId: resolved.sessionId } : {}),
      ...(resolved.timeOffset !== undefined ? { timeOffset: resolved.timeOffset } : {}),
      ...(resolved.durationSeconds !== undefined && resolved.durationSeconds > 0
        ? { durationSeconds: resolved.durationSeconds }
        : {}),
      ...(startAt !== undefined ? { startAt } : {}),
    };
  };

  const playFromLink = async (link: string, mediaId?: string): Promise<PlaybackResolution> => {
    if (!isHttpUrl(link)) return { kind: 'unavailable', reason: 'unsupported' };
    try {
      const startAt = mediaId === undefined ? undefined : resumePosition(readProgress(scope())[mediaId]);
      if (!needsUnrestrict(link)) {
        const filename = link.split('/').pop()?.split('?')[0] ?? 'stream';
        if (/\.m3u8(\?|$)/i.test(link)) {
          return {
            kind: 'stream',
            url: link,
            title: parseFilename(filename).title,
            filename,
            mimeType: 'application/vnd.apple.mpegurl',
            engine: 'html5',
            transport: 'hls',
            ...(startAt !== undefined ? { startAt } : {}),
          };
        }
        return resolveFileStream(link, filename, parseFilename(filename).title, startAt);
      }
      const unrestricted = await rd.unrestrict(link);
      if (unrestricted.download === undefined || unrestricted.download === '') {
        return { kind: 'unavailable', reason: 'unsupported' };
      }
      const parsed = parseFilename(unrestricted.filename);
      const episode = parseEpisode(unrestricted.filename);
      const title =
        episode !== null ? `${parsed.title} · ${episodeLabel(episode.season, episode.episode)}` : parsed.title;
      return await resolveFileStream(unrestricted.download, unrestricted.filename, title, startAt);
    } catch (error) {
      if (error instanceof Error && error.name === 'RdAuth') return { kind: 'unavailable', reason: 'needs-auth' };
      return { kind: 'unavailable', reason: 'unsupported' };
    }
  };

  const playFromTorrentio = async (
    imdb: string,
    season?: number,
    episode?: number,
    mediaId?: string,
  ): Promise<PlaybackResolution> => {
    try {
      const personal = rd.tokenValue();
      const pooled = options.plan?.().id === 'free' ? options.poolToken?.() ?? null : null;
      const token = personal ?? pooled;
      if (token === null) return { kind: 'unavailable', reason: 'not-configured' };
      let seasonNo = season;
      let episodeNo = episode;
      if (seasonNo === undefined || episodeNo === undefined) {
        const meta = await catalog.meta(imdb);
        if (meta?.item.kind === 'series') {
          const first = meta.children[0];
          seasonNo = seasonNo ?? first?.season;
          episodeNo = episodeNo ?? first?.episode;
        }
      }
      const streams = await fetchTorrentioStreams(token, imdb, seasonNo, episodeNo, fetchImpl);
      if (streams.length === 0) return { kind: 'unavailable', reason: 'empty' };
      const height = options.plan?.().maxHeight ?? 2160;
      const ranked = capStreamsToHeight(rankDebridStreams(streams), height).slice(0, PLAYABLE_STREAM_LIMIT);
      if (ranked.length === 0) return { kind: 'unavailable', reason: 'empty' };
      const id =
        mediaId ?? (seasonNo !== undefined && episodeNo !== undefined ? `${imdb}:${seasonNo}:${episodeNo}` : imdb);
      let last: PlaybackResolution = { kind: 'unavailable', reason: 'empty' };
      for (const stream of ranked) {
        const resolved = await resolveTorrentioUrl(stream.url, fetchImpl);
        if (resolved === null || isTorrentioHost(resolved)) continue;
        const result = await playFromLink(resolved, id);
        if (result.kind === 'stream') return result;
        last = result;
        if (result.reason === 'needs-auth') return result;
      }
      return last;
    } catch {
      return { kind: 'unavailable', reason: 'empty' };
    }
  };

  const buildRails = async (watching: MediaItem[], watchlist: MediaItem[]): Promise<CatalogRail[]> => {
    let bundle;
    try {
      bundle = await catalog.bundle();
    } catch {
      return [];
    }
    const used = new Set<string>();
    markUsed(used, watching);
    markUsed(used, watchlist);
    const history = [...watchlist, ...watching];
    const rails: CatalogRail[] = [];
    const forYou = pickYouMightLike(bundle.catalog, history, used, 16);
    markUsed(used, forYou);
    if (forYou.length > 0) rails.push({ id: 'for-you', title: 'You might like', items: forYou });

    const films = takeUnused(bundle.moviesTop, used, 16);
    if (films.length > 0) rails.push({ id: 'films', title: 'Popular films', items: films });
    const series = takeUnused(bundle.seriesTop, used, 16);
    if (series.length > 0) rails.push({ id: 'series', title: 'Popular series', items: series });
    const fresh = takeUnused(bundle.newFilms, used, 16);
    if (fresh.length > 0) rails.push({ id: 'new-films', title: 'New films', items: fresh });
    const recent = takeUnused(bundle.recentTv, used, 16);
    if (recent.length > 0) rails.push({ id: 'new-series', title: 'Recently updated', items: recent });

    const because = becauseYouWatched(watching[0], bundle.catalog, used, 12);
    markUsed(used, because);
    if (because.length > 0 && watching[0] !== undefined) {
      rails.push({ id: 'because', title: `Because you watched ${watching[0].title}`, items: because });
    }

    const genreLists = await Promise.all(
      GENRE_RAILS.map(async (rail) => {
        const seriesGenres = seriesGenresForRail(rail.genre);
        const [movies, ...showLists] = await Promise.all([
          catalog.genre('movie', rail.genre),
          ...seriesGenres.map((genre) => catalog.genre('series', genre)),
        ]);
        return { rail, movies, shows: dedupeItems(showLists.flat()) };
      }),
    );
    for (const { rail, movies, shows } of genreLists) {
      const picked = interleaveUnused(movies, shows, used, 16);
      if (picked.length > 0) rails.push({ id: rail.id, title: rail.title, items: picked });
    }
    return rails;
  };

  return {
    configured: () => rd.configured(),
    status: () => cachedStatus(),
    async setToken(token) {
      libraryCache = null;
      statusCache = null;
      return rd.setToken(token);
    },

    async home(): Promise<HomePayload> {
      const status = await cachedStatus();
      let library: MediaItem[] = [];
      let error = status.error;
      try {
        library = await loadLibrary();
      } catch (caught) {
        error = caught instanceof Error && caught.name === 'RdAuth' ? 'needs-auth' : 'unreachable';
        library = libraryCache?.items ?? [];
      }
      const progress = readProgress(scope());
      let catalogItems: MediaItem[] = [];
      try {
        catalogItems = applyProgress((await catalog.bundle()).catalog, progress);
      } catch {
        catalogItems = [];
      }
      const continueWatching = pickContinueWatching(
        [...catalogItems, ...applyProgress(library, progress)],
        progress,
      );
      const watchlist = readWatchlist(scope());
      const rails = await buildRails(continueWatching, watchlist);
      const featured =
        continueWatching[0] ??
        rails.find((rail) => rail.id === 'new-films')?.items[0] ??
        rails.find((rail) => rail.id === 'films')?.items[0] ??
        catalogItems[0] ??
        library.find((item) => isDisplayTitle(item.title) && (item.backdrop !== '' || item.poster !== '')) ??
        library[0] ??
        null;
      return {
        rd: { ...status, error },
        featured,
        library: library.slice(0, 400),
        continueWatching,
        watchlist,
        fileCount: library.length,
        rails,
      };
    },

    library: () => loadLibrary(),

    async item(id: string): Promise<MediaItem | null> {
      const parsed = parsePlayId(id);
      if (parsed !== null) {
        const meta = await catalog.meta(parsed.imdb);
        if (meta !== null) {
          if (parsed.season !== undefined && parsed.episode !== undefined) {
            return (
              meta.children.find((entry) => entry.season === parsed.season && entry.episode === parsed.episode) ??
              meta.item
            );
          }
          return meta.item;
        }
      }
      const library = await loadLibrary();
      const found = library.find((entry) => entry.id === id);
      if (found !== undefined) return found;
      const children = await loadChildren(id);
      return children.find((entry) => entry.id === id) ?? null;
    },

    async children(id: string): Promise<MediaItem[]> {
      const parsed = parsePlayId(id);
      if (parsed !== null) {
        const meta = await catalog.meta(parsed.imdb);
        if (meta !== null) return meta.children;
      }
      return loadChildren(id);
    },

    watchlist: () => readWatchlist(scope()),
    addToWatchlist: (item) => addWatchlist(scope(), item),
    removeFromWatchlist: (id) => removeWatchlist(scope(), id),
    profiles: () => profiles.list(),
    createProfile: (name) => profiles.create(name, options.plan?.().profilesMax ?? MAX_PROFILES),
    renameProfile: (id, name) => profiles.rename(id, name),
    removeProfile: (id) => profiles.remove(id),
    switchProfile: (id) => profiles.switchTo(id),

    async search(query: string): Promise<MediaItem[]> {
      const needle = query.trim();
      if (needle === '') return [];
      try {
        return await catalog.search(needle);
      } catch {
        return [];
      }
    },

    async play(input: {
      id?: string;
      link?: string;
      title?: string;
      season?: number;
      episode?: number;
    }): Promise<PlaybackResolution> {
      try {
        const blocked = await probePlaybackAuth();
        if (blocked !== null) return blocked;

        let mediaId = input.id;
        let link = input.link?.trim() ?? '';
        if (link !== '') return playFromLink(link, mediaId);

        if (mediaId !== undefined && mediaId.startsWith('rd:')) {
          const owned = await resolveOwnedLink(mediaId);
          if (owned !== null) return playFromLink(owned, mediaId);
        }

        const parsed = mediaId !== undefined ? parsePlayId(mediaId) : null;
        if (parsed !== null) {
          return playFromTorrentio(
            parsed.imdb,
            input.season ?? parsed.season,
            input.episode ?? parsed.episode,
            mediaId,
          );
        }

        const imdb = mediaId !== undefined ? extractImdb(mediaId) : null;
        const tail = mediaId !== undefined ? parseSeasonEpisode(mediaId) : null;
        const season = input.season ?? tail?.season;
        const episode = input.episode ?? tail?.episode;

        if (imdb !== null) {
          return playFromTorrentio(imdb, season, episode, mediaId);
        }

        if (mediaId !== undefined && mediaId.startsWith('rd:')) {
          return { kind: 'unavailable', reason: 'not-in-library' };
        }

        const wanted = input.title?.trim() ?? '';
        if (wanted !== '') {
          const matchedId = await findLibraryPlayback(wanted, season, episode);
          if (matchedId !== null) {
            const owned = await resolveOwnedLink(matchedId);
            if (owned !== null) return playFromLink(owned, matchedId);
          }
          try {
            const hits = await catalog.search(wanted);
            const hit = hits.find((item) => item.kind === (season !== undefined ? 'series' : item.kind)) ?? hits[0];
            if (hit !== undefined) {
              return playFromTorrentio(hit.id, season, episode, hit.id);
            }
          } catch {
            // Fall through to not-in-library.
          }
        }

        return { kind: 'unavailable', reason: 'not-in-library' };
      } catch {
        return { kind: 'unavailable', reason: 'empty' };
      }
    },

    saveProgress(id, position, duration) {
      writeProgress(scope(), id, position, duration);
    },

    clearCache() {
      libraryCache = null;
      statusCache = null;
      artCache.clear();
      catalog.clear();
      clearCacheDir(dataDir);
    },

    factoryReset() {
      this.clearCache();
      factoryResetDir(dataDir);
      libraryCache = null;
      statusCache = null;
      profiles = createProfileService(dataDir);
    },
  };
}
