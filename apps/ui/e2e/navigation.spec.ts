import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { THEME_DEFAULT_BOOT } from '../src/theme/bootKey';
import { allowAccount } from './account';

async function waitForFocus(page: Page): Promise<void> {
  await expect(page.locator('[data-focus-id="screen-back"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-focused="true"]')).toHaveCount(1, { timeout: 10_000 });
}

async function focusedId(page: Page): Promise<string | null> {
  return page.locator('[data-focused="true"]').getAttribute('data-focus-id');
}

const CHROME = new Set([
  'library',
  'search',
  'home-dock',
  'settings',
  'apps',
  'profile',
  'hero-play',
  'hero-info',
  'launch-stream',
  'launch-live',
  'launch-watchlist',
  'launch-apps',
  'inputs',
  'live',
  'watchlist',
]);

const SAMPLE = {
  id: 'tt0816692',
  title: 'Dune',
  year: 2021,
  kind: 'movie' as const,
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: ['Science Fiction'],
  rating: '8.4',
  playable: true,
  hue: 32,
};

const SAMPLE_TWO = { ...SAMPLE, id: 'tt15398776', title: 'Oppenheimer', year: 2023, rating: '8.3' };

const SAMPLE_SERIES = {
  id: 'tt1230051',
  title: 'The Last of Us',
  year: 2023,
  kind: 'series' as const,
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: ['Drama'],
  rating: '8.7',
  playable: true,
  hue: 140,
};

const SERIES_EPISODES = [
  {
    ...SAMPLE_SERIES,
    id: 'tt1230051:1:1',
    season: 1,
    episode: 1,
    episodeName: "When You're Lost in the Darkness",
    showTitle: 'The Last of Us',
    rating: '8.2',
    aired: '2023-01-15',
    synopsis: 'Joel is hired to smuggle Ellie out of the QZ.',
  },
  {
    ...SAMPLE_SERIES,
    id: 'tt1230051:1:2',
    season: 1,
    episode: 2,
    episodeName: 'Infected',
    showTitle: 'The Last of Us',
  },
  {
    ...SAMPLE_SERIES,
    id: 'tt1230051:2:1',
    season: 2,
    episode: 1,
    episodeName: 'Future Days',
    showTitle: 'The Last of Us',
  },
];

const PROFILE = {
  activeId: 'profile-1',
  profiles: [{ id: 'profile-1', name: 'Profile 1', hue: 350, created: '2026-01-01T00:00:00.000Z' }],
};

const E2E_PLAN = {
  id: 'premium',
  name: 'TVM Premium',
  price: '£8.99',
  pricePence: 899,
  mocks: true,
  liveTv: false,
  ads: false,
  stream: 'premium',
  maxHeight: 1080,
  queueMs: 0,
  queueSkipToTop: false,
  startDelayMs: 0,
  weeklySeconds: null,
  weeklyUsedSeconds: 0,
  weeklyRemainingSeconds: null,
  profilesMax: 4,
  skipRecap: false,
  extras: ['No ads'],
  badges: [],
  styleIds: ['classic', 'cinema', 'midnight'],
  styleId: 'classic',
  developer: false,
  catalog: [
    { id: 'free', name: 'TVM Free', price: 'Free', pricePence: 0, basePrice: 'Free', basePricePence: 0, liveTvAddonPence: 0, mocks: false, liveTv: false, extras: ['TVM Stream only'] },
    { id: 'basic', name: 'TVM Basic', price: '£7.99', pricePence: 799, basePrice: '£4.99', basePricePence: 499, liveTvAddonPence: 300, mocks: false, liveTv: true, extras: [] },
    { id: 'premium', name: 'TVM Premium', price: '£11.99', pricePence: 1199, basePrice: '£8.99', basePricePence: 899, liveTvAddonPence: 300, mocks: false, liveTv: true, extras: [] },
    { id: 'ultra', name: 'TVM Ultra', price: '£15.99', pricePence: 1599, basePrice: '£12.99', basePricePence: 1299, liveTvAddonPence: 300, mocks: true, liveTv: true, extras: [] },
    { id: 'max', name: 'TVM MAX', price: '£18.99', pricePence: 1899, basePrice: '£15.99', basePricePence: 1599, liveTvAddonPence: 300, mocks: true, liveTv: true, extras: [] },
  ],
  styles: [
    { id: 'classic', name: 'Classic', minPlan: 'premium' },
    { id: 'cinema', name: 'Cinema', minPlan: 'premium' },
    { id: 'midnight', name: 'Midnight', minPlan: 'premium' },
    { id: 'ember', name: 'Ember', minPlan: 'ultra' },
    { id: 'forest', name: 'Forest', minPlan: 'ultra' },
    { id: 'slate', name: 'Slate', minPlan: 'ultra' },
    { id: 'contrast', name: 'High contrast', minPlan: 'ultra' },
    { id: 'gold', name: 'MAX Gold', minPlan: 'max' },
    { id: 'aurora', name: 'Aurora', minPlan: 'max' },
  ],
};

