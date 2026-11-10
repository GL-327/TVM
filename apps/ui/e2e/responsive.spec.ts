import { expect, test } from '@playwright/test';
import { allowAccount } from './account';
import { FALLBACK_PLAN } from '../src/data/plan';
import { THEME_DEFAULT_BOOT } from '../src/theme/bootKey';

const title = {
  id: 'tt0137523', title: 'A responsive film', year: 2022, kind: 'movie',
  poster: '', backdrop: '', synopsis: 'A film for every screen.', genres: ['Drama'], rating: '', playable: true, hue: 32,
};

test.use({ browserName: 'chromium' });

for (const device of [
  { name: 'desktop browser', touch: false, userAgent: undefined },
  { name: 'Android browser', touch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36' },
]) {
  test.describe(device.name, () => {
    test.use({ hasTouch: device.touch, isMobile: device.touch, userAgent: device.userAgent });
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      test(`Home and Settings fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await allowAccount(page);
        await page.addInitScript((bootKey) => {
          localStorage.setItem(bootKey, '1');
          localStorage.setItem('tvm.theme', 'dark');
          localStorage.setItem('tvm.motion', 'reduced');
        }, THEME_DEFAULT_BOOT);
        await page.route('**/api/plan', route => route.fulfill({ json: { ...FALLBACK_PLAN, id: 'premium', name: 'Premium', maxHeight: 1080,
          catalog: [{ id: 'premium', name: 'Premium', price: 'Test plan', pricePence: 0, mocks: false, liveTv: true, extras: [] }],
        } }));
        await page.route('**/api/home', route => route.fulfill({ json: {
          rd: { configured: true, premium: true }, featured: title, library: [], watchlist: [], continueWatching: [],
          rails: [{ id: 'films', title: 'Films', items: Array.from({ length: 12 }, (_, i) => ({ ...title, id: `tt${1000000 + i}` })) }],
        } }));
        await page.route('**/api/profiles', route => route.fulfill({ json: { activeId: 'profile-1', profiles: [{ id: 'profile-1', name: 'Viewer', hue: 221 }] } }));
        await page.route('**/api/apps', route => route.fulfill({ json: { ribbon: [], grid: [] } }));
        await page.route('**/api/prefs', route => route.fulfill({ json: { language: 'en', autoUpdate: true } }));
        await page.route('**/api/update/**', route => route.fulfill({ json: { configured: false, available: null, applyAllowed: false, kind: 'up_to_date', notice: null } }));
        await page.goto('/?e2e=1');
        await expect(page.locator('.home__shelf')).toBeVisible();
        const checkWidth = async () => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
          const frame = await page.locator('.app').boundingBox();
          expect(frame!.width).toBeLessThanOrEqual(viewport.width + 1);
        };
        await checkWidth();
        const more = page.locator('[data-focus-id="more"]');
        if (await more.count()) {
          await more.click();
          await page.locator('[data-focus-id="more-settings"]').click();
        } else {
          const settings = page.locator('[data-focus-id="settings"]');
          await settings.focus();
          await settings.click();
        }
        await expect(page.locator('[data-screen="settings"]')).toBeVisible();
        await checkWidth();
        await expect(page.locator('[data-focus-id="linux-desktop"]')).toHaveCount(0);
        const theme = page.locator('[data-focus-id="theme-light"]');
        await expect(theme).toBeVisible();
        await theme.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await page.setViewportSize({ width: viewport.height, height: viewport.width });
        await expect(page.locator('[data-screen="settings"]')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.height + 1);
      });
    }
  });
}
