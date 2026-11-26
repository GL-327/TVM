import { readPrefs } from '../prefs.ts';

export interface PlaybackEvent {
  event: 'play' | 'pause' | 'stop' | 'finish';
  id: string;
  title?: string;
  position?: number;
  duration?: number;
}

export function progressId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && /^[a-z\d][a-z\d:_.-]*$/i.test(value) &&
    !['constructor', 'prototype'].includes(value);
}

export function playbackEvent(input: Record<string, unknown>): PlaybackEvent | null {
  const event = input.event;
  if (event !== 'play' && event !== 'pause' && event !== 'stop' && event !== 'finish') return null;
  if (!progressId(input.id)) return null;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : '';
  const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return { event, id: input.id, ...(title && { title }), position: seconds(input.position), duration: seconds(input.duration) };
}

export function createPlaybackWebhook(dataDir: string, fetchImpl: typeof fetch = fetch) {
  let pending = 0;
  const recent = new Map<string, number>();
  return (scope: string, event: PlaybackEvent): void => {
    const { extras, webhookUrl } = readPrefs(dataDir);
    if (!extras.webhook || !webhookUrl || pending >= 8) return;
    let url: URL;
    try { url = new URL(webhookUrl); } catch { return; }
    const key = JSON.stringify([scope, event.id, event.event]);
    const now = Date.now();
    if (now - (recent.get(key) ?? -Infinity) < (event.event === 'finish' ? 8000 : 1000)) return;
    if (recent.size >= 256) recent.delete(recent.keys().next().value!);
    recent.set(key, now);
    const discord = /^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/i.test(url.hostname) &&
      /^\/api(?:\/v\d+)?\/webhooks\//.test(url.pathname);
    const body = discord ? { content: `${({ play: 'Playing', pause: 'Paused', stop: 'Stopped', finish: 'Finished' })[event.event]} ${event.title ?? event.id}`,
      allowed_mentions: { parse: [] } } : { ...event, at: new Date(now).toISOString() };
    pending++;
    void fetchImpl(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(response => response.body?.cancel()).catch(() => {}).finally(() => { pending--; });
  };
}
