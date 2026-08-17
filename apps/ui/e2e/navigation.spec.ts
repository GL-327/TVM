import { expect, type Page, test } from '@playwright/test';

async function waitForFocus(page: Page): Promise<void> {
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
    { id: 'free', name: 'TVM Free', price: 'Free', pricePence: 0, mocks: false, liveTv: false, extras: ['TVM Stream only'] },
    { id: 'basic', name: 'TVM Basic', price: '£4.99', pricePence: 499, mocks: false, liveTv: false, extras: [] },
    { id: 'premium', name: 'TVM Premium', price: '£8.99', pricePence: 899, mocks: false, liveTv: false, extras: [] },
    { id: 'ultra', name: 'TVM Ultra', price: '£12.99', pricePence: 1299, mocks: true, liveTv: false, extras: [] },
    { id: 'max', name: 'TVM MAX', price: '£15.99', pricePence: 1599, mocks: true, liveTv: true, extras: [] },
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
  if ((await focusedId(page)) === id) return;

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
          { id: 'tvm-stream', name: 'TVM Stream', accent: '#5b3dff', wordmark: 'TVM', icon: '/apps/tvm.svg', url: 'internal:library' },
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
    route.fulfill({ json: { url: null, channels: [], error: null } }),
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

  await pressUntil(page, 'films-tt0816692');
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
  expect(await focusedId(page)).toBe('close');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await waitForFocus(page);
  const trapped = await focusedId(page);
  expect(trapped === 'close' || trapped === 'open' || trapped === 'query' || trapped?.startsWith('key-')).toBe(true);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="search"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await waitForFocus(page);
});

test('focus is restored to the same element after returning', async ({ page }) => {
  await enterTvmStream(page);

  await pressUntil(page, 'films-tt0816692');
  await page.keyboard.press('ArrowRight');
  await waitForFocus(page);
  const remembered = await focusedId(page);
  expect(remembered).not.toBeNull();
  expect(remembered).not.toBe('films-tt0816692');

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
  await pressUntil(page, 'films-tt0816692');
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
  await pressUntil(page, 'films-tt0816692');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="details"]')).toBeVisible();
  await expect.poll(async () => focusedId(page)).toBe('play');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Real-Debrid' })).toBeVisible();
  await expect(page.getByText(/rejected the saved token/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TVM Stream' })).toBeVisible();
  await expect(page.locator('[data-screen="player"]')).toHaveCount(0);
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
  await pressUntil(page, 'shows-tt1230051');
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
  await waitForFocus(page);
  expect(await focusedId(page)).toBe('plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="plans"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible();
  await expect(page.locator('[data-focus-id="plan-free"]')).toBeVisible();
});

test('Free plan confirms without a card', async ({ page }) => {
  await pressUntil(page, 'settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await waitForFocus(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="plans"]')).toBeVisible();
  await pressUntil(page, 'plan-free');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="checkout"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TVM Free' })).toBeVisible();
  await expect(page.locator('[data-focus-id="card-name"]')).toHaveCount(0);
  await pressUntil(page, 'pay');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="checkout"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
});

test('Developer rejects a wrong password', async ({ page }) => {
  await pressUntil(page, 'settings');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await pressUntil(page, 'developer');
  await page.keyboard.press('Enter');
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
        price: '£15.99',
        mocks: true,
        liveTv: true,
      },
    }),
  );
  await page.route('**/api/live', (route) =>
    route.fulfill({
      json: {
        url: null,
        error: null,
        channels: [
          { id: 'live:mock:sky-sports', name: 'Sky Sports', url: 'https://example.com/a.m3u8', group: 'Sports' },
          { id: 'live:mock:tnt-sports', name: 'TNT Sports', url: 'https://example.com/b.m3u8', group: 'Sports' },
          { id: 'live:mock:bein-sports', name: 'beIN Sports', url: 'https://example.com/c.m3u8', group: 'Sports' },
          { id: 'live:mock:usa-network', name: 'USA Network', url: 'https://example.com/d.m3u8', group: 'Entertainment' },
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
  await expect(page.getByText('Sky Sports')).toBeVisible();
  await expect(page.getByText('TNT Sports')).toBeVisible();
  await expect(page.getByText('beIN Sports')).toBeVisible();
  await expect(page.getByText('USA Network')).toBeVisible();
});
