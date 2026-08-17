export function seasonNumbers(files: readonly { season?: number }[]): number[] {
  const values = new Set<number>();
  for (const file of files) {
    if (file.season !== undefined) values.add(file.season);
  }
  return [...values].sort((left, right) => left - right);
}

export function episodesForSeason<T extends { season?: number }>(
  files: readonly T[],
  season: number | null,
): T[] {
  if (season === null) return [];
  return files.filter((file) => file.season === season);
}
