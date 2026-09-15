#!/usr/bin/env node
/**
 * Exports the terms and the access tiers for the phone builds.
 *
 * Both phone apps run their own embedded core, so they have to answer
 * /api/terms and /api/tiers themselves. Re-typing the terms into Swift and
 * again into Kotlin would guarantee three versions that drift, and an
 * acceptance record is worthless the moment it points at wording nobody can
 * reproduce. So there is one source — apps/core/src/providers — and this
 * writes it out as a resource each app bundles.
 *
 * Run from CI before packaging, and by hand after editing the terms.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function load(relative) {
  return import(pathToFileURL(join(root, relative)).href);
}

const { TERMS, TERMS_SUMMARY, TERMS_VERSION } = await load('apps/core/src/providers/terms.ts');
const { ACCESS_TIERS, ACCESS_ROUTE, STREAM_MONTHLY_PENCE } = await load('apps/core/src/providers/accessTiers.ts');

const payload = {
  generated: new Date().toISOString(),
  termsVersion: TERMS_VERSION,
  terms: { ...TERMS, summary: TERMS_SUMMARY },
  tiers: ACCESS_TIERS,
  route: ACCESS_ROUTE,
  streamMonthlyPence: STREAM_MONTHLY_PENCE,
};

const targets = [
  'apps/ios/TVM/Access.json',
  'apps/android/app/src/main/assets/Access.json',
];

for (const target of targets) {
  const path = join(root, target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${target}`);
}

console.log(`terms v${TERMS_VERSION}, ${ACCESS_TIERS.length} tiers`);
