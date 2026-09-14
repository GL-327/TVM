#!/usr/bin/env node
/*
 * Windows-side validation for apps/ios.
 *
 * This is a PACKAGING check, not an iOS build. It cannot compile Swift, link
 * against the iOS SDK, sign, or prove anything about behaviour on a phone. What
 * it does do is catch the class of mistake that makes Xcode refuse to open the
 * project, or that only shows up after a long transfer to a Mac: a dangling
 * pbxproj UUID, a file reference with nothing behind it, a source file missing
 * from the build phase, malformed plist XML, or an Info.plist that has lost the
 * keys local-network access depends on. It also checks that the default
 * product is a standalone on-device app (bundled UI + local /api), not a
 * first-run LAN Core client.
 *
 * Run: node apps/ios/check-project.mjs
 * Exit code 0 = every check passed. 1 = at least one failure.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const PROJECT = join(ROOT, 'TVM.xcodeproj', 'project.pbxproj');
const SCHEME = join(ROOT, 'TVM.xcodeproj', 'xcshareddata', 'xcschemes', 'TVM.xcscheme');
const STRUCT_ONLY = process.env.TVM_IOS_STRUCT_ONLY === '1';

const failures = [];
const warnings = [];
const passes = [];

function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function pass(message) { passes.push(message); }

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(detail === undefined ? label : `${label} — ${detail}`);
}

function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/** Prose about an API is not a use of it, so drop comments before grepping for one. */
function stripSwiftComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* -- pbxproj --------------------------------------------------------------
 * The project file is the OpenStep plist Xcode writes. Rather than implement
 * that grammar, pull out the object table by id and work on the raw bodies:
 * every check below is about references between ids, which are unambiguous.
 */