const HOME = {
  rd: { configured: true, username: 'e2e', premium: true, error: null },
  featured: SAMPLE,
  library: [],
  continueWatching: [],
  watchlist: [],
  fileCount: 0,
  rails: [
    { id: 'films', title: 'Popular films', items: [SAMPLE, SAMPLE_TWO] },
    { id: 'shows', title: 'Popular series', items: [SAMPLE_SERIES] },
  ],
};

async function enterTvmStream(page: Page): Promise<void> {
  await pressUntil(page, 'library');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="profiles"]')).toBeVisible();
  await waitForFocus(page);
  await pressUntil(page, 'profile-pick');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="library"]')).toBeVisible();
  await waitForFocus(page);
}

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  // navigateByDirection is async; firing the next key before it settles
  // leaves focus where it was.
  await page.waitForTimeout(80);
}

async function pressUntil(page: Page, id: string): Promise<void> {
  await waitForFocus(page);
  if ((await focusedId(page)) === id) return;

  // Long settings menus are sequential lists. Walk them with the remote instead
  // of repeatedly exploring sideways exits into the ribbon.
  if (await page.locator(`.settings-list [data-focus-id="${id}"]`).count()) {
    const rows = await page.locator('.settings-list [data-focus-id]').count();
    for (let step = 0; step < rows + 3; step++) {
      if ((await focusedId(page)) === id) return;
      await tap(page, 'ArrowDown');
    }
  }

  // Dock controls sit above a long catalog. A blind walk falls into the
  // posters and never comes back, so rise to the chrome first, then sweep.
  if (CHROME.has(id)) {
    for (let step = 0; step < 8; step += 1) {
      if ((await focusedId(page)) === id) return;
      await tap(page, 'ArrowUp');
    }
    for (let step = 0; step < 6; step += 1) {
      if ((await focusedId(page)) === id) return;
      await tap(page, 'ArrowDown');
      if (CHROME.has((await focusedId(page)) ?? '')) break;
    }
    for (const direction of ['ArrowLeft', 'ArrowRight'] as const) {
      for (let step = 0; step < 14; step += 1) {
        if ((await focusedId(page)) === id) return;
        await tap(page, direction);
      }
    }
  }

  const directions = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'] as const;
  const tried = new Set<string>();
  for (let step = 0; step < 80; step += 1) {
    const current = await focusedId(page);
    if (current === id) return;
    const next = directions.find((direction) => !tried.has(`${current}:${direction}`));
    const direction = next ?? 'ArrowDown';
    if (next !== undefined) tried.add(`${current}:${direction}`);
    await tap(page, direction);
  }
  throw new Error(`Could not reach focus id "${id}". Landed on "${await focusedId(page)}"`);
}

async function stubReady(page: Page): Promise<void> {
  await allowAccount(page);
  await page.route('**/api/profiles', (route) => route.fulfill({ json: PROFILE }));
  await page.route('**/api/profiles/active', (route) => route.fulfill({ json: PROFILE }));
  await page.route('**/api/profiles/remove', (route) => route.fulfill({ json: PROFILE }));
  await page.route('**/api/rd/configured', (route) => route.fulfill({ json: { configured: true } }));
  await page.route('**/api/rd/status', (route) =>
    route.fulfill({
      json: { configured: true, username: 'e2e', premium: true, error: null },
    }),
  );
  await page.route('**/api/home', (route) => route.fulfill({ json: HOME }));
  await page.route('**/api/plan', (route) => route.fulfill({ json: E2E_PLAN }));
  await page.route('**/api/billing/checkout', (route) =>
    route.fulfill({ json: { ...E2E_PLAN, id: 'free', name: 'TVM Free', price: 'Free', mocks: false } }),
  );
  await page.route('**/api/dev/status', (route) => route.fulfill({ json: { unlocked: false } }));
  await page.route('**/api/dev/unlock', (route) =>
    route.fulfill({ status: 403, json: { unlocked: false, error: 'That code is not valid.' } }),
  );
  await page.route('**/api/usage/tick', (route) => route.fulfill({ json: E2E_PLAN }));
  await page.route('**/api/ads/preroll', (route) => route.fulfill({ json: { url: '', mimeType: 'video/mp4', duration: 0 } }));
  await page.route('**/api/apps', (route) =>
    route.fulfill({
      json: {
        ribbon: [
          { id: 'tvm-stream', name: 'TVM Stream', accent: '#2f6bff', wordmark: 'TVM', icon: '/apps/tvm.png', url: 'internal:library' },
          { id: 'netflix', name: 'Netflix', accent: '#e50914', wordmark: 'NETFLIX', icon: '/apps/netflix.svg', url: 'internal:mock' },
        ],
        grid: [],
      },
    }),
  );
  await page.route('**/api/apps/**', (route) =>
    route.fulfill({
      json: {
        id: 'netflix',
        name: 'Netflix',
        accent: '#e50914',
        layout: 'netflix',
        wordmark: 'NETFLIX',
        logo: '/apps/netflix.svg',
        disclaimer: 'Not the licensed Netflix app. Playback uses TVM Stream / Real-Debrid.',
        hero: SAMPLE,
        continueWatching: [],
        rails: [{ id: 'netflix-films', title: 'Popular films', items: [SAMPLE, SAMPLE_TWO] }],
      },
    }),
  );
  await page.route('**/api/library', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/media/children**', (route) => {
    const url = route.request().url();
    if (url.includes('tt1230051')) {
      void route.fulfill({ json: { items: SERIES_EPISODES } });
      return;
    }
    void route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/media**', (route) => {
    const url = route.request().url();
    if (url.includes('/media/children')) {
      void route.fallback();
      return;
    }
    if (url.includes('tt1230051')) {
      void route.fulfill({ json: SAMPLE_SERIES });
      return;
    }
    void route.fulfill({ json: SAMPLE });
  });
  await page.route('**/api/playback', (route) =>
    route.fulfill({
      status: 409,
      json: { kind: 'unavailable', reason: 'not-configured' },
    }),
  );
  await page.route('**/api/watchlist', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/live', (route) =>
    route.fulfill({ json: { url: null, host: null, username: null, configured: false, channels: [], error: null } }),
  );
  await page.route('**/api/update/check', (route) =>
    route.fulfill({
      json: {
        current: '0.0.0',
        channel: 'github:GL-327/TVM',
        lastCheck: null,
        available: null,
        configured: false,
        applyAllowed: false,
        applyReason: null,
        kind: 'idle',
        notice: null,
      },
    }),
  );
  await page.route('**/api/system/session', (route) =>
    route.fulfill({ json: { appliance: false, mode: 'unknown' } }),
  );
}

