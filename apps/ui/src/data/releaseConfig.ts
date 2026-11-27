import { useEffect, useState } from 'react';
import { apiFetch } from './media';
import { applyRemoteFlags } from './polishPrefs';

export interface Announcement { id: string; text: string; level: 'info' | 'warning' | 'critical'; link?: string }
export interface MaintenanceConfig { on: boolean; message: string }
export interface ReleaseConfig {
  announcement: Announcement | null;
  minVersion: string | null;
  flags: Record<string, boolean>;
  mail?: boolean;
  openSignups?: boolean;
  maintenance?: MaintenanceConfig;
}

let config: ReleaseConfig | null = null;
let pending: Promise<ReleaseConfig | null> | null = null;
let checkedAt = 0;

export function fetchReleaseConfig(): Promise<ReleaseConfig | null> {
  if (pending) return pending;
  if (Date.now() - checkedAt < 60_000) return Promise.resolve(config);
  pending = (async () => {
    try {
      let response = await apiFetch('/api/config');
      if (response.status === 404) response = await apiFetch('/api/announcement');
      if (response.ok) {
        const body = await response.json() as ReleaseConfig;
        config = body;
        applyRemoteFlags(body.flags ?? {});
        checkedAt = Date.now();
      }
    } catch { /* Keep the last known public configuration when offline. */ }
    return config;
  })().finally(() => { pending = null; });
  return pending;
}

export function useReleaseConfig(): ReleaseConfig | null {
  const [value, setValue] = useState(config);
  useEffect(() => {
    let active = true;
    const refresh = (): void => { void fetchReleaseConfig().then((next) => { if (active) setValue(next); }); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return value;
}

export function updateRequired(current: string, minimum: string | null | undefined): boolean {
  if (!minimum || !/^\d+\.\d+\.\d+$/.test(minimum)) return false;
  const installed = current.split(/[+-]/)[0]?.split('.').map(Number) ?? [];
  const target = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const difference = (target[i] ?? 0) - (installed[i] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

export function safeAnnouncementLink(link: string | undefined): string | undefined {
  try {
    const url = new URL(link ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* Invalid links are left out. */ }
  return undefined;
}
