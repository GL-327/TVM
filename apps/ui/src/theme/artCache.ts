/** Limit retained encoded artwork independently of how many catalogs are visited. */
export class ArtCache {
  private readonly values = new Map<string, string>();
  private bytes = 0;

  constructor(private readonly maxEntries = 160, private readonly maxBytes = 12 * 1024 * 1024) {}

  get(key: string): string | undefined {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    const old = this.values.get(key);
    if (old !== undefined) this.bytes -= old.length * 2;
    this.values.delete(key);
    this.values.set(key, value);
    this.bytes += value.length * 2;
    while (this.values.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.values.entries().next().value;
      if (oldest === undefined) break;
      this.bytes -= oldest[1].length * 2;
      this.values.delete(oldest[0]);
    }
  }
}
