#!/usr/bin/env node
/*
 * Stamps the iPhone's bundled interface: build-info.json (commit, content hash,
 * native API level), changelog.json and CHANGELOG.md.
 *
 * The app compares this stamp with the manifest on the ios-ui release to
 * decide whether a newer interface exists, so the bundle inside the IPA and
 * the one on the feed must be stamped the same way. Both use
 * scripts/stamp-ui-bundle.mjs; this is the iOS entry point CI calls.
 *
 * Run after bundle-ui.mjs, with enough git history for the changelog.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampBundle } from '../../scripts/stamp-ui-bundle.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const info = stampBundle(join(ROOT, 'TVM', 'BundledUI'), 'ios');
console.log(`stamped iOS BundledUI: ${info.commit.slice(0, 7) || 'no commit'}, native ${info.nativeApi}`);
