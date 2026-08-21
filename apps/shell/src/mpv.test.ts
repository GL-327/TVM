import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMpvArgs, mpvCandidatePaths, mpvInstallDir, resolveMpvExecutable } from './mpv';
import { pickWindowsMpvAsset, scoreWindowsMpvAsset } from './mpvInstall';

describe('mpv launch', () => {
  it('embeds into the host window instead of opening a second fullscreen player', () => {
    const args = buildMpvArgs({
      url: 'https://cdn.example/video.mkv?token=one two',
      windowId: '1234',
      ipcPath: '\\\\.\\pipe\\tvm-test',
      startAt: 42,
      platform: 'win32',
    });

    expect(args).toContain('--wid=1234');
    expect(args).toContain('--ontop=no');
    expect(args).toContain('--fullscreen=no');
    expect(args).not.toContain('--ontop');
    expect(args).not.toContain('--fullscreen');
    expect(args).not.toContain('--force-window=immediate');
    expect(args).toContain('--input-ipc-server=\\\\.\\pipe\\tvm-test');
    expect(args).toContain('--hwdec=auto-copy');
    expect(args).toContain('--gpu-context=d3d11');
    expect(args).toContain('--cache=yes');
    expect(args).toContain('--start=42');
    expect(args.at(-1)).toBe('https://cdn.example/video.mkv?token=one two');
  });

  it('uses an explicit mpv path without guessing', () => {
    expect(resolveMpvExecutable({ TVM_MPV_PATH: 'C:\\TVM\\mpv.exe' }, undefined, 'win32', () => false)).toBe(
      'C:\\TVM\\mpv.exe',
    );
  });

  it('finds a portable install under LocalAppData instead of spawning a bare mpv.exe', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\tvm\\AppData\\Local', USERPROFILE: 'C:\\Users\\tvm' };
    const portable = join(mpvInstallDir(env, 'win32'), 'mpv.exe');
    expect(mpvCandidatePaths(env, undefined, 'win32')).toContain(portable);
    expect(resolveMpvExecutable(env, undefined, 'win32', (path) => path === portable)).toBe(portable);
    expect(resolveMpvExecutable(env, undefined, 'win32', () => false)).toBeUndefined();
  });
});

describe('mpv windows asset pick', () => {
  it('prefers a 64-bit player build over ffmpeg or libmpv SDK zips', () => {
    const picked = pickWindowsMpvAsset(
      [
        { name: 'ffmpeg-x86_64-v3-git.7z', browser_download_url: 'https://cdn.example/ffmpeg.7z' },
        { name: 'mpv-dev-x86_64-v3-git.7z', browser_download_url: 'https://cdn.example/dev.7z' },
        { name: 'mpv-x86_64-20260814-git.7z', browser_download_url: 'https://cdn.example/generic.7z' },
        { name: 'mpv-x86_64-v3-20260814-git.7z', browser_download_url: 'https://cdn.example/v3.7z' },
        { name: 'mpv-aarch64-20260814-git.7z', browser_download_url: 'https://cdn.example/arm.7z' },
      ],
      'x64',
    );
    expect(picked?.browser_download_url).toBe('https://cdn.example/v3.7z');
    expect(scoreWindowsMpvAsset('mpv-dev-x86_64-v3.7z', 'x64')).toBeNull();
    expect(scoreWindowsMpvAsset('mpv-aarch64-git.7z', 'x64')).toBeNull();
    expect(scoreWindowsMpvAsset('mpv-aarch64-git.7z', 'arm64')).not.toBeNull();
  });
});
