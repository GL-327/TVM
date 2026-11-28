import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const functions = (file, names) => names.map(name => {
  const match = read(file).match(new RegExp(`^(?:function|sub) ${name}\\([^]*?^end (?:function|sub)`, 'm'));
  assert.ok(match, `${file}: ${name}`);
  return match[0];
}).join('\n');
const handler = (file, name) => functions(`components/${file}.brs`, ['onKeyEvent']).replace('function onKeyEvent(', `function ${name}(`);

test('Roku settings expose supported categories and extras with descriptions', () => {
  const source = read('components/SettingsScreen.brs');
  for (const category of ['Playback', 'Audio & subtitles', 'Appearance', 'Home screen', 'Extras', 'Live TV', 'Real-Debrid', 'Updates', 'About', 'Developer']) {
    assert.ok(source.includes(`name: "${category}"`), category);
  }
  for (const id of ['onlineSubtitles', 'collections', 'comingUp', 'watchStats', 'animeTitles', 'ratings', 'qualityBadges', 'versionPicker', 'spoilerBlur', 'surpriseMe', 'autoCollections', 'sleepTimer', 'announcements']) {
    assert.match(source, new RegExp(`extraRow\\("${id}", "[^"]+", "[^"]+", (?:true|false)\\)`));
  }
  for (const id of ['trailers', 'trailerBackdrops', 'seekPreviews', 'themeSongs', 'nightMode', 'pauseOnMinimize', 'shortcutsOverlay']) {
    assert.ok(!source.includes(`extraRow("${id}"`), id);
  }
  assert.match(source, /if m\.top\.admin/);
});

test('settings and profile controls fit the TV canvas and keep their remote controls', () => {
  const source = read('components/SettingsScreen.brs');
  assert.match(source, /lastCategory = first \+ 11/);
  assert.ok(100 + 310 + 11 * 125 + 109 < 2160);
  assert.ok(136 + 252 + 8 * 176 + 194 < 2160);
  assert.match(source, /if selectKey then settingsEmit\("prefOptions"/);
  assert.match(source, /if m\.focusSide then return false/);
  assert.match(source, /m\.movedSection = row\.section/);
  const profile = read('components/TVMFeatures.brs');
  assert.match(profile, /id: "kids"[^\n]+control: "switch"/);
  assert.match(profile, /id: "age"[^\n]+control: "segments"[^\n]+\[7, 12, 15, 18\]/);
  assert.match(read('components/AvatarPicker.brs'), /maskSize = \[192, 192\]/);
  assert.match(read('components/PinPanel.brs'), /for i = 0 to 3/);
});

test('version picker stays inside playback and forwards injected remote keys', () => {
  const player = read('components/PlayerScreen.brs');
  assert.match(player, /kind = "openVersions"\s+openPlayerVersions\(\)/);
  assert.match(player, /m\.qualityPanel\.remoteIntent = intent/);
  const quality = read('components/PlayerQuality.brs');
  assert.match(quality, /if returnToMenu then openCC\(\)/);
  assert.match(quality, /emit\("version", \{ versionId: row\.id, position: m\.position \}\)/);
  assert.match(read('components/ControlCentre.brs'), /closePanel\("versions"\)\s+emit\("openVersions"/);
});

test('glass uses the shared rim, a small art decode, and an opaque accessibility fallback', () => {
  assert.match(read('components/GlassPanel.xml'), /loadWidth="96" loadHeight="54"/);
  assert.match(read('components/GlassPanel.brs'), /if tvmReduceTransparency\(\) then tint = Left\(tint, 8\) \+ "FF"/);
  assert.match(read('components/NavStrip.xml'), /id="pillGlass"[^>]+tintColor="0x12141AFF"/);
  assert.match(read('components/GlassOverlay.xml'), /GlassPanel id="material"/);
  assert.doesNotMatch(read('components/GlassOverlay.xml'), /cornerRadius/);
});

test('production Roku key paths, release queue, pagination, ranking and RD key refresh', { timeout: 120000 }, () => {
  const parent = realpathSync(join(root, 'scripts'));
  const directory = mkdtempSync(join(parent, '.roku143-test-'));
  try {
    const source = [
      read('source/media.brs'), read('source/intents.brs'), read('source/textPages.brs'),
      functions('source/localCore.brs', ['lcAaGet', 'lcAaText', 'lcAaInt', 'lcAaBool', 'lcRdTokenInfo']),
      functions('source/accountsCore.brs', ['lcResolveAccount']),
      functions('source/contentCore.brs', ['lcIncludes']),
      read('source/playbackCore.brs').replaceAll('CreateObject("roDeviceInfo")', 'fakeDeviceInfo()'),
      functions('components/SettingsScreen.brs', ['settingIndex', 'activeSetting', 'changeSetting', 'settingsEmit']),
      handler('SettingsScreen', 'settingsKey'),
      functions('components/GuideGrid.brs', ['guideClamp', 'guideFocused', 'guideHorizontal', 'guideProgrammes', 'epoch', 'iso', 'guideChannelName', 'guideEmit', 'watchChannel', 'guideDay']),
      handler('GuideGrid', 'guideKey'),
      handler('NoticePanel', 'noticeKey'),
      functions('components/AvatarPicker.brs', ['currentAvatars']),
      handler('AvatarPicker', 'avatarKey'),
      functions('components/TVMReleaseFeatures.brs', ['maybeShowPatchNotes', 'maybeShowReleaseCards', 'patchNotesBody', 'releaseTouchesRoku', 'releaseHighlights', 'dismissReleaseCards']),
      read('scripts/fixtures/roku143-runtime.brs'),
    ].join('\n');
    writeFileSync(join(directory, 'main.brs'), source, 'utf8');
    const command = 'npx --yes brs@0.45.0 main.brs';
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: directory })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', 'main.brs'], { encoding: 'utf8', timeout: 110000, cwd: directory });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /FAIL:|error|cannot|not supported/i);
    assert.match(result.stdout, /ROKU143_RUNTIME_OK/);
  } finally {
    assert.ok(realpathSync(directory).startsWith(parent + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
