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
    expect(script).toContain('TVM_CORE_BIND=127.0.0.1');
    expect(script).toContain('Opening TVM in the browser');
    expect(script).toContain('electron.exe');
    expect(script).toContain('electron\\dist\\electron');
    expect(main).toContain('isWindowedShell');
    expect(main).toContain('windowedBounds');
    expect(main).toContain('fullscreen: !windowed');
    expect(main).toContain('kiosk: !windowed');
  });

  it('starts from TVM.sh on Linux and macOS', () => {
    const repo = repoRoot();
    const kiosk = readFileSync(join(repo, 'TVM.sh'), 'utf8');
    const windowed = readFileSync(join(repo, 'TVM-windowed.sh'), 'utf8');
    const finder = readFileSync(join(repo, 'TVM-windowed.command'), 'utf8');
    const script = readFileSync(join(repo, 'scripts/launch-tvm.sh'), 'utf8');
    const setup = readFileSync(join(repo, 'scripts/setup-desktop.sh'), 'utf8');

    expect(kiosk).toContain('scripts/launch-tvm.sh');
    expect(kiosk).not.toContain('--windowed');
    expect(windowed).toContain('--windowed');
    expect(finder).toContain('TVM-windowed.sh');
    expect(script).toContain('TVM_CORE_BIND');
    expect(script).toContain('Electron.app/Contents/MacOS/Electron');
    expect(script).toContain('--ozone-platform-hint=auto');
    expect(script).toContain('--no-sandbox');
    expect(script).toContain('core/index.js');
    expect(script).toContain('node --watch src/index.ts');
    expect(setup).toContain('brew install ffmpeg mpv');
    expect(setup).toContain('apt-get install -y ffmpeg mpv');
  });
});

describe('laptop desktop copies', () => {
  it('ships windowed desktop and Roku launchers in Desktop/', () => {
    const repo = repoRoot();
    const desktop = readFileSync(join(repo, 'Desktop/TVM.cmd'), 'utf8');
    const roku = readFileSync(join(repo, 'Desktop/TVM-roku.cmd'), 'utf8');
    const copy = readFileSync(join(repo, 'scripts/copy-to-desktop.ps1'), 'utf8');
    const install = readFileSync(join(repo, 'Install-to-Desktop.cmd'), 'utf8');
    const copySh = readFileSync(join(repo, 'scripts/copy-to-desktop.sh'), 'utf8');
    const installSh = readFileSync(join(repo, 'Install-to-Desktop.sh'), 'utf8');

    expect(desktop).toContain('-Windowed');
    expect(roku).toContain('roku-dev.ps1');
    expect(copy).toContain('TVM.cmd');
    expect(copy).toContain('TVM Roku.cmd');
    expect(copy).toContain('TVM-roku.zip');
    expect(copy).toContain('-Windowed');
    expect(install).toContain('copy-to-desktop.ps1');
    expect(copySh).toContain('launch-tvm.sh');
    expect(copySh).toContain('--windowed');
    expect(copySh).toContain('TVM.command');
    expect(copySh).toContain('TVM.desktop');
    expect(installSh).toContain('copy-to-desktop.sh');
  });

  it('opens on loopback without probing Wi-Fi adapters', () => {
    const repo = repoRoot();
    const roku = readFileSync(join(repo, 'scripts/roku-dev.ps1'), 'utf8');
    const launch = readFileSync(join(repo, 'scripts/launch-tvm.ps1'), 'utf8');
    expect(roku).toContain('TVM_CORE_BIND = "127.0.0.1"');
    expect(roku).toContain('A Wi-Fi adapter is not required.');
    expect(roku).not.toContain('Get-NetIPAddress');
    expect(roku).toMatch(/if \(-not \$Sideload\) \{ return \}/);
    expect(launch).toContain('TVM_CORE_BIND = "127.0.0.1"');
    const rokuSh = readFileSync(join(repo, 'scripts/roku-dev.sh'), 'utf8');
    const launchSh = readFileSync(join(repo, 'scripts/launch-tvm.sh'), 'utf8');
    expect(rokuSh).toContain('TVM_CORE_BIND=127.0.0.1');
    expect(rokuSh).toContain('A Wi-Fi adapter is not required.');
    expect(launchSh).toContain('TVM_CORE_BIND');
  });
});
