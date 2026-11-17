import type { OfferId } from './priceBook.ts';

/** Server-only provider wiring, deliberately separate from public price books. */
export function providerPriceIds(env: NodeJS.ProcessEnv = process.env): Record<'test' | 'live', Partial<Record<OfferId, string>>> {
  const map: ReturnType<typeof providerPriceIds> = { test: {}, live: {} };
  for (const mode of ['test', 'live'] as const) {
    for (const product of ['base', 'liveTv'] as const) {
      for (const cadence of ['month', 'year'] as const) {
        const value = env[`TVM_PRICE_${mode}_${product}_${cadence}`.toUpperCase()];
        if (value) map[mode][`tvm.${product}.${cadence}`] = value;
      }
    }
  }
  return map;
}
