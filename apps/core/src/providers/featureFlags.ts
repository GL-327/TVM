import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSealed, writeSealed } from './vault.ts';

export interface FeatureFlags {
  'liveTv.visible': boolean;
  'liveTv.orderable': boolean;
  'liveTv.healthy': boolean;
  selfServeBilling: boolean;
}
const ENV_KEYS: Record<keyof FeatureFlags, string> = {
  'liveTv.visible': 'TVM_FLAG_LIVE_TV_VISIBLE',
  'liveTv.orderable': 'TVM_FLAG_LIVE_TV_ORDERABLE',
  'liveTv.healthy': 'TVM_FLAG_LIVE_TV_HEALTHY',
  selfServeBilling: 'TVM_FLAG_SELF_SERVE_BILLING',
};
export function resolveFlags(env: NodeJS.ProcessEnv = {}, overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  const flags: FeatureFlags = {
    'liveTv.visible': true, 'liveTv.orderable': false,
    'liveTv.healthy': env['TVM_LIVE_TV_ONLINE'] !== '0', selfServeBilling: false, ...overrides,
  };
  // Environment overrides take precedence over sealed operator overrides.
  for (const key of Object.keys(ENV_KEYS) as (keyof FeatureFlags)[]) {
    const value = env[ENV_KEYS[key]]?.trim().toLowerCase();
    if (value === '1' || value === 'true') flags[key] = true;
    else if (value === '0' || value === 'false') flags[key] = false;
  }
  return flags;
}
export function createFeatureFlags(options: { dataDir: string; env?: NodeJS.ProcessEnv }) {
  const path = join(options.dataDir, 'secrets', 'flags.enc');
  const read = (): Partial<FeatureFlags> => {
    if (!existsSync(path)) return {};
    const stored = readSealed<Partial<FeatureFlags>>(options.dataDir, path);
    if (!stored || Object.entries(stored).some(([key, value]) => !Object.hasOwn(ENV_KEYS, key) || typeof value !== 'boolean')) {
      throw new Error('flags_unreadable');
    }
    return stored;
  };
  return {
    get: () => resolveFlags(options.env ?? process.env, read()),
    set(input: unknown): FeatureFlags {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.entries(input).some(([key, value]) => !Object.hasOwn(ENV_KEYS, key) || typeof value !== 'boolean')) {
        throw new Error('invalid_flags');
      }
      const overrides = { ...read(), ...input };
      writeSealed(options.dataDir, path, overrides);
      return resolveFlags(options.env ?? process.env, overrides);
    },
  };
}
export type FeatureFlagService = ReturnType<typeof createFeatureFlags>;