function parseObjects(source) {
  // Each top-level entry is `<24-hex-ish id> = { ... };` inside `objects = { }`.
  const objects = new Map();
  const start = source.indexOf('objects = {');
  if (start < 0) return objects;
  let i = start + 'objects = {'.length;
  while (i < source.length) {
    const idMatch = /([A-Za-z0-9_]{8,})\s*=\s*\{/.exec(source.slice(i));
    if (idMatch === null) break;
    const id = idMatch[1];
    let depth = 0;
    let j = i + idMatch.index + idMatch[0].length - 1; // at the '{'
    const bodyStart = j + 1;
    for (; j < source.length; j += 1) {
      const ch = source[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    objects.set(id, source.slice(bodyStart, j));
    i = j + 1;
  }
  return objects;
}

function isaOf(body) {
  const match = /\bisa\s*=\s*([A-Za-z]+)/.exec(body);
  return match === null ? null : match[1];
}

function fieldOf(body, key) {
  const match = new RegExp(`\\b${key}\\s*=\\s*([^;]+);`).exec(body);
  return match === null ? null : match[1].trim().replace(/^"|"$/g, '');
}

function listOf(body, key) {
  const match = new RegExp(`\\b${key}\\s*=\\s*\\(([^)]*)\\)`).exec(body);
  if (match === null) return [];
  return match[1].split(',').map((part) => part.trim().replace(/^"|"$/g, '')).filter((part) => part !== '');
}

const pbx = read(PROJECT);
check('project.pbxproj exists', pbx !== null, `missing ${relative(REPO, PROJECT)}`);

let objects = new Map();
let appTargetId = null;
let testTargetId = null;

if (pbx !== null) {
  check('project.pbxproj starts with the UTF8 marker Xcode writes', pbx.startsWith('// !$*UTF8*$!'));
  check('project.pbxproj has balanced braces',
    (pbx.match(/\{/g) ?? []).length === (pbx.match(/\}/g) ?? []).length,
    'unbalanced { } — Xcode will refuse to open the project');

  objects = parseObjects(pbx);
  check('project.pbxproj object table parses', objects.size > 0);

  const rootObject = fieldOf(pbx.slice(pbx.lastIndexOf('rootObject')), 'rootObject');
  check('rootObject resolves to a PBXProject',
    rootObject !== null && objects.has(rootObject) && isaOf(objects.get(rootObject)) === 'PBXProject',
    `rootObject ${String(rootObject)} is not a defined PBXProject`);

  // Every id mentioned inside any object body must itself be defined. A single
  // dangling reference is what turns into "The project cannot be opened".
  const defined = new Set(objects.keys());
  const dangling = new Set();
  for (const [id, body] of objects) {
    for (const token of body.match(/\b[A-F0-9]{24}\b/gi) ?? []) {
      if (!defined.has(token)) dangling.add(`${token} (referenced by ${id})`);
    }
  }
  check('every pbxproj id reference resolves', dangling.size === 0,
    `dangling ids: ${[...dangling].join(', ')}`);

  // File references must point at files that actually exist on disk.
  const groupPath = new Map(); // group id -> path segment
  for (const [id, body] of objects) {
    if (isaOf(body) !== 'PBXGroup') continue;
    const path = fieldOf(body, 'path');
    for (const child of listOf(body, 'children')) groupPath.set(child, path ?? '');
  }

  const missingFiles = [];
  const sourceFileIds = new Set();
  for (const [id, body] of objects) {
    if (isaOf(body) !== 'PBXFileReference') continue;
    const sourceTree = fieldOf(body, 'sourceTree');
    if (sourceTree === 'BUILT_PRODUCTS_DIR') continue; // produced by the build
    const path = fieldOf(body, 'path');
    if (path === null) continue;
    const parent = groupPath.get(id) ?? '';
    const onDisk = join(ROOT, parent, path);
    if (!existsSync(onDisk)) missingFiles.push(`${parent}/${path}`);
    if (fieldOf(body, 'lastKnownFileType') === 'sourcecode.swift') sourceFileIds.add(id);
  }
  check('every pbxproj file reference exists on disk', missingFiles.length === 0,
    `missing: ${missingFiles.join(', ')}`);

  // Targets.
  for (const [id, body] of objects) {
    if (isaOf(body) !== 'PBXNativeTarget') continue;
    const type = fieldOf(body, 'productType');
    if (type === 'com.apple.product-type.application') appTargetId = id;
    if (type === 'com.apple.product-type.bundle.unit-test') testTargetId = id;
  }
  check('an application target is defined', appTargetId !== null);
  check('a unit-test target is defined', testTargetId !== null);

  // Every .swift file on disk must be compiled by exactly one target, or it
  // silently does not ship and the failure only appears at runtime.
  const buildFileRef = new Map();
  for (const [id, body] of objects) {
    if (isaOf(body) !== 'PBXBuildFile') continue;
    buildFileRef.set(id, fieldOf(body, 'fileRef'));
  }
  const compiled = new Set();
  for (const [, body] of objects) {
    if (isaOf(body) !== 'PBXSourcesBuildPhase') continue;
    for (const buildFile of listOf(body, 'files')) {
      const ref = buildFileRef.get(buildFile);
      if (ref !== undefined && ref !== null) compiled.add(ref);
    }
  }
  const uncompiled = [...sourceFileIds].filter((id) => !compiled.has(id));
  check('every Swift file reference is in a Sources build phase', uncompiled.length === 0,
    `not compiled: ${uncompiled.map((id) => fieldOf(objects.get(id), 'path')).join(', ')}`);

  const swiftOnDisk = [];
  for (const dir of ['TVM', 'TVMTests']) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      if (name.endsWith('.swift')) swiftOnDisk.push(`${dir}/${name}`);
    }
  }
  const referenced = new Set();
  for (const id of sourceFileIds) {
    referenced.add(`${groupPath.get(id) ?? ''}/${fieldOf(objects.get(id), 'path')}`);
  }
  const orphans = swiftOnDisk.filter((path) => !referenced.has(path));
  check('every Swift file on disk is referenced by the project', orphans.length === 0,
    `orphaned (will not compile): ${orphans.join(', ')}`);

  // Info.plist must be wired through INFOPLIST_FILE, and must NOT also be
  // copied as a resource — that produces a duplicate-output build error.
  const infoPlistSettings = [];
  for (const [, body] of objects) {
    if (isaOf(body) !== 'XCBuildConfiguration') continue;
    const file = fieldOf(body, 'INFOPLIST_FILE');
    if (file !== null) infoPlistSettings.push(file);
  }
  check('INFOPLIST_FILE is set for the app target', infoPlistSettings.length > 0);
  check('INFOPLIST_FILE points at a file that exists',
    infoPlistSettings.every((file) => existsSync(join(ROOT, file))),
    `not found: ${infoPlistSettings.filter((file) => !existsSync(join(ROOT, file))).join(', ')}`);

  const resourceRefs = new Set();
  for (const [, body] of objects) {
    if (isaOf(body) !== 'PBXResourcesBuildPhase') continue;
    for (const buildFile of listOf(body, 'files')) {
      const ref = buildFileRef.get(buildFile);
      if (ref !== undefined && ref !== null) resourceRefs.add(fieldOf(objects.get(ref) ?? '', 'path'));
    }
  }
  check('Info.plist is not also copied as a resource', !resourceRefs.has('Info.plist'),
    'Info.plist in a Resources phase collides with INFOPLIST_FILE');
  check('PrivacyInfo.xcprivacy is copied as a resource', resourceRefs.has('PrivacyInfo.xcprivacy'),
    'the privacy manifest must ship inside the bundle');
  check('BundledUI is copied as a resource', resourceRefs.has('BundledUI'),
    'the production UI must ship inside the app bundle');
  check('Assets.xcassets is copied as a resource', resourceRefs.has('Assets.xcassets'),
    'the Home Screen AppIcon lives in the asset catalog');
  check('ASSETCATALOG_COMPILER_APPICON_NAME is AppIcon',
    /ASSETCATALOG_COMPILER_APPICON_NAME\s*=\s*AppIcon/.test(pbx),
    'without it the installed IPA has a generic iOS icon');

  // Deployment target and Swift version must be stated, or Xcode picks its own.
  const deploymentTargets = [];
  const swiftVersions = [];
  for (const [, body] of objects) {
    if (isaOf(body) !== 'XCBuildConfiguration') continue;
    const target = fieldOf(body, 'IPHONEOS_DEPLOYMENT_TARGET');
    if (target !== null) deploymentTargets.push(target);
    const swift = fieldOf(body, 'SWIFT_VERSION');
    if (swift !== null) swiftVersions.push(swift);
  }
  check('IPHONEOS_DEPLOYMENT_TARGET is declared', deploymentTargets.length > 0);
  check('SWIFT_VERSION is declared', swiftVersions.length > 0);
  if (deploymentTargets.length > 0) {
    const lowest = Math.min(...deploymentTargets.map((value) => Number.parseFloat(value)));
    check('deployment target is iOS 16 or newer', lowest >= 16, `found iOS ${lowest}`);
  }

  // @testable import requires testability in the configuration the tests build.
  const testability = [...objects.values()].some(
    (body) => isaOf(body) === 'XCBuildConfiguration' && fieldOf(body, 'ENABLE_TESTABILITY') === 'YES',
  );
  const usesTestable = (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('@testable');
  check('ENABLE_TESTABILITY = YES is set where @testable is used', !usesTestable || testability,
    'the test target uses @testable import but no configuration enables testability');

  // No signing identity, team or provisioning profile may be committed.
  for (const key of ['DEVELOPMENT_TEAM', 'PROVISIONING_PROFILE', 'PROVISIONING_PROFILE_SPECIFIER', 'CODE_SIGN_IDENTITY']) {
    check(`no ${key} is committed`, !new RegExp(`\\b${key}\\s*=`).test(pbx),
      `${key} is set in project.pbxproj — signing settings belong to the person building, not to source control`);
  }
  check('CODE_SIGN_STYLE is Automatic', /CODE_SIGN_STYLE\s*=\s*Automatic/.test(pbx),
    'manual signing will not work from a fresh clone');
}

/* -- scheme ---------------------------------------------------------------- */

const scheme = read(SCHEME);
check('shared TVM.xcscheme exists', scheme !== null,
  'without a shared scheme, `xcodebuild -scheme TVM` fails and Xcode shows no run target');

if (scheme !== null && appTargetId !== null) {
  check('scheme references the application target',
    scheme.includes(`BlueprintIdentifier="${appTargetId}"`),
    'the scheme points at a target id that is not the app');
  check('scheme has a TestAction', scheme.includes('<TestAction'));
  check('scheme has a LaunchAction', scheme.includes('<LaunchAction'));
  check('scheme has an ArchiveAction for Release',
    /<ArchiveAction[^>]*buildConfiguration="Release"/.test(scheme),
    'Product > Archive is how an installable build is produced');
  if (testTargetId !== null) {
    check('scheme test action references the test target',
      scheme.includes(`BlueprintIdentifier="${testTargetId}"`));
  }
}

/* -- plists ---------------------------------------------------------------- */

/** Minimal well-formedness: balanced tags and a single root <dict>. */
function plistLooksValid(text) {
  if (!text.includes('<!DOCTYPE plist')) return false;
  if (!/<plist\s+version="1\.0">/.test(text)) return false;
  const opens = (text.match(/<dict>/g) ?? []).length + (text.match(/<dict\/>/g) ?? []).length;
  const closes = (text.match(/<\/dict>/g) ?? []).length + (text.match(/<dict\/>/g) ?? []).length;
  const arrayOpens = (text.match(/<array>/g) ?? []).length + (text.match(/<array\/>/g) ?? []).length;
  const arrayCloses = (text.match(/<\/array>/g) ?? []).length + (text.match(/<array\/>/g) ?? []).length;
  return opens === closes && arrayOpens === arrayCloses && text.trimEnd().endsWith('</plist>');
}

const info = read(join(ROOT, 'TVM', 'Info.plist'));
check('Info.plist exists', info !== null);
if (info !== null) {
  check('Info.plist is well-formed plist XML', plistLooksValid(info));

  const required = [
    ['CFBundleIdentifier', 'the bundle id Xcode substitutes at build time'],
    ['CFBundleExecutable', 'without it the app will not launch'],
    ['CFBundleShortVersionString', 'the user-visible version'],
    ['CFBundleVersion', 'the build number'],
    ['LSRequiresIPhoneOS', 'marks this as an iOS app'],
    ['UILaunchScreen', 'a missing launch screen letterboxes the app on modern iPhones'],
    ['UISupportedInterfaceOrientations', 'orientation support'],
    ['CFBundleDisplayName', 'the Home Screen name under the icon'],
  ];
  for (const [key, why] of required) {
    check(`Info.plist declares ${key}`, info.includes(`<key>${key}</key>`), why);
  }

  // Local-network access. Both halves are required: iOS 14+ refuses LAN traffic
  // without the usage description, and plain-HTTP LAN needs the ATS exception.
  check('Info.plist declares CFBundleDisplayName TVM',
    /<key>CFBundleDisplayName<\/key>\s*<string>TVM<\/string>/.test(info),
    'the Home Screen label must be TVM');
  check('Info.plist declares NSLocalNetworkUsageDescription',
    info.includes('<key>NSLocalNetworkUsageDescription</key>'),
    'optional home-Core mode still needs the local-network usage string');
  check('NSLocalNetworkUsageDescription has non-empty text',
    /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]{10,}<\/string>/.test(info),
    'App Review and the system prompt both need a real sentence here');
  check('Info.plist does not describe LAN Core as the only mode',
    !/must connect to (your )?TVM computer|requires LAN Core/i.test(info),
    'standalone is the default product');
  check('Info.plist allows local networking over ATS',
    info.includes('<key>NSAllowsLocalNetworking</key>'),
    'without it, http:// to a LAN address is blocked by App Transport Security');

  // The dangerous ATS escape hatches must not be present.
  for (const key of ['NSAllowsArbitraryLoads', 'NSAllowsArbitraryLoadsInWebContent', 'NSExceptionAllowsInsecureHTTPLoads']) {
    check(`Info.plist does not set ${key}`, !info.includes(`<key>${key}</key>`),
      `${key} disables transport security far beyond the private LAN this app needs`);
  }

  function plistStringArray(text, key) {
    const match = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(text);
    if (match === null) return [];
    return [...match[1].matchAll(/<string>([^<]+)<\/string>/g)].map((item) => item[1]);
  }
  const iphoneOrientations = plistStringArray(info, 'UISupportedInterfaceOrientations');
  const ipadOrientations = plistStringArray(info, 'UISupportedInterfaceOrientations~ipad');
  check('iPhone orientations include portrait and landscape',
    iphoneOrientations.includes('UIInterfaceOrientationPortrait') &&
    iphoneOrientations.includes('UIInterfaceOrientationLandscapeLeft') &&
    iphoneOrientations.includes('UIInterfaceOrientationLandscapeRight'),
    `iPhone must not be landscape-only; got ${iphoneOrientations.join(', ') || 'none'}`);
  check('iPhone is not locked to landscape',
    iphoneOrientations.includes('UIInterfaceOrientationPortrait'),
    'vertical rotation requires UIInterfaceOrientationPortrait on iPhone');
  check('iPad orientations include portrait, upside-down and landscape',
    ipadOrientations.includes('UIInterfaceOrientationPortrait') &&
    ipadOrientations.includes('UIInterfaceOrientationPortraitUpsideDown') &&
    ipadOrientations.includes('UIInterfaceOrientationLandscapeLeft') &&
    ipadOrientations.includes('UIInterfaceOrientationLandscapeRight'),
    `iPad must keep all four; got ${ipadOrientations.join(', ') || 'none'}`);
}

if (pbx !== null) {
  check('project.pbxproj iPhone orientations include Portrait and landscape',
    /INFOPLIST_KEY_UISupportedInterfaceOrientations\s*=\s*"[^"]*UIInterfaceOrientationPortrait/.test(pbx) &&
    /INFOPLIST_KEY_UISupportedInterfaceOrientations\s*=\s*"[^"]*UIInterfaceOrientationLandscapeLeft/.test(pbx) &&
    /INFOPLIST_KEY_UISupportedInterfaceOrientations\s*=\s*"[^"]*UIInterfaceOrientationLandscapeRight/.test(pbx),
    'project build settings must not lock the phone to landscape');
}

