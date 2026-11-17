// Port of the pure parts of apps/roku/source/hub.brs (TVM Hub client helpers).
// Runs the shared fixture scripts/fixtures/hub-cases.json against the JS port,
// and checks that the bundled demo data is a copy of scripts/fixtures/hub-fixture.json.
// Run: node --test apps/roku/scripts/hub.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const cases = JSON.parse(read('./fixtures/hub-cases.json'));

// ---- Ports of hub.brs ----

const asText = (x) => (x === null || x === undefined ? '' : String(x));
const aaGet = (obj, key, fallback) => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return fallback;
  const v = obj[key];
  return v === null || v === undefined ? fallback : v;
};
const hubNum = (v) => (typeof v === 'number' ? v : 0);

export function hubErrorKind(statusCode) {
  if (statusCode === 404 || statusCode === 503) return 'unavailable';
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 0) return 'offline';
  if (statusCode === 429) return 'limited';
  return 'error';
}

export function hubDaysFromCivil(y, m, d) {
  if (m <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function hubParseIso(text) {
  if (text.length < 19) return null;
  if (text[4] !== '-' || text[7] !== '-') return null;
  if (text[10] !== 'T' || text[13] !== ':' || text[16] !== ':') return null;
  const y = parseFloat(text.slice(0, 4));
  const mo = parseFloat(text.slice(5, 7));
  const d = parseFloat(text.slice(8, 10));
  const h = parseFloat(text.slice(11, 13));
  const mi = parseFloat(text.slice(14, 16));
  const s = parseFloat(text.slice(17, 19));
  if (!(y >= 1970) || !(mo >= 1) || mo > 12 || !(d >= 1) || d > 31) return null;
  return { days: hubDaysFromCivil(Math.floor(y), Math.floor(mo), Math.floor(d)), tod: Math.floor(h) * 3600 + Math.floor(mi) * 60 + Math.floor(s) };
}

export function hubAgeSeconds(thenIso, nowIso) {
  const a = hubParseIso(thenIso);
  const b = hubParseIso(nowIso);
  if (!a || !b) return -1;
  const age = (b.days - a.days) * 86400 + (b.tod - a.tod);
  return age < 0 ? 0 : age;
}

export function hubAgeText(ageSec) {
  if (ageSec < 0) return '';
  if (ageSec < 10) return 'just now';
  if (ageSec < 60) return `${ageSec} s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)} min ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)} h ago`;
  return `${Math.floor(ageSec / 86400)} d ago`;
}

export function hubLastSeenText(device, serverTime) {
  const seen = asText(aaGet(device, 'lastSeenAt', ''));
  if (seen === '') return 'Never seen';
  let age = hubAgeSeconds(seen, serverTime);
  if (age < 0) {
    const fallback = aaGet(device, 'lastSeenAgeSec', undefined);
    if (fallback === undefined) return 'Seen earlier';
    age = Math.floor(hubNum(fallback));
  }
  return hubAgeText(age);
}

const pad2 = (n) => String(n).padStart(2, '0');

export function hubClock(totalSec) {
  if (totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec - h * 3600) / 60);
  const s = totalSec - h * 3600 - m * 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function hubStateLabel(state) {
  return { playing: 'Playing', paused: 'Paused', idle: 'Idle', offline: 'Offline', revoked: 'Removed' }[state] ?? 'Unknown';
}

export function hubPlatformGlyph(platform) {
  if (platform === 'roku' || platform === 'android-tv') return 'tv';
  if (platform === 'windows') return 'laptop';
  if (platform === 'web') return 'web';
  return 'phone';
}

export function hubPlatformName(platform) {
  return { roku: 'Roku', windows: 'Windows', web: 'Web', android: 'Android', 'android-tv': 'Android TV', ios: 'iPhone or iPad' }[platform] ?? 'Device';
}

export function hubHasCap(device, cap) {
  return aaGet(device, 'capabilities', []).includes(cap);
}

export function hubIsOnline(device) {
  const state = asText(aaGet(device, 'state', 'unknown'));
  const presence = asText(aaGet(device, 'presence', ''));
  if (presence === 'offline') return false;
  return state === 'idle' || state === 'playing' || state === 'paused';
}

export function hubActionsFor(device, fixture) {
  const out = [];
  const state = asText(aaGet(device, 'state', 'unknown'));
  if (state === 'revoked') return out;
  const current = aaGet(device, 'isCurrent', false) === true;
  const online = hubIsOnline(device);
  if (!current) {
    if (hubHasCap(device, 'playback.pause_resume')) {
      if (state === 'paused') out.push({ id: 'resume', label: 'Resume', enabled: online && !fixture, reason: '' });
      else out.push({ id: 'pause', label: 'Pause', enabled: online && state === 'playing' && !fixture, reason: '' });
    }
    if (hubHasCap(device, 'nav.dpad')) out.push({ id: 'remote', label: 'Open remote', enabled: online && !fixture, reason: '' });
  }
  out.push({ id: 'rename', label: 'Rename', enabled: !fixture, reason: '' });
  out.push({ id: 'room', label: 'Set room', enabled: !fixture, reason: '' });
  if (current) out.push({ id: 'signout', label: 'Sign out', enabled: !fixture, reason: '' });
  else out.push({ id: 'remove', label: 'Remove device', enabled: !fixture, reason: '' });
  for (const a of out) {
    if (!a.enabled) {
      if (fixture) a.reason = 'Demo data';
      else if (a.id === 'pause' || a.id === 'resume' || a.id === 'remote') a.reason = online ? 'Not playing' : 'Offline';
    }
  }
  return out;
}

export function hubNowPlayingView(np) {
  if (np === null || np === undefined || typeof np !== 'object') return null;
  if (aaGet(np, 'restricted', false) === true) return null;
  const title = asText(aaGet(np, 'title', ''));
  if (title === '') return null;
  const pos = Math.floor(hubNum(aaGet(np, 'positionSec', 0)));
  const dur = Math.floor(hubNum(aaGet(np, 'durationSec', 0)));
  let progress = 0;
  if (dur > 0) {
    progress = pos / dur;
    if (progress > 1) progress = 1;
  }
  return { title, posText: hubClock(pos), durText: dur > 0 ? hubClock(dur) : '', progressPct: Math.floor(progress * 100 + 0.5) };
}

export function hubBefore(a, b, key) {
  const an = asText(aaGet(a, 'name', '')).toLowerCase();
  const bn = asText(aaGet(b, 'name', '')).toLowerCase();
  if (key === 'seen') {
    const sa = asText(aaGet(a, 'lastSeenAt', ''));
    const sb = asText(aaGet(b, 'lastSeenAt', ''));
    if (sa !== sb) {
      if (sa === '') return false;
      if (sb === '') return true;
      return sa > sb;
    }
  } else if (key === 'room') {
    const ra = asText(aaGet(a, 'room', '')).toLowerCase();
    const rb = asText(aaGet(b, 'room', '')).toLowerCase();
    if (ra !== rb) {
      if (ra === '') return false;
      if (rb === '') return true;
      return ra < rb;
    }
  }
  if (an !== bn) return an < bn;
  return asText(aaGet(a, 'id', '')) < asText(aaGet(b, 'id', ''));
}

export function hubSortDevices(devices, key) {
  const out = [];
  for (const d of devices) {
    let at = out.length;
    for (let i = 0; i < out.length; i += 1) {
      if (hubBefore(d, out[i], key)) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, d);
  }
  return out;
}

export function hubReasonText(reason) {
  return (
    {
      not_ready: 'Nothing is ready to control there',
      unsupported: 'That device cannot do this',
      target_offline: 'The device is offline',
      expired: 'It took too long',
      invalid_payload: 'The device could not read the request',
      device_revoked: 'The device was removed',
    }[reason] ?? 'The device said no'
  );
}

export function hubCommandText(status, reason) {
  if (status === 'pending') return 'Sending...';
  if (status === 'accepted') return 'Received';
  if (status === 'applied') return 'Done';
  if (status === 'timed_out') return 'No response in time';
  if (status === 'rejected') return hubReasonText(reason);
  return '';
}

export function hubSendErrorText(statusCode, errorCode) {
  if (errorCode === 'target_offline') return 'The device is offline';
  if (errorCode === 'unsupported') return 'That device cannot do this';
  if (errorCode === 'not_found') return 'That device is gone';
  if (errorCode === 'device_revoked') return 'This Roku was removed';
  if (statusCode === 0) return 'Could not reach Core';
  return 'Could not send';
}

export function hubActionCap(action) {
  return (
    {
      'playback.pause': 'playback.pause_resume',
      'playback.resume': 'playback.pause_resume',
      'playback.seek': 'playback.seek',
      'playback.skip': 'playback.skip',
      'nav.dpad': 'nav.dpad',
      'nav.select': 'nav.select',
      'nav.back': 'nav.back',
      'play.title': 'play.title',
      'play.live_channel': 'play.live_channel',
    }[action] ?? ''
  );
}

export function hubRemoteCommand(intent, device) {
  let action = '';
  let payload = {};
  let label = '';
  if (['up', 'down', 'left', 'right'].includes(intent)) {
    action = 'nav.dpad';
    payload = { direction: intent };
    label = intent;
  } else if (intent === 'select') {
    action = 'nav.select';
    label = 'OK';
  } else if (intent === 'info') {
    action = 'nav.back';
    label = 'Back';
  } else if (intent === 'play' || intent === 'pause') {
    if (asText(aaGet(device, 'state', '')) === 'paused') {
      action = 'playback.resume';
      label = 'Resume';
    } else {
      action = 'playback.pause';
      label = 'Pause';
    }
  } else if (intent === 'rewind') {
    action = 'playback.skip';
    payload = { deltaSec: -10 };
    label = 'Back 10 s';
  } else if (intent === 'fastForward') {
    action = 'playback.skip';
    payload = { deltaSec: 10 };
    label = 'Forward 10 s';
  }
  if (action === '') return { ok: false, action: '', payload: {}, label: '', reason: 'ignored' };
  if (!hubHasCap(device, hubActionCap(action))) return { ok: false, action, payload, label, reason: 'unsupported' };
  return { ok: true, action, payload, label, reason: '' };
}

const none = { kind: '' };
export function hubDecide(cmd, ctx) {
  const action = asText(aaGet(cmd, 'action', ''));
  const payload = aaGet(cmd, 'payload', {});
  if (action === 'playback.pause' || action === 'playback.resume') {
    if (!ctx.playerOpen) return { status: 'rejected', reason: 'not_ready', effect: none };
    return { status: 'applied', reason: '', effect: { kind: action === 'playback.resume' ? 'resume' : 'pause' } };
  }
  if (action === 'playback.seek') {
    if (!ctx.playerOpen) return { status: 'rejected', reason: 'not_ready', effect: none };
    if (aaGet(payload, 'positionSec', undefined) === undefined) return { status: 'rejected', reason: 'invalid_payload', effect: none };
    const pos = hubNum(aaGet(payload, 'positionSec', 0));
    if (pos < 0) return { status: 'rejected', reason: 'invalid_payload', effect: none };
    return { status: 'applied', reason: '', effect: { kind: 'seek', positionSec: pos } };
  }
  if (action === 'playback.skip') {
    if (!ctx.playerOpen) return { status: 'rejected', reason: 'not_ready', effect: none };
    if (aaGet(payload, 'deltaSec', undefined) === undefined) return { status: 'rejected', reason: 'invalid_payload', effect: none };
    let delta = hubNum(aaGet(payload, 'deltaSec', 0));
    if (delta > 3600) delta = 3600;
    if (delta < -3600) delta = -3600;
    return { status: 'applied', reason: '', effect: { kind: 'skip', deltaSec: delta } };
  }
  if (action === 'nav.dpad') {
    const dir = asText(aaGet(payload, 'direction', ''));
    if (!['up', 'down', 'left', 'right'].includes(dir)) return { status: 'rejected', reason: 'invalid_payload', effect: none };
    return { status: 'applied', reason: '', effect: { kind: 'intent', intent: dir } };
  }
  if (action === 'nav.select') return { status: 'applied', reason: '', effect: { kind: 'intent', intent: 'select' } };
  if (action === 'nav.back') return { status: 'applied', reason: '', effect: { kind: 'intent', intent: 'back' } };
  if (action === 'play.title') {
    const mediaId = asText(aaGet(payload, 'mediaId', ''));
    if (mediaId === '') return { status: 'rejected', reason: 'invalid_payload', effect: none };
    if (!ctx.mayNavigate) return { status: 'rejected', reason: 'not_ready', effect: none };
    return { status: 'applied', reason: '', effect: { kind: 'play', mediaId, positionSec: hubNum(aaGet(payload, 'positionSec', 0)) } };
  }
  return { status: 'rejected', reason: 'unsupported', effect: none };
}

export function hubActivityText(event) {
  const kind = asText(aaGet(event, 'type', ''));
  const actor = aaGet(event, 'actor', {});
  const target = aaGet(event, 'target', {});
  let actorName = asText(aaGet(actor, 'name', ''));
  let targetName = asText(aaGet(target, 'name', ''));
  if (targetName === '') targetName = 'A device';
  if (actorName === '') actorName = 'Someone';
  const map = {
    'device.linked': `${targetName} was linked`,
    'device.signed_in': `${targetName} signed in`,
    'device.renamed': `${targetName} was renamed`,
    'device.room': `${targetName} moved room`,
    'device.revoked': `${targetName} was removed`,
    'device.signed_out': `${targetName} signed out`,
    'pair.approved': `${actorName} approved ${targetName}`,
    'pair.denied': `${actorName} denied ${targetName}`,
    'command.sent': `${actorName} sent a command to ${targetName}`,
    'command.applied': `${targetName} ran a command`,
    'command.rejected': `${targetName} refused a command`,
    'command.timed_out': `${targetName} did not answer a command`,
  };
  return map[kind] ?? `Activity on ${targetName}`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hubPairNormalize(text) {
  let out = '';
  for (const ch of text.toUpperCase()) if (ALPHABET.includes(ch)) out += ch;
  return out.length > 8 ? out.slice(0, 8) : out;
}

export function hubPairFormat(code) {
  const c = hubPairNormalize(code);
  return c.length <= 4 ? c : `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function hubPairComplete(code) {
  return hubPairNormalize(code).length === 8;
}

export function hubPairErrorText(statusCode, errorCode) {
  if (statusCode === 429 || errorCode === 'rate_limited') return 'Too many wrong codes. Wait 15 minutes and try again.';
  if (errorCode === 'expired' || errorCode === 'expired_token') return 'That code has expired. Ask the other device for a new one.';
  if (statusCode === 404 || errorCode === 'not_found') return 'That code was not found. Check it and try again.';
  if (statusCode === 401 || errorCode === 'auth_required') return 'Sign in again to approve a device.';
  if (statusCode === 0) return 'Could not reach Core.';
  return 'Could not check that code.';
}

export function hubPairPollNext(interval, errorCode) {
  if (interval < 1) interval = 5;
  if (errorCode === 'authorization_pending') return { action: 'wait', interval, reason: '' };
  if (errorCode === 'slow_down') return { action: 'wait', interval: interval + 5, reason: '' };
  if (errorCode === 'access_denied') return { action: 'stop', interval, reason: 'denied' };
  if (errorCode === 'expired_token') return { action: 'stop', interval, reason: 'expired' };
  return { action: 'stop', interval, reason: 'error' };
}

// ---- Fixture-driven tests ----

for (const c of cases.age) {
  test(`age: ${c.name}`, () => assert.equal(hubAgeSeconds(c.then, c.now), c.expected));
}
for (const c of cases.ageText) test(`ageText: ${c.sec}`, () => assert.equal(hubAgeText(c.sec), c.expected));
for (const c of cases.clock) test(`clock: ${c.sec}`, () => assert.equal(hubClock(c.sec), c.expected));
for (const c of cases.lastSeen) {
  test(`lastSeen: ${c.name}`, () => assert.equal(hubLastSeenText(c.device, c.serverTime), c.expected));
}
for (const c of cases.state) test(`state: ${c.state}`, () => assert.equal(hubStateLabel(c.state), c.label));
for (const c of cases.platform) {
  test(`platform: ${c.platform}`, () => {
    assert.equal(hubPlatformGlyph(c.platform), c.glyph);
    assert.equal(hubPlatformName(c.platform), c.name);
  });
}
for (const c of cases.actions) {
  test(`actions: ${c.name}`, () => {
    const got = hubActionsFor(c.device, c.fixture).map((a) => ({ id: a.id, enabled: a.enabled, reason: a.reason }));
    assert.deepEqual(got, c.expected);
  });
}
for (const c of cases.nowPlaying) test(`nowPlaying: ${c.name}`, () => assert.deepEqual(hubNowPlayingView(c.np), c.expected));
for (const c of cases.sort) {
  test(`sort: ${c.name}`, () => assert.deepEqual(hubSortDevices(c.devices, c.key).map((d) => d.id), c.expected));
}
for (const c of cases.decide) test(`decide: ${c.name}`, () => assert.deepEqual(hubDecide(c.cmd, c.ctx), c.expected));
for (const c of cases.commandText) {
  test(`commandText: ${c.status}/${c.reason}`, () => assert.equal(hubCommandText(c.status, c.reason), c.expected));
}
for (const c of cases.sendError) test(`sendError: ${c.status}/${c.code}`, () => assert.equal(hubSendErrorText(c.status, c.code), c.expected));
for (const c of cases.errorKind) test(`errorKind: ${c.status}`, () => assert.equal(hubErrorKind(c.status), c.expected));
for (const c of cases.activity) test(`activity: ${c.type}`, () => assert.equal(hubActivityText(c), c.expected));
for (const c of cases.pairNormalize) test(`pairNormalize: "${c.text}"`, () => assert.equal(hubPairNormalize(c.text), c.expected));
for (const c of cases.pairFormat) test(`pairFormat: "${c.text}"`, () => assert.equal(hubPairFormat(c.text), c.expected));
for (const c of cases.pairComplete) test(`pairComplete: "${c.text}"`, () => assert.equal(hubPairComplete(c.text), c.expected));
for (const c of cases.pairError) test(`pairError: ${c.status}/${c.code}`, () => assert.equal(hubPairErrorText(c.status, c.code), c.expected));
for (const c of cases.pairPoll) test(`pairPoll: ${c.interval}/${c.code}`, () => assert.deepEqual(hubPairPollNext(c.interval, c.code), c.expected));

for (const c of cases.actionCap) test(`actionCap: ${c.action}`, () => assert.equal(hubActionCap(c.action), c.expected));
for (const c of cases.remote) test(`remote: ${c.name}`, () => assert.deepEqual(hubRemoteCommand(c.intent, c.device), c.expected));

// ---- Demo data ----

test('bundled demo data is an exact copy of the fixture', () => {
  assert.equal(read('../source/data/hubFixture.json'), read('./fixtures/hub-fixture.json'));
});

test('demo data follows the contract shape: unique slots, one current device, scoped nowPlaying', () => {
  const data = JSON.parse(read('./fixtures/hub-fixture.json'));
  assert.equal(data.v, 1);
  assert.ok(data.devices.length >= 7, 'enough devices to show More devices');
  const slots = data.devices.map((d) => d.slot);
  assert.equal(new Set(slots).size, slots.length);
  const current = data.devices.filter((d) => d.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, data.currentInstallationId);
  assert.ok(data.devices.some((d) => d.nowPlaying && d.nowPlaying.restricted === true));
  assert.ok(data.devices.some((d) => d.nowPlaying && d.nowPlaying.title));
  for (const d of data.devices) {
    assert.ok(['idle', 'playing', 'paused', 'offline', 'unknown', 'revoked'].includes(d.state), d.state);
    assert.ok(d.name.length >= 1);
  }
  for (const e of data.activity.events) {
    assert.ok(hubActivityText(e) !== '', e.type);
    assert.ok(!('title' in (e.detail ?? {})), 'activity must not log titles');
  }
});
