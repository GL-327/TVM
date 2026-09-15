import type { IncomingMessage } from 'node:http';

/**
 * Phone and tablet playback starts at Premium.
 *
 * Basic used to qualify, but a phone is the most expensive way to serve a
 * stream — it is the copy most likely to be watched away from home, on mobile
 * data, in addition to a set at home rather than instead of one. Premium is
 * also the first tier without ads, and an ad break on a phone was the worst
 * version of that experience.
 *
 * The height floor stays: 720p entitlements are desktop-only regardless of
 * tier, because the mobile clients decode at 1080p.
 */
export const MOBILE_MIN_PLAN = 'premium';

export function mobilePlanAllowed(plan: { id: string; maxHeight: number }): boolean {
  return ['premium', 'ultra', 'max'].includes(plan.id) && plan.maxHeight >= 1080;
}

export function mobilePlaybackBlocked(request: IncomingMessage, path: string, plan: { id: string; maxHeight: number }): boolean {
  const mobile = /TVM-iOS|TVM-Android|iPhone|iPad|iPod|Android/i.test(request.headers['user-agent'] ?? '');
  return mobile && !mobilePlanAllowed(plan) && (path === '/api/playback' || path.startsWith('/api/stream/'));
}
