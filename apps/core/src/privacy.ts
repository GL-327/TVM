import { profileDir } from './update/paths.ts';
import { readProgress } from './providers/progress.ts';
import { readWatchlist } from './providers/watchlist.ts';
import type { MediaService } from './providers/media.ts';
import type { PlanService } from './providers/plans.ts';

export const POLICY_VERSION = '2026-09-12';

/** Explicit fields only: credentials, playlist links and master keys never leave Core. */
export function exportPersonalData(dataDir: string, media: MediaService, plans: PlanService) {
  const registry = media.profiles();
  return {
    format: 'tvm-personal-data-v1', exportedAt: new Date().toISOString(), policyVersion: POLICY_VERSION,
    activeProfileId: registry.activeId,
    profiles: registry.profiles.map((profile) => ({
      id: profile.id, name: profile.name, created: profile.created,
      progress: readProgress(profileDir(dataDir, profile.id)),
      watchlist: readWatchlist(profileDir(dataDir, profile.id)).map((item) => ({
        id: item.id, title: item.title, year: item.year, added: item.added,
      })),
    })),
    billing: plans.billing(),
    exclusions: ['Provider passwords and tokens', 'Playlist URLs and contents', 'Encryption keys', 'Other services’ account data'],
  };
}
