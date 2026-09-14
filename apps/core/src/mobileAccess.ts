import type { IncomingMessage } from 'node:http';

export function mobilePlanAllowed(plan: { id: string; maxHeight: number }): boolean {
  return ['basic', 'premium', 'ultra', 'max'].includes(plan.id) && plan.maxHeight >= 1080;
}

export function mobilePlaybackBlocked(request: IncomingMessage, path: string, plan: { id: string; maxHeight: number }): boolean {
  const mobile = /TVM-iOS|TVM-Android|iPhone|iPad|iPod|Android/i.test(request.headers['user-agent'] ?? '');
  return mobile && !mobilePlanAllowed(plan) && (path === '/api/playback' || path.startsWith('/api/stream/'));
}
