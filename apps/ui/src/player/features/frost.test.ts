import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

/*
 * Frost over the picture is the theme's call, never an overlay's.
 *
 * player-chrome.css sets --player-chip-filter to `none` for every theme that
 * ships, because blurring live video is per-frame GPU work on the one surface
 * where smoothness matters most. Six overlays wrote `backdrop-filter: blur()`
 * into their own CSS-in-JS instead and so ignored that entirely — the Glass
 * theme had already noticed and was naming them one by one in a kill-list,
 * which is the shape of a rule that wants enforcing rather than repeating.
 */
describe('playback chrome', () => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.tsx') || name.endsWith('.css'));

  it('leaves frost to the theme instead of blurring the video itself', () => {
    const offenders: string[] = [];
    for (const name of files) {
      const src = readFileSync(join(dir, name), 'utf8');
      for (const line of src.split('\n')) {
        if (/backdrop-filter:\s*(?!.*var\(--player-chip-filter)/i.test(line) && /blur\(/i.test(line)) {
          offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the token itself off by default, so a theme has to ask for frost', () => {
    const chrome = readFileSync(join(dir, 'player-chrome.css'), 'utf8');
    expect(chrome).toContain('--player-chip-filter: none;');
  });
});
