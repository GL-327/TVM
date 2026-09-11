/** Bounded, short-lived read cache. Invalidated requests cannot repopulate it. */
export function createRequestCache(maxEntries = 64) {
  const values = new Map<string, { value: unknown; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let generation = 0;
  return {
    clear(): void {
      generation += 1;
      values.clear();
      pending.clear();
    },
    async load<T>(key: string, loader: () => Promise<T>, ttlMs = 15_000): Promise<T> {
      const hit = values.get(key);
      if (hit !== undefined && hit.expires > Date.now()) {
        values.delete(key);
        values.set(key, hit);
        return hit.value as T;
      }
      values.delete(key);
      const inflight = pending.get(key);
      if (inflight !== undefined) return inflight as Promise<T>;
      const started = generation;
      const request = Promise.resolve().then(loader).then((value) => {
        if (started === generation && value !== null && ttlMs > 0) {
          values.set(key, { value, expires: Date.now() + ttlMs });
          while (values.size > maxEntries) values.delete(values.keys().next().value!);
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}
