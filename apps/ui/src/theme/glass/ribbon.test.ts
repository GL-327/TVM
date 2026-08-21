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

  it('wraps the list in an untransformed frost host', () => {
    const src = readFileSync(join(ui, 'components/Ribbon.tsx'), 'utf8');
    const frost = src.indexOf('<div className="ribbon__frost">');
    const list = src.indexOf('<div className="ribbon__list" data-wrap="row">');
    const listClose = src.lastIndexOf('</div>');
    expect(frost).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(frost);
    expect(src).toContain('className="ribbon__frost"');
    expect(src).toContain('className="ribbon__list"');
    expect(listClose).toBeGreaterThan(list);
    const inner = src.slice(frost, src.indexOf('</nav>'));
    expect(inner.match(/<div/g)?.length).toBe(inner.match(/<\/div>/g)?.length);
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
