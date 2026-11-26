import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const applySrc = readFileSync(join(dir, 'apply.ts'), 'utf8');

describe('theme apply imports', () => {
  it('imports only the two selectable theme sheets', () => {
    expect(applySrc).toContain("import './light.css'");
    expect(applySrc).toContain("import './dark.css'");
    expect(applySrc).toContain("import './scene.css'");
    for (const retired of ['cinematic', 'default', 'happy', 'sunset', 'heather', 'synthwave', 'anime', 'glass']) {
      expect(applySrc).not.toContain(`import './${retired}.css'`);
    }
    const bootSrc = readFileSync(join(dir, 'bootKey.ts'), 'utf8');
    expect(bootSrc).toContain('tvm.theme.duo-boot');
    expect(applySrc).toContain("import { THEME_DEFAULT_BOOT } from './bootKey'");
    expect(applySrc).toContain('store.getItem(THEME_DEFAULT_BOOT)');
    expect(applySrc).not.toContain('tvm.theme.isle-boot');
    expect(applySrc).toContain('subscribeTheme');
    // Keep an existing Light preference while mapping retired IDs to Dark.
    expect(applySrc).toContain('applyTheme(readStoredTheme())');
    expect(applySrc).not.toContain("applyTheme('glass')");
    expect(applySrc).not.toContain('tvm.theme.happy-boot');

  });

  it('does not cover chrome with a cinematic wash or island blobs', () => {
    const scene = readFileSync(join(dir, 'scene.css'), 'utf8');
    expect(scene).not.toContain('tvm-isle-drift');
    expect(scene).not.toContain('tvm-isle-tide');
    expect(scene).not.toContain('--tvm-scene-land');
    expect(scene).toContain('--tvm-scene-sea');
    expect(scene).toContain('.tvm-scene');
    expect(scene).toContain('display: none');
    expect(scene).not.toContain('z-index: -1');
    expect(scene).toContain('--tvm-scene-noise');
    expect(scene).toContain(":root[data-motion='reduced']");
    expect(scene).not.toContain('@media (prefers-reduced-motion');
  });

  it('does not paint an opaque fill on .player-root (that layer sits on top of <video>)', () => {
    const sheets = [
      'scene.css',
      'dark.css',
      'light.css',
    ];
    const opaque = /\.player-root[^{]*\{[^}]*background:\s*(#000|#000000|black)\b/i;
    for (const name of sheets) {
      const css = readFileSync(join(dir, name), 'utf8');
      expect(css, name).not.toMatch(opaque);
    }
    const scene = readFileSync(join(dir, 'scene.css'), 'utf8');
    expect(scene).toContain('.player-root');
    expect(scene).toMatch(/\.player-root[\s\S]*background:\s*transparent/);
    const chrome = readFileSync(join(dir, '..', 'player', 'features', 'player-chrome.css'), 'utf8');
    expect(chrome).toMatch(/\.player-root[\s\S]*background:\s*transparent/);
    expect(chrome).not.toMatch(/\.player-root[^{]*\{[^}]*background:\s*#000/);
  });
});
