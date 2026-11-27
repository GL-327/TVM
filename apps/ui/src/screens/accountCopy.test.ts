import { describe, expect, it } from 'vitest';
import {
  accountStatusLabel,
  friendlyAccountError,
  friendlyPlanName,
  friendlyProcessorReason,
  validateEmailInput,
  validatePasswordInput,
} from './accountCopy';

describe('accountCopy validation', () => {
  it('validates email addresses with plain-language messages', () => {
    expect(validateEmailInput('')).toBe('Enter your email address.');
    expect(validateEmailInput('   ')).toBe('Enter your email address.');
    expect(validateEmailInput('not-an-email')).toBe('Check the email address. It should look like name@example.com.');
    expect(validateEmailInput('user@example.com')).toBeNull();
  });

  it('validates passwords for sign-in and account creation', () => {
    expect(validatePasswordInput('', false)).toBe('Enter your password.');
    expect(validatePasswordInput('short', false)).toBeNull();
    expect(validatePasswordInput('', true)).toBe('Use at least 10 characters.');
    expect(validatePasswordInput('123456789', true)).toBe('Use at least 10 characters.');
    expect(validatePasswordInput('1234567890', true)).toBeNull();
  });
});

describe('accountCopy status & error mapping', () => {
  it('maps every backend account state without leaking raw codes', () => {
    expect(accountStatusLabel({ signedIn: false, account: null, usable: { ok: false, reason: 'no_account' } })).toBe('Signed out');

    const baseAccount = {
      id: 'acc_1',
      email: 'a@example.com',
      displayName: 'Alex',
      role: 'member' as const,
      activated: false,
      tier: null,
      suspended: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      termsVersion: null,
      termsAcceptedAt: null,
      emailVerified: true,
      emailCodeSent: false,
      rdKey: false,
    };

    expect(accountStatusLabel({ signedIn: true, account: baseAccount, usable: { ok: false, reason: 'awaiting_activation' } })).toBe('Waiting for approval');
    expect(accountStatusLabel({ signedIn: true, account: { ...baseAccount, suspended: true }, usable: { ok: false, reason: 'suspended' } })).toBe('Paused by the owner');
    expect(accountStatusLabel({ signedIn: true, account: { ...baseAccount, activated: true, tier: 'stream' }, usable: { ok: false, reason: 'terms_required' } })).toBe('Accept the terms to continue');
    expect(accountStatusLabel({ signedIn: true, account: { ...baseAccount, emailVerified: false }, usable: { ok: false, reason: 'email_unverified' } })).toBe('Confirm your email to continue');
    expect(accountStatusLabel({ signedIn: true, account: { ...baseAccount, activated: true, tier: 'stream-live' }, usable: { ok: true, reason: null } })).toBe('Active');
  });

  it('maps plan names and stripe processor reasons cleanly', () => {
    expect(friendlyPlanName('stream')).toBe('Stream');
    expect(friendlyPlanName('stream-live')).toBe('Stream + Live');
    expect(friendlyPlanName(null)).toBe('No active plan');

    expect(friendlyProcessorReason('absent')).not.toContain('absent');
    expect(friendlyProcessorReason('malformed')).not.toContain('malformed');
    expect(friendlyProcessorReason('mismatched_mode')).not.toContain('mismatched_mode');
    expect(friendlyProcessorReason('stripe_test')).not.toContain('stripe_test');
  });

  it('never passes raw error codes or HTTP status numbers through to the UI', () => {
    const rawInputs = [
      'invalid',
      'accounts_unavailable',
      'rate_limited',
      'forbidden',
      'moved',
      'developer_required',
      'admin_required',
      'live_tv_not_orderable',
      'quote_expired',
      'not_configured',
      'missing_token',
      'no_processor',
      'invalid_invite',
      '401',
      '403',
      '404',
      '429',
      '500',
      '503',
      'HTTP 502',
      'unknown_snake_code',
      'Failed to fetch',
    ];

    for (const raw of rawInputs) {
      const mapped = friendlyAccountError(new Error(raw), 'signin');
      expect(mapped, raw).not.toBe(raw);
      expect(mapped, raw).not.toMatch(/\b[45]\d{2}\b/);
      expect(mapped, raw).not.toMatch(/^[a-z0-9_]+$/);
      expect(mapped.length, raw).toBeGreaterThan(10);
    }

    expect(friendlyAccountError(new Error('invalid'), 'signin')).toContain("password doesn't match");
    expect(friendlyAccountError(new Error('invalid'), 'register')).toContain('already exists');
  });
});
