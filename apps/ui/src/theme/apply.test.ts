import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const applySrc = readFileSync(join(dir, 'apply.ts'), 'utf8');

describe('theme apply imports', () => {
  it('imports every theme sheet and introduces a new default exactly once', () => {
    expect(applySrc).toContain("import './cinematic.css'");
    expect(applySrc).toContain("import './default.css'");
    expect(applySrc).toContain("import './happy.css'");
    expect(applySrc).toContain("import './light.css'");
    expect(applySrc).toContain("import './dark.css'");
    expect(applySrc).toContain("import './sunset.css'");
    expect(applySrc).toContain("import './heather.css'");
    expect(applySrc).toContain("import './scene.css'");
    expect(applySrc).toContain("import './synthwave.css'");
    expect(applySrc).toContain("import.meta.glob('./glass/*.css', { eager: true })");
    // The boot key is bumped whenever the shipped default changes, so each
    // new default is introduced once per device and a theme the viewer picks
    // afterwards is never overwritten again.
    expect(applySrc).toContain('tvm.theme.cinematic-boot');
    expect(applySrc).not.toContain('tvm.theme.isle-boot');
    expect(applySrc).toContain('subscribeTheme');
    // Applied by name, so changing DEFAULT_THEME cannot leave this behind.
    expect(applySrc).toContain('applyTheme(DEFAULT_THEME)');
    expect(applySrc).not.toContain("applyTheme('glass')");
    expect(applySrc).not.toContain('tvm.theme.happy-boot');

    const sheets = readdirSync(join(dir, 'glass')).filter((name) => name.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(applySrc).toContain(`import './glass/${sheet}'`);
    }
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
      'default.css',
      'dark.css',
      'light.css',
      'sunset.css',
      'heather.css',
      'happy.css',
      'synthwave.css',
      'cinematic.css',
      join('glass', 'player.css'),
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
