import { app, BrowserWindow, Menu, shell } from 'electron';
import { bootErrorPage } from './bootError';
import { LOAD_RETRY_DELAY_MS, LOAD_RETRY_LIMIT, uiOrigin } from './config';

const TARGET = uiOrigin();

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
    kiosk: !windowed && process.env['TVM_ENV'] === 'production',
    autoHideMenuBar: true,
    // Matches the UI background so there is no flash between paint and load.
    backgroundColor: '#0a0d12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  hardenNavigation(window);

  return window;
}

Menu.setApplicationMenu(null);

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
