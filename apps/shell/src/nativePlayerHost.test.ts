import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { NativePlayerHost } from './nativePlayerHost';

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), spawn: vi.fn(), connect: vi.fn(), send: vi.fn() }));
vi.mock('./mpvInstall', () => ({ ensureMpvExecutable: mocks.ensure }));
vi.mock('./mpv', () => ({ buildMpvArgs: (input: { url: string }) => [input.url] }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:net', () => ({ createConnection: mocks.connect }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    destroyed = false;
    webContents = { send: mocks.send };
    getBounds() { return { x: 0, y: 0, width: 1280, height: 720 }; }
    getNativeWindowHandle() { return Buffer.alloc(8); }
    isDestroyed() { return this.destroyed; }
    isFocused() { return true; }
    setBounds() {} setParentWindow() {} moveTop() {} focus() {} show() {} hide() {}
    destroy() { this.destroyed = true; }
  }
  return { BaseWindow: Window, BrowserWindow: Window };
});

class Socket extends EventEmitter {
  destroyed = false;
  write = vi.fn();
  setEncoding() {}
  destroy() { this.destroyed = true; }
}
class Child extends EventEmitter {
  exitCode: number | null = null;
  stderr = { resume() {} };
  kill = vi.fn(() => { this.exitCode = 0; });
}

let host: NativePlayerHost;
let socket: Socket;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.ensure.mockResolvedValue('C:\\test\\mpv.exe');
  mocks.spawn.mockImplementation(() => { const child = new Child(); queueMicrotask(() => child.emit('spawn')); return child; });
  mocks.connect.mockImplementation(() => { socket = new Socket(); queueMicrotask(() => socket.emit('connect')); return socket; });
  const { BrowserWindow } = await import('electron');
  host = new NativePlayerHost(new BrowserWindow() as BrowserWindow);
});
afterEach(() => { host.dispose(); vi.restoreAllMocks(); });

describe('native player lifecycle', () => {
  it('only starts the latest overlapping request while mpv is being prepared', async () => {
    await Promise.all([
      host.start({ url: 'https://media.example/old.mkv', title: 'Old' }),
      host.start({ url: 'https://media.example/current.mkv', title: 'Current' }),
    ]);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['https://media.example/current.mkv']);
  });

  it('cancels a pending start when playback is closed', async () => {
    const pending = host.start({ url: 'https://media.example/file.mkv', title: 'Film' });
    host.stop(false);
    await pending;
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('publishes duration and pause changes even inside the clock throttle interval', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await host.start({ url: 'https://media.example/file.mkv', title: 'Film' });
    await Promise.resolve();
    mocks.send.mockClear();
    socket.emit('data', [
      { event: 'property-change', name: 'time-pos', data: 73 },
      { event: 'property-change', name: 'duration', data: 5400 },
      { event: 'property-change', name: 'pause', data: true },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    expect(mocks.send).toHaveBeenLastCalledWith('tvm:native-player:event', expect.objectContaining({ type: 'state', position: 73, duration: 5400, paused: true, buffering: false }));
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });
});
