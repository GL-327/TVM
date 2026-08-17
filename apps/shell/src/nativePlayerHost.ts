import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserWindow, WebContentsView } from 'electron';
import { buildMpvArgs, resolveMpvExecutable } from './mpv';

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

interface OverlayState {
  title: string;
  paused: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  error: string | null;
  focus: number;
}

const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; color: #fff; }
  body { display: flex; flex-direction: column; justify-content: space-between;
    padding: 1.4rem 2.5rem 1.5rem;
    background: linear-gradient(180deg, rgba(0,0,0,.78), transparent 28%),
      linear-gradient(0deg, rgba(0,0,0,.88), rgba(0,0,0,.5) 40%, transparent 64%); }
  .top { display: flex; align-items: center; gap: .75rem; }
  .back { width: 2.3rem; height: 2.3rem; display: flex; align-items: center; justify-content: center;
    border: none; border-radius: .45rem; background: transparent; color: #fff; font-size: 1.6rem; }
  h1 { margin: 0; max-width: 70vw; font-size: 1.15rem; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .buffer { display: none; position: absolute; left: 10%; right: 10%; top: 48%; text-align: center; color: rgba(255,255,255,.82); }
  .buffer.on { display: block; }
  .bar { height: .38rem; margin: .7rem auto 0; max-width: 80%; border-radius: 99rem; background: rgba(255,255,255,.18); overflow: hidden; }
  .bar > span { display: block; height: 100%; width: 42%; background: #e50914; animation: load 1.1s linear infinite; }
  @keyframes load { from { transform: translateX(-120%); } to { transform: translateX(280%); } }
  .error { display: none; max-width: 44rem; padding: 1rem 1.25rem; border: 1px solid rgba(255,255,255,.14);
    border-radius: 1rem; background: rgba(20,0,0,.9); color: #fff; font-size: 1.1rem; }
  .error.on { display: block; }
  .seek { position: relative; height: .28rem; border-radius: 99rem; background: rgba(255,255,255,.28); }
  .seek > span { display: block; height: 100%; border-radius: inherit; background: #e50914; }
  .thumb { position: absolute; top: 50%; width: .78rem; height: .78rem; border-radius: 50%; background: #e50914;
    transform: translate(-50%,-50%); }
  .times { display: flex; justify-content: space-between; margin: .45rem 0 .2rem; color: rgba(255,255,255,.82);
    font-size: .8rem; font-variant-numeric: tabular-nums; }
  .buttons { display: flex; justify-content: flex-end; gap: .4rem; }
  button { width: 2.5rem; height: 2.5rem; padding: 0; border: none; border-radius: .45rem;
    background: transparent; color: #fff; font: inherit; font-weight: 700; }
  button.focused { outline: none; background: rgba(255,255,255,.14); box-shadow: 0 0 0 .14rem #fff; }
</style>
</head>
<body>
  <div class="top">
    <div class="back" aria-hidden="true">‹</div>
    <h1 id="title">Loading</h1>
  </div>
  <div id="buffer" class="buffer">Loading…<div class="bar"><span></span></div></div>
  <div>
    <p id="error" class="error"></p>
    <div class="times"><span id="elapsed">0:00</span><span id="duration">0:00</span></div>
    <div class="seek"><span id="progress"></span><i id="thumb" class="thumb"></i></div>
    <div class="buttons">
      <button id="pause">❚❚</button>
      <button>−10</button>
      <button>+10</button>
      <button>Back</button>
    </div>
  </div>
<script>
  const buttons = [...document.querySelectorAll('button')];
  const format = value => {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const seconds = Math.floor(value % 60).toString().padStart(2, '0');
    const minutes = Math.floor(value / 60);
    return Math.floor(minutes / 60) > 0
      ? Math.floor(minutes / 60) + ':' + (minutes % 60).toString().padStart(2, '0') + ':' + seconds
      : minutes + ':' + seconds;
  };
  window.__tvmSetState = state => {
    document.getElementById('title').textContent = state.title;
    document.getElementById('pause').textContent = state.paused ? '▶' : '❚❚';
    document.getElementById('buffer').classList.toggle('on', state.buffering);
    const error = document.getElementById('error');
    error.textContent = state.error || '';
    error.classList.toggle('on', Boolean(state.error));
    document.getElementById('elapsed').textContent = format(state.position);
    document.getElementById('duration').textContent = format(state.duration);
    const ratio = state.duration > 0 ? Math.min(100, Math.max(0, state.position / state.duration * 100)) : 0;
    document.getElementById('progress').style.width = ratio + '%';
    document.getElementById('thumb').style.left = ratio + '%';
    buttons.forEach((button, index) => button.classList.toggle('focused', index === state.focus));
  };
</script>
</body>
</html>`;

function windowId(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle();
  if (process.platform === 'win32' && handle.byteLength >= 8) return handle.readBigUInt64LE(0).toString();
  return handle.readUInt32LE(0).toString();
}

function ipcPath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\tvm-mpv-${process.pid}-${Date.now()}`;
  return join(tmpdir(), `tvm-mpv-${process.pid}-${Date.now()}.sock`);
}

export class NativePlayerHost {
  private readonly window: BrowserWindow;
  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private overlay: WebContentsView | null = null;
  private overlayReady = false;
  private connectAttempt = 0;
  private stopping = false;
  private lineBuffer = '';
  private lastStateSentAt = 0;
  private state: OverlayState = {
    title: 'Loading',
    paused: false,
    buffering: true,
    position: 0,
    duration: 0,
    error: null,
    focus: 0,
  };

  constructor(window: BrowserWindow) {
    this.window = window;
    this.resizeOverlay = this.resizeOverlay.bind(this);
    window.on('resize', this.resizeOverlay);
    window.on('closed', () => this.dispose());
  }

  async start(input: NativePlaybackInput): Promise<{ ok: true }> {
    const url = new URL(input.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) streams can be played.');

    this.stop(false);
    this.stopping = false;
    this.state = {
      title: input.title,
      paused: false,
      buffering: true,
      position: input.startAt ?? 0,
      duration: 0,
      error: null,
      focus: 0,
    };
    this.createOverlay();

    const pipe = ipcPath();
    const executable = resolveMpvExecutable();
    const args = buildMpvArgs({
      url: input.url,
      windowId: windowId(this.window),
      ipcPath: pipe,
      startAt: input.startAt,
    });

    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;
    child.stderr?.resume();
    child.once('spawn', () => {
      this.send({ type: 'started', title: input.title });
      this.connect(pipe);
      this.bringOverlayFront();
    });
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

  stop(notify = true): void {
    const hadSession = this.child !== null || this.overlay !== null;
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
    this.removeOverlay();
    if (hadSession && notify) this.send({ type: 'closed' });
  }

  dispose(): void {
    this.stop(false);
    this.window.removeListener('resize', this.resizeOverlay);
  }

  private createOverlay(): void {
    const overlay = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    overlay.setBackgroundColor('#00000000');
    this.overlay = overlay;
    this.overlayReady = false;
    this.window.contentView.addChildView(overlay);
    this.resizeOverlay();
    overlay.webContents.on('before-input-event', (event, input) => {
      const key = input.key;
      if (key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        this.state.focus = (this.state.focus + 3) % 4;
        this.updateOverlay();
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        event.preventDefault();
        this.state.focus = (this.state.focus + 1) % 4;
        this.updateOverlay();
        return;
      }
      if (key === 'Enter' || key === ' ' || key === 'NumpadEnter') {
        event.preventDefault();
        this.activateFocused();
        return;
      }
      if (key === 'Escape' || key === 'Backspace' || key === 'BrowserBack') {
        event.preventDefault();
        this.stop(true);
        return;
      }
      if (key === 'MediaPlayPause') this.command('togglePause');
      if (key === 'MediaPlay') this.command('play');
      if (key === 'MediaPause') this.command('pause');
      if (key === 'MediaRewind') this.command('seekBack');
      if (key === 'MediaFastForward') this.command('seekForward');
      if (key === 'MediaStop') this.stop(true);
    });
    overlay.webContents.once('did-finish-load', () => {
      this.overlayReady = true;
      this.updateOverlay();
      overlay.webContents.focus();
    });
    void overlay.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
  }

  private removeOverlay(): void {
    const overlay = this.overlay;
    this.overlay = null;
    this.overlayReady = false;
    if (overlay === null) return;
    this.window.contentView.removeChildView(overlay);
    overlay.webContents.close();
    if (!this.window.isDestroyed()) this.window.webContents.focus();
  }

  private resizeOverlay(): void {
    if (this.overlay === null || this.window.isDestroyed()) return;
    const size = this.window.getContentSize();
    const width = size[0] ?? 0;
    const height = size[1] ?? 0;
    this.overlay.setBounds({ x: 0, y: 0, width, height });
  }

  private bringOverlayFront(): void {
    const overlay = this.overlay;
    if (overlay === null) return;
    this.window.contentView.removeChildView(overlay);
    this.window.contentView.addChildView(overlay);
    this.resizeOverlay();
  }

  private activateFocused(): void {
    if (this.state.focus === 0) this.command('togglePause');
    if (this.state.focus === 1) this.command('seekBack');
    if (this.state.focus === 2) this.command('seekForward');
    if (this.state.focus === 3) this.stop(true);
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
      for (const property of ['time-pos', 'duration', 'pause', 'cache-buffering-state', 'eof-reached']) {
        this.write(['observe_property', 1, property]);
      }
      this.bringOverlayFront();
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
        if (message.event !== 'property-change') continue;
        if (message.name === 'time-pos' && typeof message.data === 'number') this.state.position = message.data;
        if (message.name === 'duration' && typeof message.data === 'number') this.state.duration = message.data;
        if (message.name === 'pause' && typeof message.data === 'boolean') this.state.paused = message.data;
        if (message.name === 'cache-buffering-state') this.state.buffering = message.data === true;
        if (message.name === 'eof-reached' && message.data === true) {
          this.finish('ended');
          continue;
        }
        this.updateOverlay();
        const now = Date.now();
        if (now - this.lastStateSentAt >= 1_000) {
          this.lastStateSentAt = now;
          this.send({
            type: 'state',
            paused: this.state.paused,
            buffering: this.state.buffering,
            position: this.state.position,
            duration: this.state.duration,
          });
        }
      } catch {
        // Ignore a malformed mpv status line; the next property event repairs state.
      }
    }
  }

  private updateOverlay(): void {
    if (!this.overlayReady || this.overlay === null || this.overlay.webContents.isDestroyed()) return;
    const state = JSON.stringify(this.state);
    void this.overlay.webContents.executeJavaScript(`window.__tvmSetState(${state})`, true).catch(() => undefined);
  }

  private showError(message: string): void {
    this.state.error = message;
    this.state.buffering = false;
    this.state.focus = 3;
    this.updateOverlay();
    this.send({ type: 'error', message });
  }

  private finish(type: 'ended'): void {
    this.stopping = true;
    this.child = null;
    this.socket?.destroy();
    this.socket = null;
    this.removeOverlay();
    this.send({ type });
  }

  private send(event: NativePlayerEvent): void {
    if (!this.window.isDestroyed()) this.window.webContents.send('tvm:native-player:event', event);
  }
}
