import type { AppHubPayload } from '../../../data/apps';
import type { Title } from '../../../data/catalog';
import type { MediaItem } from '../../../data/media';
import type { Navigate } from '../../../nav/ViewStackContext';
import type { Lane } from '../layouts';

/**
 * Catalog bag the Service dispatcher passes into every hub skin.
 * Brand files may ignore fields they do not need.
 */
export type HubCatalog = {
  rails?: AppHubPayload['rails'];
  continueWatching?: AppHubPayload['continueWatching'];
  watchlist?: Array<MediaItem | Title>;
  hero?: AppHubPayload['hero'];
  items?: Array<MediaItem | Title>;
};

/**
 * Skin contract. Service.tsx always supplies hub, catalog, navigate, and play.
 * Optional fields exist so brand skins can stay self-contained while they load.
 */
export type ServiceSkinProps = {
  hub?: AppHubPayload | null;
  appId?: string;
  catalog?: AppHubPayload | HubCatalog | readonly Title[];
  items?: Array<MediaItem | Title>;
  rails?: AppHubPayload['rails'];
  lane?: Lane;
  category?: Lane | string;
  onLane?: (lane: Lane) => void;
  onBack?: () => void;
  onPlay?: (title: Title) => void;
  onOpen?: (title: Title) => void;
  play?: (title: Title) => void;
  navigate?: Navigate;
};
