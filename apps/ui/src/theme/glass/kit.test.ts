import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('liquid glass kit', () => {
  it('keeps the Bentomotion pack.info we actually used', () => {
    const info = readFileSync(join(dir, 'kit/pack.info'), 'utf8');
    expect(info).toContain('Liquid Glass Kit');
    expect(info).toContain('Bentomotion');
    expect(info).toContain('badgeText = Free');
    expect(info).toContain('apps = AE');
    expect(info).toContain('version = 1.2');
  });

  it('applies kit plate materials without SF fonts', () => {
    const css = readFileSync(join(dir, 'kit.css'), 'utf8');
    const plate = readFileSync(join(dir, 'kit/plate.svg'), 'utf8');
    expect(css).toContain('--tvm-glass-kit-plate');
    expect(css).toContain("url('./kit/plate.svg')");
    expect(css).toContain('background-image: none');
    expect(css).toContain('backdrop-filter: var(--tvm-glass-filter)');
    expect(css).toContain('background-image: var(--tvm-glass-kit-plate)');
    expect(css).toContain('opacity: 0.42');
    expect(css).toContain('z-index: 0');
    expect(css.toLowerCase()).not.toContain('san francisco');
    expect(css.toLowerCase()).not.toContain('sf pro');
    expect(plate).toContain('radialGradient');
    expect(plate.toLowerCase()).not.toContain('san francisco');
  });

  it('does not frost the transformed ribbon host or use mix-blend/isolation', () => {
    const css = readFileSync(join(dir, 'kit.css'), 'utf8');
    expect(css).not.toContain("[data-theme='glass'] .ribbon,");
    expect(css).not.toContain('.ribbon::before');
    expect(css).not.toContain('mix-blend-mode: screen');
    expect(css).not.toContain('isolation: isolate');
  });
});
