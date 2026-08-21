import pkg from '../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.js';
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.log('PAGEERROR', String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text());
});
await page.goto('http://127.0.0.1:5173/?skipIntro=1&e2e=1', { waitUntil: 'domcontentloaded', timeout: 20_000 });
try {
  await page.waitForSelector('.app__screen', { timeout: 12_000 });
} catch {
  /* dump anyway */
}
try {
  await page.waitForSelector('.stage__title, .rail, button', { timeout: 10_000 });
} catch {
  /* dump anyway */
}
try {
  await page.waitForSelector('.poster', { timeout: 20_000 });
} catch {
  /* catalog may still be loading */
}
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const dump = (el, name) => {
    if (!el) return { name, missing: true };
    const s = cs(el);
    const r = el.getBoundingClientRect();
    return {
      name,
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      zIndex: s.zIndex,
      position: s.position,
      isolation: s.isolation,
      mixBlendMode: s.mixBlendMode,
      contain: s.contain,
      background: s.backgroundColor,
      color: s.color,
      transform: s.transform,
      overflow: s.overflow,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
    };
  };
  const app = document.querySelector('.app');
  const screen = document.querySelector('.app__screen');
  const scene = document.querySelector('.tvm-scene');
  const canvas = document.querySelector('.tvm-scene__gpu');
  const home = document.querySelector('.home');
  const layer = document.querySelector('.screen-layer');
  const intro = document.querySelector('.tvm-intro');
  const title = document.querySelector('.stage__title');
  const ribbon = document.querySelector('.ribbon');
  return {
    theme: document.documentElement.dataset.theme,
    htmlClasses: document.documentElement.className,
    bodyBg: cs(document.body).backgroundColor,
    rootChildCount: document.getElementById('root')?.childElementCount ?? 0,
    app: dump(app, 'app'),
    screen: dump(screen, 'screen'),
    scene: dump(scene, 'scene'),
    canvas: dump(canvas, 'canvas'),
    home: dump(home, 'home'),
    layer: dump(layer, 'layer'),
    intro: dump(intro, 'intro'),
    title: dump(title, 'title'),
    ribbon: dump(ribbon, 'ribbon'),
    sceneEngine: scene?.getAttribute('data-engine'),
    sceneRun: scene?.getAttribute('data-run'),
    rails: document.querySelectorAll('.rail').length,
    posters: document.querySelectorAll('.poster').length,
    skeletons: document.querySelectorAll('.skeleton').length,
    buttons: document.querySelectorAll('button').length,
    titleText: title?.textContent ?? null,
    focused: document.querySelector('[data-focused="true"]')?.getAttribute('data-focus-id') ?? null,
    rootChildren: [...(document.getElementById('root')?.children ?? [])].map((el) => el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')),
    overlay: Boolean(document.querySelector('vite-error-overlay')),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'C:/Users/Arthur/Desktop/TVM-main/tvm-after.png' });
await browser.close();
