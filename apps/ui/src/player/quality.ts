/**
 * Resolution ladder and screen-fit selection for adaptive HLS playback (F4).
 */

export const QUALITY_LADDER = [720, 1080, 1440, 2160] as const;
export type QualityLadderStep = (typeof QUALITY_LADDER)[number];

export function snapUpToQualityLadder(physicalHeight: number): QualityLadderStep {
  if (!Number.isFinite(physicalHeight) || physicalHeight <= 720) return 720;
  for (const step of QUALITY_LADDER) {
    if (physicalHeight <= step) return step;
  }
  return 2160;
}

export function screenTargetHeight(
  logicalHeight = typeof window !== 'undefined' && typeof window.screen !== 'undefined' ? window.screen.height : 1080,
  dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1,
): QualityLadderStep {
  const safeHeight = Number.isFinite(logicalHeight) && logicalHeight > 0 ? logicalHeight : 1080;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return snapUpToQualityLadder(Math.round(safeHeight * safeDpr));
}

export function effectiveStreamMaxHeight(planMax: number, screenMax: number): number {
  const safePlan = Number.isFinite(planMax) && planMax > 0 ? planMax : 2160;
  const safeScreen = Number.isFinite(screenMax) && screenMax > 0 ? screenMax : 2160;
  return Math.min(safePlan, safeScreen);
}

export interface HlsLevelLike {
  height: number;
  bitrate?: number;
}

export function selectBestHlsLevelIndex<T extends HlsLevelLike>(
  levels: readonly T[],
  maxHeight: number,
): number {
  const allowed = levels
    .map((level, index) => ({ level, index }))
    .filter(({ level }) => level.height <= 0 || level.height <= maxHeight);
  if (allowed.length === 0) {
    // Every variant exceeds cap — fall back to lowest height available rather than failing playback.
    let lowestIndex = 0;
    let lowestHeight = Infinity;
    for (let i = 0; i < levels.length; i += 1) {
      const h = levels[i]?.height ?? Infinity;
      if (h < lowestHeight) {
        lowestHeight = h;
        lowestIndex = i;
      }
    }
    return lowestIndex;
  }
  let best = allowed[0]!;
  for (const row of allowed) {
    if (
      row.level.height > best.level.height ||
      (row.level.height === best.level.height && (row.level.bitrate ?? 0) > (best.level.bitrate ?? 0))
    ) {
      best = row;
    }
  }
  return best.index;
}
