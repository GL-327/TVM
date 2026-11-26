// Port of the pure parts of apps/roku/source/controlCentre.brs (player Control
// Centre: row models, device eligibility, track labels, handoff state machine,
// focus and auto-close rules). Runs the shared fixture
// scripts/fixtures/controlCentre-cases.json against the JS port.
// Run: node --test apps/roku/scripts/controlCentre.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const cases = JSON.parse(read('./fixtures/controlCentre-cases.json'));

// ---- Ports of media.brs / hub.brs helpers the module depends on ----

const asText = (x) => (x === null || x === undefined ? '' : String(x));
// BrightScript associative arrays are case-insensitive.
const aaGet = (obj, key, fallback) => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return fallback;
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) {
      const v = obj[k];
      return v === null || v === undefined ? fallback : v;
    }
  }
  return fallback;
};
const hubNum = (v) => (typeof v === 'number' ? v : 0);
const hubPlatformGlyph = (p) => (p === 'roku' || p === 'android-tv' ? 'tv' : p === 'windows' ? 'laptop' : p === 'web' ? 'web' : 'phone');
const hubHasCap = (device, cap) => aaGet(device, 'capabilities', []).includes(cap);
const hubIsOnline = (device) => {
  const state = asText(aaGet(device, 'state', 'unknown'));
  if (asText(aaGet(device, 'presence', '')) === 'offline') return false;
  return state === 'idle' || state === 'playing' || state === 'paused';
};
const hubReasonText = (reason) =>
  ({
    not_ready: 'Nothing is ready to control there',
    unsupported: 'That device cannot do this',
    target_offline: 'The device is offline',
    expired: 'It took too long',
    invalid_payload: 'The device could not read the request',
    device_revoked: 'The device was removed',
  })[reason] ?? 'The device said no';
const hubCommandText = (status, reason) => {
  if (status === 'pending') return 'Sending...';
  if (status === 'accepted') return 'Received';
  if (status === 'applied') return 'Done';
  if (status === 'timed_out') return 'No response in time';
  if (status === 'rejected') return hubReasonText(reason);
  return '';
};
const hubSendErrorText = (statusCode, errorCode) => {
  if (errorCode === 'target_offline') return 'The device is offline';
  if (errorCode === 'unsupported') return 'That device cannot do this';
  if (errorCode === 'not_found') return 'That device is gone';
  if (errorCode === 'device_revoked') return 'This Roku was removed';
  if (statusCode === 0) return 'Could not reach Core';
  return 'Could not send';
};
// FormatJson key order follows insertion, which is what the BrightScript side produces here.
const hubCommandBody = (idempotencyKey, target, action, payload, ttlSec) => {
  const body = { v: 1, idempotencyKey, target, action, ttlSec };
  if (payload !== null && payload !== undefined) body.payload = payload;
  return JSON.stringify(body);
};
const hubCapabilities = () => ['playback.pause_resume', 'playback.seek', 'playback.skip', 'nav.dpad', 'nav.select', 'nav.back', 'play.title', 'handoff.send', 'input.physical'];

// ---- Ports of controlCentre.brs ----

export const ccTabIds = () => ['playback', 'audio', 'devices'];
export const ccTabLabels = () => ['Playback', 'Audio & Subtitles', 'Devices'];
export const ccSeekDelta = () => 10;
export const ccIdleCloseMs = () => 10000;
export const ccHandoffTimeoutMs = () => 40000;
export const ccFocusKey = (tabId, rowId) => `cc:${tabId}:${rowId}`;

const ccRow = (id, label, glyph, trailing, enabled, detail) => ({ kind: 'row', id, label, detail, glyph, trailing, enabled, checked: false, small: false });
const ccHeader = (id, label, detail) => ({ kind: 'header', id, label, detail, glyph: '', trailing: 'none', enabled: false, checked: false, small: false });
const ccNote = (id, label) => {
  const row = ccRow(id, label, '', 'none', false, '');
  row.small = label.length > 30;
  return row;
};

