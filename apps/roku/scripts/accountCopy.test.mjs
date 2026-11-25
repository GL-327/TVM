import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  accountStatusLabel,
  devicePollAction,
  formatPence,
  friendlyAccountError,
  friendlyPlanName,
  isRecommendedTier,
  sanitizeDeviceClient,
  shortDateText,
  shortDisplayUrl,
  tierDisplayName,
  validateEmailInput,
  validatePasswordInput,
  yearlySavingsPercent,
} from './accountCopy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('account copy maps states, plans, dates, prices, and errors without raw codes', () => {
  assert.equal(validateEmailInput(''), 'Enter your email address.');
  assert.equal(validateEmailInput('bad'), 'Check the email address. It should look like name@example.com.');
  assert.equal(validateEmailInput('alex@example.com'), '');

  assert.equal(validatePasswordInput('', false), 'Enter your password.');
  assert.equal(validatePasswordInput('short', true), 'Use at least 10 characters.');
  assert.equal(validatePasswordInput('longenoughpw', true), '');

  assert.equal(accountStatusLabel({ signedIn: false }), 'Signed out');
  assert.equal(accountStatusLabel({ signedIn: true, account: { activated: false, suspended: false }, usable: { reason: 'awaiting_activation' } }), 'Waiting for approval');
  assert.equal(accountStatusLabel({ signedIn: true, account: { activated: true, suspended: false }, usable: { reason: 'terms_required' } }), 'Accept the terms to continue');
  assert.equal(accountStatusLabel({ signedIn: true, account: { activated: false, suspended: true }, usable: { reason: 'suspended' } }), 'Paused by the owner');
  assert.equal(accountStatusLabel({ signedIn: true, account: { activated: true, suspended: false }, usable: { reason: 'ok' } }), 'Active');

  assert.equal(friendlyPlanName('stream'), 'Stream');
  assert.equal(friendlyPlanName('stream-live'), 'Stream + Live');
  assert.equal(friendlyPlanName(null), 'No active plan');

  for (const [raw, status] of [
    ['invalid', 401],
    ['rate_limited', 429],
    ['accounts_unavailable', 503],
    ['http_500', 500],
    ['428', 428],
    ['weird_snake_token', 0],
  ]) {
    const msg = friendlyAccountError(raw, status, 'signin');
    assert.ok(!/\b[45]\d{2}\b/.test(msg), `must not leak raw status in ${msg}`);
    assert.ok(!/_/.test(msg), `must not leak snake_case in ${msg}`);
  }

  assert.deepEqual(devicePollAction(428, 'pending', 5), { action: 'wait', interval: 5, message: 'Waiting for you…' });
  assert.deepEqual(devicePollAction(429, 'slow_down', 5), { action: 'wait', interval: 10, message: 'Waiting for you…' });
  assert.deepEqual(devicePollAction(429, 'rate_limited', 5), { action: 'stop', interval: 5, message: 'Too many attempts. Wait a few minutes, then try again.' });
  assert.deepEqual(devicePollAction(410, 'expired', 5), { action: 'refresh', interval: 5, message: 'Your code expired. Here is a new one.' });
  assert.deepEqual(devicePollAction(0, 'timeout', 5), { action: 'wait', interval: 5, message: 'Checking connection…' });
  assert.deepEqual(devicePollAction(200, '', 5), { action: 'approved', interval: 5, message: '' });

  assert.equal(sanitizeDeviceClient('Living room\nRoku\t1'), 'Living roomRoku1');
  assert.equal(sanitizeDeviceClient('   \n  '), 'TVM Roku');
  assert.equal(shortDisplayUrl('https://tvm-accounts.tvm-accounts.workers.dev/link/'), 'tvm-accounts.tvm-accounts.workers.dev/link');
  assert.equal(shortDateText('2026-08-14T10:00:00Z'), '14 Aug 2026');
  assert.equal(formatPence(1000), '£10');
  assert.equal(formatPence(1299), '£12.99');
  assert.equal(tierDisplayName('stream-live'), 'Stream + Live');
  assert.equal(yearlySavingsPercent([{ monthlyPence: 1000, yearlyPence: 9000 }]), 25);
  assert.equal(isRecommendedTier({ id: 'stream' }, [{ id: 'stream', orderable: true }, { id: 'stream-live', orderable: false, availability: 'Coming soon' }]), true);
  assert.equal(isRecommendedTier({ id: 'stream-live', orderable: true }, [{ id: 'stream', orderable: true }, { id: 'stream-live', orderable: true, availability: 'available' }]), true);
});

