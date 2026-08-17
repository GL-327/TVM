import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron';
import { bootErrorPage } from './bootError';
import { LOAD_RETRY_DELAY_MS, LOAD_RETRY_LIMIT, uiOrigin } from './config';
import {
  NativePlayerHost,
  type NativePlaybackInput,
  type NativePlayerCommand,
} from './nativePlayerHost';
import { ServiceHost, type ServiceStartInput } from './serviceHost';
import { createCrashWatch, urlForLoad } from './watchdog';

const TARGET = uiOrigin();
let mainWindow: BrowserWindow | null = null;
let nativePlayer: NativePlayerHost | null = null;
let serviceHost: ServiceHost | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core and the dev server come up on their own schedule, so the shell keeps
 * trying instead of failing the boot.
 */
async function loadWithRetry(window: BrowserWindow): Promise<void> {
  for (let attempt = 1; attempt <= LOAD_RETRY_LIMIT; attempt += 1) {
    if (window.isDestroyed()) return;

    try {
      await window.loadURL(TARGET);
      return;
    } catch {
      if (attempt === 1 && !window.isDestroyed()) {
        await window.loadURL(bootErrorPage(TARGET));
      }
      await delay(LOAD_RETRY_DELAY_MS);
    }
  }

  console.error(`tvm-shell: gave up loading ${TARGET}`);
}

function hardenNavigation(window: BrowserWindow): void {
  // Official services get their own isolated views in Phase 7. Until then the
  // shell window itself must never leave the TVM origin.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(TARGET) && !url.startsWith('data:text/html')) event.preventDefault();
  });
}

function createWindow(): BrowserWindow {
  // TVM_WINDOWED keeps the shell in a normal window while developing on a
  // desktop. The appliance never sets it.
  const windowed = process.env['TVM_WINDOWED'] === '1';

  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    fullscreen: !windowed,
    kiosk: !windowed,
    autoHideMenuBar: true,
    backgroundColor: '#0a0d12',
    ...(windowed && process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#0b0b0b', symbolColor: '#f5f5f5', height: 36 },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.once('closed', () => {
    if (mainWindow === window) {
      nativePlayer?.dispose();
      serviceHost?.dispose();
      nativePlayer = null;
      serviceHost = null;
      mainWindow = null;
    }
  });
  hardenNavigation(window);
  attachWatchdog(window);
  mainWindow = window;
  nativePlayer = new NativePlayerHost(window);
  serviceHost = new ServiceHost(window);

  return window;
}

function attachWatchdog(window: BrowserWindow): void {
  const watch = createCrashWatch();
  window.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed()) return;
    console.error(`tvm-shell: renderer gone (${details.reason})`);
    const mode = watch.noteCrash();
    void window.loadURL(urlForLoad(TARGET, mode));
  });
}

Menu.setApplicationMenu(null);

function playerFor(event: IpcMainInvokeEvent): NativePlayerHost {
  if (mainWindow === null || nativePlayer === null || event.sender !== mainWindow.webContents) {
    throw new Error('Native playback is unavailable.');
  }
  return nativePlayer;
}

ipcMain.handle('tvm:native-player:start', async (event, input: unknown) => {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as Partial<NativePlaybackInput>).url !== 'string' ||
    typeof (input as Partial<NativePlaybackInput>).title !== 'string'
  ) {
    throw new Error('Invalid native playback request.');
  }
  serviceHost?.stop(false);
  return playerFor(event).start(input as NativePlaybackInput);
});

ipcMain.handle('tvm:native-player:command', (event, command: unknown) => {
  const allowed: readonly NativePlayerCommand[] = ['togglePause', 'pause', 'play', 'seekBack', 'seekForward', 'stop'];
  if (typeof command !== 'string' || !allowed.includes(command as NativePlayerCommand)) {
    throw new Error('Invalid native player command.');
  }
  playerFor(event).command(command as NativePlayerCommand);
});

ipcMain.handle('tvm:native-player:stop', (event) => {
  playerFor(event).stop(false);
});

function serviceFor(event: IpcMainInvokeEvent): ServiceHost {
  if (mainWindow === null || serviceHost === null || event.sender !== mainWindow.webContents) {
    throw new Error('In-app services are unavailable.');
  }
  return serviceHost;
}

ipcMain.handle('tvm:service:start', (event, input: unknown) => {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as Partial<ServiceStartInput>).id !== 'string' ||
    typeof (input as Partial<ServiceStartInput>).url !== 'string' ||
    typeof (input as Partial<ServiceStartInput>).title !== 'string'
  ) {
    throw new Error('Invalid service request.');
  }
  nativePlayer?.stop(false);
  return serviceFor(event).start(input as ServiceStartInput);
});

ipcMain.handle('tvm:service:stop', (event) => {
  serviceFor(event).stop(false);
});

void app.whenReady().then(async () => {
  const window = createWindow();
  await loadWithRetry(window);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void loadWithRetry(createWindow());
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
