import { describe, expect, it } from 'vitest';
import { buildMpvArgs, resolveMpvExecutable } from './mpv';

describe('mpv launch', () => {
  it('embeds video into the TVM window and keeps the URL as one argument', () => {
    const args = buildMpvArgs({
      url: 'https://cdn.example/video.mkv?token=one two',
      windowId: '1234',
      ipcPath: '\\\\.\\pipe\\tvm-test',
      startAt: 42,
    });

    expect(args).toContain('--wid=1234');
    expect(args).toContain('--input-ipc-server=\\\\.\\pipe\\tvm-test');
    expect(args).toContain('--hwdec=auto-safe');
    expect(args).toContain('--start=42');
    expect(args.at(-1)).toBe('https://cdn.example/video.mkv?token=one two');
  });

  it('uses an explicit mpv path without guessing', () => {
    expect(resolveMpvExecutable({ TVM_MPV_PATH: 'C:\\TVM\\mpv.exe' }, undefined, 'win32')).toBe(
      'C:\\TVM\\mpv.exe',
    );
  });
});
