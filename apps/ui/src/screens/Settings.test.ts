import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

function read(name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}

describe('Settings picture group', () => {
  it('puts Motion and Performance at the top, before themes and privacy', () => {
    const src = read('Settings.tsx');
    const picture = src.indexOf('settings-group__title">Picture');
    const motion = src.indexOf('id="motion"');
    const performance = src.indexOf('id="performance"');
    const look = src.indexOf('settings-group__title">Look');
    const privacy = src.indexOf('id="privacy"');
    const theme = src.indexOf('id={`theme-${spec.id}`}');
    expect(picture).toBeGreaterThan(-1);
    expect(motion).toBeGreaterThan(picture);
    expect(performance).toBeGreaterThan(motion);
    expect(look).toBeGreaterThan(performance);
    expect(theme).toBeGreaterThan(look);
    expect(privacy).toBeGreaterThan(theme);
    expect(src).toContain('Performance mode');
    expect(src).toContain('data-wrap="y"');
    expect(src).toContain('settings-list');
  });

  it('opens Settings on Performance so the row is on screen', () => {
    const registry = readFileSync(join(dir, '../nav/registry.ts'), 'utf8');
    expect(registry).toContain("settings: { component: Settings, defaultFocus: 'performance' }");
  });
});

describe('Settings 10-foot type stays on theme ink', () => {
  it('does not let plan styles reassign --tvm-text', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const tokens = readFileSync(join(dir, '../../../../packages/design/src/tokens.css'), 'utf8');
    expect(css).toContain('.settings-group__title');
    expect(css).toContain('.settings-row {\n  width: 100%');
    expect(css).toContain('color: var(--tvm-text)');
    expect(css).toContain('Never reassign --tvm-text here');
    expect(css).not.toMatch(/\[data-style[^\]]*\][^{]*\{[^}]*--tvm-text\s*:/);

    const styleBlocks = [...tokens.matchAll(/html\[data-style='([^']+)'\][^{]*\{([^}]+)\}/g)];
    expect(styleBlocks.length).toBeGreaterThan(4);
    for (const match of styleBlocks) {
      const id = match[1];
      const body = match[2] ?? '';
      if (id === 'contrast') continue;
      expect(body, id).not.toMatch(/--tvm-text\s*:/);
    }
  });
});
