export function asSeason(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function seasonNumbers(files: readonly { season?: unknown }[]): number[] {
  const values = new Set<number>();
  for (const file of files) {
    const season = asSeason(file.season);
    if (season !== undefined) values.add(season);
  }
  return [...values].sort((left, right) => left - right);
}

export function episodesForSeason<T extends { season?: unknown }>(
  files: readonly T[],
  season: number | null,
): T[] {
  if (season === null) return [];
  return files.filter((file) => asSeason(file.season) === season);
}
