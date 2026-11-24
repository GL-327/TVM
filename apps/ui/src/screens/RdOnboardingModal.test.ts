import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AccountState } from '../data/account';
import { RD_PROMPT_SKIPPED_KEY, shouldShowRdOnboarding } from './RdOnboardingModal';

const dir = dirname(fileURLToPath(import.meta.url));

function makeAccount(rdKey: boolean, usableOk = true): AccountState {
  return {
    signedIn: true,
    account: {
      id: 'acc-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      role: 'member',
      activated: true,
      tier: 'stream-live',
      suspended: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      termsVersion: '2026-09-15',
      termsAcceptedAt: '2026-09-15T00:00:00.000Z',
      emailVerified: true,
      emailCodeSent: false,
      rdKey,
    },
    usable: { ok: usableOk, reason: usableOk ? null : 'terms_required' },
    termsVersion: '2026-09-15',
  };
}

describe('RdOnboardingModal gating', () => {
  it('stays hidden when the developer already attached an RD key remotely', () => {
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(true),
        rdStatus: { configured: false, username: null, premium: false, error: null },
        skipped: false,
      }),
    ).toBe(false);
  });

  it('stays hidden when Real-Debrid is already configured locally', () => {
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(false),
        rdStatus: { configured: true, username: 'viewer', premium: true, error: null },
        skipped: false,
      }),
    ).toBe(false);
  });

  it('stays hidden when skipped this session, when rdStatus failed, or before account is usable', () => {
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(false),
        rdStatus: { configured: false, username: null, premium: false, error: null },
        skipped: true,
      }),
    ).toBe(false);
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(false),
        rdStatus: null,
        skipped: false,
      }),
    ).toBe(false);
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(false, false),
        rdStatus: { configured: false, username: null, premium: false, error: null },
        skipped: false,
      }),
    ).toBe(false);
  });

  it('prompts ONLY when !account.rdKey && !rdStatus.configured and not skipped', () => {
    expect(
      shouldShowRdOnboarding({
        account: makeAccount(false),
        rdStatus: { configured: false, username: null, premium: false, error: null },
        skipped: false,
      }),
    ).toBe(true);
    expect(RD_PROMPT_SKIPPED_KEY).toBe('tvm.rd.prompt.skipped');
  });

  it('is mounted in App.tsx after ViewStackProvider only when account is usable', () => {
    const app = readFileSync(join(dir, '../App.tsx'), 'utf8');
    expect(app).toContain('RdOnboardingModal');
    expect(app).toContain('<RdOnboardingModal account={account} />');
    expect(app.indexOf('<ViewStackProvider />')).toBeLessThan(app.indexOf('<RdOnboardingModal account={account} />'));
  });
});
