import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, '../app.css'), 'utf8');

/** Colours that actually paint, ignoring editor metadata like Inkscape's pagecolor. */
function paintedColours(svg: string): string[] {
  const hits = [
    ...svg.matchAll(/fill\s*[:=]\s*"?(#[0-9a-fA-F]{3,8})/g),
    ...svg.matchAll(/stop-color\s*[:=]\s*"?(#[0-9a-fA-F]{3,8})/g),
  ];
  return [...new Set(hits.map((m) => m[1]!.toLowerCase()))];
}

/**
 * `.app-card--max .app-card__art { background: #002be7 !important; }`
 *
 * Found by hand rather than by regex: building one from a template literal is
 * how the first version of this test silently matched nothing.
 */
function tileBackground(id: string): string | null {
  const head = `.app-card--${id} .app-card__art`;
  const at = css.indexOf(head);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const body = css.slice(open + 1, close);
  const declaration = body.split(';').find((part) => part.includes('background'));
  if (declaration === undefined) return null;
  return declaration.match(/#[0-9a-fA-F]{3,8}/)?.[0]?.toLowerCase() ?? null;
}

/*
 * Three marks were drawn in the same colour as the tile behind them — max and
 * paramount in the identical hex, disney a shade off — so those tiles rendered
 * as blank coloured rectangles with only the caption underneath. app.css had
 * said `color: #fff` for all three since it was written, but they load through
 * <img>, which cannot inherit a colour from the page, so the intent never
 * reached the artwork.
 */
describe('service marks', () => {
  const ids = ['max', 'disney', 'paramount', 'prime', 'hulu', 'peacock', 'appletv', 'iplayer', 'tubi', 'pluto', 'freevee'];

  it('never paint in the colour of the tile behind them', () => {
    const invisible: string[] = [];
    for (const id of ids) {
      const background = tileBackground(id);
      if (background === null) continue;
      let svg: string;
      try {
        svg = readFileSync(join(dir, `../../public/apps/marks/${id}.svg`), 'utf8');
      } catch {
        continue;
      }
      for (const colour of paintedColours(svg)) {
        if (colour === background) invisible.push(`${id}: mark ${colour} on tile ${background}`);
      }
    }
    expect(invisible).toEqual([]);
  });

  it('still finds the tiles it is checking, so the test cannot pass by looking at nothing', () => {
    expect(tileBackground('max')).toBe('#002be7');
    expect(tileBackground('paramount')).toBe('#0064ff');
    expect(paintedColours(readFileSync(join(dir, '../../public/apps/marks/max.svg'), 'utf8')).length).toBeGreaterThan(0);
  });
});
