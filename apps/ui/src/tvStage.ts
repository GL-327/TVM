const STAGE_W = 1920;
const STAGE_H = 1080;

export function isTvPreview(search = window.location.search): boolean {
  return new URLSearchParams(search).get('tv') === '1';
}

export function tvScale(width: number, height: number, stageW = STAGE_W, stageH = STAGE_H): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / stageW, height / stageH);
}

/** Letterbox the desktop UI onto a 1920×1080 TV stage. Desktop Electron is unchanged. */
export function startTvStage(): void {
  if (!isTvPreview()) return;
  const root = document.documentElement;
  root.classList.add('tv-preview');
  const fit = (): void => {
    root.style.setProperty('--tv-scale', String(tvScale(window.innerWidth, window.innerHeight)));
  };
  fit();
  window.addEventListener('resize', fit);
}
