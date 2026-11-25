import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(dir, file), 'utf8');

describe('Account, Plans, Billing, and Accounts rebuild', () => {
  it('renders Account with avatar header, simple rows, plain status copy, and plain Sign out footer', () => {
    const src = read('Account.tsx');
    expect(src).toContain('BackButton');
    expect(src).toContain('account-avatar');
    expect(src).toContain('Plan');
    expect(src).toContain('Real-Debrid');
    expect(src).toContain('Live TV');
    expect(src).toContain('Status');
    expect(src).toContain('accountStatusLabel');
    expect(src).toContain('id="account-signout"');
    expect(src).toContain('id="account-privacy"');
    expect(src).not.toContain('awaiting_activation');
  });

  it('renders Plans with Choose your plan, conditional GlassSegmented, equal-height cards, and fenced Donate', () => {
    const src = read('Plans.tsx');
    const css = read('plans.css');
    expect(src).toContain('Choose your plan');
    expect(src).toContain('GlassSegmented');
    expect(src).toContain('hasYearly');
    expect(src).toContain('Most popular');
    expect(src).toContain('Current plan');
    expect(src).toContain('Choose ${tierDisplayName(tier)}');
    expect(src).toContain('Compare everything');
    expect(src).toContain('Donate to the app owner');
    expect(src).toContain('Taxes may apply.');
    expect(css).toContain('height: 48px');
    expect(css).toContain('align-items: stretch');
  });

  it('maps all status/processor codes and keeps equal button heights in BillingSummary and Accounts', () => {
    const billing = read('BillingSummary.tsx');
    const accounts = read('Accounts.tsx');
    const gateCss = read('accountGate.css');
    const billingCss = read('billing.css');
    const accountsCss = read('accounts.css');

    expect(billing).toContain('friendlyAccountError');
    expect(billing).toContain('friendlyProcessorReason');
    expect(billing).toContain('friendlyPlanName');
    expect(billing).toContain('fetchBilling');
    expect(billing).toContain('cancelPlan');
    expect(billing).toContain('chargeSavedCard');
    expect(billing).not.toContain('(${billing.processor.reason})');

    expect(accounts).toContain('GlassSegmented');
    expect(accounts).toContain('friendlyAccountError');
    expect(accounts).toContain('Paused by the owner');
    expect(accounts).toContain('Waiting for approval');
    expect(accounts).not.toContain('id="accounts-refresh" variant="primary"');

    expect(gateCss).toContain('width: min(440px, 100%)');
    expect(gateCss).toContain('border-radius: 28px');
    expect(gateCss).toContain('padding: 32px');
    expect(gateCss).toContain('gap: 24px');
    expect(gateCss).toContain('height: 48px');
    expect(gateCss).toContain('#2f6bff');
    expect(billingCss).toContain('height: 48px');
    expect(accountsCss).toContain('height: 44px');
  });
});
