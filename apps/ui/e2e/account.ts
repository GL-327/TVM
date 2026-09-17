import type { Page } from '@playwright/test';

/** A usable account so e2e can reach the catalogue. The door is still on. */
export const USABLE_ACCOUNT = {
  signedIn: true,
  account: {
    id: 'e2e-account',
    email: 'e2e@example.com',
    displayName: 'E2E',
    activated: true,
    tier: 'stream-live',
    suspended: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    termsVersion: '2026-09-15',
    termsAcceptedAt: '2026-09-15T00:00:00.000Z',
  },
  usable: { ok: true, reason: null },
  termsVersion: '2026-09-15',
};

export async function allowAccount(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tvm.account.token', 'e2e-account-token');
  });
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: USABLE_ACCOUNT });
      return;
    }
    await route.fallback();
  });
}
