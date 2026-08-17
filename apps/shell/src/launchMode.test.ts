import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  const here = process.cwd();
  if (existsSync(join(here, 'TVM.cmd'))) return here;
  if (existsSync(join(here, '../../TVM.cmd'))) return join(here, '../..');
  return here;
}

describe('living-room launch', () => {
  it('starts fullscreen from TVM.cmd and keeps a windowed launcher', () => {
    const repo = repoRoot();
    const cmd = readFileSync(join(repo, 'TVM.cmd'), 'utf8');
    const windowed = readFileSync(join(repo, 'TVM-windowed.cmd'), 'utf8');
    const script = readFileSync(join(repo, 'scripts/launch-tvm.ps1'), 'utf8');
    const main = readFileSync(join(repo, 'apps/shell/src/main.ts'), 'utf8');

    expect(cmd).toContain('launch-tvm.ps1');
    expect(cmd).not.toContain('-Windowed');
    expect(windowed).toContain('-Windowed');
    expect(script).toContain('[switch]$Windowed');
    expect(script).toMatch(/\$envPrefix = if \(\$Windowed\) \{[\s\S]*TVM_WINDOWED=1/);
    expect(script).toMatch(/else \{\s*"set TVM_ENV=development&& "\s*\}/);
    expect(script).toContain('electron.exe');
    expect(script).toContain('electron\\dist\\electron');
    expect(main).toContain('isWindowedShell');
    expect(main).toContain('windowedBounds');
    expect(main).toContain('fullscreen: !windowed');
    expect(main).toContain('kiosk: !windowed');
  });
});

describe('laptop desktop copies', () => {
  it('ships windowed desktop and Roku launchers in Desktop/', () => {
    const repo = repoRoot();
    const desktop = readFileSync(join(repo, 'Desktop/TVM.cmd'), 'utf8');
    const roku = readFileSync(join(repo, 'Desktop/TVM-roku.cmd'), 'utf8');
    const copy = readFileSync(join(repo, 'scripts/copy-to-desktop.ps1'), 'utf8');
    const install = readFileSync(join(repo, 'Install-to-Desktop.cmd'), 'utf8');

    expect(desktop).toContain('-Windowed');
    expect(roku).toContain('roku-dev.ps1');
    expect(copy).toContain('TVM.cmd');
    expect(copy).toContain('TVM Roku.cmd');
    expect(copy).toContain('TVM-roku.zip');
    expect(copy).toContain('-Windowed');
    expect(install).toContain('copy-to-desktop.ps1');
  });
});