async function stubUnconfigured(page: Page): Promise<void> {
  await page.unroute('**/api/rd/configured');
  await page.unroute('**/api/rd/status');
  await page.unroute('**/api/home');
  await page.route('**/api/rd/configured', (route) => route.fulfill({ json: { configured: false } }));
  await page.route('**/api/rd/status', (route) =>
    route.fulfill({ json: { configured: false, username: null, premium: false, error: null } }),
  );
  await page.route('**/api/home', (route) =>
    route.fulfill({
      json: {
        rd: { configured: false, username: null, premium: false, error: null },
        featured: null,
        library: [],
        continueWatching: [],
        watchlist: [],
        fileCount: 0,
        rails: [],
      },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubReady(page);
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
});

test('something is always focused after every remote key', async ({ page }) => {
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
    await waitForFocus(page);
  }
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
});

test('Back at the root does not blank the screen', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
});

test('Back from a depth of three returns Home one step at a time', async ({ page }) => {
  await enterTvmStream(page);

  await pressUntil(page, 'films-tt0816692-0');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await waitForFocus(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="library"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
});

test('a modal traps focus and Back closes the modal', async ({ page }) => {
  await pressUntil(page, 'search');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="search"]')).toBeVisible();
  await waitForFocus(page);
  const opened = await focusedId(page);
  expect(opened === 'close' || opened === 'open' || opened === 'query' || opened?.startsWith('key-')).toBe(true);

  let onKeyboard = opened?.startsWith('key-') === true;
  for (let step = 0; step < 6 && !onKeyboard; step += 1) {
    await page.keyboard.press('ArrowDown');
    await waitForFocus(page);
    onKeyboard = (await focusedId(page))?.startsWith('key-') === true;
  }
  expect(onKeyboard).toBe(true);
  const trapped = await focusedId(page);
  expect(trapped === 'close' || trapped === 'open' || trapped === 'query' || trapped?.startsWith('key-')).toBe(true);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="search"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
});

test('the search results row scrolls with an ordinary mouse wheel', async ({ page }) => {
  const matches = Array.from({ length: 30 }, (_, index) => ({
    id: `tt${1000000 + index}`, title: `Result ${index + 1}`, year: 2020,
    kind: 'movie', poster: '', backdrop: '', synopsis: '', genres: [], rating: '', playable: true,
  }));
  await page.route('**/api/search**', (route) => route.fulfill({ json: { items: matches } }));
  await pressUntil(page, 'search');
  await page.keyboard.press('Enter');
  const field = page.locator('.search-pill__field .token-field__input');
  await field.fill('result');
  const row = page.getByLabel('Search results');
  await expect(row.getByRole('button')).toHaveCount(30);
  await row.hover();
  await page.mouse.wheel(0, 360);
  await expect.poll(() => row.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
});

test('focus is restored to the same element after returning', async ({ page }) => {
  await enterTvmStream(page);

  await pressUntil(page, 'films-tt0816692-0');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focusedId(page)).not.toBe('films-tt0816692-0');
  await waitForFocus(page);
  const remembered = await focusedId(page);
  expect(remembered).not.toBeNull();
  expect(remembered).not.toBe('films-tt0816692-0');

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="library"]')).toBeVisible();
  await waitForFocus(page);
  expect(await focusedId(page)).toBe(remembered);
});

test('TVM Stream asks who is watching every time it opens', async ({ page }) => {
  await pressUntil(page, 'library');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="profiles"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Who's watching?" })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await pressUntil(page, 'library');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="profiles"]')).toBeVisible();
});

test('Home opens without a Real-Debrid token', async ({ page }) => {
  await stubUnconfigured(page);
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('[data-screen="profiles"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="setup"]')).toHaveCount(0);
});

