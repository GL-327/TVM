/**
 * Linux compositors often draw a transparent Electron window as an empty
 * frame, so the desktop app looks like it never opened. Windows and macOS
 * stay transparent so mpv can show through the player chrome.
 */
export function shellWindowChrome(platform: NodeJS.Platform): { transparent: boolean; backgroundColor: string } {
  if (platform === 'linux') return { transparent: false, backgroundColor: '#071033' };
  return { transparent: true, backgroundColor: '#00000000' };
}

/** mpv is painted into a foreign window. That path is blank on a Linux shell. */
export function desktopNativePlayback(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}
