import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const ui = join(dir, '../..');

describe('glass ribbon centering', () => {
  it('keeps the outer host top-center and frosts only the inner shell', () => {
    const css = readFileSync(join(dir, 'ribbon.css'), 'utf8');
    const app = readFileSync(join(ui, 'app.css'), 'utf8');
    expect(css).toContain("[data-theme='glass'] .ribbon {");
    expect(css).toContain('left: 50%;');
    expect(css).toContain('transform: translate(-50%, calc(-100% - 1.35rem));');
    expect(css).toContain('transform: translate(-50%, 0);');
    expect(css).toMatch(/\[data-theme='glass'\] \.ribbon \{[\s\S]*backdrop-filter: none;/);
    expect(css).toContain("[data-theme='glass'] .ribbon__frost {");
    expect(css).toContain('transform: none;');
    expect(css).toContain('backdrop-filter: var(--tvm-glass-filter)');
    expect(app).toMatch(/\.ribbon \{[\s\S]*left: 50%;/);
    expect(app).toContain('transform: translate(-50%, calc(-100% - 1.35rem));');
    const zoneStart = app.indexOf('.ribbon-zone {\n  position: fixed;');
    const zone = app.slice(zoneStart, app.indexOf('}', zoneStart) + 1);
    expect(zoneStart).toBeGreaterThan(-1);
    expect(zone).toContain('left: 50%');
    expect(zone).not.toContain('right: 0');
    expect(app).toContain('.ribbon__icon:hover .ribbon__label');
    expect(app).toMatch(/\.ribbon__label \{[\s\S]*max-width: 0;/);
    expect(css).toContain('contain: none;');
    expect(css).not.toContain('contain: layout paint');
  });

  /*
   * The list is nested inside the frost host, which is the thing that carries
   * the blur and must not be transformed.
   *
   * This used to compare source offsets, which worked while there was one
   * literal list in the file. There are two now — the television row and the
   * phone tab bar — and both are built above the JSX that renders them, so
   * offsets say nothing. What matters is that neither reaches the DOM except
   * through `.ribbon__frost`.
   */
  it('wraps the list in an untransformed frost host', () => {
    const src = readFileSync(join(ui, 'components/Ribbon.tsx'), 'utf8');
    expect(src).toContain('className="ribbon__frost"');
    expect(src).toContain('<div className="ribbon__list" data-wrap="row">');
    expect(src).toContain('<div className="ribbon__list ribbon__list--tabs" data-wrap="row">');
    // Every list reaches the page through the frost host and nowhere else.
    expect(src).toMatch(/<div className="ribbon__frost">\{phone \? phoneBar : tvList\}<\/div>/);
    expect(src.match(/className="ribbon__list/g)).toHaveLength(2);
    const nav = src.slice(src.indexOf('<nav'), src.indexOf('</nav>'));
    expect(nav.match(/<div/g)?.length).toBe(nav.match(/<\/div>/g)?.length);
  });

  it('forwards wheel on the pill to the page so Settings can still scroll', () => {
    const src = readFileSync(join(ui, 'components/Ribbon.tsx'), 'utf8');
    expect(src).toContain('passWheelToPage');
    expect(src).toContain('onWheel={passWheelToPage}');
    expect(src).toContain('page.scrollTop += event.deltaY');
  });

  it('keeps every ribbon glyph in the markup', () => {
    const src = readFileSync(join(ui, 'components/Ribbon.tsx'), 'utf8');
    const icons = readFileSync(join(ui, 'components/Icons.tsx'), 'utf8');
    expect(src).toContain('<IconHome');
    expect(src).toContain('<IconSearch');
    expect(src).toContain('<IconInputs');
    expect(src).toContain('<IconLive');
    expect(src).toContain('<IconWatchlist');
    expect(src).toContain('<IconApps');
    expect(src).toContain('<IconSettings');
    expect(src).toContain('<IconProfile');
    expect(icons).toContain('stroke="currentColor"');
    expect(icons).not.toContain('url(#tvm-avatar)');
  });
});
