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

export type PlaybackResolution =
  | {
      kind: 'stream';
      url: string;
      title: string;
      filename: string;
      mimeType: string;
      engine: 'html5' | 'native';
      startAt?: number;
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
  headers?: Record<string, string>;
}

export interface LiveStatus {
  url: string | null;
  channels: LiveChannel[];
  error: string | null;
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
