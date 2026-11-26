import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');
const functions = (path, names) => names.map((name) => {
  const source = read(path);
  const match = source.match(new RegExp(`^(?:function|sub) ${name}\\([^]*?^end (?:function|sub)`, 'm'));
  assert.ok(match, `${path}: ${name}`);
  return match[0];
}).join('\n');

test('private accounts have no local credential ledger or developer bypass', () => {
  const core = read('source/localCore.brs');
  const accounts = read('source/accountsCore.brs');
  assert.doesNotMatch(core + accounts, /lcVerifyDevCode|passwordHash|passwordSalt|expectedHex|lcLoadAccountStore/);
  for (const file of ['components/TVMScene.brs', 'components/AccountScreen.brs', 'components/HomeScreen.brs', 'components/SettingsScreen.brs']) {
    assert.doesNotMatch(read(file), /ownerDoor|submitDevSignIn|devCode|I'm a dev/);
  }
  assert.match(accounts, /https:\/\/tvm-accounts\.tvm-accounts\.workers\.dev/);
  assert.match(accounts, /sec\.Delete\(key\)/);
  assert.match(read('source/localCore.brs'), /SetCertificatesFile\("common:\/certs\/ca-bundle\.crt"\)/);
  assert.match(read('components/ApiTask.xml'), /extends="Task"/);
  assert.match(read('source/api.brs'), /url = "local:" \+ Mid\(url, at\)/);
});

test('Extras observers, settings and remote actions are connected to the player and scene', () => {
  const scene = read('components/TVMScene.brs');
  const player = read('components/PlayerScreen.brs');
  const extras = read('components/PlayerExtras.brs');
  assert.match(scene, /loadHomeExtras\(payload\)/);
  assert.match(scene, /loadDetailsExtras\(task\.json\)/);
  assert.match(player, /content\.subtitleTracks = m\.extraTracks/);
  assert.match(extras, /m\.video\.content\.subtitleTracks = m\.extraTracks/);
  assert.match(extras, /applySubtitle\(asText\(aaGet\(track, "TrackName", ""\)\), false\)/);
  assert.match(player, /m\.video\.subtitleTrack = trackId/);
  assert.match(extras, /m\.upCancelled = true/);
  assert.match(player, /m\.skipSeen\[segment\.key\]\.TotalMilliseconds\(\) < 8000/);
  assert.doesNotMatch(player, /return 90|m\.position < 90/);
  assert.match(player, /playerExtrasTask\("\/api\/extras\/progress"/);
  assert.match(read('components/TVMFeatures.brs'), /name = "stats"/);
  assert.match(read('components/TVMExtras.brs'), /task\.profileId <> m\.profileId/);
});

// Execute the shipped BrightScript functions, replacing only device/network I/O.
// Like the required compiler check, this uses a pinned, cached npx tool.
test('production BrightScript handles accounts, provider fixtures, skips and local stats', { timeout: 120000 }, () => {
  const directory = mkdtempSync(join(root, 'scripts', '.extras-test-'));
  try {
    const source = [
      read('source/media.brs'),
      functions('source/localCore.brs', ['lcAaGet', 'lcAaText', 'lcAaInt', 'lcAaBool', 'lcMetaToItem']),
      functions('source/accountsCore.brs', ['lcAccountsHttp', 'lcAccountsError', 'lcPublicAccount', 'lcAccountUsable', 'lcRegisterAccount', 'lcSignInAccount', 'lcAcceptTerms', 'lcGetAccount', 'lcSanitizeDeviceClient', 'lcDeviceStart', 'lcDevicePoll']),
      functions('source/extrasCore.brs', ['lcExtrasImdb', 'lcExtrasEpisode', 'lcExtrasSegments', 'lcExtrasSubtitleUrl', 'lcExtrasSubtitles', 'lcExtrasCollection', 'lcExtrasUpcoming', 'lcExtrasNext', 'lcRecordWatch', 'lcExtrasStats']),
      functions('components/PlayerExtras.brs', ['playerSegment', 'extrasCreditsReached', 'measureWatchTime']),
      functions('components/PlayerScreen.brs', ['skipRecapAllowed', 'skipRecapTarget']),
      read('scripts/fixtures/extras-runtime.brs'),
    ].join('\n');
    const file = join(directory, 'main.brs');
    writeFileSync(file, source, 'utf8');
    const command = "npx --yes brs@0.45.0 main.brs";
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: directory })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', file], { encoding: 'utf8', timeout: 110000, cwd: directory });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /FAIL:|error|cannot|not supported/i);
    assert.match(result.stdout, /EXTRAS_RUNTIME_OK/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