export function ccPlaybackRows(state) {
  const rows = [];
  const playing = aaGet(state, 'playing', false) === true;
  const live = aaGet(state, 'live', false) === true;
  const delta = String(ccSeekDelta());
  rows.push(playing ? ccRow('toggle', 'Pause', 'pause', 'none', true, '') : ccRow('toggle', 'Play', 'play', 'none', true, ''));
  const liveReason = live ? 'Live TV' : '';
  rows.push(ccRow('back', `Back ${delta} seconds`, 'rewind', 'none', !live, liveReason));
  rows.push(ccRow('forward', `Forward ${delta} seconds`, 'forward', 'none', !live, liveReason));
  rows.push(ccRow('restart', 'Start over', 'restart', 'none', !live, liveReason));
  if (aaGet(state, 'hasNext', false) === true) rows.push(ccRow('next', 'Next episode', 'forward', 'chevron', true, asText(aaGet(state, 'nextTitle', ''))));
  if (!live && aaGet(state, 'hasVersions', false) === true) {
    rows.push(ccRow('versions', 'Versions', 'apps', 'chevron', true, asText(aaGet(state, 'versionLabel', ''))));
  }
  if (aaGet(state, 'sleepEnabled', false) === true) {
    const detail = asText(aaGet(state, 'sleepLabel', 'Off')) || 'Off';
    rows.push(ccRow('sleep', 'Sleep timer', '', 'chevron', true, detail));
  }
  return rows;
}

export function ccSleepLabel(mode, remaining = 0) {
  if (mode === 'end') return 'End of episode';
  if (remaining > 0) {
    const mins = Math.floor((remaining + 59) / 60);
    return mins <= 1 ? '1 min left' : `${mins} min left`;
  }
  if (['15', '30', '45', '60'].includes(mode)) return `${mode} min`;
  return 'Off';
}

export function ccSleepRows(currentMode, isSeries = false) {
  const rows = [ccHeader('hdr:sleep', 'Sleep timer', 'Stop playback automatically')];
  const opts = [
    { id: 'off', label: 'Off', detail: 'Do not stop automatically' },
    { id: '15', label: '15 minutes', detail: '' },
    { id: '30', label: '30 minutes', detail: '' },
    { id: '45', label: '45 minutes', detail: '' },
    { id: '60', label: '60 minutes', detail: '' },
  ];
  if (isSeries) opts.push({ id: 'end', label: 'End of episode', detail: 'Stop when this episode finishes' });
  for (const opt of opts) {
    const chosen = opt.id === currentMode;
    const r = ccRow(`sleep:${opt.id}`, opt.label, '', chosen ? 'check' : 'none', true, opt.detail);
    r.checked = chosen;
    rows.push(r);
  }
  rows.push(ccRow('sleep:back', 'Back', 'back', 'none', true, ''));
  return rows;
}

const LANGUAGES = {
  en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', fr: 'French', fra: 'French', fre: 'French',
  de: 'German', deu: 'German', ger: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese',
  nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', sv: 'Swedish', swe: 'Swedish', da: 'Danish', dan: 'Danish',
  no: 'Norwegian', nor: 'Norwegian', nb: 'Norwegian', nob: 'Norwegian', fi: 'Finnish', fin: 'Finnish',
  pl: 'Polish', pol: 'Polish', ru: 'Russian', rus: 'Russian', tr: 'Turkish', tur: 'Turkish', ar: 'Arabic', ara: 'Arabic',
  he: 'Hebrew', heb: 'Hebrew', hi: 'Hindi', hin: 'Hindi', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean',
  zh: 'Chinese', zho: 'Chinese', chi: 'Chinese',
};
export const ccLanguageName = (code) => LANGUAGES[code.trim().toLowerCase()] ?? '';

export function ccTrackLabel(track, index) {
  let name = asText(aaGet(track, 'name', '')).trim();
  const language = asText(aaGet(track, 'language', '')).trim();
  let langName = ccLanguageName(language);
  if (langName === '' && language !== '' && language.toLowerCase() !== 'und') langName = language;
  const lname = name.toLowerCase();
  if (lname === 'und' || lname === 'unknown' || lname === language.toLowerCase()) name = '';
  if (name !== '' && langName !== '') {
    if (lname.includes(langName.toLowerCase())) return name;
    return `${langName} (${name})`;
  }
  if (name !== '') return name;
  if (langName !== '') return langName;
  return `Track ${index + 1}`;
}

export function ccNormalizeAudio(raw) {
  const out = [];
  for (const t of raw ?? []) {
    const id = asText(aaGet(t, 'Track', ''));
    if (id !== '') out.push({ id, name: asText(aaGet(t, 'Name', '')), language: asText(aaGet(t, 'Language', '')) });
  }
  return out;
}

export function ccNormalizeSubs(raw) {
  const out = [];
  for (const t of raw ?? []) {
    const id = asText(aaGet(t, 'TrackName', ''));
    if (id !== '') out.push({ id, name: asText(aaGet(t, 'Description', '')), language: asText(aaGet(t, 'Language', '')) });
  }
  return out;
}

