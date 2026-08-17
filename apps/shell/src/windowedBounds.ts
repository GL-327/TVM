export type Size = { width: number; height: number };

export const WINDOWED_TARGET: Size = { width: 1280, height: 720 };
export const WINDOWED_MARGIN = 48;

/**
 * Fit the laptop window inside the usable desktop, leaving room for the
 * taskbar / dock. Living-room kiosk mode never calls this.
 */
export function windowedBounds(workArea: Size): Size {
  return {
    width: Math.max(1, Math.min(WINDOWED_TARGET.width, workArea.width - WINDOWED_MARGIN)),
    height: Math.max(1, Math.min(WINDOWED_TARGET.height, workArea.height - WINDOWED_MARGIN)),
  };
}

export function isWindowedShell(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['TVM_WINDOWED'] === '1';
}

export function uiLoadUrl(origin: string, windowed: boolean): string {
  const url = new URL(origin);
  if (windowed) url.searchParams.set('desktop', '1');
  else url.searchParams.delete('desktop');
  return url.toString();
}
