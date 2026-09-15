import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'mobile.css'), 'utf8');
const apply = readFileSync(join(dir, 'apply.ts'), 'utf8');
const main = readFileSync(join(dir, '../main.tsx'), 'utf8');
const pointer = readFileSync(join(dir, '../nav/pointerInput.ts'), 'utf8');
const viewport = readFileSync(join(dir, '../nav/phoneViewport.ts'), 'utf8');
const app = readFileSync(join(dir, '../app.css'), 'utf8');

describe('phone layer', () => {
  it('is imported last so TV theme sheets lose equal-specificity fights', () => {
    const motionAt = apply.lastIndexOf("import './motion.css'");
    const mobileAt = apply.lastIndexOf("import './mobile.css'");
    expect(motionAt).toBeGreaterThan(-1);
    expect(mobileAt).toBeGreaterThan(motionAt);
  });

  it('uses a 100% phone frame and real safe-area insets', () => {
    expect(css).toContain('@media (max-width: 47.99rem)');
    expect(css).toContain('width: 100%');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('env(safe-area-inset-left)');
    expect(css).toContain('env(safe-area-inset-right)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('--tvm-tabbar');
    expect(css).toContain('--tvm-keyboard-inset');
    expect(css).toContain('--tvm-chrome-top');
    expect(css).toContain("data-device-family='island'");
    expect(css).toContain('--tvm-chrome-extra-top');
  });

  it('docks the ribbon as a labelled bottom tab bar instead of a hover peek', () => {
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(css).toContain("display: none");
    expect(css).toContain("[data-focus-id='inputs']");
    expect(css).toContain('.ribbon__label');
    expect(css).toMatch(/\.ribbon__label[\s\S]*opacity: 1/);
    expect(css).toContain('html.keyboard-open .ribbon');
    expect(css).not.toMatch(/@media \(max-width: 47\.99rem\)[\s\S]*\.ribbon__icon:hover \.ribbon__label \{[\s\S]*max-width: 0/);
  });

  it('keeps 44px targets, hides the TV OSK, and sizes player transport for a thumb', () => {
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain('font-size: 16px');
    expect(css).toMatch(/\.osk \{\s*display: none;/);
    expect(css).toContain('player-transport__btn--play');
    expect(css).toContain('min-width: 5.5rem');
    expect(css).toContain('height: 4px');
    expect(css).toContain('.player-remote-hints');
    expect(css).toContain('display: none !important');
  });

  it('starts shared touch and keyboard helpers from the UI entry', () => {
    expect(main).toContain('startPointerInput()');
    expect(main).toContain('startPhoneViewport()');
    expect(main).toContain('startDeviceChrome()');
    expect(main).toContain('applyStoredLanguage()');
    expect(pointer).toContain('stopImmediatePropagation()');
    expect(pointer).toContain("event.pointerType === 'touch'");
    expect(pointer).toContain('host.click()');
    expect(pointer).toContain('isTextEntryTarget');
    expect(css).toContain('repeat(auto-fill, minmax(6.5rem, 1fr))');
    expect(viewport).toContain('visualViewport');
    expect(viewport).toContain('--tvm-keyboard-inset');
    expect(viewport).toContain('scrollIntoView');
    expect(viewport).toContain('dataset.orientation');
  });

  it('keeps a 16:9 contained video picture in portrait and landscape', () => {
    expect(css).toContain('object-fit: contain');
    expect(css).toContain('.player--mobile.player--portrait .player__stage');
    expect(css).toContain('.player--mobile.player--landscape .player__video');
  });

  it('fills the phone document with 100dvh and safe-area insets', () => {
    expect(css).toContain('height: 100dvh');
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('html.phone-shell');
    expect(css).toContain('env(safe-area-inset-left)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(app).toContain('html.phone-shell');
    expect(app).toContain('height: 100dvh');
    expect(app).not.toMatch(/html\.phone-shell[\s\S]*\.home--launcher \{[\s\S]*min-height:\s*28vh/);
  });

  it('allows portrait and landscape browsing with no landscape-only CSS lock', () => {
    expect(viewport).toContain('dataset.orientation');
    expect(viewport).toContain("'portrait'");
    expect(viewport).toContain("'landscape'");
    expect(viewport).toContain('phoneOrientation');
    expect(css).toContain("[data-orientation='portrait']");
    expect(css).toContain("[data-orientation='landscape']");
    expect(css).toContain("html.phone-shell[data-orientation='portrait']");
    expect(css).toContain("html.phone-shell[data-orientation='landscape']");
    expect(css).not.toMatch(/@media\s*\(\s*orientation\s*:\s*landscape\s*\)\s*\{/);
    expect(css).not.toContain(
      '@media (max-width: 47.99rem), (pointer: coarse) and (max-height: 30rem) and (orientation: landscape)',
    );
    expect(css).toContain('html.phone-shell .ribbon__list');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('min-height: 2.75rem');
  });
});