export function ccSubtitleCurrent(captionMode, currentTrack, tracks) {
  if (captionMode.toLowerCase() !== 'on') return { off: true, id: '' };
  let id = currentTrack;
  if (id === '' && tracks.length > 0) id = tracks[0].id;
  if (id === '') return { off: true, id: '' };
  return { off: false, id };
}

export function ccAudioRows(tracks, currentId) {
  const rows = [ccHeader('audio-head', 'Audio', '')];
  if (tracks.length === 0) {
    rows.push(ccNote('audio-none', 'No other audio tracks'));
    return rows;
  }
  const current = currentId === '' ? tracks[0].id : currentId;
  tracks.forEach((t, i) => {
    const row = ccRow(`audio:${t.id}`, ccTrackLabel(t, i), '', 'none', true, '');
    row.checked = t.id === current;
    if (row.checked) row.trailing = 'check';
    rows.push(row);
  });
  return rows;
}

export function ccSubtitleRows(tracks, subState) {
  const rows = [ccHeader('subs-head', 'Subtitles', '')];
  if (tracks.length === 0) {
    rows.push(ccNote('subs-none', 'No subtitles for this title'));
    return rows;
  }
  const off = ccRow('sub:off', 'Off', '', 'none', true, '');
  off.checked = aaGet(subState, 'off', true) === true;
  if (off.checked) off.trailing = 'check';
  rows.push(off);
  tracks.forEach((t, i) => {
    const row = ccRow(`sub:${t.id}`, ccTrackLabel(t, i), '', 'none', true, '');
    row.checked = aaGet(subState, 'off', true) !== true && t.id === asText(aaGet(subState, 'id', ''));
    if (row.checked) row.trailing = 'check';
    rows.push(row);
  });
  return rows;
}

export const ccCaptionInfoRow = () => ({ kind: 'info', id: 'caption-style', label: 'Caption style: Roku Settings › Accessibility', detail: '', glyph: '', trailing: 'none', enabled: false, checked: false, small: true });

export function ccIsVod(mediaKind, mediaId) {
  if (mediaKind.toLowerCase() === 'live') return false;
  if (mediaId.startsWith('live:')) return false;
  return true;
}

export function ccVisibleDevices(devices, currentId) {
  const out = [];
  for (const d of devices ?? []) {
    const id = asText(aaGet(d, 'id', ''));
    const state = asText(aaGet(d, 'state', 'unknown'));
    const isThis = aaGet(d, 'isCurrent', false) === true || (currentId !== '' && id === currentId);
    if (!isThis && state !== 'revoked' && id !== '') out.push(d);
  }
  return out;
}

export function ccDeviceReason(device) {
  if (!hubIsOnline(device)) return 'Offline';
  if (!hubHasCap(device, 'play.title')) return "Can't play titles";
  return '';
}

export function ccDeviceRows(ctx) {
  const fixture = aaGet(ctx, 'fixture', false) === true;
  const rows = [ccHeader('devices-head', 'Continue on', fixture ? 'Demo data' : '')];
  if (aaGet(ctx, 'live', false) === true) {
    rows.push(ccNote('live-na', "Continue on another device isn't available for Live TV yet"));
  } else if (aaGet(ctx, 'signedIn', false) !== true) {
    rows.push(ccNote('signin', 'Sign in to TVM to continue on another device.'));
  } else {
    const status = asText(aaGet(ctx, 'status', 'loading'));
    if (status === 'loading') {
      rows.push(ccNote('loading', 'Looking for your devices...'));
    } else if (status === 'error') {
      rows.push(ccNote('error', asText(aaGet(ctx, 'errorText', 'TVM Hub could not load. Retry in a moment.'))));
    } else {
      const visible = ccVisibleDevices(aaGet(ctx, 'devices', []), asText(aaGet(ctx, 'currentId', '')));
      const handoff = aaGet(ctx, 'handoff', {});
      const active = [];
      const inactive = [];
      for (const d of visible) {
        const id = asText(aaGet(d, 'id', ''));
        const reason = ccDeviceReason(d);
        const glyph = hubPlatformGlyph(asText(aaGet(d, 'platform', '')));
        const name = asText(aaGet(d, 'name', 'Device'));
        if (reason === '') {
          const row = ccRow(`dev:${id}`, name, glyph, 'chevron', true, fixture ? 'Demo' : '');
          const phase = asText(aaGet(handoff, 'phase', 'idle'));
          if (asText(aaGet(handoff, 'deviceId', '')) === id && phase !== 'idle') {
            row.detail = asText(aaGet(handoff, 'text', ''));
            row.trailing = phase === 'failed' ? 'chevron' : 'none';
          }
          active.push(row);
        } else {
          inactive.push(ccRow(`dev:${id}`, name, glyph, 'none', false, reason));
        }
      }
      rows.push(...active, ...inactive);
      if (visible.length === 0) rows.push(ccNote('none', 'No other devices are linked yet.'));
    }
  }
  rows.push(ccRow('hub', 'Open TVM Hub', 'dots', 'chevron', true, ''));
  return rows;
}

