import { BrowserWindow, WebContentsView } from 'electron';
import { isAllowedServiceUrl } from './serviceOrigins';

export interface ServiceStartInput {
  id: string;
  url: string;
  title: string;
}

export type ServiceEvent = { type: 'started'; title: string } | { type: 'closed' } | { type: 'error'; message: string };

const CHROME_HEIGHT = 72;
const CLOSE_URL = 'https://tvm.invalid/close';

function chromeHtml(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; }
  html, body { margin: 0; height: 100%; background: #0b1020; color: #f8f7ff; }
  body { display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem; }
  .brand { letter-spacing: .16em; font-weight: 800; color: #c8b8ff; }
  h1 { margin: .15rem 0 0; font-size: 1.15rem; }
  button { min-height: 2.6rem; padding: .45rem 1rem; border: 1px solid rgba(255,255,255,.16);
    border-radius: .8rem; background: #7657e6; color: #fff; font: inherit; font-weight: 700; }
  button:focus { outline: .18rem solid #b79cff; outline-offset: .12rem; }
</style>
</head>
<body>
  <div><div class="brand">TVM</div><h1>${title.replace(/[<>&]/g, '')}</h1></div>
  <button id="back" autofocus>Back to TVM</button>
<script>
  document.getElementById('back').addEventListener('click', () => { location.href = ${JSON.stringify(CLOSE_URL)}; });
</script>
</body>
</html>`;
}

export class ServiceHost {
  private view: WebContentsView | null = null;
  private chrome: WebContentsView | null = null;
  private readonly resize = (): void => this.layout();

  constructor(private readonly window: BrowserWindow) {
    this.window.on('resize', this.resize);
  }

  start(input: ServiceStartInput): { ok: true } {
    if (!isAllowedServiceUrl(input.url)) {
      throw new Error('That site is not on the TVM allow-list.');
    }
    this.stop(false);
    this.createChrome(input.title);
    this.createView(input);
    this.send({ type: 'started', title: input.title });
    return { ok: true };
  }

  stop(notify = true): void {
    const hadSession = this.view !== null || this.chrome !== null;
    this.remove(this.view);
    this.remove(this.chrome);
    this.view = null;
    this.chrome = null;
    if (!this.window.isDestroyed()) this.window.webContents.focus();
    if (hadSession && notify) this.send({ type: 'closed' });
  }

  dispose(): void {
    this.stop(false);
    this.window.removeListener('resize', this.resize);
  }

  private createChrome(title: string): void {
    const chrome = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.chrome = chrome;
    this.window.contentView.addChildView(chrome);
    chrome.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (url.startsWith(CLOSE_URL)) this.stop(true);
    });
    chrome.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape' || input.key === 'Enter' || input.key === ' ' || input.key === 'BrowserBack') {
        event.preventDefault();
        this.stop(true);
      }
    });
    void chrome.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(chromeHtml(title))}`);
  }

  private createView(input: ServiceStartInput): void {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `persist:tvm-service-${input.id}`,
      },
    });
    this.view = view;
    this.window.contentView.addChildView(view);
    this.layout();
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedServiceUrl(url)) void view.webContents.loadURL(url);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedServiceUrl(url)) event.preventDefault();
    });
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Home' || input.key === 'BrowserHome' || input.key === 'GoHome') {
        event.preventDefault();
        this.stop(true);
        return;
      }
      if (input.key === 'Escape' || input.key === 'BrowserBack') {
        event.preventDefault();
        if (canGoBack(view)) goBack(view);
        else this.stop(true);
      }
    });
    void view.webContents.loadURL(input.url);
    view.webContents.focus();
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const size = this.window.getContentSize();
    const width = size[0] ?? 0;
    const height = size[1] ?? 0;
    this.chrome?.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
    this.view?.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
  }

  private remove(view: WebContentsView | null): void {
    if (view === null) return;
    this.window.contentView.removeChildView(view);
    view.webContents.close();
  }

  private send(event: ServiceEvent): void {
    if (!this.window.isDestroyed()) this.window.webContents.send('tvm:service:event', event);
  }
}

function canGoBack(view: WebContentsView): boolean {
  const history = view.webContents.navigationHistory;
  if (history !== undefined && typeof history.canGoBack === 'function') return history.canGoBack();
  return false;
}

function goBack(view: WebContentsView): void {
  view.webContents.navigationHistory.goBack();
}
