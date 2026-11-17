import { opaqueId, type AccountBucket } from './store.ts';
import type { Activity, ActivityParty } from './vocab.ts';

/** No arbitrary detail/payload parameter: activity can never copy media metadata. */
export function recordActivity(b: AccountBucket, at: number, type: Activity['type'], actor: ActivityParty, target: ActivityParty): void {
  b.activity.push({ id: opaqueId('evt'), at: new Date(at).toISOString(), type,
    actor: { installationId: actor.installationId, name: actor.name },
    target: { installationId: target.installationId, name: target.name }, detail: null });
  b.activity = b.activity.filter(e => at - Date.parse(e.at) < 90 * 86_400_000).slice(-500);
}
export function readActivity(b: AccountBucket | undefined, limit = 50): Activity[] {
  if (limit <= 0) return [];
  return (b?.activity ?? []).slice(-Math.min(500, Math.max(0, limit))).reverse();
}
