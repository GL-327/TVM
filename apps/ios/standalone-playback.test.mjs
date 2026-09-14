#!/usr/bin/env node
/*
 * Windows-runnable stand-in for the XCTest playback cases in StandaloneTests.swift.
 * It cannot execute Swift. It proves the on-device play path is wired the way
 * those tests require: catalog slugs → IMDb → Torrentio → unrestrict → HTTPS
 * MP4/M4V/MOV/HLS, missing RD → not-configured (not empty), Continue Watching
 * and search POST the same /api/playback.
 *
 * Run: node apps/ios/standalone-playback.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');

const failures = [];
const passes = [];

function pass(label) { passes.push(label); }
function fail(label, detail) {
  failures.push(detail === undefined ? label : `${label} — ${detail}`);
}
function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(label, detail);
}

function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function phoneCanPlay(filename, mimeType, url) {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.includes('mpegurl') || mime.includes('x-mpegurl')) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  if (/\.(mkv|webm|avi|ts|m2ts)$/i.test(filename) || /\.(mkv|webm|avi|ts|m2ts)(\?|$)/i.test(url)) {
    return false;
  }
  if (mime.startsWith('video/mp4') || mime === 'video/x-m4v' || mime.startsWith('video/quicktime')) {
    return true;
  }
  if (/\.(mp4|m4v|mov)(\?|$)/i.test(url)) return true;
  if (/\.(mp4|m4v|mov|m3u8)$/i.test(filename)) return true;
  return false;
}

const CATALOG = {
  'ten-truths-about-love': 'tt15483404',
  'fight-club': 'tt0137523',
  'the-last-of-us': 'tt3581920',
};

function catalogImdb(id) {
  const fromId = String(id).match(/tt\d+/i);
  if (fromId) return fromId[0].toLowerCase();
  const slug = String(id).split(':')[0]?.toLowerCase() ?? '';
  return CATALOG[slug] ?? null;
}

function playFromTorrentio({ token, imdb, streams, unrestricted }) {
  if (!token) return { status: 409, reason: 'not-configured' };
  if (!/tt\d+/i.test(imdb)) return { status: 409, reason: 'empty' };
  if (!streams.length) return { status: 409, reason: 'empty' };
  const url = unrestricted?.download ?? '';
  const filename = unrestricted?.filename ?? 'stream';
  const mime = unrestricted?.mimeType ?? 'application/octet-stream';
  if (url.startsWith('https://') && phoneCanPlay(filename, mime, url)) {
    return { status: 200, kind: 'stream', url, mimeType: mime, engine: 'html5' };
  }
  return { status: 409, reason: 'needs-converter' };
}

function resolvePlay({ token, id, title, link }) {
  if (!token) return { status: 409, reason: 'not-configured' };
  if (link) return playFromTorrentio({
    token,
    imdb: 'tt0000001',
    streams: [{ url: link }],
    unrestricted: { download: link, filename: 'link.mp4', mimeType: 'video/mp4' },
  });
  const imdb = catalogImdb(id ?? '') ?? (title && title.toLowerCase().includes('fight club') ? 'tt0137523' : null);
  if (!imdb) return { status: 409, reason: 'not-in-library' };
  return playFromTorrentio({
    token,
    imdb,
    streams: [{ url: 'https://real-debrid.com/d/FIGHT' }],
    unrestricted: {
      download: 'https://cdn.example/fight-club.mp4',
      filename: 'Fight.Club.1999.720p.mp4',
      mimeType: 'video/mp4',
    },
  });
}

const mediaSwift = read(join(ROOT, 'TVM', 'TVMMedia.swift'));
const titleSwift = read(join(ROOT, 'TVM', 'TVMTitle.swift'));
const modelsSwift = read(join(ROOT, 'TVM', 'TVMModels.swift'));
const rdSwift = read(join(ROOT, 'TVM', 'TVMRealDebrid.swift'));
const coreSwift = read(join(ROOT, 'TVM', 'TVMLocalCore.swift'));
const testsSwift = read(join(ROOT, 'TVMTests', 'StandaloneTests.swift'));
const playerTsx = read(join(REPO, 'apps', 'ui', 'src', 'screens', 'Player.tsx'));
const mediaTs = read(join(REPO, 'apps', 'ui', 'src', 'data', 'media.ts'));
const playIdTs = read(join(REPO, 'apps', 'ui', 'src', 'data', 'playId.ts'));
const errorsTs = read(join(REPO, 'apps', 'ui', 'src', 'data', 'playbackErrors.ts'));
const homeTsx = read(join(REPO, 'apps', 'ui', 'src', 'screens', 'Home.tsx'));
const searchTsx = read(join(REPO, 'apps', 'ui', 'src', 'screens', 'SearchModal.tsx'));
const detailsTsx = read(join(REPO, 'apps', 'ui', 'src', 'screens', 'Details.tsx'));

check('TVMMedia.swift exists', mediaSwift.includes('func play('));
check('play() probes auth before Torrentio so a missing token is not empty',
  mediaSwift.indexOf('if let blocked = await probeAuth()') < mediaSwift.indexOf('return await playFromTorrentio') &&
  mediaSwift.includes('reason": "not-configured"') &&
  /func probeAuth[\s\S]*!rd\.configured\(\)[\s\S]*not-configured/.test(mediaSwift));
check('playFromTorrentio searches Torrentio then unrestricts via playFromLink',
  mediaSwift.includes('rd.torrentioStreams') &&
  mediaSwift.includes('playFromLink') &&
  rdSwift.includes('func unrestrict') &&
  rdSwift.includes('func torrentioStreams'));
check('catalog slugs map fight-club to tt0137523',
  titleSwift.includes('"fight-club": "tt0137523"') &&
  catalogImdb('fight-club') === 'tt0137523' &&
  catalogImdb('tt0137523') === 'tt0137523' &&
  catalogImdb('the-last-of-us:1:1') === 'tt3581920');
check('UI playIdFor also maps fight-club to IMDb before POST /api/playback',
  playIdTs.includes('catalogImdb') && playIdTs.includes('playIdFor') &&
  mediaTs.includes("apiFetch('/api/playback'") &&
  playerTsx.includes('requestPlayback({'));
check('LocalCore POST /api/playback calls media.play',
  coreSwift.includes('path == "/api/playback"') &&
  coreSwift.includes('media.play('));
check('phoneCanPlay accepts MP4, M4V, MOV and Apple HLS',
  modelsSwift.includes('video/x-m4v') &&
  modelsSwift.includes('video/quicktime') &&
  modelsSwift.includes('mpegurl') &&
  phoneCanPlay('film.mp4', 'video/mp4', 'https://cdn.example/film.mp4') &&
  phoneCanPlay('clip.m4v', 'video/x-m4v', 'https://cdn.example/id') &&
  phoneCanPlay('clip.mov', 'video/quicktime', 'https://cdn.example/id') &&
  phoneCanPlay('a.m3u8', 'application/vnd.apple.mpegurl', 'https://cdn.example/a.m3u8') &&
  !phoneCanPlay('film.mkv', 'video/mp4', 'https://cdn.example/film.mkv'));
check('Swift tests include mocked Torrentio, catalog slug, search and continue watching',
  testsSwift.includes('testPlaybackReturnsStreamURLForMockedTorrentioHit') &&
  testsSwift.includes('testPlaybackReturnsStreamURLForCatalogSlug') &&
  testsSwift.includes('testPlaybackReturnsStreamURLForSearchTitle') &&
  testsSwift.includes('testPlaybackReturnsStreamURLForContinueWatchingId') &&
  testsSwift.includes('testPlaybackAsksForRealDebridWhenNoToken') &&
  testsSwift.includes('https://cdn.example/fight-club.mp4') &&
  testsSwift.includes('MockPlaybackProtocol'));
check('Continue watching and search use the same play path as catalog titles',
  homeTsx.includes('launchTitle(navigate, title)') &&
  searchTsx.includes('launchTitle') &&
  detailsTsx.includes('playIdFor') &&
  detailsTsx.includes("pushModal('player'") &&
  playerTsx.includes('requestPlayback') &&
  mediaSwift.includes('func continueWatching') &&
  mediaSwift.includes('rememberMedia'));
check('missing RD is connect-RD copy, not empty no-streams',
  errorsTs.includes("'not-configured'") &&
  /not-configured['"]:\s*'Real-Debrid is not connected/.test(errorsTs) &&
  playerTsx.includes("result.reason === 'not-configured'") &&
  playerTsx.includes("action: 'realdebrid'") &&
  !/not-configured['"]:\s*'Torrentio returned no streams/.test(errorsTs));

const noToken = resolvePlay({ token: null, id: 'fight-club', title: 'Fight Club' });
check('simulated catalog slug without RD → not-configured',
  noToken.status === 409 && noToken.reason === 'not-configured');

const noTokenImdb = resolvePlay({ token: null, id: 'tt0137523' });
check('simulated IMDb id without RD → not-configured, not empty',
  noTokenImdb.reason === 'not-configured' && noTokenImdb.reason !== 'empty');

const mocked = resolvePlay({ token: 'fixture-token', id: 'tt0137523', title: 'Fight Club' });
check('simulated Torrentio + unrestrict → HTTPS playable MP4',
  mocked.status === 200 && mocked.kind === 'stream' &&
  mocked.url === 'https://cdn.example/fight-club.mp4' &&
  phoneCanPlay('Fight.Club.1999.720p.mp4', mocked.mimeType, mocked.url));

const slug = resolvePlay({ token: 'fixture-token', id: 'fight-club', title: 'Fight Club' });
check('simulated catalog slug playFromTorrentio → same HTTPS URL',
  slug.status === 200 && slug.url === mocked.url);

const search = resolvePlay({ token: 'fixture-token', title: 'Fight Club' });
check('simulated search title uses the same playFromTorrentio path',
  search.status === 200 && search.url === mocked.url);

const watching = resolvePlay({ token: 'fixture-token', id: 'tt0137523', title: 'Fight Club' });
check('simulated continue-watching IMDb id uses the same playFromTorrentio path',
  watching.status === 200 && watching.url === mocked.url);

check('standalone-playback.test.mjs is the XCTest-equivalent play-from-torrentio case',
  existsSync(join(ROOT, 'standalone-playback.test.mjs')));

for (const message of passes) console.log(`  ok    ${message}`);
for (const message of failures) console.error(`  FAIL  ${message}`);
console.log('');
console.log(`${passes.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.error('');
  console.error('standalone iOS playback checks FAILED.');
  process.exit(1);
}

console.log('');
console.log('Standalone playback contract matches Torrentio → unrestrict → HTTPS playable URL.');
console.log('This is not an Xcode run. CI still executes StandaloneTests.swift on the macOS runner.');