test('open ribbon sits in the top center', async ({ page }) => {
  await pressUntil(page, 'home-dock');
  const ribbon = page.locator('.ribbon');
  await expect(ribbon).toBeVisible();
  await expect(ribbon).toHaveClass(/ribbon--open/);
  const metrics = await ribbon.evaluate((el) => {
    const styles = getComputedStyle(el);
    const frost = el.querySelector('.ribbon__frost');
    const frostStyles = frost !== null ? getComputedStyle(frost) : null;
    const rect = el.getBoundingClientRect();
    const tx = styles.transform.startsWith('matrix(')
      ? Number(styles.transform.slice(7, -1).split(',')[4])
      : 0;
    return {
      left: styles.left,
      transform: styles.transform,
      hostFilter: styles.backdropFilter,
      frostFilter: frostStyles?.backdropFilter ?? '',
      frostTransform: frostStyles?.transform ?? '',
      center: rect.left + rect.width / 2,
      mid: window.innerWidth / 2,
      tx,
    };
  });
  expect(Math.abs(metrics.center - metrics.mid)).toBeLessThan(12);
  expect(metrics.tx).toBeLessThan(0);
  expect(metrics.frostTransform === 'none' || metrics.frostTransform === '').toBe(true);
  expect(metrics.hostFilter === 'none' || metrics.hostFilter === '').toBe(true);
});

