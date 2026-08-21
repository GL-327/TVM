export type ProviderId = string;
export type MediaId = `${ProviderId}:${string}`;

export interface ProviderManifest {
  id: ProviderId;
  name: string;
  capabilities: ReadonlyArray<'catalog' | 'meta' | 'children' | 'playback' | 'search' | 'progress'>;
}

export interface Subtitle {
  url: string;
  language: string;
  label: string;
}

export type StreamTransport = 'direct' | 'hls-session' | 'hls' | 'ts-live' | 'file';

export type PlaybackResolution =
  | {
      kind: 'stream';
      url: string;
      title: string;
      filename: string;
      mimeType: string;
      engine: 'html5' | 'native';
      startAt?: number;
      /** How core is delivering the bytes; the player picks its attach path from this. */
      transport?: StreamTransport;
      /** HLS session id when transport is `hls-session` (seek/stop endpoints). */
      sessionId?: string;
      /** Movie time of the session's first HLS second; player adds this to element time. */
      timeOffset?: number;
      /** Probed duration, since an in-flight HLS session cannot report one. */
      durationSeconds?: number;
      /** Original hoster download, used when the HTML5 transcode stalls. */
      fallbackUrl?: string;
      fallbackEngine?: 'html5' | 'native';
      headers?: Record<string, string>;
      subtitles?: Subtitle[];
    }
  | {
      kind: 'unavailable';
      reason: 'not-in-library' | 'not-configured' | 'needs-auth' | 'region-blocked' | 'unsupported' | 'empty' | 'hours-cap';
    };

export interface MediaItem {
  id: string;
  title: string;
  year: number | null;
  kind: 'movie' | 'series' | 'file';
  synopsis: string;
  poster: string;
  backdrop: string;
  genres: string[];
  rating: string;
  runtime?: string;
  playable: boolean;
  progress?: number;
  filename?: string;
  hue: number;
  mimeType?: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  showTitle?: string;
  aired?: string;
}

export interface RdStatus {
  configured: boolean;
  username: string | null;
  premium: boolean;
  error: string | null;
}

export interface CatalogRail {
  id: string;
  title: string;
  items: MediaItem[];
}

export interface HomePayload {
  rd: RdStatus;
  featured: MediaItem | null;
  library: MediaItem[];
  continueWatching: MediaItem[];
  watchlist: MediaItem[];
  fileCount: number;
  rails: CatalogRail[];
}

export interface LiveChannel {
  id: string;
  name: string;
  url: string;
  group?: string;
  logo?: string;
}

export interface LiveGroup {
  name: string;
  count: number;
  picked: number;
}

export interface LiveChannelCard {
  id: string;
  name: string;
  group?: string;
  logo?: string;
  picked: boolean;
}

export interface LiveStatus {
  url: string | null;
  host: string | null;
  username: string | null;
  configured: boolean;
  channels: LiveChannelCard[];
  error: string | null;
  picked: number;
  total: number;
  groups: LiveGroup[];
  needsPicks: boolean;
  pickLimit: number;
}

export interface LiveCatalogPage {
  items: LiveChannelCard[];
  groups: LiveGroup[];
  total: number;
  matched: number;
  offset: number;
  limit: number;
  picked: number;
  pickLimit: number;
  query: string;
  group: string | null;
}

export interface Provider {
  manifest(): ProviderManifest;
  catalogs?(): Promise<Array<{ id: string; title: string }>>;
  browse?(catalogId: string, page: number): Promise<MediaItem[]>;
  search?(query: string): Promise<MediaItem[]>;
  metadata?(id: MediaId): Promise<MediaItem | null>;
  children?(id: MediaId): Promise<MediaItem[]>;
  resolvePlayback?(id: MediaId): Promise<PlaybackResolution>;
}
