// Bumps the TVM version everywhere a release needs it. Usage: node docs/agents/tools/bump-version.mjs 1.4.13 1.4.14
// The changelog is written separately (packages/content/changelog.json, then copied to the three app copies).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [from, to] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(from ?? '') || !/^\d+\.\d+\.\d+$/.test(to ?? '')) {
  throw new Error('usage: bump-version.mjs <from> <to>, e.g. 1.4.13 1.4.14');
}
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const [, , fromPatch] = from.split('.');
const [, , toPatch] = to.split('.');
const edits = [
  ['package.json', `"version": "${from}"`, `"version": "${to}"`, 1],
  ['apps/core/package.json', `"version": "${from}"`, `"version": "${to}"`, 1],
  ['apps/ui/package.json', `"version": "${from}"`, `"version": "${to}"`, 1],
  ['apps/core/src/config.ts', `CORE_VERSION = '${from}'`, `CORE_VERSION = '${to}'`, 1],
  ['apps/android/app/build.gradle.kts', `versionName = "${from}"`, `versionName = "${to}"`, 1],
  ['apps/ios/TVM/Info.plist', `<string>${from}</string>`, `<string>${to}</string>`, 1],
  ['apps/ios/TVM/TVMModels.swift', `static let version = "${from}"`, `static let version = "${to}"`, 1],
  ['apps/ios/TVM.xcodeproj/project.pbxproj', `MARKETING_VERSION = ${from};`, `MARKETING_VERSION = ${to};`, 2],
  ['apps/roku/manifest', `build_version=${fromPatch}\n`, `build_version=${toPatch}\n`, 1],
];
for (const [file, find, replace, count] of edits) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const found = text.split(find).length - 1;
  if (found !== count) throw new Error(`${file}: expected ${count} of ${JSON.stringify(find)}, found ${found}`);
  writeFileSync(path, text.split(find).join(replace));
  console.log(`${file}: ${found} replaced`);
}
console.log(`versions bumped ${from} -> ${to}`);