test('TVM Stream asks for a token and Enter on the field saves', async ({ page }) => {
  await stubUnconfigured(page);
  await page.route('**/api/rd/token', (route) => {
    if (route.request().method() !== 'PUT') {
      void route.fallback();
      return;
    }
    void route.fulfill({
      json: { configured: true, username: 'e2e', premium: true, error: null },
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await enterTvmStream(page);
  await pressUntil(page, 'token');

  await page.unroute('**/api/home');
  await page.route('**/api/home', (route) =>
    route.fulfill({
      json: {
        rd: { configured: true, username: 'e2e', premium: true, error: null },
        featured: SAMPLE,
        library: [],
        continueWatching: [],
        watchlist: [],
        fileCount: 0,
        rails: HOME.rails,
      },
    }),
  );

  await page.locator('[data-focus-id="token"]').fill('test-token');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-screen="library"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="token"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="setup"]')).toHaveCount(0);
});

test('TVM Stream Down from the token field reaches Continue', async ({ page }) => {
  await stubUnconfigured(page);
  await page.goto('/');
  await enterTvmStream(page);
  await pressUntil(page, 'token');
  await tap(page, 'ArrowDown');
  expect(await focusedId(page)).toBe('save');
});

test('Back leaves TVM Stream without a token and returns Home', async ({ page }) => {
  await stubUnconfigured(page);
  await page.goto('/');
  await enterTvmStream(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('[data-screen="setup"]')).toHaveCount(0);
  await waitForFocus(page);
});

test('a film poster opens the title page with an IMDb score before Play', async ({ page }) => {
  await enterTvmStream(page);
  await pressUntil(page, 'films-tt0816692-0');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect(page.locator('[data-screen="player"]')).toHaveCount(0);
  await expect(page.getByText('IMDb 8.4')).toBeVisible();
  await expect(page.locator('[data-focus-id="play"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('play');
});

test('Play with a rejected token opens the Real-Debrid notice', async ({ page }) => {
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', (route) => {
    void route.fulfill({
      status: 409,
      json: { kind: 'unavailable', reason: 'needs-auth' },
    });
  });

  await enterTvmStream(page);
  await pressUntil(page, 'films-tt0816692-0');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('play');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Real-Debrid' })).toBeVisible();
  await expect(page.getByText(/rejected the saved token/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect Real-Debrid' })).toBeVisible();
  await expect(page.locator('[data-screen="player"]')).toHaveCount(0);
  await pressUntil(page, 'close'); await page.keyboard.press('Enter'); await waitForFocus(page);
  await expect(page.locator('[data-screen="realdebrid"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="token"]')).toBeVisible();
});

test('a series poster opens seasons, then an episode plays with tt:s:e', async ({ page }) => {
  let playback: { id?: string; season?: number; episode?: number } | null = null;
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', (route) => {
    playback = route.request().postDataJSON() as { id?: string; season?: number; episode?: number };
    void route.fulfill({
      status: 409,
      json: { kind: 'unavailable', reason: 'not-in-library' },
    });
  });

  await enterTvmStream(page);
  await pressUntil(page, 'shows-tt1230051-0');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect(page.locator('[data-screen="player"]')).toHaveCount(0);
  await expect(page.getByText('IMDb 8.7')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seasons' })).toBeVisible();
  await expect(page.getByText('Series Graph')).toBeVisible();
  await expect(page.locator('[data-focus-id="play"]')).toHaveCount(0);
  await expect(page.locator('[data-focus-id="season-1"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('season-1');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-focus-id="ep-tt1230051:1:1"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('ep-tt1230051:1:1');
  await expect(page.getByText('IMDb 8.2')).toBeVisible();
  await expect(page.getByText('15 Jan 2023')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="player"]')).toBeVisible();
  await expect.poll(() => playback?.id).toBe('tt1230051:1:1');
  expect(playback?.season).toBe(1);
  expect(playback?.episode).toBe(1);
  await expect(page.getByText('Playback is unavailable.')).toHaveCount(0);
  await expect(page.getByText(/No playable stream was found/)).toBeVisible();
});

test('Settings opens Plans', async ({ page }) => {
  await pressUntil(page, 'settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="developer"]')).toHaveCount(0);
  await waitForFocus(page);
  await pressUntil(page, 'plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="plans"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What TVM costs' })).toBeVisible();
  await expect(page.getByText(/no card is taken here/i)).toBeVisible();
});

test('Plans explains access without taking a card', async ({ page }) => {
  await pressUntil(page, 'settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await waitForFocus(page);
  await pressUntil(page, 'plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="plans"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What TVM costs' })).toBeVisible();
  await expect(page.locator('.page__lede')).toContainText('nothing to buy');
  await expect(page.locator('[data-focus-id="card-name"], [data-focus-id="pay"], [data-focus-id="checkout-consent"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Donate to the app owner' })).toBeVisible();
  await expect(page.getByText(/it gives you nothing/i)).toBeVisible();
});

test('Retired themes fall back to Dark; privacy and motion are reachable', async ({ page }) => {
  await page.evaluate((bootKey) => { localStorage.setItem('tvm.theme', 'synthwave'); localStorage.setItem(bootKey, '1'); }, THEME_DEFAULT_BOOT);
  await page.reload();
  await waitForFocus(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await pressUntil(page, 'settings'); await page.keyboard.press('Enter'); await waitForFocus(page);
  await expect(page.locator('[data-focus-id^="theme-"]')).toHaveCount(2);
  await expect(page.locator('[data-focus-id="theme-light"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="theme-dark"]')).toBeVisible();
  await pressUntil(page, 'motion'); await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await pressUntil(page, 'privacy'); await page.keyboard.press('Enter'); await waitForFocus(page);
  await expect(page.getByRole('heading', { name: 'Your data. Your sources.' })).toBeVisible();
  await expect(page.locator('[data-focus-id="privacy-export"]')).toBeVisible();
  await pressUntil(page, 'privacy-erase'); await page.keyboard.press('Enter');
  await expect(page.getByText(/This removes all TVM profiles/)).toBeVisible();
  await pressUntil(page, 'privacy-keep'); await page.keyboard.press('Enter');
  await expect(page.getByText(/This removes all TVM profiles/)).toHaveCount(0);
});

test('Developer rejects a wrong password', async ({ page }) => {
  const mark = page.locator('[data-focus-id="hero-mark"]');
  await expect(mark).toBeVisible();
  for (let n = 0; n < 7; n++) await mark.click();
  await expect(page.locator('[data-screen="developer-unlock"]')).toBeVisible();
  await page.locator('[data-focus-id="dev-password"]').fill('nope');
  await pressUntil(page, 'dev-unlock');
  await page.keyboard.press('Enter');
  await expect(page.getByText('That code is not valid.')).toBeVisible();
  await expect(page.locator('[data-screen="developer"]')).toHaveCount(0);
});

test('MAX shows the mock live pack', async ({ page }) => {
  await page.unroute('**/api/plan');
  await page.unroute('**/api/live');
  await page.route('**/api/plan', (route) =>
    route.fulfill({
      json: {
        ...E2E_PLAN,
        id: 'max',
        name: 'TVM MAX',
        price: '£18.99',
        pricePence: 1899,
        mocks: true,
        liveTv: true,
      },
    }),
  );
  await page.route('**/api/live', (route) =>
    route.fulfill({
      json: {
        url: null,
        host: null,
        username: null,
        configured: true,
        error: null,
        channels: [
          { id: 'live:mock:sky-sports', name: 'Sky Sports', group: 'Sports' },
          { id: 'live:mock:tnt-sports', name: 'TNT Sports', group: 'Sports' },
          { id: 'live:mock:bein-sports', name: 'beIN Sports', group: 'Sports' },
          { id: 'live:mock:usa-network', name: 'USA Network', group: 'Entertainment' },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
  await pressUntil(page, 'live');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="live"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Sky Sports/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /TNT Sports/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /beIN Sports/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /USA Network/ })).toBeVisible();
});

test('clicking a film opens the title instead of only jumping the row', async ({ page }) => {
  const poster = page.locator('[data-focus-id="films-tt0816692-0"]');
  await expect(poster).toBeVisible();
  await poster.click();
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();
});

test('volume slider sets a level and a speed pick does not scrub', async ({ page }) => {
  const sample = readFileSync(new URL('./sample.mp4', import.meta.url));
  await page.route('**/e2e-sample.mp4', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: sample }),
  );
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', (route) =>
    route.fulfill({
      json: {
        kind: 'stream',
        url: 'http://127.0.0.1:15173/e2e-sample.mp4',
        title: 'Dune',
        filename: 'dune.mp4',
        mimeType: 'video/mp4',
        engine: 'html5',
        transport: 'file',
        durationSeconds: 2,
      },
    }),
  );
  await enterTvmStream(page);
  await pressUntil(page, 'films-tt0816692-0');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('play');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="player"]')).toBeVisible();
  await expect(page.locator('[data-player-volume="programmable"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="player-fullscreen"]')).toBeVisible();

  const track = page.locator('.player-volume__track');
  const box = await track.boundingBox();
  if (box === null) throw new Error('Volume track has no box');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  const volume = await page.locator('video').evaluate((node: HTMLVideoElement) => node.volume);
  expect(volume).toBeGreaterThan(0.15);
  expect(volume).toBeLessThan(0.85);

  await expect(page.locator('[data-focus-id="player-progress"]')).toBeEnabled();
  const before = await page.locator('video').evaluate((node: HTMLVideoElement) => node.currentTime);
  await page.locator('[data-focus-id="player-speed"]').click();
  await page.locator('[data-focus-id="player-speed-2"]').click();
  const after = await page.locator('video').evaluate((node: HTMLVideoElement) => ({
    time: node.currentTime,
    rate: node.playbackRate,
  }));
  expect(after.rate).toBe(2);
  expect(Math.abs(after.time - before)).toBeLessThan(3);
});