export const ccInFlight = (phase) => phase === 'sending' || phase === 'accepted';

export function ccHandoffStep(phase, ev, name, fixture) {
  const res = { phase, text: '', final: false, changed: false };
  if (phase === 'applied') return res;
  const kind = asText(aaGet(ev, 'kind', ''));
  if (kind === 'start') {
    if (ccInFlight(phase)) return res;
    return { phase: 'sending', text: hubCommandText('pending', ''), final: false, changed: true };
  }
  if (!ccInFlight(phase)) return res;
  if (kind === 'sendError') {
    const text = hubSendErrorText(Math.floor(hubNum(aaGet(ev, 'statusCode', 0))), asText(aaGet(ev, 'error', '')));
    return { phase: 'failed', text, final: true, changed: true };
  }
  if (kind === 'timeout') return { phase: 'failed', text: hubCommandText('timed_out', ''), final: true, changed: true };
  if (kind === 'pollError') {
    if (Math.floor(hubNum(aaGet(ev, 'statusCode', 0))) === 404) return { phase: 'failed', text: hubCommandText('rejected', 'not_found'), final: true, changed: true };
    return res;
  }
  if (kind === 'status') {
    const status = asText(aaGet(ev, 'status', 'pending'));
    if (status === 'applied') return { phase: 'applied', text: fixture ? `Demo: playing on ${name}` : `Playing on ${name}`, final: true, changed: true };
    if (status === 'rejected' || status === 'timed_out') return { phase: 'failed', text: hubCommandText(status, asText(aaGet(ev, 'reason', ''))), final: true, changed: true };
    if (status === 'accepted' && phase === 'sending') return { phase: 'accepted', text: hubCommandText('accepted', ''), final: false, changed: true };
  }
  return res;
}

export function ccFixtureStatus(elapsedMs) {
  if (elapsedMs >= 1500) return 'applied';
  if (elapsedMs >= 500) return 'accepted';
  return 'pending';
}

export function ccHandoffBody(idempotencyKey, target, mediaId, positionSec) {
  let pos = Math.floor(positionSec);
  if (pos < 0) pos = 0;
  return hubCommandBody(idempotencyKey, target, 'play.title', { mediaId, positionSec: pos }, 30);
}

export function ccMoveFocus(rows, index, intent) {
  const count = rows.length;
  if (intent === 'down') {
    for (let j = index + 1; j < count; j += 1) if (rows[j].kind === 'row') return { index: j, edge: '' };
    return { index, edge: '' };
  }
  if (intent === 'up') {
    for (let j = index - 1; j >= 0; j -= 1) if (rows[j].kind === 'row') return { index: j, edge: '' };
    return { index, edge: 'top' };
  }
  return { index, edge: '' };
}

export const ccFirstFocusable = (rows) => rows.findIndex((r) => r.kind === 'row');
export function ccIndexOfId(rows, id) {
  const i = rows.findIndex((r) => r.id === id && r.kind === 'row');
  return i >= 0 ? i : ccFirstFocusable(rows);
}
export const ccShouldAutoClose = (idleMs, phase) => !ccInFlight(phase) && idleMs >= ccIdleCloseMs();

// ---- Compact views for the shared cases ----

const view = (rows) => rows.map((r) => [r.kind, r.id, r.label, r.detail, r.glyph, r.trailing, r.enabled, r.checked, r.small].join('|'));

// ---- Tests ----

test('constants', () => {
  assert.deepEqual(ccTabIds(), cases.constants.tabIds);
  assert.deepEqual(ccTabLabels(), cases.constants.tabLabels);
  assert.equal(ccSeekDelta(), 10);
  assert.equal(ccIdleCloseMs(), 10000);
  assert.equal(ccFocusKey('devices', 'dev:inst_bed'), 'cc:devices:dev:inst_bed');
});

test('handoff.send is advertised', () => {
  assert.ok(hubCapabilities().includes('handoff.send'));
  assert.ok(hubCapabilities().includes('play.title'));
});

