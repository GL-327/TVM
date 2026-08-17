import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { profileDir, profilesPath, progressPath, watchlistPath } from '../update/paths.ts';

export const MAX_PROFILES = 10;

export interface Profile {
  id: string;
  name: string;
  hue: number;
  created: string;
}

export interface ProfileRegistry {
  activeId: string;
  profiles: Profile[];
}

const HUES = [350, 220, 140, 32, 280];

function defaultProfile(index = 0): Profile {
  return {
    id: `profile-${index + 1}`,
    name: `Profile ${index + 1}`,
    hue: HUES[index % HUES.length] ?? 220,
    created: new Date().toISOString(),
  };
}

function persist(dataDir: string, registry: ProfileRegistry): ProfileRegistry {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(profilesPath(dataDir), JSON.stringify(registry));
  mkdirSync(profileDir(dataDir, registry.activeId), { recursive: true });
  return registry;
}

function migrateLegacy(dataDir: string, profileId: string): void {
  const dest = profileDir(dataDir, profileId);
  mkdirSync(dest, { recursive: true });
  const oldProgress = progressPath(dataDir);
  const nextProgress = progressPath(dest);
  if (existsSync(oldProgress) && !existsSync(nextProgress)) renameSync(oldProgress, nextProgress);
  const oldWatchlist = watchlistPath(dataDir);
  const nextWatchlist = watchlistPath(dest);
  if (existsSync(oldWatchlist) && !existsSync(nextWatchlist)) renameSync(oldWatchlist, nextWatchlist);
}

export function loadProfiles(dataDir: string): ProfileRegistry {
  try {
    const parsed = JSON.parse(readFileSync(profilesPath(dataDir), 'utf8')) as ProfileRegistry;
    if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
      const active = parsed.profiles.some((profile) => profile.id === parsed.activeId)
        ? parsed.activeId
        : parsed.profiles[0]?.id;
      if (active !== undefined) {
        mkdirSync(profileDir(dataDir, active), { recursive: true });
        return { activeId: active, profiles: parsed.profiles.slice(0, MAX_PROFILES) };
      }
    }
  } catch {
    // First run.
  }
  const first = defaultProfile(0);
  migrateLegacy(dataDir, first.id);
  return persist(dataDir, { activeId: first.id, profiles: [first] });
}

export function createProfileService(dataDir: string) {
  let registry = loadProfiles(dataDir);

  const save = (next: ProfileRegistry): ProfileRegistry => {
    registry = persist(dataDir, next);
    return registry;
  };

  return {
    list(): ProfileRegistry {
      return registry;
    },
    activeId(): string {
      return registry.activeId;
    },
    scope(): string {
      return profileDir(dataDir, registry.activeId);
    },
    create(name: string, max = MAX_PROFILES): ProfileRegistry {
      const cap = Math.max(1, Math.min(MAX_PROFILES, max));
      if (registry.profiles.length >= cap) {
        throw new Error(`TVM holds ${cap} profiles.`);
      }
      const trimmed = name.trim() === '' ? `Profile ${registry.profiles.length + 1}` : name.trim();
      const index = registry.profiles.length;
      const profile = { ...defaultProfile(index), name: trimmed, id: `profile-${Date.now()}` };
      mkdirSync(profileDir(dataDir, profile.id), { recursive: true });
      return save({ activeId: profile.id, profiles: [...registry.profiles, profile] });
    },
    rename(id: string, name: string): ProfileRegistry {
      const trimmed = name.trim();
      if (trimmed === '') return registry;
      return save({
        ...registry,
        profiles: registry.profiles.map((profile) => (profile.id === id ? { ...profile, name: trimmed } : profile)),
      });
    },
    remove(id: string): ProfileRegistry {
      if (registry.profiles.length <= 1) throw new Error('TVM needs at least one profile.');
      const profiles = registry.profiles.filter((profile) => profile.id !== id);
      const activeId = registry.activeId === id ? (profiles[0]?.id ?? registry.activeId) : registry.activeId;
      return save({ activeId, profiles });
    },
    switchTo(id: string): ProfileRegistry {
      if (!registry.profiles.some((profile) => profile.id === id)) throw new Error('Unknown profile.');
      mkdirSync(profileDir(dataDir, id), { recursive: true });
      return save({ ...registry, activeId: id });
    },
    reload(): ProfileRegistry {
      registry = loadProfiles(dataDir);
      return registry;
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
