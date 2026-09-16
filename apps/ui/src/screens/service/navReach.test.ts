import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const skinDir = join(dir, 'skins');

function ruleBody(css: string, head: string): string | null {
  const at = css.indexOf(head);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return open < 0 || close < 0 ? null : css.slice(open + 1, close);
}

/** Every rule whose selector list mentions this exact class. */
function rulesFor(css: string, cls: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(cls, from);
    if (at < 0) return bodies;
    from = at + cls.length;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    if (open < 0 || close < 0) return bodies;
    // Only count it if the class is in this rule's selector, not a later one.
    if (css.slice(at, open).includes('{')) continue;
    bodies.push(css.slice(open + 1, close));
  }
}

/*
 * Every hub lays its chrome out in nowrap flex rows, and a phone is narrower
 * than those rows need. The hubs clip their overflow rather than scrolling it,
 * so whatever did not fit was not merely off-screen but unreachable: on the
 * Netflix hub that was TV Shows, Movies, New & Popular, My List, search and
 * the profile button; on Disney the Home tab sat at -73px and a tab covered
 * the Back button.
 *
 * Two rules come out of that. A bar scrolls, so nothing in it is lost. A row
 * of hero actions wraps, because those are the buttons the hero exists for and
 * all of them should be visible rather than merely findable.
 */
describe('service hub chrome on a narrow screen', () => {
  const files = [
    ...readdirSync(skinDir).filter((name) => name.endsWith('.css')).map((name) => join(skinDir, name)),
    join(dir, '../service.css'),
  ];

  it('wraps every hero action row, so the last button cannot fall off the edge', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      const classes = new Set((css.match(/\.[a-z-]+(?:hero|hub)__actions(?= |,|\{)/g) ?? []).map((c) => c.trim()));
      for (const cls of classes) {
        const bodies = rulesFor(css, cls);
        if (bodies.length === 0) continue;
        if (!bodies.some((body) => body.includes('flex-wrap'))) {
          offenders.push(`${basename(file)}: ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lets the top bars scroll rather than clip what does not fit', () => {
    const shared = readFileSync(join(dir, '../service.css'), 'utf8');
    expect(ruleBody(shared, ".service-nav[data-wrap='row'] {")).toContain('overflow-x: auto');

    // Skins that draw their own bar instead of using the shared one.
    expect(ruleBody(readFileSync(join(skinDir, 'max.css'), 'utf8'), '.max-nav {')).toContain('overflow-x: auto');
    expect(ruleBody(readFileSync(join(skinDir, 'disney.css'), 'utf8'), '.dplus-nav__tabs {')).toContain('overflow-x: auto');
  });

  it('is looking at real rules, so it cannot pass by finding nothing', () => {
    const netflix = readFileSync(join(skinDir, 'netflix.css'), 'utf8');
    expect(rulesFor(netflix, '.nf-hub__actions').length).toBeGreaterThan(0);
    expect(rulesFor(netflix, '.nf-hub__actions').some((b) => b.includes('flex-wrap'))).toBe(true);
  });
});
