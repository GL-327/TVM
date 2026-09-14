import { expect, test, type Page } from '@playwright/test';
import { FALLBACK_PLAN } from '../src/data/plan';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 TVM-iOS';
const catalog = ['free', 'basic', 'premium', 'ultra', 'max'].map((id) => ({ id, name: `TVM ${id}`, price: id === 'free' ? 'Free' : 'Test plan', pricePence: 0, mocks: false, liveTv: false, extras: [] }));
const title = { id: 'tt0137523', title: 'Test film', year: 2022, kind: 'movie', poster: '', backdrop: '', synopsis: 'Your favourite films, in one place.', genres: ['Drama'], rating: '', playable: true, hue: 32 };

async function ready(page: Page, paid: boolean): Promise<void> {
  const plan = { ...FALLBACK_PLAN, id: paid ? 'basic' : 'free', name: paid ? 'TVM Basic' : 'TVM Free', maxHeight: paid ? 1080 : 720, synthwave: true, synthwaveOwned: true, catalog };
  await page.addInitScript(() => {
    localStorage.setItem('tvm.theme.isle-boot', '1'); localStorage.setItem('tvm.theme', 'synthwave'); localStorage.setItem('tvm.motion', 'full'); localStorage.setItem('tvm.performance', 'off');
    // Exercise the compatibility path used by the minimum supported iOS version.
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
  });
  await page.route('**/api/plan', (route) => route.fulfill({ json: plan }));
  await page.route('**/api/home', (route) => route.fulfill({ json: { rd: { configured: true, premium: true }, featured: title, library: [], watchlist: [], continueWatching: [], rails: [{ id: 'films', title: 'Popular films', items: Array.from({ length: 12 }, (_, i) => ({ ...title, id: `tt${i + 1000000}`, title: `Film ${i + 1}` })) }] } }));
  await page.route('**/api/profiles', (route) => route.fulfill({ json: { activeId: 'profile-1', profiles: [{ id: 'profile-1', name: 'Test profile', hue: 350 }] } }));
  await page.route('**/api/apps', (route) => route.fulfill({ json: { ribbon: [], grid: [] } }));
  await page.goto('/?e2e=1');
}

test.use({ browserName: 'webkit', userAgent: IPHONE, hasTouch: true, isMobile: true, viewport: { width: 704, height: 396 } });
test.describe('iPhone WebKit', () => {
  test('Free is gated but plan selection remains reachable by touch', async ({ page }) => {
    await ready(page, false);
    await expect(page.locator('.mobile-plan-gate')).toBeVisible();
    await expect(page.locator('.home__shelf')).toHaveCount(0);
    await page.locator('[data-focus-id="mobile-plans"]').tap();
    await expect(page.locator('[data-screen="plans"]')).toBeVisible();
    await expect(page.getByText('iOS and Android viewing is included', { exact: false })).toBeVisible();
  });
  for (const size of [{ width: 568, height: 320 }, { width: 704, height: 396 }, { width: 800, height: 450 }]) {
    test(`Basic opens a usable animated 16:9 layout at ${size.width}`, async ({ page }) => {
      await page.setViewportSize(size);
      await ready(page, true);
      await expect(page.locator('.home__shelf')).toBeVisible();
      await expect(page.locator('.mobile-plan-gate')).toHaveCount(0);
      for (const label of await page.locator('.home__launcher strong').all()) await expect(label).toBeVisible();
      expect(await page.evaluate(() => typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function')).toBe(true);
      const frame = await page.locator('.app').boundingBox();
      expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 2);
      expect(frame!.width).toBeLessThanOrEqual(size.width);
      const layer = page.locator('.rt-set__burst').first();
      const before = await layer.evaluate((el) => getComputedStyle(el).transform);
      await expect.poll(() => layer.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
      await page.screenshot({ path: `../../cache/ios-home-webkit-${size.width}.png` });
      const rail = page.locator('.rail__track').first();
      await rail.scrollIntoViewIfNeeded();
      const beforeScroll = await rail.evaluate((el) => el.scrollLeft);
      await rail.evaluate((el) => { el.scrollLeft += 200; });
      await expect.poll(() => rail.evaluate((el) => el.scrollLeft)).toBeGreaterThan(beforeScroll);
      await page.screenshot({ path: `../../cache/ios-webkit-${size.width}.png` });
    });
  }

  test('Search is tappable and opens the same title path as Home', async ({ page }) => {
    await ready(page, true);
    await page.route('**/api/search**', (route) => route.fulfill({ json: { items: [title] } }));
    await page.route('**/api/rd/status', (route) => route.fulfill({ json: { configured: true, premium: true, username: 'test', error: null } }));
    await page.route('**/api/media**', (route) => route.fulfill({ json: title }));
    await page.locator('.ribbon-search').tap();
    const field = page.locator('.search-pill__field .token-field__input');
    await expect(field).toBeVisible();
    await field.tap();
    await field.fill('fight');
    await expect(page.getByRole('button', { name: 'Test film' })).toBeVisible();
    await page.getByRole('button', { name: 'Test film' }).tap();
    await expect(page.locator('[data-screen="details"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test film' })).toBeVisible();
  });
});