test('Live TV asks for a login until configured, and Back returns Home', async ({ page }) => {
  await pressUntil(page, 'live');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="live"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter your Live TV login' })).toBeVisible();
  await waitForFocus(page);
  await pressUntil(page, 'live-back');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
});

test('a cold first video request recovers and idle chrome stays hidden', async ({ page }) => {
  let requests = 0;
  const sample = readFileSync(new URL('./sample.mp4', import.meta.url));
  await page.route('**/cold-video.mp4', (route) => {
    requests += 1;
    return requests === 1 ? route.fulfill({ status: 503, body: 'warming up' }) : route.fulfill({ contentType: 'video/mp4', body: sample });
  });
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', (route) => route.fulfill({ json: {
    kind: 'stream', url: 'http://127.0.0.1:15173/cold-video.mp4', title: 'Dune', filename: 'dune.mp4', mimeType: 'video/mp4', engine: 'html5', transport: 'file',
  } }));
  await enterTvmStream(page);
  await page.locator('[data-focus-id="films-tt0816692-0"]').click();
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await page.locator('[data-focus-id="play"]').click();
  const video = page.locator('video.player__video');
  await expect(video).toHaveCount(1);
  // Stretch the two-second fixture beyond the idle window. Loop boundaries
  // legitimately buffer and reveal chrome, unlike an uninterrupted film.
  await video.evaluate((node: HTMLVideoElement) => { node.loop = true; node.defaultPlaybackRate = 0.1; });
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => !node.paused && node.readyState >= 2)).toBe(true);
  await video.evaluate((node: HTMLVideoElement) => { node.playbackRate = 0.1; });
  await page.mouse.move(640, 340);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden', { timeout: 10_000 });
  await page.waitForTimeout(1100);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden');
  await expect(page.locator('.player-error')).toHaveCount(0);
  await expect(page.locator('.player-remote-hints')).not.toBeVisible();
  await page.screenshot({ path: '../../cache/player-idle-fixed.png' });
  await page.mouse.move(660, 340);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'visible');
  await page.locator('[data-focus-id="player-play"]').click();
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-paused', 'true');
  await expect.poll(() => page.locator('.cinema-chrome').evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);
  await page.waitForTimeout(350); // Let the entrance fade finish for visual review.
  await page.screenshot({ path: '../../cache/player-controls-fixed.png' });
  const titleSize = await page.locator('.cinema-chrome__now').evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(titleSize).toBeLessThan(40);
  await page.locator('[data-focus-id="player-exit"]').click();
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
});

test('downloads select a full series or one episode with language, quality and folder', async ({ page }) => {
  await page.evaluate(() => {
    const captured: unknown[] = [];
    (window as unknown as { capturedDownloads: unknown[] }).capturedDownloads = captured;
    window.tvmDownloads = {
      chooseFolder: async () => 'D:\\My movies', list: async () => [], onChanged: () => () => {},
      enqueue: async (input) => { captured.push(input); return input.items.map((item, index) => ({ id: String(index), title: item.title, state: 'queued', bytes: 0, total: 0 })); },
      cancel: async () => {}, show: async () => {},
    };
  });
  await enterTvmStream(page);
  await page.locator('[data-focus-id="shows-tt1230051-0"]').click();
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await page.locator('[data-focus-id="download"]').click();
  await expect(page.locator('[data-screen="downloads"]')).toBeVisible();
  await expect(page.locator('[data-focus-id="download-start"]')).toBeDisabled();
  await page.locator('[data-focus-id="download-language"]').selectOption('ja');
  await page.locator('[data-focus-id="download-quality"]').selectOption('720');
  await page.locator('[data-focus-id="download-folder"]').click();
  await expect(page.getByText('D:\\My movies')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Take it with you.' })).toBeInViewport();
  await expect.poll(() => page.locator('[data-screen="downloads"] .screen-content').evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);
  await page.screenshot({ path: '../../cache/download-options-fixed.png' });
  await page.locator('[data-focus-id="download-start"]').click();
  const inputs = await page.evaluate(() => (window as unknown as { capturedDownloads: Array<{ items: Array<{ id: string }>; directory: string; preferences: unknown }> }).capturedDownloads);
  expect(inputs[0]?.items.map((item) => item.id)).toEqual(['tt1230051:1:1', 'tt1230051:1:2', 'tt1230051:2:1']);
  expect(inputs[0]?.preferences).toEqual({ language: 'ja', maxHeight: 720 });
  expect(inputs[0]?.directory).toBe('D:\\My movies');
  await page.locator('[data-focus-id="downloads-close"]').click();
  await page.locator('[data-focus-id="season-1"]').click();
  await page.locator('[data-focus-id="download-ep-tt1230051:1:2"]').click();
  await expect(page.locator('[data-focus-id="download-scope"]')).toHaveValue('episode');
  await expect(page.locator('[data-focus-id="download-episode"]')).toHaveValue('tt1230051:1:2');
  await page.locator('[data-focus-id="download-folder"]').click();
  await page.locator('[data-focus-id="download-start"]').click();
  const episode = await page.evaluate(() => (window as unknown as { capturedDownloads: Array<{ items: Array<{ id: string }> }> }).capturedDownloads[1]?.items);
  expect(episode?.map((item) => item.id)).toEqual(['tt1230051:1:2']);
});

test('focused poster artwork leaves room for its label', async ({ page }) => {
  await enterTvmStream(page);
  await pressUntil(page, 'films-tt0816692-0');
  const card = page.locator('[data-focus-id="films-tt0816692-0"]');
  await expect.poll(async () => {
    const art = await card.locator('.poster__art').boundingBox();
    const label = await card.locator('.poster__meta').boundingBox();
    return art && label ? art.y + art.height <= label.y + 1 : false;
  }).toBe(true);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const art = await card.locator('.poster__art').boundingBox();
      const label = await card.locator('.poster__meta').boundingBox();
      const heading = await page.locator('.rail').filter({ has: card }).locator('.rail__title').boundingBox();
      return !!art && !!label && !!heading
        && art.x >= 0 && art.x + art.width <= viewport.width + 1
        && heading.y >= 0 && label.y + label.height <= viewport.height + 1;
    }).toBe(true);
  }
});