for (const c of cases.playbackRows) test(`playbackRows: ${c.name}`, () => assert.deepEqual(view(ccPlaybackRows(c.state)), c.expected));
for (const c of cases.trackLabel) test(`trackLabel: ${c.name}`, () => assert.equal(ccTrackLabel(c.track, c.index), c.expected));
for (const c of cases.normalize) {
  test(`normalize: ${c.name}`, () => {
    assert.deepEqual(ccNormalizeAudio(c.audio), c.expectedAudio);
    assert.deepEqual(ccNormalizeSubs(c.subs), c.expectedSubs);
  });
}
for (const c of cases.subtitleCurrent) test(`subtitleCurrent: ${c.name}`, () => assert.deepEqual(ccSubtitleCurrent(c.mode, c.current, c.tracks), c.expected));
for (const c of cases.audioRows) test(`audioRows: ${c.name}`, () => assert.deepEqual(view(ccAudioRows(c.tracks, c.current)), c.expected));
for (const c of cases.subtitleRows) test(`subtitleRows: ${c.name}`, () => assert.deepEqual(view(ccSubtitleRows(c.tracks, c.sub)), c.expected));
test('caption info row', () => assert.deepEqual(view([ccCaptionInfoRow()]), cases.captionInfo));
for (const c of cases.isVod) test(`isVod: ${c.kind}/${c.id}`, () => assert.equal(ccIsVod(c.kind, c.id), c.expected));
for (const c of cases.visibleDevices) test(`visibleDevices: ${c.name}`, () => assert.deepEqual(ccVisibleDevices(c.devices, c.currentId).map((d) => d.id), c.expected));
for (const c of cases.deviceRows) test(`deviceRows: ${c.name}`, () => assert.deepEqual(view(ccDeviceRows(c.ctx)), c.expected));

for (const c of cases.handoff) {
  test(`handoff: ${c.name}`, () => {
    let phase = 'idle';
    c.steps.forEach((s, i) => {
      const res = ccHandoffStep(phase, s.event, c.deviceName, c.fixture === true);
      assert.deepEqual({ phase: res.phase, text: res.text, final: res.final, changed: res.changed }, s.expected, `step ${i}`);
      phase = res.phase;
    });
  });
}
for (const c of cases.fixtureStatus) test(`fixtureStatus: ${c.ms}`, () => assert.equal(ccFixtureStatus(c.ms), c.expected));
for (const c of cases.handoffBody) test(`handoffBody: ${c.name}`, () => assert.deepEqual(JSON.parse(ccHandoffBody(c.key, c.target, c.mediaId, c.position)), c.expected));
for (const c of cases.moveFocus) test(`moveFocus: ${c.name}`, () => assert.deepEqual(ccMoveFocus(c.rows, c.index, c.intent), c.expected));
for (const c of cases.indexOfId) test(`indexOfId: ${c.name}`, () => assert.equal(ccIndexOfId(c.rows, c.id), c.expected));
for (const c of cases.autoClose) test(`autoClose: ${c.idleMs}/${c.phase}`, () => assert.equal(ccShouldAutoClose(c.idleMs, c.phase), c.expected));

test('playbackRows with versions and sleep timer enabled', () => {
  const rows = ccPlaybackRows({
    playing: true,
    hasNext: false,
    live: false,
    hasVersions: true,
    versionLabel: '4K · REMUX',
    sleepEnabled: true,
    sleepLabel: '30 min left',
  });
  assert.ok(rows.some((r) => r.id === 'versions' && r.detail === '4K · REMUX' && r.trailing === 'chevron'));
  assert.ok(rows.some((r) => r.id === 'sleep' && r.detail === '30 min left' && r.trailing === 'chevron'));
  const liveRows = ccPlaybackRows({ playing: true, live: true, hasVersions: true, sleepEnabled: true, sleepLabel: 'Off' });
  assert.ok(!liveRows.some((r) => r.id === 'versions'));
  assert.ok(liveRows.some((r) => r.id === 'sleep' && r.detail === 'Off'));
});

test('sleep timer labels and option rows', () => {
  assert.equal(ccSleepLabel('off', 0), 'Off');
  assert.equal(ccSleepLabel('30', 0), '30 min');
  assert.equal(ccSleepLabel('30', 725), '13 min left');
  assert.equal(ccSleepLabel('15', 30), '1 min left');
  assert.equal(ccSleepLabel('end', 0), 'End of episode');
  const movieRows = ccSleepRows('30', false);
  assert.equal(movieRows.some((r) => r.id === 'sleep:end'), false);
  assert.equal(movieRows.find((r) => r.id === 'sleep:30')?.checked, true);
  const seriesRows = ccSleepRows('end', true);
  assert.equal(seriesRows.find((r) => r.id === 'sleep:end')?.checked, true);
});
