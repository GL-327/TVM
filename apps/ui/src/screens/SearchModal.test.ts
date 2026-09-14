import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(dir, rel), 'utf8');
}

describe('SearchModal phone keyboard', () => {
  it('scrolls the query field into the visual viewport and keeps the system keyboard', () => {
    const src = read('SearchModal.tsx');
    const pointer = read('../nav/pointerInput.ts');
    expect(src).toContain('bindKeyboardFields');
    expect(src).toContain('data-keyboard-fields');
    expect(src).toContain('inputMode="search"');
    expect(src).toContain('enterKeyHint="search"');
    expect(pointer).toContain('navShouldIgnoreKey');
    expect(pointer).toContain('revealFieldAboveKeyboard');
    expect(pointer).toContain('stopPropagation');
    expect(pointer).toContain('--tvm-visual-height');
    expect(pointer).toContain('visualViewport');
    expect(pointer).toContain("scrollIntoView({ block: 'nearest'");
  });

  it('keeps 16px fields and a keyboard sheet without transforming the page off-screen', () => {
    const css = read('../theme/mobile.css');
    const start = css.lastIndexOf('/* keyboard fields');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    expect(block).toContain('font-size: 16px');
    expect(block).toContain('--tvm-visual-height');
    expect(block).toContain('html.keyboard-open .search-pill');
    expect(block).toContain('transform: none');
    expect(block).toContain('[data-keyboard-fields]');
  });
});