test('desktop recovery preserves position, never labels an unknown film Live, and hides parked controls', async ({ page }) => {
  const requests: Array<{ native?: boolean; startAt?: number }> = [];
  // A browser fixture has no mpv window behind the transparent document.
  await page.addStyleTag({ content: 'html.tvm-native-playback { background: #04050a !important; }' });
  await page.evaluate(() => {
    const listeners = new Set<(event: TvmNativePlayerEvent) => void>();
    const state = { starts: [] as number[], seeks: [] as number[], position: 73, paused: false, duration: 0, timer: 0 };
    (window as unknown as { nativeRegression: typeof state }).nativeRegression = state;
    const emit = (): void => { listeners.forEach((listener) => listener({ type: 'state', paused: state.paused, buffering: false, position: state.position, duration: state.duration })); };
    window.tvmDesktop = { nativePlayback: true };
    window.tvmNativePlayer = {
      async start(input) {
        state.starts.push(input.startAt ?? 0); state.position = input.startAt ?? 73; state.paused = false;
        window.setTimeout(emit, 30);
        if (state.starts.length === 1) window.setTimeout(() => listeners.forEach((listener) => listener({ type: 'error', message: 'Temporary source failure' })), 650);
        else {
          state.timer = window.setInterval(() => { if (!state.paused) state.position += .25; emit(); }, 250);
          window.setTimeout(() => { state.duration = 3600; emit(); }, 1000);
        }
        return { ok: true };
      },
      async command(command) { if (command === 'pause') state.paused = true; if (command === 'play') state.paused = false; emit(); },
      async seekTo(value) { state.seeks.push(value); state.position = value; emit(); },
      async stop() { window.clearInterval(state.timer); },
      async setVolume() {}, async setMuted() {}, async setRate() {},
      onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
  });
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { kind: 'stream', url: 'https://media.example/original-hevc.mkv', filename: 'Film.2160p.HEVC.mkv', title: 'Dune', engine: 'native', transport: 'file', mimeType: 'application/octet-stream', startAt: requests.at(-1)?.startAt ?? 73 } });
  });
  await enterTvmStream(page);
  await page.locator('[data-focus-id="films-tt0816692-0"]').click();
  await page.locator('[data-focus-id="play"]').click();
  await expect(page.locator('.tvm-progress__live')).toHaveText('—:—');
  await expect(page.getByText('Live', { exact: true })).not.toBeVisible();
  await expect.poll(() => requests.some((request) => request.startAt === 73)).toBe(true);
  expect(requests[0]?.native).toBe(true);
  expect(requests.at(-1)?.startAt).toBe(73);
  await expect(page.locator('[data-focus-id="player-progress"]')).toHaveAttribute('aria-valuemax', '3600');
  await expect(page.locator('.player-error')).toHaveCount(0);
  await expect(page.locator('.app__screen[inert]')).toHaveCSS('visibility', 'hidden');
  const play = page.locator('[data-focus-id="player-play"]');
  await play.hover();
  const box = await play.boundingBox();
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden', { timeout: 7000 });
  await expect(page.locator('.cinema-chrome')).toHaveCSS('opacity', '0');
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden');
  if (box) await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden');
  await page.mouse.move(640, 300);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'visible');
  await play.click();
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-paused', 'true');
  await page.waitForTimeout(350);
  await page.screenshot({ path: '../../cache/player-cinema-redesign.png' });
  await play.click();
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-paused', 'false');
  expect(await page.evaluate(() => (window as unknown as { nativeRegression: { seeks: number[] } }).nativeRegression.seeks)).toEqual([]);
  await play.click();
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-paused', 'true');
  for (const viewport of [{ width: 900, height: 600 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.cinema-chrome')).toHaveCSS('opacity', '1');
    const tools = page.locator(`[data-focus-id="player-play"], [data-focus-id="player-seek-back"], [data-focus-id="player-seek-fwd"], [data-focus-id="player-mute"], [data-focus-id="${viewport.width === 375 ? 'player-settings' : 'player-speed'}"], [data-focus-id="player-fullscreen"]`);
    await expect.poll(async () => tools.evaluateAll((nodes) => nodes.every((node) => {
      const box = node.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= window.innerWidth + 1 && box.top >= 0 && box.bottom <= window.innerHeight + 1;
    }))).toBe(true);
    if (viewport.width === 375) {
      await expect(page.locator('.cinema-chrome__back svg')).toBeVisible();
      await page.locator('[data-focus-id="player-settings"]').click();
      await expect(page.locator('[data-focus-id="player-speed"]')).toBeVisible();
      const settingsBox = await page.locator('.cinema-chrome__settings-panel').boundingBox();
      expect(settingsBox && settingsBox.x >= 0 && settingsBox.x + settingsBox.width <= viewport.width + 1).toBeTruthy();
    }
    await page.screenshot({ path: `../../cache/player-cinema-${viewport.width}.png` });
    if (viewport.width === 375) {
      await page.keyboard.press('Escape');
      await expect(page.locator('.cinema-chrome__settings-panel')).not.toBeVisible();
      await expect(page.locator('[data-player-root]')).toHaveCount(1);
    }
  }
});

