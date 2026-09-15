/**
 * Getting back to the live edge after a pause.
 *
 * Pausing live television does not pause the broadcast. The stream keeps
 * arriving, the player keeps buffering it, and pressing play again resumes
 * from where you stopped — so you carry that gap for the rest of the channel,
 * quietly falling further behind every time you pause. Until now nothing in
 * the player could even express the problem: `seekTo` refuses outright when
 * the stream is live, so there was no way forward.
 */

/**
 * Sit a little short of the edge rather than exactly on it.
 *
 * The last fragment is usually still being written. Seeking onto it stalls the
 * decoder and the player rebuffers immediately, which looks worse than the
 * delay being fixed.
 */
export const LIVE_EDGE_MARGIN_SECONDS = 3;

/** Below this, being behind is not worth mentioning or correcting. */
export const LIVE_DRIFT_THRESHOLD_SECONDS = 12;

/**
 * The furthest point the player can reach.
 *
 * `seekable` is authoritative for HLS. The MPEG-TS reader publishes no
 * seekable range at all, so `buffered` is the only evidence of how much of the
 * broadcast is actually in hand — checked in that order, never summed.
 */
export function liveEdgeOf(seekable: TimeRanges | null, buffered: TimeRanges | null): number {
  const ranges = seekable !== null && seekable.length > 0 ? seekable : buffered;
  if (ranges === null || ranges.length === 0) return 0;
  const end = ranges.end(ranges.length - 1);
  return Number.isFinite(end) && end > 0 ? end : 0;
}

/** How far behind the broadcast the viewer currently is, in seconds. */
export function driftFromLive(currentTime: number, edge: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(edge) || edge <= 0) return 0;
  return Math.max(0, edge - currentTime);
}

/**
 * Whether to offer the jump.
 *
 * Deliberately not "drift > 0". A live stream always sits a second or two
 * behind its own edge, and a button that appeared during untouched playback
 * would be noise rather than a fix.
 */
export function isBehindLive(drift: number, threshold = LIVE_DRIFT_THRESHOLD_SECONDS): boolean {
  return Number.isFinite(drift) && drift >= threshold;
}

/** Where to land when catching up. Never past the edge, never below zero. */
export function catchUpTarget(edge: number, margin = LIVE_EDGE_MARGIN_SECONDS): number {
  if (!Number.isFinite(edge) || edge <= 0) return 0;
  return Math.max(0, edge - margin);
}

/** "2 min behind" reads better than a raw second count on a 10-foot screen. */
export function formatDrift(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s behind`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} min behind`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h behind` : `${hours}h ${rest}m behind`;
}