const privacy = read(join(ROOT, 'TVM', 'PrivacyInfo.xcprivacy'));
check('PrivacyInfo.xcprivacy exists', privacy !== null);
if (privacy !== null) {
  check('PrivacyInfo.xcprivacy is well-formed plist XML', plistLooksValid(privacy));
  for (const key of ['NSPrivacyTracking', 'NSPrivacyCollectedDataTypes', 'NSPrivacyAccessedAPITypes']) {
    check(`privacy manifest declares ${key}`, privacy.includes(`<key>${key}</key>`));
  }
  check('privacy manifest declares no tracking',
    /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy));
}

/* -- Swift sources: cheap, high-signal checks only -------------------------
 * This cannot type-check. It looks for the specific mistakes that are easy to
 * make here and expensive to discover on a Mac.
 */

const swiftFiles = [];
for (const dir of ['TVM', 'TVMTests']) {
  const full = join(ROOT, dir);
  if (!existsSync(full) || !statSync(full).isDirectory()) continue;
  for (const name of readdirSync(full)) {
    if (name.endsWith('.swift')) swiftFiles.push(join(full, name));
  }
}
check('Swift sources are present', swiftFiles.length > 0);

for (const file of swiftFiles) {
  const text = read(file) ?? '';
  const name = relative(ROOT, file).replace(/\\/g, '/');
  const braces = (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
  check(`${name} has balanced braces`, braces === 0, `off by ${braces}`);
  if (/\bWKWebView\b|\bWKNavigation/.test(text)) {
    check(`${name} imports WebKit`, text.includes('import WebKit'));
  }
  if (/\bSecItem(Copy|Add|Update|Delete)/.test(text)) {
    check(`${name} imports Security`, text.includes('import Security') || text.includes('import Foundation'));
  }
  if (/\bView\b|@State|@Published|some View/.test(text) && !name.startsWith('TVMTests')) {
    check(`${name} imports SwiftUI`, text.includes('import SwiftUI') || text.includes('import Foundation'));
  }
}

// Exactly one @main entry point, or the app will not link.
const mainCount = swiftFiles.filter((file) => /^\s*@main\b/m.test(read(file) ?? '')).length;
check('exactly one @main entry point', mainCount === 1, `found ${mainCount}`);

const appSource = read(join(ROOT, 'TVM', 'TVMApp.swift')) ?? '';
const models = read(join(ROOT, 'TVM', 'TVMModels.swift')) ?? '';
const localServer = read(join(ROOT, 'TVM', 'TVMLocalServer.swift')) ?? '';
const localCore = read(join(ROOT, 'TVM', 'TVMLocalCore.swift')) ?? '';
const store = read(join(ROOT, 'TVM', 'TVMStore.swift')) ?? '';
const standaloneTests = read(join(ROOT, 'TVMTests', 'StandaloneTests.swift')) ?? '';
check('the first window is the standalone shell',
  /WindowGroup\s*\{\s*StandaloneRoot/.test(appSource.replace(/\s+/g, ' ')),
  'first-run must not be a connect-to-PC screen');
check('standalone does not require a LAN token',
  models.includes('requiresLANToken = false') && models.includes('bundledLANToken: String? = nil'),
  'TVM_LAN_TOKEN must not be a first-run requirement');
check('the app binds an on-device loopback server',
  localServer.includes('requiredInterfaceType = .loopback') && localServer.includes('127.0.0.1'),
  'the UI must load from the phone, not a PC');
check('the on-device core implements /api/home and /api/playback',
  localCore.includes('/api/home') && localCore.includes('/api/playback') && localCore.includes('/api/rd/token'),
  'Home and Real-Debrid must not 500 on a phone with no PC');
check('Real-Debrid tokens use the device Keychain',
  store.includes('TVM.Standalone.RealDebrid') && store.includes('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'));
check('standalone tests assert no LAN token is required',
  standaloneTests.includes('testStandaloneDoesNotRequireLANToken') &&
  standaloneTests.includes('StandalonePolicy.requiresLANToken'));
const mediaSwift = read(join(ROOT, 'TVM', 'TVMMedia.swift')) ?? '';
const rdSwift = read(join(ROOT, 'TVM', 'TVMRealDebrid.swift')) ?? '';
const modelsSwift = read(join(ROOT, 'TVM', 'TVMModels.swift')) ?? '';
check('on-device playback searches Torrentio then unrestricts Real-Debrid',
  mediaSwift.includes('playFromTorrentio') && mediaSwift.includes('playFromMagnet') &&
  mediaSwift.includes('resolveImdb') &&
  rdSwift.includes('torrentioStreams') && rdSwift.includes('addMagnet') &&
  rdSwift.includes('unrestrict') && rdSwift.includes('appleTranscode') &&
  rdSwift.includes('var status: String') && rdSwift.includes('var progress: Double'));
check('JSON number helper exists so season/premium survive NSNumber boxing',
  modelsSwift.includes('static func int(') && localCore.includes('JSONValue.int(json["season"])'));
check('catalog slugs map to IMDb so fallback posters can play',
  (read(join(ROOT, 'TVM', 'TVMTitle.swift')) ?? '').includes('catalogImdb') &&
  (read(join(ROOT, 'TVM', 'TVMTitle.swift')) ?? '').includes('"fight-club": "tt0137523"'));
check('Continue Watching persists titles and shows after 30 seconds, not 4%',
  (read(join(ROOT, 'TVM', 'TVMStore.swift')) ?? '').includes('recent-media.json') &&
  (read(join(ROOT, 'TVM', 'TVMTitle.swift')) ?? '').includes('entry.position >= 30') &&
  !(read(join(ROOT, 'TVM', 'TVMTitle.swift')) ?? '').includes('value < 0.04') &&
  standaloneTests.includes('testContinueWatchingPersistsSavedTitleAfterThirtySeconds') &&
  standaloneTests.includes('testProgressAppearsAfterThirtySecondsNotFourPercent'));
check('Playback tests select a paid mobile plan before Torrentio',
  standaloneTests.includes('testPlaybackReturnsStreamURLForCatalogSlug') &&
  standaloneTests.includes('setPlan("basic")'));
check('Swift tests mock Torrentio and assert a stream URL',
  standaloneTests.includes('testPlaybackReturnsStreamURLForMockedTorrentioHit') &&
  standaloneTests.includes('testPlaybackReturnsStreamURLForCatalogSlug') &&
  standaloneTests.includes('testPlaybackReturnsStreamURLForSearchTitle') &&
  standaloneTests.includes('testPlaybackReturnsStreamURLForContinueWatchingId') &&
  standaloneTests.includes('testCatalogSlugAsksForRealDebridWhenNoToken') &&
  standaloneTests.includes('MockPlaybackProtocol') &&
  standaloneTests.includes('https://cdn.example/fight-club.mp4'));
check('phoneCanPlay accepts M4V, MOV and Apple HLS MIME',
  modelsSwift.includes('video/x-m4v') && modelsSwift.includes('video/quicktime') &&
  modelsSwift.includes('mpegurl') && standaloneTests.includes('testPhonePlaybackAcceptsM4vMovAndAppleHls'));
check('Windows XCTest-equivalent playback script exists',
  existsSync(join(ROOT, 'standalone-playback.test.mjs')) &&
  (read(join(ROOT, 'standalone-playback.test.mjs')) ?? '').includes('playFromTorrentio'));
check('Info.plist allows media loads and Torrentio TLS',
  (read(join(ROOT, 'TVM', 'Info.plist')) ?? '').includes('NSAllowsArbitraryLoadsForMedia') &&
  (read(join(ROOT, 'TVM', 'Info.plist')) ?? '').includes('torrentio.strem.fun'));
check('bundle-ui.mjs copies the production UI into BundledUI',
  (read(join(ROOT, 'bundle-ui.mjs')) ?? '').includes('@tvm/ui') &&
  (read(join(ROOT, 'bundle-ui.mjs')) ?? '').includes('BundledUI'));
check('BundledUI folder exists', existsSync(join(ROOT, 'TVM', 'BundledUI', 'index.html')),
  'CI/Mac run node apps/ios/bundle-ui.mjs before xcodebuild');
check('FallbackCatalog.json exists so Home can render offline',
  existsSync(join(ROOT, 'TVM', 'FallbackCatalog.json')));
check('FallbackCatalog posters use IMDb ids Torrentio can search',
  (read(join(ROOT, 'TVM', 'FallbackCatalog.json')) ?? '').includes('tt0137523'));
check('WKWebView covers the viewport and reports portrait vs landscape',
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('viewport-fit=cover') &&
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('dataset.orientation'));
check('AppIcon 1024 exists',
  existsSync(join(ROOT, 'TVM', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png')));
check('generate-app-icon.mjs writes AppIcon.png',
  (read(join(ROOT, 'generate-app-icon.mjs')) ?? '').includes('AppIcon.png'));
check('native VLC playback is wired for iPhone',
  (read(join(ROOT, 'Podfile')) ?? '').includes('MobileVLCKit') &&
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('tvmPlayer') &&
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('minimumZoomScale') &&
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('bouncesZoom') &&
  (read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '').includes('user-scalable=no') &&
  (read(join(ROOT, 'TVM', 'TVMPlayerController.swift')) ?? '').includes('VLCMediaPlayer') &&
  (read(join(ROOT, 'TVM', 'TVMPlayerController.swift')) ?? '').includes('TVMChromeView') &&
  (read(join(ROOT, 'TVM', 'TVMPlayerController.swift')) ?? '').includes('tapShield') &&
  (read(join(ROOT, 'TVM', 'TVMPlayerController.swift')) ?? '').includes('muteVideoHits') &&
  (read(join(ROOT, 'TVM', 'TVMPlayerController.swift')) ?? '').includes('tvmNativeShouldFail') &&
  (read(join(REPO, 'apps', 'ui', 'src', 'player', 'engine.ts')) ?? '').includes('iosPlaybackBridge()') &&
  (read(join(REPO, 'apps', 'ui', 'index.html')) ?? '').includes('user-scalable=no'),
  'iPhone must decode in VLC, lock pinch-zoom, and never fall HTML5 MKV into <video>');

// The secrets that must never be committed.
for (const file of swiftFiles) {
  const text = read(file) ?? '';
  const name = relative(ROOT, file).replace(/\\/g, '/');
  check(`${name} contains no hardcoded bearer token`,
    !/Bearer\s+[A-Za-z0-9_\-]{16,}/.test(text),
    'a literal token in source would ship the credential with the app');
  check(`${name} does not disable TLS validation`,
    !/NSURLAuthenticationMethodServerTrust[\s\S]{0,200}\.useCredential/.test(text) &&
    !text.includes('allowsAnyHTTPSCertificate'),
    'certificate validation must stay on');
}

/* -- cross-checks against Core --------------------------------------------
 * The client is useless if it calls an endpoint Core does not serve.
 * TVM_IOS_STRUCT_ONLY=1 skips repo files that may be absent on an IPA-only CI branch.
 */

const connection = read(join(ROOT, 'TVM', 'Connection.swift')) ?? '';
const sessionClient = read(join(ROOT, 'TVM', 'SessionClient.swift')) ?? '';
const server = read(join(REPO, 'apps', 'core', 'src', 'server.ts')) ?? '';
const lanSessions = read(join(REPO, 'apps', 'core', 'src', 'lanSessions.ts')) ?? '';

const pathMatch = /appendingPathComponent\("([^"]+)"\)/.exec(connection);
const clientPath = pathMatch === null ? null : `/${pathMatch[1]}`;
check('optional home-Core client can still build a LAN session URL', clientPath !== null);
if (!STRUCT_ONLY && clientPath !== null) {
  check(`Core serves ${clientPath}`, server.includes(`'${clientPath}'`),
    `apps/core/src/server.ts has no route for ${clientPath}; the app could never connect`);
  check(`Core accepts POST on ${clientPath}`,
    new RegExp(`'${clientPath}'[^\\n]*request\\.method === 'POST'`).test(server));
  check(`Core accepts DELETE on ${clientPath} so Disconnect revokes server-side`,
    new RegExp(`'${clientPath}'[^\\n]*request\\.method === 'DELETE'`).test(server));
}

const cookieMatch = /cookieName\s*=\s*"([^"]+)"/.exec(sessionClient);
const clientCookie = cookieMatch === null ? null : cookieMatch[1];
check('the client names the session cookie', clientCookie !== null);
if (!STRUCT_ONLY && clientCookie !== null) {
  check('the cookie name matches Core',
    lanSessions.includes(`'${clientCookie}'`) || lanSessions.includes(`"${clientCookie}"`),
    `client expects "${clientCookie}" but apps/core/src/lanSessions.ts issues a different name`);
}

check('the client requires an HttpOnly session cookie', sessionClient.includes('isHTTPOnly'));
if (!STRUCT_ONLY) {
  check('Core marks the session cookie HttpOnly', lanSessions.includes('HttpOnly'));
}
check('the client refuses redirects while holding the bearer',
  sessionClient.includes('willPerformHTTPRedirection') && /completionHandler\(nil\)/.test(sessionClient),
  'following a redirect could leak the LAN token to another host');
check('the client stores credentials in the Keychain, not UserDefaults',
  connection.includes('kSecClassGenericPassword') && !/\bUserDefaults\s*\./.test(stripSwiftComments(connection)),
  'the LAN token must live in the Keychain only');
check('Keychain items are device-only and require unlock',
  connection.includes('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'),
  'a weaker accessibility class would sync the LAN token off the device');

const webView = read(join(ROOT, 'TVM', 'TVMWebView.swift')) ?? '';
check('the webview keeps LAN cookies in a non-persistent store',
  webView.includes('.nonPersistent()'),
  'optional home-Core sessions must not leave the LAN cookie on disk');
check('the webview refuses cross-origin navigation',
  webView.includes('isSameOrigin'),
  'a third-party page must never load inside the session-bearing webview');
check('standalone loads the local origin without a LAN cookie',
  webView.includes('session.origin') && webView.includes('session.cookie'),
  'the bundled UI is served from the on-device core');
check('the webview allows inline media playback',
  webView.includes('allowsInlineMediaPlayback'),
  'without it iPhone forces every video fullscreen');
check('the webview requests viewport-fit=cover for safe-area CSS',
  webView.includes('viewport-fit=cover') && webView.includes('WKUserScript'),
  'without it env(safe-area-inset-*) stays 0 under the notch');
check('the webview never auto-insets its own scroll view',
  webView.includes('contentInsetAdjustmentBehavior = .never'),
  'UIKit insetting fights the inner page cameras and breaks 100vw');
check('the webview dismisses the keyboard interactively',
  webView.includes('keyboardDismissMode = .interactive'));
check('the webview publishes keyboard occlusion to --tvm-keyboard and --tvm-keyboard-inset',
  webView.includes('--tvm-keyboard') && webView.includes('--tvm-keyboard-inset') &&
  webView.includes('visualViewport') &&
  webView.includes('keyboardWillChangeFrameNotification'),
  'Search, tokens and checkout fields must scroll above the iOS keyboard');
check('the webview resets the keyboard inset when the keyboard hides',
  webView.includes('keyboardWillHideNotification') &&
  webView.includes('__tvmKeyboardInset'),
  'hiding the keyboard must clear --tvm-keyboard so the page is not left inset');
check('the webview lifts a focused field with scrollIntoView',
  webView.includes('scrollIntoView'));
check('the webview host pins to the window, not the keyboard layout guide',
  webView.includes('additionalSafeAreaInsets') &&
  webView.includes('keyboardLayoutGuide') &&
  webView.includes('bottomAnchor.constraint(equalTo: view.bottomAnchor)'),
  'pinning to keyboardLayoutGuide or extra safe-area insets shrinks the UI into a strip');
check('the player shell ignores keyboard safe-area compression',
  appSource.includes('ignoresSafeArea(.keyboard)') &&
  !/fittedSize\(in:\s*geometry\.size\)/.test(appSource),
  'a 16:9 fit of the leftover height above the keyboard is the 20px-strip bug');
check('ConnectionTests assert portrait+landscape and visualViewport/keyboard handling',
  (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('testIPhoneOrientationsIncludePortraitAndLandscape') &&
  (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('testIPadOrientationsIncludeAllFour') &&
  (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('testKeyboardInsetResetsWhenHiddenAndDoesNotShrinkTheChrome') &&
  (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('PropertyListSerialization') &&
  (read(join(ROOT, 'TVMTests', 'ConnectionTests.swift')) ?? '').includes('UISupportedInterfaceOrientations~ipad'),
  'XCTest must lock orientations from the shipped plist (not idiom-resolved keys) and the keyboard inset reset');

const mainUi = read(join(REPO, 'apps', 'ui', 'src', 'main.tsx')) ?? '';
check('the shared UI starts pointer input for tap-to-select',
  mainUi.includes('startPointerInput'),
  'phones must not require a D-pad hover-focus before a tap opens a title');
check('the shared UI starts the phone visualViewport helper',
  mainUi.includes('startPhoneViewport'));

check('the client sends Authorization: Bearer from the supplied token',
  sessionClient.includes('Bearer \\(connection.token)'),
  'the POST must use the user-supplied LAN token');
check('the client POSTs an empty JSON object',
  sessionClient.includes('Data("{}".utf8)'),
  'Core requires application/json');

if (!STRUCT_ONLY) {
  const applyTheme = read(join(REPO, 'apps', 'ui', 'src', 'theme', 'apply.ts')) ?? '';
  const motionAt = applyTheme.lastIndexOf("import './motion.css'");
  const mobileAt = applyTheme.lastIndexOf("import './mobile.css'");
  check('the shared UI imports mobile.css after motion.css',
    motionAt >= 0 && mobileAt > motionAt,
    'phone WebView would keep the 10-foot layout');
}

/* -- export / archive ------------------------------------------------------ */

for (const name of ['ExportOptions-adhoc.plist', 'ExportOptions-development.plist']) {
  const text = read(join(ROOT, name));
  check(`${name} exists`, text !== null);
  if (text !== null) {
    check(`${name} is well-formed plist XML`, plistLooksValid(text));
    check(`${name} does not embed a team id or certificate`,
      !text.includes('<key>teamID</key>') && !text.includes('DEVELOPMENT_TEAM') &&
      !text.includes('.cer') && !text.includes('PROVISIONING'),
      'signing identities belong to the person building, not the repo');
  }
}

const exportScript = read(join(ROOT, 'export-ipa.sh')) ?? '';
check('export-ipa.sh archives with xcodebuild',
  exportScript.includes('xcodebuild') && exportScript.includes('archive') &&
  exportScript.includes('-destination \'generic/platform=iOS\''));
check('export-ipa.sh exports with -exportArchive and an ExportOptions plist',
  exportScript.includes('-exportArchive') && exportScript.includes('ExportOptions-'));
check('export-ipa.sh refuses to run off macOS',
  exportScript.includes('uname') && exportScript.includes('Darwin'),
  'a Mac-only gate keeps the script from pretending to work on Windows');
const unsignedScript = read(join(ROOT, 'package-unsigned-ipa.sh')) ?? '';
check('package-unsigned-ipa.sh zips Payload/TVM.app',
  unsignedScript.includes('Payload') && unsignedScript.includes('TVM.app') &&
  unsignedScript.includes('.ipa'));
check('package-unsigned-ipa.sh thins Mach-O binaries to arm64',
  unsignedScript.includes('lipo') && unsignedScript.includes('arm64') &&
  unsignedScript.includes('Non-fat file'),
  'Sideloadly rejects MobileVLCKit when it is left as a 1-arch fat/CAFEBABE file');
check('package-unsigned-ipa.sh ad-hoc codesigns nested frameworks',
  unsignedScript.includes('codesign') && unsignedScript.includes('--sign -') &&
  unsignedScript.includes('MobileVLCKit'),
  'an unsigned fat VLC dylib is the Sideloadly "Invalid file" failure');
check('package-unsigned-ipa.sh writes the IPA with ditto, not zip -y',
  unsignedScript.includes('ditto -c -k') && !unsignedScript.includes('zip -'),
  'Info-ZIP -y stores symlinks that Windows Sideloadly cannot re-sign');
const winExport = read(join(ROOT, 'export-ipa.ps1')) ?? '';
check('export-ipa.ps1 exists and refuses Windows xcodebuild',
  winExport.includes('xcodebuild does not run on Windows') && /exit\s+1/.test(winExport));
check('export-ipa.cmd launches export-ipa.ps1',
  (read(join(ROOT, 'export-ipa.cmd')) ?? '').includes('export-ipa.ps1'));
const requestIpa = read(join(ROOT, 'request-ipa.ps1')) ?? '';
check('request-ipa.ps1 downloads the CI artifact without inventing an IPA',
  requestIpa.includes('tvm-ios-unsigned-ipa') && requestIpa.includes('gh run download') &&
  requestIpa.includes('Sideloadly'));

/* -- docs ------------------------------------------------------------------ */

const readme = read(join(ROOT, 'README.md')) ?? '';
for (const match of readme.matchAll(/`node ([^`]+\.mjs)`/g)) {
  const script = match[1].trim().replace(/^apps\/ios\//, '');
  const candidate = existsSync(join(REPO, match[1].trim())) || existsSync(join(ROOT, script));
  check(`README command \`node ${match[1].trim()}\` refers to a real script`, candidate);
}
check('README documents xcodebuild archive + exportArchive',
  readme.includes('xcodebuild') && readme.includes('archive') && readme.includes('-exportArchive'),
  'Mac IPA steps must be copy-pasteable');
check('README states that this Windows tree does not contain an IPA',
  /not produced|cannot compile|cannot run `xcodebuild`|Windows cannot/i.test(readme));
check('README documents Sideloadly or AltStore re-signing',
  /Sideloadly/i.test(readme) && /AltStore/i.test(readme),
  'Windows users need a real re-signer, not a renamed zip');
check('README states the iPhone app is standalone',
  /do not need a PC|standalone/i.test(readme) && /LAN token/i.test(readme));
check('README does not claim App Store signing',
  /not.*App Store/i.test(readme));
check('README documents request-ipa.ps1',
  readme.includes('request-ipa.ps1'));

if (!STRUCT_ONLY) {
  const testing = read(join(REPO, 'docs', 'IOS_TESTING.md')) ?? '';
  check('docs/IOS_TESTING.md exists', testing !== null);
  if (testing !== null) {
    check('IOS_TESTING.md documents export-ipa.sh', testing.includes('export-ipa.sh'));
    check('IOS_TESTING.md documents Sideloadly or AltStore',
      /Sideloadly/i.test(testing) && /AltStore/i.test(testing));
  }
}

/* -- Windows XCTest-equivalent playback contract --------------------------- */

const playbackScript = join(ROOT, 'standalone-playback.test.mjs');
if (existsSync(playbackScript)) {
  const result = spawnSync(process.execPath, [playbackScript], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failedLines = output.split(/\r?\n/).filter((line) => line.includes('FAIL'));
  check('standalone-playback.test.mjs (XCTest-equivalent) exits 0',
    result.status === 0,
    failedLines.join(' | ') || `exit ${result.status ?? 'null'}`);
}

/* -- report ---------------------------------------------------------------- */

for (const message of passes) console.log(`  ok    ${message}`);
for (const message of warnings) console.log(`  warn  ${message}`);
for (const message of failures) console.error(`  FAIL  ${message}`);

console.log('');
console.log(`${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed`);

if (failures.length > 0) {
  console.error('');
  console.error('iOS project validation FAILED.');
  process.exit(1);
}

console.log('');
console.log(STRUCT_ONLY
  ? 'iOS project structure and plists look consistent (TVM_IOS_STRUCT_ONLY=1; Core/UI contract not checked).'
  : 'iOS project structure, plists, standalone core and optional LAN contract look consistent.');
console.log('');
console.log('This is NOT a build, a signature, or a device test. Still required on a Mac:');
console.log('  1. xcodebuild -workspace TVM.xcworkspace -scheme TVM \\');
console.log('       -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO build');
console.log('  2. ./export-ipa.sh development   # or Product > Archive, then sign with your team');
console.log('  3. Work through docs/IOS_TESTING.md on the actual device.');
console.log('  An unsigned CI zip (package-unsigned-ipa.sh) will not install until it is re-signed.');