test('growing HLS films keep finite time and do not jump when paused or resumed', async ({ page }) => {
  test.setTimeout(45_000);
  const playlist = readFileSync(new URL('./fixtures/vod-event/index.m3u8', import.meta.url), 'utf8');
  let started = 0;
  await page.route('**/vod-event/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    if (name === 'index.m3u8') {
      if (!started) started = Date.now();
      const available = Math.min(16, 2 + Math.floor((Date.now() - started) / 2000));
      const [header, ...segments] = playlist.split('#EXTINF:');
      const body = `${header}${segments.slice(0, available).map((part) => `#EXTINF:${part.replace('#EXT-X-ENDLIST', '')}`).join('')}${available === 16 ? '#EXT-X-ENDLIST\n' : ''}`;
      await route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body });
    } else await route.fulfill({ contentType: name.endsWith('.m4s') ? 'video/iso.segment' : 'video/mp4', body: readFileSync(new URL(`./fixtures/vod-event/${name}`, import.meta.url)) });
  });
  await page.unroute('**/api/playback');
  await page.route('**/api/playback', (route) => route.fulfill({ json: { kind: 'stream', url: 'http://127.0.0.1:15173/vod-event/index.m3u8', title: 'Dune', filename: 'film.mkv', engine: 'html5', mimeType: 'application/vnd.apple.mpegurl', transport: 'hls', startAt: 0, durationSeconds: 32 } }));
  await enterTvmStream(page);
  await page.locator('[data-focus-id="films-tt0816692-0"]').click();
  await page.locator('[data-focus-id="play"]').click();
  const video = page.locator('video.player__video');
  try {
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime), { timeout: 12000 }).toBeGreaterThan(1);
  } catch (error) {
    console.log('HLS diagnostics', await video.evaluate(async (node: HTMLVideoElement) => {
      const path = '/src/player/hlsBridge.ts'; const module = await import(path); const hls = module.attachedHls(node);
      return { ready: node.readyState, error: node.error?.message, time: node.currentTime, duration: node.duration, paused: node.paused, root: document.querySelector<HTMLElement>('[data-player-root]')?.dataset, details: hls?.latestLevelDetails ? { edge: hls.latestLevelDetails.edge, fragments: hls.latestLevelDetails.fragments.length, live: hls.latestLevelDetails.live } : null, state: hls?.streamController?.state };
    })); throw error;
  }
  await expect(page.locator('[data-focus-id="player-progress"]')).toHaveAttribute('aria-valuemax', '32');
  await expect(page.getByText('Live', { exact: true })).not.toBeVisible();
  await video.evaluate((node: HTMLVideoElement) => { (window as unknown as { filmSeeks: number[] }).filmSeeks = []; node.addEventListener('seeking', () => (window as unknown as { filmSeeks: number[] }).filmSeeks.push(node.currentTime)); });
  await page.mouse.move(640, 300);
  await expect(page.locator('[data-player-root]')).toHaveAttribute('data-controls', 'hidden');
  await page.mouse.move(660, 300);
  await page.locator('[data-focus-id="player-play"]').click();
  const pausedAt = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
  await page.waitForTimeout(1200);
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(pausedAt, 1);
  await page.locator('[data-focus-id="player-play"]').click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(pausedAt + 3);
  expect(await page.evaluate(() => (window as unknown as { filmSeeks: number[] }).filmSeeks)).toEqual([]);
  await expect(page.locator('.player-error')).toHaveCount(0);
});
