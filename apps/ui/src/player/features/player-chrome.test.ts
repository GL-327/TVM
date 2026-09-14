import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const chrome = readFileSync(join(dir, 'player-chrome.css'), 'utf8');
const frame = readFileSync(join(dir, 'ChromeFrame.tsx'), 'utf8');
const title = readFileSync(join(dir, 'TitleOverlay.tsx'), 'utf8');
const progress = readFileSync(join(dir, 'ProgressBar.tsx'), 'utf8');
const volume = readFileSync(join(dir, 'VolumeControl.tsx'), 'utf8');
const retro = readFileSync(join(dir, '..', '..', 'theme', 'synthwave.css'), 'utf8');

function keyframeBlocks(source: string): string[] {
  const blocks: string[] = [];
  const start = /@keyframes\s+[\w-]+\s*\{/g;
  while (start.exec(source) !== null) {
    let depth = 1;
    let index = start.lastIndex;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(start.lastIndex, index - 1));
  }
  return blocks;
}

describe('player watching chrome', () => {
  it('keeps player-root paint transparent so video is not covered', () => {
    expect(chrome).toMatch(/\.player-root[\s\S]*background:\s*transparent/);
    expect(chrome).not.toMatch(/\.player-root[^{]*\{[^}]*background:\s*#000/);
    expect(chrome).toContain('Opaque paint here is a black screen');
  });

  it('builds a cinematic letterbox from veils and a mid-frame vignette', () => {
    expect(frame).toContain('chrome-frame__veil--vignette');
    expect(chrome).toContain('--player-vignette');
    expect(chrome).toContain('.chrome-frame__veil--vignette');
    expect(chrome).toContain('min(28vh, 13.5rem)');
    expect(chrome).toContain('min(44vh, 22.5rem)');
  });

  it('remaps accents for every watching theme including light-on-video ink', () => {
    for (const theme of ['default', 'dark', 'glass', 'happy', 'sunset', 'heather', 'light']) {
      expect(chrome).toContain(`[data-theme='${theme}'] .player`);
    }
    expect(chrome).toContain("[data-theme='light'] .player");
    expect(chrome).toMatch(/\[data-theme='light'\][\s\S]*--player-ink:\s*#f4fffb/);
    expect(chrome).toMatch(/\[data-theme='default'\][\s\S]*--player-fill:\s*var\(--tvm-accent\)/);
    expect(chrome).toMatch(/\[data-theme='dark'\][\s\S]*--player-fill:\s*var\(--tvm-accent\)/);
    expect(chrome).toMatch(/\[data-theme='glass'\][\s\S]*--player-fill:\s*var\(--tvm-glass-accent-mint/);
  });

  it('keeps title type 10-foot sized and skip captions visible', () => {
    expect(title).toContain('clamp(2.25rem, 5.2vw, 3.85rem)');
    expect(title).toContain('player-title-overlay__title::after');
    expect(chrome).toContain('clamp(2.25rem, 5.2vw, 3.85rem)');
    expect(chrome).toContain('.player-transport__btn--play .player-transport__caption');
    expect(chrome).toMatch(/\.player-root \.player-transport__caption[\s\S]*clip:\s*auto/);
  });

  it('grows the progress track and knob with transform only', () => {
    expect(progress).toContain('height: 0.52rem');
    expect(progress).toContain("translate(-50%, -50%) scale(1.22)");
    expect(progress).toContain('var(--player-fill');
    expect(progress).not.toMatch(/\.tvm-progress__track \{[\s\S]*transition:\s*[^}]*height/);
    expect(volume).toContain('scaleX(${shown / 100})');
  });

  it('animates chrome keyframes with transform and opacity only', () => {
    const blocks = keyframeBlocks(`${chrome}\n${title}`);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      expect(properties.length).toBeGreaterThan(0);
      for (const property of properties) expect(['transform', 'opacity']).toContain(property);
    }
  });

  it('honours reduced motion and performance mode', () => {
    expect(chrome).toContain(":root[data-motion='reduced']");
    expect(chrome).toContain(":root[data-perf='on']");
    expect(title).toContain(":root[data-motion='reduced']");
    expect(progress).toContain(":root[data-motion='reduced']");
    expect(volume).toContain(":root[data-motion='reduced']");
  });

  it('gives Retro a harvest-gold watching skin without covering the picture', () => {
    expect(retro).toContain('html[data-theme=\'synthwave\'] .player-dock');
    expect(retro).toContain('html[data-theme=\'synthwave\'] .player-title-overlay__title');
    expect(retro).toContain('--tvm-font-display');
    expect(retro).toContain('var(--tvm-rt-gold)');
    expect(retro).not.toMatch(/\.player-root[^{]*\{[^}]*background:\s*(#000|#000000|black)\b/i);
  });

  it('ships a cinema shell and a dedicated mobile 16:9 shell', () => {
    expect(chrome).toContain('.player--cinema');
    expect(chrome).toContain('.player--mobile');
    expect(chrome).toContain('.player--mobile.player--portrait .player__stage');
    expect(chrome).toContain('.player--mobile.player--landscape .player__stage');
    expect(chrome).toContain('--player-aspect: 16 / 9');
    expect(chrome).toContain('object-fit: contain');
    expect(chrome).toContain('min-height: 44px');
    expect(chrome).toContain('--player-hit: 44px');
    expect(chrome).toContain('.player-chrome-back');
    expect(chrome).toContain('.chrome-frame--hidden .chrome-frame__top');
    expect(chrome).toContain('.chrome-frame--hidden .chrome-frame__bottom');
    expect(chrome).toMatch(/\.chrome-frame--hidden \.chrome-frame__top,\s*\n\.chrome-frame--hidden \.chrome-frame__bottom \{\s*\n\s*pointer-events:\s*none;/);
    expect(chrome).toContain('pointer-events: none');
    expect(chrome).not.toMatch(/\.player--mobile[^{]*\{[^}]*background:\s*#000\s*;/);
    expect(chrome).not.toMatch(/@media\s*\([^)]*orientation:\s*landscape/);
  });

  it('never stretches the picture and letterboxes portrait video in the full screen', () => {
    expect(chrome).toContain('object-position: center');
    expect(chrome).toContain('object-fit: contain');
    expect(chrome).toContain('html.tvm-portrait .player.player--mobile .player__stage');
    expect(chrome).toContain('html.tvm-landscape .player.player--mobile .player__video');
    expect(chrome).not.toMatch(/\.player--mobile\.player--landscape \.player__video[\s\S]{0,220}object-fit:\s*(cover|fill)/);
    expect(chrome).not.toMatch(/\.player--mobile\.player--portrait \.player__video[\s\S]{0,220}object-fit:\s*(cover|fill)/);
    expect(chrome).toContain('inset: 0');
  });
});
