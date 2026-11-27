import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'C:/Users/Gathe/Desktop/TVM';
const edits = [
  ['package.json', '"version": "1.4.9"', '"version": "1.4.10"', 1],
  ['apps/core/package.json', '"version": "1.4.9"', '"version": "1.4.10"', 1],
  ['apps/ui/package.json', '"version": "1.4.9"', '"version": "1.4.10"', 1],
  ['apps/core/src/config.ts', "CORE_VERSION = '1.4.9'", "CORE_VERSION = '1.4.10'", 1],
  ['apps/android/app/build.gradle.kts', 'versionName = "1.4.9"', 'versionName = "1.4.10"', 1],
  ['apps/ios/TVM/Info.plist', '<string>1.4.9</string>', '<string>1.4.10</string>', 1],
  ['apps/ios/TVM/TVMModels.swift', 'static let version = "1.4.9"', 'static let version = "1.4.10"', 1],
  ['apps/ios/TVM.xcodeproj/project.pbxproj', 'MARKETING_VERSION = 1.4.9;', 'MARKETING_VERSION = 1.4.10;', 2],
];
for (const [file, from, to, count] of edits) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const found = text.split(from).length - 1;
  if (found !== count) throw new Error(`${file}: expected ${count} of ${from}, found ${found}`);
  writeFileSync(path, text.split(from).join(to));
  console.log(`${file}: ${found} replaced`);
}

console.log("versions bumped to 1.4.10 (changelog written separately)");