test('BrightScript accountCopy.brs matches JS reference across all helpers', { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(root, 'scripts', '.copy-test-'));
  try {
    const brs = [
      read('source/media.brs'),
      read('source/accountCopy.brs'),
      `
      sub check(cond as Boolean, label as String)
        if not cond then print "FAIL: " + label
      end sub
      sub Main()
        check(validateEmailInput("") = "${validateEmailInput('')}", "empty email")
        check(validateEmailInput("bad@x") = "${validateEmailInput('bad@x')}", "bad email")
        check(validateEmailInput("alex@example.com") = "", "good email")
        check(validatePasswordInput("", false) = "${validatePasswordInput('', false)}", "empty pw")
        check(validatePasswordInput("123456789", true) = "${validatePasswordInput('123456789', true)}", "short pw")
        check(validatePasswordInput("1234567890", true) = "", "good pw")
        check(accountStatusLabel({ signedIn: false }) = "Signed out", "signed out")
        check(accountStatusLabel({ signedIn: true, account: { activated: false, suspended: false }, usable: { reason: "awaiting_activation" } }) = "Waiting for approval", "waiting")
        check(accountStatusLabel({ signedIn: true, account: { activated: false, suspended: true }, usable: { reason: "suspended" } }) = "Paused by the owner", "paused")
        check(accountStatusLabel({ signedIn: true, account: { activated: true, suspended: false }, usable: { reason: "terms_required" } }) = "Accept the terms to continue", "terms")
        check(accountStatusLabel({ signedIn: true, account: { activated: true, suspended: false }, usable: { reason: "ok" } }) = "Active", "active")
        check(friendlyPlanName("stream-live") = "Stream + Live", "plan name")
        check(friendlyAccountError("rate_limited", 429, "signin") = "${friendlyAccountError('rate_limited', 429, 'signin')}", "rate limit")
        check(friendlyAccountError("invalid", 401, "signin") = "${friendlyAccountError('invalid', 401, 'signin')}", "invalid signin")
        pollWait = devicePollAction(428, "pending", 5)
        check(pollWait.action = "wait" and pollWait.interval = 5, "poll pending")
        pollSlow = devicePollAction(429, "slow_down", 5)
        check(pollSlow.action = "wait" and pollSlow.interval = 10, "poll slow_down")
        pollExp = devicePollAction(410, "expired", 5)
        check(pollExp.action = "refresh", "poll expired")
        check(sanitizeDeviceClient("  ") = "TVM Roku", "sanitize empty")
        check(shortDisplayUrl("https://tvm-accounts.tvm-accounts.workers.dev/link") = "tvm-accounts.tvm-accounts.workers.dev/link", "short url")
        check(shortDateText("2026-08-14T10:00:00Z") = "14 Aug 2026", "short date")
        check(formatPence(1000) = "£10" and formatPence(1299) = "£12.99", "pence")
        check(yearlySavingsPercent([{ monthlyPence: 1000, yearlyPence: 9000 }]) = 25, "savings")
        print "COPY_RUNTIME_OK"
      end sub
      `,
    ].join('\n');

    writeFileSync(join(dir, 'main.brs'), brs, 'utf8');
    const command = 'npx --yes brs@0.45.0 main.brs';
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: dir })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', 'main.brs'], { encoding: 'utf8', timeout: 110000, cwd: dir });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /FAIL:/);
    assert.match(result.stdout, /COPY_RUNTIME_OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
