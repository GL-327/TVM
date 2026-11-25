// Core's existing release ships only core/dist, without workspace dependencies.
// Generate an erased, standalone copy in the owned adapter so its regular tsc
// build includes the shared implementation. Edit src/index.ts, never the block.
import { readFileSync, writeFileSync } from 'node:fs';
const target = new URL('../../apps/core/src/providers/extras.ts', import.meta.url);
const source = readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8').replace(/^export /gm, '');
const start = '// BEGIN GENERATED @tvm/extras — edit packages/extras/src/index.ts';
const end = '// END GENERATED @tvm/extras';
const adapter = readFileSync(target, 'utf8');
const first = adapter.indexOf(start);
const last = adapter.indexOf(end, first);
if (first < 0 || last < 0) throw new Error('Core Extras shared-code markers are missing');
const next = adapter.slice(0, first) + start + '\n' + source.trimEnd() + '\n' + adapter.slice(last);
if (next !== adapter) {
  if (process.argv.includes('--check')) throw new Error('Run pnpm --filter @tvm/extras build to refresh the generated Core adapter');
  writeFileSync(target, next);
}
