import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseWindow, BrowserWindow } from 'electron';
import { buildMpvArgs } from './mpv';
import { ensureMpvExecutable } from './mpvInstall';
import {
  applyMpvProperty,
  initialMpvState,
  mpvBuffering,
  MPV_AUDIO_COMMANDS,
  MPV_OBSERVED_PROPERTIES,
  type MpvPlaybackState,
} from './nativePlayerState';

export interface NativePlaybackInput {
  url: string;
  title: string;
  startAt?: number;
}

export type NativePlayerCommand = 'togglePause' | 'pause' | 'play' | 'seekBack' | 'seekForward' | 'stop';

export type NativePlayerEvent =
  | { type: 'started'; title: string }
  | { type: 'state'; paused: boolean; buffering: boolean; position: number; duration: number }
  | { type: 'ended' }
  | { type: 'closed' }
  | { type: 'error'; message: string };

function nativeWindowId(window: BaseWindow): string {
  const handle = window.getNativeWindowHandle();
  if (process.platform === 'win32' && handle.byteLength >= 8) return handle.readBigUInt64LE(0).toString();
  return handle.readUInt32LE(0).toString();
}

function ipcPath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\tvm-mpv-${process.pid}-${Date.now()}`;
  return join(tmpdir(), `tvm-mpv-${process.pid}-${Date.now()}.sock`);
}

/**
 * mpv paints into a Chromium-free BaseWindow. The TVM BrowserWindow sits on
 * top as a transparent overlay so the React player chrome stays in-process.
 */
export class NativePlayerHost {
  private readonly window: BrowserWindow;
  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private videoHost: BaseWindow | null = null;
  private connectAttempt = 0;
  private stopping = false;
  private lineBuffer = '';
  private lastStateSentAt = 0;
  private mpv: MpvPlaybackState = initialMpvState();

  constructor(window: BrowserWindow) {
    this.window = window;
    this.syncVideoHost = this.syncVideoHost.bind(this);
    this.hideVideoHost = this.hideVideoHost.bind(this);
    this.showVideoHost = this.showVideoHost.bind(this);
    window.on('resize', this.syncVideoHost);
    window.on('move', this.syncVideoHost);
    window.on('maximize', this.syncVideoHost);
    window.on('unmaximize', this.syncVideoHost);
    window.on('enter-full-screen', this.syncVideoHost);
    window.on('leave-full-screen', this.syncVideoHost);
    window.on('minimize', this.hideVideoHost);
    window.on('restore', this.showVideoHost);
    window.on('closed', () => this.dispose());
  }

  async start(input: NativePlaybackInput): Promise<{ ok: true }> {
    const url = new URL(input.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) streams can be played.');

    this.stop(false);
    this.stopping = false;
    this.connectAttempt = 0;
    this.mpv = initialMpvState(input.startAt);

    const pipe = ipcPath();
    const executable = await ensureMpvExecutable();
    if (this.stopping) return { ok: true };
    if (executable === undefined) throw new Error('mpv missing');

    const host = this.createVideoHost();
    if (this.stopping) {
      this.destroyVideoHost();
      return { ok: true };
    }

    const args = buildMpvArgs({
      url: input.url,
      windowId: nativeWindowId(host),
      ipcPath: pipe,
      startAt: input.startAt,
    });

    const child = spawn(executable, args, {
      windowsHide: false,
      cwd: dirname(executable),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;
    child.stderr?.resume();
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', () => reject(new Error('mpv missing')));
      });
    } catch {
      if (this.child === child) this.child = null;
      this.destroyVideoHost();
      throw new Error('mpv missing');
    }
    if (this.stopping || this.child !== child) {
      if (this.child === child) this.child = null;
      if (child.exitCode === null) child.kill();
      this.destroyVideoHost();
      return { ok: true };
    }

    this.attachOverlay();
    this.send({ type: 'started', title: input.title });
    this.connect(pipe);
    child.once('error', () => {
      if (this.child !== child || this.stopping) return;
      this.child = null;
      this.showError('Native playback is not installed on this device. Install mpv or set TVM_MPV_PATH, then retry.');
    });
    child.once('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.socket?.destroy();
      this.socket = null;
      if (this.stopping) return;
      if (code === 0) this.finish('ended');
      else this.showError('The native player stopped unexpectedly. Check the connection and try again.');
    });
    return { ok: true };
  }

  command(command: NativePlayerCommand): void {
    if (command === 'stop') {
      this.stop(true);
      return;
    }
    if (this.socket === null) return;
    if (command === 'togglePause') this.write(['cycle', 'pause']);
    if (command === 'pause') this.write(['set_property', 'pause', true]);
    if (command === 'play') this.write(['set_property', 'pause', false]);
    if (command === 'seekBack') this.write(['seek', -10, 'relative']);
    if (command === 'seekForward') this.write(['seek', 10, 'relative']);
  }

  seekTo(seconds: number): void {
    if (this.socket === null) return;
    this.write(['seek', Math.max(0, seconds), 'absolute']);
  }

  stop(notify = true): void {
    const hadSession = this.child !== null || this.videoHost !== null;
    this.stopping = true;
    this.write(['quit']);
    const child = this.child;
    if (child !== null && child.exitCode === null) {
      setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 300).unref();
    }
    this.child = null;
    this.socket?.destroy();
    this.socket = null;
    this.destroyVideoHost();
    if (hadSession && notify) this.send({ type: 'closed' });
  }

  dispose(): void {
    this.stop(false);
    this.window.removeListener('resize', this.syncVideoHost);
    this.window.removeListener('move', this.syncVideoHost);
    this.window.removeListener('maximize', this.syncVideoHost);
    this.window.removeListener('unmaximize', this.syncVideoHost);
    this.window.removeListener('enter-full-screen', this.syncVideoHost);
    this.window.removeListener('leave-full-screen', this.syncVideoHost);
    this.window.removeListener('minimize', this.hideVideoHost);
    this.window.removeListener('restore', this.showVideoHost);
  }

  private createVideoHost(): BaseWindow {
    this.destroyVideoHost();
    const bounds = this.hostBounds();
    const host = new BaseWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#000000',
      title: 'TVM Video',
    });
    this.videoHost = host;
    host.setBounds(bounds);
    host.show();
    return host;
  }

  private attachOverlay(): void {
    if (this.videoHost === null || this.window.isDestroyed()) return;
    (this.window as BaseWindow).setParentWindow(this.videoHost);
    this.window.moveTop();
    if (!this.window.isFocused()) this.window.focus();
  }

  private destroyVideoHost(): void {
    if (!this.window.isDestroyed()) (this.window as BaseWindow).setParentWindow(null);
    const host = this.videoHost;
    this.videoHost = null;
    if (host === null || host.isDestroyed()) return;
    host.destroy();
  }

  private hostBounds() {
    return this.window.getBounds();
  }

  private syncVideoHost(): void {
    if (this.videoHost === null || this.videoHost.isDestroyed() || this.window.isDestroyed()) return;
    const next = this.hostBounds();
    const cur = this.videoHost.getBounds();
    if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return;
    this.videoHost.setBounds(next);
  }

  private hideVideoHost(): void {
    if (this.videoHost === null || this.videoHost.isDestroyed()) return;
    this.videoHost.hide();
  }

  private showVideoHost(): void {
    if (this.videoHost === null || this.videoHost.isDestroyed()) return;
    this.syncVideoHost();
    this.videoHost.show();
  }

  private connect(pipe: string): void {
    if (this.stopping || this.child === null) return;
    this.connectAttempt += 1;
    const socket = createConnection(pipe);
    const onConnectError = (): void => {
      socket.destroy();
      if (this.connectAttempt >= 60 || this.child === null || this.stopping) {
        this.showError('The native player started but TVM could not connect to its controls.');
        return;
      }
      setTimeout(() => this.connect(pipe), 100).unref();
    };
    socket.once('connect', () => {
      socket.removeListener('error', onConnectError);
      if (this.stopping) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      this.connectAttempt = 0;
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => this.onData(chunk));
      socket.on('error', () => {
        if (this.socket === socket) this.socket = null;
      });
      for (const command of MPV_AUDIO_COMMANDS) this.write([...command]);
      for (const property of MPV_OBSERVED_PROPERTIES) {
        this.write(['observe_property', 1, property]);
      }
    });
    socket.once('error', onConnectError);
  }

  private write(command: unknown[]): void {
    if (this.socket === null || this.socket.destroyed) return;
    this.socket.write(`${JSON.stringify({ command })}\n`);
  }

  private onData(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const message = JSON.parse(line) as { event?: string; name?: string; data?: unknown };
        if (message.event !== 'property-change' || typeof message.name !== 'string') continue;
        this.mpv = applyMpvProperty(this.mpv, message.name, message.data);
        if (this.mpv.ended) {
          this.finish('ended');
          continue;
        }
        const now = Date.now();
        if (now - this.lastStateSentAt < 250 && !this.mpv.pausedForCache) continue;
        this.lastStateSentAt = now;
        this.send({
          type: 'state',
          paused: this.mpv.paused,
          buffering: mpvBuffering(this.mpv),
          position: this.mpv.position,
          duration: this.mpv.duration,
        });
      } catch {
        // Ignore a malformed mpv status line; the next property event repairs state.
      }
    }
  }

  private showError(message: string): void {
    this.send({ type: 'error', message });
  }

  private finish(type: 'ended'): void {
    this.stopping = true;
    this.child = null;
    this.socket?.destroy();
    this.socket = null;
    this.destroyVideoHost();
    this.send({ type });
  }

  private send(event: NativePlayerEvent): void {
    if (!this.window.isDestroyed()) this.window.webContents.send('tvm:native-player:event', event);
  }
}
