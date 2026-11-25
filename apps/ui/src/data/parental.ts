import { getParentalContent, type AgeLimitValue, type ParentalLevel } from './content';

export type { AgeLimitValue, ParentalLevel };

export function getParentalLevels(): readonly ParentalLevel[] {
  return getParentalContent().levels;
}

export function getKidsDefaultAge(): AgeLimitValue {
  return getParentalContent().kidsDefault;
}

export function parentalLevelForAge(maxAge: number | undefined): ParentalLevel {
  const levels = getParentalContent().levels;
  if (maxAge === undefined) return levels[levels.length - 1]!;
  return levels.find((entry) => entry.maxAge === maxAge) ?? levels[levels.length - 1]!;
}

export function ageLimitLabel(maxAge: number | undefined): string {
  return parentalLevelForAge(maxAge).label;
}

export function passesAgeLimit(
  genres: readonly string[] | undefined,
  maxAge: AgeLimitValue | number | undefined,
): boolean {
  if (maxAge === undefined || maxAge >= 18) return true;
  const level = parentalLevelForAge(maxAge);
  const lower = (genres ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean);
  if (level.block.some((blocked) => lower.includes(blocked.toLowerCase()))) {
    return false;
  }
  if (level.allow !== null) {
    return level.allow.some((allowed) => lower.includes(allowed.toLowerCase()));
  }
  return true;
}

export function filterItemsByAge<T extends { genres?: readonly string[] }>(
  items: readonly T[],
  maxAge: AgeLimitValue | number | undefined,
): T[] {
  if (maxAge === undefined || maxAge >= 18) return [...items];
  return items.filter((item) => passesAgeLimit(item.genres, maxAge));
}
